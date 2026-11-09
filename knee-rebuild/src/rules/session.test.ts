import { describe, expect, it } from 'vitest'
import { SessionTemplate, type Slot } from '../schema/index.ts'
import { phaseLogsBothSides, phaseRunsExercise, phaseWeekOf, slotRunsInPhaseWeek, slotsForPhaseWeek } from './session.ts'

function slot(id: string, order: number, phaseWeeks?: [number, number | null]): Slot {
  return {
    id,
    order,
    label: String(order),
    exerciseId: 'leg-press',
    sets: 3,
    repsMin: 8,
    repsMax: 10,
    repUnit: 'reps',
    unilateral: false,
    injuredOnly: false,
    prescriptionText: '3 × 8–10',
    cues: [],
    progressionRule: 'double-progression',
    substitutionIds: [],
    optional: false,
    ...(phaseWeeks ? { phaseWeeks } : {}),
  }
}

const template = SessionTemplate.parse({
  id: 'fx-a',
  phase: 3,
  letter: 'A',
  slots: [slot('early', 1, [1, 2]), slot('mid', 2, [3, 4]), slot('late', 3, [5, null]), slot('always', 4)],
})

const ids = (phaseWeek: number) => slotsForPhaseWeek(template, phaseWeek).map((s) => s.id)

describe('slotsForPhaseWeek', () => {
  it('runs each band only in its weeks of the phase', () => {
    expect(ids(1)).toEqual(['early', 'always'])
    expect(ids(2)).toEqual(['early', 'always'])
    expect(ids(3)).toEqual(['mid', 'always'])
    expect(ids(4)).toEqual(['mid', 'always'])
  })
  it('keeps an open-ended band running however long the phase lasts', () => {
    expect(ids(5)).toEqual(['late', 'always'])
    expect(ids(9)).toEqual(['late', 'always'])
  })
  it('one slot at a time (slotRunsInPhaseWeek, which the Summary’s set count reads): both ends of a band included', () => {
    expect(slotRunsInPhaseWeek({ phaseWeeks: [3, 4] }, 2)).toBe(false)
    expect(slotRunsInPhaseWeek({ phaseWeeks: [3, 4] }, 3)).toBe(true)
    expect(slotRunsInPhaseWeek({ phaseWeeks: [3, 4] }, 4)).toBe(true)
    expect(slotRunsInPhaseWeek({ phaseWeeks: [3, 4] }, 5)).toBe(false)
    expect(slotRunsInPhaseWeek({ phaseWeeks: [5, null] }, 40)).toBe(true)
    expect(slotRunsInPhaseWeek({}, 1)).toBe(true)
  })
})

describe('phaseWeekOf', () => {
  it('counts from the week the phase was entered', () => {
    expect(phaseWeekOf(8, 8)).toBe(1)
    expect(phaseWeekOf(13, 9)).toBe(5)
  })
  it('refuses a week before the phase began', () => {
    expect(() => phaseWeekOf(7, 8)).toThrow(RangeError)
  })
})

describe('phaseRunsExercise (PROGRAM-QUESTIONS 114)', () => {
  const p1 = SessionTemplate.parse({ id: 'fx-p1', phase: 1, letter: 'A', slots: [{ ...slot('p1-1', 1), substitutionIds: ['leg-press-45', 'goblet-squat-bench'] }] })
  const p2 = SessionTemplate.parse({ id: 'fx-p2', phase: 2, letter: 'A', slots: [{ ...slot('p2-1', 1), exerciseId: 'single-leg-leg-press' }] })
  it('is true for a slot’s own exercise or one of its substitutions in that phase', () => {
    expect(phaseRunsExercise([p1, p2], 1, 'leg-press')).toBe(true)
    expect(phaseRunsExercise([p1, p2], 1, 'goblet-squat-bench')).toBe(true)
    expect(phaseRunsExercise([p1, p2], 2, 'single-leg-leg-press')).toBe(true)
  })
  it('is false for an exercise only another phase runs: no session of the phase can log it', () => {
    expect(phaseRunsExercise([p1, p2], 1, 'single-leg-leg-press')).toBe(false)
    expect(phaseRunsExercise([p1, p2], 2, 'goblet-squat-bench')).toBe(false)
    expect(phaseRunsExercise([p1, p2], 4, 'leg-press')).toBe(false)
  })
})

describe('phaseLogsBothSides (PROGRAM-QUESTIONS 134)', () => {
  // Phase 1 A's leg press, logged once for both legs, with the single-leg leg press added to its list (a Program edit).
  const bothLegs = SessionTemplate.parse({ id: 'fx-p1a', phase: 1, letter: 'A', slots: [{ ...slot('p1a-1', 1), substitutionIds: ['leg-press-45', 'single-leg-leg-press'] }] })
  // Phase 1 C's step-up, logged side by side, with the single-leg leg press added to its list.
  const sideBySide = SessionTemplate.parse({ id: 'fx-p1c', phase: 1, letter: 'C', slots: [{ ...slot('p1c-1', 1), exerciseId: 'step-up', unilateral: true, substitutionIds: ['step-up-stair', 'single-leg-leg-press'] }] })
  // Phase 1 A's balance, logged on the injured side only.
  const injuredOnly = SessionTemplate.parse({ id: 'fx-p1a7', phase: 1, letter: 'A', slots: [{ ...slot('p1a-7', 7), exerciseId: 'single-leg-balance', unilateral: true, injuredOnly: true, substitutionIds: ['single-leg-leg-press'] }] })

  it('is false when the phase lists the exercise only on a slot logged once for both legs: the runner logs the slot’s sides, not the exercise’s', () => {
    expect(phaseRunsExercise([bothLegs], 1, 'single-leg-leg-press')).toBe(true)
    expect(phaseLogsBothSides([bothLegs], 1, 'single-leg-leg-press')).toBe(false)
  })
  it('is false on a slot logged on the injured side only', () => {
    expect(phaseLogsBothSides([injuredOnly], 1, 'single-leg-leg-press')).toBe(false)
  })
  it('is true when a slot logged side by side lists it, as its own exercise or a substitution, in that phase', () => {
    expect(phaseLogsBothSides([bothLegs, sideBySide], 1, 'single-leg-leg-press')).toBe(true)
    expect(phaseLogsBothSides([sideBySide], 1, 'step-up')).toBe(true)
    expect(phaseLogsBothSides([sideBySide], 2, 'single-leg-leg-press')).toBe(false)
    expect(phaseLogsBothSides([sideBySide], 1, 'leg-press')).toBe(false)
  })
})
