import { daysBetween, todayIn } from './calendar.ts'
import type { RedFlagState } from './redFlags.ts'
import {
  AddedSlot,
  GateTest,
  HrSettings,
  IsoDateTime,
  Location,
  MorningCheck,
  ProgramOverride,
  Run,
  SessionMove,
  SetLog,
  Settings,
  Workout,
  type IsoDate,
  type Side,
} from '../schema/index.ts'

/**
 * The backup file (M6 brief, section 2): one versioned JSON file holding every table, read back
 * strictly before anything on the phone is touched. Pure: src/db/backup.ts reads and writes the
 * tables, the Settings screen picks and shares the file; what the file is, which files are refused
 * and why, how an older one is carried forward, and what a file holds, in counts, are decided here.
 */

export const BACKUP_APP = 'knee-rebuild'

/**
 * The shape of the file's tables: the Dexie version they were read from (src/db/db.ts). A test in
 * src/db/backup.test.ts holds the two together, so a new Dexie version has to bring a step here.
 */
export const BACKUP_SCHEMA_VERSION = 7

/**
 * The oldest shape a file can be carried forward from. Version 1 was the empty M0 database. No file
 * was ever written at 2 or 3 (export arrived with version 4); their steps read the tables as those
 * versions stored them, so the chain the next version extends is real and tested.
 */
export const OLDEST_SCHEMA_VERSION = 2

/** A year of logging is well under a megabyte; anything past this is not one of this app's files. */
export const BACKUP_MAX_BYTES = 10 * 1024 * 1024

/** The tables a file carries besides settings, in the order the file lists them. */
export const BACKUP_TABLES = ['workouts', 'setLogs', 'morningChecks', 'runs', 'gateTests', 'sessionMoves', 'locations', 'programOverrides', 'addedSlots', 'hrSettings'] as const
export type BackupTable = (typeof BACKUP_TABLES)[number]

/** Settings as a file carries them: every field but `lastExportedAt`, which is the phone's own (an import stamps the file's `exportedAt`). */
export const FileSettings = Settings.omit({ lastExportedAt: true })
export type FileSettings = Omit<Settings, 'lastExportedAt'>

export interface BackupTables {
  workouts: Workout[]
  setLogs: SetLog[]
  morningChecks: MorningCheck[]
  runs: Run[]
  gateTests: GateTest[]
  sessionMoves: SessionMove[]
  locations: Location[]
  programOverrides: ProgramOverride[]
  addedSlots: AddedSlot[]
  hrSettings: HrSettings[]
}

/** The file, in the order its keys are written. */
export interface Backup extends BackupTables {
  app: typeof BACKUP_APP
  schemaVersion: typeof BACKUP_SCHEMA_VERSION
  exportedAt: IsoDateTime
  settings: FileSettings
}

/** What the phone holds, as src/db/backup.ts reads it: the settings row without its key (absent before the app seeds it), and every table. */
export interface StoredContents extends BackupTables {
  settings: Settings | undefined
}

const ENVELOPE = ['app', 'schemaVersion', 'exportedAt', 'settings'] as const
const FILE_KEYS: readonly string[] = [...ENVELOPE, ...BACKUP_TABLES]

/** Each table's name in words, plural and singular, for counts and refusals. */
export const TABLE_WORDS: Record<BackupTable, { many: string; one: string }> = {
  workouts: { many: 'sessions', one: 'session' },
  setLogs: { many: 'sets', one: 'set' },
  morningChecks: { many: 'morning checks', one: 'morning check' },
  runs: { many: 'runs', one: 'run' },
  gateTests: { many: 'gate tests', one: 'gate test' },
  sessionMoves: { many: 'session moves', one: 'session move' },
  locations: { many: 'gyms', one: 'gym' },
  programOverrides: { many: 'Program edits', one: 'Program edit' },
  addedSlots: { many: 'added exercises', one: 'added exercise' },
  hrSettings: { many: 'heart rate settings', one: 'heart rate setting' },
}

