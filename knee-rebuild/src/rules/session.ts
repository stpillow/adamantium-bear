import type { SessionTemplate, Slot } from '../schema/index.ts'

/**
 * Which week of its phase a program week is, counting from the week the phase was entered.
 * Phases advance on gate confirmation, so this is state-driven, never the calendar alone.
 */
export function phaseWeekOf(week: number, phaseEnteredWeek: number): number {
  if (week < phaseEnteredWeek) throw new RangeError(`week ${week} is before the phase was entered in week ${phaseEnteredWeek}`)
  return week - phaseEnteredWeek + 1
}

/** Whether a slot runs in a given week of its phase: a banded slot (snap-downs, plyo blocks) only in its weeks. */
export function slotRunsInPhaseWeek(slot: Partial<Pick<Slot, 'phaseWeeks'>>, phaseWeek: number): boolean {
  if (!slot.phaseWeeks) return true
  const [from, to] = slot.phaseWeeks
  return phaseWeek >= from && (to === null || phaseWeek <= to)
}

/** The slots a template runs in a given week of its phase: banded slots (snap-downs, plyo blocks) only in their weeks. */
export function slotsForPhaseWeek(template: SessionTemplate, phaseWeek: number): Slot[] {
  return template.slots.filter((slot) => slotRunsInPhaseWeek(slot, phaseWeek))
}

/**
 * Whether a phase's sessions can log an exercise: some slot of the phase's templates runs it, as
 * its own exercise or one of its listed substitutions (a swap, the gym routing and the runner's
 * Swap never leave that list). Gate 1's single-leg leg press test is the case it answers: Phase 1
 * runs only the two-legged press, so no Phase 1 session can prefill it (PROGRAM-QUESTIONS 114).
 */
export function phaseRunsExercise(templates: readonly SessionTemplate[], phase: number, exerciseId: string): boolean {
  return templates.some((t) => t.phase === phase && t.slots.some((s) => s.exerciseId === exerciseId || s.substitutionIds.includes(exerciseId)))
}

/**
 * Whether a phase's sessions can log both sides of an exercise, as a load test's prefill needs
 * (PROGRAM-QUESTIONS 25): some slot of the phase lists it, as its own exercise or a substitution,
 * and is logged side by side (unilateral, not the injured side only). The runner logs a slot's
 * sides, not the exercise's (`sidesFor` in prescription.ts), so a single-leg exercise on a
 * both-legs slot, as a Program edit can put it, is logged once for both legs (PROGRAM-QUESTIONS 134).
 */
export function phaseLogsBothSides(templates: readonly SessionTemplate[], phase: number, exerciseId: string): boolean {
  return templates.some(
    (t) => t.phase === phase && t.slots.some((s) => s.unilateral && !s.injuredOnly && (s.exerciseId === exerciseId || s.substitutionIds.includes(exerciseId))),
  )
}
