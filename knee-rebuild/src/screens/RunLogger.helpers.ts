import { RETRO_DAYS, retroDates } from '../rules/retro.ts'
import type { History } from '../db/repo.ts'
import { addDays, dayOf, daysBetween, scheduledSession, weekOf } from '../rules/calendar.ts'
import { runSwapsHere, type Available, type RunSwapHere } from '../rules/equipment.ts'
import { swapCallAt, type SwapCall } from '../rules/gymDay.ts'
import { attachChecks, runReading, subjectReadings } from '../rules/history.ts'
import { isSwap } from '../rules/mileage.ts'
import { morningCheckApplies, morningReading } from '../rules/reading.ts'
import { progressionSuspended, stopMessage } from '../rules/redFlags.ts'
import { phaseWeekOf } from '../rules/session.ts'
import { EFFORT_RPE, effortFromRpe, hrLoadOf, hrPair } from '../rules/trainingLoad.ts'
import { runTypeFor, runsInWeek, suggestRun, weekMilesSummary, type RunSuggestion, type WeekMiles } from '../rules/weekPlan.ts'
import { Effort, RUN_HR_MAX, RUN_HR_MIN, Run, RunType, type Day, type DaySession, type HrSettings, type IsoDate, type MorningCheck, type Program, type ReadingResult, type Settings } from '../schema/index.ts'
import { dateWords, noSwapMachineWords, runLabel, sessionLabel, shortDateWords } from './Today.helpers.ts'

/**
 * Pure helpers for the Run logger: which dates a run can be logged for, the view the screen renders,
 * the form's state and the Run it saves, and the words for all of it. Every knee and mileage
 * decision (the week's target and its cap, the suggested run, the swap call, readings, the red-flag
 * state) is asked of src/rules; this file composes the answers and names things.
 */

export type HistoryLike = Pick<History, 'workouts' | 'setLogs' | 'morningChecks' | 'runs' | 'sessionMoves'>
export type ProgramLike = Pick<Program, 'weeklyTemplate' | 'weeklyTemplateRows' | 'mileagePlan' | 'redFlags'>

/** The five types, in the order the screen offers them. */
export const RUN_TYPES: readonly RunType[] = RunType.options

/** Distance in hundredths of a mile, as a watch reports it (Shawn, Nov 6). */
export const MILES_STEP = 0.01
/** One run's ceiling: far over any run in the plan, low enough that a stray extra digit can't save as typed. */
export const MILES_MAX = 30
export const MINUTES_STEP = 1
export const MINUTES_MAX = 600
export const SECONDS_MAX = 59

/**
 * A run's time is entered as minutes and seconds and stored as minutes, the seconds a fraction of one
 * (Run.minutes; 27:13 is 27 + 13/60), so a stored run, a backup and the mileage rules read it as before.
 */
export function splitTime(minutes: number): { minutes: number; seconds: number } {
  const total = Math.max(0, Math.round(minutes * 60))
  return { minutes: Math.floor(total / 60), seconds: total % 60 }
}

/** Minutes and seconds back to the stored minutes; seconds past 59 carry into the minutes. */
export function joinTime(minutes: number, seconds: number): number {
  const total = Math.max(0, Math.round(minutes) * 60 + Math.round(seconds))
  return total / 60
}

/** "35 minutes", "1 minute", or with seconds "27:13" (and "1:02:05" past an hour). */
export function timeWords(minutes: number): string {
  const { minutes: m, seconds: s } = splitTime(minutes)
  if (s === 0) return `${m} ${m === 1 ? 'minute' : 'minutes'}`
  const pad = (n: number) => String(n).padStart(2, '0')
  return m >= 60 ? `${Math.floor(m / 60)}:${pad(m % 60)}:${pad(s)}` : `${m}:${pad(s)}`
}

const BANDS = '1–3 easy, 4–6 moderate, 7–10 hard'

/** The line under the effort picker: what the RPE reads as, the band in words (metrics phase 1). */
export function rpeNote(rpe: number | null): string {
  if (rpe === null) return 'Required. 1–3 reads easy, 4–6 moderate, 7–10 hard.'
  return `RPE ${rpe} reads ${effortFromRpe(rpe)}. ${BANDS}.`
}

