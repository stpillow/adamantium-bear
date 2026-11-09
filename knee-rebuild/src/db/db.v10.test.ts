import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { program } from '../program/program.ts'
import { db } from './db.ts'
import { homeLocation } from './migrations.ts'
import { declareDownPeriod, endDownPeriod, ensureLocations, extendDownPeriod, getDownPeriods, loadHistory, resumeDownPeriod } from './repo.ts'

/*
 * Dexie version 11 (Batch E): one additive store, `downPeriods`, one row per declared down period
 * keyed by its id, with no upgrade callback. A phone on version 10 opens at version 11 with every
 * row as it was and an empty downPeriods table: no period is invented, so nothing pauses. Declaring,
 * extending, ending and keeping one going go through the rule inside one transaction, and each
 * refusal writes nothing (PROGRAM-QUESTIONS 185, 189).
 *
 * The rollback half re-proves PROGRAM-QUESTIONS 149 for version 11: a version 10 declaration opens
 * the version 11 database with its own declared schema, without the downPeriods table. The accepted
 * hazards (PROGRAM-QUESTIONS 189):
 * - a version 10 build ignores an active down period: progression resumes there;
 * - its export carries no periods (and still passes its own table check, since it doesn't know the
 *   table), and it refuses a schema 11 backup file;
 * - its Reset or import clears only the tables it knows, so the downPeriods rows stay in the
 *   database and come back after the re-upgrade, where a standing one pauses again: the safe direction;
 * - nothing is added to the settings row (PROGRAM-QUESTIONS 132).
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

const settings = {
  id: 'settings', injuredSide: 'right', startDate: '2026-11-02', dumbbellMax: 75, restTimerSeconds: 60, painPerSet: false, currentPhase: 1, phaseEnteredWeek: 1,
  redFlag: { active: false, items: [] }, activeLocationId: 'planet-fitness', kit: ['ankle-strap', 'mini-band'],
}
const workouts = [
  { id: '2026-11-03-p1-a', date: '2026-11-03', templateId: 'p1-a', phase: 1, week: 1, isDeload: false, startedAt: '2026-11-03T11:00:00.000Z', finishedAt: '2026-11-03T12:00:00.000Z', maxPainDuring: 2, sessionRpe: 7, durationMinutes: 52, status: 'finished' },
]
const check = { id: 'mc-2026-11-04', date: '2026-11-04', appliesTo: { kind: 'workout', id: '2026-11-03-p1-a' }, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [] }
// Rows as version 10 wrote them (Batch D): a tagged check and a late one.
const v10Rows = {
  settings: [settings],
  workouts,
  setLogs: [],
  morningChecks: [{ ...check, tags: ['poor-sleep'] }, { ...check, id: 'mc-2026-11-06', date: '2026-11-06', appliesTo: null, loggedOn: '2026-11-08' }],
  runs: [{ id: 'run-2026-11-05', date: '2026-11-05', type: 'easy', miles: 3, minutes: 30, effort: 'easy', rpe: 3, maxPain: 1, strides: false, tempo: false }],
  gateTests: [],
  sessionMoves: [],
  locations: [homeLocation(75, program.planetFitness, '2026-11-02', program.equipmentListVersion)],
  programOverrides: [],
  addedSlots: [],
  hrSettings: [{ id: 'heart-rate', maxHr: 190, restingHr: 50 }],
  vo2Readings: [{ date: '2026-11-07', vo2: 44 }],
  koosEntries: [{ date: '2026-11-08', p1: 1, sy1: 0 }],
  aclRsiEntries: [{ date: '2026-11-08', i1: 7, i2: 7, i3: 7, i4: 7, i5: 7, i6: 7, i7: 7, i8: 7, i9: 7, i10: 7, i11: 7, i12: 7 }],
}

function declareVersionTen(name = 'knee-rebuild'): Dexie {
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
  return old
}

async function writeVersionTen(): Promise<void> {
  const old = declareVersionTen()
  await old.open()
  await old.transaction('rw', old.tables, async () => {
    for (const [name, rows] of Object.entries(v10Rows)) await old.table(name).bulkPut(rows)
  })
  old.close()
}

const keyOf = (row: unknown) => String((row as { id?: string; slotId?: string; date?: string }).id ?? (row as { slotId?: string }).slotId ?? (row as { date?: string }).date)
const sorted = (rows: readonly unknown[]) => [...rows].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))

async function rawRows(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const name of [...Object.keys(v10Rows), 'downPeriods']) out[name] = sorted(await db.table(name).toArray())
  return out
}

const AT = '2026-11-14T13:00:00.000Z'

describe('a version 10 database opened at version 11', () => {
  it('keeps every row exactly, adds an empty downPeriods table, and invents no period', async () => {
    await writeVersionTen()

    await db.open()
    expect(db.verno).toBe(11)
    expect(db.tables.map((t) => t.name).sort()).toEqual([...Object.keys(v10Rows), 'downPeriods'].sort())
    const before = await rawRows()
    for (const [name, rows] of Object.entries(v10Rows)) expect(before[name], name).toEqual(sorted(rows))
    expect(before.downPeriods).toEqual([])
    expect((await loadHistory()).downPeriods).toEqual([])

    // A launch writes nothing new.
    await ensureLocations(program, '2026-11-09')
    expect(await rawRows()).toEqual(before)
  })

  it('declares, extends, ends and keeps a period going through the rule, and each refusal writes nothing', async () => {
    const declared = await declareDownPeriod({ today: '2026-11-14', days: 7, declaredAt: AT, note: ' Flu ' })
    expect(declared).toEqual({ id: 'dp-2026-11-14', start: '2026-11-14', plannedEnd: '2026-11-20', declaredAt: AT, note: 'Flu' })
    expect(await getDownPeriods()).toEqual([declared])

    const unchanged = async () => expect(await getDownPeriods()).toEqual([declared])
    // One at a time; 3 to 14 days.
    await expect(declareDownPeriod({ today: '2026-11-16', days: 5, declaredAt: AT })).rejects.toThrow('A down period is already on until Friday Nov 20: make it longer instead.')
    await unchanged()
    await expect(declareDownPeriod({ today: '2026-11-14', days: 2, declaredAt: AT })).rejects.toThrow('A down period runs 3 to 14 days.')
    await unchanged()
    // At most 14 days from its start; never past the cap.
    await expect(extendDownPeriod(declared.id, '2026-11-28', '2026-11-16')).rejects.toThrow('A down period runs at most 14 days')
    await unchanged()
    await expect(extendDownPeriod('dp-nope', '2026-11-22', '2026-11-16')).rejects.toThrow('That down period isn’t stored any more.')
    await unchanged()

    const longer = await extendDownPeriod(declared.id, '2026-11-22', '2026-11-16')
    expect(longer.plannedEnd).toBe('2026-11-22')
    await expect(resumeDownPeriod(declared.id, '2026-11-17')).rejects.toThrow('Only a down period ended today can be kept going.')
    expect(await getDownPeriods()).toEqual([longer])

    const ended = await endDownPeriod(declared.id, '2026-11-17')
    expect(ended).toEqual({ ...longer, endedOn: '2026-11-17' })
    await expect(endDownPeriod(declared.id, '2026-11-17')).rejects.toThrow('It was already ended today.')
    // Ended today still stands today: no new one until tomorrow.
    await expect(declareDownPeriod({ today: '2026-11-17', days: 3, declaredAt: AT })).rejects.toThrow('ended today')
    expect(await getDownPeriods()).toEqual([ended])

    // Keep it going takes the end back, the same day.
    expect(await resumeDownPeriod(declared.id, '2026-11-17')).toEqual(longer)
    await endDownPeriod(declared.id, '2026-11-17')

    // The day after, a new one may start: back to back is allowed.
    const next = await declareDownPeriod({ today: '2026-11-18', days: 3, declaredAt: AT })
    expect((await getDownPeriods()).map((p) => p.id)).toEqual(['dp-2026-11-14', 'dp-2026-11-18'])
    expect(next.plannedEnd).toBe('2026-11-20')
  })

  it('declares with add, never put: a row already stored under the day’s id is never written over', async () => {
    const before = await getDownPeriods()
    // Ended early, so nothing stands on Nov 25; a stray row under the same id (an import) blocks the add.
    await db.downPeriods.put({ id: 'dp-2026-11-25', start: '2026-11-25', plannedEnd: '2026-11-27', endedOn: '2026-11-25', declaredAt: AT })
    await expect(declareDownPeriod({ today: '2026-11-26', days: 3, declaredAt: AT })).resolves.toMatchObject({ id: 'dp-2026-11-26' })
    await db.downPeriods.delete('dp-2026-11-26')
    await db.downPeriods.put({ id: 'dp-2026-11-29', start: '2026-11-25', plannedEnd: '2026-11-27', endedOn: '2026-11-25', declaredAt: AT })
    await expect(declareDownPeriod({ today: '2026-11-29', days: 3, declaredAt: AT })).rejects.toThrow('A down period that starts today is already stored.')
    expect(await db.downPeriods.get('dp-2026-11-29')).toMatchObject({ start: '2026-11-25' })
    await db.downPeriods.bulkDelete(['dp-2026-11-25', 'dp-2026-11-29'])
    expect(await getDownPeriods()).toEqual(before)
  })

  it('rolls back: a version 10 declaration opens the version 11 database without the downPeriods table, its settings row untouched', async () => {
    db.close()
    const old = declareVersionTen()
    await old.open()
    // Dexie 4.4.7 keeps the DECLARED schema on its VersionError retry (PROGRAM-QUESTIONS 149): version
    // 10's tables, so a version 10 build never sees a down period and progression resumes there (the
    // accepted hazard, PROGRAM-QUESTIONS 189). If a Dexie upgrade ever changes that, this is the tripwire.
    expect(old.tables.map((t) => t.name).sort()).toEqual(Object.keys(v10Rows).sort())
    expect(old.tables.map((t) => t.name)).not.toContain('downPeriods')
    expect(await old.table('settings').get('settings')).toEqual(settings)
    // Version 10's Reset clears the tables it knows; the periods stay in the database for the re-upgrade.
    await old.transaction('rw', old.tables, async () => {
      for (const table of old.tables) await table.clear()
    })
    old.close()
    await db.open()
    expect((await getDownPeriods()).map((p) => p.id)).toEqual(['dp-2026-11-14', 'dp-2026-11-18'])
  })
})
