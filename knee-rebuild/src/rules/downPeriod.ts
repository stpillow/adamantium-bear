import { DOWN_PERIOD_MAX_DAYS, DOWN_PERIOD_MIN_DAYS, type DownPeriod, type IsoDate, type IsoDateTime } from '../schema/index.ts'
import { addDays, daysBetween, weekOf } from './calendar.ts'
import { shortDateWords } from './dateWords.ts'

/*
 * A down period (Batch E, Shawn's Nov 8 decision 6, "yes, but milder"; PROGRAM-QUESTIONS 181 to
 * 189): a declared "not feeling 100%" stretch of 3 to 14 days, for illness or life stress, not the
 * knee. While a day is inside one, PROGRESSION PAUSES AND READINGS STAY REAL:
 *
 * - Wherever the engine would step up (clean twice: load, reps, height, range, stage, the slot's
 *   return from its easier version; the week's run target; the phase-week bands that bring the
 *   single-leg plyo, the snap-downs and the tempo), it repeats what is in effect instead and says why.
 *   It is a pause, never a relaxation: hold, back off, deloads, the whole-knee back-off and the red
 *   flag apply exactly as outside one (prescription.ts hooks only its clean-twice branch).
 * - Nothing here reads or writes a reading: a session inside a period is read and stored as normal,
 *   and a clean one counts toward clean twice once the period is over.
 *
 * The rows come from the `downPeriods` table (src/db/db.ts). A period always starts the day it is
 * declared, runs 3 to 14 days from its start, and pauses through its last paused day: the day it was
 * ended early (that day still counts, so ending one mid-session never plans the open session
 * upward), or its planned end. One stands at a time. Pure: the caller passes today.
 */

export { DOWN_PERIOD_MAX_DAYS, DOWN_PERIOD_MIN_DAYS }
/** The form's default length, in days. */
export const DOWN_PERIOD_DEFAULT_DAYS = 7

/** A day inside a down period, as the prescription and the notes read it. */
export interface Pause {
  start: IsoDate
  /** The period's last paused day: the day it was ended early, or its planned end. */
  until: IsoDate
  /** `until` in words: "Friday Nov 20". */
  untilWords: string
  /** Which day of the period the date is, from 1. */
  day: number
  /** The period's planned length in days. */
  of: number
}

/** The period's last paused day: the day it was ended early (which still counts), or its planned end. */
export const lastPausedDay = (p: DownPeriod): IsoDate => p.endedOn ?? p.plannedEnd

/** The period's planned length in days, start and planned end included. */
export const plannedDays = (p: Pick<DownPeriod, 'start' | 'plannedEnd'>): number => daysBetween(p.start, p.plannedEnd) + 1

/** The latest day a period may run to: 14 days from its start, the start included. */
export const latestEnd = (p: Pick<DownPeriod, 'start'>): IsoDate => addDays(p.start, DOWN_PERIOD_MAX_DAYS - 1)

/** Of several rows, the one whose pause runs latest (then the later start, then the id), so overlapping rows read as one. */
function latest(rows: readonly DownPeriod[]): DownPeriod | null {
  let best: DownPeriod | null = null
  for (const p of rows) {
    if (best === null) {
      best = p
      continue
    }
    const a = lastPausedDay(p)
    const b = lastPausedDay(best)
    if (a > b || (a === b && (p.start > best.start || (p.start === best.start && p.id > best.id)))) best = p
  }
  return best
}

/** The period covering a date, start to last paused day inclusive; with overlapping rows (an import, a clock change), the one that runs latest. */
export function coveringPeriod(date: IsoDate, periods: readonly DownPeriod[]): DownPeriod | null {
  return latest(periods.filter((p) => p.start <= date && date <= lastPausedDay(p)))
}

/** Whether a day is inside a down period: progression pauses for that day's plan. */
export function isPaused(date: IsoDate, periods: readonly DownPeriod[]): boolean {
  return coveringPeriod(date, periods) !== null
}

/** The pause on a day, for the prescription's words; null outside every period. */
export function pauseOn(date: IsoDate, periods: readonly DownPeriod[]): Pause | null {
  const p = coveringPeriod(date, periods)
  if (p === null) return null
  const until = lastPausedDay(p)
  return { start: p.start, until, untilWords: shortDateWords(until), day: daysBetween(p.start, date) + 1, of: plannedDays(p) }
}

/** The period covering today, ended today included; null when none does. */
export function activeDownPeriod(today: IsoDate, periods: readonly DownPeriod[]): DownPeriod | null {
  return coveringPeriod(today, periods)
}

/**
 * The period that stops a new one being declared today: any stored row whose pause reaches today or
 * later, one covering today, one ended today, or one dated ahead of today (from an import or a clock
 * change). The latest-running of them.
 */
