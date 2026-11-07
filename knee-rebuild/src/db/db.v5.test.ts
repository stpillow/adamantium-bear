import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { program } from '../program/program.ts'
import { db } from './db.ts'
import { homeLocation } from './migrations.ts'
import { addRun, ensureLocations, loadHistory, reopenWorkout, updateWorkout } from './repo.ts'

/*
 * Dexie version 6 (metrics phase 1): no table and no index, only a version bump that keeps the
 * backup's schema version in step. A phone on version 5 opens at version 6 with every row as it
 * was: no run gains an RPE, no session an RPE or minutes. The new fields are written only by the
 * run logger, Finish, End and the Summary.
 */

// Version 5 exactly as shipped (src/db/db.ts): opened here with plain Dexie, as the phone has it.
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
  { id: '2026-11-03-p1-a', date: '2026-11-03', templateId: 'p1-a', phase: 1, week: 1, isDeload: false, startedAt: '2026-11-03T11:00:00.000Z', finishedAt: '2026-11-03T12:00:00.000Z', maxPainDuring: 2, status: 'finished' },
  { id: '2026-11-05-p1-b', date: '2026-11-05', templateId: 'p1-b', phase: 1, week: 1, isDeload: false, startedAt: '2026-11-05T11:00:00.000Z', finishedAt: '2026-11-05T11:20:00.000Z', status: 'abandoned' },
]
const setLogs = [
  { id: '2026-11-03-p1-a:p1a-3:both:1', workoutId: '2026-11-03-p1-a', slotId: 'p1a-3', exerciseId: 'db-bench-press', setNumber: 1, side: 'both', load: 50, loadUnit: 'lb', reps: 10, rpe: 8, painDuring: 0, stopped: false, loggedAt: '2026-11-03T11:30:00.000Z' },
]
const runs = [
  { id: 'run-2026-11-02', date: '2026-11-02', type: 'mbr', miles: 3, minutes: 30, effort: 'easy', maxPain: 1, strides: false, tempo: false },
  { id: 'run-2026-11-04', date: '2026-11-04', type: 'easy', miles: 3, minutes: 31, effort: 'hard', maxPain: 1, strides: true, tempo: false },
]
const v5Rows = {
  settings: [settings],
  workouts,
  setLogs,
  morningChecks: [],
  runs,
  gateTests: [],
  sessionMoves: [],
  locations: [homeLocation(75, program.planetFitness, '2026-11-02', program.equipmentListVersion)],
  programOverrides: [{ slotId: 'p1a-1', cues: ['Feet high'], editedOn: '2026-11-04' }],
  addedSlots: [{ id: 'added-k1', templateId: 'p1-a', exerciseId: 'db-bench-press', sets: 3, repsMin: 8, repsMax: 10, addedOn: '2026-11-04' }],
}

async function writeVersionFive(): Promise<void> {
  const old = new Dexie('knee-rebuild')
  old.version(1).stores({})
  old.version(2).stores(V2)
  old.version(3).stores({ locations: 'id' })
  old.version(4).stores({ programOverrides: 'slotId' })
  old.version(5).stores({ addedSlots: 'id, templateId' })
  await old.open()
  await old.transaction('rw', old.tables, async () => {
    for (const [name, rows] of Object.entries(v5Rows)) await old.table(name).bulkPut(rows)
  })
  old.close()
}

const keyOf = (row: unknown) => String((row as { id?: string; slotId?: string }).id ?? (row as { slotId?: string }).slotId)
const sorted = (rows: readonly unknown[]) => [...rows].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))

async function rawRows(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const name of Object.keys(v5Rows)) out[name] = sorted(await db.table(name).toArray())
  return out
}

describe('a version 5 database opened at version 6', () => {
  it('keeps every row exactly, adds no table, and invents no RPE or minutes', async () => {
    await writeVersionFive()

    await db.open()
    expect(db.verno).toBe(7)
    expect(db.tables.map((t) => t.name).sort()).toEqual([...Object.keys(v5Rows), 'hrSettings'].sort())
    const before = await rawRows()
    for (const [name, rows] of Object.entries(v5Rows)) expect(before[name], name).toEqual(sorted(rows))

    const history = await loadHistory()
    expect(history.runs.map((r) => [r.effort, r.rpe])).toEqual([
      ['easy', undefined],
      ['hard', undefined],
    ])
    expect(history.workouts.map((w) => [w.sessionRpe, w.durationMinutes])).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ])

    // A launch writes nothing new.
    await ensureLocations(program, '2026-11-06')
    expect(await rawRows()).toEqual(before)
  })

  it('stores the new fields when they are written, and reopen clears a session’s RPE and minutes with its finish', async () => {
    await addRun({ id: 'run-2026-11-06', date: '2026-11-06', type: 'easy', miles: 3, minutes: 30, effort: 'moderate', rpe: 5, maxPain: 1, strides: false, tempo: false })
    expect((await db.runs.get('run-2026-11-06'))?.rpe).toBe(5)

    await updateWorkout('2026-11-05-p1-b', { sessionRpe: 6, durationMinutes: 20 })
    expect(await db.workouts.get('2026-11-05-p1-b')).toMatchObject({ sessionRpe: 6, durationMinutes: 20, status: 'abandoned' })

    await reopenWorkout('2026-11-05-p1-b')
    const reopened = await db.workouts.get('2026-11-05-p1-b')
    expect(reopened).toMatchObject({ status: 'in-progress', startedAt: '2026-11-05T11:00:00.000Z' })
    for (const key of ['finishedAt', 'maxPainDuring', 'sessionRpe', 'durationMinutes']) expect(reopened && key in reopened, key).toBe(false)
  })
})
