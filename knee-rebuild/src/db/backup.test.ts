import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { program, templateFor } from '../program/program.ts'
import { BACKUP_SCHEMA_VERSION, BACKUP_TABLES, backupText, parseBackup, type Backup, type BackupTables } from '../rules/backup.ts'
import { addDays, dateOf } from '../rules/calendar.ts'
import { afterMorningCheck, stopMessage } from '../rules/redFlags.ts'
import {
  AddedSlot,
  GateTest,
  HrSettings,
  Location,
  MorningCheck,
  PLANET_FITNESS_LOCATION_ID,
  ProgramOverride,
  Run,
  SessionMove,
  SetLog,
  Settings,
  Workout,
  type Day,
  type SessionLetter,
  type SetSide,
} from '../schema/index.ts'
import { exportBackup, markExported, readStored, replaceAll } from './backup.ts'
import { db } from './db.ts'
import { homeLocation } from './migrations.ts'
import {
  SWAP_KEY_PREFIX,
  addExtra,
  addGateTest,
  addLocation,
  addMorningCheck,
  addRun,
  addSessionMove,
  archiveLocation,
  defaultSettings,
  ensureLocations,
  ensureSettings,
  getProgramOverrides,
  getSettings,
  markOff,
  putWorkout,
  resetAll,
  saveAddedSlot,
  saveHrSettings,
  saveProgramOverride,
  saveSettings,
  setDumbbellMax,
  setId,
  setKit,
  setPresent,
  upsertSet,
} from './repo.ts'

/*
 * The M6 brief's round trip: with fake-indexeddb, a realistic history in every table, every field
 * of M4b's gyms and M5's gates in use; export, Reset all data, import, export again. The two files
 * are the same bytes apart from exportedAt, and every row comes back as it was stored.
 */

const START = program.startDate
const TODAY = '2026-12-20'
const T1 = '2026-12-20T15:42:07.123Z'
const T2 = '2026-12-20T15:44:51.000Z'
const LIFT_DAYS: Record<SessionLetter, Day> = { A: 'tue', B: 'thu', C: 'sat' }
const RUN_DAYS = [
  ['mon', 'mbr'],
  ['wed', 'easy'],
  ['fri', 'long'],
] as const

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Every row of every table, sorted by key, settings included: what "restores everything" compares. */
async function rawDump(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const table of db.tables) {
    const keys = (await table.toCollection().primaryKeys()).map(String)
    const rows = await table.toArray()
    out[table.name] = rows.map((row, i) => [keys[i] ?? '', row] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, row]) => row)
  }
  return out
}

/**
 * Seven weeks as the app writes them: Phase 1 for three weeks, Phase 2 from week 4, each lift's
 * every slot and set (both sides on two-sided slots, the injured side only where the slot says),
 * a run on each run day, a morning check the day after each session, two gyms besides home (one
 * archived), moves, gate tests and Program edits.
 */
