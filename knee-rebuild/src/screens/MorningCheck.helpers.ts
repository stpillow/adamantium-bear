import type { SlotPlan } from '../app/session.ts'
import type { History } from '../db/repo.ts'
import { addDays, dayOf, nextLiftDate, weekOf } from '../rules/calendar.ts'
import { lateCheckFor, type LateCheckReach, type LateCheckRefusal } from '../rules/lateCheck.ts'
import { afterMorningCheck, type LateFlagNote } from '../rules/redFlags.ts'
import { RETRO_DAYS } from '../rules/retro.ts'
import { MORNING_TAGS, type Day, type IsoDate, type MorningCheck, type MorningTag, type ReadingResult, type RedFlag, type Run, type RunType, type SessionMove, type SessionTemplate, type SetSide, type Settings, type Side, type WeeklyTemplate, type Workout } from '../schema/index.ts'

/**
 * Pure helpers for the Morning check screen: words for dates and sessions, the form's state,
 * the check record it saves, and the grouping of the engine's notes. Nothing here decides anything
 * about the knee; readings and prescriptions come from src/rules through the screen.
 */

const DAY_WORDS: Record<Day, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}

const MONTH_WORDS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** A YYYY-MM-DD date in words, "Tuesday Nov 3", with no clock or time zone involved. */
export function dateWords(date: IsoDate): string {
  const [, month, day] = date.split('-').map(Number)
  const monthWord = month === undefined ? '' : (MONTH_WORDS[month - 1] ?? '')
  return `${DAY_WORDS[dayOf(date)]} ${monthWord} ${day ?? ''}`.replace(/\s+/g, ' ').trim()
}

/** What a morning check is about: yesterday's lift or run. */
export type CheckSubject = { kind: 'workout'; workout: Workout } | { kind: 'run'; run: Run }

/** When a workout began, as a number for sorting; a workout with no instants sorts first. */
function startedInstant(workout: Workout): number {
  const text = workout.startedAt ?? workout.finishedAt
  if (text === undefined) return Number.NEGATIVE_INFINITY
  const instant = Date.parse(text)
  return Number.isNaN(instant) ? Number.NEGATIVE_INFINITY : instant
}

/**
 * The most recent workout or run dated `date`, else null. Workouts that were never started
 * (`planned`) did not happen, so they are skipped. Workouts carry instants and runs do not, so
 * when both share the day the latest-started workout is taken: its reading drives the next lift's
 * prescriptions, which is this screen's job. Among runs the last stored one is taken.
 */
export function subjectFor(workouts: readonly Workout[], runs: readonly Run[], date: IsoDate): CheckSubject | null {
  const happened = workouts.filter((w) => w.date === date && w.status !== 'planned')
  const latest = [...happened].sort((a, b) => startedInstant(b) - startedInstant(a))[0]
  if (latest) return { kind: 'workout', workout: latest }
  const run = runs.filter((r) => r.date === date).at(-1)
  return run ? { kind: 'run', run } : null
}

/** The explicit link stored on the check (PROMPT section 3: workoutId or runId). */
export function appliesTo(subject: CheckSubject | null): MorningCheck['appliesTo'] {
  if (!subject) return null
  return subject.kind === 'workout' ? { kind: 'workout', id: subject.workout.id } : { kind: 'run', id: subject.run.id }
}

/** "Session A" from a template id, or the id itself when the template is not in the program. */
export function sessionName(templateId: string, templates: readonly Pick<SessionTemplate, 'id' | 'letter'>[]): string {
  const template = templates.find((t) => t.id === templateId)
  return template ? `Session ${template.letter}` : templateId
}

const RUN_WORDS: Record<RunType, string> = {
  mbr: 'MBR run',
  easy: 'easy run',
  long: 'long run',
  'elliptical-swap': 'elliptical swap',
  'rower-swap': 'rower swap',
}

export function runWords(type: RunType): string {
  return RUN_WORDS[type]
}

const STATUS_WORDS: Partial<Record<Workout['status'], string>> = {
  abandoned: ' (stopped early)',
  'in-progress': ' (never finished)',
}

/** One sentence saying which session the check is for, with yesterday's date in words. */
export function subjectWords(subject: CheckSubject | null, yesterday: IsoDate, templates: readonly Pick<SessionTemplate, 'id' | 'letter'>[]): string {
  const when = dateWords(yesterday)
  if (!subject) return `No session was logged for yesterday, ${when}. This check stands on its own.`
  if (subject.kind === 'run') return `For yesterday's ${runWords(subject.run.type)}, ${when}.`
  const status = STATUS_WORDS[subject.workout.status] ?? ''
  return `For yesterday's ${sessionName(subject.workout.templateId, templates)}${status}, ${when}.`
}

