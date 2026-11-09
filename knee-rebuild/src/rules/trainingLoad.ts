import type { Effort, IsoDate, RepUnit, Run, RunType, SetLog, Workout } from '../schema/index.ts'
import { addDays, daysBetween, isDeloadWeek, weekOf } from './calendar.ts'
import { setWorkSeconds } from './fitWindow.ts'
import type { WorkoutRecord } from './history.ts'
import { isLateEntry } from './retro.ts'

/*
 * Training load (metrics phase 1, docs/metrics-and-photos-plan.md): how hard a session was times how
 * long it took, RPE × minutes, for every lift and run, and the warning when the last 7 days run well
 * above or below the longer rate. It is a warning only. Nothing here feeds a prescription, a reading,
 * a cap or a gate: the guard (trainingLoad.guard.test.ts) holds every other rule module away from it
 * and from the fields it reads. Since Batch B the warning is EWMA-based (PROGRAM-QUESTIONS 162) and
 * still feeds nothing. "Load" on Progress already means weight lifted, so this is always
 * "training load". Computed, never stored (PROGRAM-QUESTIONS 143 to 149).
 *
 * Metrics phase 2 adds the HR load (Banister TRIMP, PROGRAM-QUESTIONS 151): shown BESIDE the sRPE
 * load on Progress and the run logger's saved words, never summed into it. The acute:chronic
 * warning reads the sRPE load alone (`acuteChronic` takes no HR input), so the two can disagree
 * visibly without changing any behavior.
 */

/** An older run's effort word as an RPE: the middle of its band, near enough for a sum. */
export const EFFORT_RPE: Record<Effort, number> = { easy: 3, moderate: 5, hard: 8 }

/** A run's RPE as its effort word: 1–3 easy, 4–6 moderate, 7–10 hard (the run logger writes both). */
export function effortFromRpe(rpe: number): Effort {
  if (!Number.isInteger(rpe) || rpe < 1 || rpe > 10) throw new RangeError(`not an RPE from 1 to 10: ${rpe}`)
  if (rpe <= 3) return 'easy'
  if (rpe <= 6) return 'moderate'
  return 'hard'
}

/** A run's RPE: as rated, or, on a run logged before RPE was asked, its effort word read as 3, 5 or 8. */
export function runRpe(run: Pick<Run, 'rpe' | 'effort'>): { rpe: number; source: 'rated' | 'word' } {
  return run.rpe !== undefined ? { rpe: run.rpe, source: 'rated' } : { rpe: EFFORT_RPE[run.effort], source: 'word' }
}

/** The average of the rated sets' RPE, rounded half up to a whole number; null when no set is rated. Unrated sets are left out, never read as 0. */
export function setsRpe(sets: readonly Pick<SetLog, 'rpe'>[]): number | null {
  const rated = sets.map((s) => s.rpe).filter((r): r is number => r !== undefined)
  if (rated.length === 0) return null
  return Math.min(10, Math.max(1, Math.round(rated.reduce((a, b) => a + b, 0) / rated.length)))
}

/** A lift's RPE: Shawn's own rating of the whole session when he gave one, else the sets' average, else unknown. */
export function workoutRpe(workout: Pick<Workout, 'sessionRpe'>, sets: readonly Pick<SetLog, 'rpe'>[]): { rpe: number; source: 'session' | 'sets' } | null {
  if (workout.sessionRpe !== undefined) return { rpe: workout.sessionRpe, source: 'session' }
  const average = setsRpe(sets)
  return average === null ? null : { rpe: average, source: 'sets' }
}

/** The clock is trusted from 1 to this many minutes; past it, the minutes are an estimate for Shawn to set. */
export const CLOCK_MAX_MINUTES = 180
/** The most a wait between two sets adds: a longer one was a break, a chat or a phone left open. */
export const SET_GAP_MAX_MINUTES = 10
/** The most the wait from Start to the first set adds: the warm-up (bike and circuit) and a little more. */
export const FIRST_GAP_MAX_MINUTES = 20

/**
 * A live session's minutes by the clock: from Start to the last set, plus one rest after it, with
 * each wait capped (20 minutes before the first set, 10 between sets), so a session left open, ended
 * and reopened, or finished an hour after the last set doesn't count the idle time. A set stamped
 * before Start counts from Start. Null for a late entry (its sets are stamped when they were typed),
 * without a start or a stamped set, or when the result is under 1 minute or over 180.
 */
