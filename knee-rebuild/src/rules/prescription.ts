import type { EquipmentId, Exercise, IsoDate, LoadUnit, ReadingResult, RepUnit, Requirement, SetLog, SetSide, Side, Slot } from '../schema/index.ts'
import { isDeloadWeek } from './calendar.ts'
import { prescribedSets } from './deload.ts'
import { pausedNote, type Pause } from './downPeriod.ts'
import { effectiveSlot } from './effectiveSlot.ts'
import { DUMBBELLS, fallbacksAfter, missingFor, slotOrder, stageCeiling, type Available, type ExerciseLookup } from './equipment.ts'

/** Why the prescription is what it is. Every basis has a one-sentence note for the screen. */
export type Basis =
  | 'first'
  | 'deload'
  | 'suspended'
  | 'progress-load'
  | 'progress-reps'
  | 'progress-height'
  | 'progress-range'
  | 'progress-stage'
  | 'same'
  | 'repeat'
  | 'back-off'
  | 'at-top'
  /**
   * Clean twice inside a down period (Batch E, PROGRAM-QUESTIONS 181): the step up waits, and the
   * last session's load and target repeat. Only the clean-twice branch reads the pause.
   */
  | 'paused'

export interface Prescription {
  /** The exercise to run: the slot's current one, or a substitution the rules moved it to. */
  exerciseId: string
  side: SetSide
  sets: number
  /** Null means "choose": a first session with nothing to go on. */
  load: number | null
  loadUnit: LoadUnit
  /** Target reps, seconds, yards or steps per set, in `repUnit`. */
  repsTarget: number
  repUnit: RepUnit
  /** When a session is repeated exactly: each set's load and reps from last time. */
  perSet?: { load: number; reps: number }[]
  heightIn?: number
  rangeStopDeg?: number
  stage?: number
  /** Healthy side: its per-set rep targets come from what the injured side just did (rule 5). */
  budgetFromInjured?: boolean
  /**
   * The rack stopped the load short of the prescription and nothing here is written to swap to
   * (Shawn's Nov 1 answer 5): the load is the gym's heaviest dumbbell, and the sets are logged
   * `rackCapped`, so the session never becomes the baseline and a clean on it never counts (gymLoads.ts).
   */
  rackCapped?: boolean
  /**
   * The rack moved the slot (Shawn's Nov 1 answer 5): the load was past this gym's heaviest
   * dumbbell, so `exerciseId` is the next exercise on the slot's list that is here, not the one
   * planned. Today names it among what changes at the gym, and Swap says why the planned one won't run.
   */
  rackMoved?: boolean
  basis: Basis
  note: string
}

/** The gym a session runs at, as the prescription reads it (M4b, design section 3). */
export interface GymHere {
  /** What is here: `availableEquipment` from equipment.ts (the gym's list, its dumbbells, the kit). */
  available: Available
  /** The heaviest dumbbell on this gym's rack, in lb; 0 means none. */
  dumbbellMaxLb: number
  /** Equipment names for the notes, by id; an item without one is named from its id. */
  names?: ReadonlyMap<EquipmentId, string>
}

export interface PrescriptionInput {
  slot: Slot
  /** The exercise the slot currently runs: its own, or a substitution. */
  exercise: Exercise
  /** The slot's substitutions, resolved, in order. What a cap or a back-off may move to comes from this list. */
  substitutions: Exercise[]
  /** Combined readings for this exercise, most recent first (gymLoads.ts `exerciseHistory`: a rack-capped session that read clean is left out). */
  readings: ReadingResult[]
  /** The last session's sets for this exercise, both sides (gymLoads.ts: from the last session that wasn't rack-capped). */
  lastSets: SetLog[]
  week: number
  injuredSide: Side
  /** Settings' rack; the cap reads it only when no gym is given. */
  dumbbellMax: number
  redFlagActive: boolean
  /**
   * The day being planned is inside a down period (src/rules/downPeriod.ts `pauseOn`, Batch E):
   * clean twice repeats instead of stepping up. Absent outside one. It never touches hold, back
   * off, the deload, the red flag or the whole-knee back-off.
   */
  pause?: Pause
  /**
   * Where the session runs. Absent, everything on the slot's list is here and the rack stops at
   * `dumbbellMax`: the prescription as it was before M4b.
   */
  gym?: GymHere
  /** Where the slot's history put it (slotExercise.ts, PROGRAM-QUESTIONS 55). Absent: the slot runs its exercise as usual. */
  placement?: Placement
  /** The next lift after a morning that read back-off, on a lower-body slot (wholeKnee.ts, PROGRAM-QUESTIONS 6). */
  wholeKnee?: WholeKnee
}

