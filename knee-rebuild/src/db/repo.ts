import { db, type ExportStampRow, type SettingsRow } from './db.ts'
import { homeLocation } from './migrations.ts'
import {
  activeAfterArchive,
  canArchive,
  gymLocked,
  inListOrder,
  newLocation,
  nextLocationId,
  withExtra,
  withMarkOff,
  withoutExtra,
  withoutMarkOff,
  withPresent,
  type Extra,
  type NewLocationInput,
} from '../rules/locations.ts'
import { addedSlotProblem, phaseExerciseIds } from '../rules/addedSlots.ts'
import { cleanWindow } from '../rules/fitWindow.ts'
import { overrideProblems } from '../rules/overrides.ts'
import {
  AddedSlot,
  GateTest,
  HrSettings,
  Location,
  MorningCheck,
  ProgramOverride,
  Run,
  SessionMove,
  SetLog,
  Settings,
  Workout,
  PLANET_FITNESS_LOCATION_ID,
  IsoDateTime,
  type EquipmentId,
  type IsoDate,
  type Program,
  type SetSide,
} from '../schema/index.ts'

/**
 * Every write goes through a strict Zod parse first, so nothing malformed reaches IndexedDB.
 * Nothing in here decides anything; decisions live in src/rules.
 */

export const SETTINGS_ID = 'settings' as const
/** The key of the export stamp's row in the settings table (`ExportStampRow`). */
export const EXPORT_STAMP_ID = 'last-export' as const

/** Settings for a fresh install: the program's own start date and injured side, Shawn's answers to section 9. */
export function defaultSettings(program: Pick<Program, 'startDate' | 'injuredSide'>): Settings {
  return Settings.parse({
    injuredSide: program.injuredSide,
    startDate: program.startDate,
    dumbbellMax: 80,
    restTimerSeconds: 60,
    painPerSet: false,
  })
}

/** The settings row as stored, without its key and without the stamp; undefined before the app seeds it. Not parsed. */
export async function getSettingsRow(): Promise<Omit<SettingsRow, 'id'> | undefined> {
  const row = await db.settings.get(SETTINGS_ID)
  if (!row || row.id !== SETTINGS_ID) return undefined
  const { id: _id, ...rest } = row
  void _id
  return rest
}

/** The export stamp as stored: its own row, or, from an earlier M6 build, the key on the settings row. */
async function storedStamp(row: object | undefined): Promise<string | undefined> {
  const stamp = await db.settings.get(EXPORT_STAMP_ID)
  if (stamp?.id === EXPORT_STAMP_ID) return stamp.at
  const legacy: unknown = row && 'lastExportedAt' in row ? row.lastExportedAt : undefined
  return typeof legacy === 'string' ? legacy : undefined
}

/** The settings with the export stamp read back in as `lastExportedAt` (PROGRAM-QUESTIONS 132), as stored and not parsed; undefined before the app seeds them. */
export async function getStoredSettings(): Promise<Settings | undefined> {
  const row = await getSettingsRow()
  if (!row) return undefined
  const { lastExportedAt: _legacy, ...rest } = row as Settings
  void _legacy
  const at = await storedStamp(row)
  return { ...rest, ...(at !== undefined ? { lastExportedAt: at } : {}) }
}

export async function getSettings(): Promise<Settings | undefined> {
  const stored = await getStoredSettings()
  return stored ? Settings.parse(stored) : undefined
}

/** The row a settings value is stored as: parsed, keyed, and without `lastExportedAt`, which only `saveExportStamp` writes. */
function settingsRow(settings: Settings): SettingsRow {
  const { lastExportedAt: _stamp, ...row } = Settings.parse(settings)
  void _stamp
  return { ...row, id: SETTINGS_ID }
}

/**
 * Saves the settings row. `lastExportedAt` is the phone's record of its last export and is never
 * written here: a screen saving the settings it holds can't put back an older stamp, and the row
 * stays one the build before M6 reads (PROGRAM-QUESTIONS 132). Export and import write it
 * (`saveExportStamp`), and Reset all data clears it.
 */