export function clockMinutes(workout: Pick<Workout, 'date' | 'startedAt'>, loggedAt: readonly (string | undefined)[], restSeconds: number): number | null {
  if (isLateEntry(workout) || workout.startedAt === undefined) return null
  const start = Date.parse(workout.startedAt)
  const stamps = loggedAt
    .filter((t): t is string => t !== undefined)
    .map((t) => Date.parse(t))
    .filter((t) => Number.isFinite(t))
    .map((t) => Math.max(start, t))
    .sort((a, b) => a - b)
  if (!Number.isFinite(start) || stamps.length === 0) return null
  let seconds = restSeconds
  let previous = start
  stamps.forEach((t, i) => {
    const cap = (i === 0 ? FIRST_GAP_MAX_MINUTES : SET_GAP_MAX_MINUTES) * 60
    seconds += Math.min(cap, (t - previous) / 1000)
    previous = t
  })
  const minutes = Math.round(seconds / 60)
  return minutes >= 1 && minutes <= CLOCK_MAX_MINUTES ? minutes : null
}

/** One logged set as the estimate reads it: its count (reps, minutes, yards or steps in `reps`; seconds in `seconds`) and its unit. */
export interface LoggedWork {
  reps?: number
  seconds?: number
  repUnit: RepUnit
}

/** The minutes stepper's bounds, the same as `Workout.durationMinutes`'. */
const MINUTES_MIN = 1
const MINUTES_MAX = 300

/**
 * A session's minutes when the clock can't say: fitWindow's plain model of each logged set by its
 * unit (`setWorkSeconds`), a rest after each, and the phase's warm-up. Rounded to the minute, 1 to
 * 300. Finish and End label it an estimate; only what Shawn leaves on the stepper is stored.
 */
export function estimateMinutes(sets: readonly LoggedWork[], restSeconds: number, warmUpMinutes: number): number {
  const seconds = sets.reduce((sum, s) => sum + setWorkSeconds({ repsTarget: s.seconds ?? s.reps ?? 0, repUnit: s.repUnit }) + restSeconds, 0) + warmUpMinutes * 60
  return Math.min(MINUTES_MAX, Math.max(MINUTES_MIN, Math.round(seconds / 60)))
}

export interface MinutesPreset {
  minutes: number
  source: 'clock' | 'estimate'
}

/** What the minutes stepper on Finish, End and the Summary opens on: the clock when it can be trusted, else the estimate. */
export function minutesPreset(input: {
  workout: Pick<Workout, 'date' | 'startedAt'>
  sets: readonly (LoggedWork & { loggedAt?: string })[]
  restSeconds: number
  warmUpMinutes: number
}): MinutesPreset {
  const clock = clockMinutes(
    input.workout,
    input.sets.map((s) => s.loggedAt),
    input.restSeconds,
  )
  return clock !== null ? { minutes: clock, source: 'clock' } : { minutes: estimateMinutes(input.sets, input.restSeconds, input.warmUpMinutes), source: 'estimate' }
}

/** RPE × minutes; null when either is unknown or the minutes are not over 0. Unrounded: screens round. */
export function trainingLoadOf(rpe: number | null, minutes: number | null): number | null {
  if (rpe === null || minutes === null || !(minutes > 0)) return null
  return rpe * minutes
}

/** Banister's TRIMP weighting, for men: hrLoad = minutes × HRr × 0.64 × e^(1.92 × HRr). */
const TRIMP_WEIGHT = 0.64
const TRIMP_EXPONENT = 1.92

/** The two Settings numbers TRIMP needs, both present and sane. */
export interface HrPair {
  maxHr: number
  restingHr: number
}

/**
 * The stored heart-rate settings as TRIMP takes them, or null: a half-filled row (one stepper
 * touched stores one number, metrics phase 2) computes nothing, and a pair with resting at or
 * above max is impossible and computes nothing either. The one place that check lives.
 */
export function hrPair(settings: { maxHr?: number; restingHr?: number } | null | undefined): HrPair | null {
  if (!settings || settings.maxHr === undefined || settings.restingHr === undefined) return null
  if (!(settings.restingHr < settings.maxHr)) return null
  return { maxHr: settings.maxHr, restingHr: settings.restingHr }
}

