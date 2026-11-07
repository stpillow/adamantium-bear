import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { program } from '../program/program.ts'
import { ProgramOverride } from '../schema/index.ts'
import { db } from './db.ts'
import { homeLocation } from './migrations.ts'
import { ensureLocations, getLocations, getSettings, loadHistory } from './repo.ts'

/*
 * Dexie version 4 (M6): purely additive, as version 3 was. A phone that ran weeks 1 and 2 on
 * version 3, gyms and all, opens at version 4 with every row as it was and an empty
 * programOverrides table, keyed by slot id. Nothing is written at launch for it: no edit is
 * program.md's own.
 */

// Version 3 exactly as shipped in M4b (src/db/db.ts): opened here with plain Dexie, as the phone has it.
const V2 = {
  settings: 'id',
  workouts: 'id, date, status, templateId',
  setLogs: 'id, workoutId, exerciseId, [workoutId+slotId]',
  morningChecks: 'id, date',
  runs: 'id, date',
  gateTests: 'id, date, [gate+item]',
  sessionMoves: 'id, week',
}
const V3 = { locations: 'id' }

// Weeks 1 and 2 as version 3 stored them: every M4b field in use (a hotel gym, a rack-capped set, a rower swap there, the bag).
const settings = {
  id: 'settings', injuredSide: 'right', startDate: '2026-11-02', dumbbellMax: 75, restTimerSeconds: 60, painPerSet: false, currentPhase: 1, phaseEnteredWeek: 1,
  redFlag: { active: false, items: [] }, activeLocationId: 'loc-1', kit: ['ankle-strap', 'mini-band'],
}
const home = homeLocation(75, program.planetFitness, '2026-11-02', program.equipmentListVersion)
const hotel = {
  ...homeLocation(25, [], '2026-11-09', program.equipmentListVersion),
  id: 'loc-1', name: 'Marriott Downtown', present: ['flat-bench'], startedFrom: 'empty',
  extras: [{ id: 'x-1', text: 'kettlebells to 35', addedOn: '2026-11-10' }], markedOff: [{ id: 'flat-bench', on: '2026-11-12' }],
}
const workouts = [
  { id: '2026-11-03-p1-a', date: '2026-11-03', templateId: 'p1-a', phase: 1, week: 1, isDeload: false, startedAt: '2026-11-03T11:00:00.000Z', finishedAt: '2026-11-03T12:00:00.000Z', maxPainDuring: 2, status: 'finished' },
  { id: '2026-11-10-p1-a', date: '2026-11-10', templateId: 'p1-a', phase: 1, week: 2, isDeload: false, startedAt: '2026-11-10T11:00:00.000Z', status: 'in-progress', locationId: 'loc-1' },
]
const setLogs = [
  { id: '2026-11-03-p1-a:p1a-3:both:1', workoutId: '2026-11-03-p1-a', slotId: 'p1a-3', exerciseId: 'db-bench-press', setNumber: 1, side: 'both', load: 50, loadUnit: 'lb', reps: 10, rpe: 8, painDuring: 0, stopped: false, loggedAt: '2026-11-03T11:30:00.000Z' },
  { id: '2026-11-10-p1-a:p1a-3:both:1', workoutId: '2026-11-10-p1-a', slotId: 'p1a-3', exerciseId: 'db-bench-press', setNumber: 1, side: 'both', load: 25, loadUnit: 'lb', reps: 10, rpe: 6, painDuring: 0, stopped: false, rackCapped: true, loggedAt: '2026-11-10T11:30:00.000Z' },
]
const morningChecks = [{ id: 'mc-2026-11-04', date: '2026-11-04', appliesTo: { kind: 'workout', id: '2026-11-03-p1-a' }, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [] }]
const runs = [{ id: 'run-2026-11-11', date: '2026-11-11', type: 'rower-swap', miles: 0, minutes: 35, effort: 'easy', maxPain: 1, strides: false, tempo: false, locationId: 'loc-1' }]
const gateTests = [{ id: 'gt-1', date: '2026-11-13', gate: 1, item: 'hop-single', valueInjured: 56, valueOther: 62, trialsInjured: [50, 56, 54], trialsOther: [60, 62, 61], pass: true, manual: false }]
const sessionMoves = [{ id: 'move-1', week: 2, dayA: 'fri', dayB: 'sun' }]
const v3Rows = { settings: [settings], workouts, setLogs, morningChecks, runs, gateTests, sessionMoves, locations: [home, hotel] }

async function writeVersionThree(): Promise<void> {
  const old = new Dexie('knee-rebuild')
  old.version(1).stores({})
  old.version(2).stores(V2)
  old.version(3).stores(V3)
  await old.open()
  await old.transaction('rw', old.tables, async () => {
    for (const [name, rows] of Object.entries(v3Rows)) await old.table(name).bulkPut(rows)
  })
  old.close()
}

const byId = (rows: unknown[]) => [...rows].sort((a, b) => String((a as { id: string }).id).localeCompare(String((b as { id: string }).id)))

async function rawRows(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const name of Object.keys(v3Rows)) out[name] = byId(await db.table(name).toArray())
  return out
}

describe('a version 3 database opened at version 4', () => {
  it('keeps every row exactly and adds an empty programOverrides table keyed by slot id', async () => {
    await writeVersionThree()

    await db.open()
    expect(db.verno).toBe(7)
    expect(db.tables.map((t) => t.name).sort()).toEqual([...Object.keys(v3Rows), 'programOverrides', 'addedSlots', 'hrSettings'].sort())
    expect(db.programOverrides.schema.primKey.keyPath).toBe('slotId')
    const before = await rawRows()
    for (const [name, rows] of Object.entries(v3Rows)) expect(before[name], name).toEqual(byId(rows))
    expect(await db.programOverrides.count()).toBe(0)

    // The rows read as before: the hotel is active, the gyms are both there, the history is whole.
    expect(await getSettings()).toMatchObject({ activeLocationId: 'loc-1', kit: ['ankle-strap', 'mini-band'] })
    expect((await getLocations()).map((l) => l.id)).toEqual(['planet-fitness', 'loc-1'])
    const history = await loadHistory()
    expect(history.workouts.map((w) => w.locationId)).toEqual([undefined, 'loc-1'])
    expect(history.setLogs.map((s) => s.rackCapped)).toEqual([undefined, true])

    // A launch writes nothing new: the home gym is there already.
    await ensureLocations(program, '2026-11-16')
    expect(await rawRows()).toEqual(before)
    expect(await db.programOverrides.count()).toBe(0)
  })

  it('holds one row per slot: a second edit of the same slot replaces the first, other slots are their own rows', async () => {
    const first = ProgramOverride.parse({ slotId: 'p1a-1', cues: ['Feet high'], editedOn: '2026-11-16' })
    const second = ProgramOverride.parse({ slotId: 'p1a-1', substitutionIds: ['smith-box-squat', 'leg-press-45'], editedOn: '2026-11-17' })
    const other = ProgramOverride.parse({ slotId: 'p1b-1', cues: [], editedOn: '2026-11-17' })
    await db.programOverrides.put(first)
    await db.programOverrides.put(second)
    await db.programOverrides.put(other)
    expect(await db.programOverrides.get('p1a-1')).toEqual(second)
    expect(await db.programOverrides.count()).toBe(2)
    // The version 3 tables are untouched by it.
    expect(await db.workouts.count()).toBe(2)
  })
})
