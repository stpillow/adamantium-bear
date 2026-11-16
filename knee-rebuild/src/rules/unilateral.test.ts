import { describe, expect, it } from 'vitest'
import type { SetLog } from '../schema/index.ts'
import { bestOfTrials, fastestOfTrials, healthySideTargets, meetsSymmetry, meetsTimedSymmetry, symmetryPercent, timedSymmetryPercent } from './unilateral.ts'

const injuredSet = (setNumber: number, reps: number): SetLog => ({
  id: `i${setNumber}`, workoutId: 'w1', slotId: 'p2b-1', exerciseId: 'bulgarian-split-squat', setNumber, side: 'right', load: 20, loadUnit: 'lb', reps, stopped: false,
})

describe('healthySideTargets (rule 5)', () => {
  it('worked example: Bulgarian split squat, injured side completes 8, 8, 7; healthy side targets 8, 8, 7', () => {
    expect(healthySideTargets([injuredSet(1, 8), injuredSet(2, 8), injuredSet(3, 7)])).toEqual([8, 8, 7])
  })
  it('orders by set number whatever the input order', () => {
    expect(healthySideTargets([injuredSet(3, 7), injuredSet(1, 8), injuredSet(2, 8)])).toEqual([8, 8, 7])
  })
})

describe('symmetry', () => {
  it('worked example: hop test, injured best 56 in., other side 62 in., is 90.3% and passes the 90% line', () => {
    expect(symmetryPercent(56, 62)).toBe(90.3)
    expect(meetsSymmetry(56, 62, 0.9)).toBe(true)
  })
  it('fails just under the line and cannot be computed against a zero', () => {
    expect(meetsSymmetry(55, 62, 0.9)).toBe(false)
    expect(symmetryPercent(10, 0)).toBeNull()
    expect(meetsSymmetry(0, 0, 0.8)).toBe(false)
  })
  it('decides on the ratio itself: just under the line fails, and the percent shown rounds down so it never reads the line (PROGRAM-QUESTIONS 110)', () => {
    // 188 / 209 = 0.89952: rounded to the nearest it would read 90% and pass.
    expect(symmetryPercent(188, 209)).toBe(89.9)
    expect(meetsSymmetry(188, 209, 0.9)).toBe(false)
    // A decimal entry: 56 / 62.25 = 0.89960.
    expect(symmetryPercent(56, 62.25)).toBe(89.9)
    expect(meetsSymmetry(56, 62.25, 0.9)).toBe(false)
    // Gate 1's 80% line: 39.98 / 50 = 0.7996.
    expect(symmetryPercent(39.98, 50)).toBe(79.9)
    expect(meetsSymmetry(39.98, 50, 0.8)).toBe(false)
    // Exactly on the line passes, and 2 / 3 shows 66.6%, not 66.7%.
    expect(symmetryPercent(54, 60)).toBe(90)
    expect(meetsSymmetry(54, 60, 0.9)).toBe(true)
    expect(meetsSymmetry(40, 50, 0.8)).toBe(true)
    expect(symmetryPercent(2, 3)).toBe(66.6)
    // The worked example is unchanged.
    expect(symmetryPercent(56, 62)).toBe(90.3)
    expect(meetsSymmetry(56, 62, 0.9)).toBe(true)
  })
  it('keeps the best of three trials', () => {
    expect(bestOfTrials([50, 56, 54])).toBe(56)
    expect(bestOfTrials([])).toBe(0)
  })
  it('a 0 is a trial: 0 on the injured side reads 0% and fails; 0 against 0 is no percent (PROGRAM-QUESTIONS 108)', () => {
    expect(bestOfTrials([0])).toBe(0)
    expect(symmetryPercent(0, 62)).toBe(0)
    expect(meetsSymmetry(0, 62, 0.9)).toBe(false)
    expect(symmetryPercent(0, 0)).toBeNull()
  })
})

describe('timed symmetry (the 6-meter timed hop, Batch A: PROGRAM-QUESTIONS 157)', () => {
  it('keeps the fastest positive trial: a time of 0 is not a time, and no positive trial is null', () => {
    expect(fastestOfTrials([2.3, 2.1, 2.5])).toBe(2.1)
    expect(fastestOfTrials([2.3, 2.1, 0])).toBe(2.1)
    expect(fastestOfTrials([0])).toBeNull()
    expect(fastestOfTrials([0, 0, 0])).toBeNull()
    expect(fastestOfTrials([])).toBeNull()
    expect(fastestOfTrials([-1, 2.4])).toBe(2.4)
  })
  it('inverts the ratio: other ÷ injured, so a slower injured side reads under 100%', () => {
    // Injured 2.3 s against the other side's 2.1 s: 2.1 / 2.3 = 91.3%, passes the 90% line.
    expect(timedSymmetryPercent(2.3, 2.1)).toBe(91.3)
    expect(meetsTimedSymmetry(2.3, 2.1, 0.9)).toBe(true)
    // A faster injured side reads over 100%.
    expect(timedSymmetryPercent(2.1, 2.3)).toBe(109.5)
    expect(meetsTimedSymmetry(2.1, 2.3, 0.9)).toBe(true)
    // Equal times read exactly 100%.
    expect(timedSymmetryPercent(2.2, 2.2)).toBe(100)
  })
  it('decides on the same floor-rounded tenths the words show, so a ratio just under the line never reads the line', () => {
    // 2.078 / 2.31 = 0.89956…: rounded to the nearest it would read 90% and pass (the 188/209 discipline inverted).
    expect(timedSymmetryPercent(2.31, 2.078)).toBe(89.9)
    expect(meetsTimedSymmetry(2.31, 2.078, 0.9)).toBe(false)
    // Exactly on the line passes: 1.8 / 2 = 90%.
    expect(timedSymmetryPercent(2, 1.8)).toBe(90)
    expect(meetsTimedSymmetry(2, 1.8, 0.9)).toBe(true)
  })
  it('cannot be computed without a positive time on each side', () => {
    expect(timedSymmetryPercent(0, 2.1)).toBeNull()
    expect(meetsTimedSymmetry(0, 2.1, 0.9)).toBe(false)
    expect(timedSymmetryPercent(2.1, 0)).toBe(0)
  })
})
