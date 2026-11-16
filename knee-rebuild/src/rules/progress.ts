import type { IsoDate, MileageWeek, MorningCheck, Run, SessionMove, SetLog, Settings, Side, WeeklyTemplate, Workout } from '../schema/index.ts'
import { DAYS, addDays, dateOf, daysBetween, weekOf, weekSchedule } from './calendar.ts'
import { isRackCapped } from './gymLoads.ts'
import type { SubjectReading, WorkoutRecord } from './history.ts'
import { locationIdOf } from './locations.ts'
import { weekMiles } from './mileage.ts'
import { morningCheckApplies } from './reading.ts'
import { symmetryPercent } from './unilateral.ts'

const happened = (r: WorkoutRecord) => r.workout.status === 'finished' || r.workout.status === 'abandoned'

/** The set that stands for a side in one session: the heaviest load, then the most reps or seconds. */
function bestSet(sets: readonly SetLog[]): SetLog | undefined {
  return [...sets].sort((a, b) => b.load - a.load || (b.reps ?? b.seconds ?? 0) - (a.reps ?? a.seconds ?? 0))[0]
}

const count = (s: SetLog) => s.reps ?? s.seconds ?? 0

export interface LoadPoint {
  date: IsoDate
  side: SetLog['side']
  load: number
  count: number
}

/** Load over time for one exercise: per session and side, the heaviest set across the workout's slots (display only; the gate prefill and the symmetry line pair sides within one slot, `slotPairs`). Stopped sets count as logged. */
export function loadSeries(records: readonly WorkoutRecord[], exerciseId: string): LoadPoint[] {
  const points: LoadPoint[] = []
  for (const record of records) {
    if (!happened(record)) continue
    const own = record.sets.filter((s) => s.exerciseId === exerciseId)
    for (const side of new Set(own.map((s) => s.side))) {
      const best = bestSet(own.filter((s) => s.side === side))
      if (best) points.push({ date: record.workout.date, side, load: best.load, count: count(best) })
    }
  }
  return points.sort((a, b) => a.date.localeCompare(b.date))
}

/** One slot's pair in a session: the injured side's best set and the other side's, both logged on that slot. */
export interface SlotPair {
  slotId: string
  injured: SetLog
  other: SetLog
}

/**
 * The pairs one session logged for an exercise, one per slot that logged both sides, in slot-id
 * order: each side's best set on that slot (`bestSet`). Sides are paired within a slot, never across
 * two: a program slot and an added or extra-time slot of the same exercise on the same day are two
 * pairs, so the injured side's best from one can't meet the other side's best from the other and
 * show a symmetry no slot did (Batch C, PROGRAM-QUESTIONS 168). A session whose sides were logged on
 * different slots has no pair. Sets of other exercises, and `both` sets, are not read.
 */
export function slotPairs(record: WorkoutRecord, exerciseId: string, injuredSide: Side): SlotPair[] {
  const otherSide: Side = injuredSide === 'left' ? 'right' : 'left'
  const own = record.sets.filter((s) => s.exerciseId === exerciseId)
  const slotIds = [...new Set(own.map((s) => s.slotId))].sort()
  const pairs: SlotPair[] = []
  for (const slotId of slotIds) {
    const onSlot = own.filter((s) => s.slotId === slotId)
    const injured = bestSet(onSlot.filter((s) => s.side === injuredSide))
    const other = bestSet(onSlot.filter((s) => s.side === otherSide))
    if (injured && other) pairs.push({ slotId, injured, other })
  }
  return pairs
}

/** Of several pairs, the least symmetric by load (injured ÷ other, both above 0); ties to the lower injured load, then the slot id. */
function leastSymmetric(pairs: readonly SlotPair[]): SlotPair | undefined {
  const ratio = (p: SlotPair) => p.injured.load / p.other.load
  return [...pairs].sort((a, b) => ratio(a) - ratio(b) || a.injured.load - b.injured.load || a.slotId.localeCompare(b.slotId))[0]
}

/** The session a gate's load test opens on, each side's heaviest set, and the gym it ran at. */
export interface LoadTestSession {
  date: IsoDate
  workoutId: string
  /** The workout's stamped gym; one with none stamped ran at Planet Fitness. */
  locationId: string
  injured: number
  other: number
}

export interface LoadTestPrefill {
  prefill: LoadTestSession | null
  /** Later sessions that logged both sides but were passed over, by why. */
  passedOver: { rackCapped: number; noLoad: number }
}