export async function saveSettings(settings: Settings): Promise<void> {
  await db.settings.put(settingsRow(settings))
}

/** Records when this phone last wrote a backup, in the stamp's own row. Inside a transaction on settings, or alone. */
export async function saveExportStamp(at: IsoDateTime): Promise<void> {
  const row: ExportStampRow = { id: EXPORT_STAMP_ID, at: IsoDateTime.parse(at) }
  await db.settings.put(row)
}

/**
 * Saves the settings and rewrites the stored session moves in one transaction, for a start-date
 * change: moves are stored by program week, so they are rebased against the start date stored with
 * them. `rebase` gets that stored start date and the stored moves, both read inside the transaction,
 * and returns the moves to keep (src/rules decides which); if it throws, or a move fails its parse,
 * nothing is written. Returns what `rebase` returned.
 */
export async function saveSettingsAndMoves<T extends { moves: readonly SessionMove[]; phaseEnteredWeek?: number }>(
  settings: Settings,
  rebase: (stored: { startDate: IsoDate; phaseEnteredWeek: number }, moves: SessionMove[]) => T,
): Promise<T> {
  const parsed = settingsRow(settings)
  return db.transaction('rw', db.settings, db.sessionMoves, async () => {
    const stored = await getSettingsRow()
    const result = rebase(
      { startDate: stored?.startDate ?? parsed.startDate, phaseEnteredWeek: stored?.phaseEnteredWeek ?? parsed.phaseEnteredWeek },
      await db.sessionMoves.toArray(),
    )
    const moves = result.moves.map((m) => SessionMove.parse(m))
    const row: SettingsRow = result.phaseEnteredWeek === undefined ? parsed : { ...parsed, phaseEnteredWeek: result.phaseEnteredWeek }
    await db.settings.put(row)
    await db.sessionMoves.clear()
    await db.sessionMoves.bulkPut(moves)
    return result
  })
}

/** The key of the one heart-rate settings row (metrics phase 2), in its own table so no older build's settings read sees it (PROGRAM-QUESTIONS 150). */
export const HR_SETTINGS_ID = 'heart-rate' as const

/** Shawn's max and resting heart rate as stored, parsed; undefined until a stepper is touched. Not part of `loadHistory`: no rule reads it. */
export async function getHrSettings(): Promise<HrSettings | undefined> {
  const row = await db.hrSettings.get(HR_SETTINGS_ID)
  return row ? HrSettings.parse(row) : undefined
}

/** Saves the heart-rate numbers, parsed first like every write. A touch saves only the touched number; the app never invents the other one. */
export async function saveHrSettings(row: HrSettings): Promise<void> {
  await db.hrSettings.put(HrSettings.parse(row))
}

/** Seed on first run: create the settings row if it is missing, and return it. */
export async function ensureSettings(defaults: Settings): Promise<Settings> {
  const existing = await getSettings()
  if (existing) return existing
  await saveSettings(defaults)
  return defaults
}

/** What the home gym is written from: the seed's Planet Fitness list and its list version. */
export type HomeLists = Pick<Program, 'planetFitness' | 'equipmentListVersion'>

/** The home gym, from the stored settings' dumbbell max (the only place outside a migration that reads it). Inside a transaction on settings and locations. */
async function writeHome(lists: HomeLists, createdOn: IsoDate): Promise<Location> {
  const settings = await getSettings()
  if (!settings) throw new Error('no settings row to write the home gym from; ensureSettings runs first')
  const home = Location.parse(homeLocation(settings.dumbbellMax, lists.planetFitness, createdOn, lists.equipmentListVersion))
  await db.locations.put(home)
  return home
}

/**
 * Seed at launch, after ensureSettings (design section 2): write the home gym, Planet Fitness,
 * when no row for it exists yet, and return it. On a phone that ran version 2 this is how the
 * dumbbell max it had set reaches the gym; nothing else changes. A row already there is left as it is.
 */