async function seedHistory(): Promise<void> {
  await ensureSettings(defaultSettings(program))
  await ensureLocations(program, START)
  const hotel = await addLocation({ name: 'Marriott Downtown', startedFrom: 'empty', dumbbellMaxLb: 25, createdOn: '2026-11-09' }, program)
  await setPresent(hotel.id, 'flat-bench', true)
  await setPresent(hotel.id, 'cable-station', true)
  await addExtra(hotel.id, 'Kettlebells to 35 — “competition” style', '2026-11-10')
  await markOff(hotel.id, 'cable-station', '2026-11-12')
  const airport = await addLocation({ name: 'Airport Hilton', startedFrom: 'planet-fitness', dumbbellMaxLb: 50, createdOn: '2026-11-16' }, program)
  await archiveLocation(airport.id)
  await setDumbbellMax(PLANET_FITNESS_LOCATION_ID, 80)
  await setKit(['ankle-strap'])
  const seeded = await getSettings()
  if (!seeded) throw new Error('no settings')
  await saveSettings({
    ...seeded,
    painPerSet: true,
    restTimerSeconds: 90,
    currentPhase: 2,
    phaseEnteredWeek: 4,
    redFlag: { active: false, items: [], clearedOn: '2026-11-26', clearNote: 'PT saw it Nov 25: no block ✓' },
    activeLocationId: hotel.id,
  })

  const sets: SetLog[] = []
  for (let week = 1; week <= 7; week++) {
    const phase = week <= 3 ? 1 : 2
    for (const [day, type] of RUN_DAYS) {
      const date = dateOf(START, week, day)
      const swap = week === 2 && day === 'wed'
      await addRun(
        Run.parse({
          id: `run-${date}`,
          date,
          type: swap ? 'rower-swap' : type,
          miles: swap ? 0 : type === 'long' ? 4 + week * 0.5 : 3,
          minutes: swap ? 35 : 30 + week,
          effort: type === 'long' ? 'moderate' : 'easy',
          // Runs from week 5 on carry their RPE (metrics phase 1); the earlier ones only the word, as older builds logged them.
          ...(week >= 5 ? { rpe: type === 'long' ? 5 : 3 } : {}),
          // From week 6 the watch is on, so those runs carry both heart-rate numbers (metrics phase 2).
          ...(week >= 6 && !swap ? { avgHr: 140 + week, maxHr: 170 + week } : {}),
          maxPain: week % 3,
          strides: type === 'easy' && week > 2,
          tempo: type === 'long' && week === 6,
          ...(type === 'mbr' ? { stravaUrl: `https://www.strava.com/activities/${1000 + week}` } : {}),
          ...(swap ? { locationId: hotel.id, notes: 'Rower at the hotel' } : {}),
        }),
      )
    }
    for (const letter of ['A', 'B', 'C'] as const) {
      const template = templateFor(phase, letter)
      const date = dateOf(START, week, LIFT_DAYS[letter])
      const id = `${date}-${template.id}`
      const last = week === 7 && letter === 'C'
      const atHotel = week === 2 && letter === 'B'
      await putWorkout(
        Workout.parse({
          id,
          date,
          templateId: template.id,
          phase,
          week,
          isDeload: week === 4,
          startedAt: `${date}T16:00:00.000Z`,
          ...(last ? {} : { finishedAt: `${date}T17:05:00.000Z`, maxPainDuring: week % 4 }),
          // From week 5 on, Finish and End store the minutes, and Shawn rates some sessions (metrics phase 1).
          ...(!last && week >= 5 ? { durationMinutes: 60 + week } : {}),
          ...(!last && week >= 5 && letter !== 'C' ? { sessionRpe: letter === 'A' ? 7 : 6 } : {}),
          ...(week === 5 && letter === 'A' ? { notes: 'Left after the leg press; knee “off”' } : {}),
          status: last ? 'in-progress' : week === 5 && letter === 'A' ? 'abandoned' : 'finished',
          ...(atHotel ? { locationId: hotel.id } : week >= 3 ? { locationId: PLANET_FITNESS_LOCATION_ID } : {}),
        }),
      )
      let minute = 0
      for (const slot of template.slots) {
        const exercise = program.exercises.find((e) => e.id === slot.exerciseId)
        if (!exercise) throw new Error(`no exercise ${slot.exerciseId}`)
        const sides: SetSide[] = slot.injuredOnly ? ['right'] : slot.unilateral ? ['right', 'left'] : ['both']
        const timed = slot.repUnit === 'seconds' || slot.repUnit === 'minutes'
        const loaded = !['time', 'bodyweight', 'band'].includes(exercise.loadType)
        for (let setNumber = 1; setNumber <= slot.sets; setNumber++) {
          for (const side of sides) {
            minute += 2
            sets.push(
              SetLog.parse({
                id: setId(id, slot.id, side, setNumber),
                workoutId: id,
                slotId: slot.id,
                exerciseId: slot.exerciseId,
                setNumber,
                side,
                load: loaded ? 20 + week * 5 : 0,
                loadUnit: loaded ? 'lb' : 'none',
                ...(timed ? { seconds: slot.repUnit === 'minutes' ? slot.repsMax * 60 : slot.repsMax } : { reps: slot.repsMax - (side === 'right' && setNumber === 3 ? 1 : 0), rpe: 7 }),
                painDuring: (week + setNumber) % 4,
                stopped: false,
                ...(slot.heightIn !== undefined ? { heightIn: slot.heightIn } : {}),
                ...(slot.rangeStopDeg !== undefined ? { rangeStopDeg: slot.rangeStopDeg } : {}),
                ...(slot.progressionRule === 'stage' ? { stage: Math.min(week - 1, 2) } : {}),
                ...(atHotel && exercise.loadType === 'dumbbell-each' ? { load: 25, rackCapped: true } : {}),
                loggedAt: `${date}T16:${String(minute % 60).padStart(2, '0')}:00.000Z`,
              }),
            )
          }
        }
      }
      await addMorningCheck(
        MorningCheck.parse({
          id: `mc-${addDays(date, 1)}`,
          date: addDays(date, 1),
          appliesTo: { kind: 'workout', id },
          stiffnessUnder30Min: week !== 3,
          worseThanYesterday: week === 3,
          visibleSwelling: false,
          warmth: false,
          painChangePoints: week === 3 ? 1 : 0,
          redFlags: [],
        }),
      )
    }
  }
  await db.setLogs.bulkPut(sets)
  // The odd ones: a stop for sharp joint-line pain on the injured side, and one per other reason.
  const stopped = sets.find((s) => s.slotId === 'p2b-1' && s.side === 'right' && s.setNumber === 2)
  if (!stopped) throw new Error('no Bulgarian set to stop')
  await upsertSet({ ...stopped, reps: 4, painDuring: 6, stopped: true, stopReason: 'sharp-joint-line-pain' })
  // A morning check for a run, linked; one with nothing to apply to, a red flag and a note.
  await addMorningCheck(
    MorningCheck.parse({
      id: 'mc-2026-11-14-run',
      date: '2026-11-14',
      appliesTo: { kind: 'run', id: 'run-2026-11-13' },
      stiffnessUnder30Min: true,
      worseThanYesterday: false,
      visibleSwelling: false,
      warmth: false,
      painChangePoints: -1,
      redFlags: [],
    }),
  )
  await addMorningCheck(
    MorningCheck.parse({
      id: 'mc-2026-11-25-flag',
      date: '2026-11-25',
      appliesTo: null,
      stiffnessUnder30Min: false,
      worseThanYesterday: true,
      visibleSwelling: true,
      warmth: true,
      painChangePoints: 3,
      redFlags: ['locking', 'giving-way'],
      notes: 'Caught on the stairs twice.\nIced it; 🧊 20 min',
    }),
  )
  await addGateTest(
    GateTest.parse({ id: 'gt-1', date: '2026-11-21', gate: 1, item: 'g1-sl-leg-press', valueInjured: 90, valueOther: 105, pass: true, manual: false, notes: 'Machine 3' }),
  )
  await addGateTest(GateTest.parse({ id: 'gt-2', date: '2026-11-22', gate: 1, item: 'g1-stance', valueInjured: 1, valueOther: 1, pass: true, manual: true }))
  await addGateTest(
    GateTest.parse({ id: 'gt-3', date: '2026-12-19', gate: 3, item: 'g3-single-hop', valueInjured: 56, valueOther: 62, trialsInjured: [50, 56, 0], trialsOther: [60, 62], pass: true, manual: false }),
  )
  await addSessionMove(SessionMove.parse({ id: 'move-1', week: 2, dayA: 'fri', dayB: 'sun' }))
  await addSessionMove(SessionMove.parse({ id: 'move-2', week: 6, dayA: 'sat', dayB: 'sun' }))
  await saveProgramOverride({ slotId: 'p2a-1', cues: ['Feet high on the plate', 'Knee tracks over the 2nd toe — “slow”'], substitutionIds: ['leg-press', 'leg-press-45'], editedOn: '2026-11-30' } as ProgramOverride, program)
  await saveProgramOverride({ slotId: 'p2c-1', substitutionIds: [], editedOn: '2026-12-01' } as ProgramOverride, program)
  await saveProgramOverride({ slotId: 'p2b-7', cues: ['Hips forward'], editedOn: '2026-12-02' } as ProgramOverride, program)
  await saveAddedSlot({ id: 'added-k1', templateId: 'p2-a', exerciseId: 'db-bench-press', sets: 3, repsMin: 8, repsMax: 10, addedOn: '2026-12-03' }, program)
  // Both heart-rate numbers set (metrics phase 2), so the fieldsUsed check covers the whole row.
  await saveHrSettings({ id: 'heart-rate', maxHr: 190, restingHr: 50 })
}

