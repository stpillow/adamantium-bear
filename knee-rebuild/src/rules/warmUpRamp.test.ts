import { describe, expect, it } from 'vitest'
import { backOffLoad } from './prescription.ts'
import { STACK_LIGHTEST_LB, rampEligible, rampFor, rampReps, type RampExercise, type RampRule } from './warmUpRamp.ts'

// The seed's rule (data/program.json warmUp.lift.ramp), restated so this file pins the arithmetic on its own.
const rule: RampRule = {
  percents: [0.5, 0.75],
  reps: [8, 5],
  patterns: ['squat', 'hinge', 'push'],
  loadTypes: ['stack', 'plates', 'smith-plates', 'dumbbell-each', 'dumbbell-single'],
  excludeRequires: ['back-extension-bench'],
}

const ex = (over: Partial<RampExercise> = {}): RampExercise => ({ pattern: 'squat', loadType: 'stack', loadDirection: 'up', unilateral: false, increment: 5, requires: [], ...over })
const legPress = ex({ requires: ['seated-leg-press'] })
const dbBench = ex({ pattern: 'push', loadType: 'dumbbell-each', requires: ['dumbbells', 'flat-bench'] })
const smithSquat = ex({ loadType: 'smith-plates', increment: 10, requires: ['smith-machine', 'flat-bench'] })
const sled = ex({ loadType: 'plates', increment: 10, requires: ['leg-press-45'] })
const goblet = ex({ loadType: 'dumbbell-single', requires: ['dumbbells', 'flat-bench'] })
const chestPress = ex({ pattern: 'push', requires: ['chest-press-machine'] })
const both = { unilateral: false }
const at = (exercise: RampExercise, load: number | null, over: { late?: boolean; alreadyWarm?: boolean } = {}) =>
  rampFor({ exercise, slot: both, prescription: { load, repUnit: 'reps' }, late: over.late ?? false, alreadyWarm: over.alreadyWarm ?? false, rule })
const shown = (r: ReturnType<typeof rampFor>) => (r.kind === 'sets' ? r.sets.map((s) => [s.light ?? s.load, s.reps]) : r.why)

describe('rampFor: the standard ramp, rounded down (PROGRAM-QUESTIONS 165)', () => {
  it('leg press at 180: 90 × 8, then 135 × 5', () => {
    expect(at(legPress, 180)).toEqual({ kind: 'sets', workingLoad: 180, sets: [{ load: 90, reps: 8, light: null }, { load: 135, reps: 5, light: null }] })
  })

  it('rounds each percent down to the step, never up', () => {
    expect(shown(at(legPress, 95))).toEqual([[45, 8], [70, 5]]) // 47.5 → 45, 71.25 → 70
    expect(shown(at(dbBench, 40))).toEqual([[20, 8], [30, 5]])
    expect(shown(at(dbBench, 25))).toEqual([[10, 8], [15, 5]]) // 12.5 → 10, 18.75 → 15
    expect(shown(at(dbBench, 35))).toEqual([[15, 8], [25, 5]])
    expect(shown(at(smithSquat, 90))).toEqual([[40, 8], [60, 5]]) // plates only, 10 lb steps
    expect(shown(at(goblet, 40))).toEqual([[20, 8], [30, 5]])
  })

  it('ramps from the day’s load: a back-off’s, a rack cap’s, a deload’s (which repeats the load)', () => {
    expect(backOffLoad(180, 5)).toBe(135)
    expect(shown(at(legPress, backOffLoad(180, 5)))).toEqual([[65, 8], [100, 5]])
    expect(shown(at(dbBench, 75))).toEqual([[35, 8], [55, 5]]) // 80 prescribed, the rack stops it at 75
    expect(shown(at(chestPress, 120))).toEqual([[60, 8], [90, 5]]) // rack-moved to the chest press machine
  })

  it('a duplicate load is dropped, the first kept', () => {
    expect(shown(at(dbBench, 10))).toEqual([[5, 8]]) // 5, then 7.5 → 5
    expect(shown(at(smithSquat, 20))).toEqual([[10, 8]]) // 10, then 15 → 10
  })

  it('0 on the Smith is the empty bar, 0 on the 45° sled the empty sled; a 0 on dumbbells is dropped', () => {
    expect(at(smithSquat, 10)).toMatchObject({ kind: 'sets', sets: [{ load: 0, reps: 8, light: 'empty-bar' }] })
    expect(at(sled, 10)).toMatchObject({ kind: 'sets', sets: [{ load: 0, reps: 8, light: 'empty-sled' }] })
    expect(at(dbBench, 5)).toEqual({ kind: 'none', why: 'too-light', workingLoad: 5 })
  })

  it('a stack under its lightest plate reads as the lightest plate; a stack load at or under it needs no warm-up', () => {
    expect(STACK_LIGHTEST_LB).toBe(10)
    expect(at(chestPress, 15)).toMatchObject({ kind: 'sets', sets: [{ load: 5, reps: 8, light: 'lightest-plate' }, { load: 10, reps: 5, light: null }] })
    expect(at(chestPress, 10)).toEqual({ kind: 'none', why: 'too-light', workingLoad: 10 })
    expect(shown(at(chestPress, 20))).toEqual([[10, 8], [15, 5]])
  })

  it('nothing on the bar, or nothing on the stack, is too light', () => {
    expect(at(smithSquat, 0)).toEqual({ kind: 'none', why: 'too-light', workingLoad: 0 })
    expect(at(dbBench, 0)).toEqual({ kind: 'none', why: 'too-light', workingLoad: 0 })
  })

  it('a first time with no load picked has none; a load once picked gets one', () => {
    expect(at(legPress, null)).toEqual({ kind: 'none', why: 'no-load' })
  })

  it('a session entered after the fact has none, whatever else holds', () => {
    expect(at(legPress, 180, { late: true })).toEqual({ kind: 'none', why: 'late' })
    expect(at(ex({ pattern: 'calf' }), 180, { late: true })).toEqual({ kind: 'none', why: 'late' })
  })

  it('once per exercise per session: already warm has none', () => {
    expect(at(dbBench, 40, { alreadyWarm: true })).toEqual({ kind: 'none', why: 'already-warm', workingLoad: 40 })
  })

  it('a slot with no prescription has none', () => {
    expect(rampFor({ exercise: legPress, slot: both, prescription: undefined, late: false, alreadyWarm: false, rule })).toEqual({ kind: 'none', why: 'not-eligible' })
  })

  it('never shows a load at or past the working load, whatever the percents', () => {
    const steep = { ...rule, percents: [0.5, 0.99], reps: [8, 5] }
    const r = rampFor({ exercise: legPress, slot: both, prescription: { load: 20, repUnit: 'reps' }, late: false, alreadyWarm: false, rule: steep })
    expect(shown(r)).toEqual([[10, 8], [15, 5]]) // 19.8 → 15
    const flat = rampFor({ exercise: dbBench, slot: both, prescription: { load: 10, repUnit: 'reps' }, late: false, alreadyWarm: false, rule: { ...rule, percents: [1], reps: [5] } })
    expect(flat).toEqual({ kind: 'none', why: 'too-light', workingLoad: 10 })
  })
})