export async function ensureLocations(lists: HomeLists, createdOn: IsoDate): Promise<Location> {
  return db.transaction('rw', db.settings, db.locations, async () => {
    const existing = await db.locations.get(PLANET_FITNESS_LOCATION_ID)
    if (existing) return Location.parse(existing)
    return writeHome(lists, createdOn)
  })
}

/** Every stored gym, archived ones included (workouts point at them), Planet Fitness first (`inListOrder`). */
export async function getLocations(): Promise<Location[]> {
  return inListOrder((await db.locations.toArray()).map((row) => Location.parse(row)))
}

export async function getLocation(id: string): Promise<Location | undefined> {
  const row = await db.locations.get(id)
  return row ? Location.parse(row) : undefined
}

/** Reads a gym, applies an edit from src/rules/locations.ts, parses and writes it, in one transaction. Throws for an id with no row. */
async function editLocation(id: string, edit: (location: Location) => Location): Promise<Location> {
  return db.transaction('rw', db.locations, async () => {
    const row = await db.locations.get(id)
    if (!row) throw new Error(`no location ${id}`)
    const next = Location.parse(edit(Location.parse(row)))
    await db.locations.put(next)
    return next
  })
}

/** A new gym (the editor's New): Planet Fitness's list or nothing, a name of 1 to 60 characters, the next free id. Returns the row written. */
export async function addLocation(input: NewLocationInput, lists: HomeLists): Promise<Location> {
  return db.transaction('rw', db.locations, async () => {
    const id = nextLocationId((await db.locations.toCollection().primaryKeys()).map(String))
    const location = Location.parse(newLocation(id, input, lists))
    await db.locations.add(location)
    return location
  })
}

export async function renameLocation(id: string, name: string): Promise<Location> {
  return editLocation(id, (l) => ({ ...l, name }))
}

/** The editor's Tap, the runner's "Mark … here": here or not here, clearing any mark-off of the item (`withPresent`). */
export async function setPresent(locationId: string, itemId: EquipmentId, here: boolean): Promise<Location> {
  return editLocation(locationId, (l) => withPresent(l, itemId, here))
}

/** "Smith machine isn't here: mark it", from the runner or Today: not here since `on`, until "It's back". */
export async function markOff(locationId: string, itemId: EquipmentId, on: IsoDate): Promise<Location> {
  return editLocation(locationId, (l) => withMarkOff(l, itemId, on))
}

/** "It's back". */
export async function clearMarkOff(locationId: string, itemId: EquipmentId): Promise<Location> {
  return editLocation(locationId, (l) => withoutMarkOff(l, itemId))
}

/** "Something else here?" kept as typed; text kept already is not kept twice. Returns the extra. */
export async function addExtra(locationId: string, text: string, addedOn: IsoDate): Promise<Extra> {
  let extra: Extra | undefined
  await editLocation(locationId, (l) => {
    const result = withExtra(l, text, addedOn)
    extra = result.extra
    return result.location
  })
  if (!extra) throw new Error(`no extra kept for ${locationId}`)
  return extra
}

/** A kept line taken back (`withoutExtra`), so a mistaken paste or a typo leaves the next-update list. Returns the row written. */
export async function removeExtra(locationId: string, extraId: string): Promise<Location> {
  return editLocation(locationId, (l) => withoutExtra(l, extraId))
}

/** The gym's rack, in lb; 0 means no dumbbells. */
export async function setDumbbellMax(locationId: string, lb: number): Promise<Location> {
  return editLocation(locationId, (l) => ({ ...l, dumbbellMaxLb: lb }))
}

/**
 * Archives a gym (no delete: workouts point at it). Archiving the active gym makes Planet Fitness
 * active in the same transaction, and the result says so for the screen. Planet Fitness itself is
 * never archived.
 */