/** Heart-rate reserve used, clamped to 0..1: an average below resting reads 0, above max reads 1. */
export function hrReserve(avgHr: number, restingHr: number, maxHr: number): number {
  return Math.min(1, Math.max(0, (avgHr - restingHr) / (maxHr - restingHr)))
}

/**
 * The HR load (Banister TRIMP, PROGRAM-QUESTIONS 151): minutes × HRr × 0.64 × e^(1.92 × HRr), with
 * HRr clamped to 0..1. Null unless the minutes are over 0, the average heart rate is set, and both
 * Settings numbers are there with resting under max (a pure function: future callers feed it raw
 * numbers, and resting at or over max would otherwise divide by zero or print plausible garbage).
 * An average below resting returns a computed 0, a true zero, not null: effort below resting is no
 * load, where null means no heart rate at all. Unrounded: screens round.
 */
export function hrLoadOf(minutes: number | null | undefined, avgHr: number | null | undefined, hr: HrPair | null): number | null {
  if (hr === null || !(hr.restingHr < hr.maxHr)) return null
  if (minutes === null || minutes === undefined || !(minutes > 0)) return null
  if (avgHr === null || avgHr === undefined) return null
  const reserve = hrReserve(avgHr, hr.restingHr, hr.maxHr)
  return minutes * reserve * TRIMP_WEIGHT * Math.exp(TRIMP_EXPONENT * reserve)
}

export type Missing = 'rpe' | 'minutes'

/** One session's or run's training load, or what it is missing. */
export interface TrainingLoadEntry {
  kind: 'workout' | 'run'
  id: string
  /** The day it happened, never the day it was entered. */
  date: IsoDate
  templateId?: string
  runType?: RunType
  rpe: number | null
  rpeSource: 'session' | 'sets' | 'rated' | 'word' | null
  minutes: number | null
  load: number | null
  /** The HR load (TRIMP), shown beside `load`, never summed into it. Only a run with an average heart rate and both Settings numbers has one; a lift never does (Workout has no HR fields). */
  hrLoad: number | null
  /** Whether a heart rate was logged at all (a run's average HR), its own fact: a run can carry one and still have a null `hrLoad` for lack of time. Always false for a lift. */
  hasHr: boolean
  missing: Missing[]
}

const happened = (w: Workout) => w.status === 'finished' || w.status === 'abandoned'

/**
 * Every lift that happened (finished or ended early) and every run and swap, with its training load,
 * by date and then id. A lift's minutes are only what was stored from the stepper; a run's are its
 * logged time. Unknown is never 0: an entry missing its RPE or minutes has a null load and says which.
 * `hr` is the Settings pair for the HR load (metrics phase 2); omitted or null, every entry's
 * `hrLoad` is null, so phase-1 call sites read as before. Lifts never carry one: Workout has no HR.
 */
