import type { SetLog } from '../schema/index.ts'

/**
 * Rule 5: the healthy side's target for each set equals the injured side's completed reps (or
 * seconds) for that set number. Its load may match or exceed; that is decided per side in prescribe.
 */
export function healthySideTargets(injuredSets: readonly SetLog[]): number[] {
  return [...injuredSets]
    .sort((a, b) => a.setNumber - b.setNumber)
    .map((s) => s.reps ?? s.seconds ?? 0)
}

/**
 * The ratio in tenths of a percent, rounded down: 56 / 62 is 903. The 1e-9 only absorbs floating
 * point (54 / 60 is 900, not 899); it is far below any value a stepper can enter.
 */
function tenths(injured: number, other: number): number | null {
  if (!(other > 0) || injured < 0) return null
  return Math.floor((injured / other) * 1000 + 1e-9)
}

/**
 * Symmetry is the injured value over the other side's value, as a percent to one decimal, rounded
 * down so a value just under a gate's line never reads as the line (188 / 209 is 89.9%, not 90%;
 * PROGRAM-QUESTIONS 110). Null when it can't be computed.
 */
export function symmetryPercent(injured: number, other: number): number | null {
  const t = tenths(injured, other)
  return t === null ? null : t / 10
}

/**
 * Whether the injured side reaches the gate's line (0.8 for gate 1, 0.9 for gates 2 and 3). Decided
 * on the same rounded-down tenths symmetryPercent shows, so the words and the verdict agree: 89.96%
 * reads 89.9% and fails a 90% line (PROGRAM-QUESTIONS 110).
 */
export function meetsSymmetry(injured: number, other: number, threshold: number): boolean {
  const t = tenths(injured, other)
  return t !== null && t >= Math.round(threshold * 1000)
}

/** Hop tests store three trials per side and keep the best. */
export function bestOfTrials(trials: readonly number[]): number {
  if (trials.length === 0) return 0
  return Math.max(...trials)
}

/**
 * Timed hops keep the FASTEST trial: lower is better, in seconds (the 6-meter timed hop, Batch A).
 * A hop he couldn't do has no time — 0 would read as the fastest trial and the inverted ratio
 * would divide by it, so non-positive values are ignored here as rules-level defense (the form
 * refuses them in words first; PROGRAM-QUESTIONS 157, which rereads 108 for a time). Null when no
 * usable time exists.
 */
export function fastestOfTrials(trials: readonly number[]): number | null {
  const usable = trials.filter((t) => t > 0)
  return usable.length === 0 ? null : Math.min(...usable)
}

/**
 * A timed hop's symmetry: the OTHER side's best time over the INJURED side's, as a percent to one
 * decimal rounded down, so a slower injured side reads under 100% and a ratio just under a gate's
 * line never reads the line (the 188/209 discipline of PROGRAM-QUESTIONS 110, inverted). The same
 * tenths as symmetryPercent with the arguments swapped, so words and verdict agree. Null without
 * a positive injured-side time.
 */
export function timedSymmetryPercent(injured: number, other: number): number | null {
  return symmetryPercent(other, injured)
}

/** Whether a timed hop reaches the gate's line, decided on the same rounded-down tenths timedSymmetryPercent shows. */
export function meetsTimedSymmetry(injured: number, other: number, threshold: number): boolean {
  return meetsSymmetry(other, injured, threshold)
}