export async function archiveLocation(id: string): Promise<{ activeMovedHome: boolean }> {
  if (!canArchive(id)) throw new Error('Planet Fitness is the home gym and is never archived')
  return db.transaction('rw', db.settings, db.locations, async () => {
    const settings = await getSettings()
    if (!settings) throw new Error('no settings row')
    await editLocation(id, (l) => ({ ...l, archived: true }))
    const active = activeAfterArchive(settings.activeLocationId, id)
    if (active !== settings.activeLocationId) await saveSettings({ ...settings, activeLocationId: active })
    return { activeMovedHome: active !== settings.activeLocationId }
  })
}

/** The gym Today plans for, until it is changed (Shawn's Nov 1 answer 9). Refuses a gym not stored or archived. */
export async function setActiveLocation(id: string): Promise<void> {
  await db.transaction('rw', db.settings, db.locations, async () => {
    const location = await getLocation(id)
    if (!location) throw new Error(`no location ${id}`)
    if (location.archived) throw new Error(`${location.name} is archived`)
    const settings = await getSettings()
    if (!settings) throw new Error('no settings row')
    await saveSettings({ ...settings, activeLocationId: id })
  })
}

/** What Shawn carries to every gym ("In your bag"), each item once. */
export async function setKit(kit: readonly EquipmentId[]): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const settings = await getSettings()
    if (!settings) throw new Error('no settings row')
    await saveSettings({ ...settings, kit: [...kit] })
  })
}

/**
 * The runner's Change: the session's gym, only until its first set is logged (`gymLocked`), and only
 * to a gym that is stored and not archived.
 */
export async function setWorkoutLocation(workoutId: string, locationId: string): Promise<void> {
  await db.transaction('rw', db.workouts, db.setLogs, db.locations, async () => {
    const workout = await db.workouts.get(workoutId)
    if (!workout) throw new Error(`no workout ${workoutId}`)
    if (gymLocked(await db.setLogs.where('workoutId').equals(workoutId).count())) throw new Error('the gym is locked once a set is logged')
    const location = await getLocation(locationId)
    if (!location) throw new Error(`no location ${locationId}`)
    if (location.archived) throw new Error(`${location.name} is archived`)
    await db.workouts.put(Workout.parse({ ...workout, locationId }))
  })
}

export async function putWorkout(workout: Workout): Promise<void> {
  await db.workouts.put(Workout.parse(workout))
}

/**
 * Puts an abandoned (or finished) workout back in progress, keeping its sets: one workout per lift
 * day. What Finish or End asked goes with the finish (max pain, and the session's RPE and minutes,
 * metrics phase 1), so the next Finish asks them again and training load never reads a stale value.
 */
export async function reopenWorkout(id: string): Promise<void> {
  const current = await db.workouts.get(id)
  if (!current) throw new Error(`no workout ${id}`)
  const { finishedAt: _f, maxPainDuring: _m, sessionRpe: _r, durationMinutes: _d, ...rest } = current
  void [_f, _m, _r, _d]
  await db.workouts.put(Workout.parse({ ...rest, status: 'in-progress' }))
}

/** Deletes a workout and its sets: for a session started by mistake with nothing logged. */
export async function deleteWorkout(id: string): Promise<void> {
  await db.transaction('rw', db.workouts, db.setLogs, async () => {
    await db.setLogs.where('workoutId').equals(id).delete()
    await db.workouts.delete(id)
  })
}

export async function updateWorkout(id: string, patch: Partial<Workout>): Promise<void> {
  const current = await db.workouts.get(id)
  if (!current) throw new Error(`no workout ${id}`)
  await db.workouts.put(Workout.parse({ ...current, ...patch }))
}

/** A set's id is its coordinates, so logging the same set twice overwrites instead of duplicating. */
export function setId(workoutId: string, slotId: string, side: SetSide, setNumber: number): string {
  return `${workoutId}:${slotId}:${side}:${setNumber}`
}

export async function upsertSet(set: SetLog): Promise<void> {
  await db.setLogs.put(SetLog.parse({ ...set, id: setId(set.workoutId, set.slotId, set.side, set.setNumber) }))
}

