import { ADDED_SLOTS_MAX, Pattern, Slot, type AddedSlot, type Exercise, type ProgressionRule, type RepUnit, type SessionTemplate } from '../schema/index.ts'

/*
 * Exercises Shawn adds to a session (Program screen, Dexie version 5). An added exercise is stored as
 * its choices only (which template, which exercise, sets, rep range); the Slot the engine runs is
 * made here, from the exercise as the catalog has it, and laid after the template's own slots, so
 * program.md's slots, cues and rules are never touched. It prescribes, logs and reads like any slot.
 * Choosing a progression rule, and keeping an add inside what program.md has used by the session's phase, is the conservative reading (PROGRAM-QUESTIONS 136): a loaded exercise
 * climbs by double progression, bodyweight, band and balance work repeat, a timed hold adds time.
 * The accessory and core catalog (Batch C, PROGRAM-QUESTIONS 169) is the exception to the phase
 * hold: addable in every phase, with its own default sets and range, cues and substitutions.
 */

/** Every added slot's id starts here, so the engine and the screens can tell it from program.md's. */
export const ADDED_SLOT_PREFIX = 'added-'

export function isAddedSlotId(slotId: string): boolean {
  return slotId.startsWith(ADDED_SLOT_PREFIX)
}

/** A new added slot's id, from a token the caller makes unique (the clock, a counter). */
export function addedSlotId(token: string): string {
  return `${ADDED_SLOT_PREFIX}${token}`
}

/**
 * The exercises program.md has used by `phase`: a slot's own or one of its substitutions, in a
 * session of that phase or an earlier one. An added exercise stays inside this set, so adding never
 * brings forward what program.md holds for a later phase (PROGRAM-QUESTIONS 136).
 */
export function phaseExerciseIds(templates: readonly SessionTemplate[], phase: number): Set<string> {
  const ids = new Set<string>()
  for (const t of templates) {
    if (t.phase > phase) continue
    for (const s of t.slots) {
      ids.add(s.exerciseId)
      for (const id of s.substitutionIds) ids.add(id)
    }
  }
  return ids
}

/**
 * Whether the phase hold keeps an exercise out: it isn't in what program.md has used by the phase
 * (`phaseExerciseIds`) and it isn't on the accessory and core catalog. The catalog's accessories are
 * addable in every phase (Batch C, PROGRAM-QUESTIONS 169): Shawn has no upper-body limit (Nov 3),
 * none of them is a lower-body pattern, and the core ones that kneel say so in their cues.
 */
export function heldToPhase(exercise: Pick<Exercise, 'id' | 'accessory'>, inPhase: ReadonlySet<string>): boolean {
  return exercise.accessory === undefined && !inPhase.has(exercise.id)
}

export const NOT_YET_WORDS = 'program.md hasn’t used that exercise by this phase, so it stays for the phase that brings it in.'

/** Why an exercise can't be added, in a sentence; null when it can. A step-height exercise needs a starting height, a carry or cardio is counted in yards or minutes, jumping and landing work follows program.md's phases. */
export function notAddableReason(exercise: Pick<Exercise, 'name' | 'pattern' | 'loadType'>): string | null {
  if (exercise.pattern === 'plyo') return `${exercise.name} is jumping or landing work, which program.md brings back in its own phases, so it only runs where program.md puts it.`
  if (exercise.loadType === 'step-height') return `${exercise.name} starts at a step height program.md sets, so it can only run where program.md puts it.`
  if (exercise.pattern === 'carry' || exercise.pattern === 'cardio') return `${exercise.name} is counted in yards or minutes, so it can only run where program.md puts it.`
  return null
}

/** The unit an added exercise is counted in: an accessory's own (the farmer's hold is seconds), seconds for a hold or a staged balance drill, reps for the rest. */
export function addedRepUnit(exercise: Pick<Exercise, 'loadType' | 'stages' | 'accessory'>): RepUnit {
  if (exercise.accessory?.repUnit !== undefined) return exercise.accessory.repUnit
  return exercise.loadType === 'time' || exercise.stages !== undefined ? 'seconds' : 'reps'
}

/** The progression rule an added exercise runs on. */
export function addedRule(exercise: Pick<Exercise, 'loadType' | 'stages'>): ProgressionRule {
  if (exercise.stages !== undefined) return 'stage'
  if (exercise.loadType === 'time') return 'time'
  if (exercise.loadType === 'bodyweight' || exercise.loadType === 'band') return 'fixed'
  return 'double-progression'
}

/** What is wrong with an add, in a sentence; null when it can be written. `already` is how many are on the template. */
export function addedSlotProblem(added: AddedSlot, exercise: Exercise | undefined, already: number, inPhase: ReadonlySet<string>): string | null {
  if (!exercise) return 'That exercise isn’t in the catalog.'
  const reason = notAddableReason(exercise)
  if (reason) return reason
  if (heldToPhase(exercise, inPhase)) return NOT_YET_WORDS
  if (already >= ADDED_SLOTS_MAX) return `A session takes ${ADDED_SLOTS_MAX} added exercises; remove one first.`
  if (added.repsMax < added.repsMin) return 'The top of the range is below the bottom.'
  return null
}

