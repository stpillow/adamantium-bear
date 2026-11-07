import { DAYS, DELOAD_WEEKS, addDays, dayOf, daysBetween, isDeloadWeek, isMonday, weekOf } from '../rules/calendar.ts'
import { rebaseMoves, rebaseWeekNumber } from '../rules/moves.ts'
import { clearRedFlag, stopMessage, type RedFlagState } from '../rules/redFlags.ts'
import { TABLE_WORDS, daysSinceExport, exportDay, type BackupSummary, type BackupTable, type SettingChange, type SettingsOnImport } from '../rules/backup.ts'
import { HR_MAX_MAX, HR_MAX_MIN, HR_RESTING_MAX, HR_RESTING_MIN, IsoDate, REST_TIMER_MAX, REST_TIMER_MIN, type Day, type HrSettings, type IsoDateTime, type Phase, type RedFlag, type SessionMove, type Settings, type Side } from '../schema/index.ts'

/**
 * Pure helpers for the Settings screen: words for dates, the start-date check, the red-flag state
 * in words, and the limits of each input. Nothing here decides anything about the knee: whether a
 * date is a Monday, what week today is, and whether a red flag may be cleared all come from
 * src/rules; this file names and composes their answers.
 */

const DAY_WORDS: Record<Day, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}

const MONTH_WORDS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** A YYYY-MM-DD date in words, "Monday Nov 2", with no clock or time zone involved. */
export function dateWords(date: IsoDate): string {
  const [, month, day] = date.split('-').map(Number)
  const monthWord = month === undefined ? '' : (MONTH_WORDS[month - 1] ?? '')
  return `${DAY_WORDS[dayOf(date)]} ${monthWord} ${day ?? ''}`.replace(/\s+/g, ' ').trim()
}

export const SIDES: readonly Side[] = ['left', 'right']

export function sideWords(side: Side): string {
  return side === 'left' ? 'Left knee' : 'Right knee'
}

/**
 * The dumbbell section since M4b: each gym's rack is its own (`Location.dumbbellMaxLb`, set in the
 * location editor), and Settings' dumbbell max is frozen, so the section is this line and a link.
 */
export const DUMBBELLS_LINE = 'Dumbbells are set per gym in Where you train.'

/** Under the Phase section, beside a way to the Gates screen: the phase is shown here, and advanced there. */
export const PHASE_NOTE = 'Read-only here. The Gates screen advances the phase once every item of its gate passes and you confirm.'

/** Rest in 15 s steps, from a quarter minute to ten minutes: the stepper's limits are the schema's, so the form and an import refuse the same values. */
export const REST_STEP = 15
export const REST_MIN = REST_TIMER_MIN
export const REST_MAX = REST_TIMER_MAX

/** Heart rate (metrics phase 2): the steppers' limits are the schema's, so the form and an import refuse the same values. Resting's top sits under max's floor, so no on-screen pair can have resting at or over max. */
export const HR_STEP = 1
export { HR_MAX_MAX, HR_MAX_MIN, HR_RESTING_MAX, HR_RESTING_MIN }

/**
 * What an unset heart-rate stepper opens on at the first touch: a starting point for the thumb,
 * named on the button, and stored only when that button is tapped — the app never writes a number
 * Shawn didn't touch (the RPE-picker precedent, PROGRAM-QUESTIONS 145a).
 */
export const HR_MAX_OPEN = 180
export const HR_RESTING_OPEN = 60

/** Under the Heart rate section: what the numbers feed, that unset means no HR load, and that a change rewrites history (the load is computed, never stored). */
export const HR_SECTION_NOTE = 'Feeds the HR load on Progress and the run logger; leave unset for no HR load. The HR load is always computed from the numbers here, never stored, so a change here changes past weeks too.'

/** "Max heart rate: not set." — the unset state in words, never an empty control. */
export function hrUnsetWords(label: string): string {
  return `${label}: not set.`
}

/** The set button's words: the starting number is named before it is tapped, since tapping stores it. */
export function hrSetButtonWords(label: string, opensOn: number): string {
  return `Set ${label.toLowerCase()} (starts at ${opensOn})`
}

/** The clear button's words: where a set number goes back to — the "not set" state the section's note offers for no HR load. */
export function hrClearButtonWords(label: string): string {
  return `Clear ${label.toLowerCase()} (back to not set)`
}