export async function deleteSet(id: string): Promise<void> {
  await db.setLogs.delete(id)
}

export async function addMorningCheck(check: MorningCheck): Promise<void> {
  await db.morningChecks.put(MorningCheck.parse(check))
}

export async function addRun(run: Run): Promise<void> {
  await db.runs.put(Run.parse(run))
}

export async function addGateTest(test: GateTest): Promise<void> {
  await db.gateTests.put(GateTest.parse(test))
}

export async function addSessionMove(move: SessionMove): Promise<void> {
  await db.sessionMoves.put(SessionMove.parse(move))
}

export async function deleteSessionMove(id: string): Promise<void> {
  await db.sessionMoves.delete(id)
}

export async function deleteRun(id: string): Promise<void> {
  await db.runs.delete(id)
}

/** What a Program screen edit is checked against before it is written: program.md's slots and the exercise catalog. */
export type OverrideSeed = Pick<Program, 'templates' | 'exercises'>

/** The Program screen's edits, one row per edited slot. */
export async function getProgramOverrides(): Promise<ProgramOverride[]> {
  return (await db.programOverrides.toArray()).map((row) => ProgramOverride.parse(row))
}

/**
 * Stores a slot's edit from the Program screen in place of its earlier one: checked against
 * program.md's slot (`overrideProblems`: each cue one the screen takes, substitutions from the
 * catalog only, never the slot's own exercise, each once), then parsed. A refusal throws one
 * sentence and writes nothing: the rule's own words first, and the schema's reason, in a sentence,
 * for anything else, never Zod's issue list. The seed is never written; the engine lays the row
 * over it (`applyOverrides`). Returns the row written.
 */
export async function saveProgramOverride(override: ProgramOverride, seed: OverrideSeed): Promise<ProgramOverride> {
  const slot = seed.templates.flatMap((t) => t.slots).find((s) => s.id === override.slotId)
  if (!slot) throw new Error(`No slot ${String(override.slotId)} in the program.`)
  const [problem] = overrideProblems(slot, override, new Map(seed.exercises.map((e) => [e.id, e])))
  if (problem) throw new Error(problem)
  const parsed = ProgramOverride.safeParse(override)
  if (!parsed.success) throw new Error(`That edit can’t be stored: ${parsed.error.issues[0]?.message ?? 'it is not an edit of cues or substitutions'}.`)
  await db.programOverrides.put(parsed.data)
  return parsed.data
}

/** "Back to program.md's": the slot's row goes, so it runs as program.md writes it. */
export async function clearProgramOverride(slotId: string): Promise<void> {
  await db.programOverrides.delete(slotId)
}

/** The exercises Shawn added to a session, one row each. */
export async function getAddedSlots(): Promise<AddedSlot[]> {
  return (await db.addedSlots.toArray()).map((row) => AddedSlot.parse(row))
}

/**
 * Stores an exercise added to a session: checked first (`addedSlotProblem`: in the catalog, one a
 * session can take, room on the template), then parsed. A refusal throws one sentence and writes
 * nothing. The seed is never written; the engine lays the slot after the template's own.
 */
export async function saveAddedSlot(added: AddedSlot, seed: Pick<Program, 'templates' | 'exercises'>): Promise<AddedSlot> {
  const template = seed.templates.find((t) => t.id === added.templateId)
  if (!template) throw new Error(`No session ${String(added.templateId)} in the program.`)
  const parsed = AddedSlot.safeParse(added)
  if (!parsed.success) throw new Error(`That can’t be added: ${parsed.error.issues[0]?.message ?? 'it is not an exercise with sets and reps'}.`)
  const already = await db.addedSlots.where('templateId').equals(added.templateId).filter((row) => row.id !== added.id).count()
  const problem = addedSlotProblem(parsed.data, seed.exercises.find((e) => e.id === added.exerciseId), already, phaseExerciseIds(seed.templates, template.phase))
  if (problem) throw new Error(problem)
  await db.addedSlots.put(parsed.data)
  return parsed.data
}

