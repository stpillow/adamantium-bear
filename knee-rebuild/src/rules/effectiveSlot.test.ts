import { describe, expect, it } from 'vitest'
import type { Exercise, Slot } from '../schema/index.ts'
import { effectiveSlot } from './effectiveSlot.ts'

const ex = (over: Partial<Exercise>): Exercise => ({ id: 'x', name: 'X', pattern: 'squat', equipment: '', loadType: 'stack', loadUnit: 'plate', increment: 1, loadDirection: 'up', unilateral: false, requires: [], ...over })
const slot = (over: Partial<Slot>): Slot => ({ id: 's', order: 1, label: '1', exerciseId: 'own', sets: 2, repsMin: 15, repsMax: 15, repUnit: 'reps', unilateral: false, injuredOnly: false, prescriptionText: '', cues: [], progressionRule: 'double-progression', substitutionIds: [], optional: false, ...over })

describe('effectiveSlot', () => {
  it('is the slot itself on its own exercise', () => {
    const s = slot({ rangeStopDeg: 45, progressionRule: 'range-then-load' })
    expect(effectiveSlot(s, ex({ id: 'own' }))).toBe(s)
  })
  it('leg extension swapped to the wall sit counts seconds, 30 to 45, with no range stop', () => {
    const legExt = slot({ exerciseId: 'leg-extension', progressionRule: 'range-then-load', rangeStopDeg: 45 })
    const e = effectiveSlot(legExt, ex({ id: 'wall-sit', loadType: 'time', loadUnit: 's', increment: 5 }))
    expect(e).toMatchObject({ repUnit: 'seconds', repsMin: 30, repsMax: 45, progressionRule: 'time' })
    expect(e.rangeStopDeg).toBeUndefined()
  })
  it('a timed slot swapped to a machine counts reps on double progression', () => {
    const plank = slot({ exerciseId: 'copenhagen', repUnit: 'seconds', repsMin: 15, repsMax: 20, progressionRule: 'time' })
    expect(effectiveSlot(plank, ex({ id: 'hip-adductor-machine' }))).toMatchObject({ repUnit: 'reps', repsMin: 10, repsMax: 15, progressionRule: 'double-progression' })
  })
  it('a step-up swapped to a split squat loses the step height and progresses on load', () => {
    const stepUp = slot({ exerciseId: 'step-up', progressionRule: 'height-then-load', heightIn: 6, heightMaxIn: 8, loadBeforeHeightLb: 20, repsMin: 10, repsMax: 10 })
    const e = effectiveSlot(stepUp, ex({ id: 'split-squat', loadType: 'dumbbell-each', loadUnit: 'lb', increment: 5 }))
    expect(e.progressionRule).toBe('double-progression')
    expect(e.heightIn).toBeUndefined()
    const stair = effectiveSlot(stepUp, ex({ id: 'step-up-stair', loadType: 'step-height', loadUnit: 'in', increment: 2, holdsLoad: 'dumbbell-each' }))
    expect(stair).toMatchObject({ heightIn: 6, heightMaxIn: 8, progressionRule: 'height-then-load' })
  })
  it('a loaded slot swapped to bodyweight work holds its reps fixed', () => {
    expect(effectiveSlot(slot({}), ex({ id: 'band', loadType: 'band', loadUnit: 'none', increment: 0 })).progressionRule).toBe('fixed')
  })
  it('a both-sides slot swapped to work program.md writes per side carries the side words (the farmer’s hold to the side plank)', () => {
    const hold = slot({ exerciseId: 'farmers-hold', repUnit: 'seconds', repsMin: 30, repsMax: 45 })
    expect(hold.perSideLabel).toBeUndefined()
    expect(effectiveSlot(hold, ex({ id: 'side-plank', pattern: 'core', loadType: 'time', loadUnit: 's', increment: 5, perSideLabel: 'each side' }))).toMatchObject({ repUnit: 'seconds', perSideLabel: 'each side' })
    const crunch = slot({ exerciseId: 'cable-crunch', repsMin: 10, repsMax: 15 })
    expect(effectiveSlot(crunch, ex({ id: 'pallof-press', pattern: 'core', perSideLabel: 'each side' })).perSideLabel).toBe('each side')
    expect(effectiveSlot(crunch, ex({ id: 'dead-bug', pattern: 'core', loadType: 'bodyweight', loadUnit: 'none', increment: 0, perSideLabel: 'each side' })).perSideLabel).toBe('each side')
    // A substitute program.md writes for both sides at once adds none.
    expect(effectiveSlot(crunch, ex({ id: 'hanging-knee-raise', pattern: 'core' })).perSideLabel).toBeUndefined()
  })
  it('a staged balance slot keeps the stage rule on another staged exercise', () => {
    const bal = slot({ exerciseId: 'balance-mat-bosu', progressionRule: 'stage', repUnit: 'seconds', repsMin: 30, repsMax: 30 })
    expect(effectiveSlot(bal, ex({ id: 'single-leg-balance', loadType: 'time', loadUnit: 's', increment: 5, stages: ['a', 'b'] }))).toMatchObject({ progressionRule: 'stage', repUnit: 'seconds', repsMin: 30 })
  })
})
