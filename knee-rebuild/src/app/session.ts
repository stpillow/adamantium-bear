import { exerciseById, program, templateFor } from '../program/program.ts'
import { availableEquipment, WARM_UP_BIKE, type Available, type SlotRoute } from '../rules/equipment.ts'
import { attachChecks, recordsBefore, type WorkoutRecord } from '../rules/history.ts'
import { sessionPhaseWeek } from '../rules/compliance.ts'
import { bandWeek, pauseOn } from '../rules/downPeriod.ts'
import { isAddedSlotId, withAddedSlots } from '../rules/addedSlots.ts'
import { extensionPool, isExtraSlotId } from '../rules/extensions.ts'
import { fitToWindow, type Fit, type WindowSlot } from '../rules/fitWindow.ts'
import { applyOverrides, overridesBySlot } from '../rules/overrides.ts'
import { prescribe, type GymHere, type Prescription } from '../rules/prescription.ts'
import { phaseWeekOf, slotsForPhaseWeek } from '../rules/session.ts'
import { slotAtGym } from '../rules/slotExercise.ts'
import { warmUpParts, type WarmUpParts } from '../rules/warmUp.ts'
import { rampFor, rampReps, type Ramp } from '../rules/warmUpRamp.ts'
import { kneeMorning, wholeKneeFor } from '../rules/wholeKnee.ts'
import type { EquipmentId, Exercise, IsoDate, Location, SessionLetter, SessionTemplate, Settings, Slot, Workout } from '../schema/index.ts'
import type { History } from '../db/repo.ts'

/** A slot's warm-up sets, or why there are none (src/rules/warmUpRamp.ts): screens take the type from here, never from the rule (warmUpRamp.guard.test.ts). */
export type { Ramp, RampSet } from '../rules/warmUpRamp.ts'

export interface SlotPlan {
  slot: Slot
  /** The exercise the slot runs today: its own, the substitution chosen for this session, or the easier version its history put it on. */
  exercise: Exercise
  substitutions: Exercise[]
  /** One per side, injured side first. */
  prescriptions: Prescription[]
  /**
   * What the gym does to the slot without a swap (`slotAtGym`, src/rules/slotExercise.ts), from
   * where its history put it: `own`, that exercise runs here; `moved`, it isn't here and
   * `route.exerciseId` runs, each exercise passed over with what is missing; `none`, nothing from
   * it on is here, so the slot keeps it for Skip or Do it anyway. With a swap chosen, `exercise` is
   * the swap and `route` still says what the gym would have done.
   */
  route: SlotRoute
}

/** Where a session runs (M4b): the gym, and the bag Shawn carries to every gym (`Settings.kit`). */
export interface Gym {
  location: Location
  kit: readonly EquipmentId[]
}

const EQUIPMENT_NAMES: ReadonlyMap<EquipmentId, string> = new Map(program.equipment.map((e) => [e.id, e.name]))
/** The catalog by id: an edit naming an exercise the seed no longer has, or one the slot can't count or step, is dropped, never looked up. */
const CATALOG: ReadonlyMap<string, Exercise> = new Map(program.exercises.map((e) => [e.id, e]))

/** What is here at a gym: its list (the program's list as of the gym's version), its dumbbells and the bag, less what is marked off. */
export function availableAt(gym: Gym): Available {
  return availableEquipment(gym.location, program.equipment, program.planetFitness, gym.kit)
}

/** The gym as `prescribe` reads it: what is here, the rack, and the program's names for the notes. */
export function gymHere(gym: Gym): GymHere {
  return { available: availableAt(gym), dumbbellMaxLb: gym.location.dumbbellMaxLb, names: EQUIPMENT_NAMES }
}

/** The template with the exercises Shawn added after its own slots: what a session's slots, and its summary, are read from. */
export function withAdded(template: SessionTemplate, history: Pick<History, 'addedSlots'>): SessionTemplate {
  return withAddedSlots(template, history.addedSlots ?? [], CATALOG, program.templates)
}

/**
 * Assembles the engine's inputs from stored history and the gym, and asks it for every slot's
 * prescription. Composition only: which slots run, what the last session was, what the readings
 * were, what is here. Every decision inside comes from src/rules. Each slot is the one the Program
 * screen's edits make of it (`applyOverrides`, M6), so `SlotPlan.slot` carries the cues and the
 * substitutions as edited, and the routing, the Swap list and a back-off's move all read them.
 */
