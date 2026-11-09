import type { MileageWeek, ReadingResult, Run } from '../schema/index.ts'

/** Swaps count as the week's session but add no miles (PROMPT section 3). */
export function isSwap(run: Pick<Run, 'type'>): boolean {
  return run.type === 'elliptical-swap' || run.type === 'rower-swap'
}

export function weekMiles(runs: readonly Run[]): number {
  return Math.round(runs.filter((r) => !isSwap(r)).reduce((sum, r) => sum + r.miles, 0) * 100) / 100
}

export function weekSessions(runs: readonly Run[]): number {
  return runs.length
}

export function planTarget(plan: readonly MileageWeek[], week: number): number | null {
  return plan.find((w) => w.week === week)?.targetMiles ?? null
}

export interface PreviousWeek {
  /** Every reading in that week, runs and workouts alike. */
  readings: readonly ReadingResult[]
  actualMiles: number
}

export interface WeekTarget {
  target: number | null
  capped: boolean
  reason: string
  /**
   * A down period set this week's target (Batch E, PROGRAM-QUESTIONS 183; `targetForWeek` in
   * weekPlan.ts): `held`, a period covered the week's Monday, so it stays at last week's; `climbing`,
   * the weeks after one, back up one plan step a week from last week's. Present only when it binds
   * (the target is below what rule 7 alone gives); `weekTarget` never sets it.
   */
  downPeriod?: { kind: 'held' | 'climbing'; lastWeek: number }
}

/**
 * Rule 7: the plan's number, unless any run or workout in the previous week read hold or back-off,
 * in which case the target is capped at that week's actual miles. A cap at or above the plan's
 * number changes nothing, so it is no cap: capped is false and the reason is the plan's (M4 review).
 * capped is true exactly when the target is below the plan's number.
 */
export function weekTarget(plan: readonly MileageWeek[], week: number, previous: PreviousWeek | null): WeekTarget {
  const planned = planTarget(plan, week)
  if (planned === null) return { target: null, capped: false, reason: `week ${week} is outside the 12-week plan` }
  if (previous && previous.readings.some((r) => r !== 'clean') && previous.actualMiles < planned) {
    return { target: previous.actualMiles, capped: true, reason: `last week read ${previous.readings.includes('back-off') ? 'back-off' : 'hold'}: capped at last week’s ${previous.actualMiles} miles` }
  }
  return { target: planned, capped: false, reason: 'from the plan' }
}

export function roundToHalf(miles: number): number {
  return Math.round(miles * 2) / 2
}

export interface RunSplit {
  long: number
  /** Each of the other two runs. */
  others: number
}

/** The long run is 40% of the week's target rounded to the nearest half mile; the other two split the remainder to the quarter mile. */
export function runSplit(target: number, longShare = 0.4): RunSplit {
  const long = roundToHalf(target * longShare)
  const others = Math.round(((target - long) / 2) * 4) / 4
  return { long, others }
}