interface Issue {
  readonly path: readonly PropertyKey[]
  readonly message: string
  readonly code?: string
  /** On an unrecognized-keys issue: the keys, as the file wrote them. */
  readonly keys?: readonly string[]
}
/** What a row's schema offers: a Zod schema, named by the one method used. */
interface RowSchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: readonly Issue[] } }
}

/** The schema and the stored key of each table's rows. */
const TABLES: { [K in BackupTable]: { schema: RowSchema<BackupTables[K][number]>; key: (row: BackupTables[K][number]) => string } } = {
  workouts: { schema: Workout, key: (r) => r.id },
  setLogs: { schema: SetLog, key: (r) => r.id },
  morningChecks: { schema: MorningCheck, key: (r) => r.id },
  runs: { schema: Run, key: (r) => r.id },
  gateTests: { schema: GateTest, key: (r) => r.id },
  sessionMoves: { schema: SessionMove, key: (r) => r.id },
  locations: { schema: Location, key: (r) => r.id },
  programOverrides: { schema: ProgramOverride, key: (r) => r.slotId },
  addedSlots: { schema: AddedSlot, key: (r) => r.id },
  hrSettings: { schema: HrSettings, key: (r) => r.id },
}

/** A row's stored key (its id, or a Program edit's slot id). */
export function rowKey<K extends BackupTable>(table: K, row: BackupTables[K][number]): string {
  return TABLES[table].key(row)
}

/** Code-unit order, as IndexedDB orders string keys, so a file lists rows as the phone read them. */
function byKey<K extends BackupTable>(table: K, rows: readonly BackupTables[K][number][]): BackupTables[K][number][] {
  return [...rows].sort((a, b) => {
    const x = rowKey(table, a)
    const y = rowKey(table, b)
    return x < y ? -1 : x > y ? 1 : 0
  })
}

/**
 * Text for a refusal, safe to show: control characters a space, format characters (a right-to-left
 * override, a zero-width joiner) gone, cut to `max` characters (code points, so an emoji is never
 * split) with an ellipsis.
 */
function plain(text: string, max: number): string {
  const chars = [...text.replace(/\p{Cc}/gu, ' ').replace(/\p{Cf}/gu, '')]
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('')
}

/** Text from the file, cut short and stripped of control and format characters, before a refusal quotes it. */
function quoted(text: string): string {
  return `“${plain(text, 40)}”`
}

/**
 * The first issue in words. Zod's message for a key the schema doesn't know repeats the key whole,
 * however long, so that one is said here with the key quoted short; every other message is the
 * schema's own words, and is cut short too.
 */
function issueWords(issues: readonly Issue[]): string {
  const issue = issues[0]
  if (!issue) return 'it is not what the app stores'
  const where = plain(issue.path.map(String).join('.'), 40)
  const [key, ...more] = issue.code === 'unrecognized_keys' ? (issue.keys ?? []) : []
  const what = key !== undefined ? `a part the app doesn’t keep, ${quoted(key)}${more.length > 0 ? `, and ${more.length} more` : ''}` : plain(issue.message, 120)
  return where ? `${where}: ${what}` : what
}

// ---------------------------------------------------------------------------------------------
// Export

export interface ExportResult {
  backup: Backup
  /** Rows stored on the phone that no longer read as the app stores them: kept in the file as they are, and named, since an import would refuse them. */
  unreadable: string[]
}

/**
 * The file for what the phone holds, at `exportedAt`. Every row is read through its schema, so the
 * file lists each one as the app writes it (an M3 settings row gets M4b's gym and bag defaults) and
 * in key order; a row that fails is written as stored, never dropped, and named in `unreadable`.
 * Throws, in words, when there are no settings to export.
 */
