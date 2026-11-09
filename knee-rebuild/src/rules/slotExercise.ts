import type { Exercise, ReadingResult, SetLog, Side, Slot } from '../schema/index.ts'
import type { Pause } from './downPeriod.ts'
import { missingHere, routeSlot, type Available, type SlotRoute } from './equipment.ts'
import { exerciseHistory } from './gymLoads.ts'
import type { WorkoutRecord } from './history.ts'
import { backOffMoves, effectiveReading, type Placement } from './prescription.ts'

/*
 * Which exercise a slot runs, from its history (PROGRAM-QUESTIONS 49 and 55, Shawn's Nov 1 answer).
 * A back-off on bodyweight work moves the slot to its easier version, the next exercise on its list
 * (`prescribe` makes that move). From the next session on, the slot runs the easier version, which
 * progresses on its own readings, until it reads clean twice in a row; then the slot goes back to the
 * exercise it moved from, at that exercise's last session, and the back-off that moved it is served.
 * Cleans on the easier version from before the move count toward the two, as long as at least one of
 * them is since the move, so the back-off is always served at least once (Shawn's Nov 2 answer,
 * PROGRAM-QUESTIONS 84). A hold or a back-off on the easier version starts the count again. An
 * easier version that itself backs off to the one after it comes back to it the same way, one step
 * at a time.
 *
 * Readings are the exercise's, from every session that logged it (as `prescribe` reads them), so
 * "after" is by session: the records are in date order (`attachChecks`). The move itself is the
 * slot's: a slot is on its easier version only once that version has run on this slot since the
 * move, so a stair session in Session C never puts Session B's lateral step-down on the stair
 * before B has served its own back-off (PROGRAM-QUESTIONS 88).
 */

export interface SlotExerciseInput {
  slot: Slot
  /** The slot's own exercise, resolved. */
  own: Exercise
  /** The slot's substitutions, resolved, in the program's order. */
  substitutions: readonly Exercise[]
  /** Every workout before the session being planned, in date order. */
  records: readonly WorkoutRecord[]
  injuredSide: Side
  /**
   * The day being planned is inside a down period (Batch E, PROGRAM-QUESTIONS 182): a slot on its
   * easier version stays there after two cleans, and goes back once the period is over. Absent outside one.
   */
  pause?: Pause
}

export interface SlotExercise {
  /** The exercise the slot runs today. */
  exercise: Exercise
  /** Its combined readings, most recent first, from every session that logged it (a rack-capped session that read clean is left out). */
  readings: ReadingResult[]
  /** Its last sets, both sides, from the last session that wasn't rack-capped. */
  lastSets: SetLog[]
  /** Why, in words, when the history moved the slot; absent when it runs its own exercise as usual. */
  placement?: Placement
}

const happened = (r: WorkoutRecord) => r.workout.status === 'finished' || r.workout.status === 'abandoned'
const logs = (r: WorkoutRecord, exerciseId: string) => happened(r) && r.sets.some((s) => s.exerciseId === exerciseId)
/** Whether the record logged this exercise on this slot. */
const logsOn = (r: WorkoutRecord, slotId: string, exerciseId: string) => happened(r) && r.sets.some((s) => s.slotId === slotId && s.exerciseId === exerciseId)

function lastSessionOf(records: readonly WorkoutRecord[], exerciseId: string): number {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]
    if (record && logs(record, exerciseId)) return i
  }
  return -1
}

function historyOf(input: SlotExerciseInput, exercise: Exercise): { readings: ReadingResult[]; lastSets: SetLog[] } {
  return exerciseHistory(input.records, exercise.id, input.injuredSide)
}

/**
 * Where a back-off on this exercise moved the slot: the first exercise after it on the list that
 * this slot logged after the exercise's last session, when its standing reading is back-off and a
 * back-off on it moves the slot (not a load cut a swap happened to follow). Null when the slot
 * hasn't moved. Another slot running that exercise doesn't move this one (PROGRAM-QUESTIONS 88).
 */
function movedFrom(input: SlotExerciseInput, list: readonly Exercise[], exercise: Exercise): Exercise | null {
  const { readings, lastSets } = historyOf(input, exercise)
  if (effectiveReading(readings) !== 'back-off') return null
  if (!backOffMoves({ slot: input.slot, exercise, lastSets, injuredSide: input.injuredSide })) return null
  const at = lastSessionOf(input.records, exercise.id)
  const after = list.slice(list.findIndex((e) => e.id === exercise.id) + 1)
  return after.find((e) => input.records.some((r, i) => i > at && logsOn(r, input.slot.id, e.id))) ?? null
}

function leadingCleans(readings: readonly ReadingResult[]): number {
  const firstOther = readings.findIndex((r) => r !== 'clean')
  return firstOther === -1 ? readings.length : firstOther
}

/** Where the history has the slot: the exercise a back-off moved it from (null when it hasn't moved) and the one it is on. */
function walk(input: SlotExerciseInput): { from: Exercise | null; on: Exercise } {
  const list = [input.own, ...input.substitutions]
  let from: Exercise | null = null
  let on: Exercise = input.own
  // Each move goes forward on the list, so the walk ends within its length.
  for (let next = movedFrom(input, list, on); next !== null; next = movedFrom(input, list, on)) {
    from = on
    on = next
  }
  return { from, on }
}