/** A load as it was logged. */
export interface LoggedLoad {
  load: number
  loadUnit: LoadUnit
}

/**
 * "If the whole knee is complaining" (wholeKnee.ts, PROGRAM-QUESTIONS 6): the slot backs off
 * whatever its own readings say, and a load cut takes the lower of load × 0.75 and the side's last
 * Phase 1 load, when there is one in the same unit. A deload week, the red-flag state and a first
 * session come first, as they do for every back-off.
 */
export interface WholeKnee {
  /** The day of the morning check that read back-off. */
  morning: IsoDate
  /** From Phase 2 on, the last Phase 1 load per side (wholeKnee.ts `phaseOneLoads`); empty in Phase 1 or with no Phase 1 history. */
  phaseOneLoads: Partial<Record<SetSide, LoggedLoad>>
}

/** What leads the note of a lower-body slot the whole knee backed off. */
export const WHOLE_KNEE_NOTE = 'Whole knee: a morning check since the last lift read back off.'

/**
 * Why the slot runs the exercise it does, from its history (slotExercise.ts, PROGRAM-QUESTIONS 55).
 * `note` leads every side's note. `returned` marks a slot back on an exercise whose easier version
 * read clean twice in a row: the back-off still standing in that exercise's readings is served, so
 * it repeats its last session instead of backing off again.
 */
export interface Placement {
  note: string
  returned: boolean
}

export type Effective = 'none' | 'clean-twice' | 'clean-once' | 'hold' | 'back-off'

/**
 * What the last two combined readings add up to. Two holds in a row read back-off
 * (PROGRAM-QUESTIONS 4, from program.md's "two off sessions in a row").
 */
export function effectiveReading(readings: readonly ReadingResult[]): Effective {
  const [r1, r2] = readings
  if (r1 === undefined) return 'none'
  if (r1 === 'back-off') return 'back-off'
  if (r1 === 'hold') return r2 === 'hold' ? 'back-off' : 'hold'
  return r2 === 'clean' ? 'clean-twice' : 'clean-once'
}

/** Back-off: load × 0.75 rounded down to the increment (rule 4). */
export function backOffLoad(load: number, increment: number): number {
  if (increment <= 0) return Math.floor(load * 0.75)
  return Math.floor((load * 0.75) / increment) * increment
}

export const RPE_CEILING = 8
export const RANGE_LADDER_DEG: readonly number[] = [90, 45, 30]
/** Dumbbells held on a step-height exercise move in 5 lb steps (program.md loading rules). */
export const HELD_LOAD_INCREMENT_LB = 5
const DUMBBELL_TYPES = new Set(['dumbbell-each', 'dumbbell-single'])
const LOAD_RULES = new Set(['double-progression', 'height-then-load', 'range-then-load'])

const value = (s: SetLog) => s.reps ?? s.seconds ?? 0
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function sidesFor(slot: Slot, injuredSide: Side): SetSide[] {
  if (!slot.unilateral) return ['both']
  const other: Side = injuredSide === 'left' ? 'right' : 'left'
  return slot.injuredOnly ? [injuredSide] : [injuredSide, other]
}

function startLoad(exercise: Exercise): number | null {
  switch (exercise.loadType) {
    case 'bodyweight':
    case 'time':
    case 'band':
    case 'step-height':
      return 0
    default:
      return null
  }
}

/**
 * The next easier version: the substitution after the exercise the slot is on now, in the
 * program's order. On the slot's own exercise that is the first substitution; on the last one there is none.
 * `prescribe` moves with `fallbacksAfter` (equipment.ts), which reads the list the same way and
 * also passes over what the gym doesn't have.
 */
export function nextSubstitution(exercise: Pick<Exercise, 'id'>, substitutions: readonly Exercise[]): Exercise | undefined {
  const at = substitutions.findIndex((s) => s.id === exercise.id)
  return substitutions[at + 1]
}

/** What a back-off does to an exercise (rule 4, PROGRAM-QUESTIONS 45 and 49). */
export type BackOffStep = 'more-assist' | 'stage-down' | 'less-time' | 'step-down' | 'lighter-in-hands' | 'easier-version' | 'lighter-load'