describe('rampEligible: the big loaded lifts only', () => {
  it('squat, hinge and press patterns on a stack, plates or dumbbells', () => {
    for (const e of [legPress, dbBench, smithSquat, sled, goblet, chestPress, ex({ pattern: 'hinge', loadType: 'dumbbell-each' })]) expect(rampEligible(e, both, 'reps', rule)).toBe(true)
  })

  it('not a one-legged exercise, nor one on a one-legged slot', () => {
    expect(rampEligible(ex({ unilateral: true }), both, 'reps', rule)).toBe(false)
    expect(rampEligible(legPress, { unilateral: true }, 'reps', rule)).toBe(false)
    expect(rampEligible(ex({ pattern: 'single-leg' }), both, 'reps', rule)).toBe(false)
  })

  it('not an assisted machine (loaded downward), not bodyweight, band, time or step work', () => {
    expect(rampEligible(ex({ pattern: 'push', loadDirection: 'down' }), both, 'reps', rule)).toBe(false)
    for (const loadType of ['bodyweight', 'band', 'time', 'step-height'] as const) expect(rampEligible(ex({ pattern: 'push', loadType }), both, 'reps', rule), loadType).toBe(false)
  })

  it('not a pull, hip, calf, balance, plyo or core pattern', () => {
    for (const pattern of ['pull', 'hip', 'calf', 'balance', 'plyo', 'core', 'quad', 'hamstring'] as const) expect(rampEligible(ex({ pattern }), both, 'reps', rule), pattern).toBe(false)
  })

  it('not counted in seconds, minutes, yards or steps', () => {
    for (const unit of ['seconds', 'minutes', 'yards', 'steps'] as const) expect(rampEligible(legPress, both, unit, rule), unit).toBe(false)
  })

  it('not the accessory and core catalog, the overhead press machine included', () => {
    const accessory = { tier: 'upper' as const, sets: 3, repsMin: 8, repsMax: 10, cues: ['x'], substitutionIds: [] }
    expect(rampEligible(ex({ pattern: 'push', requires: ['shoulder-press-machine'], accessory }), both, 'reps', rule)).toBe(false)
  })

  it('not on equipment the rule rules out: the back extension’s held plate', () => {
    expect(rampEligible(ex({ pattern: 'hinge', loadType: 'dumbbell-single', requires: ['back-extension-bench'] }), both, 'reps', rule)).toBe(false)
    expect(rampEligible(ex({ pattern: 'hinge', loadType: 'dumbbell-single', requires: [{ anyOf: ['back-extension-bench', 'flat-bench'] }] }), both, 'reps', rule)).toBe(false)
  })
})

describe('rampReps: what the time window counts', () => {
  it('the reps of each warm-up set, or none', () => {
    expect(rampReps(at(legPress, 180))).toEqual([8, 5])
    expect(rampReps(at(dbBench, 10))).toEqual([8])
    expect(rampReps(at(legPress, null))).toEqual([])
    expect(rampReps(at(dbBench, 5))).toEqual([])
  })
})