/** Takes an added exercise off its session. Sets already logged for it stay in the history. */
export async function removeAddedSlot(id: string): Promise<void> {
  await db.addedSlots.delete(id)
}

export interface History {
  workouts: Workout[]
  setLogs: SetLog[]
  morningChecks: MorningCheck[]
  runs: Run[]
  gateTests: GateTest[]
  sessionMoves: SessionMove[]
  /**
   * The Program screen's edits (M6), which `planSession` lays over program.md's slots. Optional so
   * a history built by hand (a test fixture) reads as no edits: every slot as program.md writes it.
   */
  programOverrides?: ProgramOverride[]
  /** The exercises Shawn added to a session (Dexie version 5), which `planSession` lays after a template's own slots. Optional for the same reason. */
  addedSlots?: AddedSlot[]
}

/** Everything the engine reads, in one go. The tables are small: one person, twelve weeks. */
export async function loadHistory(): Promise<History> {
  const [workouts, setLogs, morningChecks, runs, gateTests, sessionMoves, programOverrides, addedSlots] = await Promise.all([
    db.workouts.toArray(),
    db.setLogs.toArray(),
    db.morningChecks.toArray(),
    db.runs.toArray(),
    db.gateTests.toArray(),
    db.sessionMoves.toArray(),
    db.programOverrides.toArray(),
    db.addedSlots.toArray(),
  ])
  return { workouts, setLogs, morningChecks, runs, gateTests, sessionMoves, programOverrides, addedSlots }
}

/** The prefix the Session runner stores a workout's swaps under in local storage. */
export const SWAP_KEY_PREFIX = 'knee-rebuild:swaps:'

/**
 * Wipes every table, settings and gyms included, and seeds them again through the launch path:
 * `defaults` as the settings row, then the home gym from them (ensureLocations' `homeLocation`).
 * One transaction, so a seed that fails its parse erases nothing. Every table means the Program
 * screen's edits too, and the settings table holds `defaults` alone, so the export stamp's row
 * goes and no `lastExportedAt` survives (M6). The Settings screen asks twice before calling this.
 */
export async function resetAll(defaults: Settings, lists: HomeLists, createdOn: IsoDate): Promise<void> {
  const row = settingsRow(defaults)
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear()
    await db.settings.put(row)
    await writeHome(lists, createdOn)
  })
  forgetSwaps()
}

/**
 * The minutes Shawn said he has for a session, kept beside its swaps (so Reset and an import take
 * it out with them): null, or nothing stored, is the full session. The fit itself is
 * `fitToWindow` (src/rules/fitWindow.ts); this only remembers the number.
 */
export function readWindow(workoutId: string): number | null {
  try {
    const raw = window.localStorage.getItem(`${SWAP_KEY_PREFIX}${workoutId}:window`)
    return raw === null ? null : cleanWindow(JSON.parse(raw))
  } catch {
    return null
  }
}

export function writeWindow(workoutId: string, minutes: number | null): void {
  try {
    const key = `${SWAP_KEY_PREFIX}${workoutId}:window`
    if (minutes === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(minutes))
  } catch {
    // Private browsing: the session runs in full.
  }
}

/**
 * Takes the Session runner's swaps and Do it anyway out of local storage, after a reset or an
 * import: workout ids repeat (they are the date and template), so stale ones would come back.
 */
export function forgetSwaps(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key?.startsWith(SWAP_KEY_PREFIX)) keys.push(key)
    }
    for (const key of keys) window.localStorage.removeItem(key)
  } catch {
    // Private browsing: nothing was stored.
  }
}

/** Asks the browser to keep this origin's storage out of eviction. Best effort; iOS may say no. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
      return await navigator.storage.persist()
    }
  } catch {
    // Private browsing or an old browser: nothing to do.
  }
  return false
}