/**
 * Which back-off applies, from the slot as it applies to the exercise (`effectiveSlot`) and one
 * side's last load and step height: one plate more assist, a stage back, 5 s less, a step down,
 * less in the hands, the easier version (bodyweight work, a step at its starting height with
 * nothing in the hands, a load of zero), or load × 0.75.
 */
export function backOffStep(slot: Slot, exercise: Exercise, lastLoad: number, lastHeight: number | undefined): BackOffStep {
  if (exercise.loadDirection === 'down') return 'more-assist'
  if (slot.progressionRule === 'stage') return 'stage-down'
  if (slot.progressionRule === 'time') return 'less-time'
  if (exercise.loadType === 'step-height') {
    const heightInc = exercise.heightIncrementIn ?? exercise.increment
    if (lastHeight !== undefined && lastHeight - heightInc >= (slot.heightIn ?? 0)) return 'step-down'
    if (lastLoad > 0) return 'lighter-in-hands'
  }
  if (exercise.loadType === 'bodyweight' || exercise.loadType === 'step-height' || lastLoad <= 0) return 'easier-version'
  return 'lighter-load'
}

/**
 * Whether a back-off on this exercise moves the slot to its easier version (PROGRAM-QUESTIONS 49),
 * read as `prescribe` reads it, from the first set of the last session on the injured side (or
 * both). A load cut, a stage or time step, a step down and more assist keep the exercise. With no
 * last session there is nothing to back off from.
 */
export function backOffMoves(input: Pick<PrescriptionInput, 'slot' | 'exercise' | 'lastSets' | 'injuredSide'>): boolean {
  const slot = effectiveSlot(input.slot, input.exercise)
  const bySet = [...input.lastSets].sort((a, b) => a.setNumber - b.setNumber)
  const first = bySet.find((s) => s.side === 'both' || s.side === input.injuredSide) ?? bySet[0]
  if (first === undefined) return false
  return backOffStep(slot, input.exercise, first.load, first.heightIn ?? slot.heightIn) === 'easier-version'
}

/** Whether the slot's load can only step up with an RPE logged on every set (the load rules do; fixed, time and stage don't). */
export function progressionNeedsRpe(slot: Pick<Slot, 'progressionRule'>): boolean {
  return LOAD_RULES.has(slot.progressionRule)
}

/** The lightest version of a loaded exercise: one step of its increment (5 lb dumbbells, one plate, 10 lb on the Smith). */
export function lightestLoad(exercise: Exercise): number {
  return exercise.holdsLoad !== undefined ? HELD_LOAD_INCREMENT_LB : Math.max(exercise.increment, 1)
}

function hitTop(sets: readonly SetLog[], slot: Slot): boolean {
  if (sets.length === 0) return false
  const needsRpe = progressionNeedsRpe(slot)
  return sets.every((s) => !s.stopped && value(s) >= slot.repsMax && (!needsRpe || (s.rpe !== undefined && s.rpe <= RPE_CEILING)))
}

/** Whether the exercise's load is dumbbells, in the hands or held on a step: the rack caps it. */
function holdsDumbbells(exercise: Exercise): boolean {
  return DUMBBELL_TYPES.has(exercise.loadType) || (exercise.holdsLoad !== undefined && DUMBBELL_TYPES.has(exercise.holdsLoad))
}

/**
 * Whether the exercise holds dumbbells without needing them (PROGRAM-QUESTIONS 64: the step-ups,
 * split squats, Bulgarians, the back extension and the calf raise on a step), so at a gym with no
 * dumbbells it runs at bodyweight.
 */
function bodyweightWithoutDumbbells(exercise: Exercise): boolean {
  return holdsDumbbells(exercise) && !exercise.requires.some((r) => (typeof r === 'string' ? r === DUMBBELLS : r.anyOf.includes(DUMBBELLS)))
}

/**
 * Everything the slot's list could need, as one set: what "no gym given" means, so every exercise
 * and every stage runs, as before M4b.
 */
function everythingFor(exercises: readonly Exercise[]): Available {
  return new Set(
    exercises.flatMap((e) => [...e.requires, ...(e.stageRequires ?? []).flat()]).flatMap((r) => (typeof r === 'string' ? [r] : r.anyOf)),
  )
}

/** The gym as one prescription reads it, with the slot's list as the input gives it. */
interface Here {
  /** The input as given, its slot as program.md writes it (before `effectiveSlot`): a move re-reads it for the exercise moved to. */
  raw: PrescriptionInput
  available: Available
  rackLb: number
  names: ReadonlyMap<EquipmentId, string> | undefined
  /** [own, ...substitutions], in the input's order. */
  list: Pick<Slot, 'exerciseId' | 'substitutionIds'>
  byId: ExerciseLookup
}