export function trainingLoads(records: readonly WorkoutRecord[], runs: readonly Run[], hr: HrPair | null = null): TrainingLoadEntry[] {
  const lifts = records
    .filter((r) => happened(r.workout))
    .map(({ workout, sets }): TrainingLoadEntry => {
      const rated = workoutRpe(workout, sets)
      const minutes = workout.durationMinutes ?? null
      return entryOf({ kind: 'workout', id: workout.id, date: workout.date, templateId: workout.templateId }, rated?.rpe ?? null, rated?.source ?? null, minutes, null, false)
    })
  const ran = runs.map((run): TrainingLoadEntry => {
    const rated = runRpe(run)
    const minutes = run.minutes > 0 ? run.minutes : null
    return entryOf({ kind: 'run', id: run.id, date: run.date, runType: run.type }, rated.rpe, rated.source, minutes, hrLoadOf(minutes, run.avgHr, hr), run.avgHr !== undefined)
  })
  return [...lifts, ...ran].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

function entryOf(base: Pick<TrainingLoadEntry, 'kind' | 'id' | 'date' | 'templateId' | 'runType'>, rpe: number | null, rpeSource: TrainingLoadEntry['rpeSource'], minutes: number | null, hrLoad: number | null, hasHr: boolean): TrainingLoadEntry {
  const missing: Missing[] = [...(rpe === null ? (['rpe'] as const) : []), ...(minutes === null ? (['minutes'] as const) : [])]
  return { ...base, rpe, rpeSource, minutes, load: trainingLoadOf(rpe, minutes), hrLoad, hasHr, missing }
}

export interface WindowTrainingLoad {
  load: number
  counted: number
  notCounted: TrainingLoadEntry[]
}

/**
 * The training load from `from` to `to`, both days included, and the entries in it that aren't
 * counted. Since the warning moved to EWMA (Batch B) it no longer makes the ratio: `acuteChronic`
 * reads it only for the 'none' gate and to say which span an uncounted session or deload falls in.
 */
export function windowTrainingLoad(entries: readonly TrainingLoadEntry[], from: IsoDate, to: IsoDate): WindowTrainingLoad {
  const inside = entries.filter((e) => e.date >= from && e.date <= to)
  const counted = inside.filter((e) => e.load !== null)
  return { load: counted.reduce((sum, e) => sum + (e.load ?? 0), 0), counted: counted.length, notCounted: inside.filter((e) => e.load === null) }
}

/** Above this many times the longer rate reads high; below ACUTE_LOW reads low. Compared on the exact ratio. */
export const ACUTE_HIGH = 1.5
export const ACUTE_LOW = 0.8
/**
 * The warm-up: the comparison stays quiet until the first session or run is this many days back.
 * An EWMA computes from day one, but its first weeks swing on a handful of days (PROGRAM-QUESTIONS
 * 162b), so the quiet start is kept as a product gate, the same 35 days the rolling windows needed.
 * It is also the far end of the spans the skew words name: days 8 to 35 back.
 */
export const HISTORY_DAYS = 35

/**
 * The smoothing (Batch B, PROGRAM-QUESTIONS 162a): exponentially weighted moving averages of the
 * daily training load, acute over about 7 days and chronic over about 28. λ = 2 / (N + 1), the
 * form the EWMA acute:chronic literature uses (Williams et al. 2017, Br J Sports Med 51:209), chosen
 * over 1 − e^(−1/N), which differs by under 2% at these N: λ = 2/8 = 0.25 acute, 2/29 ≈ 0.069 chronic.
 */
export const ACUTE_SPAN_DAYS = 7
export const CHRONIC_SPAN_DAYS = 28
export const ACUTE_LAMBDA = 2 / (ACUTE_SPAN_DAYS + 1)
export const CHRONIC_LAMBDA = 2 / (CHRONIC_SPAN_DAYS + 1)

export type Band = 'high' | 'low' | 'steady' | 'too-early' | 'none'

/** The band of a ratio, strictly: above 1.5 high, below 0.8 low, else steady (1.5 and 0.8 themselves are steady). */
export function bandFor(ratio: number): 'high' | 'low' | 'steady' {
  return ratio > ACUTE_HIGH ? 'high' : ratio < ACUTE_LOW ? 'low' : 'steady'
}

/**
 * The counted training load of each day from `from` to `to`, both included, zero-filled: a day with
 * nothing counted adds nothing. Uncounted entries are left out here, never read as 0 load in their
 * own right; `windowTrainingLoad` lists them for the skew words. Empty when `to` is before `from`.
 * Only the warning reads this; the weekly chart's sums (`weeklyTrainingLoads`) never do.
 */
export function dailyTrainingLoads(entries: readonly TrainingLoadEntry[], from: IsoDate, to: IsoDate): number[] {
  if (to < from) return []
  const days = Array.from({ length: daysBetween(from, to) + 1 }, () => 0)
  for (const e of entries) {
    if (e.load === null || e.date < from || e.date > to) continue
    const i = daysBetween(from, e.date)
    days[i] = (days[i] ?? 0) + e.load
  }
  return days
}

/**
 * The EWMA of a daily series at its last day: seeded at 0 the day before the first, then
 * ewma_t = λ · load_t + (1 − λ) · ewma_(t−1), divided by the bias correction 1 − (1 − λ)^t so the zero
 * seed doesn't read as days of rest (constant training reads its own level from the first day;
 * PROGRAM-QUESTIONS 162b). 0 for an empty series.
 */
export function smoothedLoad(series: readonly number[], lambda: number): number {
  if (series.length === 0) return 0
  let value = 0
  for (const load of series) value = lambda * load + (1 - lambda) * value
  return value / (1 - (1 - lambda) ** series.length)
}

/** Something that moves the ratio, and which way: uncounted sessions or a deload week, in either of the two spans. */
export interface Skew {
  why: 'not-counted' | 'deload'
  window: 'acute' | 'chronic'
  /**
   * Which way it makes the shown ratio read against what was really done, from the EWMA weights of
   * the days it covers (`skewReads`): 'either' when those days fall on both sides of the ratio.
   */
  reads: 'lower' | 'higher' | 'either'
}

/**
 * How much more a day's load moves the acute EWMA than the chronic one: w_a / w_c for a day
 * `daysBack` days before today (1 is yesterday) in a series `length` days long, each weight
 * λ(1 − λ)^(daysBack − 1) over its bias correction 1 − (1 − λ)^length. About 3.6 yesterday, 1.53
 * five days back, 1.23 six, 0.99 seven, 0.80 eight (PROGRAM-QUESTIONS 162d).
 */
export function weightRatio(daysBack: number, length: number): number {
  const lag = daysBack - 1
  const acute = (ACUTE_LAMBDA * (1 - ACUTE_LAMBDA) ** lag) / (1 - (1 - ACUTE_LAMBDA) ** length)
  const chronic = (CHRONIC_LAMBDA * (1 - CHRONIC_LAMBDA) ** lag) / (1 - (1 - CHRONIC_LAMBDA) ** length)
  return acute / chronic
}

/**
 * Which way load missing from these days makes the shown ratio read. Adding load L on a day moves
 * the ratio R = A / C to (A + w_a·L) / (C + w_c·L), which is above R exactly when w_a / w_c is above
 * R. So a day whose weight ratio is above R, counted, would raise the ratio: the shown one reads
 * lower; below R it reads higher. Days on both sides: 'either' (which wins depends on loads nobody
 * knows). Null when every day sits exactly on R and so moves nothing.
 */
export function skewReads(daysBack: readonly number[], length: number, ratio: number): Skew['reads'] | null {
  const above = daysBack.some((d) => weightRatio(d, length) > ratio)
  const below = daysBack.some((d) => weightRatio(d, length) < ratio)
  if (above && below) return 'either'
  if (above) return 'lower'
  if (below) return 'higher'
  return null
}

export interface AcuteChronic {
  band: Band
  /**
   * The spans the skew words name (EWMA has no windows): the last 7 days through yesterday and the
   * 28 days before them. Which way a skew in either reads comes from the days' EWMA weights against
   * the ratio, not from the span (`skewReads`). The 'none' gate also reads the 28 days before
   * (PROGRAM-QUESTIONS 162).
   */
  acuteFrom: IsoDate
  acuteTo: IsoDate
  chronicFrom: IsoDate
  chronicTo: IsoDate
  /** A week at the recent rate: 7 × the acute EWMA of the daily load through yesterday. */
  acute: number
  /** A week at the longer rate: 7 × the chronic EWMA through yesterday. Null while too early. */
  chronicWeek: number | null
  /** acute / chronicWeek, which is the EWMA ratio itself (the 7s cancel). Null unless high, low or steady. */
  ratio: number | null
  /** While too early with something logged: the first day the comparison runs. */
  startsOn: IsoDate | null
  notCountedAcute: TrainingLoadEntry[]
  notCountedChronic: TrainingLoadEntry[]
  /** Only with a ratio (high, low or steady): acute span first, uncounted before deload. */
  skews: Skew[]
}

const deloadDays = (from: IsoDate, to: IsoDate, startDate: IsoDate) =>
  Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i)).filter((d) => isDeloadWeek(weekOf(d, startDate)))

