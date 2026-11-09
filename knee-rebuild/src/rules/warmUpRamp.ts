import type { Exercise, LoadType, Pattern, RepUnit, Requirement, Slot } from '../schema/index.ts'
import type { Prescription } from './prescription.ts'

/*
 * Warm-up sets before the big lifts (Shawn, Nov 8, decision 5: "standard ramp"; program.md's warm-up
 * section, "Warm-up sets"; PROGRAM-QUESTIONS 165). Before the first working set of a big loaded
 * two-legged or two-handed lift, two lighter sets of the same exercise: 8 reps at half the day's
 * working load, then 5 at three-quarters, each rounded DOWN to the step the machine, plates or
 * dumbbells allow. The numbers live in the seed (`warmUp.lift.ramp`); this reads them.
 *
 * DISPLAY ONLY. A ramp is never logged, never stored, and no rule reads one: not a reading, a
 * prescription, a compliance count, training load or a gate. The one thing that counts it is the
 * time window's estimate (src/rules/fitWindow.ts takes its reps as plain numbers, `rampReps`), so a
 * warm-up set costs the minutes it takes (PROGRAM-QUESTIONS 167). src/rules/warmUpRamp.guard.test.ts
 * holds it there.
 *
 * "The day's working load" is `Prescription.load` as the engine gives it today: a hold or a deload
 * repeats last time's, a back-off has already cut it, a rack cap carries the rack, and a rack move
 * or a swap changes the exercise, so every one of those ramps from what is actually on the bar.
 */

/** The seed's ramp rule (`warmUp.lift.ramp`), as this module reads it. */
export interface RampRule {
  percents: readonly number[]
  reps: readonly number[]
  patterns: readonly Pattern[]
  loadTypes: readonly LoadType[]
  /** Equipment that rules an exercise out, whatever its pattern: the back extension's held plate is a small add-on to body weight, so half of it is no warm-up. */
  excludeRequires: readonly string[]
}

/**
 * A machine stack's lightest plate, in lb. No catalog field holds a stack's minimum; 10 lb is the
 * common top plate (PROGRAM-QUESTIONS 165), so a warm-up load under it reads "the lightest plate",
 * and a working load at or under it needs no warm-up set.
 */
export const STACK_LIGHTEST_LB = 10

export interface RampSet {
  /** In the exercise's load unit, per hand on `dumbbell-each`: what the rounding gave. */
  load: number
  reps: number
  /** The load as words other than a number: 0 on the Smith (`empty-bar`) or the 45° sled (`empty-sled`), a stack under its lightest plate (`lightest-plate`). */
  light: 'empty-bar' | 'empty-sled' | 'lightest-plate' | null
}

export type RampNone = 'late' | 'not-eligible' | 'no-load' | 'already-warm' | 'too-light'

export type Ramp = { kind: 'sets'; sets: RampSet[]; workingLoad: number } | { kind: 'none'; why: RampNone; workingLoad?: number }

export type RampExercise = Pick<Exercise, 'pattern' | 'loadType' | 'loadDirection' | 'unilateral' | 'accessory' | 'increment' | 'requires'>

function requirementIds(r: Requirement): string[] {
  return typeof r === 'string' ? [r] : r.anyOf
}

/**
 * Whether an exercise on a slot gets warm-up sets at all: a squat, hinge or press pattern on a
 * stack, plates or dumbbells, loaded upward, two-legged and two-handed on a two-legged slot, counted
 * in reps, not on the accessory and core catalog and not on equipment the rule rules out.
 */
export function rampEligible(exercise: RampExercise, slot: Pick<Slot, 'unilateral'>, repUnit: RepUnit, rule: RampRule): boolean {
  return (
    rule.patterns.includes(exercise.pattern) &&
    rule.loadTypes.includes(exercise.loadType) &&
    exercise.loadDirection !== 'down' &&
    !exercise.unilateral &&
    !slot.unilateral &&
    exercise.accessory === undefined &&
    repUnit === 'reps' &&
    !exercise.requires.flatMap(requirementIds).some((id) => rule.excludeRequires.includes(id))
  )
}

/** Rounded down to the step, as a back-off is (`backOffLoad`): the conservative side. */
function roundDown(load: number, increment: number): number {
  const eps = 1e-9
  return increment > 0 ? Math.floor(load / increment + eps) * increment : Math.floor(load + eps)
}

function lightOf(load: number, loadType: LoadType): RampSet['light'] {
  if (load === 0 && loadType === 'smith-plates') return 'empty-bar'
  if (load === 0 && loadType === 'plates') return 'empty-sled'
  if (load > 0 && load < STACK_LIGHTEST_LB && loadType === 'stack') return 'lightest-plate'
  return null
}

/**
 * The warm-up sets to show before set 1 of a slot today, or why there are none. In order: a session
 * entered after the fact shows none; nor does an exercise the rule doesn't cover; nor a first time
 * with no load picked yet; nor an exercise already warmed up this session (`alreadyWarm`, worked out
 * by the caller: once per exercise per session); nor a load too light to warm up for. Each percent
 * of the working load is rounded down to the step: a 0 is kept only as the empty bar or sled, a load
 * equal to the set before it is dropped (the first is kept), and one at or past the working load is
 * dropped. Nothing left is too light.
 */
export function rampFor(input: {
  exercise: RampExercise
  slot: Pick<Slot, 'unilateral'>
  prescription: Pick<Prescription, 'load' | 'repUnit'> | undefined
  late: boolean
  alreadyWarm: boolean
  rule: RampRule
}): Ramp {
  const { exercise, prescription, rule } = input
  if (input.late) return { kind: 'none', why: 'late' }
  if (prescription === undefined || !rampEligible(exercise, input.slot, prescription.repUnit, rule)) return { kind: 'none', why: 'not-eligible' }
  const working = prescription.load
  if (working === null) return { kind: 'none', why: 'no-load' }
  if (input.alreadyWarm) return { kind: 'none', why: 'already-warm', workingLoad: working }
  const tooLight: Ramp = { kind: 'none', why: 'too-light', workingLoad: working }
  if (working <= 0) return tooLight
  if (exercise.loadType === 'stack' && working <= STACK_LIGHTEST_LB) return tooLight
  const sets: RampSet[] = []
  rule.percents.forEach((pct, i) => {
    const load = roundDown(working * pct, exercise.increment)
    const light = lightOf(load, exercise.loadType)
    if (load <= 0 && light === null) return
    if (load >= working) return
    const prev = sets.at(-1)
    if (prev && (prev.light ?? prev.load) === (light ?? load)) return
    sets.push({ load, reps: rule.reps[i] ?? rule.reps.at(-1) ?? 5, light })
  })
  return sets.length > 0 ? { kind: 'sets', sets, workingLoad: working } : tooLight
}

/** The reps of each warm-up set, for the time window's estimate: [] unless there are sets. */
export function rampReps(ramp: Ramp): number[] {
  return ramp.kind === 'sets' ? ramp.sets.map((s) => s.reps) : []
}
