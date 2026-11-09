import type { Day, DaySession, DownPeriod, IsoDate, MileageWeek, ReadingResult, Run, RunType, SessionMove, WeeklyTemplate, Workout } from '../schema/index.ts'
import { DAYS, dateOf, isDeloadWeek, weekOf, weekSchedule } from './calendar.ts'
import { weekHeld } from './downPeriod.ts'
import type { SubjectReading } from './history.ts'
import { isSwap, planTarget, runSplit, weekMiles, weekTarget, type WeekTarget } from './mileage.ts'

export function runsInWeek(runs: readonly Run[], startDate: IsoDate, week: number): Run[] {
  return runs.filter((r) => weekOf(r.date, startDate) === week)
}

export function readingsInWeek(readings: readonly SubjectReading[], startDate: IsoDate, week: number): SubjectReading[] {
  return readings.filter((r) => weekOf(r.date, startDate) === week)
}

/**
 * Rule 7 assembled from the logs: the plan's number, capped at last week's actual miles when any
 * run or workout last week read hold or back-off. A week with nothing logged caps nothing: it is
 * unknown, and the plan is already a ceiling (PROGRAM-QUESTIONS 56).
 *
 * Down periods (Batch E, PROGRAM-QUESTIONS 183) only ever lower it. A week whose Monday a period
 * covers (`weekHeld`) doesn't step up: it holds at last week's target, as down periods set that too
 * (so held weeks in a row hold the same number). The weeks after one climb back one plan step a week
 * from last week's (plan(w) − plan(w−1), so a flat deload week stays flat) until they meet rule 7's
 * number. Rule 7's cap is always in the number first, and the lower of the two stands.
 */
export function targetForWeek(
  plan: readonly MileageWeek[],
  week: number,
  startDate: IsoDate,
  runs: readonly Run[],
  readings: readonly SubjectReading[],
  periods: readonly DownPeriod[] = [],
): WeekTarget {
  const own = ruleSeven(plan, week, startDate, runs, readings)
  if (week <= 1 || periods.length === 0 || own.target === null) return own
  const last = targetForWeek(plan, week - 1, startDate, runs, readings, periods)
  if (last.target === null) return own
  if (weekHeld(startDate, week, periods)) {
    if (own.target <= last.target) return own
    return { target: last.target, capped: true, reason: `down period: held at last week’s ${last.target} miles`, downPeriod: { kind: 'held', lastWeek: last.target } }
  }
  if (last.downPeriod === undefined) return own
  const step = Math.max(0, (planTarget(plan, week) ?? 0) - (planTarget(plan, week - 1) ?? 0))
  const ceiling = Math.round((last.target + step) * 100) / 100
  if (own.target <= ceiling) return own
  return {
    target: ceiling,
    capped: true,
    reason: `after a down period: up one plan step from last week’s ${last.target} miles`,
    downPeriod: { kind: 'climbing', lastWeek: last.target },
  }
}

function ruleSeven(plan: readonly MileageWeek[], week: number, startDate: IsoDate, runs: readonly Run[], readings: readonly SubjectReading[]): WeekTarget {
  if (week <= 1) return weekTarget(plan, week, null)
  const previousReadings = readingsInWeek(readings, startDate, week - 1).map((r) => r.result)
  if (previousReadings.length === 0) return weekTarget(plan, week, null)
  return weekTarget(plan, week, { readings: previousReadings, actualMiles: weekMiles(runsInWeek(runs, startDate, week - 1)) })
}

const RUN_TYPE: Partial<Record<DaySession, RunType>> = { 'run:mbr': 'mbr', 'run:easy': 'easy', 'run:long': 'long' }

export function runTypeFor(session: DaySession): RunType | null {
  return RUN_TYPE[session] ?? null
}

export interface RunSuggestion {
  type: RunType
  /** Suggested miles: the run's share of the target, never more than what is left under the week's ceiling. Null outside the plan. */
  miles: number | null
  /**
   * The suggestion in words, for screens to print after "Suggested: ", so none writes its own:
   * the swap when one is suggested, else the miles ("4 miles", "1 mile"), else "easy, by feel"
   * ("distance by feel" when the tempo or a faster effort is on).
   */
  headline: string
  strides: boolean
  tempo: boolean
  /** One faster effort is allowed on this run (PROGRAM-QUESTIONS 29). */
  fasterAllowed: boolean
  /** An elliptical or rower swap is suggested instead. */
  swapSuggested: boolean
  reasons: string[]
}

/**
 * What a scheduled run should be. Strides on Wednesdays and the tempo on Fridays come from
 * Phase 3 ("from week 8", "from week 10 if Gate 2 was clean": being in Phase 3 means Gate 2
 * passed), counted from the week the phase was entered. A hold or back-off morning suggests a swap;
 * with no check yet the miles stand and the strides, tempo and faster effort wait for a clean one.
 */