/**
 * The loads a gate's load test opens on, so they get confirmed rather than retyped (PROGRAM-QUESTIONS
 * 25): the latest session, finished or abandoned, that logged both sides of the exercise, each side's
 * heaviest set as loadSeries reads it. A session where any set of the exercise was rack-capped is
 * passed over, both sides, as it is for the baseline (question 73): its loads are the rack's, so a
 * hotel's 25 against 25 would open the test on a 100% the knee never lifted. So is one where either
 * side's heaviest set carried no load, since a load test needs a load on each side and a bodyweight
 * session would hide the last loaded one (PROGRAM-QUESTIONS 115). Null when nothing is left; either
 * way, what was passed over is counted, so the screen can say so.
 *
 * Both sides are read from one slot (`slotPairs`, PROGRAM-QUESTIONS 168): a session whose sides were
 * logged only on different slots is not a both-sides session. With two slots of the exercise that
 * day (the program's and an added or extra-time one), the pair with the lowest injured ÷ other load
 * opens the test, the conservative one. A rack-capped set anywhere in the session passes it over.
 */
export function loadTestPrefill(records: readonly WorkoutRecord[], exerciseId: string, injuredSide: Side): LoadTestPrefill {
  const passedOver = { rackCapped: 0, noLoad: 0 }
  // Newest first; of two on one date, the later one written.
  for (const record of [...records].reverse().sort((a, b) => b.workout.date.localeCompare(a.workout.date))) {
    if (!happened(record)) continue
    const pairs = slotPairs(record, exerciseId, injuredSide)
    if (pairs.length === 0) continue
    if (record.sets.some((s) => s.exerciseId === exerciseId && isRackCapped(s))) {
      passedOver.rackCapped += 1
      continue
    }
    const pick = leastSymmetric(pairs.filter((p) => p.injured.load > 0 && p.other.load > 0))
    if (!pick) {
      passedOver.noLoad += 1
      continue
    }
    return { prefill: { date: record.workout.date, workoutId: record.workout.id, locationId: locationIdOf(record.workout), injured: pick.injured.load, other: pick.other.load }, passedOver }
  }
  return { prefill: null, passedOver }
}

export interface SymmetryPoint {
  date: IsoDate
  percent: number
  /** What was compared: the heaviest loads when they differ (a 0 included), else the counts. */
  basis: 'load' | 'count'
  injured: number
  other: number
}

/** A session the symmetry line leaves out, and why, in words. */
export interface SymmetryLeftOut {
  date: IsoDate
  reason: string
}

const sides = (a: string, b: string) => `(${a} on the injured side, ${b} on the other)`

/**
 * Why two sides' best sets can't be compared like for like, or null when they can: a step height,
 * a stage or a range stop that differs is part of how hard the set was, and neither the loads nor
 * the counts carry it (PROGRAM-QUESTIONS 112).
 */
function unlike(a: SetLog, b: SetLog): string | null {
  const inches = (h: number | undefined) => (h === undefined ? 'no step logged' : `${h} in.`)
  const stage = (n: number | undefined) => (n === undefined ? 'no stage logged' : `stage ${n + 1}`)
  const range = (deg: number | undefined) => (deg === undefined ? 'no range logged' : `${deg}°`)
  if (a.heightIn !== b.heightIn) return `the sides stepped from different heights ${sides(inches(a.heightIn), inches(b.heightIn))}`
  if (a.stage !== b.stage) return `the sides were on different stages ${sides(stage(a.stage), stage(b.stage))}`
  if (a.rangeStopDeg !== b.rangeStopDeg) return `the sides stopped at different ranges ${sides(range(a.rangeStopDeg), range(b.rangeStopDeg))}`
  return null
}

type SessionSymmetry = { point: SymmetryPoint } | { leftOut: SymmetryLeftOut }

/** One pair's symmetry, or why it is left out. */
function pairSymmetry(date: IsoDate, a: SetLog, b: SetLog): SessionSymmetry {
  const why = unlike(a, b)
  if (why) return { leftOut: { date, reason: why } }
  const byLoad = a.load !== b.load
  const injured = byLoad ? a.load : count(a)
  const healthy = byLoad ? b.load : count(b)
  const percent = symmetryPercent(injured, healthy)
  if (percent === null) {
    const reason = byLoad
      ? `only the injured side carried a load (${a.load} ${a.loadUnit} against 0 ${b.loadUnit}), so there is no percent`
      : `the other side logged 0 ${b.seconds !== undefined ? 'seconds' : 'reps'}, so there is no percent`
    return { leftOut: { date, reason } }
  }
  return { point: { date, percent, basis: byLoad ? 'load' : 'count', injured, other: healthy } }
}