export function standingPeriod(today: IsoDate, periods: readonly DownPeriod[]): DownPeriod | null {
  return latest(periods.filter((p) => lastPausedDay(p) >= today))
}

/**
 * Whether a program week's run target holds (PROGRAM-QUESTIONS 183): the week's first day, its
 * Monday, falls inside a period. The step up happens at the week boundary, so a period that starts
 * mid-week leaves the week's target as it is, and one still running on a Monday holds that whole
 * week, even if it ends mid-week. One number per week, so Today, Week and the run logger agree.
 */
export function weekHeld(startDate: IsoDate, week: number, periods: readonly DownPeriod[]): boolean {
  return isPaused(addDays(startDate, (week - 1) * 7), periods)
}

/** A stretch of paused days: overlapping or back-to-back rows read as one, from the first start to the last paused day. */
interface Span {
  start: IsoDate
  until: IsoDate
}

/** The rows as stretches of paused days, in order. */
function pausedSpans(rows: readonly DownPeriod[]): Span[] {
  const spans: Span[] = []
  for (const p of [...rows].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))) {
    const last = spans[spans.length - 1]
    const until = lastPausedDay(p)
    if (last !== undefined && p.start <= addDays(last.until, 1)) {
      if (until > last.until) last.until = until
    } else {
      spans.push({ start: p.start, until })
    }
  }
  return spans
}

/**
 * The phase week a day's slots, extra-time pool and tempo are read in (PROGRAM-QUESTIONS 188): the
 * calendar's, except where a down period paused the bands. Inside one, they stay where they were
 * when it began, so the single-leg plyo, the snap-downs and the tempo never arrive while it lasts.
 * After one, they resume where they stopped, not at the calendar's: one phase week on for each
 * Monday since its last paused day, so a long period never skips a band (a 14-day period over
 * phase weeks 3 and 4 resumes at 4, not 5). The bands step up at the week boundary, as the run
 * target does (`weekHeld`): a period that covers a Monday delays that week's step to the next one.
 * Overlapping or back-to-back rows hold as one stretch, and a later period holds where an earlier
 * one left the bands. Never above the calendar's, never below week 1.
 */
export function bandWeek(input: { date: IsoDate; phaseWeek: number; startDate: IsoDate; phaseEnteredWeek: number; periods: readonly DownPeriod[] }): number {
  const { date, startDate, phaseEnteredWeek } = input
  const clamp = (w: number): number => Math.max(1, Math.min(input.phaseWeek, w))
  const calendarOn = (d: IsoDate): number => weekOf(d, startDate) - phaseEnteredWeek + 1
  // The band week the bands may reach on a day after the latest stretch so far; none before the first.
  let resumeCap: (d: IsoDate) => number = () => Number.POSITIVE_INFINITY
  for (const span of pausedSpans(input.periods.filter((p) => p.start <= date))) {
    const held = Math.max(1, Math.min(calendarOn(span.start), resumeCap(span.start)))
    if (date <= span.until) return clamp(held)
    const until = span.until
    resumeCap = (d) => held + weekOf(d, startDate) - weekOf(until, startDate)
  }
  return clamp(resumeCap(date))
}

/**
 * Why the phase-week bands (the tempo among them) sit behind the calendar on a day, in words, or
 * null when they don't: the pause while a period covers the day, else how far behind they run
 * after one (PROGRAM-QUESTIONS 188).
 */
export function bandHeldNote(input: { date: IsoDate; calendarPhaseWeek: number; band: number; periods: readonly DownPeriod[] }): string | null {
  const behind = input.calendarPhaseWeek - input.band
  if (behind <= 0) return null
  const pause = pauseOn(input.date, input.periods)
  if (pause) return pausedNote(pause)
  return `After the down period, the phase-week work runs ${behind} ${behind === 1 ? 'week' : 'weeks'} behind the calendar.`
}

/** "Down period: progression paused until Friday Nov 20.": what a held prescription, the Preview and a held placement say. */
export function pausedNote(p: Pick<Pause, 'untilWords'>): string {
  return `Down period: progression paused until ${p.untilWords}.`
}

/** "Saturday Nov 14 to Friday Nov 20 (7 days)", or "…, ended early on Tuesday Nov 17 (4 of 7 days)": a period as history. */
export function downPeriodWords(p: DownPeriod): string {
  const span = `${shortDateWords(p.start)} to ${shortDateWords(p.plannedEnd)}`
  if (p.endedOn === undefined) return `${span} (${plannedDays(p)} days)`
  return `${span}, ended early on ${shortDateWords(p.endedOn)} (${daysBetween(p.start, p.endedOn) + 1} of ${plannedDays(p)} days)`
}

