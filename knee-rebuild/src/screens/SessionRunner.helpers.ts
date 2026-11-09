import { DUMBBELLS, missingHere, type Available, type SlotRoute } from '../rules/equipment.ts'
import { HELD_LOAD_INCREMENT_LB, RANGE_LADDER_DEG, type Prescription } from '../rules/prescription.ts'
import type { WarmUpParts } from '../rules/warmUp.ts'
import type { Ramp, RampSet } from '../app/session.ts'
import type { Draft } from '../rules/prefill.ts'
import { stepKey } from '../rules/runOrder.ts'
import type { SwapOffer } from '../rules/runnerGym.ts'
import { RACK_PRESETS } from './LocationEditor.helpers.ts'
import type { Equipment, EquipmentId, Exercise, LoadUnit, RepUnit, Requirement, SessionTemplate, SetLog, SetSide, Side, Slot, StopReason, Workout } from '../schema/index.ts'

/**
 * Pure helpers for the Session runner: what to prefill, what to call things, how to say a set in
 * words. Nothing here decides a load, a reading or an order; those come from src/rules.
 */

export const STOP_REASONS: { value: StopReason; label: string }[] = [
  { value: 'sharp-joint-line-pain', label: 'Sharp joint-line pain' },
  { value: 'pain', label: 'Pain' },
  { value: 'form', label: 'Form' },
  { value: 'fatigue', label: 'Fatigue' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'time', label: 'Time' },
  { value: 'other', label: 'Other' },
]

export function stopReasonLabel(reason: StopReason | undefined): string {
  return STOP_REASONS.find((r) => r.value === reason)?.label ?? 'no reason'
}

export function templateForWorkout(workout: Pick<Workout, 'templateId'>, templates: readonly SessionTemplate[]): SessionTemplate | null {
  return templates.find((t) => t.id === workout.templateId) ?? null
}

export function setStepKey(set: Pick<SetLog, 'slotId' | 'side' | 'setNumber'>): string {
  return stepKey(set.slotId, set.side, set.setNumber)
}

/** Seconds are logged as seconds; reps, minutes, yards and steps all go in reps. */
export function countField(repUnit: RepUnit): 'reps' | 'seconds' {
  return repUnit === 'seconds' ? 'seconds' : 'reps'
}

export function countLabel(repUnit: RepUnit): string {
  return { reps: 'Reps', seconds: 'Seconds', minutes: 'Minutes', yards: 'Yards', steps: 'Steps' }[repUnit]
}

export function countStep(repUnit: RepUnit): number {
  return repUnit === 'seconds' || repUnit === 'yards' ? 5 : 1
}

function unitWord(repUnit: RepUnit): string {
  return { reps: '', seconds: ' s', minutes: ' min', yards: ' yd', steps: ' steps' }[repUnit]
}

/** Whether the screen shows a load field: loaded exercises, and step-ups that hold dumbbells. */
export function showsLoad(exercise: Exercise): boolean {
  if (exercise.loadType === 'step-height') return exercise.holdsLoad !== undefined
  return !['bodyweight', 'time', 'band'].includes(exercise.loadType)
}

/** The unit a set's load is stored in. Step-ups store the dumbbells in their hands. */
export function logLoadUnit(exercise: Exercise): LoadUnit {
  return exercise.holdsLoad !== undefined ? 'lb' : exercise.loadUnit
}

export function loadStep(exercise: Exercise): number {
  if (exercise.holdsLoad !== undefined) return HELD_LOAD_INCREMENT_LB
  return exercise.increment > 0 ? exercise.increment : 1
}

/** The gym's dumbbell rack caps the load field; nothing else does. */
export function loadMax(exercise: Exercise, rackLb: number): number {
  const dumbbells = exercise.loadType === 'dumbbell-each' || exercise.loadType === 'dumbbell-single' || exercise.holdsLoad !== undefined
  return dumbbells ? rackLb : 2000
}

export function loadLabel(exercise: Exercise): string {
  if (exercise.holdsLoad !== undefined || exercise.loadType === 'dumbbell-each') return 'Dumbbells (lb each)'
  if (exercise.loadType === 'dumbbell-single') return 'Dumbbell (lb)'
  if (exercise.loadType === 'stack') {
    const unit = exercise.loadUnit === 'plate' ? 'plate' : 'lb'
    return exercise.loadDirection === 'down' ? `Assist (${unit})` : unit === 'plate' ? 'Plate' : 'Weight (lb)'
  }
  if (exercise.loadType === 'smith-plates') return 'Plates on the Smith (lb)'
  return 'Load (lb)'
}

/** A load in words: "90 lb", "plate 8", "20 lb each", "assist 40 lb", "bodyweight". */
export function loadWords(load: number | null, exercise: Exercise): string {
  if (!showsLoad(exercise)) return 'bodyweight'
  if (load === null) return 'load to pick'
  if (exercise.holdsLoad !== undefined) return load > 0 ? `${load} lb each` : 'no dumbbells'
  switch (exercise.loadType) {
    case 'dumbbell-each':
      return `${load} lb each`
    case 'stack':
      if (exercise.loadUnit === 'plate') return exercise.loadDirection === 'down' ? `assist ${load}` : `plate ${load}`
      return exercise.loadDirection === 'down' ? `assist ${load} lb` : `${load} lb`
    default:
      return `${load} lb`
  }
}