/** The form's state: the four taps, the pain change, the ticked flags, the tags and the note. */
export interface CheckForm {
  stiffnessUnder30Min: boolean
  worseThanYesterday: boolean
  visibleSwelling: boolean
  warmth: boolean
  painChangePoints: number
  redFlags: string[]
  /** The fixed tags ticked (Batch D): none by default. */
  tags: string[]
  notes: string
}

/** Everything off: an untouched save reads hold, never clean (unknown is not clean). No tag is ticked. */
export function emptyForm(): CheckForm {
  return { stiffnessUnder30Min: false, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [], tags: [], notes: '' }
}

/**
 * Each fixed tag's words on the form (Batch D, PROGRAM-QUESTIONS 177): what the day and night before
 * held, in Shawn's words. They change no reading; Progress counts them.
 */
export const TAG_LABELS: Record<MorningTag, string> = {
  'poor-sleep': 'Slept badly',
  'long-sitting': 'Sat or drove for hours',
  'on-feet': 'On my feet most of the day',
  brace: 'Wore the brace',
  nsaid: 'Took an anti-inflammatory (ibuprofen, naproxen)',
  'new-shoes': 'New shoes',
}

/** The tag section's label: the day and night the tags describe. */
export function tagSectionLabel(late: boolean): string {
  return late ? 'The day before and that night' : 'Yesterday and last night'
}

export const TAG_INTRO = 'Optional. Tap any that fit; none is fine. Tags change no reading.'

/** The form prefilled from a check already saved this morning, so a second save amends it. */
export function formFromCheck(check: MorningCheck): CheckForm {
  return {
    stiffnessUnder30Min: check.stiffnessUnder30Min,
    worseThanYesterday: check.worseThanYesterday,
    visibleSwelling: check.visibleSwelling,
    warmth: check.warmth,
    painChangePoints: check.painChangePoints,
    redFlags: [...check.redFlags],
    tags: [...(check.tags ?? [])],
    notes: check.notes ?? '',
  }
}

/** Ticks or unticks one entry of a list (a red flag, a tag), leaving the others. */
export function toggleFlag(flags: readonly string[], id: string): string[] {
  return flags.includes(id) ? flags.filter((f) => f !== id) : [...flags, id]
}

export const PAIN_CHANGE_MIN = -10
export const PAIN_CHANGE_MAX = 10

/** One check per morning: the id is the date, so saving twice replaces instead of duplicating. */
export function checkId(date: IsoDate): string {
  return `mc-${date}`
}