/**
 * The warning (Batch B: EWMA, PROGRAM-QUESTIONS 162): the daily training load from the first entry
 * through yesterday, smoothed twice (acute λ 0.25, chronic λ 2/29), each printed as a week at that
 * rate. It ends yesterday, so the morning reads the same before and after today's session. Too early
 * until the first session is 35 days back (`startsOn` says when); 'none' when the 28 days before the
 * last 7 hold no counted load (the rolling windows' meaning, kept so a return from a layoff never
 * divides by the faint tail of months-old training). Above 1.5 high, below 0.8 low, else steady.
 */
export function acuteChronic(entries: readonly TrainingLoadEntry[], today: IsoDate, startDate: IsoDate): AcuteChronic {
  const acuteFrom = addDays(today, -ACUTE_SPAN_DAYS)
  const acuteTo = addDays(today, -1)
  const chronicFrom = addDays(today, -HISTORY_DAYS)
  const chronicTo = addDays(today, -ACUTE_SPAN_DAYS - 1)
  const acuteSpan = windowTrainingLoad(entries, acuteFrom, acuteTo)
  const chronicSpan = windowTrainingLoad(entries, chronicFrom, chronicTo)
  const firstDate = entries.reduce<IsoDate | null>((first, e) => (first === null || e.date < first ? e.date : first), null)
  const series = firstDate === null ? [] : dailyTrainingLoads(entries, firstDate, acuteTo)
  const acuteRate = smoothedLoad(series, ACUTE_LAMBDA)
  const chronicRate = smoothedLoad(series, CHRONIC_LAMBDA)
  const base = { acuteFrom, acuteTo, chronicFrom, chronicTo, acute: 7 * acuteRate, notCountedAcute: acuteSpan.notCounted, notCountedChronic: chronicSpan.notCounted }
  if (firstDate === null || firstDate > chronicFrom) {
    return { ...base, band: 'too-early', chronicWeek: null, ratio: null, startsOn: firstDate === null ? null : addDays(firstDate, HISTORY_DAYS), skews: [] }
  }
  const chronicWeek = 7 * chronicRate
  if (chronicSpan.load === 0 || chronicRate === 0) return { ...base, band: 'none', chronicWeek, ratio: null, startsOn: null, skews: [] }
  const ratio = acuteRate / chronicRate
  const skews: Skew[] = []
  const skew = (why: Skew['why'], window: Skew['window'], days: readonly IsoDate[]) => {
    if (days.length === 0) return
    const reads = skewReads(
      days.map((d) => daysBetween(d, today)),
      series.length,
      ratio,
    )
    if (reads !== null) skews.push({ why, window, reads })
  }
  skew('not-counted', 'acute', acuteSpan.notCounted.map((e) => e.date))
  skew('deload', 'acute', deloadDays(acuteFrom, acuteTo, startDate))
  skew('not-counted', 'chronic', chronicSpan.notCounted.map((e) => e.date))
  skew('deload', 'chronic', deloadDays(chronicFrom, chronicTo, startDate))
  return { ...base, band: bandFor(ratio), chronicWeek, ratio, startsOn: null, skews }
}

