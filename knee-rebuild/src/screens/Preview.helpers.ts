import { planSession, rampsInOrder, type Gym, type Ramp, type SlotPlan } from '../app/session.ts'
import { writtenSession, type WrittenSlotPlan } from '../app/written.ts'
import type { History } from '../db/repo.ts'
import type { EngineMode } from '../rules/engineMode.ts'
import { addDays, dateOf, isDeloadWeek, scheduledSession, weekOf } from '../rules/calendar.ts'
import { pauseOn, pausedNote } from '../rules/downPeriod.ts'
import type { DownPeriod, IsoDate, Program, SessionMove, SessionTemplate, Settings, Side, Workout } from '../schema/index.ts'
import { prescriptionWords, rampSetsWords, routeLines, sideWords, type ItemLike } from './SessionRunner.helpers.ts'
import { dateWords, phaseName, sessionLabel, sessionLetter, sessionNote, shortDateWords, todaysLift } from './Today.helpers.ts'

/**
 * Pure helpers for the session preview (`#/preview/:date`): a read-only look at one day's session
 * before it comes round. The plan itself comes from planSession, the same call the runner opens
 * with, so the numbers here are the ones Start will show if nothing is logged in between.
 */

export type ProgramLike = Pick<Program, 'weeklyTemplate' | 'weeklyTemplateRows' | 'templates' | 'phases'>
export type HistoryLike = { workouts: readonly Workout[]; sessionMoves: readonly SessionMove[]; downPeriods?: readonly DownPeriod[] }

/** The weeks the preview steps through: week 1 to 12, or to the week after this one once past 12. */
export function previewRange(today: IsoDate, startDate: IsoDate): { first: IsoDate; last: IsoDate } {
  const lastWeek = Math.max(12, weekOf(today, startDate) + 1)
  return { first: startDate, last: dateOf(startDate, lastWeek, 'sun') }
}

/** "Today", "Tomorrow", "In 3 days", "Yesterday", "4 days ago". */
export function relationWords(date: IsoDate, today: IsoDate): string {
  if (date === today) return 'Today'
  if (date === addDays(today, 1)) return 'Tomorrow'
  if (date === addDays(today, -1)) return 'Yesterday'
  const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
  return days > 0 ? `In ${days} days` : `${-days} days ago`
}

/** The day's down period in words, from the rule's own note (`pausedNote`); null outside one. */
export function previewDownPeriodWords(date: IsoDate, periods: readonly DownPeriod[]): string | null {
  const pause = pauseOn(date, periods)
  return pause === null ? null : `A down period covers this day: ${pausedNote(pause).replace(/^Down period: /, '')}`
}

/** Why the numbers might still change, in words, from where the day sits against today. */
export function caveatWords(date: IsoDate, today: IsoDate): string {
  if (date > today) {
    return 'Planned from what’s logged so far. The sessions and morning checks before then can change these numbers, and so can a gate that moves you to the next phase.'
  }
  if (date === today) return 'Planned from what’s logged so far: this is what Start opens with.'
  return 'This day has passed. This is what it was planned as, from what was logged before it.'
}

export type PreviewBody =
  | { kind: 'before-start'; line: string }
  | { kind: 'off'; label: string; note: string | null }
  | { kind: 'run'; label: string; note: string | null }
  | {
      kind: 'lift'
      label: string
      letter: string
      /** The template the session runs: a logged session's own, else the current phase's. Null when the phase has none. */
      template: SessionTemplate | null
      week: number
      /** Set when the day already holds a session: finished or left early opens its summary, in progress opens the runner. */
      logged: { workoutId: string; status: Workout['status'] } | null
      missingWords: string | null
    }

export interface PreviewView {
  date: IsoDate
  dateWords: string
  relation: string
  week: number | null
  deload: boolean
  phaseLine: string | null
  caveat: string
  prev: IsoDate | null
  next: IsoDate | null
  body: PreviewBody
  /** "A down period covers this day: progression paused until Friday Nov 20." (Batch E); null outside one. */
  downPeriod: string | null
}

/** Tester mode's caveat: the session as written, the same whatever is logged. */
export const WRITTEN_CAVEAT = 'As program.md writes it. Logging changes none of it.'

/**
 * What a day holds and which template it would run, from the date, today, the settings, the stored
 * workouts and moves, and the program. Tester mode (M-U3): no down period and the written caveat.
 */