/** The prescription in words: "3 × 10–12 · RPE 6→7 · plate 8". */
export function prescriptionWords(p: Prescription, slot: Slot, exercise: Exercise): string {
  const count = p.perSet && p.perSet.length > 0 ? p.perSet.map((s) => s.reps).join(', ') : `${p.repsTarget}`
  const perSide = !slot.unilateral && slot.perSideLabel ? ` ${slot.perSideLabel}` : ''
  const reps = `${p.sets} × ${count}${unitWord(p.repUnit)}${perSide}`
  const rpe = slot.rpeTarget !== undefined ? ` · RPE ${slot.rpeTarget}${slot.rpeTargetEnd ? `→${slot.rpeTargetEnd}` : ''}` : ''
  const load = showsLoad(exercise) ? ` · ${loadWords(p.load, exercise)}` : ''
  const extra = [
    p.heightIn !== undefined ? `${p.heightIn} in. step` : '',
    p.rangeStopDeg !== undefined ? `90° to ${p.rangeStopDeg}°` : '',
    p.stage !== undefined && exercise.stages ? (exercise.stages[p.stage] ?? '') : '',
  ].filter(Boolean)
  return `${reps}${rpe}${load}${extra.length ? ` · ${extra.join(' · ')}` : ''}`
}

/** One logged set in words: "12 × plate 8 · RPE 7 · pain 2". */
export function setWords(set: SetLog, repUnit: RepUnit, exercise: Exercise): string {
  const count = set.seconds ?? set.reps ?? 0
  const parts = [`${count}${unitWord(set.seconds !== undefined ? 'seconds' : repUnit === 'seconds' ? 'reps' : repUnit)}`]
  if (showsLoad(exercise)) parts[0] = `${parts[0]} × ${loadWords(set.load, exercise)}`
  if (set.heightIn !== undefined) parts.push(`${set.heightIn} in.`)
  if (set.rangeStopDeg !== undefined) parts.push(`to ${set.rangeStopDeg}°`)
  if (set.stage !== undefined && exercise.stages) parts.push(exercise.stages[set.stage] ?? '')
  if (set.rpe !== undefined) parts.push(`RPE ${set.rpe}`)
  parts.push(set.painDuring !== undefined ? `pain ${set.painDuring}` : 'pain not rated')
  if (set.stopped) parts.push(`stopped: ${stopReasonLabel(set.stopReason).toLowerCase()}`)
  return parts.filter(Boolean).join(' · ')
}

/**
 * When the slot and the exercise on the card count sides differently (design section 4): a
 * unilateral slot on a two-legged exercise (a single-leg leg press moved to a goblet squat) is done
 * one leg at a time; a two-legged slot on a one-sided exercise logs as both sides (PROGRAM-QUESTIONS 54).
 */
export function sideLine(slotUnilateral: boolean, exerciseUnilateral: boolean): string | null {
  if (slotUnilateral && !exerciseUnilateral) return 'One leg at a time: the slot is single-leg in the program, so each side logs on its own, injured side first.'
  if (!slotUnilateral && exerciseUnilateral) return 'Logs as both sides: this slot is two-legged in the program.'
  return null
}

export function sideWords(side: SetSide, injuredSide: Side): string {
  if (side === 'both') return ''
  const name = side === 'left' ? 'Left' : 'Right'
  return side === injuredSide ? `${name} · injured` : name
}

/** Range stops the editor offers: the engine's ladder, never past the phase's stop. */
export function rangeStopOptions(phaseStopDeg: number | undefined): number[] {
  const stop = phaseStopDeg ?? 30
  return RANGE_LADDER_DEG.filter((deg) => deg < 90 && deg >= stop)
}

function newest(sets: readonly SetLog[]): SetLog | undefined {
  return [...sets].sort((a, b) => (a.loggedAt ?? '').localeCompare(b.loggedAt ?? '')).at(-1)
}

/** The most recent RPE logged for an exercise anywhere in history. */
export function lastRpeFor(exerciseId: string, sets: readonly SetLog[]): number | null {
  return newest(sets.filter((s) => s.exerciseId === exerciseId && s.rpe !== undefined))?.rpe ?? null
}

/** A draft from a set already logged, for editing it. */
export function draftFromSet(set: SetLog): Draft {
  return {
    load: set.load,
    count: set.seconds ?? set.reps ?? 0,
    rpe: set.rpe ?? null,
    pain: set.painDuring ?? null,
    ...(set.heightIn !== undefined ? { heightIn: set.heightIn } : {}),
    ...(set.rangeStopDeg !== undefined ? { rangeStopDeg: set.rangeStopDeg } : {}),
    ...(set.stage !== undefined ? { stage: set.stage } : {}),
  }
}