/** "3 × 8–10", "2 × 30–45 s", with the side words: "each leg" for a one-leg exercise, program.md's own for work it writes per side ("3 × 8–12 each side" on the dead bug). */
export function addedPrescriptionText(added: Pick<AddedSlot, 'sets' | 'repsMin' | 'repsMax'>, exercise: Pick<Exercise, 'loadType' | 'stages' | 'unilateral' | 'accessory' | 'perSideLabel'>): string {
  const range = added.repsMax > added.repsMin ? `${added.repsMin}–${added.repsMax}` : `${added.repsMin}`
  const unit = addedRepUnit(exercise) === 'seconds' ? ' s' : ''
  const sides = addedSideWords(exercise)
  return `${added.sets} × ${range}${unit}${sides ? ` ${sides}` : ''}`
}

/** The side words an added exercise's slot carries: "each leg" one-legged, else what program.md writes on its slots (`Exercise.perSideLabel`), else none. */
export function addedSideWords(exercise: Pick<Exercise, 'unilateral' | 'perSideLabel'>): string | undefined {
  return exercise.unilateral ? 'each leg' : exercise.perSideLabel
}

/**
 * The slot an added exercise becomes, `position` (1-based) among the template's added slots and `order`
 * after the template's own. An accessory brings its own cues and ordered substitutions (program.md's
 * "Accessory and core catalog"); any other exercise has none, since its cues belong to program.md's slots.
 */
export function slotFromAdded(added: Pick<AddedSlot, 'id' | 'sets' | 'repsMin' | 'repsMax'>, exercise: Exercise, position: number, order: number, label: string = `+${position}`): Slot {
  return Slot.parse({
    id: added.id,
    order,
    label,
    exerciseId: exercise.id,
    sets: added.sets,
    repsMin: added.repsMin,
    repsMax: added.repsMax,
    repUnit: addedRepUnit(exercise),
    ...(addedSideWords(exercise) !== undefined ? { perSideLabel: addedSideWords(exercise) } : {}),
    unilateral: exercise.unilateral,
    prescriptionText: addedPrescriptionText(added, exercise),
    cues: exercise.accessory?.cues ?? [],
    progressionRule: addedRule(exercise),
    substitutionIds: exercise.accessory?.substitutionIds ?? [],
  })
}

/** The added slots of one template, in the order they were added; a row the catalog can no longer run, or the phase holds back, is left out. */
export function addedFor(templateId: string, added: readonly AddedSlot[], catalog: ReadonlyMap<string, Exercise>, inPhase: ReadonlySet<string>): AddedSlot[] {
  return added
    .filter((a) => a.templateId === templateId)
    .filter((a) => {
      const exercise = catalog.get(a.exerciseId)
      return exercise !== undefined && notAddableReason(exercise) === null && !heldToPhase(exercise, inPhase)
    })
    .sort((a, b) => (a.addedOn === b.addedOn ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.addedOn < b.addedOn ? -1 : 1))
}

/** The template with Shawn's added slots after its own; the template as written is left alone. */
export function withAddedSlots(template: SessionTemplate, added: readonly AddedSlot[], catalog: ReadonlyMap<string, Exercise>, templates: readonly SessionTemplate[]): SessionTemplate {
  const mine = addedFor(template.id, added, catalog, phaseExerciseIds(templates, template.phase)).slice(0, ADDED_SLOTS_MAX)
  if (mine.length === 0) return template
  const top = Math.max(...template.slots.map((s) => s.order))
  const slots = mine.flatMap((a, i) => {
    const exercise = catalog.get(a.exerciseId)
    return exercise ? [slotFromAdded(a, exercise, i + 1, top + i + 1)] : []
  })
  return { ...template, slots: [...template.slots, ...slots] }
}

/** The catalog's exercises that can be added to a session of `phase`, by name, for the picker. */
export function addableExercises(catalog: readonly Exercise[], templates: readonly SessionTemplate[], phase: number): Exercise[] {
  const inPhase = phaseExerciseIds(templates, phase)
  return catalog.filter((e) => notAddableReason(e) === null && !heldToPhase(e, inPhase)).sort((a, b) => a.name.localeCompare(b.name))
}

/** One heading of the picker: a pattern and its addable exercises, by name. */
export interface AddableGroup {
  pattern: Exercise['pattern']
  exercises: Exercise[]
}

/**
 * The picker's list grouped by pattern, for a list that runs past 60 once the accessory catalog is in:
 * the patterns in the order the enum lists them (lower body first, then push, pull, core), each group
 * by name. The screen words the heading (`patternWords`).
 */
export function addableByPattern(catalog: readonly Exercise[], templates: readonly SessionTemplate[], phase: number): AddableGroup[] {
  const addable = addableExercises(catalog, templates, phase)
  return Pattern.options.map((pattern) => ({ pattern, exercises: addable.filter((e) => e.pattern === pattern) })).filter((g) => g.exercises.length > 0)
}

/** Where the sets and range start when an exercise is picked: an accessory's own (program.md's "Added as"), else 3 sets of 8–12 reps, or of 30–45 seconds for a hold. */
export function addedDefaults(exercise: Pick<Exercise, 'loadType' | 'stages' | 'accessory'>): { sets: number; repsMin: number; repsMax: number } {
  if (exercise.accessory) return { sets: exercise.accessory.sets, repsMin: exercise.accessory.repsMin, repsMax: exercise.accessory.repsMax }
  return addedRepUnit(exercise) === 'seconds' ? { sets: 3, repsMin: 30, repsMax: 45 } : { sets: 3, repsMin: 8, repsMax: 12 }
}
