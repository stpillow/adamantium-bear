import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { program } from '../program/program.ts'
import { db } from './db.ts'
import { homeLocation } from './migrations.ts'
import { deleteVo2Reading, ensureLocations, getVo2Readings, saveVo2Reading } from './repo.ts'

/*
 * Dexie version 8 (metrics phase 3): purely additive. A phone on version 7 opens at version 8 with
 * every row as it was and an empty vo2Readings table: no reading is invented, ever — a reading
 * exists only when Shawn types the watch's number. The table is keyed by date, so typing again the
 * same day replaces that day's reading. The rollback half re-proves PROGRAM-QUESTIONS 149 and 150
 * for version 8 and pins what 153 records: a version 7 declaration opens the version 8 database
 * with its own schema (no vo2Readings table), so the rolled-back build's settings reads, export and
 * import keep working, and a stale reading waits to resurface under version 8. Version 9's own
 * rollback is re-proved in src/db/db.v8.test.ts.
 */

// Version 7 exactly as shipped (src/db/db.ts): opened here with plain Dexie, as the phone has it.
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
// Runs as version 7 wrote them: carrying their heart-rate numbers (metrics phase 2).
const runs = [
  { id: 'run-2026-11-02', date: '2026-11-02', type: 'mbr', miles: 3, minutes: 30, effort: 'easy', rpe: 3, avgHr: 150, maxHr: 171, maxPain: 1, strides: false, tempo: false },
  { id: 'run-2026-11-04', date: '2026-11-04', type: 'easy', miles: 3, minutes: 31, effort: 'hard', maxPain: 1, strides: true, tempo: false },
]
const v7Rows = {
  settings: [settings],
  workouts,
  setLogs: [],
  morningChecks: [],
  runs,
  gateTests: [],
  sessionMoves: [],
  locations: [homeLocation(75, program.planetFitness, '2026-11-02', program.equipmentListVersion)],
  programOverrides: [],
  addedSlots: [],
  hrSettings: [{ id: 'heart-rate', maxHr: 190, restingHr: 50 }],
}

function declareVersionSeven(name = 'knee-rebuild'): Dexie {
  const old = new Dexie(name)
  old.version(1).stores({})
  old.version(2).stores(V2)
  old.version(3).stores({ locations: 'id' })
  old.version(4).stores({ programOverrides: 'slotId' })
  old.version(5).stores({ addedSlots: 'id, templateId' })
  old.version(6).stores({})
  old.version(7).stores({ hrSettings: 'id' })
  return old
}

async function writeVersionSeven(): Promise<void> {
  const old = declareVersionSeven()
  await old.open()
  await old.transaction('rw', old.tables, async () => {
    for (const [name, rows] of Object.entries(v7Rows)) await old.table(name).bulkPut(rows)
  })
  old.close()
}

const keyOf = (row: unknown) => String((row as { id?: string; slotId?: string; date?: string }).id ?? (row as { slotId?: string }).slotId ?? (row as { date?: string }).date)
const sorted = (rows: readonly unknown[]) => [...rows].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))

async function rawRows(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const name of Object.keys(v7Rows)) out[name] = sorted(await db.table(name).toArray())
  return out
}

describe('a version 7 database opened at version 8', () => {
  it('keeps every row exactly, adds only the empty vo2Readings table keyed by date, and invents no reading', async () => {
    await writeVersionSeven()

    await db.open()
    expect(db.verno).toBe(11)
    expect(db.tables.map((t) => t.name).sort()).toEqual([...Object.keys(v7Rows), 'vo2Readings', 'koosEntries', 'aclRsiEntries', 'downPeriods'].sort())
    expect(db.vo2Readings.schema.primKey.keyPath).toBe('date')
    expect(await db.vo2Readings.count()).toBe(0)
    const before = await rawRows()
    for (const [name, rows] of Object.entries(v7Rows)) expect(before[name], name).toEqual(sorted(rows))
    expect(await getVo2Readings()).toEqual([])

    // A launch writes nothing new.
    await ensureLocations(program, '2026-11-08')
    expect(await rawRows()).toEqual(before)
    expect(await db.vo2Readings.count()).toBe(0)
  })

  it('stores a reading only when it is typed; typing again the same day replaces, and a reading can be deleted', async () => {
    await saveVo2Reading({ date: '2026-11-07', vo2: 44 })
    expect(await getVo2Readings()).toEqual([{ date: '2026-11-07', vo2: 44 }])

    // The date is the primary key, so a same-day save replaces that day's reading: the replace semantics' home test.
    await saveVo2Reading({ date: '2026-11-07', vo2: 45 })
    expect(await db.vo2Readings.count()).toBe(1)
    expect(await getVo2Readings()).toEqual([{ date: '2026-11-07', vo2: 45 }])

    await saveVo2Reading({ date: '2026-11-08', vo2: 44 })
    expect(await db.vo2Readings.count()).toBe(2)

    await deleteVo2Reading('2026-11-07')
    expect(await getVo2Readings()).toEqual([{ date: '2026-11-08', vo2: 44 }])
    await deleteVo2Reading('2026-11-08')
    expect(await getVo2Readings()).toEqual([])
  })

  it('rolls back: a version 7 declaration opens the version 8 database with its own schema, the settings row untouched', async () => {
    await saveVo2Reading({ date: '2026-11-07', vo2: 44 })
    db.close()
    const old = declareVersionSeven()
    await old.open()
    // Dexie 4.4.7 keeps the DECLARED schema on its VersionError retry (PROGRAM-QUESTIONS 149, 150, 153): the
    // rolled-back build sees no vo2Readings table, so its backup's checkCovered passes and its reset or
    // import loops only its own tables, leaving the stale reading to resurface under version 8.
    // If a Dexie upgrade ever adopts the installed schema instead, this is the tripwire.
    expect(old.tables.map((t) => t.name)).not.toContain('vo2Readings')
    expect(old.tables.map((t) => t.name)).toContain('hrSettings')
    expect(await old.table('settings').get('settings')).toEqual(settings)
    expect(await old.table('hrSettings').get('heart-rate')).toEqual({ id: 'heart-rate', maxHr: 190, restingHr: 50 })
    old.close()
  })
})