/** A change to one heart-rate number: a value from the stepper, or null to clear it — the field leaves the row, back to "not set". */
export type HrPatch = { maxHr?: number | null; restingHr?: number | null }

/**
 * The row a touched heart-rate control saves: only the touched number changes; the other stays
 * exactly as stored, and is never invented (PROGRAM-QUESTIONS 150). A null clears its field from
 * the row — the schema allows a row with only its id — so "not set" stays reachable after a tap,
 * as the section's note promises. The repo parses it again before writing.
 */
export function hrSavePatch(stored: Pick<HrSettings, 'maxHr' | 'restingHr'> | null | undefined, patch: HrPatch): HrSettings {
  const maxHr = patch.maxHr === null ? undefined : (patch.maxHr ?? stored?.maxHr)
  const restingHr = patch.restingHr === null ? undefined : (patch.restingHr ?? stored?.restingHr)
  return {
    id: 'heart-rate',
    ...(maxHr !== undefined ? { maxHr } : {}),
    ...(restingHr !== undefined ? { restingHr } : {}),
  }
}

/** The Monday on or before a date and the Monday after it: the two a start date can snap to. */
export function mondaysAround(date: IsoDate): [IsoDate, IsoDate] {
  const before = addDays(date, -DAYS.indexOf(dayOf(date)))
  return [before, addDays(before, 7)]
}

export type StartDateCheck = { ok: true; date: IsoDate } | { ok: false; message: string; mondays: IsoDate[] }