const SHORT_DAY: Record<Day, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }

/** "Today"; else the weekday ("Mon") inside the last week, where it names one date; else the weekday and date ("Mon Oct 26"). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function monthAndDayOf(date: IsoDate): { month: string; day: number } {
  return { month: MONTHS[Number(date.slice(5, 7)) - 1] ?? '', day: Number(date.slice(8, 10)) }
}

export function dayChoiceWords(date: IsoDate, today: IsoDate): string {
  if (date === today) return 'Today'
  if (daysBetween(date, today) < 7) return SHORT_DAY[dayOf(date)]
  const { month, day } = monthAndDayOf(date)
  return `${SHORT_DAY[dayOf(date)]} ${month} ${day}`
}

/**
 * The dates a run can be logged for: today and the RETRO_DAYS before it, never before the program
 * starts (`retroDates`; Shawn's Nov 6 ask to log after the fact widens PROGRAM-QUESTIONS 62's
 * this-week-only window, PROGRAM-QUESTIONS 141). Empty before the program starts.
 */
export function dateChoices(today: IsoDate, startDate: IsoDate): IsoDate[] {
  if (weekOf(today, startDate) < 1) return []
  return [...retroDates(today, startDate), today]
}

/** The note under the day choices: which days can be logged, and how a late one reads. */
export function dayChoicesNote(): string {
  return `The last ${RETRO_DAYS} days can be logged. A run logged late is read like any other: with no morning check the day after, it reads hold.`
}

/**
 * The date the logger logs for: the one picked (pinned when the logger opened) while it is still a
 * choice, else today. The view's `date`, and the date a swap's gym is read for (`runSwapGym`).
 */
export function loggedDate(today: IsoDate, startDate: IsoDate, picked: IsoDate | null): IsoDate {
  return picked !== null && dateChoices(today, startDate).includes(picked) ? picked : today
}

/** Under the gym choice on an earlier day's log: where the swap is stored, and that another gym is a tap away. */
export function swapGymNote(date: IsoDate, gymName: string): string {
  return `A swap stores the gym it was done at: ${dateWords(date).split(',')[0] ?? 'that day'}’s is preset to ${gymName}. Tap another if it was elsewhere.`
}

/** That date's morning reading, from the check logged that morning, or null when none was. */
export function morningFor(date: IsoDate, checks: readonly MorningCheck[]): ReadingResult | null {
  const check = checks.find((c) => c.date === date)
  return check ? morningReading(check).result : null
}

export type LoggerView =
  | { kind: 'before-start'; line: string }
  | {
      kind: 'form'
      week: number
      /** The date being logged: the one picked (pinned when the logger opened) when it is still a choice, else today. */
      date: IsoDate
      /**
       * The pinned date when it is no longer a choice (the week turned while the form was open): said
       * in words, and Save waits until a day is picked again. Never swapped for today silently.
       */
      dateLost: IsoDate | null
      dates: IsoDate[]
      scheduled: DaySession
      /** "Session A", "Run: MBR", "Off: Kona walk and mobility only". */
      scheduledLabel: string
      /** The type the day's scheduled session preselects (runTypeFor), or null on a lift or off day. */
      preselected: RunType | null
      /** The type being logged: the one picked, else the preselection. */
      type: RunType | null
      /**
       * suggestRun for the day's scheduled run (after moves), whatever type is picked: null on a lift
       * or off day, where a run still logs but the engine plans nothing (no long-run share, tempo or
       * strides, M4 review), and while the red-flag state suspends progression.
       */
      suggestion: RunSuggestion | null
      stop: { headline: string; items: string[] } | null
      /** That date's morning reading, from the check logged that morning; null when none was. */
      morning: ReadingResult | null
      /** The gym a swap is logged at, by name: the active one, or for an earlier day the one `runSwapGym` gives. */
      gym: string
      /** Both swaps in program.md's order, each here or not at that gym; both stay loggable (design section 7). */
      swaps: RunSwapHere[]
      /**
       * What a hold or back-off morning's swap call comes to at the gym: `take` names the first swap
       * here, elliptical then rower; `neither` means nothing is suggested and he picks (Shawn's
       * Nov 1 answer 7). Null when the engine calls for no swap.
       */
      swapCall: SwapCall | null
      summary: WeekMiles
      /** This program week's runs, by date. */
      weekRuns: Run[]
    }

