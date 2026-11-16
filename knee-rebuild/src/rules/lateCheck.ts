import type { IsoDate, MorningCheck, ReadingResult, Run, SetLog, Side, Workout } from '../schema/index.ts'
import { addDays } from './calendar.ts'
import { attachChecks, subjectReadings } from './history.ts'
import { morningCheckApplies } from './reading.ts'
import { retroDates } from './retro.ts'
import { kneeMorning } from './wholeKnee.ts'

/*
 * A morning check for a past day (Batch D, Shawn's Nov 8 decision 12; PROGRAM-QUESTIONS 174 to
 * 176). A session logged after the fact read hold for good, since no morning check existed for the
 * morning after it. Now that morning's check can be added, within the same 14 days a late session
 * may be dated (RETRO_DAYS), dated the morning it describes and marked by a stored `loggedOn`: the
 * day it was saved. "Late" is stored, not worked out on reading: every check saved on time is also
 * dated before today by the time anyone reads it.
 *
 * A late check reads exactly as the same check saved that morning (morningReading, rule 3's date
 * rule, kneeMorning): nothing here makes a reading more permissive. The one difference is rule 9's
 * takeover, which only a check for today drives (redFlags.ts). The gates are stricter still until
 * Shawn answers: a clean late check satisfies no gate auto-item, while a late complaint still fails
 * one (gates.ts, PROGRAM-QUESTIONS 176).
 */

/** Whether a check was logged late, for a past morning: only the late flow writes `loggedOn`. */
export function isLateCheck(check: Pick<MorningCheck, 'loggedOn'>): boolean {
  return check.loggedOn !== undefined
}

/**
 * The checks the gates read their sessions with: the on-time ones. Until Shawn answers
 * PROGRAM-QUESTIONS 176, a session cleared only by a late check reads as if no check came (hold),
 * so a clean late check passes no gate item; a late complaint still reads through the gates'
 * own check items, and a session it alone covers reads hold, which fails clean weeks anyway.
 */
export function onTimeChecks<T extends Pick<MorningCheck, 'loggedOn'>>(checks: readonly T[]): T[] {
  return checks.filter((c) => !isLateCheck(c))
}

/** Why a late check can't be offered for a session day, for the screen to say in words. */
export type LateCheckRefusal =
  /** The morning after is today: this morning's on-time check covers it, takeover and all. */
  | { kind: 'morning-is-today' }
  /** The morning after hasn't come yet. */
  | { kind: 'morning-ahead' }
  /** The session day is outside the last RETRO_DAYS, or before the program started. */
  | { kind: 'outside-window' }
  /** No finished or ended lift and no run on the session day. */
  | { kind: 'nothing-logged' }
  /** A check is already saved for that morning; it stays as it is. */
  | { kind: 'check-exists'; morning: IsoDate }
  /** Every session that day already has a check that applies to it (an explicit link). */
  | { kind: 'all-covered' }

export type LateCheckOffer = { ok: true; morning: IsoDate; sessionDay: IsoDate } | { ok: false; refusal: LateCheckRefusal }

/** Sessions that happened on a day: lifts finished or ended early (the ones a reading reads; history.ts), and runs. */
function sessionsOn(day: IsoDate, workouts: readonly Pick<Workout, 'id' | 'date' | 'status'>[], runs: readonly Pick<Run, 'id' | 'date'>[]) {
  const lifts = workouts.filter((w) => w.date === day && (w.status === 'finished' || w.status === 'abandoned')).map((w) => ({ kind: 'workout' as const, id: w.id, date: w.date }))
  const dayRuns = runs.filter((r) => r.date === day).map((r) => ({ kind: 'run' as const, id: r.id, date: r.date }))
  return [...lifts, ...dayRuns]
}

/**
 * Whether the morning after `sessionDay` can take a check logged late, in this order: the morning
 * must be before today (yesterday's session goes to this morning's on-time check, which keeps the
 * takeover); the session day must be one a late entry may be dated (`retroDates`, with no phase
 * floor: a run qualifies); a lift finished or ended, or a run, must be logged that day (an open lift
 * completes no reading, so a check for it would spend that morning's one slot on nothing); no check
 * may already be dated that morning (looked up by date, not id: an imported `mc-…-run` row counts),
 * since a saved check is never overwritten; and some session that day must still lack a check.
 */
export function lateCheckFor(input: {
  sessionDay: IsoDate
  today: IsoDate
  startDate: IsoDate
  workouts: readonly Pick<Workout, 'id' | 'date' | 'status'>[]
  runs: readonly Pick<Run, 'id' | 'date'>[]
  checks: readonly MorningCheck[]
}): LateCheckOffer {
  const { sessionDay, today, startDate, workouts, runs, checks } = input
  const morning = addDays(sessionDay, 1)
  if (morning === today) return { ok: false, refusal: { kind: 'morning-is-today' } }
  if (morning > today) return { ok: false, refusal: { kind: 'morning-ahead' } }
  if (!retroDates(today, startDate).includes(sessionDay)) return { ok: false, refusal: { kind: 'outside-window' } }
  const sessions = sessionsOn(sessionDay, workouts, runs)
  if (sessions.length === 0) return { ok: false, refusal: { kind: 'nothing-logged' } }
  if (checks.some((c) => c.date === morning)) return { ok: false, refusal: { kind: 'check-exists', morning } }
  if (sessions.every((s) => checks.some((c) => morningCheckApplies(c, s)))) return { ok: false, refusal: { kind: 'all-covered' } }
  return { ok: true, morning, sessionDay }
}

/** A reading a late check changed. */
export interface ReadingChange {
  kind: 'workout' | 'run'
  id: string
  date: IsoDate
  from: ReadingResult
  to: ReadingResult
}

/** A lift whose whole-knee back-off (wholeKnee.ts) the late check turned on or off. */
export interface LiftChange {
  date: IsoDate
  /** The back-off morning before and after the save; null for none. */
  from: IsoDate | null
  to: IsoDate | null
}

export interface LateCheckReach {
  readings: ReadingChange[]
  lifts: LiftChange[]
}

/**
 * What a check logged late changed, so its result can say so in words (PROGRAM-QUESTIONS 176): every
 * session reading that moved (rule 3 reads the late check like any other), and, for each lift date
 * given (the open one, the next one), whether its lower-body work now plans at whole-knee back-off
 * loads or no longer does. Readings are computed, never stored: this compares the history without
 * the check against the history with it.
 */
export function lateCheckReach(input: {
  workouts: readonly Workout[]
  setLogs: readonly SetLog[]
  runs: readonly Run[]
  before: readonly MorningCheck[]
  after: readonly MorningCheck[]
  injuredSide: Side
  liftDates: readonly IsoDate[]
}): LateCheckReach {
  const { workouts, setLogs, runs, before, after, injuredSide } = input
  const read = (checks: readonly MorningCheck[]) => subjectReadings(attachChecks(workouts, setLogs, checks), runs, checks, injuredSide)
  const was = new Map(read(before).map((r) => [`${r.kind}:${r.id}`, r.result]))
  const readings = read(after)
    .map((r) => ({ kind: r.kind, id: r.id, date: r.date, from: was.get(`${r.kind}:${r.id}`), to: r.result }))
    .filter((r): r is ReadingChange => r.from !== undefined && r.from !== r.to)
  const lifts = Array.from(new Set(input.liftDates))
    .sort()
    .map((date) => ({ date, from: kneeMorning(before, workouts, date)?.date ?? null, to: kneeMorning(after, workouts, date)?.date ?? null }))
    .filter((l) => l.from !== l.to)
  return { readings, lifts }
}