export function buildBackup(stored: StoredContents, exportedAt: IsoDateTime): ExportResult {
  if (!stored.settings) throw new Error('There are no settings on this phone to export yet. Open Today once so the app can seed them.')
  const unreadable: string[] = []
  const { lastExportedAt: _phoneOnly, ...settingsRow } = stored.settings
  void _phoneOnly
  const settings = FileSettings.safeParse(settingsRow)
  if (!settings.success) unreadable.push(`The settings (${issueWords(settings.error.issues)}).`)

  function table<K extends BackupTable>(name: K): BackupTables[K] {
    const { schema } = TABLES[name]
    const rows = byKey(name, stored[name]).map((row) => {
      const parsed = schema.safeParse(row)
      if (parsed.success) return parsed.data
      unreadable.push(`The ${TABLE_WORDS[name].one} ${quoted(rowKey(name, row))} (${issueWords(parsed.error.issues)}).`)
      return row
    })
    return rows as BackupTables[K]
  }

  const backup: Backup = {
    app: BACKUP_APP,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt,
    settings: settings.success ? settings.data : settingsRow,
    workouts: table('workouts'),
    setLogs: table('setLogs'),
    morningChecks: table('morningChecks'),
    runs: table('runs'),
    gateTests: table('gateTests'),
    sessionMoves: table('sessionMoves'),
    locations: table('locations'),
    programOverrides: table('programOverrides'),
    addedSlots: table('addedSlots'),
    hrSettings: table('hrSettings'),
  }
  return { backup, unreadable }
}

/** The file's text: two-space JSON with a final newline, so the same data is the same bytes. */
export function backupText(backup: Backup): string {
  return `${JSON.stringify(backup, null, 2)}\n`
}

/** `knee-rebuild-YYYY-MM-DD.json`, dated the day it is written. */
export function backupFileName(today: IsoDate): string {
  return `${BACKUP_APP}-${today}.json`
}

// ---------------------------------------------------------------------------------------------
// Import

export type BackupRead = { ok: true; backup: Backup; migratedFrom: number | null } | { ok: false; refusal: string }

type FileObject = Record<string, unknown>

function isObject(value: unknown): value is FileObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A file bigger than any backup this app writes, in words; null when the size is fine. */
export function sizeProblem(bytes: number): string | null {
  if (bytes <= BACKUP_MAX_BYTES) return null
  const mb = (n: number) => `${Math.floor((n / (1024 * 1024)) * 10) / 10} MB`
  return `This file is ${mb(bytes)}, past the ${mb(BACKUP_MAX_BYTES)} no backup of this app comes near, so it isn’t one. Nothing was imported.`
}

/**
 * One step per older version, each carrying a file one version forward. Version 2's tables are
 * version 3's without the gyms (the home gym is written at launch, as on a phone that ran version
 * 2); version 3's are version 4's without the Program screen's edits; version 4's are version 5's
 * without the exercises Shawn adds to a session; version 5's are version 6's as they stand (metrics
 * phase 1 adds only optional fields: a run's RPE, a session's RPE and minutes; an older run keeps its
 * effort word, which training load reads as 3, 5 or 8); version 6's are version 7's without the
 * heart-rate settings list (metrics phase 2: a run's average and max heart rate are optional
 * fields, and no heart rate is ever invented). A list the file already has is left for the schema
 * to judge, never replaced.
 */
export const MIGRATIONS: Readonly<Record<number, (file: FileObject) => FileObject>> = {
  2: (file) => ({ ...withList(file, 'locations'), schemaVersion: 3 }),
  3: (file) => ({ ...withList(file, 'programOverrides'), schemaVersion: 4 }),
  4: (file) => ({ ...withList(file, 'addedSlots'), schemaVersion: 5 }),
  5: (file) => ({ ...file, schemaVersion: 6 }),
  6: (file) => ({ ...withList(file, 'hrSettings'), schemaVersion: 7 }),
}

function withList(file: FileObject, key: BackupTable): FileObject {
  return key in file ? file : { ...file, [key]: [] }
}

/** A file at a version from OLDEST_SCHEMA_VERSION up, carried to BACKUP_SCHEMA_VERSION one step at a time. */
export function migrateForward(file: FileObject & { schemaVersion: number }): FileObject {
  let current: FileObject = file
  let version = file.schemaVersion
  while (version < BACKUP_SCHEMA_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) throw new Error(`no step carries a version ${version} backup forward`)
    current = step(current)
    const next = current.schemaVersion
    if (typeof next !== 'number' || next <= version) throw new Error(`the version ${version} step did not move the backup forward`)
    version = next
  }
  return current
}