/** A date input's value, checked: a real calendar date that is a Monday (PROMPT rule 10: weeks start Monday). */
export function checkStartDate(value: string): StartDateCheck {
  const text = value.trim()
  if (text === '') return { ok: false, message: 'Pick a date. Week 1 starts on it, and the deload weeks hang off it.', mondays: [] }
  const parsed = IsoDate.safeParse(text)
  if (!parsed.success) return { ok: false, message: `"${text}" is not a calendar date.`, mondays: [] }
  const date = parsed.data
  if (isMonday(date)) return { ok: true, date }
  const [before, after] = mondaysAround(date)
  return {
    ok: false,
    message: `${dateWords(date)} is not a Monday. Weeks start on Monday; the nearest are ${dateWords(before)} and ${dateWords(after)}.`,
    mondays: [before, after],
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Where today falls against the start date, in words, so a changed date can be sanity-checked at once. */
export function weekLine(today: IsoDate, startDate: IsoDate): string {
  const week = weekOf(today, startDate)
  if (week >= 1) return `Today, ${dateWords(today)}, is in week ${week}${isDeloadWeek(week) ? ', a deload week' : ''}.`
  const days = daysBetween(today, startDate)
  return `Week 1 starts ${dateWords(startDate)}, ${days === 1 ? 'tomorrow' : `in ${plural(days, 'day')}`}.`
}

export interface StartDateChange {
  /** The stored moves to keep, renumbered so each stays on the dates it was made for. */
  moves: SessionMove[]
  dropped: number
  /** How many moves were dropped, in words; null when none was. */
  notice: string | null
  /** The week the current phase was entered, kept on its calendar week (PROGRAM-QUESTIONS 61). */
  phaseEnteredWeek: number
}

/**
 * What a new start date does to the stored session moves: the rule (src/rules/moves) renumbers
 * each one so it stays on its calendar dates and drops any that now fall before week 1; this names
 * how many were dropped. Throws, as the rule does, when the dates are not whole weeks apart.
 */
export function startDateChange(oldStart: IsoDate, newStart: IsoDate, moves: readonly SessionMove[], phaseEnteredWeek = 1): StartDateChange {
  const rebased = rebaseMoves(moves, oldStart, newStart)
  return {
    ...rebased,
    notice: droppedMovesWords(rebased.dropped, rebased.moves.length),
    phaseEnteredWeek: rebaseWeekNumber(phaseEnteredWeek, oldStart, newStart),
  }
}

/** "1 session move was for a week before the new week 1, so it was dropped. The other 2 stay on the dates they were made for." */
export function droppedMovesWords(dropped: number, kept: number): string | null {
  if (dropped === 0) return null
  const lead =
    dropped === 1
      ? '1 session move was for a week before the new week 1, so it was dropped.'
      : `${dropped} session moves were for weeks before the new week 1, so they were dropped.`
  if (kept === 0) return lead
  return kept === 1 ? `${lead} The other one stays on the dates it was made for.` : `${lead} The other ${kept} stay on the dates they were made for.`
}

/** "Deload weeks are 4, 8 and 12 from it.", read from the rule's own list so the screen never restates it by hand. */
export function deloadWeeksLine(weeks: readonly number[] = DELOAD_WEEKS): string {
  const words = weeks.map(String)
  const last = words.pop()
  if (last === undefined) return 'There are no deload weeks.'
  const list = words.length === 0 ? last : `${words.join(', ')} and ${last}`
  return `Deload weeks are ${list} from it.`
}

/** "45 s", "1 min", "1 min 30 s". */
export function restTimerWords(seconds: number): string {
  const min = Math.floor(seconds / 60)
  const s = seconds % 60
  if (min === 0) return `${s} s`
  return s === 0 ? `${min} min` : `${min} min ${s} s`
}

export function painWords(painPerSet: boolean): string {
  return painPerSet ? 'Per set: a pain stepper on every set.' : 'Per exercise: one pain number per exercise, written on each of its sets.'
}

/** "Phase 1: Foundation" and the week it was entered. Read-only on this screen; Gates advances it. */
export function phaseWords(
  settings: Pick<Settings, 'currentPhase' | 'phaseEnteredWeek'>,
  phases: readonly Pick<Phase, 'number' | 'name'>[],
): { title: string; entered: string } {
  const name = phases.find((p) => p.number === settings.currentPhase)?.name
  return {
    title: name ? `Phase ${settings.currentPhase}: ${name}` : `Phase ${settings.currentPhase}`,
    entered: `Entered in week ${settings.phaseEnteredWeek}.`,
  }
}

export type RedFlagView = { active: true; headline: string; since: string | null; items: string[] } | { active: false; cleared: string | null }

/** The red-flag state in words, from the engine's stop message; when off, how it was last cleared. */
export function redFlagView(state: RedFlagState, catalog: readonly RedFlag[]): RedFlagView {
  const stop = stopMessage(state, catalog)
  if (stop) {
    return { active: true, headline: stop.headline, since: state.since ? `Flagged since ${dateWords(state.since)}.` : null, items: stop.items }
  }
  if (!state.clearedOn) return { active: false, cleared: null }
  const note = state.clearNote ? `: “${state.clearNote}”` : ''
  return { active: false, cleared: `Last cleared ${dateWords(state.clearedOn)}${note}.` }
}

export type ClearResult = { ok: true; settings: Settings } | { ok: false; refusal: string }

/** The settings with the red-flag state cleared on `today`, or the rule's refusal (an empty note) in words. */
export function clearedSettings(settings: Settings, note: string, today: IsoDate): ClearResult {
  try {
    return { ok: true, settings: { ...settings, redFlag: clearRedFlag(settings.redFlag, note, today) } }
  } catch (e) {
    return { ok: false, refusal: `Not cleared: ${errorWords(e)}.` }
  }
}

/** A rejected write, in words. */
export function errorWords(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.trim().length > 0 ? text.trim() : 'no reason was given'
}

/** How Reset all data ended: everything erased and the defaults seeded, nothing erased, or erased with the defaults not saved. */
export type ResetOutcome = { kind: 'erased' } | { kind: 'not-erased'; error: unknown } | { kind: 'not-seeded'; error: unknown }

/** What a reset came to, one sentence, said in the Reset section where Yes was tapped; `problem` when it didn't go as asked. */
export function resetWords(outcome: ResetOutcome): { text: string; problem: boolean } {
  switch (outcome.kind) {
    case 'erased':
      return { text: 'Everything on this phone was erased. Settings are back to their defaults.', problem: false }
    case 'not-erased':
      return { text: `Nothing was erased (${errorWords(outcome.error)}); tap again to retry.`, problem: true }
    case 'not-seeded':
      return { text: `Everything was erased, but the default settings did not save (${errorWords(outcome.error)}); reload the app to seed them again.`, problem: true }
  }
}

/** What writes the whole phone while the rest of Settings waits. */
export type FormHold = 'import' | 'reset'

/**
 * While an import or a reset writes, the rest of the form waits, and says so in words: a change
 * saved then would write the settings this screen holds, the old ones, over what the import or the
 * reset wrote. `note` sits in each waiting section; `refusal` answers a tap that came in anyway.
 */
export function heldWords(hold: FormHold): { note: string; refusal: string } {
  const did = hold === 'import' ? 'the import was replacing' : 'Reset was erasing'
  const note = hold === 'import' ? 'Waits while the import replaces everything on this phone.' : 'Waits while Reset erases everything on this phone.'
  return { note, refusal: `Not saved: ${did} everything on this phone. Tap it again once it’s done.` }
}

// ---------------------------------------------------------------------------------------------
// Backup: export and import (M6). What a file is and whether it may be imported is
// src/rules/backup.ts's call; these name its answers and pick how the phone hands the file over.

/** The inline confirm before an import (M6 brief, section 2). */
export const IMPORT_CONFIRM = 'Replace everything on this phone with this file?'

/** "Last export: 9 days ago." from the stored stamp, counted in America/New_York days by the rule. */
export function lastExportWords(lastExportedAt: IsoDateTime | undefined, today: IsoDate): string {
  const days = daysSinceExport(lastExportedAt, today)
  if (days === null) return 'No export from this phone yet.'
  if (days === 0) return 'Last export: today.'
  if (days === 1) return 'Last export: yesterday.'
  return `Last export: ${days} days ago.`
}

/** "Monday Dec 21": the day a file was written, in New York; "Monday Dec 21, 2026" when that isn't this year (`today`'s). */
export function exportedOnWords(exportedAt: IsoDateTime, today: IsoDate): string {
  const day = exportDay(exportedAt)
  return day.slice(0, 4) === today.slice(0, 4) ? dateWords(day) : `${dateWords(day)}, ${day.slice(0, 4)}`
}

/** "a", "a and b", "a, b and c". */
function andList(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`
}

function count(table: BackupTable, n: number): string {
  return `${n} ${n === 1 ? TABLE_WORDS[table].one : TABLE_WORDS[table].many}`
}

/** "Nov 2", or "Nov 2, 2026" when the year has to be said. */
function shortDate(date: IsoDate, withYear: boolean): string {
  const [year, month, day] = date.split('-').map(Number)
  const monthWord = month === undefined ? '' : (MONTH_WORDS[month - 1] ?? '')
  return withYear ? `${monthWord} ${day ?? ''}, ${year ?? ''}` : `${monthWord} ${day ?? ''}`
}

/** "from Nov 2 to Dec 20", "on Nov 2", "from Dec 28, 2026 to Jan 3, 2027"; null with nothing logged. */
export function rangeWords(first: IsoDate | null, last: IsoDate | null): string | null {
  if (first === null || last === null) return null
  const years = first.slice(0, 4) !== last.slice(0, 4)
  if (first === last) return `on ${shortDate(first, false)}`
  return `from ${shortDate(first, years)} to ${shortDate(last, years)}`
}

/**
 * What a file, or the phone, holds, in the brief's words: "312 sets, 41 runs, 3 gyms, from Nov 2
 * to Dec 20", then the rest that is there ("Also 24 sessions, 30 morning checks and 2 Program
 * edits."), or null when nothing else is. Gyms count the listed ones; archived ones are in the rest.
 */
export function holdsWords(summary: BackupSummary): { headline: string; also: string | null } {
  const { counts } = summary
  const listed = counts.locations - summary.archivedGyms
  const range = rangeWords(summary.first, summary.last)
  const head = `${count('setLogs', counts.setLogs)}, ${count('runs', counts.runs)}, ${count('locations', listed)}`
  const headline = range ? `${head}, ${range}` : `${head}; nothing logged yet`
  const rest = (['workouts', 'morningChecks', 'gateTests', 'sessionMoves', 'programOverrides'] as const).filter((t) => counts[t] > 0).map((t) => count(t, counts[t]))
  if (summary.archivedGyms > 0) rest.push(`${summary.archivedGyms} archived ${summary.archivedGyms === 1 ? 'gym' : 'gyms'}`)
  return { headline, also: rest.length > 0 ? `Also ${andList(rest)}.` : null }
}

/** `holdsWords` as one sentence: the headline, then the rest when there is any. */
export function holdsLine(summary: BackupSummary): string {
  const { headline, also } = holdsWords(summary)
  return also ? `${headline}. ${also}` : `${headline}.`
}

/** What a finished import says, in the Import section where Yes was tapped: the file's name and what the phone now holds. */
export function importedWords(fileName: string, summary: BackupSummary): string {
  return `Imported ${fileName}. This phone now holds what the file holds: ${holdsLine(summary)}`
}

/** "It would erase 8 sets and 1 run on this phone that the file doesn’t have.", or null when the file has everything the phone does. */
export function lostWords(lost: readonly { table: BackupTable; count: number }[]): string | null {
  if (lost.length === 0) return null
  return `It would erase ${andList(lost.map((l) => count(l.table, l.count)))} on this phone that the file doesn’t have.`
}

/** "Phase 2 (Single-leg strength and balance)", or "Phase 4" when the program names no such phase. */
function phaseName(number: number, phases: readonly Pick<Phase, 'number' | 'name'>[]): string {
  const name = phases.find((p) => p.number === number)?.name
  return name ? `Phase ${number} (${name})` : `Phase ${number}`
}

/** One setting the file changes, in a sentence: the phone's value, then the file's. */
function settingChangeWords(change: SettingChange, phases: readonly Pick<Phase, 'number' | 'name'>[]): string {
  switch (change.field) {
    case 'injuredSide':
      return `It would change the injured side from the ${sideWords(change.phone).toLowerCase()} to the ${sideWords(change.file).toLowerCase()}.`
    case 'startDate': {
      const years = change.phone.slice(0, 4) !== change.file.slice(0, 4)
      const day = (date: IsoDate) => (years ? `${dateWords(date)}, ${date.slice(0, 4)}` : dateWords(date))
      return `It would move the start date from ${day(change.phone)} to ${day(change.file)}.`
    }
    case 'currentPhase':
      return `It would change the phase from ${phaseName(change.phone, phases)} to ${phaseName(change.file, phases)}.`
    case 'phaseEnteredWeek':
      return `It would change the week the phase was entered from week ${change.phone} to week ${change.file}.`
  }
}

/**
 * What an import does to the settings (src/rules/backup.ts `settingsOnImport`), said before the
 * confirm beside the row counts, which can't show it: the red flag the phone has on that the import
 * keeps on (PROGRAM-QUESTIONS 128: it clears only here, with a note), and each setting the plan
 * hangs off that the file changes.
 */
export function settingsOnImportWords(
  on: SettingsOnImport,
  catalog: readonly RedFlag[],
  phases: readonly Pick<Phase, 'number' | 'name'>[],
): { redFlag: string | null; changes: string[] } {
  const flag = on.keptRedFlag
  const stop = flag ? stopMessage(flag, catalog) : null
  let redFlag: string | null = null
  if (flag && stop) {
    const set = flag.since ? `The red flag set ${dateWords(flag.since)}` : 'The red flag on this phone'
    const items = stop.items.length > 0 ? `: ${stop.items.join('; ')}` : ''
    redFlag = `${set} stays on after the import${items}. It clears only here, with a note.`
  }
  return { redFlag, changes: on.changes.map((change) => settingChangeWords(change, phases)) }
}

/** A file from an older app, carried forward: said so, so a surprise in it has a reason. */
export function migratedWords(from: number | null): string | null {
  return from === null ? null : `Written by an older version of the app (schema version ${from}); it was read forward to this one.`
}

/** What can share a file: the browser's navigator, or a stand-in in a test. */
export interface ShareTarget {
  share?: unknown
  canShare?: (data: { files: File[] }) => boolean
}

/**
 * How the phone hands the file over (M6 brief): the share sheet where it takes files (iOS 15 on:
 * Save to Files, AirDrop), else a download link. A share sheet that can't take a file is no use.
 */
export function shareRoute(target: ShareTarget | undefined, file: File): 'share' | 'download' {
  if (!target || typeof target.share !== 'function' || typeof target.canShare !== 'function') return 'download'
  try {
    return target.canShare({ files: [file] }) ? 'share' : 'download'
  } catch {
    return 'download'
  }
}

/** Why a share didn't finish: closed by hand, refused for want of a fresh tap, or failed outright. */
export function shareFailure(error: unknown): 'closed' | 'needs-tap' | 'failed' {
  const name = typeof error === 'object' && error !== null && 'name' in error ? (error as { name: unknown }).name : null
  if (name === 'AbortError') return 'closed'
  if (name === 'NotAllowedError') return 'needs-tap'
  return 'failed'
}