export function suggestRun(input: {
  session: DaySession
  week: number
  target: number | null
  /** Miles already logged this week, swaps excluded. */
  milesSoFar: number
  currentPhase: number
  phaseWeek: number
  /** Today's morning reading, or null when no check was logged today (the miles stand; the hard parts wait). */
  morning: ReadingResult | null
  /** The calendar's phase week, when a down period holds `phaseWeek` behind it (Batch E). */
  calendarPhaseWeek?: number
  /** Why the band is held (`bandHeldNote`), said when it costs the tempo. */
  bandNote?: string | null
}): RunSuggestion | null {
  const type = runTypeFor(input.session)
  if (!type) return null
  const reasons: string[] = []
  // The morning decides first, so every reason below comes from the final call (M4 review).
  const swapSuggested = input.morning === 'hold' || input.morning === 'back-off'
  if (input.morning === 'back-off') reasons.push('this morning read back off: make it 30 to 40 minutes on the elliptical or rower')
  else if (input.morning === 'hold') reasons.push('this morning read hold: an elliptical or rower swap at the same effort is the call')
  else if (input.morning === null) reasons.push('no morning check yet today')
  let miles: number | null = null
  if (input.target !== null) {
    const split = runSplit(input.target)
    const share = type === 'long' ? split.long : split.others
    // Hundredths, as miles are logged, so 10 - 6.1 is 3.9 and not 3.9000000000000004. A capped run
    // rounds down to the quarter mile: rounding to the nearest could go over the ceiling.
    const left = Math.max(0, Math.round((input.target - input.milesSoFar) * 100) / 100)
    if (share > left) {
      miles = Math.floor(left * 4 + 1e-9) / 4
      reasons.push(`capped at the ${left} miles left under this week's ${input.target}`)
    } else {
      miles = share
    }
  }
  const phase3 = input.currentPhase >= 3
  const plannedStrides = type === 'easy' && phase3
  const plannedTempo = type === 'long' && phase3 && input.phaseWeek >= 3
  // Every Friday from Phase 2 on, never in a deload week, and not on top of Phase 3's tempo,
  // which is that Friday's hard effort (PROGRAM-QUESTIONS 29, Shawn's Nov 1 call).
  const plannedFaster = type === 'long' && input.currentPhase >= 2 && !isDeloadWeek(input.week) && !plannedTempo
  // The hard parts need a clean morning: a hold or back-off swaps them out, and no check yet is
  // unknown, which is not clean (PROGRAM-QUESTIONS 60). The miles stand either way.
  const clean = input.morning === 'clean'
  const strides = plannedStrides && clean
  const tempo = plannedTempo && clean
  const fasterAllowed = plannedFaster && clean
  if (input.morning === null && (plannedStrides || plannedTempo || plannedFaster)) {
    reasons.push('log the morning check first; strides, the tempo and any faster effort wait on a clean morning')
  }
  if (strides) reasons.push('finish with 4 × 15 s strides building to about 85%, full walk-back between')
  if (tempo) reasons.push('carry a 2 × 5 min comfortably-hard segment with 3 min easy between')
  if (type === 'long' && phase3 && !plannedTempo && input.bandNote && (input.calendarPhaseWeek ?? 0) >= 3) reasons.push(`no tempo this week: ${input.bandNote}`)
  if (fasterAllowed) reasons.push('one faster effort is allowed today')
  return { type, miles, headline: runHeadline(swapSuggested, miles, tempo || fasterAllowed), strides, tempo, fasterAllowed, swapSuggested, reasons }
}

/**
 * RunSuggestion.headline. With no miles (outside the plan) it says easy, unless the same
 * suggestion carries the tempo or a faster effort: then only the distance is by feel, so the
 * headline never says easy over a hard segment (week 13's Friday in Phase 3).
 */
function runHeadline(swapSuggested: boolean, miles: number | null, hardEffort: boolean): string {
  if (swapSuggested) return 'a 30 to 40 minute elliptical or rower swap'
  if (miles === null) return hardEffort ? 'distance by feel' : 'easy, by feel'
  return `${miles} ${miles === 1 ? 'mile' : 'miles'}`
}

export type DayStatus = 'done' | 'missed' | 'today' | 'upcoming' | 'off'

export interface WeekDay {
  day: Day
  date: IsoDate
  session: DaySession
  status: DayStatus
  /** The worst reading among the day's sessions, when one exists. */
  reading: ReadingResult | null
  runs: Run[]
  workouts: Workout[]
}