/** Everything the Run logger renders, from today, what was picked, the settings, the stored history and the program. */
export function loggerView(input: {
  today: IsoDate
  picked: { date: IsoDate | null; type: RunType | null }
  settings: Settings
  history: HistoryLike
  program: ProgramLike
  /** The gym a swap is logged at (`runSwapGym`): its name and what is there (`availableAt`). */
  gym: { name: string; available: Available }
}): LoggerView {
  const { today, picked, settings, history, program, gym } = input
  const dates = dateChoices(today, settings.startDate)
  if (dates.length === 0) return { kind: 'before-start', line: `Week 1 starts ${shortDateWords(settings.startDate)}` }

  const dateLost = picked.date !== null && !dates.includes(picked.date) ? picked.date : null
  const date = loggedDate(today, settings.startDate, picked.date)
  const { week, session } = scheduledSession(date, settings.startDate, program.weeklyTemplate, history.sessionMoves)
  const scheduled: DaySession = session ?? 'off'
  const preselected = runTypeFor(scheduled)
  const type = picked.type ?? preselected

  const records = attachChecks(history.workouts, history.setLogs, history.morningChecks)
  const readings = subjectReadings(records, history.runs, history.morningChecks, settings.injuredSide)
  const summary = weekMilesSummary(program.mileagePlan, week, settings.startDate, history.runs, readings)
  const weekRuns = runsInWeek(history.runs, settings.startDate, week).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))

  const stop = stopMessage(settings.redFlag, program.redFlags)
  const morning = morningFor(date, history.morningChecks)
  const suggestion = progressionSuspended(settings.redFlag)
    ? null
    : suggestRun({
        session: scheduled,
        week,
        target: summary.target.target,
        milesSoFar: summary.miles,
        currentPhase: settings.currentPhase,
        phaseWeek: phaseWeekOf(Math.max(week, settings.phaseEnteredWeek), settings.phaseEnteredWeek),
        morning,
      })

  return {
    kind: 'form',
    week,
    date,
    dateLost,
    dates,
    scheduled,
    scheduledLabel: sessionLabel(scheduled, program.weeklyTemplateRows),
    preselected,
    type,
    suggestion,
    stop,
    morning,
    gym: gym.name,
    swaps: runSwapsHere(gym.available),
    swapCall: swapCallAt(suggestion, gym.available),
    summary,
    weekRuns,
  }
}

/** The screen's lead: the date being logged and what it holds, or, when the pinned date was lost, the ask. */
export function leadWords(view: { date: IsoDate; dateLost?: IsoDate | null; scheduledLabel: string }): string {
  if (view.dateLost) return 'Pick the day this run happened'
  return `${dateWords(view.date)} · ${view.scheduledLabel}`
}

/** What happened when the pinned date dropped out of the choices, and what to do. */
export function dateLostWords(lost: IsoDate): string {
  return `${shortDateWords(lost)}, the day this run was started for, can no longer be logged: runs log for the last ${RETRO_DAYS} days up to today. Pick a day to save it.`
}

/** The Save button: it names the day when that is not today, since the date stays as the logger opened. */
export function saveWords(date: IsoDate, today: IsoDate): string {
  return date === today ? 'Save run' : `Save run for ${shortDateWords(date)}`
}

/** What the suggestion block says when there is no suggestion. */
export function noSuggestionWords(view: { date: IsoDate; scheduledLabel: string; type: RunType | null; stop: unknown }, today: IsoDate): string {
  if (view.stop) return 'No run is suggested while the red-flag state is on.'
  const day = view.date === today ? 'Today' : (dateWords(view.date).split(',')[0] ?? 'That day')
  const base = `${day} holds ${view.scheduledLabel}, not a run, so there is no suggestion.`
  return view.type === null ? `${base} Pick the type to log one anyway.` : `${base} It still logs, with what you enter.`
}