export function previewView(input: { mode: EngineMode; date: IsoDate; today: IsoDate; settings: Settings; history: HistoryLike; program: ProgramLike }): PreviewView {
  const { date, today, settings, history, program } = input
  const range = previewRange(today, settings.startDate)
  const tester = input.mode === 'tester'
  const base = {
    date,
    dateWords: dateWords(date),
    relation: relationWords(date, today),
    caveat: tester ? WRITTEN_CAVEAT : caveatWords(date, today),
    prev: date > range.first ? addDays(date, -1) : null,
    next: date < range.last ? addDays(date, 1) : null,
    downPeriod: tester ? null : previewDownPeriodWords(date, history.downPeriods ?? []),
  }
  const scheduled = scheduledSession(date, settings.startDate, program.weeklyTemplate, history.sessionMoves)
  if (scheduled.session === null) {
    // Before week 1 there is nothing to step back to; forward goes straight to the first day.
    return { ...base, week: null, deload: false, phaseLine: null, prev: null, next: settings.startDate, body: { kind: 'before-start', line: `Week 1 starts ${shortDateWords(settings.startDate)}.` } }
  }
  const { week, session } = scheduled
  const head = { ...base, week, deload: isDeloadWeek(week) }
  const label = sessionLabel(session, program.weeklyTemplateRows)
  const letter = sessionLetter(session)
  if (!letter) {
    const note = sessionNote(session, program.weeklyTemplateRows)
    return { ...head, phaseLine: null, body: session === 'off' ? { kind: 'off', label, note } : { kind: 'run', label, note } }
  }
  const workout = todaysLift(history.workouts, date, letter, program.templates)
  const own = workout ? (program.templates.find((t) => t.id === workout.templateId) ?? null) : null
  const template = own ?? program.templates.find((t) => t.phase === settings.currentPhase && t.letter === letter) ?? null
  const phase = template?.phase ?? settings.currentPhase
  return {
    ...head,
    phaseLine: `Phase ${phase} · ${phaseName(program.phases, phase)}`,
    body: {
      kind: 'lift',
      label,
      letter,
      template,
      week,
      logged: workout && workout.status !== 'planned' ? { workoutId: workout.id, status: workout.status } : null,
      missingWords: template ? null : `No Session ${letter} is written for phase ${settings.currentPhase}, so there is nothing to show.`,
    },
  }
}

export interface PreviewSlot {
  slotId: string
  label: string
  name: string
  optional: boolean
  /** The other members of a superset or tri-set, by label: "with 6 and 7". */
  groupWith: string | null
  /** The prescription in the runner's words, one line per side, injured side first. */
  lines: string[]
  /** The engine's note on why: one line, or one per side when the sides differ. */
  notes: string[]
  /** What the gym does to the slot, in the runner's words. */
  gymLines: string[]
  cues: string[]
  /** "Cues written for Leg press, both legs" when another exercise runs in the slot. */
  cuesFor: string | null
  /** "Warm-up sets: 90 lb × 8, then 135 lb × 5 (not logged)." before a big lift (PROGRAM-QUESTIONS 165); null for none. */
  ramp: string | null
}

/** A slot's warm-up sets as the Preview says them, or null. */
export function previewRampWords(ramp: Ramp | undefined, exercise: Parameters<typeof rampSetsWords>[1]): string | null {
  const sets = ramp ? rampSetsWords(ramp, exercise) : null
  if (sets === null || ramp?.kind !== 'sets') return null
  return `${ramp.sets.length === 1 ? 'Warm-up set' : 'Warm-up sets'}: ${sets} (not logged).`
}