const RANK: Record<ReadingResult, number> = { clean: 0, hold: 1, 'back-off': 2 }

/**
 * Whether what was logged on a day is that day's session: a finished or abandoned workout on a lift
 * day, a run or a swap on a run day, anything on an off day. A run on a lift day doesn't make the
 * lift done (M4 review); the day keeps its date status and still lists the run.
 */
export function sessionDone(session: DaySession, runs: readonly Pick<Run, 'date'>[], workouts: readonly Pick<Workout, 'status'>[]): boolean {
  const lifted = workouts.some((w) => w.status === 'finished' || w.status === 'abandoned')
  if (session === 'off') return lifted || runs.length > 0
  if (runTypeFor(session)) return runs.length > 0
  return lifted
}

/** The seven days of a program week, after moves, with what happened on each. */
export function weekDays(input: {
  startDate: IsoDate
  week: number
  today: IsoDate
  template: WeeklyTemplate
  moves: readonly SessionMove[]
  runs: readonly Run[]
  workouts: readonly Workout[]
  readings: readonly SubjectReading[]
}): WeekDay[] {
  const schedule = weekSchedule(input.template, input.week, input.moves)
  return DAYS.map((day) => {
    const date = dateOf(input.startDate, input.week, day)
    const session = schedule[day]
    const runs = input.runs.filter((r) => r.date === date)
    const workouts = input.workouts.filter((w) => w.date === date && (w.status === 'finished' || w.status === 'abandoned'))
    const dayReadings = input.readings.filter((r) => r.date === date).map((r) => r.result)
    const reading = dayReadings.length ? dayReadings.reduce((a, b) => (RANK[b] > RANK[a] ? b : a)) : null
    const status: DayStatus = sessionDone(session, runs, workouts) ? 'done' : session === 'off' ? 'off' : date === input.today ? 'today' : date < input.today ? 'missed' : 'upcoming'
    return { day, date, session, status, reading, runs, workouts }
  })
}

/** One program week's sessions done, of those scheduled (Batch B). No streak: a count per week, nothing carried over. */
export interface WeekAdherence {
  liftsDone: number
  liftsScheduled: number
  runsDone: number
  runsScheduled: number
}

/**
 * Sessions done of those scheduled in one program week (Batch B, PROGRAM-QUESTIONS 164): the weekly
 * template after moves (`weekSchedule`, so a moved session counts on its moved day), each lift or run
 * day done by `sessionDone`, as the Week screen reads it. A swap counts as the run it stood in for,
 * an ended-early lift counts (it happened), a run on a lift day doesn't make the lift done, and a
 * run on an off day counts toward nothing. A deload week is an ordinary scheduled week. Null before
 * the program or for a week with nothing scheduled. Only the date of a run is read. It is a record,
 * not a score: there is no streak and nothing carried from week to week, because a day skipped on a
 * bad knee is the program working.
 */
export function weekAdherence(input: {
  startDate: IsoDate
  week: number
  template: WeeklyTemplate
  moves: readonly SessionMove[]
  runs: readonly Pick<Run, 'date'>[]
  workouts: readonly Pick<Workout, 'date' | 'status'>[]
}): WeekAdherence | null {
  if (input.week < 1) return null
  const schedule = weekSchedule(input.template, input.week, input.moves)
  const counts: WeekAdherence = { liftsDone: 0, liftsScheduled: 0, runsDone: 0, runsScheduled: 0 }
  for (const day of DAYS) {
    const session = schedule[day]
    const isLift = session.startsWith('lift:')
    const isRun = runTypeFor(session) !== null
    if (!isLift && !isRun) continue
    const date = dateOf(input.startDate, input.week, day)
    const done = sessionDone(
      session,
      input.runs.filter((r) => r.date === date),
      input.workouts.filter((w) => w.date === date),
    )
    if (isLift) {
      counts.liftsScheduled += 1
      if (done) counts.liftsDone += 1
    } else {
      counts.runsScheduled += 1
      if (done) counts.runsDone += 1
    }
  }
  return counts.liftsScheduled + counts.runsScheduled === 0 ? null : counts
}

export interface WeekMiles {
  target: WeekTarget
  miles: number
  sessions: number
  swaps: number
}

export function weekMilesSummary(
  plan: readonly MileageWeek[],
  week: number,
  startDate: IsoDate,
  runs: readonly Run[],
  readings: readonly SubjectReading[],
  periods: readonly DownPeriod[] = [],
): WeekMiles {
  const own = runsInWeek(runs, startDate, week)
  return { target: targetForWeek(plan, week, startDate, runs, readings, periods), miles: weekMiles(own), sessions: own.length, swaps: own.filter(isSwap).length }
}
