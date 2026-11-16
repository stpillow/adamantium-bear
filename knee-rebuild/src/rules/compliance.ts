import type { SetLog, Settings, Slot, Workout } from '../schema/index.ts'
import { deloadSets } from './deload.ts'
import { isExtraSlotId } from './extensions.ts'
import { phaseWeekOf, slotRunsInPhaseWeek } from './session.ts'

/*
 * Sets-based session compliance (Batch B, PROGRAM-QUESTIONS 163): the Summary's "7 of 9 prescribed
 * sets of the 3 exercises run". Display only: nothing reads it back, nothing is stored.
 *
 * The denominator is the exercises that RAN, read as the slots that logged at least one set. Which
 * slots the time window kept, which were skipped because nothing at the gym runs them, and Do it
 * anyway are not durable: they live in the browser's key-value store under SWAP_KEY_PREFIX
 * (src/db/repo.ts). Finish and End clear the swap and anyway keys; the minutes window survives
 * until a discard, but replaying the fit from it would also replay the gym routing against the
 * gym's marks as they are now, not as they were, and workout ids repeat after a reset. Storing the
 * result would let a slot simply not done count against the session, as the Nov 8 decision asked;
 * that is a storage change, which Batch B rules out, so it is left as a note (PROGRAM-QUESTIONS 163)
 * and an exercise with no logged set is out of the count, and the Summary says so in words.
 *
 * Per slot the prescription is the slot's sets, deload-aware on the workout's stored flag (the
 * record of what the engine prescribed that day), times its sides: 2 on a unilateral slot, 1 on an
 * injured-only or two-legged one. It does not replay a back-off day's fewer sets: that needs the
 * gym and the readings as they were (PROGRAM-QUESTIONS 163 names the trade-off).
 */

export type ComplianceSlot = Pick<Slot, 'id' | 'sets' | 'unilateral' | 'injuredOnly' | 'optional'> & Partial<Pick<Slot, 'phaseWeeks'>>

export interface SessionCompliance {
  /** The prescribed sets of the exercises that ran (extensions for spare time excluded). */
  prescribed: number
  /** Of those, how many were logged, each slot capped at its prescription. */
  logged: number
  /** Sets past a slot's prescription, plus every set of an exercise added for spare time: never "prescribed". */
  extra: number
  /** How many prescribed exercises (slots) ran. */
  exercises: number
  /** How many of them have a set stopped early. */
  stopped: number
  /** A slot the session runs this week, not optional, logged nothing: it is out of the count, and the Summary says so. */
  excluded: boolean
}

const sidesOf = (slot: ComplianceSlot) => (slot.unilateral && !slot.injuredOnly ? 2 : 1)

/**
 * The prescribed sets of the slots that logged a set, against the sets logged. `slots` is the
 * session as the Summary names it (the template, Shawn's added slots, the spare-time pool);
 * `phaseWeek` is the week of the phase the session fell in, or null when that can't be said (an
 * older phase's session), in which case a week-banded slot never sets off the note.
 */
export function sessionCompliance(input: {
  slots: readonly ComplianceSlot[]
  workout: Pick<Workout, 'isDeload'>
  sets: readonly Pick<SetLog, 'slotId' | 'stopped'>[]
  phaseWeek: number | null
}): SessionCompliance {
  const result: SessionCompliance = { prescribed: 0, logged: 0, extra: 0, exercises: 0, stopped: 0, excluded: false }
  for (const slot of input.slots) {
    const own = input.sets.filter((s) => s.slotId === slot.id)
    if (isExtraSlotId(slot.id)) {
      result.extra += own.length
      continue
    }
    if (own.length === 0) continue
    const prescribed = (input.workout.isDeload ? deloadSets(slot.sets) : slot.sets) * sidesOf(slot)
    result.prescribed += prescribed
    result.logged += Math.min(own.length, prescribed)
    result.extra += Math.max(0, own.length - prescribed)
    result.exercises += 1
    if (own.some((s) => s.stopped)) result.stopped += 1
  }
  result.excluded = runsThisWeek(input.slots, input.phaseWeek).some((slot) => !slot.optional && !isExtraSlotId(slot.id) && !input.sets.some((s) => s.slotId === slot.id))
  return result
}

/** The slots the session runs this week of the phase; with the phase week unknown, only the unbanded ones. */
function runsThisWeek(slots: readonly ComplianceSlot[], phaseWeek: number | null): ComplianceSlot[] {
  return slots.filter((slot) => (phaseWeek === null ? !slot.phaseWeeks : slotRunsInPhaseWeek(slot, phaseWeek)))
}

/**
 * The week of its phase a stored session fell in, as far as the Settings say: counted from the week
 * the current phase was entered, so only for a session of the current phase, from that week on.
 * Null otherwise (an older phase's session, or one before the entry week): the phase-week bands
 * can't be said, and a banded slot never sets off the note. Settings can change after the day, so
 * this is a reconstruction, good enough for a note (PROGRAM-QUESTIONS 163).
 */
export function sessionPhaseWeek(workout: Pick<Workout, 'phase' | 'week'>, settings: Pick<Settings, 'currentPhase' | 'phaseEnteredWeek'>): number | null {
  if (workout.phase !== settings.currentPhase || workout.week < settings.phaseEnteredWeek) return null
  return phaseWeekOf(workout.week, settings.phaseEnteredWeek)
}