function hereFor(raw: PrescriptionInput): Here {
  const { exercise, substitutions } = raw
  // An exercise that is neither the slot's own nor one of its substitutions stands where the own
  // one would, so everything written after it is offered (as nextSubstitution read it).
  const onList = substitutions.some((s) => s.id === exercise.id)
  return {
    raw,
    available: raw.gym?.available ?? everythingFor([exercise, ...substitutions]),
    rackLb: raw.gym?.dumbbellMaxLb ?? raw.dumbbellMax,
    names: raw.gym?.names,
    list: { exerciseId: onList ? raw.slot.exerciseId : exercise.id, substitutionIds: substitutions.map((s) => s.id) },
    byId: new Map([exercise, ...substitutions].map((e) => [e.id, e])),
  }
}

/** What a cap or a back-off may move to from this exercise: the list's entries after it that are here, in order. */
function fallbacks(here: Here, exercise: Exercise): Exercise[] {
  return fallbacksAfter(here.list, exercise.id, here.byId, here.available)
}

/** Whether the program writes anything after this exercise on the slot's list, here or not. */
function writtenAfter(here: Here, exercise: Exercise): boolean {
  const order = slotOrder(here.list)
  return order.indexOf(exercise.id) < order.length - 1
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** "Bosu isn’t marked here", "Mats aren’t marked here": what a gym lacks, in the program's plain words. */
function notMarkedHere(missing: readonly Requirement[], names: ReadonlyMap<EquipmentId, string> | undefined): string {
  const name = (id: EquipmentId) => names?.get(id) ?? id.replace(/-/g, ' ')
  const [only] = missing
  if (missing.length === 1 && typeof only === 'string') return capitalize(`${name(only)} ${/[^s]s$/i.test(name(only)) ? 'aren’t' : 'isn’t'} marked here`)
  if (missing.length === 1 && only !== undefined && typeof only !== 'string') return capitalize(`neither ${only.anyOf.map(name).join(' nor ')} is marked here`)
  return capitalize(`${missing.map((r) => (typeof r === 'string' ? name(r) : r.anyOf.map(name).join(' or '))).join(' and ')} aren’t marked here`)
}

/** Rule 4: the next prescription for one slot, per side, injured side first. */
export function prescribe(raw: PrescriptionInput): Prescription[] {
  // The slot as it applies to the exercise actually run: after a swap, units, targets and rule follow it.
  const input: PrescriptionInput = { ...raw, slot: effectiveSlot(raw.slot, raw.exercise) }
  const here = hereFor(raw)
  const sides = sidesFor(input.slot, input.injuredSide)
  const out = toRack(here, raw.exercise, offTheLadder(here, raw.exercise, sides.map((side) => prescribeSide(input, here, side))))
  let injuredTarget: number | undefined
  for (const p of out) {
    if (p.side !== 'both' && p.side !== input.injuredSide && injuredTarget !== undefined) {
      p.repsTarget = injuredTarget
      p.budgetFromInjured = true
    }
    if (p.side === input.injuredSide) injuredTarget = p.repsTarget
  }
  const knee = (p: Prescription) => (raw.wholeKnee && p.basis === 'back-off' ? `${WHOLE_KNEE_NOTE} ${p.note}` : p.note)
  const lead = raw.placement?.note
  return out.map((p) => ({ ...p, note: lead === undefined ? knee(p) : `${lead} ${knee(p)}` }))
}

/** One side's prescription, its stage held at the last one this gym can run. */
function prescribeSide(input: PrescriptionInput, here: Here, side: SetSide): Prescription {
  const p = prescribeSideAnywhere(input, here, side)
  const { exercise } = input
  const ceiling = stageCeiling(exercise, here.available)
  const stages = exercise.stages ?? []
  if (ceiling === null || ceiling < 0 || p.stage === undefined || p.stage <= ceiling) return p
  const lastStage = input.lastSets.filter((s) => s.side === side).sort((a, b) => a.setNumber - b.setNumber)[0]?.stage ?? 0
  const missing = missingFor(exercise.stageRequires?.[ceiling + 1] ?? [], here.available)
  const held = `${notMarkedHere(missing, here.names)}; ${lastStage > ceiling ? 'back to' : 'staying at'} ${stages[ceiling] ?? 'the start'}.`
  if (p.basis === 'progress-stage') return { ...p, stage: ceiling, basis: 'at-top', note: held }
  if (p.basis === 'back-off') return { ...p, stage: ceiling, note: `Back off: ${held}` }
  return { ...p, stage: ceiling, note: `${p.note} ${held}` }
}

function prescribeSideAnywhere(input: PrescriptionInput, here: Here, side: SetSide): Prescription {
  const { slot, exercise, week } = input
  const sets = prescribedSets(slot.sets, week)
  const deload = isDeloadWeek(week)
  const last = input.lastSets.filter((s) => s.side === side).sort((a, b) => a.setNumber - b.setNumber)
  const base = {
    exerciseId: exercise.id,
    side,
    sets,
    loadUnit: exercise.loadUnit,
    repUnit: slot.repUnit,
    ...(slot.heightIn !== undefined ? { heightIn: slot.heightIn } : {}),
    ...(slot.rangeStopDeg !== undefined ? { rangeStopDeg: slot.rangeStopDeg } : {}),
    ...(exercise.stages ? { stage: 0 } : {}),
  }

  if (last.length === 0) {
    // At a gym with no dumbbells, an exercise that holds them without needing them starts at
    // bodyweight (PROGRAM-QUESTIONS 64 and 91): there is no load to pick, and none to cap.
    const bodyweight = startLoad(exercise) === null && here.rackLb <= 0 && bodyweightWithoutDumbbells(exercise)
    // In a deload week a new exercise runs its lightest version (PROGRAM-QUESTIONS 8): the smallest step, nothing to pick.
    const load = bodyweight ? 0 : (startLoad(exercise) ?? (deload && exercise.loadDirection !== 'down' ? lightestLoad(exercise) : null))
    const rpe = slot.rpeTarget === undefined ? '' : ` that lands at RPE ${slot.rpeTarget}`
    const deloadNote = bodyweight ? `First time in a deload week: bodyweight, ${sets} sets, perfect reps.` : `First time in a deload week: the lightest version, ${sets} sets, perfect reps.`
    return {
      ...base,
      load,
      repsTarget: slot.repsMin,
      basis: 'first',
      note: deload
        ? deloadNote
        : load === null
          ? `First time: pick a load${rpe} and start at ${slot.repsMin} ${slot.repUnit}.`
          : `First time: ${bodyweight ? 'bodyweight; ' : ''}start at ${slot.repsMin} ${slot.repUnit}.`,
    }
  }

  const first = last[0]
  const lastLoad = first?.load ?? 0
  const lastHeight = first?.heightIn ?? slot.heightIn
  const lastStop = first?.rangeStopDeg ?? slot.rangeStopDeg
  const lastStage = first?.stage ?? 0
  const lastTarget = clamp(Math.max(...last.map(value)), slot.repsMin, slot.repsMax)
  const carried = {
    ...base,
    ...(lastHeight !== undefined ? { heightIn: lastHeight } : {}),
    ...(lastStop !== undefined ? { rangeStopDeg: lastStop } : {}),
    ...(exercise.stages ? { stage: lastStage } : {}),
  }
  const perSet = last.slice(0, sets).map((s) => ({ load: s.load, reps: value(s) }))
  const repeat = (basis: Basis, note: string): Prescription => ({ ...carried, load: lastLoad, repsTarget: lastTarget, perSet, basis, note })

  if (deload) return repeat('deload', `Deload week: ${sets} sets instead of ${slot.sets}, same loads and reps, no progression.`)
  if (input.redFlagActive) return repeat('suspended', 'Red-flag state: progression is suspended; repeat the last session exactly.')

  // The whole knee backs the slot off whatever its own readings say (PROGRAM-QUESTIONS 6).
  switch (input.wholeKnee ? 'back-off' : effectiveReading(input.readings)) {
    case 'none':
      return repeat('repeat', 'No reading for the last session, and unknown is not clean: repeat it exactly.')
    case 'hold':
      return repeat('repeat', 'Hold: repeat the last session’s loads and reps exactly.')
    case 'back-off':
      // Back from the easier version after two cleans on it (PROGRAM-QUESTIONS 55): the back-off that moved the slot is served.
      if (input.placement?.returned && !input.wholeKnee) return repeat('repeat', 'Same loads and reps as its last session.')
      return backOff(input, here, carried, lastLoad, lastHeight, lastStage, lastTarget, sets, phaseOneFloor(input, side, first?.loadUnit))
    case 'clean-once':
      return { ...carried, load: lastLoad, repsTarget: lastTarget, basis: 'same', note: 'Clean once: same load, same target; clean again to progress.' }
    case 'clean-twice':
      // A down period pauses the step up, never a hold or a back-off (PROGRAM-QUESTIONS 181): the clean-once shape, with why.
      if (input.pause) return { ...carried, load: lastLoad, repsTarget: lastTarget, basis: 'paused', note: `Clean twice: same load, same target. ${pausedNote(input.pause)}` }
      break
  }

  if (!hitTop(last, slot)) {
    const needsRpe = LOAD_RULES.has(slot.progressionRule) ? ` at RPE ${RPE_CEILING} or under` : ''
    return {
      ...carried,
      load: lastLoad,
      repsTarget: slot.repsMax,
      basis: 'progress-reps',
      note: `Clean twice: same load, every set to ${slot.repsMax} ${slot.repUnit}${needsRpe}, then the load moves.`,
    }
  }
  return progress(input, carried, lastLoad, lastHeight, lastStop, lastStage, lastTarget)
}

function progress(
  input: PrescriptionInput,
  carried: Omit<Prescription, 'load' | 'repsTarget' | 'basis' | 'note'>,
  lastLoad: number,
  lastHeight: number | undefined,
  lastStop: number | undefined,
  lastStage: number,
  lastTarget: number,
): Prescription {
  const { slot, exercise } = input
  const inc = exercise.increment
  const up = (load: number, note: string): Prescription => ({ ...carried, load, repsTarget: slot.repsMin, basis: 'progress-load', note })
  const stay = (note: string): Prescription => ({ ...carried, load: lastLoad, repsTarget: lastTarget, basis: 'at-top', note })

  switch (slot.progressionRule) {
    case 'double-progression': {
      if (exercise.loadDirection === 'down') {
        return up(Math.max(0, lastLoad - inc), `Clean twice at the top of the range: one plate less assist, back to ${slot.repsMin}.`)
      }
      return up(lastLoad + inc, `Clean twice at the top of the range: load up one step (${inc} ${exercise.loadUnit}), back to ${slot.repsMin} ${slot.repUnit}.`)
    }
    case 'height-then-load': {
      const height = lastHeight ?? 0
      const heightInc = exercise.heightIncrementIn ?? inc
      const holds = exercise.holdsLoad !== undefined
      if (holds && slot.loadBeforeHeightLb !== undefined && lastLoad < slot.loadBeforeHeightLb) {
        return up(lastLoad + HELD_LOAD_INCREMENT_LB, `Clean twice: ${HELD_LOAD_INCREMENT_LB} lb more in the hands; height moves once the dumbbells reach ${slot.loadBeforeHeightLb} lb.`)
      }
      if (slot.heightMaxIn === undefined || height + heightInc <= slot.heightMaxIn) {
        return { ...carried, heightIn: height + heightInc, load: lastLoad, repsTarget: slot.repsMin, basis: 'progress-height', note: `Clean twice: step up ${heightInc} in. to ${height + heightInc} in., same load; height before load.` }
      }
      if (holds) return up(lastLoad + HELD_LOAD_INCREMENT_LB, `At the phase’s top height (${slot.heightMaxIn} in.): ${HELD_LOAD_INCREMENT_LB} lb more in the hands.`)
      return stay(`At the phase’s top height (${slot.heightMaxIn} in.); nothing more to add here.`)
    }
    case 'range-then-load': {
      const phaseStop = slot.rangeStopDeg ?? RANGE_LADDER_DEG[RANGE_LADDER_DEG.length - 1] ?? 30
      const current = lastStop ?? RANGE_LADDER_DEG[0] ?? 90
      if (current > phaseStop) {
        const next = RANGE_LADDER_DEG.find((deg) => deg < current && deg >= phaseStop) ?? phaseStop
        return { ...carried, rangeStopDeg: next, load: lastLoad, repsTarget: slot.repsMin, basis: 'progress-range', note: `Clean twice: range stop moves from ${current}° to ${next}°, same load; range before load.` }
      }
      return up(lastLoad + inc, `Clean twice at the phase’s range (to ${phaseStop}°): load up one plate, back to ${slot.repsMin}.`)
    }
    case 'stage': {
      const stages = exercise.stages ?? []
      if (lastStage + 1 < stages.length) {
        return { ...carried, stage: lastStage + 1, load: lastLoad, repsTarget: slot.repsMax, basis: 'progress-stage', note: `Clean twice: next stage, ${stages[lastStage + 1]}.` }
      }
      return stay(`At the last stage (${stages[lastStage] ?? 'top'}); nothing further is written.`)
    }
    case 'time':
      return stay(`Clean twice at ${slot.repsMax} s: the next notch is the version written for the next phase.`)
    case 'fixed':
      return stay('Fixed prescription: reps stay in range, nothing is loaded.')
  }
}

function backOff(
  input: PrescriptionInput,
  here: Here,
  carried: Omit<Prescription, 'load' | 'repsTarget' | 'basis' | 'note'>,
  lastLoad: number,
  lastHeight: number | undefined,
  lastStage: number,
  lastTarget: number,
  sets: number,
  /** The last Phase 1 load for this side, from Phase 2 on after a morning that read back-off (PROGRAM-QUESTIONS 6). */
  floor: number | undefined,
): Prescription {
  const { slot, exercise } = input
  const inc = exercise.increment
  const result = (p: Partial<Prescription> & { note: string }): Prescription => ({ ...carried, load: lastLoad, repsTarget: lastTarget, basis: 'back-off', ...p })

  switch (backOffStep(slot, exercise, lastLoad, lastHeight)) {
    case 'more-assist':
      return result({ load: lastLoad + inc, note: 'Back off: one plate more assist.' })
    case 'stage-down': {
      const stages = exercise.stages ?? []
      const stage = Math.max(0, lastStage - 1)
      return result({ stage, note: `Back off: back a stage, to ${stages[stage] ?? 'the start'}.` })
    }
    case 'less-time':
      return result({ repsTarget: Math.max(slot.repsMin, lastTarget - 5), note: 'Back off: 5 s less per set.' })
    case 'step-down': {
      const heightInc = exercise.heightIncrementIn ?? inc
      const height = (lastHeight ?? 0) - heightInc
      return result({ heightIn: height, note: `Back off: step down ${heightInc} in. to ${height} in., same load.` })
    }
    case 'lighter-in-hands': {
      const cut = cutLoad(lastLoad, HELD_LOAD_INCREMENT_LB, 'lb', floor)
      const held = `Back off: ${cut.load} lb in the hands at the starting height`
      return result({ load: cut.load, note: floor === undefined ? `${held}.` : `${held}; ${cut.why}.` })
    }
    case 'easier-version': {
      // The easier version is the next one on the slot's list that is here: never the exercise itself, never one before it.
      const sub = fallbacks(here, exercise)[0]
      if (sub) return { ...firstOn(here, sub, carried.side), basis: 'back-off', note: `Back off: the easier version, ${sub.name}.` }
      const fewer = Math.max(1, Math.floor(sets * 0.75))
      const lighter = writtenAfter(here, exercise) ? 'nothing lighter on the list is here' : 'nothing lighter is written'
      return result({ sets: fewer, note: `Back off: ${fewer} sets instead of ${sets}; ${lighter}.` })
    }
    case 'lighter-load': {
      const cut = cutLoad(lastLoad, inc, exercise.loadUnit, floor)
      return result({ load: cut.load, note: `Back off: ${cut.why}.` })
    }
  }
}

/**
 * The side's last Phase 1 load when the whole knee backed the slot off from Phase 2 on: that side's,
 * or with none logged for it, the lightest any side logged. Only a load in the unit the last session
 * was logged in counts.
 */
function phaseOneFloor(input: PrescriptionInput, side: SetSide, unit: LoadUnit | undefined): number | undefined {
  const loads = input.wholeKnee?.phaseOneLoads
  if (loads === undefined || unit === undefined) return undefined
  const own = loads[side]
  const logged: (LoggedLoad | undefined)[] = own ? [own] : Object.values(loads)
  const fits = logged.flatMap((l) => (l !== undefined && l.loadUnit === unit ? [l.load] : []))
  return fits.length > 0 ? Math.min(...fits) : undefined
}

/** Load × 0.75 rounded down to the increment, or the last Phase 1 load when that is lighter (PROGRAM-QUESTIONS 6), and which won, in words. */
function cutLoad(lastLoad: number, increment: number, unit: LoadUnit, floor: number | undefined): { load: number; why: string } {
  const cut = backOffLoad(lastLoad, increment)
  if (floor === undefined) return { load: cut, why: `load × 0.75, rounded down to ${cut} ${unit}` }
  if (floor < cut) return { load: floor, why: `the last Phase 1 load, ${floor} ${unit}, is lighter than load × 0.75 (${cut} ${unit}), so it wins` }
  if (floor > cut) return { load: cut, why: `load × 0.75, rounded down to ${cut} ${unit}, is lighter than the last Phase 1 load (${floor} ${unit}), so it wins` }
  return { load: cut, why: `load × 0.75 and the last Phase 1 load are both ${cut} ${unit}` }
}

/**
 * Where a slot moved to another exercise on its list starts: that exercise's first session on this
 * side, with its own units, targets and ladder (its lightest version in a deload week). The caller
 * gives the reason it moved. That start meets the rack too (`toRack`): a lightest version past it
 * moves on down the list, or with nothing to move to is rack-capped. Each move goes forward on the
 * list, so this ends within its length.
 */
function firstOn(here: Here, to: Exercise, side: SetSide): Prescription {
  const first = prescribeSide({ ...here.raw, slot: effectiveSlot(here.raw.slot, to), exercise: to, readings: [], lastSets: [] }, here, side)
  return toRack(here, to, [first])[0] ?? first
}

/**
 * The dumbbell cap (PROGRAM-QUESTIONS 9) on every basis: a load past this gym's rack moves the slot,
 * every side, to the next exercise on its list that is here. With nothing to move to, each side past
 * the rack runs at the rack's heaviest dumbbell, rack-capped (Shawn's Nov 1 answer 5).
 */
function toRack(here: Here, exercise: Exercise, out: Prescription[]): Prescription[] {
  const rack = here.rackLb
  const over = (p: Prescription) => p.exerciseId === exercise.id && p.load !== null && (p.load > rack || (p.perSet ?? []).some((s) => s.load > rack))
  if (!holdsDumbbells(exercise) || !out.some(over)) return out
  const sub = fallbacks(here, exercise)[0]
  if (sub) {
    return out.map((p) => {
      if (p.exerciseId !== exercise.id) return p
      const moved = firstOn(here, sub, p.side)
      const why =
        rack <= 0
          ? `There are no dumbbells here: swap to ${sub.name}.`
          : over(p)
            ? `That is past the rack’s ${rack} lb dumbbells: swap to ${sub.name}.`
            : `The other side is past the rack’s ${rack} lb dumbbells, so the slot swaps to ${sub.name}.`
      // The moved prescription keeps its own note, as offTheLadder's does: how the exercise moved to starts.
      return { ...moved, basis: p.basis, rackMoved: true, note: `${p.note} ${why} ${moved.note}` }
    })
  }
  const nothing = writtenAfter(here, exercise) ? 'nothing written to swap to is here' : 'nothing is written to swap to'
  const stops = rack > 0 ? `The rack stops at ${rack} lb and ${nothing}: ${rack} lb, rack-capped` : `There are no dumbbells here and ${nothing}: bodyweight, rack-capped`
  return out.map((p) =>
    over(p) && p.load !== null
      ? {
          ...p,
          // Ascending sets: a first set already under the rack stays where it was; only what is past it comes down.
          load: Math.min(p.load, rack),
          ...(p.perSet ? { perSet: p.perSet.map((s) => ({ ...s, load: Math.min(s.load, rack) })) } : {}),
          rackCapped: true,
          note: `${p.note} ${stops}, so the session won’t count as clean.`,
        }
      : p,
  )
}

/**
 * A ladder whose first stage this gym can't run (a bosu and no mat, PROGRAM-QUESTIONS 76): the slot
 * moves to the next exercise on its list that is here, never starting on the harder surface ahead
 * of the stages below it. With nothing to move to it runs as prescribed, and the note says so.
 */
function offTheLadder(here: Here, exercise: Exercise, out: Prescription[]): Prescription[] {
  if (stageCeiling(exercise, here.available) !== -1) return out
  const firstStage = exercise.stages?.[0] ?? 'the first stage'
  const missing = notMarkedHere(missingFor(exercise.stageRequires?.[0] ?? [], here.available), here.names)
  const sub = fallbacks(here, exercise)[0]
  return out.map((p) => {
    if (p.exerciseId !== exercise.id) return p
    if (!sub) return { ...p, note: `${p.note} ${missing}, so not even ${firstStage} runs as written, and nothing else on the list is here.` }
    const moved = firstOn(here, sub, p.side)
    return { ...moved, note: `${missing}, and the first stage is ${firstStage}: ${sub.name} instead. ${moved.note}` }
  })
}