/** The keys every row of a table uses, across the table: every field of the schema shows up somewhere. */
function fieldsUsed(rows: readonly object[]): string[] {
  return [...new Set(rows.flatMap((row) => Object.keys(row)))].sort()
}
const SHAPES: Record<keyof BackupTables, readonly string[]> = {
  workouts: Object.keys(Workout.shape),
  setLogs: Object.keys(SetLog.shape),
  morningChecks: Object.keys(MorningCheck.shape),
  runs: Object.keys(Run.shape),
  gateTests: Object.keys(GateTest.shape),
  sessionMoves: Object.keys(SessionMove.shape),
  locations: Object.keys(Location.shape),
  programOverrides: Object.keys(ProgramOverride.shape),
  addedSlots: Object.keys(AddedSlot.shape),
  hrSettings: Object.keys(HrSettings.shape),
}

describe('the backup carries the whole database', () => {
  it('is at the database’s own version, and carries every table it has', async () => {
    await db.open()
    expect(BACKUP_SCHEMA_VERSION).toBe(db.verno)
    expect(db.tables.map((t) => t.name).sort()).toEqual(['settings', ...BACKUP_TABLES].sort())
  })
})

describe('export, reset, import, export again', () => {
  it('restores everything, and the two files are the same bytes apart from exportedAt', async () => {
    await seedHistory()

    const first = await exportBackup(T1)
    expect(first.unreadable).toEqual([])
    const text1 = backupText(first.backup)
    // A realistic history, every table in use and every field of every row's schema used somewhere.
    expect(first.backup.setLogs.length).toBeGreaterThan(300)
    for (const name of BACKUP_TABLES) expect(fieldsUsed(first.backup[name]), name).toEqual([...SHAPES[name]].sort())
    expect(Object.keys(first.backup.settings).sort()).toEqual(Object.keys(Settings.shape).filter((k) => k !== 'lastExportedAt').sort())
    expect(first.backup.morningChecks.map((m) => m.appliesTo?.kind ?? null)).toEqual(expect.arrayContaining(['workout', 'run', null]))
    expect(first.backup.locations.map((l) => [l.id, l.archived, l.extras.length, l.markedOff.length])).toEqual([
      ['loc-1', false, 1, 1],
      ['loc-2', true, 0, 0],
      ['planet-fitness', false, 0, 0],
    ])
    // exportedAt is the one place the file names its moment.
    expect(text1.split(T1)).toHaveLength(2)

    await markExported(T1)
    const stamped = await rawDump()
    expect((await getSettings())?.lastExportedAt).toBe(T1)

    await resetAll(defaultSettings(program), program, TODAY)
    // Reset covers the new tables: the Program edits and lastExportedAt go, the home gym comes back through the launch path.
    expect(await getSettings()).toEqual(defaultSettings(program))
    expect((await getSettings())?.lastExportedAt).toBeUndefined()
    expect(await getProgramOverrides()).toEqual([])
    expect(await db.locations.toArray()).toEqual([homeLocation(defaultSettings(program).dumbbellMax, program.planetFitness, TODAY, program.equipmentListVersion)])
    for (const name of BACKUP_TABLES.filter((n) => n !== 'locations')) expect(await db.table(name).count(), name).toBe(0)

    const read = parseBackup(text1)
    if (!read.ok) throw new Error(read.refusal)
    expect(read.migratedFrom).toBeNull()
    await replaceAll(read.backup, program, TODAY, T2)
    // Every row as it was stored, the settings' lastExportedAt included: the phone now holds that file.
    expect(await rawDump()).toEqual(stamped)

    const second = await exportBackup(T2)
    const text2 = backupText(second.backup)
    expect(text2).not.toBe(text1)
    expect(text2.replace(`"exportedAt": "${T2}"`, `"exportedAt": "${T1}"`)).toBe(text1)
  })
})

