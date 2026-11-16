import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { planSession, type Gym } from '../app/session.ts'
import { program, templateFor } from '../program/program.ts'
import { scheduledSession, todayIn, weekOf } from '../rules/calendar.ts'
import { onboardingState } from '../rules/onboarding.ts'
import { Location, Settings, type DownPeriod, type MorningCheck, type Run, type SetLog, type Workout } from '../schema/index.ts'
import { db } from './db.ts'
import { homeLocation } from './migrations.ts'
import { defaultSettings, getLocations, getSettings, getTimeZoneSetting, launch, loadHistory, onboardingFacts, saveTimeZone, type History } from './repo.ts'

/*
 * Dexie version 12 (M-U1): one additive store, `timeZoneSettings`, the one row holding the zone
 * dates are counted in, with no upgrade callback. A phone on version 11 (Shawn's, set up before
 * first run existed) opens at version 12 with every row exactly as it was, an empty
 * timeZoneSettings table, and so New York: it counts as set up (a settings row is stored), never
 * sees first run, and computes the same dates and the same plans as it did on version 11.
 *
 * The rollback half re-proves PROGRAM-QUESTIONS 149 for version 12: a version 11 declaration opens
 * the version 12 database with its own declared schema, without the timeZoneSettings table. The
 * accepted hazards (PROGRAM-QUESTIONS 203):
 * - a version 11 build counts every date in New York, whatever zone is stored;
 * - its export carries no zone, and it refuses a schema 12 backup file;
 * - its Reset and its import clear only the tables it knows, so a stored zone row survives both and
 *   is read again after the re-upgrade; its Reset reseeds Shawn's defaults (version 11's own Reset);
 * - a fresh phone still on first run, rolled back, gets version 11's Shawn seed at launch;
 * - nothing is added to the settings row (PROGRAM-QUESTIONS 132). Shawn's phone has no zone row, so
 *   a rollback changes nothing he sees.
 */

const V2 = {
  settings: 'id',
  workouts: 'id, date, status, templateId',
  setLogs: 'id, workoutId, exerciseId, [workoutId+slotId]',
  morningChecks: 'id, date',
  runs: 'id, date',
  gateTests: 'id, date, [gate+item]',
  sessionMoves: 'id, week',
}

/** Shawn's settings row as the launch seed wrote it before M-U1 (`defaultSettings`: right knee, Nov 2, an 80 lb rack). */
const settings = { ...defaultSettings(program), id: 'settings' }
const START = program.startDate
const lift: Workout = { id: '2026-11-03-p1-a', date: '2026-11-03', templateId: 'p1-a', phase: 1, week: 1, isDeload: false, startedAt: '2026-11-03T11:00:00.000Z', finishedAt: '2026-11-03T12:00:00.000Z', maxPainDuring: 1, sessionRpe: 6, durationMinutes: 50, status: 'finished' }
const sets: SetLog[] = [1, 2, 3].map((n) => ({ id: `${lift.id}:p1a-1:both:${n}`, workoutId: lift.id, slotId: 'p1a-1', exerciseId: 'leg-press', setNumber: n, side: 'both', load: 90, loadUnit: 'lb', reps: 12, rpe: 7, painDuring: 1, stopped: false }))
const check: MorningCheck = { id: 'mc-2026-11-04', date: '2026-11-04', appliesTo: { kind: 'workout', id: lift.id }, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [] }
const run: Run = { id: 'run-2026-11-02', date: '2026-11-02', type: 'mbr', miles: 3, minutes: 33, effort: 'easy', rpe: 3, maxPain: 1, strides: false, tempo: false }
const period: DownPeriod = { id: 'dp-2026-11-20', start: '2026-11-20', plannedEnd: '2026-11-23', declaredAt: '2026-11-20T13:00:00.000Z' }
const home = homeLocation(80, program.planetFitness, START, program.equipmentListVersion)

// Rows as version 11 wrote them: Shawn's seeded settings and home gym, the export stamp, a session with its sets, a check, a run, a down period.
const v11Rows = {
  settings: [settings, { id: 'last-export', at: '2026-11-04T23:00:00.000Z' }],
  workouts: [lift],
  setLogs: sets,
  morningChecks: [check],
  runs: [run],
  gateTests: [],
  sessionMoves: [],
  locations: [home],
  programOverrides: [],
  addedSlots: [],
  hrSettings: [],
  vo2Readings: [],
  koosEntries: [],
  aclRsiEntries: [],
  downPeriods: [period],
}

function declareVersionEleven(name = 'knee-rebuild'): Dexie {
  const old = new Dexie(name)
  old.version(1).stores({})
  old.version(2).stores(V2)
  old.version(3).stores({ locations: 'id' })
  old.version(4).stores({ programOverrides: 'slotId' })
  old.version(5).stores({ addedSlots: 'id, templateId' })
  old.version(6).stores({})
  old.version(7).stores({ hrSettings: 'id' })
  old.version(8).stores({ vo2Readings: 'date' })
  old.version(9).stores({ koosEntries: 'date', aclRsiEntries: 'date' })
  old.version(10).stores({})
  old.version(11).stores({ downPeriods: 'id, start' })
  return old
}