/**
 * One session's symmetry, or why it is left out; null when no slot logged both sides. Sides are
 * paired within a slot (`slotPairs`), as the Gates prefill pairs them, so the two screens never read
 * one session two ways; with two slots of the exercise that day, the lowest percent stands
 * (PROGRAM-QUESTIONS 168).
 */
function sessionSymmetry(record: WorkoutRecord, exerciseId: string, injuredSide: Side): SessionSymmetry | null {
  if (!happened(record)) return null
  const pairs = slotPairs(record, exerciseId, injuredSide)
  const first = pairs[0]
  if (!first) return null
  const date = record.workout.date
  // A capped set ran at the gym's heaviest dumbbell, not the load the knee was on (question 73).
  if (record.sets.some((s) => s.exerciseId === exerciseId && isRackCapped(s))) {
    return { leftOut: { date, reason: `the gym’s rack capped the loads ${sides(`${first.injured.load} ${first.injured.loadUnit}`, `${first.other.load} ${first.other.loadUnit}`)}, so they say nothing of the knee` } }
  }
  const read = pairs.map((p) => pairSymmetry(date, p.injured, p.other))
  const points = read.flatMap((r) => ('point' in r ? [r.point] : []))
  const lowest = [...points].sort((x, y) => x.percent - y.percent || x.injured - y.injured)[0]
  return lowest ? { point: lowest } : (read[0] ?? null)
}

/**
 * Symmetry over time for a two-sided exercise: per session, the injured side's best set over the
 * other side's. Loads are compared whenever they differ, a 0 included (the healthy side may lift
 * more, rule 5): the injured side at bodyweight against 20 lb reads 0%, as the gate's load test
 * reads it, never 100% by counts. Only when the loads are equal (both 0 included) are the reps or
 * seconds compared, since rule 5 sets the healthy side's count from the injured side's. A session
 * where only the other side carried no load has no percent and is left out (PROGRAM-QUESTIONS 111),
 * and so is one whose sides were on different steps, stages or ranges (PROGRAM-QUESTIONS 112), and
 * one where any set of the exercise was rack-capped, since its loads were the rack's (PROGRAM-QUESTIONS
 * 116); symmetryLeftOut says which and why.
 */
export function symmetrySeries(records: readonly WorkoutRecord[], exerciseId: string, injuredSide: Side): SymmetryPoint[] {
  const points: SymmetryPoint[] = []
  for (const record of records) {
    const s = sessionSymmetry(record, exerciseId, injuredSide)
    if (s && 'point' in s) points.push(s.point)
  }
  return points.sort((a, b) => a.date.localeCompare(b.date))
}

