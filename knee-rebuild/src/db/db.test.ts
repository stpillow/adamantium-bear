import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { program } from '../program/program.ts'
import { PLANET_FITNESS_LOCATION_ID } from '../schema/index.ts'
import { db } from './db.ts'
import { homeLocation } from './migrations.ts'
import { defaultSettings, ensureLocations, getSettings, loadHistory, resetAll } from './repo.ts'

/*
 * Dexie version 3 (M4b, design section 2): purely additive. A phone that ran week 1 on version 2
 * opens at version 3 with every row as it was, an empty locations table, and the home gym written
 * at launch from the dumbbell max it had set.
 */

// Version 2 exactly as shipped in M3 (src/db/db.ts): opened here with plain Dexie, as the phone has it.
const V2 = {
  settings: 'id',
  workouts: 'id, date, status, templateId',
  setLogs: 'id, workoutId, exerciseId, [workoutId+slotId]',
  morningChecks: 'id, date',
  runs: 'id, date',
  gateTests: 'id, date, [gate+item]',
  sessionMoves: 'id, week',
}

// Week 1 as version 2 stored it: a settings row from before gyms (no activeLocationId, no kit; a 75 lb rack).
const settings = { id: 'settings', injuredSide: 'right', startDate: '2026-11-02', dumbbellMax: 75, restTimerSeconds: 60, painPerSet: false, currentPhase: 1, phaseEnteredWeek: 1, redFlag: { active: false, items: [] } }
const workouts = [
  { id: '2026-11-03-p1-a', date: '2026-11-03', templateId: 'p1-a', phase: 1, week: 1, isDeload: false, startedAt: '2026-11-03T11:00:00.000Z', finishedAt: '2026-11-03T12:00:00.000Z', maxPainDuring: 2, status: 'finished' },
  { id: '2026-11-05-p1-b', date: '2026-11-05', templateId: 'p1-b', phase: 1, week: 1, isDeload: false, startedAt: '2026-11-05T11:00:00.000Z', status: 'in-progress' },
]
const setLogs = [
  { id: '2026-11-03-p1-a:p1a-1:both:1', workoutId: '2026-11-03-p1-a', slotId: 'p1a-1', exerciseId: 'seated-leg-press', setNumber: 1, side: 'both', load: 90, loadUnit: 'lb', reps: 12, rpe: 7, painDuring: 2, stopped: false, loggedAt: '2026-11-03T11:10:00.000Z' },
  { id: '2026-11-03-p1-a:p1a-2:right:1', workoutId: '2026-11-03-p1-a', slotId: 'p1a-2', exerciseId: 'step-up', setNumber: 1, side: 'right', load: 10, loadUnit: 'lb', reps: 10, painDuring: 1, stopped: false, heightIn: 6, loggedAt: '2026-11-03T11:20:00.000Z' },
]
const morningChecks = [{ id: 'mc-2026-11-04', date: '2026-11-04', appliesTo: { kind: 'workout', id: '2026-11-03-p1-a' }, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [] }]
const runs = [{ id: 'run-2026-11-02', date: '2026-11-02', type: 'mbr', miles: 3, minutes: 33, effort: 'easy', maxPain: 1, strides: false, tempo: false }]
const gateTests = [{ id: 'gt-1', date: '2026-11-06', gate: 1, item: 'single-leg-squat', valueInjured: 1, valueOther: 1, pass: true, manual: true }]
const sessionMoves = [{ id: 'move-1', week: 1, dayA: 'fri', dayB: 'sun' }]
const v2Rows = { settings: [settings], workouts, setLogs, morningChecks, runs, gateTests, sessionMoves }

async function writeVersionTwo(): Promise<void> {
  const old = new Dexie('knee-rebuild')
  old.version(1).stores({})
  old.version(2).stores(V2)
  await old.open()
  await old.transaction('rw', old.tables, async () => {
    for (const [name, rows] of Object.entries(v2Rows)) await old.table(name).bulkPut(rows)
  })
  old.close()
}

async function rawRows(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const name of Object.keys(v2Rows)) out[name] = await db.table(name).toArray()
  return out
}

// Opened by today's app, it goes through version 3 to version 4 (src/db/db.v4.test.ts opens a version 3 one).
describe('a week-1 version 2 database opened at version 3 and on', () => {
  it('keeps every row exactly, adds an empty locations table, then gets the home gym at launch', async () => {
    await writeVersionTwo()

    await db.open()
    expect(db.verno).toBe(7)
    expect(db.tables.map((t) => t.name).sort()).toEqual([...Object.keys(v2Rows), 'locations', 'programOverrides', 'addedSlots', 'hrSettings'].sort())
    expect(await db.programOverrides.count()).toBe(0)
    const sorted = (rows: unknown[]) => [...rows].sort((a, b) => String((a as { id: string }).id).localeCompare(String((b as { id: string }).id)))
    const before = await rawRows()
    for (const [name, rows] of Object.entries(v2Rows)) expect(sorted(before[name] ?? []), name).toEqual(sorted(rows))
    expect(await db.locations.count()).toBe(0)

    // The stored row reads with the M4b defaults, and nothing was rewritten to get them.
    expect(await getSettings()).toMatchObject({ dumbbellMax: 75, activeLocationId: PLANET_FITNESS_LOCATION_ID, kit: ['ankle-strap', 'mini-band'] })
    expect(await db.settings.get('settings')).toEqual(settings)

    const home = await ensureLocations(program, '2026-11-10')
    expect(home).toEqual(homeLocation(75, program.planetFitness, '2026-11-10', program.equipmentListVersion))
    expect(await db.locations.toArray()).toEqual([home])
    // Seeding the home gym touched nothing else.
    expect(await rawRows()).toEqual(before)
    const history = await loadHistory()
    expect(history.workouts.map((w) => w.locationId)).toEqual([undefined, undefined])
  })

  it('a second launch leaves the home gym as it is', async () => {
    await db.locations.update(PLANET_FITNESS_LOCATION_ID, { dumbbellMaxLb: 50 })
    const again = await ensureLocations(program, '2026-11-20')
    expect(again).toMatchObject({ dumbbellMaxLb: 50, createdOn: '2026-11-10' })
    expect(await db.locations.count()).toBe(1)
  })
})

describe('resetAll', () => {
  it('clears every table, locations included, and seeds the defaults and the home gym through the launch path', async () => {
    await db.locations.put({ ...homeLocation(25, [], '2026-11-12', 1), id: 'loc-1', name: 'Marriott Downtown', startedFrom: 'empty' })
    const defaults = defaultSettings(program)
    await resetAll(defaults, program, '2026-11-21')
    expect(await getSettings()).toEqual(defaults)
    expect(await db.locations.toArray()).toEqual([homeLocation(defaults.dumbbellMax, program.planetFitness, '2026-11-21', program.equipmentListVersion)])
    const history = await loadHistory()
    expect(Object.values(history).every((rows) => rows.length === 0)).toBe(true)
  })

  it('erases nothing when the home gym it would seed fails its parse, after the tables were cleared', async () => {
    await db.workouts.put({ id: 'w', date: '2026-11-23', templateId: 'p1-a', phase: 1, week: 4, isDeload: true, status: 'finished' })
    await expect(resetAll(defaultSettings(program), { planetFitness: ['Not an id'], equipmentListVersion: 1 }, '2026-11-23')).rejects.toThrow()
    expect(await db.workouts.count()).toBe(1)
    expect(await db.locations.count()).toBe(1)
  })
})