async function writeVersionEleven(): Promise<void> {
  const old = declareVersionEleven()
  await old.open()
  await old.transaction('rw', old.tables, async () => {
    for (const [name, rows] of Object.entries(v11Rows)) await old.table(name).bulkPut(rows)
  })
  old.close()
}

const keyOf = (row: unknown) => String((row as { id?: string; slotId?: string; date?: string }).id ?? (row as { slotId?: string }).slotId ?? (row as { date?: string }).date)
const sorted = (rows: readonly unknown[]) => [...rows].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))

async function rawRows(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const name of [...Object.keys(v11Rows), 'timeZoneSettings']) out[name] = sorted(await db.table(name).toArray())
  return out
}

/** Session A's plan at a week, at the home gym, from a history and settings: what Today and the runner would prescribe. */
function planA(history: History, s: Settings, gym: Gym, week: number) {
  return planSession({ template: templateFor(1, 'A'), week, settings: s, history, gym }).map((p) => [p.slot.id, p.prescriptions])
}

describe('a version 11 database (Shawn’s phone) opened at version 12', () => {
  it('keeps every row exactly, adds an empty timeZoneSettings table, counts as set up and counts in New York', async () => {
    await writeVersionEleven()

    await db.open()
    expect(db.verno).toBe(12)
    expect(db.tables.map((t) => t.name).sort()).toEqual([...Object.keys(v11Rows), 'timeZoneSettings'].sort())
    const before = await rawRows()
    for (const [name, rows] of Object.entries(v11Rows)) expect(before[name], name).toEqual(sorted(rows))
    expect(before.timeZoneSettings).toEqual([])

    expect(await getTimeZoneSetting()).toEqual({ zone: 'America/New_York', stored: 'none' })
    expect(onboardingState(await onboardingFacts())).toBe('onboarded')

    // The launch path: set up, so no first run, and nothing written.
    expect(await launch(program, '2026-11-10')).toBe('onboarded')
    expect(await rawRows()).toEqual(before)
  })

  it('computes the same dates and the same plans as version 11 did', async () => {
    const { zone } = await getTimeZoneSetting()
    const stored = await getSettings()
    if (!stored) throw new Error('no settings')
    expect(stored).toEqual({ ...defaultSettings(program), lastExportedAt: '2026-11-04T23:00:00.000Z' })

    // Tuesday of week 1, Session A, as Today reads it.
    const tuesday = todayIn(new Date('2026-11-03T14:00:00Z'), zone)
    expect(tuesday).toBe('2026-11-03')
    expect(scheduledSession(tuesday, stored.startDate, program.weeklyTemplate, [])).toEqual({ date: '2026-11-03', week: 1, day: 'tue', session: 'lift:A' })
    // Week 2 begins at New York's midnight, not a moment before.
    expect(weekOf(todayIn(new Date('2026-11-09T04:59:59Z'), zone), stored.startDate)).toBe(1)
    expect(weekOf(todayIn(new Date('2026-11-09T05:00:00Z'), zone), stored.startDate)).toBe(2)

    // Session A at week 2 from the stored rows plans exactly what the version 11 rows in memory plan.
    const history = await loadHistory()
    const [location] = await getLocations()
    if (!location) throw new Error('no home gym')
    const fromStore = planA(history, stored, { location, kit: stored.kit }, 2)
    const inMemory: History = { workouts: [lift], setLogs: sets, morningChecks: [check], runs: [run], gateTests: [], sessionMoves: [], programOverrides: [], addedSlots: [], downPeriods: [period] }
    const v11Settings = Settings.parse(defaultSettings(program))
    expect(fromStore).toEqual(planA(inMemory, v11Settings, { location: Location.parse(home), kit: v11Settings.kit }, 2))
    expect(fromStore.find(([id]) => id === 'p1a-1')?.[1]).toMatchObject([{ load: 90 }])
  })

  it('rolls back: a version 11 declaration opens without the timeZoneSettings table, its rows untouched, and a stored zone survives its Reset', async () => {
    await saveTimeZone('America/Los_Angeles')
    db.close()
    const old = declareVersionEleven()
    await old.open()
    // Dexie 4.4.7 keeps the DECLARED schema on its VersionError retry (PROGRAM-QUESTIONS 149): version
    // 11's tables, so a version 11 build never reads the zone and counts in New York (the accepted
    // hazard, PROGRAM-QUESTIONS 203). If a Dexie upgrade ever changes that, this is the tripwire.
    expect(old.tables.map((t) => t.name).sort()).toEqual(Object.keys(v11Rows).sort())
    expect(old.tables.map((t) => t.name)).not.toContain('timeZoneSettings')
    expect(await old.table('settings').get('settings')).toEqual(settings)
    // Version 11's Reset (and its import) clear the tables it knows; the zone row stays for the re-upgrade.
    await old.transaction('rw', old.tables, async () => {
      for (const table of old.tables) await table.clear()
      await old.table('settings').put(settings)
    })
    old.close()
    await db.open()
    expect(await getTimeZoneSetting()).toEqual({ zone: 'America/Los_Angeles', stored: 'ok' })
    expect(onboardingState(await onboardingFacts())).toBe('onboarded')
  })
})