/**
 * Reads a backup file's text strictly, whole, before anything on the phone is touched: another
 * app's file, a newer schema version, or any row the app wouldn't store is refused in one sentence
 * that says why. An older version is carried forward first. Nothing here writes.
 */
export function parseBackup(text: string): BackupRead {
  const size = sizeProblem(text.length)
  if (size) return { ok: false, refusal: size }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, refusal: 'This file isn’t a Knee Rebuild backup: it doesn’t read as JSON. Nothing was imported.' }
  }
  return backupFrom(raw)
}

/** `parseBackup` after JSON: the checks on the parsed value. */
export function backupFrom(raw: unknown): BackupRead {
  const refuse = (refusal: string): BackupRead => ({ ok: false, refusal: `${refusal} Nothing was imported.` })
  if (!isObject(raw) || !('app' in raw)) return refuse('This file isn’t a Knee Rebuild backup: it doesn’t name the app that wrote it.')
  if (raw.app !== BACKUP_APP) return refuse('This file is from another app, not Knee Rebuild.')
  const version = raw.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return refuse('This backup has no schema version, so the app can’t tell how to read it.')
  if (version > BACKUP_SCHEMA_VERSION) {
    return refuse(
      `This backup is from a newer version of the app (schema version ${version}; this one reads up to ${BACKUP_SCHEMA_VERSION}). Open the app with a signal and tap Reload now when “A new version is ready” shows, then import it again.`,
    )
  }
  if (version < OLDEST_SCHEMA_VERSION) return refuse(`This backup says schema version ${version}, and no backup was ever written below version ${OLDEST_SCHEMA_VERSION}, so the app can’t read it.`)

  let file: FileObject
  try {
    file = migrateForward({ ...raw, schemaVersion: version })
  } catch (e) {
    return refuse(`This version ${version} backup couldn’t be carried forward (${e instanceof Error ? e.message : String(e)}).`)
  }

  const extra = Object.keys(file).find((key) => !FILE_KEYS.includes(key))
  if (extra !== undefined) return refuse(`This backup has a part the app doesn’t keep, ${quoted(extra)}.`)
  const exportedAt = IsoDateTime.safeParse(file.exportedAt)
  if (!exportedAt.success) return refuse('This backup doesn’t say when it was exported.')
  if (!('settings' in file)) return refuse('This backup has no settings.')
  const settings = FileSettings.safeParse(file.settings)
  if (!settings.success) return refuse(`This backup’s settings don’t read as the app stores them (${issueWords(settings.error.issues)}).`)

  const tables: Partial<BackupTables> = {}
  for (const name of BACKUP_TABLES) {
    const result = readTable(name, file[name])
    if (!result.ok) return refuse(result.refusal)
    assign(tables, name, result.rows)
  }

  const backup: Backup = {
    app: BACKUP_APP,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: exportedAt.data,
    settings: settings.data,
    workouts: tables.workouts ?? [],
    setLogs: tables.setLogs ?? [],
    morningChecks: tables.morningChecks ?? [],
    runs: tables.runs ?? [],
    gateTests: tables.gateTests ?? [],
    sessionMoves: tables.sessionMoves ?? [],
    locations: tables.locations ?? [],
    programOverrides: tables.programOverrides ?? [],
    addedSlots: tables.addedSlots ?? [],
    hrSettings: tables.hrSettings ?? [],
  }
  return { ok: true, backup, migratedFrom: version === BACKUP_SCHEMA_VERSION ? null : version }
}

function assign<K extends BackupTable>(tables: Partial<BackupTables>, name: K, rows: BackupTables[K]): void {
  tables[name] = rows
}

