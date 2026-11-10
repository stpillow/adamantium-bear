import { isAddedSlotId } from './addedSlots.ts'
import { prescribedSets } from './deload.ts'
import type { WindowSlot } from './fitWindow.ts'
import { isSwap, planTarget, weekMiles } from './mileage.ts'
import { loggedPain, type Draft } from './prefill.ts'
import { runsInWeek, type WeekMiles } from './weekPlan.ts'
import type { Exercise, IsoDate, MileageWeek, MorningCheck, RedFlag, RepUnit, Run, SetLog, SetSide, Side, Slot } from '../schema/index.ts'

/*
 * The program as written, for tester mode (M-U3; PROGRAM-QUESTIONS 226 to 230). Everything here
 * reads program.md's transcription, the calendar, or the tester's own logged numbers; nothing reads
 * a reading, a prescription, a gate or another session's pain. Tester mode's screens and planner use
 * these instead of the engine (src/rules/engineMode.guard.test.ts).
 */

export interface WrittenSide {
  side: SetSide
  sets: number
}

/**
 * The sides a slot logs and its written sets on each: one 'both' row on a two-sided slot, the
 * injured side alone when program.md writes it injured-only, the injured side then the other on a
 * unilateral slot. A deload week cuts the sets by a third, from the calendar only (`prescribedSets`,
 * PROGRAM-QUESTIONS 226).
 */
export function writtenSides(slot: Pick<Slot, 'sets' | 'unilateral' | 'injuredOnly'>, injuredSide: Side, week: number): WrittenSide[] {
  const sets = prescribedSets(slot.sets, week)
  if (slot.injuredOnly) return [{ side: injuredSide, sets }]
  if (!slot.unilateral) return [{ side: 'both', sets }]
  return [
    { side: injuredSide, sets },
    { side: injuredSide === 'left' ? 'right' : 'left', sets },
  ]
}

function newest(sets: readonly SetLog[]): SetLog | undefined {
  return [...sets].sort((a, b) => (a.loggedAt ?? '').localeCompare(b.loggedAt ?? '')).at(-1)
}

/**
 * A set's starting values in tester mode: the load the tester typed on this exercise and side
 * earlier this session, else 0 (typed, never suggested); the count likewise, else the written low
 * end in the unit the exercise counts (`slot` is the effective slot, so a swap to a timed exercise
 * starts in seconds); RPE unrated; pain from the previous set (per set) or what this exercise's sets
 * carry (per exercise); a step height, a range stop or a stage from the previous set, else the
 * written one. It reads only this session's sets of this slot.
 */
export function writtenDraft(input: {
  slot: Pick<Slot, 'repsMin' | 'heightIn' | 'rangeStopDeg'>
  exercise: Pick<Exercise, 'id' | 'stages'>
  side: SetSide
  slotSets: readonly SetLog[]
  painPerSet: boolean
}): Draft {
  const sameExercise = input.slotSets.filter((s) => s.exerciseId === input.exercise.id)
  const previous = newest(sameExercise.filter((s) => s.side === input.side))
  const heightIn = previous?.heightIn ?? input.slot.heightIn
  const rangeStopDeg = previous?.rangeStopDeg ?? input.slot.rangeStopDeg
  const stage = previous?.stage ?? (input.exercise.stages ? 0 : undefined)
  return {
    load: previous?.load ?? 0,
    count: previous ? (previous.seconds ?? previous.reps ?? input.slot.repsMin) : input.slot.repsMin,
    rpe: null,
    pain: input.painPerSet ? (previous?.painDuring ?? null) : loggedPain(sameExercise),
    ...(heightIn !== undefined ? { heightIn } : {}),
    ...(rangeStopDeg !== undefined ? { rangeStopDeg } : {}),
    ...(stage !== undefined ? { stage } : {}),
  }
}

/** A set can't be logged until a load is typed, on an exercise that takes one and isn't assisted (where 0 is the hardest). */
export function writtenLoadMissing(showsLoad: boolean, loadDirection: Exercise['loadDirection'], draft: Pick<Draft, 'load'>): boolean {
  return showsLoad && loadDirection !== 'down' && draft.load <= 0
}

/**
 * The week's miles against the plan's own number (tester mode): never capped, never held, read from
 * nothing but the plan and the runs logged. Outside the 12-week plan there is no number, said as the
 * plan says it.
 */
export function writtenWeekMiles(plan: readonly MileageWeek[], week: number, startDate: IsoDate, runs: readonly Run[]): WeekMiles {
  const own = runsInWeek(runs, startDate, week)
  const target = planTarget(plan, week)
  return {
    target: target === null ? { target: null, capped: false, reason: `week ${week} is outside the 12-week plan` } : { target, capped: false, reason: 'from the plan' },
    miles: weekMiles(own),
    sessions: own.length,
    swaps: own.filter(isSwap).length,
  }
}

/** The red flags a tester ticked on a check, in the catalog's words: their own note, read from nothing else (PROGRAM-QUESTIONS 228). */
export function ownFlagNote(check: Pick<MorningCheck, 'date' | 'redFlags'>, catalog: readonly Pick<RedFlag, 'id' | 'text'>[]): { date: IsoDate; items: string[] } | null {
  if (check.redFlags.length === 0) return null
  const byId = new Map(catalog.map((f) => [f.id, f.text]))
  return { date: check.date, items: check.redFlags.map((id) => byId.get(id) ?? id) }
}

/** What the time window needs of a written slot. */
export interface WrittenFitInput {
  slot: Pick<Slot, 'id' | 'groupId' | 'optional' | 'repsMax'>
  sides: readonly WrittenSide[]
  repUnit: RepUnit
  /** The gym runs it as it stands (its route is the slot's own exercise). */
  here: boolean
}

/**
 * The time window's slots for a written session (`fitToWindow`'s input): the written sets per side
 * at the top of the written range, the longest the session can run, with no warm-up sets and no
 * extra-time extensions (PROGRAM-QUESTIONS 226).
 */
export function writtenFitSlots(plans: readonly WrittenFitInput[], logged: ReadonlySet<string> = new Set()): WindowSlot[] {
  return plans.map((p) => ({
    slotId: p.slot.id,
    ...(p.slot.groupId ? { groupId: p.slot.groupId } : {}),
    added: isAddedSlotId(p.slot.id),
    extra: false,
    eligible: p.here,
    optional: p.slot.optional,
    logged: logged.has(p.slot.id),
    sides: p.sides.map((s) => ({ sets: s.sets, repsTarget: p.slot.repsMax, repUnit: p.repUnit })),
  }))
}
