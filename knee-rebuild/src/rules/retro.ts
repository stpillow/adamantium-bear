import type { IsoDate, SessionLetter, SessionTemplate, Workout } from '../schema/index.ts'
import { addDays, dateOf, daysBetween, isDeloadWeek, weekOf } from './calendar.ts'

/*
 * Logging after the fact (Shawn, Nov 6): a run or a strength session done on an earlier day, entered
 * later. Readings are recomputed from the whole log, so a late entry is read like any other: a session
 * with no morning check the day after reads hold (unknown is hold), and it can change a reading or a
 * week's mileage cap already shown (PROGRAM-QUESTIONS 141). The window keeps that bounded. Since
 * Batch D (Shawn's Nov 8 decision 12) that morning's check can be logged late too, inside the same
 * window (lateCheck.ts; PROGRAM-QUESTIONS 174), so such a session reads hold only until it is.
 */

/** How far back a late entry can go. */
export const RETRO_DAYS = 14

/**
 * The days before today a late entry can be dated, oldest first: the last RETRO_DAYS, never before the
 * program starts, and, when `fromWeek` is given, never before that program week's Monday (a strength
 * session can't be dated before the current phase began: no phase history is stored to say which
 * phase's session it was).
 */
export function retroDates(today: IsoDate, startDate: IsoDate, fromWeek: number = 1): IsoDate[] {
  const floors = [addDays(today, -RETRO_DAYS), startDate, dateOf(startDate, Math.max(1, fromWeek), 'mon')]
  const earliest = floors.reduce((a, b) => (a > b ? a : b))
  const yesterday = addDays(today, -1)
  if (earliest > yesterday) return []
  return Array.from({ length: daysBetween(earliest, yesterday) + 1 }, (_, i) => addDays(earliest, i))
}

/**
 * A late session's start stamp: noon in New York on its date (17:00 UTC; 16:00 in summer time reads
 * the same day). Stamped so a day's sessions sort the same every time, and so the runner can tell a
 * session entered late from one started live and left open (`isLateEntry`), without a new field on the
 * strict Workout schema.
 */
export function lateStartedAt(date: IsoDate): string {
  return `${date}T17:00:00.000Z`
}

export function isLateEntry(workout: Pick<Workout, 'date' | 'startedAt'>): boolean {
  return workout.startedAt === lateStartedAt(workout.date)
}

/** A workout id for the day and template, `-2`, `-3` on a taken one (the ids Today makes). */
function freeId(date: IsoDate, templateId: string, taken: readonly string[]): string {
  const base = `${date}-${templateId}`
  if (!taken.includes(base)) return base
  let n = 2
  while (taken.includes(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

export interface LateLiftInput {
  date: IsoDate
  today: IsoDate
  startDate: IsoDate
  /** The current phase and the program week it was entered (Settings). */
  currentPhase: number
  phaseEnteredWeek: number
  /** The lift the schedule (with its moves) puts on `date`, or null for a day without one. */
  letter: SessionLetter | null
  templates: readonly SessionTemplate[]
  workouts: readonly Pick<Workout, 'id' | 'date' | 'templateId' | 'status'>[]
  locationId: string
}

export type LateLift = { ok: true; workout: Workout } | { ok: false; reason: string }

/**
 * A strength session entered for an earlier day, or why it can't be: the day must be in the window
 * (`retroDates` from the current phase's week), hold a lift, and have no session of that letter
 * already started, finished or left early. Week and deload come from the date; the phase is the
 * current one, which the window guarantees was in force that day.
 */
export function lateLift(input: LateLiftInput): LateLift {
  const { date, today, startDate, currentPhase, phaseEnteredWeek, letter, templates, workouts } = input
  if (date >= today) return { ok: false, reason: 'Today’s session starts from Today.' }
  if (!retroDates(today, startDate, phaseEnteredWeek).includes(date)) {
    return { ok: false, reason: `Only the last ${RETRO_DAYS} days of this phase can be logged after the fact.` }
  }
  if (letter === null) return { ok: false, reason: 'No lift is scheduled that day.' }
  const template = templates.find((t) => t.phase === currentPhase && t.letter === letter)
  if (!template) return { ok: false, reason: `No Session ${letter} is written for phase ${currentPhase}.` }
  const letterOf = (templateId: string) => templates.find((t) => t.id === templateId)?.letter
  const already = workouts.find((w) => w.date === date && w.status !== 'planned' && letterOf(w.templateId) === letter)
  if (already) return { ok: false, reason: `Session ${letter} is already logged for that day.` }
  const week = weekOf(date, startDate)
  return {
    ok: true,
    workout: {
      id: freeId(date, template.id, workouts.map((w) => w.id)),
      date,
      templateId: template.id,
      phase: currentPhase,
      week,
      isDeload: isDeloadWeek(week),
      startedAt: lateStartedAt(date),
      status: 'in-progress',
      locationId: input.locationId,
    },
  }
}