/** The sessions that logged both sides but that symmetrySeries leaves out, oldest first, each with the reason. */
export function symmetryLeftOut(records: readonly WorkoutRecord[], exerciseId: string, injuredSide: Side): SymmetryLeftOut[] {
  const out: SymmetryLeftOut[] = []
  for (const record of records) {
    const s = sessionSymmetry(record, exerciseId, injuredSide)
    if (s && 'leftOut' in s) out.push(s.leftOut)
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

export interface MilesWeek {
  week: number
  planned: number
  actual: number
  isDown: boolean
}

/** Weekly miles, actual against the plan, for every week of the plan (swaps add no miles). */
export function milesSeries(plan: readonly MileageWeek[], runs: readonly Run[], startDate: IsoDate): MilesWeek[] {
  return plan.map((w) => ({ week: w.week, planned: w.targetMiles, isDown: w.isDown, actual: weekMiles(runs.filter((r) => weekOf(r.date, startDate) === w.week)) }))
}

/**
 * A reading still waiting on its morning check: the session or run is dated today or yesterday,
 * so its check can still be logged, and no check applies to it yet (morningCheckApplies, an
 * explicit link included). Older than that, a missing check is final: the reading is hold, as
 * everywhere else (rule 3).
 */
export function awaitingMorningCheck(reading: Pick<SubjectReading, 'kind' | 'id' | 'date' | 'result'>, checks: readonly MorningCheck[], today: IsoDate): boolean {
  if (reading.date > today || reading.date < addDays(today, -1)) return false
  // Without a check a reading is the session's own, held at hold or worse; back-off can only have
  // come from the session's pain, and no check makes it better, so it breaks the count at once.
  if (reading.result === 'back-off') return false
  return !checks.some((c) => morningCheckApplies(c, reading))
}

/**
 * Consecutive clean days: the days from the day after the most recent hold or back-off reading
 * through the last fully read day. With no reading at all there is nothing to count. A day without
 * a session doesn't break the run; a reading that isn't clean does. A session still waiting on its
 * morning check (awaitingMorningCheck) neither extends nor breaks it: its day and any after it
 * aren't counted yet, so the run counts back from the day before the earliest one waiting, and
 * once the check is in its reading counts as usual (PROGRAM-QUESTIONS 109).
 */
export function consecutiveCleanDays(readings: readonly SubjectReading[], today: IsoDate, checks: readonly MorningCheck[]): number {
  const past = readings.filter((r) => r.date <= today).sort((a, b) => a.date.localeCompare(b.date))
  const waiting = past.filter((r) => awaitingMorningCheck(r, checks, today))
  const read = past.filter((r) => !awaitingMorningCheck(r, checks, today))
  if (read.length === 0) return 0
  const firstWaiting = waiting[0]?.date
  const through = firstWaiting ? addDays(firstWaiting, -1) : today
  const lastBad = read.filter((r) => r.result !== 'clean').at(-1)
  const from = lastBad ? addDays(lastBad.date, 1) : read[0]?.date
  if (!from || from > through) return 0
  return daysBetween(from, through) + 1
}

/**
 * The program week a phase confirmed today is entered in. The phase's week bands (snap-downs from
 * its third week, the plyo ladder) assume its first week holds every lift of that week, so the
 * confirming week counts only when all its lifts are still ahead: none started, finished or left
 * early, and none scheduled (after the week's moves) before today. Otherwise the phase is entered
 * the week after, and the rest of the confirming week runs the new templates at the bands' first
 * week. Confirming on Sunday Nov 22, after week 3's Lift C, enters Phase 2 in week 4, so the
 * snap-downs start in week 6 as program.md says (PROGRAM-QUESTIONS 113, refining 46).
 */
export function phaseEntryWeek(input: {
  today: IsoDate
  startDate: IsoDate
  template: WeeklyTemplate
  moves: readonly SessionMove[]
  workouts: readonly Pick<Workout, 'date' | 'status'>[]
}): number {
  const { today, startDate, template, moves, workouts } = input
  const week = weekOf(today, startDate)
  if (week < 1) return 1
  const schedule = weekSchedule(template, week, moves)
  const liftPassed = DAYS.some((day) => schedule[day].startsWith('lift:') && dateOf(startDate, week, day) < today)
  const liftLogged = workouts.some((w) => w.status !== 'planned' && w.date <= today && weekOf(w.date, startDate) === week)
  return liftPassed || liftLogged ? week + 1 : week
}

/**
 * The sessions a phase advance waits for: any lift still in progress, oldest first. It was planned in
 * the phase it started in, and advancing under it would replan it in the new one mid-session, the
 * week bands counted from the new phase's entry, so a banded slot it has already logged could drop
 * out. It is finished or ended early first (PROGRAM-QUESTIONS 117).
 */
export function advanceWaitsFor<W extends Pick<Workout, 'status' | 'date'>>(workouts: readonly W[]): W[] {
  return workouts.filter((w) => w.status === 'in-progress').sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Rule 8's last step: a passing gate advances the phase only when Shawn confirms, and the new phase
 * is entered in the week given, phaseEntryWeek's answer for the day it is confirmed. Refuses
 * anything else.
 */
export function advancePhase(settings: Settings, gate: { number: number; toPhase: number }, passes: boolean, week: number): Settings {
  if (!passes) throw new Error(`gate ${gate.number} has items that don't pass yet`)
  if (gate.toPhase !== settings.currentPhase + 1) throw new Error(`gate ${gate.number} leads to phase ${gate.toPhase}, not the phase after ${settings.currentPhase}`)
  return { ...settings, currentPhase: gate.toPhase, phaseEnteredWeek: Math.max(1, week) }
}
