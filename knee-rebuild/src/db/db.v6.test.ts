import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { program } from '../program/program.ts'
import { db } from './db.ts'
import { homeLocation } from './migrations.ts'
import { addRun, ensureLocations, getHrSettings, loadHistory, saveHrSettings } from './repo.ts'

/*
 * Dexie version 7 (metrics phase 2): purely additive. A phone on version 6 opens at version 7 with
 * every row as it was and an empty hrSettings table: no run gains an average or max heart rate, and
 * no heart-rate settings row is invented. The new fields are written only by the run logger, the
 * Strava import and Settings' Heart rate steppers. The rollback half re-proves PROGRAM-QUESTIONS
 * 149 for version 7 and pins what 150 records: a version 6 declaration opens the version 7 database
 * with its own schema (no hrSettings table), so the rolled-back build's settings reads, export and
 * import keep working, and the stale hrSettings row waits to resurface under version 7.
 */

// Version 6 exactly as shipped (src/db/db.ts): opened here with plain Dexie, as the phone has it.
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
const runs = [
  { id: 'run-2026-11-02', date: '2026-11-02', type: 'mbr', miles: 3, minutes: 30, effort: 'easy', rpe: 3, maxPain: 1, strides: false, tempo: false },
  { id: 'run-2026-11-04', date: '2026-11-04', type: 'easy', miles: 3, minutes: 31, effort: 'hard', maxPain: 1, strides: true, tempo: false },
]
const v6Rows = {
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
}

function declareVersionSix(name = 'knee-rebuild'): Dexie {
  const old = new Dexie(name)
  old.version(1).stores({})
  old.version(2).stores(V2)
  old.version(3).stores({ locations: 'id' })
  old.version(4).stores({ programOverrides: 'slotId' })
  old.version(5).stores({ addedSlots: 'id, templateId' })
  old.version(6).stores({})
  return old
}

async function writeVersionSix(): Promise<void> {
  const old = declareVersionSix()
  await old.open()
  await old.transaction('rw', old.tables, async () => {
    for (const [name, rows] of Object.entries(v6Rows)) await old.table(name).bulkPut(rows)
  })
  old.close()
}

const keyOf = (row: unknown) => String((row as { id?: string; slotId?: string }).id ?? (row as { slotId?: string }).slotId)
const sorted = (rows: readonly unknown[]) => [...rows].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))

async function rawRows(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const name of Object.keys(v6Rows)) out[name] = sorted(await db.table(name).toArray())
  return out
}

describe('a version 6 database opened at version 7', () => {
  it('keeps every row exactly, adds only the empty hrSettings table, and invents no heart rate', async () => {
    await writeVersionSix()

    await db.open()
    expect(db.verno).toBe(7)
    expect(db.tables.map((t) => t.name).sort()).toEqual([...Object.keys(v6Rows), 'hrSettings'].sort())
    expect(db.hrSettings.schema.primKey.keyPath).toBe('id')
    expect(await db.hrSettings.count()).toBe(0)
    const before = await rawRows()
    for (const [name, rows] of Object.entries(v6Rows)) expect(before[name], name).toEqual(sorted(rows))

    const history = await loadHistory()
    expect(history.runs.map((r) => [r.avgHr, r.maxHr])).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ])
    expect(await getHrSettings()).toBeUndefined()

    // A launch writes nothing new.
    await ensureLocations(program, '2026-11-08')
    expect(await rawRows()).toEqual(before)
    expect(await db.hrSettings.count()).toBe(0)
  })

  it('stores the new fields only when they are written, one touched number at a time', async () => {
    await addRun({ id: 'run-2026-11-06', date: '2026-11-06', type: 'easy', miles: 3, minutes: 30, effort: 'moderate', rpe: 5, avgHr: 150, maxHr: 171, maxPain: 1, strides: false, tempo: false })
    expect(await db.runs.get('run-2026-11-06')).toMatchObject({ avgHr: 150, maxHr: 171 })

    await saveHrSettings({ id: 'heart-rate', maxHr: 190 })
    expect(await getHrSettings()).toEqual({ id: 'heart-rate', maxHr: 190 })
    await saveHrSettings({ id: 'heart-rate', maxHr: 190, restingHr: 50 })
    expect(await getHrSettings()).toEqual({ id: 'heart-rate', maxHr: 190, restingHr: 50 })
    expect(await db.hrSettings.count()).toBe(1)
  })

  it('rolls back: a version 6 declaration opens the version 7 database with its own schema, the settings row untouched', async () => {
    db.close()
    const old = declareVersionSix()
    await old.open()
    // Dexie 4.4.7 keeps the DECLARED schema on its VersionError retry (PROGRAM-QUESTIONS 149, 150): the
    // rolled-back build sees no hrSettings table, so its backup's checkCovered passes and its reset or
    // import loops only its own tables, leaving the stale hrSettings row to resurface under version 7.
    // If a Dexie upgrade ever adopts the installed schema instead, this is the tripwire.
    expect(old.tables.map((t) => t.name)).not.toContain('hrSettings')
    expect(await old.table('settings').get('settings')).toEqual(settings)
    // Reads don't parse, so a run holding a heart rate still shows on version 6; the accepted hazard
    // stays on version 6's strict write paths, as 149 records for version 5.
    expect(await old.table('runs').get('run-2026-11-06')).toMatchObject({ avgHr: 150, maxHr: 171 })
    old.close()
  })
})