/**
 * The slot on `on`, the easier version of `from`: back on `from` once `on` reads clean twice in a
 * row, otherwise on `on` with why. A clean from before the move counts toward the two only with
 * one since (Shawn's Nov 2 answer), so until `on` has run on this slot since the move (`ranSince`)
 * its cleans count as one at most and never bring the slot back alone.
 */
function placedOn(input: SlotExerciseInput, from: Exercise, on: Exercise, ranSince: boolean): SlotExercise {
  const easier = on.name
  const back = from.name
  const leading = leadingCleans(historyOf(input, on).readings)
  const cleans = ranSince ? leading : Math.min(leading, 1)
  if (cleans >= 2 && input.pause) {
    // Going back to the harder exercise is a step up: a down period holds it (PROGRAM-QUESTIONS 182).
    const note = `On ${easier} since ${back} backed off: clean twice, and the slot goes back to ${back} after the down period (until ${input.pause.untilWords}).`
    return { exercise: on, ...historyOf(input, on), placement: { note, returned: false } }
  }
  if (cleans >= 2) {
    return { exercise: from, ...historyOf(input, from), placement: { note: `Back on ${back}: ${easier} read clean twice.`, returned: true } }
  }
  const note =
    cleans === 1
      ? `On ${easier} since ${back} backed off: clean once; clean again and the slot goes back to ${back}.`
      : `On ${easier} since ${back} backed off; two clean readings in a row take the slot back to ${back}.`
  return { exercise: on, ...historyOf(input, on), placement: { note, returned: false } }
}

/** Which exercise the slot runs today and why, from its history (PROGRAM-QUESTIONS 55). */
export function slotExercise(input: SlotExerciseInput): SlotExercise {
  const { from, on } = walk(input)
  if (from === null) return { exercise: on, ...historyOf(input, on) }
  // The slot is on the easier version only once it has run on this slot since the move (`movedFrom`),
  // so the most recent clean is always one since the move: cleans from before it, or from another
  // slot, never serve the back-off alone.
  return placedOn(input, from, on, true)
}

/**
 * Which exercise a slot runs in the session being planned: a swap chosen for this session (the
 * slot's own exercise or one of its substitutions) beats the slot's history and reads its own
 * (`exerciseHistory`), with no placement; with nothing chosen, or a choice that isn't on the slot's
 * list, the history decides (`slotExercise`). PROGRAM-QUESTIONS 84: a Swap chosen for the session
 * still wins.
 */
export function sessionSlotExercise(input: SlotExerciseInput, chosenId: string | undefined): SlotExercise {
  const chosen = chosenId === undefined ? undefined : [input.own, ...input.substitutions].find((e) => e.id === chosenId)
  return chosen ? { exercise: chosen, ...historyOf(input, chosen) } : slotExercise(input)
}

export interface SlotAtGym extends SlotExercise {
  /**
   * What this gym does to the slot without a swap: `routeSlot` over the slot's list from where its
   * history put it (the slot's own exercise, or the easier version it is on; the program's own
   * easier version where this gym has it, `slotAtGym`) onward. `own`: that exercise runs here.
   * `moved`: it isn't here, and the first exercise after it that is runs, each one passed over with
   * what is missing. `none`: nothing from it on is here; it stays, so the runner can offer Skip or
   * Do it anyway. A swap chosen for the session doesn't change it.
   */
  route: SlotRoute
}

/**
 * Which exercise a slot runs in the session being planned at this gym (M4b, design section 4). A
 * swap chosen for the session wins, here or not (`sessionSlotExercise`). Otherwise the history
 * places the slot (`slotExercise`), and the gym routes it forward from there on [own,
 * ...substitutions]: the history's pick when it runs here; else the first exercise after it that
 * does, on that exercise's own history and with no placement, since the move is the gym's and
 * `route` says it; with nothing from the pick on here, the pick as the history placed it. The gym
 * never moves a slot back up its list past where its history put it, to an exercise harder than
 * the one a back-off moved it to (PROGRAM-QUESTIONS 86).
 *
 * One exception: on the easier version, an exercise between the one the slot moved from and the
 * history's pick that runs here comes first. The pick can only be past it because another gym
 * lacked it and its back-off passed over to the pick, and that pass-over was the other gym's move,
 * not the slot's: here the slot runs the program's easier version, placed on it, its cleans
 * counting once it has run since the move (PROGRAM-QUESTIONS 89).
 */
export function slotAtGym(input: SlotExerciseInput, chosenId: string | undefined, available: Available): SlotAtGym {
  const { from, on } = walk(input)
  const history = from === null ? { exercise: on, ...historyOf(input, on) } : placedOn(input, from, on, true)
  const list = [input.own, ...input.substitutions]
  const ids = list.map((e) => e.id)
  const byId = new Map(list.map((e) => [e.id, e]))
  const onEasier = from !== null && history.exercise.id === on.id
  const between = onEasier ? list.slice(ids.indexOf(from.id) + 1, ids.indexOf(on.id)) : []
  const easierHere = between.find((e) => missingHere(e, available).length === 0)
  const placed = from !== null && easierHere ? placedOn(input, from, easierHere, false) : history
  const at = ids.indexOf(placed.exercise.id)
  const route = routeSlot({ exerciseId: placed.exercise.id, substitutionIds: ids.slice(at + 1) }, byId, available)
  if (chosenId !== undefined && byId.has(chosenId)) return { ...sessionSlotExercise(input, chosenId), route }
  if (route.kind !== 'moved') return { ...placed, route }
  const moved = byId.get(route.exerciseId) ?? placed.exercise
  return { exercise: moved, ...historyOf(input, moved), route }
}
