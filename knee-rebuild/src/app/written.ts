import { exerciseById, program } from '../program/program.ts'
import type { History } from '../db/repo.ts'
import { isDeloadWeek } from '../rules/calendar.ts'
import { effectiveSlot } from '../rules/effectiveSlot.ts'
import { routeSlot, type SlotRoute } from '../rules/equipment.ts'
import type { EngineMode } from '../rules/engineMode.ts'
import { fitToWindow, type Fit } from '../rules/fitWindow.ts'
import { applyOverrides, overridesBySlot } from '../rules/overrides.ts'
import { slotsForPhaseWeek } from '../rules/session.ts'
import { writtenFitSlots, writtenSides, type WrittenSide } from '../rules/written.ts'
import type { Exercise, RepUnit, SessionTemplate, Settings, Slot } from '../schema/index.ts'
import { availableAt, phaseWeekFor, planSession, withAdded, type Gym, type SlotPlan } from './session.ts'

/*
 * The session planner for tester mode (M-U3; PROGRAM-QUESTIONS 226): each slot as program.md writes
 * it, routed at the gym from the slot's own exercise, never from history, with no prescription, no
 * reading, no warm-up sets and no extra-time extensions. It lives apart from app/session.ts so the
 * tester-mode guard's spy on `planSession` sees any call from here: a call inside one module would
 * bypass the mock (src/rules/engineMode.guard.test.ts). `planFor` is the one door both modes go
 * through; full mode is `planSession` exactly.
 */

const CATALOG: ReadonlyMap<string, Exercise> = new Map(program.exercises.map((e) => [e.id, e]))

/** One slot as written, for a tester. */
export interface WrittenSlotPlan {
  /** The slot with the Program screen's edits laid over, as `planSession` lays them. */
  slot: Slot
  /** The exercise it runs: a swap chosen for this session, else the gym's route from the slot's own exercise. */
  exercise: Exercise
  substitutions: Exercise[]
  route: SlotRoute
  /** The written sets per side, injured side first; a deload week cuts a third. */
  sides: WrittenSide[]
  /** What the exercise it runs counts (`effectiveSlot`): seconds after a swap to a timed one. */
  repUnit: RepUnit
  /** program.md's own "Sets × reps" cell, verbatim. */
  text: string
  /** program.md's load guidance, verbatim, when it writes one. */
  loadNote: string | null
  /** In a deload week: the written sets and the sets this week. */
  deload: { written: number; sets: number } | null
}

/** `planSession`'s own input: both modes are planned from the same call. */
export type PlanInput = Parameters<typeof planSession>[0]

/**
 * The session as written: the phase week from the calendar (no date, so a stored down period holds
 * nothing), Shawn's added exercises and the Program edits laid on as content, every slot routed from
 * its own exercise at the gym.
 */
export function writtenSession(input: { template: SessionTemplate; week: number; settings: Settings; history: History; gym: Gym; chosenExercise?: Record<string, string | undefined> }): WrittenSlotPlan[] {
  const { template, week, settings, history } = input
  const phaseWeek = phaseWeekFor(week, settings, history)
  const available = availableAt(input.gym)
  const overrides = overridesBySlot(history.programOverrides ?? [])
  return slotsForPhaseWeek(withAdded(template, history), phaseWeek).map((written) => {
    const slot = applyOverrides(written, overrides.get(written.id), CATALOG)
    const route = routeSlot(slot, CATALOG, available)
    const pick = input.chosenExercise?.[slot.id]
    const onList = pick !== undefined && (pick === slot.exerciseId || slot.substitutionIds.includes(pick))
    const exercise = exerciseById(onList && pick ? pick : route.exerciseId)
    const sides = writtenSides(slot, settings.injuredSide, week)
    return {
      slot,
      exercise,
      substitutions: slot.substitutionIds.map(exerciseById),
      route,
      sides,
      repUnit: effectiveSlot(slot, exercise).repUnit,
      text: slot.prescriptionText,
      loadNote: slot.loadNote ?? null,
      deload: isDeloadWeek(week) ? { written: slot.sets, sets: sides[0]?.sets ?? slot.sets } : null,
    }
  })
}

export type SessionPlan = { mode: 'full'; slots: SlotPlan[] } | { mode: 'tester'; slots: WrittenSlotPlan[] }

/** The plan for a mode: full is `planSession` exactly; tester is the session as written, extensions and the pause day dropped. */
export function planFor(mode: EngineMode, input: PlanInput): SessionPlan {
  if (mode === 'full') return { mode: 'full', slots: planSession(input) }
  // Only what the written session reads: no extensions, and no planned day, so no pause.
  const { template, week, settings, history, gym, chosenExercise } = input
  return { mode: 'tester', slots: writtenSession({ template, week, settings, history, gym, ...(chosenExercise ? { chosenExercise } : {}) }) }
}

/** The time window over the written sets (`writtenFitSlots`): the warm-up's minutes off the top, no warm-up sets, no extras. */
export function writtenFit(plans: readonly WrittenSlotPlan[], restSeconds: number, minutes: number | null, opts: { warmUpMinutes: number; logged?: ReadonlySet<string> }): Fit {
  return fitToWindow(
    writtenFitSlots(
      plans.map((p) => ({ slot: p.slot, sides: p.sides, repUnit: p.repUnit, here: p.route.kind === 'own' })),
      opts.logged,
    ),
    minutes,
    restSeconds,
    opts.warmUpMinutes,
  )
}
