import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { program } from '../program/program.ts'
import type { MorningCheck } from '../schema/index.ts'
import { db } from './db.ts'
import { homeLocation } from './migrations.ts'
import { addLateMorningCheck, addMorningCheck, ensureLocations } from './repo.ts'

/*
 * Dexie version 10 (Batch D): fields only, no store change. A morning check may carry the fixed
 * tags and, for a past morning, the day it was saved, both optional and unindexed. A phone on
 * version 9 opens at version 10 with every row as it was: no tag and no late mark is invented. A
 * check for a past morning is only ever added, never written over, and is refused by date when
 * one is already saved for that morning (PROGRAM-QUESTIONS 174, 179).
 *
 * The rollback half re-proves PROGRAM-QUESTIONS 149 for version 10: a version 9 declaration opens
 * the version 10 database with its own schema (the same tables) and reads the tagged, late row raw
 * with both fields intact. The accepted hazards, the 149 class (PROGRAM-QUESTIONS 179):
 * - version 9's export names a tagged or late check unreadable (its strict schema refuses the keys),
 *   and version 9 refuses a schema 10 backup file;
 * - a version 9 same-morning re-save of today's check drops its tags;
 * - version 9 reads a late check as an ordinary one: its reading is the same, and since the takeover
 *   is only ever computed at save, nothing changes on Today; but version 9 shows no note for a red
 *   flag on a late check, so Today and Week lose it and only the reading's "red flag ticked" reason
 *   remains;
 * - nothing is added to the settings row (PROGRAM-QUESTIONS 132).
 */

// Version 9 exactly as shipped (src/db/db.ts): opened here with plain Dexie, as the phone has it.
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
  { id: 'run-2026-11-05', date: '2026-11-05', type: 'easy', miles: 3, minutes: 30, effort: 'easy', rpe: 3, maxPain: 1, strides: false, tempo: false },
  { id: 'run-2026-11-06', date: '2026-11-06', type: 'long', miles: 4, minutes: 44, effort: 'easy', rpe: 4, maxPain: 1, strides: false, tempo: false },
]
const onTime = { id: 'mc-2026-11-04', date: '2026-11-04', appliesTo: { kind: 'workout', id: '2026-11-03-p1-a' }, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [] }
// An imported row under another id, as the seed data has: a late check for its morning is refused by date.
const imported = { ...onTime, id: 'mc-2026-11-06-run', date: '2026-11-06', appliesTo: { kind: 'run', id: 'run-2026-11-05' } }
const v9Rows = {
  settings: [settings],
  workouts,
  setLogs: [],
  morningChecks: [onTime, imported],
  runs,
  gateTests: [],
  sessionMoves: [],
  locations: [homeLocation(75, program.planetFitness, '2026-11-02', program.equipmentListVersion)],
  programOverrides: [],
  addedSlots: [],
  hrSettings: [{ id: 'heart-rate', maxHr: 190, restingHr: 50 }],
  vo2Readings: [{ date: '2026-11-07', vo2: 44 }],
  // Entries as version 9 wrote them (Batch A).
  koosEntries: [{ date: '2026-11-08', p1: 1, sy1: 0 }],
  aclRsiEntries: [{ date: '2026-11-08', i1: 7, i2: 7, i3: 7, i4: 7, i5: 7, i6: 7, i7: 7, i8: 7, i9: 7, i10: 7, i11: 7, i12: 7 }],
}

function declareVersionNine(name = 'knee-rebuild'): Dexie {
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
  return old
}

async function writeVersionNine(): Promise<void> {
  const old = declareVersionNine()
  await old.open()
  await old.transaction('rw', old.tables, async () => {
    for (const [name, rows] of Object.entries(v9Rows)) await old.table(name).bulkPut(rows)
  })
  old.close()
}

const keyOf = (row: unknown) => String((row as { id?: string; slotId?: string; date?: string }).id ?? (row as { slotId?: string }).slotId ?? (row as { date?: string }).date)
const sorted = (rows: readonly unknown[]) => [...rows].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))