function listWords(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

/** Each planned slot in words, the way the runner's cards will say it; `ramps` runs alongside `plans` (`rampsInOrder`). */
export function previewSlots(
  plans: readonly SlotPlan[],
  ctx: { injuredSide: Side; gymName: string; items: readonly ItemLike[]; nameOf: (exerciseId: string) => string; ramps?: readonly Ramp[] },
): PreviewSlot[] {
  return plans.map((plan, index) => {
    const { slot, exercise, prescriptions } = plan
    const members = slot.groupId ? plans.filter((p) => p.slot.groupId === slot.groupId && p.slot.id !== slot.id).map((p) => p.slot.label) : []
    const lines = prescriptions.map((p) => {
      const side = sideWords(p.side, ctx.injuredSide)
      const words = prescriptionWords(p, slot, exercise)
      return side ? `${side}: ${words}` : words
    })
    const [first, ...rest] = prescriptions
    const notes =
      first === undefined
        ? ['Nothing is written for this slot.']
        : rest.some((p) => p.note !== first.note)
          ? prescriptions.map((p) => `${sideWords(p.side, ctx.injuredSide) || 'Both'}: ${p.note}`)
          : [first.note]
    return {
      slotId: slot.id,
      label: slot.label,
      name: exercise.name,
      optional: slot.optional,
      groupWith: members.length ? `with ${listWords(members)}` : null,
      lines,
      notes: notes.filter((n) => n.trim().length > 0),
      gymLines: routeLines({ route: plan.route, swapped: false, gymName: ctx.gymName, items: ctx.items, nameOf: ctx.nameOf }),
      cues: slot.cues,
      cuesFor: exercise.id !== slot.exerciseId && slot.cues.length > 0 ? `Cues written for ${ctx.nameOf(slot.exerciseId)}` : null,
      ramp: previewRampWords(ctx.ramps?.[index], first ? (plan.substitutions.find((e) => e.id === first.exerciseId) ?? exercise) : exercise),
    }
  })
}

/** Each written slot in words (tester mode): the exercise, program.md's own cell, the deload's cut, what the gym does, and the cues. */
export function writtenPreviewSlots(plans: readonly WrittenSlotPlan[], ctx: { gymName: string; items: readonly ItemLike[]; nameOf: (exerciseId: string) => string }): PreviewSlot[] {
  return plans.map((plan) => {
    const { slot, exercise } = plan
    const members = slot.groupId ? plans.filter((p) => p.slot.groupId === slot.groupId && p.slot.id !== slot.id).map((p) => p.slot.label) : []
    return {
      slotId: slot.id,
      label: slot.label,
      name: exercise.name,
      optional: slot.optional,
      groupWith: members.length ? `with ${listWords(members)}` : null,
      lines: [plan.text, ...(plan.loadNote ? [plan.loadNote] : [])],
      notes: plan.deload ? [deloadWords(plan.deload)] : [],
      gymLines: routeLines({ route: plan.route, swapped: false, gymName: ctx.gymName, items: ctx.items, nameOf: ctx.nameOf }),
      cues: slot.cues,
      cuesFor: exercise.id !== slot.exerciseId && slot.cues.length > 0 ? `Cues written for ${ctx.nameOf(slot.exerciseId)}` : null,
      ramp: null,
    }
  })
}

/** "Deload week: 2 of the written 3 sets." */
export function deloadWords(deload: { written: number; sets: number }): string {
  return `Deload week: ${deload.sets} of the written ${deload.written} ${deload.written === 1 ? 'set' : 'sets'}.`
}

/**
 * The slots a lift day's preview shows (Preview.tsx before M-U3): full mode plans with the engine and
 * shows the warm-up sets as the session order would; tester mode shows the session as written.
 */
export function previewSlotsFor(
  mode: EngineMode,
  input: { template: SessionTemplate; week: number; date: IsoDate; today: IsoDate; settings: Settings; history: History; gym: Gym; items: readonly ItemLike[]; nameOf: (exerciseId: string) => string },
): PreviewSlot[] {
  const { template, week, date, today, settings, history, gym } = input
  if (mode === 'tester') return writtenPreviewSlots(writtenSession({ template, week, settings, history, gym }), { gymName: gym.location.name, items: input.items, nameOf: input.nameOf })
  const plans: SlotPlan[] = planSession({ template, week, settings, history, gym, before: date })
  // Warm-up sets as the session order shows them (display only, PROGRAM-QUESTIONS 165); a past day logged after the fact shows none.
  return previewSlots(plans, { injuredSide: settings.injuredSide, gymName: gym.location.name, items: input.items, nameOf: input.nameOf, ramps: rampsInOrder(plans, date < today) })
}

/** The line under a run or off day: full mode says when the miles are suggested; tester mode only that it is as written. */
export function previewDayLine(mode: EngineMode, kind: 'run' | 'off'): string {
  if (kind === 'off') return 'No lift today.'
  return mode === 'tester' ? 'Log the run on the day, with what you did.' : 'The miles are suggested on the day, from the week so far and that morning’s check.'
}

/** Under "Log this session after the fact": the gym note, and in full mode how a late session is read. */
export function logLateNote(mode: EngineMode): string {
  if (mode === 'tester') return 'You can change the gym before the first set.'
  return 'You can change the gym before the first set. A session logged late is read like any other: with no morning check the day after, it reads hold at best until that morning’s check is logged; the app offers it when you finish.'
}

/** Today's link to the next lift on a run or off day: "Next lift: Session B, Thursday Nov 5". */
export function nextLiftWords(date: IsoDate, session: Parameters<typeof sessionLabel>[0], rows: ProgramLike['weeklyTemplateRows']): string {
  return `Next lift: ${sessionLabel(session, rows)}, ${shortDateWords(date)}`
}
