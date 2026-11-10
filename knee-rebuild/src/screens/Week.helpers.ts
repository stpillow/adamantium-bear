import type { History } from '../db/repo.ts'
import type { EngineMode } from '../rules/engineMode.ts'
import { ownFlagNote, writtenWeekMiles } from '../rules/written.ts'
import { DAYS, addDays, dateOf, isDeloadWeek, weekOf, weekSchedule } from '../rules/calendar.ts'
import { attachChecks, subjectReadings } from '../rules/history.ts'
import { isSwap } from '../rules/mileage.ts'
import { dayMovable, undoableMove, type MoveContext } from '../rules/moves.ts'
import { morningCheckApplies, worst } from '../rules/reading.ts'
import { lateFlagNote, stopMessage } from '../rules/redFlags.ts'
import { downPeriodWords, isPaused, lastPausedDay } from '../rules/downPeriod.ts'
import { readingsInWeek, runTypeFor, weekDays, weekMilesSummary, type DayStatus, type WeekDay, type WeekMiles } from '../rules/weekPlan.ts'
import type { Day, DaySession, DownPeriod, IsoDate, MorningCheck, Program, ReadingResult, SessionMove, SessionTemplate, Settings, WeeklyTemplate, Workout } from '../schema/index.ts'
import { lateCheckOffer, weekLateFlagWords, weekOwnFlagWords } from './MorningCheck.helpers.ts'
import { timeWords } from './RunLogger.helpers.ts'
import { runLabel, sessionLabel, shortDateWords, workoutLabel } from './Today.helpers.ts'

/**
 * Pure helpers for the Week screen: which weeks can be shown, the words for the header, the
 * miles line, each day's row and the moves, and the ids new moves are stored under. Every knee
 * decision (the capped target, each day's status and reading, the schedule after moves) is asked
 * of src/rules; this file only composes the answers and names them.
 */

export type HistoryLike = Pick<History, 'workouts' | 'setLogs' | 'morningChecks' | 'runs' | 'sessionMoves' | 'downPeriods'>
export type ProgramLike = Pick<Program, 'weeklyTemplate' | 'weeklyTemplateRows' | 'mileagePlan' | 'templates' | 'redFlags'>

/** The program's length: the screen pages through weeks 1 to 12, and on to the current week once past it. */
export const PROGRAM_WEEKS = 12

export const WEEKDAY: Record<Day, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthAndDay(date: IsoDate): { month: string; day: number } {
  const [, m, d] = date.split('-').map(Number)
  const month = m === undefined ? undefined : MONTH_SHORT[m - 1]
  if (month === undefined || d === undefined || Number.isNaN(d)) throw new RangeError(`not a YYYY-MM-DD date: ${date}`)
  return { month, day: d }
}

/** The weeks the previous and next buttons step through: 1 to 12, and every week up to the current one when it is past 12. */
export function weekChoices(currentWeek: number): number[] {
  return Array.from({ length: Math.max(PROGRAM_WEEKS, currentWeek) }, (_, i) => i + 1)
}

/** The week the screen opens on: the current program week, or week 1 before the program starts. */
export function openingWeek(currentWeek: number): number {
  return currentWeek < 1 ? 1 : currentWeek
}

/** The week on screen: the one picked, when it is still a choice, else the opening week. */
export function shownWeek(selected: number | null, currentWeek: number): number {
  return selected !== null && weekChoices(currentWeek).includes(selected) ? selected : openingWeek(currentWeek)
}

/** The weeks one step back and one step forward, or null at either end. */
export function neighbourWeeks(week: number, currentWeek: number): { prev: number | null; next: number | null } {
  const choices = weekChoices(currentWeek)
  const i = choices.indexOf(week)
  if (i === -1) return { prev: null, next: null }
  return { prev: choices[i - 1] ?? null, next: choices[i + 1] ?? null }
}

/** "Nov 16–22", or "Nov 30–Dec 6" when the week crosses a month. */
export function weekSpanWords(startDate: IsoDate, week: number): string {
  const first = monthAndDay(dateOf(startDate, week, 'mon'))
  const last = monthAndDay(dateOf(startDate, week, 'sun'))
  return first.month === last.month ? `${first.month} ${first.day}–${last.day}` : `${first.month} ${first.day}–${last.month} ${last.day}`
}