export interface TrainingLoadWeek {
  week: number
  load: number
  /** Entries counted. */
  sessions: number
  notCounted: number
  isDeload: boolean
  /** The week's HR load (TRIMP), summed over the entries that have one; 0 with none. Shown beside `load`, never added to it. */
  hrLoad: number
  /** How many of the week's entries carried a heart rate at all (`hasHr`), whether or not a load came of it: the words say "had heart rate", so this counts exactly that. */
  withHr: number
  /** Of `withHr`, how many have no HR load: heart rate logged, no time, so nothing computable. The words name it, as the sRPE side's "no time logged" does. */
  hrNotCounted: number
  /** The week's runs and swaps: the only entries that can carry an HR load, so the words' denominator ("2 of 3 runs had heart rate"). */
  runs: number
}

/** Program weeks 1 to `weeks`, each with its training load; entries outside them are dropped. */
export function weeklyTrainingLoads(entries: readonly TrainingLoadEntry[], startDate: IsoDate, weeks: number): TrainingLoadWeek[] {
  return Array.from({ length: Math.max(0, weeks) }, (_, i) => {
    const week = i + 1
    const own = entries.filter((e) => weekOf(e.date, startDate) === week)
    const counted = own.filter((e) => e.load !== null)
    const withHr = own.filter((e) => e.hasHr)
    return {
      week,
      load: counted.reduce((sum, e) => sum + (e.load ?? 0), 0),
      sessions: counted.length,
      notCounted: own.length - counted.length,
      isDeload: isDeloadWeek(week),
      hrLoad: own.reduce((sum, e) => sum + (e.hrLoad ?? 0), 0),
      withHr: withHr.length,
      hrNotCounted: withHr.filter((e) => e.hrLoad === null).length,
      runs: own.filter((e) => e.kind === 'run').length,
    }
  })
}