async function rawRows(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const name of Object.keys(v9Rows)) out[name] = sorted(await db.table(name).toArray())
  return out
}

const late: MorningCheck = {
  id: 'mc-2026-11-07',
  date: '2026-11-07',
  appliesTo: { kind: 'run', id: 'run-2026-11-06' },
  stiffnessUnder30Min: true,
  worseThanYesterday: false,
  visibleSwelling: false,
  warmth: false,
  painChangePoints: 0,
  redFlags: ['locking'],
  tags: ['poor-sleep', 'brace'],
  loggedOn: '2026-11-09',
}

describe('a version 9 database opened at version 10', () => {
  it('keeps every row exactly, adds no table, and invents no tag or late mark', async () => {
    await writeVersionNine()

    await db.open()
    expect(db.verno).toBe(10)
    expect(db.tables.map((t) => t.name).sort()).toEqual(Object.keys(v9Rows).sort())
    const before = await rawRows()
    for (const [name, rows] of Object.entries(v9Rows)) expect(before[name], name).toEqual(sorted(rows))
    for (const row of await db.morningChecks.toArray()) {
      expect('tags' in row).toBe(false)
      expect('loggedOn' in row).toBe(false)
    }

    // A launch writes nothing new.
    await ensureLocations(program, '2026-11-09')
    expect(await rawRows()).toEqual(before)
  })

  it('adds a tagged late check, never writes over one, and refuses a second check for a morning by date', async () => {
    await addLateMorningCheck(late)
    expect(await db.morningChecks.get('mc-2026-11-07')).toEqual(late)

    const again = { ...late, redFlags: [], tags: undefined }
    await expect(addLateMorningCheck(again)).rejects.toThrow('a morning check for 2026-11-07 is already saved; it stays as it is')
    expect(await db.morningChecks.get('mc-2026-11-07')).toEqual(late)

    // The imported row's morning: refused by its date, though the id mc-2026-11-06 is free.
    const forImported = { ...late, id: 'mc-2026-11-06', date: '2026-11-06', appliesTo: null, redFlags: [], loggedOn: '2026-11-09' }
    await expect(addLateMorningCheck(forImported)).rejects.toThrow('already saved')
    expect(await db.morningChecks.get('mc-2026-11-06')).toBeUndefined()
    expect(await db.morningChecks.get('mc-2026-11-06-run')).toEqual(imported)

    // A row the schema refuses writes nothing.
    await expect(addLateMorningCheck({ ...late, id: 'mc-2026-11-08', date: '2026-11-08', loggedOn: '2026-11-08' })).rejects.toThrow()
    expect(await db.morningChecks.get('mc-2026-11-08')).toBeUndefined()

    // This morning's check still replaces by id, as it always has.
    await addMorningCheck({ ...onTime, id: 'mc-2026-11-09', date: '2026-11-09', appliesTo: null, tags: ['nsaid'] })
    await addMorningCheck({ ...onTime, id: 'mc-2026-11-09', date: '2026-11-09', appliesTo: null, worseThanYesterday: true })
    expect(await db.morningChecks.get('mc-2026-11-09')).toEqual({ ...onTime, id: 'mc-2026-11-09', date: '2026-11-09', appliesTo: null, worseThanYesterday: true })
  })

  it('rolls back: a version 9 declaration opens the version 10 database with its own tables and reads the tagged late row raw', async () => {
    db.close()
    const old = declareVersionNine()
    await old.open()
    // Dexie 4.4.7 keeps the DECLARED schema on its VersionError retry (PROGRAM-QUESTIONS 149): the
    // same tables as version 10, since version 10 added none. If a Dexie upgrade ever changes that, this is the tripwire.
    expect(old.tables.map((t) => t.name).sort()).toEqual(Object.keys(v9Rows).sort())
    expect(await old.table('settings').get('settings')).toEqual(settings)
    // Reads don't parse: the row comes back with both new fields intact.
    expect(await old.table('morningChecks').get('mc-2026-11-07')).toEqual(late)
    old.close()
  })
})