/** "Week 3 · Nov 16–22". */
export function weekHeader(startDate: IsoDate, week: number): string {
  return `Week ${week} · ${weekSpanWords(startDate, week)}`
}

/** Where the week on screen sits from today: "This week", "Next week", "3 weeks ago". */
export function relationWords(week: number, currentWeek: number, startDate: IsoDate): string {
  if (currentWeek < 1) return `The program starts ${shortDateWords(startDate)}`
  const diff = week - currentWeek
  if (diff === 0) return 'This week'
  if (diff === -1) return 'Last week'
  if (diff === 1) return 'Next week'
  return diff < 0 ? `${-diff} weeks ago` : `In ${diff} weeks`
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "2 runs and 1 swap", "3 runs", "1 swap", or "no runs logged". */
export function countWords(runs: number, swaps: number): string {
  const parts: string[] = []
  if (runs > 0) parts.push(plural(runs, 'run'))
  if (swaps > 0) parts.push(plural(swaps, 'swap'))
  return parts.length ? parts.join(' and ') : 'no runs logged'
}

/** "6 of 12 miles · 2 runs and 1 swap"; "6 miles · …" for a week outside the plan. Swaps add no miles. */
export function milesWords(summary: WeekMiles): string {
  const runs = summary.sessions - summary.swaps
  const counts = countWords(runs, summary.swaps)
  const { target } = summary.target
  const miles = target === null ? plural(summary.miles, 'mile') : `${summary.miles} of ${plural(target, 'mile')}`
  return `${miles} · ${counts}`
}

/**
 * The target's reason in words: "Capped at last week’s 10.5 miles: last week read hold" when rule 7
 * capped it, "Target from the plan" otherwise, and the rule's own words when the week has no plan.
 * The cap's reading is the worst of last week's, which is the reading the rule capped on. When the
 * week before the one shown is today's week, it is not over and its miles can still grow, so the
 * words name this week and say so far: "Capped at this week’s 6 miles so far: this week read hold".
 */
export function targetWords(summary: WeekMiles, previousReadings: readonly ReadingResult[], previousIsThisWeek = false): string {
  const { target, capped, reason } = summary.target
  if (target === null) return `No target: ${reason}`
  if (!capped) return 'Target from the plan'
  // A down period's hold or climb back (Batch E, PROGRAM-QUESTIONS 183) is said before rule 7's cap: it is the lower number.
  const down = summary.target.downPeriod
  if (down?.kind === 'held') return `Held at last week’s ${plural(target, 'mile')}: a down period covers the start of this week`
  if (down?.kind === 'climbing') return `Up one plan step from last week’s ${plural(down.lastWeek, 'mile')}, after a down period`
  const read = worst(previousReadings) === 'back-off' ? 'back off' : 'hold'
  if (previousIsThisWeek) return `Capped at this week’s ${plural(target, 'mile')} so far: this week read ${read}`
  return `Capped at last week’s ${plural(target, 'mile')}: last week read ${read}`
}

/** A day's status as a mark and a word; the strip never says it by color. */
export const STATUS_WORDS: Record<DayStatus, { mark: string | null; word: string }> = {
  done: { mark: '✓', word: 'Done' },
  missed: { mark: '–', word: 'Missed' },
  today: { mark: '●', word: 'Today' },
  upcoming: { mark: null, word: 'Upcoming' },
  off: { mark: null, word: 'Off' },
}

/** "✓ Done", "– Missed", "● Today", "Upcoming", "Off". */
export function statusWords(status: DayStatus): string {
  const { mark, word } = STATUS_WORDS[status]
  return mark ? `${mark} ${word}` : word
}

const SUMMARY_RANK: Record<Workout['status'], number> = { finished: 0, abandoned: 1, 'in-progress': 2, planned: 3 }

/** The workout a done day's summary opens: a finished one before an attempt left early, the latest first. */
export function summaryWorkout(workouts: readonly Workout[]): Workout | null {
  const sorted = [...workouts].sort((a, b) => SUMMARY_RANK[a.status] - SUMMARY_RANK[b.status] || (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
  return sorted[0] ?? null
}

export type DayAction = { kind: 'summary'; workoutId: string; label: string } | { kind: 'run'; label: string } | { kind: 'preview'; date: IsoDate; label: string }

/** What tapping a day does: a day with a finished or abandoned lift opens its summary; today's run day opens the run logger. */
export function dayAction(day: Pick<WeekDay, 'date' | 'session' | 'status' | 'workouts'>, today: IsoDate): DayAction | null {
  const workout = summaryWorkout(day.workouts.filter((w) => w.status === 'finished' || w.status === 'abandoned'))
  if (workout) return { kind: 'summary', workoutId: workout.id, label: 'Open the summary' }
  if (day.date === today && runTypeFor(day.session) !== null) return { kind: 'run', label: 'Log the run' }
  // A lift day with nothing logged yet opens a preview of the session it holds, past, today or ahead.
  if (day.session.startsWith('lift:')) return { kind: 'preview', date: day.date, label: 'See the session' }
  return null
}

/** What was logged on a day, in words: "Session A finished", "Run: easy, 3 miles", "Rower swap, 35 minutes". */
export function loggedWords(day: Pick<WeekDay, 'runs' | 'workouts'>, templates: readonly SessionTemplate[]): string[] {
  const workouts = day.workouts.map((w) => `${workoutLabel(w, templates)} ${w.status === 'finished' ? 'finished' : 'left early'}`)
  const runs = day.runs.map((r) => (isSwap(r) ? `${runLabel(r.type)}, ${timeWords(r.minutes)}` : `${runLabel(r.type)}, ${plural(r.miles, 'mile')}`))
  return [...workouts, ...runs]
}

/** The template day a session was moved from, or null when the day holds its own session. */
export function movedFrom(template: WeeklyTemplate, day: Day, session: DaySession): Day | null {
  if (template[day] === session) return null
  return DAYS.find((d) => template[d] === session) ?? null
}

/**
 * Whether a day with something logged still lacks a morning check for it. Until one applies the
 * engine reads it hold at best (unknown is not clean), so the row says why.
 */
export function checkNote(day: Pick<WeekDay, 'date' | 'runs' | 'workouts'>, checks: readonly MorningCheck[], today: IsoDate): string | null {
  const subjects = [...day.runs.map((r) => ({ kind: 'run' as const, id: r.id, date: r.date })), ...day.workouts.map((w) => ({ kind: 'workout' as const, id: w.id, date: w.date }))]
  if (subjects.length === 0) return null
  const missing = subjects.some((s) => !checks.some((c) => morningCheckApplies(c, s)))
  if (!missing) return null
  return day.date >= addDays(today, -1) ? 'Morning check not done yet; until then it reads hold at best' : 'No morning check was logged for it'
}

/** The red flag on the next morning's check, when that check was logged late: a note on the session day's row, kept for good. */
export function dayLateFlagNote(date: IsoDate, checks: readonly MorningCheck[], catalog: ProgramLike['redFlags']): string | null {
  const morning = addDays(date, 1)
  const note = checks.map((c) => (c.date === morning ? lateFlagNote(c, catalog) : null)).find((n) => n !== null)
  return note ? weekLateFlagWords(note) : null
}

/** The week's own moves, in the order the engine applies them. A move of a day onto itself changes nothing. */
export function movesForWeek(moves: readonly SessionMove[], week: number): SessionMove[] {
  return moves.filter((m) => m.week === week && m.dayA !== m.dayB)
}

export interface MoveLine {
  id: string
  title: string
  detail: string
  /** Only the week's latest move can be undone, and only while its two days could still trade (src/rules/moves). */
  undoable: boolean
}

/** Each move this week in words, read against the schedule as it stood just before it. */
export function moveLines(template: WeeklyTemplate, week: number, moves: readonly SessionMove[], undoable: string | null = null): MoveLine[] {
  const own = movesForWeek(moves, week)
  return own.map((move, i) => {
    const before = weekSchedule(template, week, own.slice(0, i))
    const moved = sessionLabel(before[move.dayA])
    const other = sessionLabel(before[move.dayB])
    return {
      id: move.id,
      title: `${WEEKDAY[move.dayA]} and ${WEEKDAY[move.dayB]} swapped`,
      detail: `${moved} now ${WEEKDAY[move.dayB]} · ${other} now ${WEEKDAY[move.dayA]}`,
      undoable: move.id === undoable,
    }
  })
}

const MOVE_ID = /^move-(\d+)$/

/**
 * A new move's id. The engine applies moves in stored order, and the store returns them sorted by
 * id, so a new id must sort after every id already there or the swap would land under earlier ones.
 */
export function nextMoveId(existing: readonly string[]): string {
  const max = existing.reduce((a, b) => (b > a ? b : a), '')
  const seq = existing.reduce((n, id) => Math.max(n, Number(MOVE_ID.exec(id)?.[1] ?? 0)), 0) + 1
  const id = `move-${String(seq).padStart(6, '0')}`
  // An id that would not sort last (a foreign format, or a sequence past six digits) extends the
  // largest id instead: a string always sorts after its own prefix.
  return id > max ? id : `${max}-1`
}

/** The move that swaps two days of a week, or null when both taps were the same day. */
export function buildMove(week: number, from: Day, to: Day, existingIds: readonly string[]): SessionMove | null {
  if (from === to) return null
  return { id: nextMoveId(existingIds), week, dayA: from, dayB: to }
}

/** The line shown while a move waits for its second tap. */
export function movePrompt(session: DaySession, day: Day): string {
  return `Moving ${sessionLabel(session)} from ${WEEKDAY[day]}. Tap “Swap here” on the day it goes to; the two days trade sessions.`
}

/** Why an Undo is missing: only the latest move can be taken back, and not once its days hold a log. */
export function undoWords(undoable: string | null, weekOver: boolean): string {
  if (weekOver) return 'That week is over; its moves stay.'
  if (undoable === null) return 'The latest move touches a day with something logged, so it stays.'
  return 'Only the latest move can be undone; each one swapped days as they stood after the ones before it.'
}

export function errorWords(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function moveErrorSentence(e: unknown): string {
  return `The move did not save (${errorWords(e)}). Nothing changed; try again.`
}

export function undoErrorSentence(e: unknown): string {
  return `The undo did not save (${errorWords(e)}). The move still stands; try again.`
}

export interface DayRow {
  day: Day
  date: IsoDate
  /** "Monday Nov 16", led by "Today," when today's row already says Done or Off. */
  dateWords: string
  session: DaySession
  sessionWords: string
  /** "Moved from Tuesday" when a move put this session here. */
  movedFrom: string | null
  status: DayStatus
  statusMark: string | null
  statusWord: string
  reading: ReadingResult | null
  logged: string[]
  checkNote: string | null
  /** A past day missing its morning check, inside the 14 days: the button that logs it late (Batch D). */
  lateCheck: { morning: IsoDate; label: string } | null
  /** A red flag on the next morning's check, logged late: a note, never the stop (Batch D). */
  lateFlagNote: string | null
  /** "Down period" on a day one covers (Batch E): progression paused for that day's plan. */
  downPeriod: string | null
  action: DayAction | null
  /** A quiet Move sits on every day that is not off and has nothing logged, in a week not yet over. */
  movable: boolean
  /** Whether a waiting move can land here: nothing logged, week not over (src/rules/moves). */
  swappable: boolean
  isToday: boolean
}

export interface WeekView {
  week: number
  /** weekOf(today): 0 or less before the program starts. */
  currentWeek: number
  /** The week the screen opens on; "Back to this week" returns here. */
  homeWeek: number
  header: string
  relation: string
  deload: boolean
  prev: number | null
  next: number | null
  miles: string
  target: string
  capped: boolean
  days: DayRow[]
  moves: MoveLine[]
  /** Why nothing in the week can move, when that is so: a finished week stays as it happened. */
  moveNote: string | null
  /** Shown under the moves when earlier ones are kept: only the latest can be undone. */
  undoNote: string | null
  stop: { headline: string; items: string[] } | null
  /** The down periods that touch this week, as history, in words (Batch E): "Down period: Saturday Nov 14 to Friday Nov 20 (7 days)". */
  downPeriods: string[]
}

/** The down periods touching a week, in start order, in words. */
export function weekDownPeriodLines(startDate: IsoDate, week: number, periods: readonly DownPeriod[]): string[] {
  const first = dateOf(startDate, week, 'mon')
  const last = dateOf(startDate, week, 'sun')
  return [...periods]
    .filter((p) => p.start <= last && lastPausedDay(p) >= first)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
    .map((p) => `Down period: ${downPeriodWords(p)}`)
}

/** The tester's own note on the session day's row, from a flag ticked on the next morning's check (tester mode). */
export function dayOwnFlagNote(date: IsoDate, checks: readonly MorningCheck[], catalog: ProgramLike['redFlags']): string | null {
  const morning = addDays(date, 1)
  const check = checks.find((c) => c.date === morning)
  const note = check ? ownFlagNote(check, catalog) : null
  return note ? weekOwnFlagWords(note) : null
}

/** The target line in tester mode: the plan's number, or the plan's own words outside it. */
export function writtenTargetWords(summary: WeekMiles): string {
  return summary.target.target === null ? `No target: ${summary.target.reason}` : 'Target from the plan'
}

/**
 * Everything the Week screen renders, from today, the week picked (null for the current one), the
 * settings, the history and the program. In tester mode (M-U3): no reading or check note on a row,
 * the plan's own target, no stop, no down periods, a ticked flag as the tester's own note; no engine call.
 */
export function weekView(input: { mode: EngineMode; today: IsoDate; selected: number | null; settings: Settings; history: HistoryLike; program: ProgramLike }): WeekView {
  const { today, settings, history, program } = input
  const { startDate } = settings
  const currentWeek = weekOf(today, startDate)
  const week = shownWeek(input.selected, currentWeek)
  const tester = input.mode === 'tester'
  const readings = tester ? [] : subjectReadings(attachChecks(history.workouts, history.setLogs, history.morningChecks), history.runs, history.morningChecks, settings.injuredSide)
  const periods = tester ? [] : (history.downPeriods ?? [])
  const summary = tester ? writtenWeekMiles(program.mileagePlan, week, startDate, history.runs) : weekMilesSummary(program.mileagePlan, week, startDate, history.runs, readings, periods)
  const previous = tester ? [] : readingsInWeek(readings, startDate, week - 1).map((r) => r.result)
  const days = weekDays({ startDate, week, today, template: program.weeklyTemplate, moves: history.sessionMoves, runs: history.runs, workouts: history.workouts, readings })
  const { prev, next } = neighbourWeeks(week, currentWeek)
  const moveCtx: MoveContext = { startDate, week, currentWeek, runs: history.runs, workouts: history.workouts }
  const undoable = undoableMove(moveCtx, history.sessionMoves)
  const moves = moveLines(program.weeklyTemplate, week, history.sessionMoves, undoable)
  const weekOver = week < currentWeek

  return {
    week,
    currentWeek,
    homeWeek: openingWeek(currentWeek),
    header: weekHeader(startDate, week),
    relation: relationWords(week, currentWeek, startDate),
    deload: isDeloadWeek(week),
    prev,
    next,
    miles: milesWords(summary),
    target: tester ? writtenTargetWords(summary) : targetWords(summary, previous, currentWeek >= 1 && week - 1 === currentWeek),
    capped: summary.target.capped,
    days: days.map((d) => {
      const { mark, word } = STATUS_WORDS[d.status]
      const from = movedFrom(program.weeklyTemplate, d.day, d.session)
      const isToday = d.date === today
      const free = dayMovable(moveCtx, d.day).allowed
      return {
        day: d.day,
        date: d.date,
        dateWords: isToday && d.status !== 'today' ? `Today, ${shortDateWords(d.date)}` : shortDateWords(d.date),
        session: d.session,
        sessionWords: sessionLabel(d.session, program.weeklyTemplateRows),
        movedFrom: from ? `Moved from ${WEEKDAY[from]}` : null,
        status: d.status,
        statusMark: mark,
        statusWord: word,
        reading: d.reading,
        logged: loggedWords(d, program.templates),
        checkNote: !tester && d.reading ? checkNote(d, history.morningChecks, today) : null,
        lateCheck: lateCheckOffer({ date: d.date, today, startDate, history }),
        lateFlagNote: tester ? dayOwnFlagNote(d.date, history.morningChecks, program.redFlags) : dayLateFlagNote(d.date, history.morningChecks, program.redFlags),
        downPeriod: !tester && isPaused(d.date, periods) ? 'Down period' : null,
        action: dayAction(d, today),
        movable: free && d.session !== 'off',
        swappable: free,
        isToday,
      }
    }),
    moves,
    moveNote: weekOver ? 'That week is over; its days stay as they happened.' : null,
    undoNote: moves.length > 1 || (moves.length === 1 && undoable === null) ? undoWords(undoable, weekOver) : null,
    stop: tester ? null : stopMessage(settings.redFlag, program.redFlags),
    downPeriods: tester ? [] : weekDownPeriodLines(startDate, week, periods),
  }
}
