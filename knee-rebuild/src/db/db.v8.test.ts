import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { program } from '../program/program.ts'
import type { AclRsiEntry, KoosEntry } from '../schema/index.ts'
import { db } from './db.ts'
import { homeLocation } from './migrations.ts'
import { deleteAclRsiEntry, deleteKoosEntry, ensureLocations, getAclRsiEntries, getKoosEntries, saveAclRsiEntry, saveKoosEntry } from './repo.ts'

/*
 * Dexie version 9 (Batch A): purely additive. A phone on version 8 opens at version 9 with
 * every row as it was and empty koosEntries and aclRsiEntries tables: no questionnaire entry is
 * invented, ever — an entry exists only when Shawn fills the form in. Both tables are keyed by
 * date, so saving again the same day replaces that day's entry. The rollback half re-proves
 * PROGRAM-QUESTIONS 149 and 150 for version 9 and extends what 153 records: a version 8
 * declaration opens the version 9 database with its own schema (no questionnaire tables), so
 * the rolled-back build's settings reads, export and import keep working, and stale
 * questionnaire entries wait to resurface under version 9 (PROGRAM-QUESTIONS 159).
 */

// Version 8 exactly as shipped (src/db/db.ts): opened here with plain Dexie, as the phone has it.
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
  { id: 'run-2026-11-02', date: '2026-11-02', type: 'mbr', miles: 3, minutes: 30, effort: 'easy', rpe: 3, avgHr: 150, maxHr: 171, maxPain: 1, strides: false, tempo: false },
]
const v8Rows = {
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
  // A reading as version 8 wrote it (metrics phase 3).
  vo2Readings: [{ date: '2026-11-07', vo2: 44 }],
}

function declareVersionEight(name = 'knee-rebuild'): Dexie {
  const old = new Dexie(name)
  old.version(1).stores({})
  old.version(2).stores(V2)
  old.version(3).stores({ locations: 'id' })
  old.version(4).stores({ programOverrides: 'slotId' })
  old.version(5).stores({ addedSlots: 'id, templateId' })
  old.version(6).stores({})
  old.version(7).stores({ hrSettings: 'id' })
  old.version(8).stores({ vo2Readings: 'date' })
  return old
}

async function writeVersionEight(): Promise<void> {
  const old = declareVersionEight()
  await old.open()
  await old.transaction('rw', old.tables, async () => {
    for (const [name, rows] of Object.entries(v8Rows)) await old.table(name).bulkPut(rows)
  })
  old.close()
}

const keyOf = (row: unknown) => String((row as { id?: string; slotId?: string; date?: string }).id ?? (row as { slotId?: string }).slotId ?? (row as { date?: string }).date)
const sorted = (rows: readonly unknown[]) => [...rows].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))

async function rawRows(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const name of Object.keys(v8Rows)) out[name] = sorted(await db.table(name).toArray())
  return out
}

const koos = (date: string, over: Partial<KoosEntry> = {}): KoosEntry => ({ date, p1: 1, sy1: 0, a1: 2, sp1: 3, q1: 1, ...over })
const ACL_FIELDS = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8', 'i9', 'i10', 'i11', 'i12'] as const
const acl = (date: string, value: number): AclRsiEntry => ({ date, ...(Object.fromEntries(ACL_FIELDS.map((f) => [f, value])) as Omit<AclRsiEntry, 'date'>) })

describe('a version 8 database opened at version 9', () => {
  it('keeps every row exactly, adds only the empty questionnaire tables keyed by date, and invents no entry', async () => {
    await writeVersionEight()

    await db.open()
    expect(db.verno).toBe(11)
    expect(db.tables.map((t) => t.name).sort()).toEqual([...Object.keys(v8Rows), 'koosEntries', 'aclRsiEntries', 'downPeriods'].sort())
    expect(db.koosEntries.schema.primKey.keyPath).toBe('date')
    expect(db.aclRsiEntries.schema.primKey.keyPath).toBe('date')
    expect(await db.koosEntries.count()).toBe(0)
    expect(await db.aclRsiEntries.count()).toBe(0)
    const before = await rawRows()
    for (const [name, rows] of Object.entries(v8Rows)) expect(before[name], name).toEqual(sorted(rows))
    expect(await getKoosEntries()).toEqual([])
    expect(await getAclRsiEntries()).toEqual([])

    // A launch writes nothing new.
    await ensureLocations(program, '2026-11-08')
    expect(await rawRows()).toEqual(before)
    expect(await db.koosEntries.count()).toBe(0)
    expect(await db.aclRsiEntries.count()).toBe(0)
  })

  it('stores a KOOS entry only when it is saved; saving again the same day replaces, and an entry can be deleted', async () => {
    await saveKoosEntry(koos('2026-11-08'))
    expect(await getKoosEntries()).toEqual([koos('2026-11-08')])

    // The date is the primary key, so a same-day save replaces that day's entry: the replace semantics' home test.
    await saveKoosEntry(koos('2026-11-08', { p1: 3, sp2: 2 }))
    expect(await db.koosEntries.count()).toBe(1)
    expect(await getKoosEntries()).toEqual([koos('2026-11-08', { p1: 3, sp2: 2 })])

    await saveKoosEntry(koos('2026-12-06'))
    expect(await db.koosEntries.count()).toBe(2)

    await deleteKoosEntry('2026-11-08')
    expect((await getKoosEntries()).map((e) => e.date)).toEqual(['2026-12-06'])
    await deleteKoosEntry('2026-12-06')
    expect(await getKoosEntries()).toEqual([])
  })

  it('stores an ACL-RSI entry only when it is saved; saving again the same day replaces, and an entry can be deleted', async () => {
    await saveAclRsiEntry(acl('2026-11-08', 7))
    expect(await getAclRsiEntries()).toEqual([acl('2026-11-08', 7)])

    await saveAclRsiEntry(acl('2026-11-08', 8))
    expect(await db.aclRsiEntries.count()).toBe(1)
    expect(await getAclRsiEntries()).toEqual([acl('2026-11-08', 8)])

    await saveAclRsiEntry(acl('2026-11-15', 9))
    expect(await db.aclRsiEntries.count()).toBe(2)

    await deleteAclRsiEntry('2026-11-08')
    expect((await getAclRsiEntries()).map((e) => e.date)).toEqual(['2026-11-15'])
    await deleteAclRsiEntry('2026-11-15')
    expect(await getAclRsiEntries()).toEqual([])
  })

  it('rolls back: a version 8 declaration opens the version 9 database with its own schema, the settings and readings untouched', async () => {
    await saveKoosEntry(koos('2026-11-08'))
    await saveAclRsiEntry(acl('2026-11-08', 7))
    db.close()
    const old = declareVersionEight()
    await old.open()
    // Dexie 4.4.7 keeps the DECLARED schema on its VersionError retry (PROGRAM-QUESTIONS 149, 150, 153, 159):
    // the rolled-back build sees no questionnaire tables, so its backup's checkCovered passes and its reset
    // or import loops only its own tables, leaving the stale entries to resurface under version 9.
    // If a Dexie upgrade ever adopts the installed schema instead, this is the tripwire.
    expect(old.tables.map((t) => t.name)).not.toContain('koosEntries')
    expect(old.tables.map((t) => t.name)).not.toContain('aclRsiEntries')
    expect(old.tables.map((t) => t.name)).toContain('vo2Readings')
    expect(await old.table('settings').get('settings')).toEqual(settings)
    expect(await old.table('vo2Readings').get('2026-11-07')).toEqual({ date: '2026-11-07', vo2: 44 })
    old.close()
  })
})