/** The record for a morning: flags in the program's order, tags in the form's (unknown ids dropped, none left off), a blank note left off. */
function recordFor(date: IsoDate, link: MorningCheck['appliesTo'], form: CheckForm, catalog: readonly RedFlag[]): MorningCheck {
  const notes = form.notes.trim()
  const tags = MORNING_TAGS.filter((tag) => form.tags.includes(tag))
  return {
    id: checkId(date),
    date,
    appliesTo: link,
    stiffnessUnder30Min: form.stiffnessUnder30Min,
    worseThanYesterday: form.worseThanYesterday,
    visibleSwelling: form.visibleSwelling,
    warmth: form.warmth,
    painChangePoints: form.painChangePoints,
    redFlags: catalog.map((f) => f.id).filter((id) => form.redFlags.includes(id)),
    ...(notes.length > 0 ? { notes } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  }
}

/** This morning's record to save. Flags are stored in the program's order; a blank note is left off. */
export function buildCheck(input: { today: IsoDate; link: MorningCheck['appliesTo']; form: CheckForm; catalog: readonly RedFlag[] }): MorningCheck {
  return recordFor(input.today, input.link, input.form, input.catalog)
}

/**
 * A past morning's record (Batch D): dated the morning it describes, keyed on that date like any
 * check, and marked with the day it was saved, `today`. Only for a morning before today; the
 * schema refuses anything else.
 */
export function buildLateCheck(input: { morning: IsoDate; today: IsoDate; link: MorningCheck['appliesTo']; form: CheckForm; catalog: readonly RedFlag[] }): MorningCheck {
  return { ...recordFor(input.morning, input.link, input.form, input.catalog), loggedOn: input.today }
}

/**
 * The settings after the check: unchanged (the same object) unless the red-flag state changed (rule
 * 9). A check logged late never changes it (afterMorningCheck), so it returns `settings` itself.
 */
export function settingsAfter(settings: Settings, check: MorningCheck): Settings {
  const next = afterMorningCheck(settings.redFlag, check)
  return next === settings.redFlag ? settings : { ...settings, redFlag: next }
}

/** The history with the check in it, replacing an earlier save with the same id. */
export function withCheck(history: History, check: MorningCheck): History {
  return { ...history, morningChecks: [...history.morningChecks.filter((c) => c.id !== check.id), check] }
}

/** The program week a session comes round again: a week after its date, from the current start date (it may have been edited since). */
/**
 * The template the next session of this letter will use: the current phase's, once a gate has
 * advanced the phase since yesterday's session; the session's own when that phase has none.
 */
export function nextTemplateFor(templateId: string, templates: readonly Pick<SessionTemplate, 'id' | 'phase' | 'letter'>[], currentPhase: number): string | null {
  const own = templates.find((t) => t.id === templateId)
  if (!own) return null
  return (templates.find((t) => t.phase === currentPhase && t.letter === own.letter) ?? own).id
}

export function nextWeekFor(workout: Pick<Workout, 'date'>, startDate: IsoDate): number {
  return Math.max(1, weekOf(addDays(workout.date, 7), startDate))
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

export function sideWords(side: SetSide, injuredSide: Side): string {
  if (side === 'both') return 'Both'
  return side === injuredSide ? `${capitalise(side)} (injured)` : capitalise(side)
}

export interface ExerciseSentence {
  slotId: string
  name: string
  optional: boolean
  /** One sentence, or one per side when the engine's notes differ between sides. */
  lines: string[]
}

/** One sentence per exercise of what changes next time, from each prescription's note. */
export function exerciseSentences(plans: readonly SlotPlan[], injuredSide: Side): ExerciseSentence[] {
  return plans.map((plan) => {
    const [first, ...rest] = plan.prescriptions
    let lines: string[]
    if (first === undefined) lines = ['Nothing is written for this slot.']
    else if (rest.some((p) => p.note !== first.note)) lines = plan.prescriptions.map((p) => `${sideWords(p.side, injuredSide)}: ${p.note}`)
    else lines = [first.note]
    return { slotId: plan.slot.id, name: plan.exercise.name, optional: plan.slot.optional, lines }
  })
}

/** A rejected write, in words. */
export function errorWords(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.trim().length > 0 ? text.trim() : 'no reason was given'
}

// ---------------------------------------------------------------------------------------------
// A morning check for a past day (Batch D, Shawn's Nov 8 decision 12; PROGRAM-QUESTIONS 174 to 176)

/** The late form's lead: which session the check is for, and the morning it describes. */
export function lateSubjectWords(subject: CheckSubject | null, sessionDay: IsoDate, templates: readonly Pick<SessionTemplate, 'id' | 'letter'>[]): string {
  const morning = `the check for the next morning, ${dateWords(addDays(sessionDay, 1))}, logged late.`
  const when = dateWords(sessionDay)
  if (!subject) return `For ${when}: ${morning}`
  if (subject.kind === 'run') return `For the ${runWords(subject.run.type)} on ${when}: ${morning}`
  const status = STATUS_WORDS[subject.workout.status] ?? ''
  return `For ${sessionName(subject.workout.templateId, templates)}${status} on ${when}: ${morning}`
}

export const LATE_FORM_LINE = 'Answer for that morning as best you remember. A check logged late reads like any other.'

/** The late form's red-flag intro, after the program's own. */
export const LATE_FLAG_INTRO = 'A flag on a past morning is a note, not a stop; if it is still happening, tick it on this morning’s check.'

/** The words the form's comparisons take: yesterday on this morning's check, the day before on a past morning's. */
export function formWords(late: boolean): { worse: string; painLabel: string; painNote: string } {
  const before = late ? 'the day before' : 'yesterday'
  return {
    worse: `Worse than ${before}`,
    painLabel: `Pain change since ${before}`,
    painNote: `Minus means less pain than ${before}. Up 2 or more reads back off.`,
  }
}

/** Why a past morning can't take a check, in words. */
export function lateRefusalWords(refusal: LateCheckRefusal, sessionDay: IsoDate): string {
  const morning = dateWords(addDays(sessionDay, 1))
  switch (refusal.kind) {
    case 'morning-is-today':
      return 'That morning is today: use this morning’s check.'
    case 'morning-ahead':
      return `${morning} hasn’t come yet.`
    case 'outside-window':
      return `Only the last ${RETRO_DAYS} days can take a morning check after the fact.`
    case 'nothing-logged':
      return `Nothing finished was logged on ${dateWords(sessionDay)}, so there is no morning check to add. A session left open counts once it is finished or ended.`
    case 'check-exists':
      return `A morning check for ${dateWords(refusal.morning)} is already saved; it stays as it is.`
    case 'all-covered':
      return 'Every session that day already has its morning check.'
  }
}

/**
 * A past day missing its morning check, inside the 14 days, offers that morning's check (Batch D;
 * lateCheckFor decides): the morning it would describe and the button's words. Null otherwise,
 * yesterday included: its morning is today, and this morning's check covers it.
 */
export function lateCheckOffer(input: { date: IsoDate; today: IsoDate; startDate: IsoDate; history: Pick<History, 'workouts' | 'runs' | 'morningChecks'> }): { morning: IsoDate; label: string } | null {
  const offer = lateCheckFor({ sessionDay: input.date, today: input.today, startDate: input.startDate, workouts: input.history.workouts, runs: input.history.runs, checks: input.history.morningChecks })
  return offer.ok ? { morning: offer.morning, label: lateOfferLabel(offer.morning) } : null
}

/** The button that opens a past morning's check: "Log the morning check for Wednesday Nov 18". */
export function lateOfferLabel(morning: IsoDate): string {
  return `Log the morning check for ${dateWords(morning)}`
}

/**
 * A red flag on a check logged late, for Today, Gates and the check's result (PROGRAM-QUESTIONS 175):
 * the program's instruction kept, and why it isn't the stop.
 */
export function lateFlagWords(note: LateFlagNote): string {
  return `A red flag was ticked on the check for ${dateWords(note.date)}’s morning, logged late on ${dateWords(note.savedOn)}: ${note.items.join('; ')}. Any of these means a call to the ortho or PT. Logged late, it doesn’t take over Today or suspend progression; if it is still happening, tick it on this morning’s check.`
}

/** The same note on the Week row of the session day, kept for good. */
export function weekLateFlagWords(note: LateFlagNote): string {
  return `Red flag on the next morning’s check, logged late on ${dateWords(note.savedOn)}: ${note.items.join('; ')}. A note, not a stop: any of these means a call to the ortho or PT`
}

const READ_WORDS: Record<ReadingResult, string> = { clean: 'clean', hold: 'hold', 'back-off': 'back off' }

/**
 * The lift dates a late check can reach through the whole-knee back-off (wholeKnee.ts): each lift
 * still open, and the next scheduled lift (from tomorrow once today's lift has happened).
 */
export function reachLiftDates(input: { today: IsoDate; startDate: IsoDate; template: WeeklyTemplate; moves: readonly SessionMove[]; workouts: readonly Workout[] }): IsoDate[] {
  const { today, workouts } = input
  const open = workouts.filter((w) => w.status === 'in-progress').map((w) => w.date)
  const liftedToday = workouts.some((w) => w.date === today && (w.status === 'finished' || w.status === 'abandoned'))
  const next = nextLiftDate(liftedToday ? addDays(today, 1) : today, input.startDate, input.template, input.moves)
  return Array.from(new Set([...open, ...(next ? [next] : [])])).sort()
}

/** What a late check changed, one sentence each (lateCheckReach), or a line saying nothing did. */
export function lateReachWords(reach: LateCheckReach, history: Pick<History, 'workouts' | 'runs'>, templates: readonly Pick<SessionTemplate, 'id' | 'letter'>[]): string[] {
  const label = (r: LateCheckReach['readings'][number]) => {
    if (r.kind === 'workout') {
      const w = history.workouts.find((x) => x.id === r.id)
      return w ? sessionName(w.templateId, templates) : 'The session'
    }
    const run = history.runs.find((x) => x.id === r.id)
    const words = run ? runWords(run.type) : 'run'
    return `The ${words}`
  }
  const readings = reach.readings.map((r) => `${label(r)} on ${dateWords(r.date)} now reads ${READ_WORDS[r.to]}; it read ${READ_WORDS[r.from]}.`)
  const lifts = reach.lifts.map((l) =>
    l.to !== null
      ? `The lift on ${dateWords(l.date)} now plans its lower-body work at back-off loads: the morning of ${dateWords(l.to)} read back off.`
      : `The lift on ${dateWords(l.date)} no longer plans its lower-body work at back-off loads.`,
  )
  if (readings.length === 0 && lifts.length === 0) return ['No reading or plan changed: the sessions read as they already did.']
  const cap = readings.length > 0 ? ['A reading can also change the miles cap of the week after it; Week shows where each week stands.'] : []
  return [...readings, ...lifts, ...cap]
}
