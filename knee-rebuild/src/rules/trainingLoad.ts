import type { Effort, IsoDate, RepUnit, Run, RunType, SetLog, Workout } from '../schema/index.ts'
import { addDays, daysBetween, isDeloadWeek, weekOf } from './calendar.ts'
import { setWorkSeconds } from './fitWindow.ts'
import type { WorkoutRecord } from './history.ts'
import { isLateEntry } from './retro.ts'

/*
 * Training load (metrics phase 1, docs/metrics-and-photos-plan.md): how hard a session was times how
 * long it took, RPE × minutes, for every lift and run, and the warning when the last 7 days run well
 * above or below the weeks before. It is a warning only. Nothing here feeds a prescription, a reading,
 * a cap or a gate: the guard (trainingLoad.guard.test.ts) holds every other rule module away from it
 * and from the fields it reads. "Load" on Progress already means weight lifted, so this is always
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

/** The training load from `from` to `to`, both days included, and the entries in it that aren't counted. */
export function windowTrainingLoad(entries: readonly TrainingLoadEntry[], from: IsoDate, to: IsoDate): WindowTrainingLoad {
  const inside = entries.filter((e) => e.date >= from && e.date <= to)
  const counted = inside.filter((e) => e.load !== null)
  return { load: counted.reduce((sum, e) => sum + (e.load ?? 0), 0), counted: counted.length, notCounted: inside.filter((e) => e.load === null) }
}

/** Above this many times the average week reads high; below ACUTE_LOW reads low. Compared on the exact ratio. */
export const ACUTE_HIGH = 1.5
export const ACUTE_LOW = 0.8
/** The history the comparison needs: the 28 days before the last 7, which end yesterday. */
export const HISTORY_DAYS = 35

export type Band = 'high' | 'low' | 'steady' | 'too-early' | 'none'

/** Something that moves the ratio, and which way: uncounted sessions or a deload week, in either of the two spans. */
export interface Skew {
  why: 'not-counted' | 'deload'
  window: 'acute' | 'chronic'
  /** Which way it makes the ratio read against what was really done. */
  reads: 'lower' | 'higher'
}

export interface AcuteChronic {
  band: Band
  /** The 7 days through yesterday. */
  acuteFrom: IsoDate
  acuteTo: IsoDate
  /** The 28 days before them. */
  chronicFrom: IsoDate
  chronicTo: IsoDate
  acute: number
  /** The 28 days' training load over 4: the average week. Null while too early. */
  chronicWeek: number | null
  ratio: number | null
  /** While too early with something logged: the first day the comparison runs. */
  startsOn: IsoDate | null
  notCountedAcute: TrainingLoadEntry[]
  notCountedChronic: TrainingLoadEntry[]
  /** Only with a ratio (high, low or steady): acute window first, uncounted before deload. */
  skews: Skew[]
}

const touchesDeload = (from: IsoDate, to: IsoDate, startDate: IsoDate) =>
  Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => addDays(from, i)).some((d) => isDeloadWeek(weekOf(d, startDate)))

/**
 * The last 7 days' training load against the average week of the 28 days before. The 7 days end
 * yesterday, so the morning reads the same before and after today's session. Too early until the
 * first session is 35 days back (`startsOn` says when); 'none' when the 28 days before hold no
 * training load to compare against. Above 1.5 high, below 0.8 low, else steady.
 */
export function acuteChronic(entries: readonly TrainingLoadEntry[], today: IsoDate, startDate: IsoDate): AcuteChronic {
  const acuteFrom = addDays(today, -7)
  const acuteTo = addDays(today, -1)
  const chronicFrom = addDays(today, -HISTORY_DAYS)
  const chronicTo = addDays(today, -8)
  const acute = windowTrainingLoad(entries, acuteFrom, acuteTo)
  const chronic = windowTrainingLoad(entries, chronicFrom, chronicTo)
  const base = { acuteFrom, acuteTo, chronicFrom, chronicTo, acute: acute.load, notCountedAcute: acute.notCounted, notCountedChronic: chronic.notCounted }
  const firstDate = entries.reduce<IsoDate | null>((first, e) => (first === null || e.date < first ? e.date : first), null)
  if (firstDate === null || firstDate > chronicFrom) {
    return { ...base, band: 'too-early', chronicWeek: null, ratio: null, startsOn: firstDate === null ? null : addDays(firstDate, HISTORY_DAYS), skews: [] }
  }
  const chronicWeek = chronic.load / 4
  if (chronicWeek === 0) return { ...base, band: 'none', chronicWeek, ratio: null, startsOn: null, skews: [] }
  const ratio = acute.load / chronicWeek
  const band: Band = ratio > ACUTE_HIGH ? 'high' : ratio < ACUTE_LOW ? 'low' : 'steady'
  const skews: Skew[] = []
  if (acute.notCounted.length > 0) skews.push({ why: 'not-counted', window: 'acute', reads: 'lower' })
  if (touchesDeload(acuteFrom, acuteTo, startDate)) skews.push({ why: 'deload', window: 'acute', reads: 'lower' })
  if (chronic.notCounted.length > 0) skews.push({ why: 'not-counted', window: 'chronic', reads: 'higher' })
  if (touchesDeload(chronicFrom, chronicTo, startDate)) skews.push({ why: 'deload', window: 'chronic', reads: 'higher' })
  return { ...base, band, chronicWeek, ratio, startsOn: null, skews }
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
