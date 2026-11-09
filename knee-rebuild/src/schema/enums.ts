import { z } from 'zod'

/** The injured side and its opposite. */
export const Side = z.enum(['left', 'right'])
export type Side = z.infer<typeof Side>

/** Which side a set was logged for. `both` on bilateral slots. */
export const SetSide = z.enum(['left', 'right', 'both'])
export type SetSide = z.infer<typeof SetSide>

/**
 * Movement patterns from PROMPT section 3, plus `quad` (leg extension and wall sit are
 * knee-extension work, not a squat) and `cardio` (the optional elliptical finisher).
 */
export const Pattern = z.enum([
  'squat',
  'quad',
  'hinge',
  'single-leg',
  'hamstring',
  'hip',
  'calf',
  'balance',
  'plyo',
  'push',
  'pull',
  'core',
  'carry',
  'cardio',
])
export type Pattern = z.infer<typeof Pattern>

/**
 * How an exercise is loaded. PROMPT section 3's list plus `dumbbell-single` (goblet squats,
 * single-leg RDLs, suitcase carries hold one dumbbell) and `plates` (the 45° leg press is
 * plate-loaded, not a stack).
 */
export const LoadType = z.enum([
  'dumbbell-each',
  'dumbbell-single',
  'stack',
  'smith-plates',
  'plates',
  'bodyweight',
  'step-height',
  'band',
  'time',
])
export type LoadType = z.infer<typeof LoadType>

/** The unit a load is logged in. Stack machines are logged as the plate number on the pin. */
export const LoadUnit = z.enum(['lb', 'plate', 'in', 's', 'none'])
export type LoadUnit = z.infer<typeof LoadUnit>

/** What a slot's rep number counts. */
export const RepUnit = z.enum(['reps', 'seconds', 'minutes', 'yards', 'steps'])
export type RepUnit = z.infer<typeof RepUnit>

/**
 * PROMPT section 3's five rules plus `stage`: balance work has no load and progresses through
 * ordered stages (eyes open, eyes closed, folded mat, bosu).
 */
export const ProgressionRule = z.enum([
  'double-progression',
  'height-then-load',
  'range-then-load',
  'time',
  'fixed',
  'stage',
])
export type ProgressionRule = z.infer<typeof ProgressionRule>

export const SessionLetter = z.enum(['A', 'B', 'C'])
export type SessionLetter = z.infer<typeof SessionLetter>

export const RunType = z.enum(['mbr', 'easy', 'long', 'elliptical-swap', 'rower-swap'])
export type RunType = z.infer<typeof RunType>

export const Effort = z.enum(['easy', 'moderate', 'hard'])
export type Effort = z.infer<typeof Effort>

export const ReadingResult = z.enum(['clean', 'hold', 'back-off'])
export type ReadingResult = z.infer<typeof ReadingResult>

export const WorkoutStatus = z.enum(['planned', 'in-progress', 'finished', 'abandoned'])
export type WorkoutStatus = z.infer<typeof WorkoutStatus>

/**
 * The morning check's fixed tags (Batch D, Shawn's Nov 8 decision 10; PROGRAM-QUESTIONS 177): one
 * optional tap each for the day and night before the morning, none by default. Counted on the
 * phone against the readings, in plain counts on Progress, and read by no rule that decides
 * anything (src/rules/morningTags.guard.test.ts). The order here is the form's and the count's.
 */
export const MorningTag = z.enum(['poor-sleep', 'long-sitting', 'on-feet', 'brace', 'nsaid', 'new-shoes'])
export type MorningTag = z.infer<typeof MorningTag>
export const MORNING_TAGS: readonly MorningTag[] = MorningTag.options

/** What a day of the weekly template holds. */
export const DaySession = z.enum(['run:mbr', 'lift:A', 'run:easy', 'lift:B', 'run:long', 'lift:C', 'off'])
export type DaySession = z.infer<typeof DaySession>

/**
 * How a gate item is evaluated. `manual` items are toggles; the rest read logged data.
 * `acl-rsi` reads the latest stored ACL-RSI questionnaire entry against the item's `minScore`
 * (Batch A, PROGRAM-QUESTIONS 156): the one rule-level reader of the questionnaire is the gates
 * rule, pinned by src/rules/aclRsi.guard.test.ts.
 */
export const GateEvaluator = z.enum([
  'manual',
  'clean-weeks',
  'symmetry',
  'calf-raises',
  'no-swelling',
  'run-no-reaction',
  'no-swelling-after-plyo',
  'acl-rsi',
])
export type GateEvaluator = z.infer<typeof GateEvaluator>

/**
 * The time zone dates are counted in when the user has stored none (M-U1, PROGRAM-QUESTIONS 203):
 * Shawn's, so a phone set up before the setting existed computes exactly the dates it did.
 */
export const DEFAULT_TIME_ZONE = 'America/New_York'

/**
 * An IANA time zone name by its shape alone ("America/Los_Angeles", "UTC", "Etc/GMT+5"): what a
 * stored row and a backup file may hold. Whether this phone's time zone data knows the name is
 * asked at use (`isKnownTimeZone`), never here, so a file from a phone with newer zone data
 * ("Europe/Kyiv" on an older iOS) still imports, and the phone keeps its own zone instead
 * (PROGRAM-QUESTIONS 204, 206).
 */
export const TimeZone = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/, 'expected a time zone name like America/New_York')
export type TimeZone = z.infer<typeof TimeZone>

/**
 * Whether this phone's time zone data knows a zone: constructing a formatter for it succeeds. Not
 * membership in the phone's list of zones, which leaves out UTC and the old aliases a phone may
 * still report (PROGRAM-QUESTIONS 204).
 */
export function isKnownTimeZone(zone: string): boolean {
  if (!TimeZone.safeParse(zone).success) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** A time zone this phone knows: what Settings and first run save. */
export const KnownTimeZone = TimeZone.refine(isKnownTimeZone, 'not a time zone this phone knows')

/** Calendar date in the user's time zone (New York by default; M-U1), as YYYY-MM-DD, and a real date on the calendar. */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((text) => {
    const [y, m, d] = text.split('-').map(Number)
    if (y === undefined || m === undefined || d === undefined) return false
    const date = new Date(Date.UTC(y, m - 1, d))
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  }, 'not a real calendar date')
export type IsoDate = z.infer<typeof IsoDate>

/** Instant, as an ISO 8601 timestamp with an offset. */
export const IsoDateTime = z.iso.datetime({ offset: true })
export type IsoDateTime = z.infer<typeof IsoDateTime>

/** Why a set was stopped early. Sharp joint-line pain reads back-off on its own (PROMPT rule 1). */
export const StopReason = z.enum(['sharp-joint-line-pain', 'pain', 'form', 'fatigue', 'equipment', 'time', 'other'])
export type StopReason = z.infer<typeof StopReason>

/** Days of the week, Monday first. */
export const Day = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
export type Day = z.infer<typeof Day>

export const Pain = z.number().int().min(0).max(10)
export const Rpe = z.number().min(1).max(10)
/** RPE as a whole number, 1 to 10: a run's and a whole session's (metrics phase 1). A set's RPE keeps its decimals (`Rpe`). */
export const WholeRpe = z.number().int().min(1).max(10)