/** "Run: easy · 3 miles" or, outside the plan, the type alone: the run the engine plans. */
export function runPlanWords(suggestion: RunSuggestion): string {
  return suggestion.miles === null ? runLabel(suggestion.type) : `${runLabel(suggestion.type)} · ${milesWords(suggestion.miles)}`
}

/**
 * The head of the suggestion block: when the engine calls for a swap, the first one here
 * ("Elliptical swap", else "Rower swap"), or with neither here "No elliptical or rower at
 * Marriott Downtown"; else the run and its miles. The run's plan is still shown under a swap
 * head, for a run done anyway.
 */
export function suggestionHead(suggestion: RunSuggestion, at: { swapCall: SwapCall | null; gym: string }): string {
  if (!suggestion.swapSuggested || at.swapCall === null) return runPlanWords(suggestion)
  return at.swapCall.kind === 'take' ? runLabel(at.swapCall.type) : noSwapMachineWords(at.gym)
}

/** A swap choice's detail: "Here", or "Not at Marriott Downtown"; it logs either way. */
export function swapHereWords(here: boolean, gymName: string): string {
  return here ? 'Here' : `Not at ${gymName}`
}

/** The detail on a type choice: "scheduled" on the day's run, and on each swap whether its machine is at the gym. */
export function typeDetail(type: RunType, view: { preselected: RunType | null; swaps: readonly RunSwapHere[]; gym: string }): string | undefined {
  const swap = view.swaps.find((s) => s.type === type)
  if (swap) return swapHereWords(swap.here, view.gym)
  return type === view.preselected ? 'scheduled' : undefined
}

const ROWER_CUE_START = 'On the rower'

/**
 * program.md's rower cue, verbatim (design section 7): the sentence of its running rules that starts
 * "On the rower" ("On the rower, strap in, drive with the legs only through the pain-free range, and
 * keep the stroke rate around 22–24."). Null if the rules ever stop carrying one.
 */
export function rowerCue(rules: readonly string[]): string | null {
  for (const rule of rules) {
    const at = rule.indexOf(ROWER_CUE_START)
    if (at < 0) continue
    const rest = rule.slice(at)
    const end = rest.search(/[.!?](\s|$)/)
    return end < 0 ? rest : rest.slice(0, end + 1)
  }
  return null
}

/** The rower cue when the rower swap is the morning's call at this gym or the type picked; null otherwise. */
export function rowerCueFor(view: { type: RunType | null; swapCall: SwapCall | null }, cue: string | null): string | null {
  const rower = view.type === 'rower-swap' || (view.swapCall?.kind === 'take' && view.swapCall.type === 'rower-swap')
  return rower ? cue : null
}

/** The engine's reasons are lowercase fragments; on screen each is a sentence. */
export function reasonSentence(reason: string): string {
  const text = reason.trim()
  if (text.length === 0) return text
  const capital = text.charAt(0).toUpperCase() + text.slice(1)
  return /[.!?]$/.test(capital) ? capital : `${capital}.`
}

/** "Take the elliptical swap". */
export function takeSwapWords(type: RunType): string {
  return `Take the ${runLabel(type).toLowerCase()}`
}