/** One table's list: present, a list, every row as the app stores it, and each key once (two rows on one key would leave one silently). */
function readTable<K extends BackupTable>(name: K, value: unknown): { ok: true; rows: BackupTables[K] } | { ok: false; refusal: string } {
  const words = TABLE_WORDS[name]
  if (value === undefined) return { ok: false, refusal: `This backup has no list of ${words.many}.` }
  if (!Array.isArray(value)) return { ok: false, refusal: `This backup’s ${words.many} aren’t a list.` }
  const { schema } = TABLES[name]
  const rows: BackupTables[K][number][] = []
  const seen = new Set<string>()
  for (const [index, row] of value.entries()) {
    const parsed = schema.safeParse(row)
    if (!parsed.success) {
      return { ok: false, refusal: `This backup’s ${words.many}, row ${index + 1}, doesn’t read as the app stores it (${issueWords(parsed.error.issues)}).` }
    }
    const key = rowKey(name, parsed.data)
    if (seen.has(key)) return { ok: false, refusal: `This backup lists the ${words.one} ${quoted(key)} twice.` }
    seen.add(key)
    rows.push(parsed.data)
  }
  return { ok: true, rows: rows as BackupTables[K] }
}

// ---------------------------------------------------------------------------------------------
// What a file holds

export interface BackupSummary {
  counts: Record<BackupTable, number>
  /** Gyms that have left the lists; `counts.locations` counts every gym stored. */
  archivedGyms: number
  /** The first and last day anything was logged (a session, run, morning check or gate test); null with nothing logged. */
  first: IsoDate | null
  last: IsoDate | null
}

type Dated = Pick<BackupTables, 'workouts' | 'runs' | 'morningChecks' | 'gateTests'>

/** The first and last day anything was logged; nulls with nothing logged. */
export function loggedRange(tables: Dated): { first: IsoDate | null; last: IsoDate | null } {
  const dates = [...tables.workouts, ...tables.runs, ...tables.morningChecks, ...tables.gateTests].map((row) => row.date).sort()
  return { first: dates[0] ?? null, last: dates.at(-1) ?? null }
}

/** What a file, or the phone, holds: each table's count and the days it covers ("312 sets, 41 runs, 3 gyms, from Nov 2 to Dec 20"). */
export function summarize(tables: BackupTables): BackupSummary {
  const counts = Object.fromEntries(BACKUP_TABLES.map((name) => [name, tables[name].length])) as Record<BackupTable, number>
  return { counts, archivedGyms: tables.locations.filter((l) => l.archived).length, ...loggedRange(tables) }
}

/**
 * What an import would erase: per table, the rows on the phone whose key the file doesn't have (a
 * session logged after the file was written, say), in file order, tables with none left out. An
 * import replaces, never merges, so the confirm names these first.
 */
export function lostOnImport(phone: BackupTables, file: BackupTables): { table: BackupTable; count: number }[] {
  const lost: { table: BackupTable; count: number }[] = []
  for (const name of BACKUP_TABLES) {
    const kept = new Set(keysOf(name, file))
    const count = keysOf(name, phone).filter((key) => !kept.has(key)).length
    if (count > 0) lost.push({ table: name, count })
  }
  return lost
}

function keysOf<K extends BackupTable>(name: K, tables: BackupTables): string[] {
  return (tables[name] as BackupTables[K][number][]).map((row) => rowKey(name, row))
}

/**
 * The red-flag state an import leaves (PROGRAM-QUESTIONS 128). Rule 9 lifts a red flag only from
 * Settings, with a note, so an import never lifts one the phone has on: an older file's clear state
 * leaves it as it is, and a file with a flag on too joins it (each item once, the phone's first,
 * from the earlier day). With the phone's flag off, or no settings on the phone yet, the file's
 * state comes in whole, its last clear and note included. Everything else an import replaces.
 */
export function redFlagOnImport(phone: RedFlagState | undefined, file: RedFlagState): RedFlagState {
  if (!phone?.active) return file
  if (!file.active) return phone
  const since = [phone.since, file.since].filter((d): d is IsoDate => d !== undefined).sort()[0]
  return { active: true, ...(since !== undefined ? { since } : {}), items: [...new Set([...phone.items, ...file.items])] }
}

