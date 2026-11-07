import { minutesPreset, trainingLoadOf, workoutRpe, type LoggedWork, type MinutesPreset } from '../../rules/trainingLoad.ts'
import type { Workout } from '../../schema/index.ts'
import { trainingLoadNumber } from '../Progress.helpers.ts'

/*
 * Words and presets for the session's RPE and minutes on Finish, End and the Summary (metrics phase
 * 1). The numbers come from src/rules/trainingLoad.ts; this file says them.
 */

/** A logged set as the minutes stepper and the RPE fallback read it (`timedSets`). */
export interface TimedSet extends LoggedWork {
  loggedAt?: string
  rpe?: number
}

/** What the stepper's preset is worked out from. */
export interface SessionTiming {
  workout: Pick<Workout, 'date' | 'startedAt'>
  sets: readonly TimedSet[]
  restSeconds: number
  warmUpMinutes: number
}

/** The minutes the stepper opens on: the clock when it can be trusted, else the estimate. */
export function minutesOpening(timing: SessionTiming): MinutesPreset {
  return minutesPreset(timing)
}

const ESTIMATE_PARTS = 'It counts the sets logged, a rest after each and the warm-up; set it to what the session took.'

/** The line under the minutes stepper: how the preset was read, and an estimate labelled one. */
export function minutesNote(preset: MinutesPreset, late: boolean): string {
  if (preset.source === 'clock') return `${preset.minutes} min by the clock: from Start to the last set and one rest, with long waits left out. Change it if that’s off.`
  return late
    ? `An estimate: entered after the day, so the clock can’t say. ${ESTIMATE_PARTS}`
    : `An estimate: the clock reads under a minute or over 3 hours, which can’t be this session. ${ESTIMATE_PARTS}`
}

/** The session RPE scale's anchors, in words beside the picker. */
export const SESSION_RPE_ANCHORS = '1–3 easy, 4–6 moderate, 7–10 hard, for the whole session (a set’s RPE is reps in reserve).'

/** The line under the session RPE picker: what training load reads while it is unrated. Only a tap stores a rating. */
export function sessionRpeNote(rated: number | null, sets: readonly Pick<TimedSet, 'rpe'>[]): string {
  if (rated !== null) return `Rated ${rated} for the whole session.`
  const fallback = workoutRpe({}, sets)
  return fallback
    ? `Not rated: training load reads the sets’ average, RPE ${fallback.rpe}, until you rate it.`
    : 'Not rated, and no set has an RPE: this session’s training load stays unknown until it is rated, here or from its summary.'
}

/**
 * The Summary's line: "Session RPE 7 · 48 min · training load 336."
 * Deliberately no HR load in metrics phase 2: only Run gained heart-rate fields, Workout did not,
 * so a lift's Summary has no HR to read. If Shawn wants HR on lift summaries, Workout needs the
 * fields too — a scope change, flagged in the phase 2 PR, not quietly built.
 */
export function sessionEffortLine(workout: Pick<Workout, 'sessionRpe' | 'durationMinutes'>, sets: readonly Pick<TimedSet, 'rpe'>[]): string {
  const rated = workoutRpe(workout, sets)
  const rpe = rated === null ? 'No RPE' : rated.source === 'session' ? `Session RPE ${rated.rpe}` : `RPE ${rated.rpe}, the sets’ average`
  const minutes = workout.durationMinutes === undefined ? 'no minutes' : `${workout.durationMinutes} min`
  const load = trainingLoadOf(rated?.rpe ?? null, workout.durationMinutes ?? null)
  return `${rpe} · ${minutes} · training load ${load === null ? 'not counted' : trainingLoadNumber(load)}.`
}

/** The Summary offers Add effort and minutes while the session's RPE or its minutes is not stored. */
export function needsEffortOrMinutes(workout: Pick<Workout, 'sessionRpe' | 'durationMinutes'>): boolean {
  return workout.sessionRpe === undefined || workout.durationMinutes === undefined
}