/** Whether a type is a swap: asked of the mileage rules, which own what counts as miles. */
export function isSwapType(type: RunType | null): boolean {
  return type !== null && isSwap({ type })
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** 3 → "3", 2.5 → "2.5", 2.25 → "2.25". */
export function milesNumber(miles: number): string {
  return String(round2(miles))
}

/** "1 mile", "2.5 miles". */
export function milesWords(miles: number): string {
  return `${milesNumber(miles)} ${round2(miles) === 1 ? 'mile' : 'miles'}`
}

/**
 * The line that updates as you type: "This week: 3 of 10 miles · with this run 6 · target from the
 * plan", with the rule's own reason in place of "target from the plan" when the target is capped
 * or outside the plan. A swap adds no miles, and the line says so instead of a sum.
 */
export function weekLine(summary: Pick<WeekMiles, 'miles' | 'target'>, pending: { type: RunType | null; miles: number } | null): string {
  const { target, miles } = summary
  const parts = [target.target === null ? `This week: ${milesWords(miles)}` : `This week: ${milesNumber(miles)} of ${milesWords(target.target)}`]
  if (pending) parts.push(isSwapType(pending.type) ? 'a swap adds no miles' : `with this run ${milesNumber(miles + pending.miles)}`)
  parts.push(target.target === null || target.capped ? target.reason : 'target from the plan')
  return parts.join(' · ')
}

/**
 * The form as typed. Null means "follow what the screen preselects or the engine suggests"; for the
 * date it means today, though the screen pins the date when the logger opens (openForm).
 */
export interface RunForm {
  date: IsoDate | null
  type: RunType | null
  miles: number | null
  minutes: number
  /** Effort as RPE 1 to 10; null until rated: like max pain, Save waits for it (metrics phase 1). */
  rpe: number | null
  /** Average heart rate from a watch, optional (metrics phase 2): null is "no heart rate", never 0, and an empty field never blocks Save. */
  avgHr: number | null
  /** Max heart rate on the run, same deal. */
  maxHr: number | null
  /** Null until rated: max pain is required, and unknown is not clean. */
  maxPain: number | null
  strides: boolean | null
  tempo: boolean | null
  stravaUrl: string
  notes: string
  /** The gym picked for a swap logged for an earlier day, and that day; null follows `runSwapGym`'s preset. */
  gymPick: { date: IsoDate; locationId: string } | null
}

export function emptyForm(): RunForm {
  return { date: null, type: null, miles: null, minutes: 0, rpe: null, avgHr: null, maxHr: null, maxPain: null, strides: null, tempo: null, stravaUrl: '', notes: '', gymPick: null }
}

/**
 * The form as the logger opens it: dated today and pinned there, so a form left open past midnight
 * or into a new week keeps the day it was started for (M4 review). Another day is a tap away.
 */
export function openForm(today: IsoDate): RunForm {
  return { ...emptyForm(), date: today }
}

/**
 * The form opened from a Strava activity (src/rules/stravaImport.ts): its day, type, miles, time,
 * effort when Strava had one, the watch's heart rate when it had that (metrics phase 2), link and
 * name, with max pain left unrated so Save waits on it, and strides and tempo following the type as
 * on any run. A draft a tab kept from before RPE carries an effort word instead (takeDraft doesn't
 * validate): it opens on that word as 3, 5 or 8; one from before phase 2 lacks the heart-rate keys
 * and opens on null, the same precedent.
 */
export function formFromDraft(draft: {
  date: IsoDate
  type: RunType
  miles: number
  minutes: number
  rpe?: number | null
  effort?: Effort | null
  avgHr?: number | null
  maxHr?: number | null
  stravaUrl: string
  notes: string
}): RunForm {
  const rpe = draft.rpe ?? (draft.effort ? EFFORT_RPE[draft.effort] : null)
  return { ...emptyForm(), date: draft.date, type: draft.type, miles: draft.miles, minutes: draft.minutes, rpe, avgHr: draft.avgHr ?? null, maxHr: draft.maxHr ?? null, stravaUrl: draft.stravaUrl, notes: draft.notes }
}

/** The form with every "follow" filled in: what the screen shows and what Save would log. */
export interface ResolvedForm {
  date: IsoDate
  /** The pinned date when it is no longer a choice: Save waits until a day is picked again. */
  dateLost: IsoDate | null
  type: RunType | null
  swap: boolean
  miles: number
  minutes: number
  rpe: number | null
  /** The RPE's band, for the words; null until rated. */
  effort: Effort | null
  /** As typed or imported, never clamped: `hrProblem` refuses a bad value in words (metrics phase 2). */
  avgHr: number | null
  maxHr: number | null
  maxPain: number | null
  strides: boolean
  tempo: boolean
  stravaUrl: string
  notes: string
}

/** Miles, strides and tempo follow the suggestion until touched; a swap logs 0 miles and neither strides nor tempo. */
export function resolveForm(form: RunForm, view: { date: IsoDate; dateLost?: IsoDate | null; type: RunType | null; suggestion: RunSuggestion | null }): ResolvedForm {
  const swap = isSwapType(view.type)
  return {
    date: view.date,
    dateLost: view.dateLost ?? null,
    type: view.type,
    swap,
    miles: swap ? 0 : (form.miles ?? view.suggestion?.miles ?? 0),
    minutes: form.minutes,
    rpe: form.rpe,
    effort: form.rpe === null ? null : effortFromRpe(form.rpe),
    avgHr: form.avgHr,
    maxHr: form.maxHr,
    maxPain: form.maxPain,
    strides: swap ? false : (form.strides ?? view.suggestion?.strides ?? false),
    tempo: swap ? false : (form.tempo ?? view.suggestion?.tempo ?? false),
    stravaUrl: form.stravaUrl,
    notes: form.notes,
  }
}

/** The schema's refusal of a Strava link, in words; null for an empty field or a link it accepts. */
export function stravaProblem(text: string): string | null {
  const link = text.trim()
  if (link.length === 0) return null
  if (Run.shape.stravaUrl.safeParse(link).success) return null
  return 'That Strava link was refused: it has to be an https address on strava.com, like https://www.strava.com/activities/123. Fix it or clear it to save.'
}

/**
 * What is wrong with the heart-rate fields, as a lowercase fragment, or null: an empty or valid
 * field is never a problem ("never blocks Save" means that), a typed number outside 30–250 or not
 * whole is refused here, in words, before the schema would refuse it raw, and an average above the
 * max is refused only when both are set (metrics phase 2).
 */
export function hrProblem(avgHr: number | null, maxHr: number | null): string | null {
  const bad = (n: number) => !Number.isInteger(n) || n < RUN_HR_MIN || n > RUN_HR_MAX
  if (avgHr !== null && bad(avgHr)) return `average heart rate is a whole number from ${RUN_HR_MIN} to ${RUN_HR_MAX}`
  if (maxHr !== null && bad(maxHr)) return `max heart rate is a whole number from ${RUN_HR_MIN} to ${RUN_HR_MAX}`
  if (avgHr !== null && maxHr !== null && avgHr > maxHr) return 'average is above max'
  return null
}

/** `hrProblem` as the sentence beside the fields; null with nothing wrong. */
export function hrProblemWords(avgHr: number | null, maxHr: number | null): string | null {
  const problem = hrProblem(avgHr, maxHr)
  if (problem === null) return null
  return `${problem.charAt(0).toUpperCase()}${problem.slice(1)}. Fix it or clear the field to save.`
}

/**
 * The saved screen's HR-load line (Banister TRIMP, src/rules/trainingLoad.ts), e.g.
 * "HR load 72, from an average of 150 over 40 minutes." — null when the run has no minutes or no
 * average heart rate, or Settings don't hold both numbers: the screen then says nothing, never 0.
 */
export function hrLoadWords(run: Pick<Run, 'minutes' | 'avgHr'>, settings: Pick<HrSettings, 'maxHr' | 'restingHr'> | null | undefined): string | null {
  const load = hrLoadOf(run.minutes > 0 ? run.minutes : null, run.avgHr ?? null, hrPair(settings))
  if (load === null || run.avgHr === undefined) return null
  return `HR load ${Math.round(load)}, from an average of ${run.avgHr} over ${timeWords(run.minutes)}.`
}

export type RunDraft = { ok: true; run: Run } | { ok: false; blocker: string }

/**
 * The Run that Save logs, or the words on the disabled Save button saying what is missing. A swap
 * (elliptical or rower) is done at a gym, so it stores `locationId`, the gym it was done at
 * (`runSwapGym`: the active one for today, the one picked or preset for an earlier day); a run
 * outside stores none.
 */
export function toRun(form: ResolvedForm, id: string, locationId: string): RunDraft {
  const { type, maxPain, rpe } = form
  if (form.dateLost !== null) return { ok: false, blocker: 'Pick the day first' }
  if (type === null || maxPain === null || rpe === null) {
    const rate = [maxPain === null ? 'max pain' : null, rpe === null ? 'effort' : null].filter((w): w is string => w !== null)
    const steps = [type === null ? 'pick the type' : null, rate.length > 0 ? `rate ${rate.join(' and ')}` : null].filter((w): w is string => w !== null)
    const joined = steps.length === 2 && rate.length === 2 ? `${steps[0]}, ${steps[1]}` : steps.join(' and ')
    return { ok: false, blocker: `${joined.charAt(0).toUpperCase()}${joined.slice(1)} first` }
  }
  // A swap logs no miles, so its minutes are all it measures: an untouched 0 would store a session as nothing.
  if (form.swap && form.minutes === 0) return { ok: false, blocker: 'Set the time first' }
  if (stravaProblem(form.stravaUrl)) return { ok: false, blocker: 'Fix or clear the Strava link first' }
  // Empty or valid heart-rate fields never block; a typed bad value does, in words, never as a raw schema error (metrics phase 2).
  const hr = hrProblem(form.avgHr, form.maxHr)
  if (hr) return { ok: false, blocker: `Fix the heart rate first: ${hr}` }
  const link = form.stravaUrl.trim()
  const notes = form.notes.trim()
  return {
    ok: true,
    run: {
      id,
      date: form.date,
      type,
      miles: form.swap ? 0 : round2(form.miles),
      minutes: form.minutes,
      // The only writer of a run's effort: always the RPE's band, so the two never disagree.
      effort: effortFromRpe(rpe),
      rpe,
      // Absent stays absent, never 0: an empty field is "no heart rate" (metrics phase 2).
      ...(form.avgHr !== null ? { avgHr: form.avgHr } : {}),
      ...(form.maxHr !== null ? { maxHr: form.maxHr } : {}),
      maxPain,
      strides: form.swap ? false : form.strides,
      tempo: form.swap ? false : form.tempo,
      ...(link.length > 0 ? { stravaUrl: link } : {}),
      ...(notes.length > 0 ? { notes } : {}),
      ...(form.swap ? { locationId } : {}),
    },
  }
}

/** A readable run id that cannot collide with another run that day. */
export function newRunId(date: IsoDate, taken: readonly string[]): string {
  const base = `run-${date}`
  if (!taken.includes(base)) return base
  let n = 2
  while (taken.includes(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

const READING_WORDS: Record<ReadingResult, string> = { clean: 'clean', hold: 'hold', 'back-off': 'back off' }

/**
 * What saving means for the reading. Today's run: tomorrow's morning check reads it. An earlier
 * day's run: the check that already covers it (rule 3's link or date), this morning's check, or,
 * when none ever will, what the engine reads it as without one.
 */
export function loggedWords(run: Run, today: IsoDate, checks: readonly MorningCheck[]): string {
  if (run.date === today) return 'Logged. Tomorrow’s morning check reads it.'
  const subject = { kind: 'run' as const, id: run.id, date: run.date }
  const covering = checks.find((c) => morningCheckApplies(c, subject))
  const when = shortDateWords(run.date)
  if (covering) return `Logged for ${when}. The morning check from ${shortDateWords(covering.date)} reads it.`
  // A check dated the day after always covers the run (rule 3's date), so here none exists yet.
  if (addDays(run.date, 1) === today) return `Logged for yesterday, ${when}. This morning’s check reads it.`
  return `Logged for ${when}. No morning check from the day after covers it, so it reads ${READING_WORDS[runReading(run, checks).result]}.`
}

export interface RunRow {
  when: string
  what: string
  miles: string
  pain: string
}

/** One of this week's runs, in words: date, type, miles, max pain. */
export function runRow(run: Run): RunRow {
  return {
    when: shortDateWords(run.date),
    what: runLabel(run.type),
    miles: isSwap(run) ? 'no miles (swap)' : milesWords(run.miles),
    pain: `max pain ${run.maxPain}`,
  }
}

/** A rejected write, in words. */
export function errorWords(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.trim().length > 0 ? text.trim() : 'no reason was given'
}
