import type { Exercise, ProgressionRule, Slot } from '../schema/index.ts'

/** Targets when a swap changes what is counted (PROGRAM-QUESTIONS 57). Seconds come from the program's one written time substitution, the wall sit's 30 to 45 s. */
export const SWAP_SECONDS: readonly [number, number] = [30, 45]
export const SWAP_REPS: readonly [number, number] = [10, 15]

function loadable(exercise: Exercise): boolean {
  if (exercise.loadType === 'step-height') return exercise.holdsLoad !== undefined
  return !['bodyweight', 'time', 'band'].includes(exercise.loadType)
}

/**
 * The slot as it applies to the exercise actually being done. On the slot's own exercise it is the
 * slot unchanged. After a swap to a substitution of another kind, what is counted, the targets and
 * the progression rule follow the substitution: a wall sit counts seconds, a split squat has no step
 * height, a leg-extension range stop belongs to the leg extension only. A substitution program.md
 * writes per side without logging it per side (the side plank, the Pallof press, the dead bug) carries
 * its side words onto the slot, so a farmer's hold swapped to the side plank reads "each side" and isn't
 * done on one side only (PROGRAM-QUESTIONS 169(h)).
 */
export function effectiveSlot(slot: Slot, exercise: Exercise): Slot {
  if (exercise.id === slot.exerciseId) return slot
  const { heightIn, heightMaxIn, loadBeforeHeightLb, rangeStopDeg: _range, ...rest } = slot
  void _range
  const timed = exercise.loadType === 'time'
  const stepHeight = exercise.loadType === 'step-height'
  const canLoad = loadable(exercise)
  let { repUnit, repsMin, repsMax } = slot
  if (timed && slot.repUnit !== 'seconds') {
    repUnit = 'seconds'
    ;[repsMin, repsMax] = SWAP_SECONDS
  } else if (!timed && slot.repUnit === 'seconds') {
    repUnit = 'reps'
    ;[repsMin, repsMax] = SWAP_REPS
  }
  const fallback: ProgressionRule = timed ? 'time' : canLoad ? 'double-progression' : 'fixed'
  let progressionRule = slot.progressionRule
  switch (slot.progressionRule) {
    case 'height-then-load':
      if (!stepHeight) progressionRule = fallback
      break
    case 'range-then-load':
      progressionRule = fallback
      break
    case 'stage':
      if (!exercise.stages) progressionRule = fallback
      break
    case 'time':
      if (!timed) progressionRule = fallback
      break
    case 'double-progression':
      if (!canLoad) progressionRule = fallback
      break
    case 'fixed':
      break
  }
  return {
    ...rest,
    repUnit,
    repsMin,
    repsMax,
    progressionRule,
    ...(exercise.perSideLabel !== undefined ? { perSideLabel: exercise.perSideLabel } : {}),
    ...(stepHeight && heightIn !== undefined ? { heightIn } : {}),
    ...(stepHeight && heightMaxIn !== undefined ? { heightMaxIn } : {}),
    ...(stepHeight && loadBeforeHeightLb !== undefined ? { loadBeforeHeightLb } : {}),
  }
}