describe('import is all or nothing', () => {
  it('a write that fails partway leaves every table as it was', async () => {
    await seedHistory()
    const text = backupText((await exportBackup(T1)).backup)
    await db.workouts.delete('2026-11-03-p1-a')
    const before = await rawDump()
    const read = parseBackup(text)
    if (!read.ok) throw new Error(read.refusal)
    vi.spyOn(db.table('runs'), 'bulkAdd').mockImplementation(() => {
      throw new Error('disk full')
    })
    await expect(replaceAll(read.backup, program, TODAY)).rejects.toThrow('disk full')
    expect(await rawDump()).toEqual(before)
  })

  it('a file the rules refuse touches nothing, even handed straight to replaceAll', async () => {
    await seedHistory()
    const { backup } = await exportBackup(T1)
    const before = await rawDump()
    const newer = { ...backup, schemaVersion: 8 } as unknown as Backup
    await expect(replaceAll(newer, program, TODAY)).rejects.toThrow('This backup is from a newer version of the app (schema version 8; this one reads up to 7).')
    const twice = { ...backup, runs: [...backup.runs, ...backup.runs.slice(0, 1)] }
    await expect(replaceAll(twice, program, TODAY)).rejects.toThrow('twice')
    expect(await rawDump()).toEqual(before)
  })
})