// ---------------------------------------------------------------------------------------------
// Declaring, extending, ending and resuming. Each `…Problem` is null when the change may be made,
// else one sentence that says why not; src/db/repo.ts asks again inside its transaction.

/** Whether a period of `days` may start today: 3 to 14 days, and no other period stands (PROGRAM-QUESTIONS 185). */
export function declareProblem(periods: readonly DownPeriod[], today: IsoDate, days: number): string | null {
  if (!Number.isInteger(days) || days < DOWN_PERIOD_MIN_DAYS || days > DOWN_PERIOD_MAX_DAYS) {
    return `A down period runs ${DOWN_PERIOD_MIN_DAYS} to ${DOWN_PERIOD_MAX_DAYS} days.`
  }
  const standing = standingPeriod(today, periods)
  if (standing === null) return null
  if (standing.start > today) return `A down period from ${shortDateWords(standing.start)} is already stored, so a new one can’t start before it ends.`
  if (standing.endedOn === today) return `The down period from ${shortDateWords(standing.start)} ended today: tap Keep it going to pick it back up, or start a new one from tomorrow.`
  return `A down period is already on until ${shortDateWords(lastPausedDay(standing))}: make it longer instead.`
}

/** A new period starting today for `days` days; its id is the day it starts, since only one can start a day. */
export function newDownPeriod(input: { today: IsoDate; days: number; declaredAt: IsoDateTime; note?: string }): DownPeriod {
  const note = input.note?.trim()
  return {
    id: `dp-${input.today}`,
    start: input.today,
    plannedEnd: addDays(input.today, input.days - 1),
    declaredAt: input.declaredAt,
    ...(note ? { note } : {}),
  }
}

/** The stored period by id, if it is the one standing today, or why not. */
function standingById(periods: readonly DownPeriod[], id: string, today: IsoDate): { period: DownPeriod } | { problem: string } {
  const period = periods.find((p) => p.id === id)
  if (period === undefined) return { problem: 'That down period isn’t stored any more.' }
  if (period.start > today) return { problem: `That down period starts ${shortDateWords(period.start)}, not yet.` }
  if (lastPausedDay(period) < today) return { problem: `That down period ended ${shortDateWords(lastPausedDay(period))}.` }
  return { period }
}

/** Whether the standing period may run to `newEnd`: later than its planned end, at most 14 days from its start, not ended, and not onto another stored period. */
export function extendProblem(periods: readonly DownPeriod[], id: string, newEnd: IsoDate, today: IsoDate): string | null {
  const found = standingById(periods, id, today)
  if ('problem' in found) return found.problem
  const p = found.period
  if (p.endedOn !== undefined) return 'It was ended today: tap Keep it going first.'
  if (newEnd <= p.plannedEnd) return `It already runs to ${shortDateWords(p.plannedEnd)}.`
  if (newEnd > latestEnd(p)) return `A down period runs at most ${DOWN_PERIOD_MAX_DAYS} days, to ${shortDateWords(latestEnd(p))} for this one.`
  const next = periods.find((q) => q.id !== p.id && q.start > p.plannedEnd && q.start <= newEnd)
  if (next) return `Another down period starts ${shortDateWords(next.start)}, so this one can run to ${shortDateWords(addDays(next.start, -1))} at most.`
  return null
}

/** Whether the standing period may be ended today: not already ended, and today isn't its last planned day (it ends tonight on its own). */
export function endProblem(periods: readonly DownPeriod[], id: string, today: IsoDate): string | null {
  const found = standingById(periods, id, today)
  if ('problem' in found) return found.problem
  const p = found.period
  if (p.endedOn !== undefined) return 'It was already ended today.'
  if (today >= p.plannedEnd) return 'Today is its last planned day: it ends tonight on its own.'
  return null
}

/** Whether a period ended today may be kept going (an end tapped by mistake): only on the day it was ended. */
export function resumeProblem(periods: readonly DownPeriod[], id: string, today: IsoDate): string | null {
  const period = periods.find((p) => p.id === id)
  if (period === undefined) return 'That down period isn’t stored any more.'
  if (period.endedOn !== today) return 'Only a down period ended today can be kept going.'
  return null
}

export const extended = (p: DownPeriod, newEnd: IsoDate): DownPeriod => ({ ...p, plannedEnd: newEnd })
export const endedEarly = (p: DownPeriod, today: IsoDate): DownPeriod => ({ ...p, endedOn: today })
export function resumed(p: DownPeriod): DownPeriod {
  const { endedOn: _ended, ...rest } = p
  void _ended
  return rest
}