export function planSession(input: {
  template: SessionTemplate
  week: number
  settings: Settings
  history: History
  /** The gym it runs at: Today and the Morning check plan at the active gym, the runner at the workout's own. */
  gym: Gym
  /** A swap made for this session, by slot id. */
  chosenExercise?: Record<string, string | undefined>
  /** Exercises added for extra time (`extensionPool`), after the template's own and Shawn's added ones; the minutes decide which of them run (`windowFit`). */
  extend?: readonly Slot[]
  /** Plan only from sessions dated before this day: the session being run, and any earlier attempt that day, never plan it. */
  before?: IsoDate
  /**
   * The day the session is planned for, when it isn't `before` (the Morning check's "next time" plans
   * from every record but for a later day): a down period covering it pauses progression and holds
   * the phase-week bands (src/rules/downPeriod.ts). Defaults to `before`; with neither, no pause.
   */
  pauseDate?: IsoDate
}): SlotPlan[] {
  const { template, week, settings, history } = input
  const all: WorkoutRecord[] = attachChecks(history.workouts, history.setLogs, history.morningChecks)
  const records = input.before ? recordsBefore(all, input.before) : all
  // A down period pauses by the day planned (Batch E, PROGRAM-QUESTIONS 181 to 188): a late-logged past day pauses as that day.
  const planDay = input.pauseDate ?? input.before
  const pause = planDay ? pauseOn(planDay, history.downPeriods ?? []) : null
  const phaseWeek = phaseWeekFor(week, settings, history, planDay)
  const morning = kneeMorning(history.morningChecks, history.workouts, input.before)
  const gym = gymHere(input.gym)
  const overrides = overridesBySlot(history.programOverrides ?? [])
  // Shawn's added exercises go after the template's own slots; the seed template is never written.
  return [...slotsForPhaseWeek(withAdded(template, history), phaseWeek), ...(input.extend ?? [])].map((written) => {
    // Shawn's edits laid over program.md's slot before anything routes or prescribes from it; the seed is never written.
    const slot = applyOverrides(written, overrides.get(written.id), CATALOG)
    const own = exerciseById(slot.exerciseId)
    const substitutions = slot.substitutionIds.map(exerciseById)
    // A swap chosen for this session beats the gym and the slot's history; the gym routes forward from the history (slotExercise.ts).
    const { exercise, readings, lastSets, placement, route } = slotAtGym(
      { slot, own, substitutions, records, injuredSide: settings.injuredSide, ...(pause ? { pause } : {}) },
      input.chosenExercise?.[slot.id],
      gym.available,
    )
    const wholeKnee = wholeKneeFor({ morning, own, exercise, phase: template.phase, records })
    const prescriptions = prescribe({
      slot,
      exercise,
      substitutions,
      readings,
      lastSets,
      week,
      injuredSide: settings.injuredSide,
      // The gym's rack; prescribe reads `gym.dumbbellMaxLb`, and Settings' frozen max is never read outside src/db.
      dumbbellMax: gym.dumbbellMaxLb,
      redFlagActive: settings.redFlag.active,
      gym,
      ...(pause ? { pause } : {}),
      ...(placement ? { placement } : {}),
      ...(wholeKnee ? { wholeKnee } : {}),
    })
    return { slot, exercise, substitutions, prescriptions, route }
  })
}

/**
 * What can be added to this session for extra time: the phase's other sessions' exercises, then
 * upper-body work (`extensionPool`). Worked out from the same inputs each time, never stored.
 */
export function sessionExtensions(template: SessionTemplate, history: Pick<History, 'addedSlots' | 'downPeriods'>, settings: Settings, week: number, date?: IsoDate): Slot[] {
  const phaseWeek = phaseWeekFor(week, settings, history, date)
  return extensionPool({ template: withAdded(template, history), templates: program.templates, phaseWeek, catalog: CATALOG })
}

/** The session with its extension slots after its own, so a Summary can name every slot a set was logged on. */
export function withExtensions(template: SessionTemplate, history: Pick<History, 'addedSlots'>, extensions: readonly Slot[]): SessionTemplate {
  const own = withAdded(template, history)
  return { ...own, slots: [...own.slots, ...extensions] }
}

/** The lift warm-up's minutes at a gym (`warmUpParts`): the bike's where it has an upright bike, and the knee circuit's for the phase. */
export function warmUpFor(phase: number, gym: Gym): WarmUpParts {
  return warmUpParts(program.warmUp.lift, phase, availableAt(gym).has(WARM_UP_BIKE))
}

/**
 * A slot's warm-up sets as the plan stands (`rampFor`, display only): from the exercise and load its
 * prescription runs today, so a swap, a rack move, a back-off or a deload ramps from what is actually
 * on the bar. Never part of `SlotPlan`: no prescription, log or rule reads it.
 */