describe('an import and the red flag (PROGRAM-QUESTIONS 128)', () => {
  it('a red-flagged phone importing a file from before the flag keeps the flag on: only Settings clears it, with a note', async () => {
    await ensureSettings(defaultSettings(program))
    await ensureLocations(program, START)
    await addMorningCheck(MorningCheck.parse({ id: 'mc-2026-11-04', date: '2026-11-04', appliesTo: null, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [] }))
    const wednesday = backupText((await exportBackup('2026-11-04T23:00:00.000Z')).backup)
    const flagged = MorningCheck.parse({ id: 'mc-2026-11-05', date: '2026-11-05', appliesTo: null, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: ['locking'] })
    await addMorningCheck(flagged)
    const before = await getSettings()
    if (!before) throw new Error('no settings')
    await saveSettings({ ...before, redFlag: afterMorningCheck(before.redFlag, flagged) })

    const read = parseBackup(wednesday)
    if (!read.ok) throw new Error(read.refusal)
    expect(read.backup.settings.redFlag).toEqual({ active: false, items: [] })
    await replaceAll(read.backup, program, '2026-11-05')

    const after = await getSettings()
    expect(after?.redFlag).toEqual({ active: true, since: '2026-11-05', items: ['locking'] })
    expect(stopMessage(after?.redFlag ?? { active: false, items: [] }, program.redFlags)?.headline).toBe('Stop. Call the ortho or PT.')
    // Everything else is the file's: the flagged morning check is gone with the rest of what came after it.
    expect((await db.morningChecks.toArray()).map((m) => m.id)).toEqual(['mc-2026-11-04'])
  })
})

describe('the export stamp has its own row, so the build before M6 still reads the settings (PROGRAM-QUESTIONS 132)', () => {
  // M5's Settings, field for field: the strict row the build before M6 parses on every settings read.
  const M5Settings = Settings.omit({ lastExportedAt: true })
  async function settingsRow(): Promise<unknown> {
    const row = await db.settings.get('settings')
    if (!row) return undefined
    const { id: _id, ...rest } = row
    void _id
    return rest
  }

  it('an export, a settings save and an import leave the settings row as M5 reads it, and the stamp reads back', async () => {
    await ensureSettings(defaultSettings(program))
    await ensureLocations(program, START)
    await markExported(T1)
    expect(M5Settings.safeParse(await settingsRow()).success).toBe(true)
    expect((await getSettings())?.lastExportedAt).toBe(T1)

    // A screen saves the settings it holds, the stamp among them: the row still never carries it, and the stamp stays.
    const held = await getSettings()
    if (!held) throw new Error('no settings')
    await saveSettings({ ...held, painPerSet: true })
    expect(M5Settings.safeParse(await settingsRow()).success).toBe(true)
    expect(await getSettings()).toMatchObject({ painPerSet: true, lastExportedAt: T1 })

    const read = parseBackup(backupText((await exportBackup(T2)).backup))
    if (!read.ok) throw new Error(read.refusal)
    await replaceAll(read.backup, program, TODAY, T2)
    expect(M5Settings.safeParse(await settingsRow()).success).toBe(true)
    expect((await getSettings())?.lastExportedAt).toBe(T2)

    // Reset takes the stamp's row with everything else.
    await resetAll(defaultSettings(program), program, TODAY)
    expect(await db.settings.count()).toBe(1)
    expect((await getSettings())?.lastExportedAt).toBeUndefined()
  })

  it('a row an earlier M6 build wrote with the stamp inside still reads, stamp and all', async () => {
    await db.table('settings').put({ ...defaultSettings(program), lastExportedAt: T1, id: 'settings' })
    expect((await getSettings())?.lastExportedAt).toBe(T1)
    await markExported(T2)
    expect((await getSettings())?.lastExportedAt).toBe(T2)
    expect(M5Settings.safeParse(await settingsRow()).success).toBe(true)
  })
})