/** The set as it will be stored. `loggedAt` is kept on corrections and stamped only on new sets. */
export function buildSet(input: {
  workoutId: string
  slot: Slot
  exercise: Exercise
  /** What the set counts: the prescription's unit, which follows the exercise after a swap. */
  repUnit: RepUnit
  side: SetSide
  setNumber: number
  draft: Draft
  loggedAt: string
  stop?: StopReason
  /**
   * The side's prescription was rack-capped (`Prescription.rackCapped`: the gym's heaviest dumbbell,
   * nothing here to swap to). The set is stored `rackCapped`, so gymLoads.ts keeps the session out of
   * the baseline and a clean on it from counting (PROGRAM-QUESTIONS 73). A correction keeps the stamp.
   */
  rackCapped?: boolean
}): SetLog {
  const { slot, exercise, draft } = input
  const field = countField(input.repUnit)
  return {
    id: '',
    workoutId: input.workoutId,
    slotId: slot.id,
    exerciseId: exercise.id,
    setNumber: input.setNumber,
    side: input.side,
    load: showsLoad(exercise) ? Math.max(0, draft.load) : 0,
    loadUnit: logLoadUnit(exercise),
    ...(field === 'seconds' ? { seconds: Math.max(0, draft.count) } : { reps: Math.max(0, Math.round(draft.count)) }),
    ...(draft.rpe !== null ? { rpe: draft.rpe } : {}),
    ...(draft.pain !== null ? { painDuring: draft.pain } : {}),
    stopped: input.stop !== undefined,
    ...(input.stop !== undefined ? { stopReason: input.stop } : {}),
    ...(draft.heightIn !== undefined ? { heightIn: draft.heightIn } : {}),
    ...(draft.rangeStopDeg !== undefined ? { rangeStopDeg: draft.rangeStopDeg } : {}),
    ...(draft.stage !== undefined ? { stage: draft.stage } : {}),
    ...(input.rackCapped ? { rackCapped: true } : {}),
    loggedAt: input.loggedAt,
  }
}

/**
 * Swaps made in an earlier visit, recovered from the sets. An exercise id counts as a swap only when
 * it isn't what the engine prescribed without a swap, so an engine move to an easier version, or the
 * gym's move to what is here, is never mistaken for a choice. The slot's own exercise counts too
 * when the engine had moved the slot: Swap lists it (M4b), so Shawn ran it anyway.
 */
export function swapsFromSets(
  plans: readonly { slot: Slot; prescriptions: readonly Pick<Prescription, 'exerciseId'>[] }[],
  sets: readonly SetLog[],
): Record<string, string> {
  const swaps: Record<string, string> = {}
  for (const { slot, prescriptions } of plans) {
    const last = newest(sets.filter((s) => s.slotId === slot.id))
    if (!last) continue
    const engine = new Set(prescriptions.map((p) => p.exerciseId))
    if (!engine.has(last.exerciseId)) swaps[slot.id] = last.exerciseId
  }
  return swaps
}

/** Stored swaps win over recovered ones; a stored null means "back to the slot's own exercise". */
export function mergeSwaps(fromSets: Record<string, string>, stored: Record<string, string | null>): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...fromSets }
  for (const [slotId, choice] of Object.entries(stored)) merged[slotId] = choice ?? undefined
  return merged
}

export function parseStoredSwaps(raw: string | null): Record<string, string | null> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string | null> = {}
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string' || v === null) out[k] = v
    return out
  } catch {
    return {}
  }
}

/**
 * The session's swaps less any that name what the plan now runs without a swap (`engine`, by slot):
 * a mark at the gym since the pick can make it the gym's own pick, and then it is no swap.
 */
export function withoutEnginePicks(chosen: Record<string, string | undefined>, engine: ReadonlyMap<string, string>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(chosen).map(([slotId, id]) => [slotId, id !== undefined && id === engine.get(slotId) ? undefined : id]))
}

type PlannedSlot = { slot: Pick<Slot, 'id' | 'exerciseId' | 'substitutionIds'> }

/** Whether an exercise is on a planned slot's list as it runs: its own exercise, then its substitutions (Program edits included). */
const onList = (plan: PlannedSlot, exerciseId: string): boolean => plan.slot.exerciseId === exerciseId || plan.slot.substitutionIds.includes(exerciseId)

/**
 * The session's swaps less any no longer on their slot's list (`plans`, whose slots carry the
 * Program screen's edits): an edit mid-session can take a pick off it, and the engine then runs the
 * slot's history instead (`slotAtGym`), so the runner counts it no swap either. A slot nothing here
 * runs is held again (PROGRAM-QUESTIONS 83), and its card offers no "Back to".
 */
export function picksOnList(chosen: Record<string, string | undefined>, plans: readonly PlannedSlot[]): Record<string, string | undefined> {
  const bySlot = new Map(plans.map((p) => [p.slot.id, p]))
  return Object.fromEntries(
    Object.entries(chosen).map(([slotId, id]) => {
      const plan = bySlot.get(slotId)
      return [slotId, id !== undefined && plan !== undefined && onList(plan, id) ? id : undefined]
    }),
  )
}