/** A setting the file would change, the phone's value then the file's. */
export type SettingChange =
  | { field: 'injuredSide'; phone: Side; file: Side }
  | { field: 'startDate'; phone: IsoDate; file: IsoDate }
  | { field: 'currentPhase'; phone: number; file: number }
  | { field: 'phaseEnteredWeek'; phone: number; file: number }

export interface SettingsOnImport {
  /** The red flag the phone has on that the file's settings don't carry, which the import keeps on (`redFlagOnImport`); null when the file carries it all. */
  keptRedFlag: RedFlagState | null
  /** The settings that set the plan which the file changes, in the order Settings lists them; empty with no settings on the phone. */
  changes: SettingChange[]
}

/**
 * What an import does to the settings, for the confirm to name next to the row counts (question
 * 123 counts rows by key, so a changed settings row is never counted): the red flag it keeps on,
 * and the injured side, start date, phase and the week it was entered that the file changes.
 */
export function settingsOnImport(phone: Settings | undefined, file: FileSettings): SettingsOnImport {
  if (!phone) return { keptRedFlag: null, changes: [] }
  const flag = redFlagOnImport(phone.redFlag, file.redFlag)
  const carried = flag.active === file.redFlag.active && flag.since === file.redFlag.since && flag.items.length === file.redFlag.items.length
  const changes: SettingChange[] = []
  if (phone.injuredSide !== file.injuredSide) changes.push({ field: 'injuredSide', phone: phone.injuredSide, file: file.injuredSide })
  if (phone.startDate !== file.startDate) changes.push({ field: 'startDate', phone: phone.startDate, file: file.startDate })
  if (phone.currentPhase !== file.currentPhase) changes.push({ field: 'currentPhase', phone: phone.currentPhase, file: file.currentPhase })
  if (phone.phaseEnteredWeek !== file.phaseEnteredWeek) changes.push({ field: 'phaseEnteredWeek', phone: phone.phaseEnteredWeek, file: file.phaseEnteredWeek })
  return { keptRedFlag: carried ? null : flag, changes }
}

// ---------------------------------------------------------------------------------------------
// The export reminder

/** Today says so once the last export is more than this many days old (iOS can evict a home-screen app's storage). */
export const EXPORT_NUDGE_DAYS = 7

/** The day, in America/New_York, an instant fell on: the day an export was written. */
export function exportDay(at: IsoDateTime): IsoDate {
  return todayIn(new Date(at))
}

/**
 * The stamp an import records as the last export (PROGRAM-QUESTIONS 121): the file's `exportedAt`,
 * or, when the file says it was written after the import's own moment `now` (a clock set ahead, a
 * hand edit), `now`, so no file can keep Today's reminder quiet past a week from the import.
 */
export function importStamp(exportedAt: IsoDateTime, now: IsoDateTime): IsoDateTime {
  return Date.parse(exportedAt) > Date.parse(now) ? now : exportedAt
}

/** Whole days from the last export's day to today (0 the same day); null when this phone has never exported. */
export function daysSinceExport(lastExportedAt: IsoDateTime | undefined, today: IsoDate): number | null {
  if (lastExportedAt === undefined) return null
  return Math.max(0, daysBetween(exportDay(lastExportedAt), today))
}

export type ExportNudge = { kind: 'since-export'; days: number } | { kind: 'never-exported'; days: number }

/**
 * Whether Today says the backup is stale, and by how much: once the last export is more than
 * EXPORT_NUDGE_DAYS old, or, never exported, once the first thing logged is. Nothing logged and
 * never exported: nothing on the phone to lose, so nothing to say.
 */
export function exportNudge(lastExportedAt: IsoDateTime | undefined, today: IsoDate, firstLogged: IsoDate | null): ExportNudge | null {
  const since = daysSinceExport(lastExportedAt, today)
  if (since !== null) return since > EXPORT_NUDGE_DAYS ? { kind: 'since-export', days: since } : null
  if (firstLogged === null) return null
  const days = daysBetween(firstLogged, today)
  return days > EXPORT_NUDGE_DAYS ? { kind: 'never-exported', days } : null
}