describe('the stamp an import records (PROGRAM-QUESTIONS 121)', () => {
  it('a file stamped after the import’s own moment records the import’s moment, so Today’s reminder still comes', async () => {
    await ensureSettings(defaultSettings(program))
    await ensureLocations(program, START)
    const { backup } = await exportBackup(T1)
    const ahead = parseBackup(backupText({ ...backup, exportedAt: '2099-01-01T00:00:00Z' }))
    if (!ahead.ok) throw new Error(ahead.refusal)
    await replaceAll(ahead.backup, program, TODAY, T2)
    expect((await getSettings())?.lastExportedAt).toBe(T2)
    const behind = parseBackup(backupText(backup))
    if (!behind.ok) throw new Error(behind.refusal)
    await replaceAll(behind.backup, program, TODAY, T2)
    expect((await getSettings())?.lastExportedAt).toBe(T1)
  })
})

describe('importing an older file, or one with no home gym', () => {
  it('a version 2 file gets the home gym from its own settings through the launch path, and the M4b defaults', async () => {
    await seedHistory()
    const v2 = {
      app: 'knee-rebuild',
      schemaVersion: 2,
      exportedAt: '2026-11-08T23:10:00-05:00',
      settings: { injuredSide: 'left', startDate: '2026-11-02', dumbbellMax: 60, restTimerSeconds: 60, painPerSet: false, currentPhase: 1, phaseEnteredWeek: 1, redFlag: { active: false, items: [] } },
      workouts: [{ id: '2026-11-03-p1-a', date: '2026-11-03', templateId: 'p1-a', phase: 1, week: 1, isDeload: false, status: 'finished' }],
      setLogs: [],
      morningChecks: [],
      runs: [{ id: 'run-2026-11-02', date: '2026-11-02', type: 'mbr', miles: 3, minutes: 33, effort: 'easy', maxPain: 1, strides: false, tempo: false }],
      gateTests: [],
      sessionMoves: [],
    }
    const read = parseBackup(JSON.stringify(v2))
    if (!read.ok) throw new Error(read.refusal)
    expect(read.migratedFrom).toBe(2)
    await replaceAll(read.backup, program, TODAY, T2)
    expect(await getSettings()).toMatchObject({ injuredSide: 'left', activeLocationId: PLANET_FITNESS_LOCATION_ID, kit: ['ankle-strap', 'mini-band'], lastExportedAt: '2026-11-08T23:10:00-05:00' })
    expect(await db.locations.toArray()).toEqual([homeLocation(60, program.planetFitness, TODAY, program.equipmentListVersion)])
    expect(await db.workouts.count()).toBe(1)
    expect(await db.setLogs.count()).toBe(0)
    expect(await getProgramOverrides()).toEqual([])
    // The launch path afterwards leaves that gym as it is.
    await ensureLocations(program, '2026-12-21')
    expect(await db.locations.toArray()).toEqual([homeLocation(60, program.planetFitness, TODAY, program.equipmentListVersion)])
  })
})

describe('the export stamp and the runner’s stored swaps', () => {
  it('records the export on the settings and changes nothing else', async () => {
    await seedHistory()
    const before = await getSettings()
    await markExported(T1)
    expect(await getSettings()).toEqual({ ...before, lastExportedAt: T1 })
  })

  it('refuses to export, in words, before the app has seeded its settings', async () => {
    await expect(exportBackup(T1)).rejects.toThrow('There are no settings on this phone to export yet.')
    expect((await readStored()).settings).toBeUndefined()
    await expect(markExported(T1)).rejects.toThrow('no settings row')
  })

  it('an import takes the runner’s stored swaps out of local storage, as Reset does, and nothing else', async () => {
    const store = new Map<string, string>([
      [`${SWAP_KEY_PREFIX}2026-12-19-p2-c`, '{"p2c-1":"split-squat"}'],
      [`${SWAP_KEY_PREFIX}2026-12-17-p2-b:anyway`, '["p2b-1"]'],
      ['other-app:key', 'kept'],
    ])
    vi.stubGlobal('window', {
      localStorage: {
        get length() {
          return store.size
        },
        key: (i: number) => [...store.keys()][i] ?? null,
        getItem: (k: string) => store.get(k) ?? null,
        removeItem: (k: string) => void store.delete(k),
      },
    })
    await seedHistory()
    const read = parseBackup(backupText((await exportBackup(T1)).backup))
    if (!read.ok) throw new Error(read.refusal)
    await replaceAll(read.backup, program, TODAY)
    expect([...store.keys()]).toEqual(['other-app:key'])
  })
})