/** The slots whose stored swap a Program edit took off their list, for the runner to forget; a stored null (back to its own) and a slot not planned stay. */
export function staleStoredSwaps(stored: Record<string, string | null>, plans: readonly PlannedSlot[]): string[] {
  const bySlot = new Map(plans.map((p) => [p.slot.id, p]))
  return Object.entries(stored)
    .filter(([slotId, id]) => {
      const plan = bySlot.get(slotId)
      return id !== null && plan !== undefined && !onList(plan, id)
    })
    .map(([slotId]) => slotId)
}

/** The slots Shawn picked Do it anyway on, as stored beside the swaps: a list of slot ids, anything else read as none. */
export function parseStoredSlotIds(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export function loggedMaxPain(sets: readonly SetLog[]): number | null {
  const pains = sets.map((s) => s.painDuring).filter((p): p is number => p !== undefined)
  return pains.length ? Math.max(...pains) : null
}

/** "48 min" between two ISO instants, or null when either is missing. */
export function durationWords(startedAt: string | undefined, finishedAt: string | undefined): string | null {
  if (!startedAt || !finishedAt) return null
  const minutes = Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1) return null
  return minutes >= 90 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`
}

/**
 * A slot's cues are program.md's words for the slot's own exercise. When another exercise runs (the
 * gym moved it, a swap chose it, the engine backed it off), they stay on screen, since some carry the
 * pain stop, labelled for the exercise they were written for: "Cues written for Leg press, both legs".
 * Null when the slot's own exercise runs (PROGRAM-QUESTIONS 97).
 */
export function cuesWrittenFor(slotExerciseId: string, runExerciseId: string, nameOf: (exerciseId: string) => string): string | null {
  return runExerciseId === slotExerciseId ? null : `Cues written for ${nameOf(slotExerciseId)}`
}

/** The count in words for the Done bar: "10 reps each side", "30 s", "40 yd". */
export function countWords(count: number, repUnit: RepUnit, slot: Pick<Slot, 'unilateral' | 'perSideLabel'>): string {
  const unit = { reps: ' reps', seconds: ' s', minutes: ' min', yards: ' yd', steps: ' steps' }[repUnit]
  const perSide = !slot.unilateral && slot.perSideLabel ? ` ${slot.perSideLabel}` : ''
  return `${count}${unit}${perSide}`
}

/* The gym in words (M4b, design section 4). What is here, what moved and what to mark come from src/rules; these only say it. */

export type ItemLike = Pick<Equipment, 'id' | 'name' | 'carried'>

/** A list name inside a sentence: "seated leg press", but "Smith machine", which program.md capitalizes. */
export function itemInSentence(name: string): string {
  return /^Smith\b/.test(name) ? name : `${name.charAt(0).toLowerCase()}${name.slice(1)}`
}

const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

function itemOf(id: EquipmentId, items: readonly ItemLike[]): { name: string; carried: boolean } {
  const item = items.find((i) => i.id === id)
  return item ? { name: item.name, carried: item.carried } : { name: id.replace(/-/g, ' '), carried: false }
}

const optionsOf = (r: Requirement): EquipmentId[] => (typeof r === 'string' ? [r] : r.anyOf)

/** A carried item stands alone in its requirement (no either-or in the seed carries one): the bag, not the gym, lacks it. */
function inBag(r: Requirement, items: readonly ItemLike[]): boolean {
  return typeof r === 'string' && itemOf(r, items).carried
}

/** One requirement in words: "seated leg press", "step platforms or stair". */
function requirementWords(r: Requirement, items: readonly ItemLike[]): string {
  return optionsOf(r)
    .map((id) => itemInSentence(itemOf(id, items).name))
    .join(' or ')
}

/** What an exercise lacks, joined: "Smith machine and flat bench", "cable ankle strap in your bag". */
function needsWords(missing: readonly Requirement[], items: readonly ItemLike[]): string {
  return missing.map((r) => `${requirementWords(r, items)}${inBag(r, items) ? ' in your bag' : ''}`).join(' and ')
}

/**
 * A slot the gym moved (`route.kind` moved): "Not at Hotel gym: Seated leg press. Using Goblet squat
 * to a bench (no 45° leg press, no Smith machine)." First what the exercise the slot was on lacks,
 * then what runs, then what each exercise passed over after it lacks, each item once. A carried item
 * is the bag's: "Not in your bag: Cable ankle strap."
 */
export function movedWords(route: Pick<SlotRoute, 'passedOver'>, toName: string, gymName: string, items: readonly ItemLike[]): string {
  const first = route.passedOver[0]?.missing ?? []
  const atGym = first.filter((r) => !inBag(r, items))
  const bag = first.filter((r) => inBag(r, items))
  const said = new Set(first.flatMap(optionsOf))
  const segments = [
    atGym.length > 0 ? `Not at ${gymName}: ${capitalize(atGym.map((r) => requirementWords(r, items)).join(' and '))}` : '',
    bag.length > 0 ? `Not in your bag: ${capitalize(bag.map((r) => requirementWords(r, items)).join(' and '))}` : '',
  ].filter(Boolean)
  const rest: string[] = []
  for (const { missing } of route.passedOver.slice(1)) {
    for (const r of missing) {
      if (optionsOf(r).every((id) => said.has(id))) continue
      const words = `no ${requirementWords(r, items)}${inBag(r, items) ? ' in your bag' : ''}`
      if (!rest.includes(words)) rest.push(words)
    }
  }
  const head = segments.length > 0 ? `${segments.join('. ')}.` : `Not at ${gymName}.`
  return `${head} Using ${toName}${rest.length > 0 ? ` (${rest.join(', ')})` : ''}.`
}

/** A slot with nothing on its list here (`route.kind` none): "Nothing here for Step-off landing … (needs step platforms)." */
export function nothingHereWords(exerciseName: string, missing: readonly Requirement[], items: readonly ItemLike[]): string {
  return missing.length > 0 ? `Nothing here for ${exerciseName} (needs ${needsWords(missing, items)}).` : `Nothing here for ${exerciseName}.`
}

/** "Mark step platforms here" (setPresent). */
export function markHereLabel(id: EquipmentId, items: readonly ItemLike[]): string {
  return `Mark ${itemInSentence(itemOf(id, items).name)} here`
}

/** "Smith machine isn't here: mark it" (markOff), "Step platforms aren't here: mark them". */
export function markOffLabel(id: EquipmentId, items: readonly ItemLike[]): string {
  const { name } = itemOf(id, items)
  return /[^s]s$/i.test(name) ? `${name} aren't here: mark them` : `${name} isn't here: mark it`
}

/** What no mark at a gym adds: dumbbells, which the gym's dumbbell max decides. */
export const NO_DUMBBELLS_WORDS = "No dumbbells here: each gym's dumbbells are set in Where you train."

/** The racks the card offers when a slot runs at a gym with no dumbbells: the editor's presets, less None. */
export const RACK_ASK_LB: readonly number[] = RACK_PRESETS.filter((lb) => lb > 0)

/**
 * The card's ask when a slot runs on dumbbell work at a gym with none set (`asksForRack`): the load
 * field stops at the rack, so the heaviest dumbbell is set right there, a preset a tap.
 */
export function rackAskWords(gymName: string): string {
  return `No dumbbells are set for ${gymName}, so the load stops at 0 lb. Tap the heaviest one here, or set another weight in Where you train.`
}

/** The line after a rack tap is saved. */
export function rackSetWords(gymName: string, lb: number): string {
  return `Dumbbells at ${gymName} now go to ${lb} lb.`
}

/** What no mark at a gym adds: a carried item, which is Settings' kit ("In your bag" in Where you train). */
export function notInBagWords(ids: readonly EquipmentId[], items: readonly ItemLike[]): string {
  return `Not in your bag: ${ids.map((id) => itemInSentence(itemOf(id, items).name)).join(' and ')}. "In your bag" in Where you train adds ${ids.length > 1 ? 'them' : 'it'}.`
}

/**
 * The logged sets as the minutes stepper reads them: each with its unit (the slot's, or seconds for
 * a set logged in seconds; reps when the slot is no longer in the plan), when it was logged, and its RPE.
 */
export function timedSets(sets: readonly SetLog[], repUnitOf: (slotId: string) => RepUnit | undefined): { reps?: number; seconds?: number; repUnit: RepUnit; loggedAt?: string; rpe?: number }[] {
  return sets.map((s) => ({
    ...(s.reps !== undefined ? { reps: s.reps } : {}),
    ...(s.seconds !== undefined ? { seconds: s.seconds } : {}),
    repUnit: s.seconds !== undefined ? 'seconds' : (repUnitOf(s.slotId) ?? 'reps'),
    ...(s.loggedAt !== undefined ? { loggedAt: s.loggedAt } : {}),
    ...(s.rpe !== undefined ? { rpe: s.rpe } : {}),
  }))
}

/** The warm-up row (`warmUpParts`): "Warm-up · bike 5 min · knee circuit 5 min", without the bike where there is none, and the line that says so. */
export function warmUpWords(parts: WarmUpParts): { line: string; noBike: string | null } {
  const circuit = `knee circuit ${parts.circuit} min`
  return parts.bike !== null ? { line: `Warm-up · bike ${parts.bike} min · ${circuit}`, noBike: null } : { line: `Warm-up · ${circuit}`, noBike: 'No upright bike here; nothing else is written for it.' }
}

/** One warm-up set's load in words: "90 lb", "20 lb each", "empty bar", "empty sled", "the lightest plate". */
function rampLoadWords(set: RampSet, exercise: Exercise): string {
  if (set.light === 'empty-bar') return 'empty bar'
  if (set.light === 'empty-sled') return 'empty sled'
  if (set.light === 'lightest-plate') return 'the lightest plate'
  return loadWords(set.load, exercise)
}

/** A slot's warm-up sets in words: "90 lb × 8, then 135 lb × 5"; null when there are none. */
export function rampSetsWords(ramp: Ramp, exercise: Exercise): string | null {
  if (ramp.kind !== 'sets') return null
  return ramp.sets.map((s) => `${rampLoadWords(s, exercise)} × ${s.reps}`).join(', then ')
}

/**
 * The runner's line above set 1 of a big lift (PROGRAM-QUESTIONS 165): its warm-up sets, never
 * logged, or why a load needs none. Nothing for an exercise the rule doesn't cover, a first time,
 * one already warm, a late entry, or a working load of nothing on a stack or dumbbells.
 */
export function rampWords(ramp: Ramp, exercise: Exercise): string | null {
  const sets = rampSetsWords(ramp, exercise)
  if (sets !== null && ramp.kind === 'sets') return `${ramp.sets.length === 1 ? 'Warm-up set' : 'Warm-up sets'} first, not logged: ${sets}.`
  if (ramp.kind !== 'none' || ramp.why !== 'too-light' || ramp.workingLoad === undefined) return null
  if (ramp.workingLoad > 0) return `No warm-up sets today: ${loadWords(ramp.workingLoad, exercise)} is light enough to start on.`
  if (exercise.loadType === 'smith-plates') return 'No warm-up sets today: the empty bar is light enough to start on.'
  if (exercise.loadType === 'plates') return 'No warm-up sets today: the empty sled is light enough to start on.'
  return null
}

export interface SwapChoice {
  exercise: Exercise
  /** What this gym lacks for it (`missingHere`); empty means here. */
  missing: Requirement[]
  here: boolean
  /** "Here" or "Not here · needs Smith machine". */
  words: string
}

/** The exercise the plan runs that is off the card (`cardHoldsOff`): which, why, what the card runs instead, and the gym's rack. */
export interface HoldsOff {
  exerciseId: string
  why: 'rack' | 'engine'
  cardName: string
  rackLb: number
}

function holdsOffChoice(h: HoldsOff): string {
  if (h.why === 'engine') return `Here · backed off today: the slot stays on ${h.cardName}`
  return h.rackLb > 0 ? `Here · past the ${h.rackLb} lb rack: the slot stays on ${h.cardName}` : `Here · no dumbbells here: the slot stays on ${h.cardName}`
}

/**
 * Swap's list: the slot's own exercise, then its substitutions, in the program's order, each here or
 * not. All stay tappable. The exercise the plan runs but the card doesn't (`holdsOff`: past the rack,
 * or backed off) says so, since a tap on it changes nothing.
 */
export function swapChoices(own: Exercise, substitutions: readonly Exercise[], available: Available, items: readonly ItemLike[], holdsOff: HoldsOff | null = null): SwapChoice[] {
  return [own, ...substitutions].map((exercise) => {
    const missing = missingHere(exercise, available)
    const here = missing.length === 0
    const words = !here ? `Not here · needs ${needsWords(missing, items)}` : holdsOff?.exerciseId === exercise.id ? holdsOffChoice(holdsOff) : 'Here'
    return { exercise, missing, here, words }
  })
}

/** The reply to a Swap tap on the exercise the card holds off: "Dumbbell Romanian deadlift is past this gym’s 25 lb rack, so the slot stays on Single-leg RDL." */
export function holdsOffWords(name: string, why: HoldsOff['why'], cardName: string, rackLb: number): string {
  if (why === 'engine') return `${name} backed off, so the slot stays on ${cardName} today.`
  return rackLb > 0 ? `${name} is past this gym’s ${rackLb} lb rack, so the slot stays on ${cardName}.` : `There are no dumbbells here for ${name}, so the slot stays on ${cardName}.`
}

export interface NotHereEntry {
  label: string
  /** The exercise the gym passed over: the one the slot's history put it on. */
  from: string
  /** What the slot runs: the gym's pick, a swap, or `from` again when Shawn ran it anyway. */
  ran: string
  kind: 'moved' | 'none'
  ranFrom: boolean
  logged: boolean
}

/** The slots the gym changed, for Finish: every slot not routed `own`, in session order. */
export function notHereEntries(
  plans: readonly { slot: Pick<Slot, 'id' | 'label'>; exercise: Pick<Exercise, 'id' | 'name'>; route: SlotRoute }[],
  logged: ReadonlySet<string>,
  nameOf: (exerciseId: string) => string,
): NotHereEntry[] {
  return plans.flatMap(({ slot, exercise, route }): NotHereEntry[] => {
    if (route.kind === 'own') return []
    const fromId = route.passedOver[0]?.exerciseId ?? route.exerciseId
    return [{ label: slot.label, from: nameOf(fromId), ran: exercise.name, kind: route.kind, ranFrom: exercise.id === fromId, logged: logged.has(slot.id) }]
  })
}

/** "Not at Hotel gym: 1 Leg press, both legs (Goblet squat to a bench instead); 7 Step-off landing (nothing here)." Null when the gym changed nothing. */
export function notHereWords(gymName: string, entries: readonly NotHereEntry[]): string | null {
  if (entries.length === 0) return null
  const what = (e: NotHereEntry) => {
    if (!e.ranFrom) return `${e.ran} instead`
    if (e.kind === 'none') return e.logged ? 'nothing here; done anyway' : 'nothing here'
    return e.logged ? 'done anyway' : 'not here'
  }
  return `Not at ${gymName}: ${entries.map((e) => `${e.label} ${e.from} (${what(e)})`).join('; ')}.`
}

/**
 * What the card says the gym did to the slot (design section 4): the move or the nothing-here line
 * while no swap chose (`route` still says what the gym would have done under a swap, and the swap's
 * own offers speak then). A rack cap is said once, by the engine's note on the card ("The rack stops
 * at 25 lb and nothing is written to swap to: 25 lb, rack-capped, so the session won’t count as clean.").
 */
export function routeLines(input: { route: SlotRoute; swapped: boolean; gymName: string; items: readonly ItemLike[]; nameOf: (exerciseId: string) => string }): string[] {
  const { route, items } = input
  const lines: string[] = []
  if (!input.swapped && route.kind === 'moved') lines.push(movedWords(route, input.nameOf(route.exerciseId), input.gymName, items))
  if (!input.swapped && route.kind === 'none') lines.push(nothingHereWords(input.nameOf(route.exerciseId), route.passedOver[0]?.missing ?? [], items))
  return lines
}

/**
 * Whether the card says "Moved to … by the engine": the exercise on it isn't the slot's own and
 * no swap chose it, and it isn't the gym's move, which the gym's line says in words instead, nor
 * the rack's, which the prescription's own note already says ("swap to Single-leg RDL").
 */
export function movedByEngine(slotExerciseId: string, cardExerciseId: string, route: Pick<SlotRoute, 'kind' | 'exerciseId'>, swapped: boolean, saidByNote = false): boolean {
  if (swapped || saidByNote || cardExerciseId === slotExerciseId) return false
  return !(route.kind === 'moved' && cardExerciseId === route.exerciseId)
}

/** A Swap pick stored for the session: picking what the gym would run anyway (`engineId`) is no swap, so the slot follows the plan again. */
export function swapValue(pickId: string | null, engineId: string): string | null {
  return pickId === null || pickId === engineId ? null : pickId
}

/**
 * What a Swap pick does to the session (design section 4). `value` is the swap stored (`swapValue`:
 * the gym's own pick is no swap). On a slot with nothing here the gym's own pick is the slot's own
 * exercise, so the pick is Do it anyway (`anyway`), which makes its own offer. Otherwise a pick of
 * an exercise other than the one on the card `offers` what `swapOffer` says to mark; Back to (no
 * pick) and a pick of what the card already runs offer nothing.
 */
export function swapPick(input: { pickId: string | null; engineId: string; cardId: string; routeKind: SlotRoute['kind'] }): { value: string | null; anyway: boolean; offers: boolean } {
  const value = swapValue(input.pickId, input.engineId)
  const anyway = input.pickId !== null && value === null && input.routeKind === 'none'
  return { value, anyway, offers: !anyway && input.pickId !== null && input.pickId !== input.cardId }
}

/**
 * The exercise whose lacks the card keeps offering to mark, from what is stored rather than the last
 * tap, so a reload keeps it: a slot with nothing here that runs anyway (Do it anyway, or a set
 * logged; `held` while it waits for Skip or Do it anyway) offers what its exercise lacks, and a swap
 * offers what its pick lacks (`swapOffer` of the pick against itself: nothing when it is here). Null
 * otherwise; a here pick's mark-off is offered once, at the pick.
 */
export function standingMarkFor(input: { routeKind: SlotRoute['kind']; routeExerciseId: string; swapped: boolean; cardId: string; held: boolean }): string | null {
  if (input.held) return null
  if (input.swapped) return input.cardId
  return input.routeKind === 'none' ? input.routeExerciseId : null
}

/**
 * A swap to an exercise that isn't here, in words beside its marks: "Not at Hotel gym: Smith
 * machine, which Smith machine box squat needs." Only what the gym lacks: dumbbells (the dumbbell
 * max) and the bag (Settings' kit) are said by the offer's own lines (`offerNotes`). Null when the
 * gym lacks nothing else.
 */
export function pickNotHereWords(pick: Pick<Exercise, 'name' | 'requires' | 'stages' | 'stageRequires'>, available: Available, gymName: string, items: readonly ItemLike[]): string | null {
  const atGym = missingHere(pick, available).filter((r) => r !== DUMBBELLS && !inBag(r, items))
  if (atGym.length === 0) return null
  return `Not at ${gymName}: ${capitalize(atGym.map((r) => requirementWords(r, items)).join(' and '))}, which ${pick.name} needs.`
}

export interface GymMark {
  id: EquipmentId
  /** True: `setPresent(…, true)`, "Mark … here". False: `markOff`, "… isn't here: mark it". */
  here: boolean
  label: string
}

/**
 * A mark offer (`swapOffer` in src/rules/runnerGym.ts, or Do it anyway's) as words and buttons, read
 * against what is here now: an item marked since the offer was made drops out, so a tap is never
 * offered twice. Dumbbells and the bag get words, not a button: the dumbbell max and the kit set them.
 */
export function offerNotes(offer: SwapOffer | null, available: Available, items: readonly ItemLike[]): { lines: string[]; marks: GymMark[] } {
  if (!offer) return { lines: [], marks: [] }
  if (offer.kind === 'mark-off') {
    return { lines: [], marks: offer.items.filter((id) => available.has(id)).map((id) => ({ id, here: false, label: markOffLabel(id, items) })) }
  }
  const bag = offer.bag.filter((id) => !available.has(id))
  return {
    lines: [...(offer.dumbbells && !available.has(DUMBBELLS) ? [NO_DUMBBELLS_WORDS] : []), ...(bag.length > 0 ? [notInBagWords(bag, items)] : [])],
    marks: offer.items.filter((id) => !available.has(id)).map((id) => ({ id, here: true, label: markHereLabel(id, items) })),
  }
}

/**
 * The line after a mark is saved: "Marked here at Hotel gym: step platforms." A mark-off points to
 * where it is cleared: Today's "It's back" when the session's gym is the one Today plans at
 * (`todayPlansHere`), since Today shows only that gym's mark-offs; Where you train otherwise.
 */
export function markedWords(here: boolean, id: EquipmentId, gymName: string, items: readonly ItemLike[], todayPlansHere: boolean): string {
  const name = itemInSentence(itemOf(id, items).name)
  if (here) return `Marked here at ${gymName}: ${name}.`
  return todayPlansHere ? `Marked not here at ${gymName}: ${name}. Today offers "It's back" when it is.` : `Marked not here at ${gymName}: ${name}. Where you train clears it when it is back.`
}

/** Under the gym line when the session runs at a gym Today doesn't plan at: the runner's Change moves only the session. */
export function todayGymWords(activeName: string): string {
  return `Today plans at ${activeName}; a Change here moves only this session.`
}

/** The tap that makes the session's gym the one Today plans at too. */
export function todayTooLabel(gymName: string): string {
  return `Use ${gymName} on Today too`
}

/** The Done bar's line on a slot with nothing here, before Do it anyway. */
export function heldBarWords(gymName: string): string {
  return `Nothing at ${gymName} for this slot: Skip, Do it anyway or Swap.`
}

/**
 * When the run order has nothing left (`nextStep` is null): every required set is logged, or, with
 * slots left that nothing here runs (`held`, as "7 Step-off landing"), every set this gym can run.
 */
export function doneWords(gymName: string, held: readonly string[]): { heading: string; line: string; bar: string } {
  if (held.length === 0) return { heading: 'Every required set is logged', line: 'Optional slots are still open below. Finish when you’re done.', bar: 'Every required set is logged.' }
  return {
    heading: `Every set ${gymName} can run is logged`,
    line: `Nothing here for ${held.join('; ')}: tap a row below for Skip, Do it anyway or Swap, or finish.`,
    bar: `Every set ${gymName} can run is logged.`,
  }
}

/**
 * Finish's open slots: required slots not stopped with a step still open, as "1 Goblet squat to a
 * bench", leaving out the slots nothing here runs (`held`), which the not-here line names. A slot
 * with none of its sets logged is not logged; one with some but not all is not finished.
 */
export function notLoggedLabels(
  plans: readonly { slot: Pick<Slot, 'id' | 'label' | 'optional'>; exercise: Pick<Exercise, 'name'> }[],
  steps: readonly { key: string; slotId: string }[],
  done: ReadonlySet<string>,
  stopped: ReadonlySet<string>,
  held: ReadonlySet<string>,
): { notLogged: string[]; notFinished: string[] } {
  const open = plans.filter((p) => !p.slot.optional && !stopped.has(p.slot.id) && !held.has(p.slot.id) && steps.some((s) => s.slotId === p.slot.id && !done.has(s.key)))
  const started = (slotId: string) => steps.some((s) => s.slotId === slotId && done.has(s.key))
  const label = (p: (typeof open)[number]) => `${p.slot.label} ${p.exercise.name}`
  return { notLogged: open.filter((p) => !started(p.slot.id)).map(label), notFinished: open.filter((p) => started(p.slot.id)).map(label) }
}

/**
 * Finish's line under the not-here line: the slots `notLoggedLabels` leaves open, separated by
 * semicolons as the not-here line is (program.md's names carry their own commas: "5 Cable hip
 * abduction, ankle strap"), not logged first, then not finished; or, with none open, that every
 * required set (every other one, when the not-here line names some) is logged.
 */
export function notLoggedWords(open: { notLogged: readonly string[]; notFinished: readonly string[] }, notHereSaid: boolean): string {
  const parts = [
    open.notLogged.length > 0 ? `Not logged: ${open.notLogged.join('; ')}. They keep last session’s prescription.` : '',
    open.notFinished.length > 0 ? `Not finished: ${open.notFinished.join('; ')}.` : '',
  ].filter(Boolean)
  if (parts.length > 0) return parts.join(' ')
  return notHereSaid ? 'Every other required set is logged.' : 'Every required set is logged.'
}