export function slotRamp(plan: SlotPlan, opts: { late: boolean; alreadyWarm: boolean }): Ramp {
  const prescription = plan.prescriptions[0]
  const exercise = prescription ? (CATALOG.get(prescription.exerciseId) ?? plan.exercise) : plan.exercise
  return rampFor({ exercise, slot: plan.slot, prescription, late: opts.late, alreadyWarm: opts.alreadyWarm, rule: program.warmUp.lift.ramp })
}

/** The exercise a plan runs today: the prescription's (a rack move changes it), else the plan's. */
function runsExercise(plan: SlotPlan): string {
  return plan.prescriptions[0]?.exerciseId ?? plan.exercise.id
}

/**
 * Each plan's warm-up sets as the session order would show them: an exercise is warm once an
 * earlier slot in the plan runs it, so only its first slot ramps (keyed on the exercise each slot
 * runs, so a rack-moved slot and an extra of the same machine aren't both counted). The time window
 * and the read-only Preview use it; the runner goes by what is logged instead (`slotRamp`).
 */
export function rampsInOrder(plans: readonly SlotPlan[], late: boolean): Ramp[] {
  const seen = new Set<string>()
  return plans.map((plan) => {
    const id = runsExercise(plan)
    const ramp = slotRamp(plan, { late, alreadyWarm: seen.has(id) })
    seen.add(id)
    return ramp
  })
}

/**
 * Which of a session's slots fit the minutes Shawn has (`fitToWindow`): the plan's sets, reps and
 * the Settings rest, in session order, door to door: the warm-up's minutes come off the top, and the
 * warm-up sets of the slots that show them are counted (`ramps`: false for a session entered after
 * the fact, which shows none). A slot with a set already logged is never dropped. Null minutes is
 * the full session.
 */
export function windowFit(
  plans: readonly SlotPlan[],
  restSeconds: number,
  minutes: number | null,
  opts: { warmUpMinutes: number; ramps: boolean; logged?: ReadonlySet<string> },
): Fit {
  const logged = opts.logged ?? new Set<string>()
  const ramps = rampsInOrder(plans, !opts.ramps)
  const slots: WindowSlot[] = plans.map((p, i) => {
    const reps = rampReps(ramps[i] ?? { kind: 'none', why: 'not-eligible' })
    return {
      slotId: p.slot.id,
      ...(p.slot.groupId ? { groupId: p.slot.groupId } : {}),
      added: isAddedSlotId(p.slot.id),
      extra: isExtraSlotId(p.slot.id),
      // An extra the gym can't run as it stands (a machine that isn't here) is never added for time.
      eligible: p.route.kind === 'own',
      optional: p.slot.optional,
      logged: logged.has(p.slot.id),
      sides: p.prescriptions.map((x) => ({ sets: x.sets, repsTarget: x.repsTarget, repUnit: x.repUnit })),
      ...(reps.length > 0 ? { rampReps: reps } : {}),
    }
  })
  return fitToWindow(slots, minutes, restSeconds, opts.warmUpMinutes)
}

/**
 * The week of its phase a day's slots are read in: the calendar's, held at the band a down period
 * began in while one covers `date` (`bandWeek`, PROGRAM-QUESTIONS 188); with no date, the calendar's.
 */
export function phaseWeekFor(week: number, settings: Pick<Settings, 'phaseEnteredWeek' | 'startDate'>, history: Pick<History, 'downPeriods'>, date?: IsoDate): number {
  const calendar = phaseWeekOf(Math.max(week, settings.phaseEnteredWeek), settings.phaseEnteredWeek)
  if (date === undefined) return calendar
  return bandWeek({ date, phaseWeek: calendar, startDate: settings.startDate, phaseEnteredWeek: settings.phaseEnteredWeek, periods: history.downPeriods ?? [] })
}

/** The phase week a stored session's Summary reads its slots in (`sessionPhaseWeek`), held the same way when a down period covered its day. */
export function sessionBandWeek(workout: Pick<Workout, 'phase' | 'week' | 'date'>, settings: Settings, history: Pick<History, 'downPeriods'>): number | null {
  const calendar = sessionPhaseWeek(workout, settings)
  if (calendar === null) return null
  return bandWeek({ date: workout.date, phaseWeek: calendar, startDate: settings.startDate, phaseEnteredWeek: settings.phaseEnteredWeek, periods: history.downPeriods ?? [] })
}

/** The template for a session letter in the phase the app is currently in. */
export function currentTemplate(settings: Settings, letter: SessionLetter): SessionTemplate | null {
  if (settings.currentPhase > 3) return null
  return templateFor(settings.currentPhase, letter)
}

export const PROGRAM = program
