import type { History } from '../db/repo.ts'
import { addDays, dayOf, isDeloadWeek, scheduledSession } from '../rules/calendar.ts'
import { type Available, type ExerciseLookup, type RunSwapType, type SlotRoute } from '../rules/equipment.ts'
import { gymChanges, type GymChange, type PlannedSlot } from '../rules/gymChanges.ts'
import { liftGym, swapCallAt } from '../rules/gymDay.ts'
import { attachChecks, subjectReadings, workoutReading } from '../rules/history.ts'
import { listedLocations } from '../rules/locations.ts'
import { morningCheckApplies, morningReading, type Reading } from '../rules/reading.ts'
import { phaseWeekOf } from '../rules/session.ts'
import { runsInWeek, suggestRun, targetForWeek, type RunSuggestion } from '../rules/weekPlan.ts'
import { weekMiles } from '../rules/mileage.ts'
import { stopMessage } from '../rules/redFlags.ts'
import { exportNudge, loggedRange } from '../rules/backup.ts'
import { koosDue } from '../rules/koos.ts'
import type {
  IsoDateTime,
  KoosEntry,
  Run,
  Day,
  DaySession,
  Equipment,
  EquipmentId,
  Exercise,
  IsoDate,
  Location,
  Phase,
  Program,
  ReadingResult,
  Requirement,
  RunType,
  SessionLetter,
  SessionTemplate,
  Settings,
  Side,
  Slot,
  Workout,
} from '../schema/index.ts'

/**
 * Pure helpers for the Today screen: words for dates and sessions, which stored workout is today's,
 * and the view the screen renders. Every knee decision is asked of src/rules; this file only
 * composes the answers and names things. The program pieces are passed in, so tests use fixtures.
 */

export type HistoryLike = Pick<History, 'workouts' | 'setLogs' | 'morningChecks' | 'runs' | 'sessionMoves'>
export type ProgramLike = Pick<Program, 'phases' | 'weeklyTemplate' | 'weeklyTemplateRows' | 'redFlags' | 'templates' | 'mileagePlan'>
type TemplateRows = ProgramLike['weeklyTemplateRows']

const WEEKDAY: Record<Day, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function monthAndDay(date: IsoDate): { month: string; day: number } {
  const [, m, d] = date.split('-').map(Number)
  const month = m === undefined ? undefined : MONTH[m - 1]
  if (month === undefined || d === undefined || Number.isNaN(d)) throw new RangeError(`not a YYYY-MM-DD date: ${date}`)
  return { month, day: d }
}

/** "Tuesday, November 3": the screen's lead line. */
export function dateWords(date: IsoDate): string {
  const { month, day } = monthAndDay(date)
  return `${WEEKDAY[dayOf(date)]}, ${month} ${day}`
}

/** "Nov 10": the form a mark-off's date takes. */
export function monthDayWords(date: IsoDate): string {
  const { month, day } = monthAndDay(date)
  return `${month.slice(0, 3)} ${day}`
}

/** "Monday Nov 2": the form the start line uses. */
export function shortDateWords(date: IsoDate): string {
  const { month, day } = monthAndDay(date)
  return `${WEEKDAY[dayOf(date)]} ${month.slice(0, 3)} ${day}`
}

const RUN_LABEL: Record<RunType, string> = {
  mbr: 'Run: MBR',
  easy: 'Run: easy',
  long: 'Run: long',
  'elliptical-swap': 'Elliptical swap',
  'rower-swap': 'Rower swap',
}

export function runLabel(type: RunType): string {
  return RUN_LABEL[type]
}

export function sessionLetter(session: DaySession): SessionLetter | null {
  switch (session) {
    case 'lift:A':
      return 'A'
    case 'lift:B':
      return 'B'
    case 'lift:C':
      return 'C'
    default:
      return null
  }
}

function runTypeOf(session: DaySession): RunType | null {
  switch (session) {
    case 'run:mbr':
      return 'mbr'
    case 'run:easy':
      return 'easy'
    case 'run:long':
      return 'long'
    default:
      return null
  }
}

/** The program's own note for a session from the weekly template rows ("Kona walk and mobility only"), or null. */
export function sessionNote(session: DaySession, rows: TemplateRows): string | null {
  const letter = sessionLetter(session)
  const run = runTypeOf(session)
  const wanted = letter ? `lift ${letter}` : run ? `run: ${run}` : 'off'
  const row = rows.find((r) => r.session.trim().toLowerCase() === wanted.toLowerCase())
  const note = row?.notes.trim()
  return note ? note : null
}

/** "Session A", "Run: MBR", "Off: Kona walk and mobility only". */
export function sessionLabel(session: DaySession, rows: TemplateRows = []): string {
  const letter = sessionLetter(session)
  if (letter) return `Session ${letter}`
  const run = runTypeOf(session)
  if (run) return runLabel(run)
  const note = sessionNote('off', rows)
  return note ? `Off: ${note}` : 'Off'
}

export function phaseName(phases: readonly Phase[], number: number): string {
  return phases.find((p) => p.number === number)?.name ?? `Phase ${number}`
}

/** "Session B" for a stored workout, from its template id. */
export function workoutLabel(workout: Pick<Workout, 'templateId'>, templates: readonly SessionTemplate[]): string {
  const letter = templates.find((t) => t.id === workout.templateId)?.letter
  return letter ? `Session ${letter}` : 'Session'
}

const STATUS_RANK: Record<Workout['status'], number> = { 'in-progress': 0, finished: 1, abandoned: 2, planned: 3 }

/** The stored workout that is today's: an open one first, then a finished one, then an abandoned attempt. */
export function todaysWorkout(workouts: readonly Workout[], date: IsoDate, templateId: string | null): Workout | null {
  const candidates = workouts.filter((w) => w.date === date && (templateId === null || w.templateId === templateId))
  candidates.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
  return candidates[0] ?? null
}

/**
 * Today's lift workout for the day's session letter, in whichever phase it was started: an open one
 * first, then a finished one, then an attempt ended early (todaysWorkout's order). A phase advanced
 * after the day's lift leaves that lift the day's, so Today never offers the new phase's version of
 * it the same day (PROGRAM-QUESTIONS 117).
 */
export function todaysLift(workouts: readonly Workout[], date: IsoDate, letter: SessionLetter, templates: readonly SessionTemplate[]): Workout | null {
  const ids = new Set(templates.filter((t) => t.letter === letter).map((t) => t.id))
  return todaysWorkout(
    workouts.filter((w) => ids.has(w.templateId)),
    date,
    null,
  )
}

/**
 * The day's lift, ended early in the phase before the one now current: what was logged is kept, and
 * the new phase starts with the next lift day, not with a second lift today.
 */
export function earlierPhaseWords(label: string, phase: number, phases: readonly Phase[], currentPhase: number): string {
  return `${label} was left early today, in Phase ${phase}: ${phaseName(phases, phase)}; what was logged is kept. Phase ${currentPhase}: ${phaseName(phases, currentPhase)} starts with the next lift day.`
}

/** A readable workout id that cannot collide with an earlier attempt on the same day. */
export function newWorkoutId(date: IsoDate, templateId: string, taken: readonly string[]): string {
  const base = `${date}-${templateId}`
  if (!taken.includes(base)) return base
  let n = 2
  while (taken.includes(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/**
 * The workout Start writes: in progress, stamped with when it started and the gym it runs at (the
 * active one, M4b), so the runner plans there and its sets stay there even after Today switches gyms.
 */
export function newWorkout(input: Pick<Workout, 'id' | 'date' | 'templateId' | 'phase' | 'week' | 'isDeload'> & { startedAt: string; locationId: string }): Workout {
  return { ...input, status: 'in-progress' }
}

export interface YesterdayLine {
  label: string
  result: ReadingResult
  /** Whether a morning check already applies to it; until one does, the engine reads it as unknown. */
  checkDone: boolean
}

/** Yesterday's sessions with their readings, from the engine's subject readings. Empty when there was none. */
export function yesterdayReadings(today: IsoDate, history: HistoryLike, templates: readonly SessionTemplate[], injuredSide: Side): YesterdayLine[] {
  const yesterday = addDays(today, -1)
  const records = attachChecks(history.workouts, history.setLogs, history.morningChecks)
  return subjectReadings(records, history.runs, history.morningChecks, injuredSide)
    .filter((s) => s.date === yesterday)
    .map((s) => {
      let label = 'Run'
      if (s.kind === 'workout') {
        const workout = history.workouts.find((w) => w.id === s.id)
        label = workout ? workoutLabel(workout, templates) : 'Session'
      } else {
        const run = history.runs.find((r) => r.id === s.id)
        if (run) label = runLabel(run.type)
      }
      const checkDone = history.morningChecks.some((c) => morningCheckApplies(c, { kind: s.kind, id: s.id, date: s.date }))
      return { label, result: s.result, checkDone }
    })
}

export interface OpenWorkout {
  workoutId: string
  label: string
  dateWords: string
  /** The gym stamped at Start; absent on a session stamped with none, which ran at Planet Fitness. */
  locationId?: string
}

/**
 * Workouts neither finished nor abandoned, other than the one Today resumes: the engine cannot read
 * them until they are closed, so the screen lists them whatever day they carry.
 */
export function openWorkouts(workouts: readonly Workout[], templates: readonly SessionTemplate[], resumingId: string | null = null): OpenWorkout[] {
  return workouts
    .filter((w) => w.status === 'in-progress' && w.id !== resumingId)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startedAt ?? '').localeCompare(b.startedAt ?? ''))
    .map((w) => ({ workoutId: w.id, label: workoutLabel(w, templates), dateWords: dateWords(w.date), ...(w.locationId ? { locationId: w.locationId } : {}) }))
}

/**
 * "Session A from Monday, November 2 is still open.", and when the gym it runs at (`liftGym`: the
 * one stamped at Start) is not the active one, "… is still open at Marriott Downtown.", as Resume
 * names it: Open carries on there, not at the gym Today plans for.
 */
export function openWorkoutWords(open: OpenWorkout, active: Location, locations: readonly Location[]): string {
  const gym = liftGym({ status: 'in-progress', ...(open.locationId ? { locationId: open.locationId } : {}) }, active, locations)
  const line = `${open.label} from ${open.dateWords} is still open`
  return gym.id === active.id ? `${line}.` : `${line} at ${gym.name}.`
}

export type TodayBody =
  | { kind: 'stop'; headline: string; items: string[] }
  | { kind: 'before-start'; line: string }
  | {
      kind: 'lift'
      letter: SessionLetter
      label: string
      week: number
      /** The week of the phase (what `locationCoverage` and the plan read the banded slots by). */
      phaseWeek: number
      isDeload: boolean
      /** Null when the phase has no session written (Phase 4). */
      template: SessionTemplate | null
      /** Today's stored workout for this session letter, in any phase (todaysLift), if one exists. */
      workout: Workout | null
      /**
       * The workout's phase when it was started before the phase advanced; `template` is then its
       * own. Null when there is no workout or it is the current phase's (PROGRAM-QUESTIONS 117).
       */
      earlierPhase: number | null
      /** The finished workout's reading, in the engine's words. */
      reading: Reading | null
      checkDone: boolean
    }
  | {
      kind: 'run'
      label: string
      note: string | null
      /** The engine's suggestion for today's run (miles under the week's ceiling, strides, tempo, a swap). */
      suggestion: RunSuggestion | null
      /** This morning's reading, from today's check; null with no check yet. */
      morning: ReadingResult | null
      /** This week's miles so far and the week's target (null outside the plan), with why when capped. */
      weekMiles: number
      target: number | null
      /** The rule's own flag: true exactly when rule 7 put the target below the plan's number. */
      capped: boolean
      targetReason: string
      /** Runs already logged today. */
      loggedToday: Run[]
    }
  | { kind: 'off'; label: string }

type RunBody = Extract<TodayBody, { kind: 'run' }>

/**
 * The engine's suggestion as the screen prints it: "Suggested: " and the rule's own headline, then
 * each reason as a sentence. Nothing here writes a prescription; the miles, swap or "easy, by feel"
 * all come from suggestRun.
 */
export function suggestionWords(suggestion: Pick<RunSuggestion, 'headline' | 'reasons'>): { headline: string; reasons: string[] } {
  return {
    headline: `Suggested: ${suggestion.headline}`,
    reasons: suggestion.reasons.map((r) => `${r.charAt(0).toUpperCase()}${r.slice(1)}.`),
  }
}

/**
 * "This week: 3 of 10 miles", and the cap's reason after it only when the rule says it capped the
 * week ("· last week read hold: capped at last week’s 6 miles"); "This week: 2 miles" outside the plan.
 */
export function runWeekWords(body: Pick<RunBody, 'weekMiles' | 'target' | 'capped' | 'targetReason'>): string {
  if (body.target === null) return `This week: ${body.weekMiles} miles`
  const line = `This week: ${body.weekMiles} of ${body.target} miles`
  return body.capped ? `${line} · ${body.targetReason}` : line
}

export interface TodayView {
  dateWords: string
  phaseNumber: number
  phaseName: string
  /** False when the program has no session written for the phase (Phase 4): nothing can be started. */
  phaseHasSessions: boolean
  /** Null before the program starts. */
  week: number | null
  deload: boolean
  body: TodayBody
  yesterday: YesterdayLine[]
  open: OpenWorkout[]
}

/** Everything the Today screen renders, from today's date, the settings, the stored history and the program. */
export function todayView(input: { today: IsoDate; settings: Settings; history: HistoryLike; program: ProgramLike }): TodayView {
  const { today, settings, history, program } = input
  const scheduled = scheduledSession(today, settings.startDate, program.weeklyTemplate, history.sessionMoves)
  const week = scheduled.session === null ? null : scheduled.week
  const letter = scheduled.session === null ? null : sessionLetter(scheduled.session)
  const workout = letter ? todaysLift(history.workouts, today, letter, program.templates) : null
  const own = workout ? (program.templates.find((t) => t.id === workout.templateId) ?? null) : null
  const earlierPhase = own && own.phase !== settings.currentPhase ? own.phase : null
  // A day's lift keeps its own template; with none yet, the current phase's is the one Start writes.
  const template = own ?? (letter ? (program.templates.find((t) => t.phase === settings.currentPhase && t.letter === letter) ?? null) : null)
  const base = {
    dateWords: dateWords(today),
    phaseNumber: settings.currentPhase,
    phaseName: phaseName(program.phases, settings.currentPhase),
    phaseHasSessions: program.templates.some((t) => t.phase === settings.currentPhase),
    week,
    deload: week !== null && isDeloadWeek(week),
    yesterday: yesterdayReadings(today, history, program.templates, settings.injuredSide),
    open: openWorkouts(history.workouts, program.templates, workout?.status === 'in-progress' ? workout.id : null),
  }

  const stop = stopMessage(settings.redFlag, program.redFlags)
  if (stop) return { ...base, body: { kind: 'stop', headline: stop.headline, items: stop.items } }
  if (scheduled.session === null || week === null) {
    return { ...base, body: { kind: 'before-start', line: `Week 1 starts ${shortDateWords(settings.startDate)}` } }
  }

  const session = scheduled.session
  const phaseWeek = phaseWeekOf(Math.max(week, settings.phaseEnteredWeek), settings.phaseEnteredWeek)
  if (letter) {
    const [record] = workout && workout.status === 'finished' ? attachChecks([workout], history.setLogs, history.morningChecks) : []
    const reading = record ? workoutReading(record, settings.injuredSide) : null
    const checkDone = record?.morningCheck !== undefined
    return {
      ...base,
      body: { kind: 'lift', letter, label: sessionLabel(session), week, phaseWeek, isDeload: isDeloadWeek(week), template, workout, earlierPhase, reading, checkDone },
    }
  }
  if (session === 'off') return { ...base, body: { kind: 'off', label: sessionLabel(session, program.weeklyTemplateRows) } }
  const records = attachChecks(history.workouts, history.setLogs, history.morningChecks)
  const readings = subjectReadings(records, history.runs, history.morningChecks, settings.injuredSide)
  const target = targetForWeek(program.mileagePlan, week, settings.startDate, history.runs, readings)
  const before = runsInWeek(history.runs, settings.startDate, week).filter((r) => r.date < today)
  const todays = history.runs.filter((r) => r.date === today)
  const check = history.morningChecks.find((c) => c.date === today)
  const morning = check ? morningReading(check).result : null
  const suggestion = suggestRun({
    session,
    week,
    target: target.target,
    milesSoFar: weekMiles(before),
    currentPhase: settings.currentPhase,
    phaseWeek,
    morning,
  })
  return {
    ...base,
    body: {
      kind: 'run',
      label: sessionLabel(session),
      note: sessionNote(session, program.weeklyTemplateRows),
      suggestion,
      morning,
      weekMiles: weekMiles([...before, ...todays]),
      target: target.target,
      capped: target.capped,
      targetReason: target.reason,
      loggedToday: todays,
    },
  }
}

// ---- Where you train (M4b, design section 5): the gym line, Change, what moves, mark-offs ----

/** Where Change's "New location" goes: the location editor, started new (`#/location/new`, the brief's route). */
export const NEW_LOCATION_HASH = '#/location/new'

/** "At Planet Fitness": the gym Today plans for, under the date. */
export function atGymWords(location: Pick<Location, 'name'>): string {
  return `At ${location.name}`
}

export interface GymRow {
  id: string
  name: string
  active: boolean
  /** "✓ Active" on the active gym; "Use here" on the others, which is what a tap does. */
  mark: string
}

/** Change's rows: every gym a list offers (`listedLocations`: archived ones leave it), Planet Fitness first, the active one marked in words. */
export function gymRows(locations: readonly Location[], activeId: string): GymRow[] {
  return listedLocations(locations).map((l) => ({ id: l.id, name: l.name, active: l.id === activeId, mark: l.id === activeId ? '✓ Active' : 'Use here' }))
}

/** "Start Session A", "Resume Session A", and "Resume Session A at Marriott Downtown" when the session's gym is not the active one. */
export function startWords(label: string, workout: Pick<Workout, 'status'> | null, gym: Pick<Location, 'id' | 'name'>, active: Pick<Location, 'id'>): string {
  if (workout?.status !== 'in-progress' && workout?.status !== 'abandoned') return `Start ${label}`
  return gym.id === active.id ? `Resume ${label}` : `Resume ${label} at ${gym.name}`
}

export type ItemLike = Pick<Equipment, 'id' | 'name' | 'carried'>

/** A list name inside a sentence: "seated leg press", but "Smith machine", which program.md capitalizes. */
export function itemWords(name: string): string {
  return /^Smith\b/.test(name) ? name : `${name.charAt(0).toLowerCase()}${name.slice(1)}`
}

function itemName(id: EquipmentId, items: readonly ItemLike[]): { name: string; carried: boolean } {
  const item = items.find((i) => i.id === id)
  return item ? { name: item.name, carried: item.carried } : { name: id.replace(/-/g, ' '), carried: false }
}

/**
 * What a gym lacks, in words: "no Smith machine", "no cable ankle strap in your bag" for an item
 * carried to every gym (`Settings.kit`), and each item of an either-or ("no step platforms, no stair").
 */
export function lackWords(missing: readonly Requirement[], items: readonly ItemLike[]): string {
  return missing
    .flatMap((r) => (typeof r === 'string' ? [r] : r.anyOf))
    .map((id) => {
      const { name, carried } = itemName(id, items)
      return carried ? `no ${itemWords(name)} in your bag` : `no ${itemWords(name)}`
    })
    .join(', ')
}

function rackWords(rackLb: number): string {
  return rackLb > 0 ? `past the ${rackLb} lb rack` : 'no dumbbells here'
}

function cappedWords(rackLb: number): string {
  return rackLb > 0 ? `rack-capped at ${rackLb} lb, so it won’t count as clean` : 'bodyweight and rack-capped with no dumbbells here, so it won’t count as clean'
}

/**
 * One of `gymChanges`' changes: "Leg press, both legs → Goblet squat to a bench (no seated leg
 * press)", "Dumbbell Romanian deadlift → Single-leg RDL (past the 25 lb rack)", "Incline dumbbell
 * press: rack-capped at 25 lb, so it won’t count as clean", or for a slot with nothing here,
 * "Nothing here for Step-off landing … (no step platforms)". The words in brackets are what the
 * exercise the gym took the slot off lacks, then the rack.
 */
export function changeWords(change: GymChange, byId: ExerciseLookup, items: readonly ItemLike[], rackLb: number): string {
  const name = (id: string) => byId.get(id)?.name ?? id
  if (change.kind === 'capped') return `${name(change.from)}: ${cappedWords(rackLb)}`
  const why = [...(change.missing.length > 0 ? [lackWords(change.missing, items)] : []), ...(change.pastRack ? [rackWords(rackLb)] : []), ...(change.rackCapped ? [cappedWords(rackLb)] : [])]
  const lack = why.length > 0 ? ` (${why.join('; ')})` : ''
  return change.kind === 'none' ? `Nothing here for ${name(change.from)}${lack}` : `${name(change.from)} → ${name(change.to)}${lack}`
}

/**
 * What changes at the session's gym for today's lift, in session order, read off the plan the runner
 * runs there (`gymChanges`): the gym's moves from where each slot's history put it, the slots with
 * nothing here, and what the rack moves or caps. Empty when every slot runs as planned.
 */
export function liftChanges(input: {
  /** `planSession`'s plans at the session's gym, as the runner plans it (no swap chosen yet). */
  plans: readonly { slot: Pick<Slot, 'id'>; exercise: Pick<Exercise, 'id'>; route: SlotRoute; prescriptions: PlannedSlot['prescriptions'] }[]
  byId: ExerciseLookup
  items: readonly ItemLike[]
  /** The gym's heaviest dumbbell. */
  rackLb: number
}): string[] {
  const planned = input.plans.map((p) => ({ slotId: p.slot.id, exerciseId: p.exercise.id, route: p.route, prescriptions: p.prescriptions }))
  return gymChanges(planned).map((change) => changeWords(change, input.byId, input.items, input.rackLb))
}

/**
 * The line over the list: "3 slots of Session A change at Marriott Downtown:", or "Nothing in
 * Session A changes at Planet Fitness." Change, not move: the list counts a slot with nothing here
 * too, which stays where it is for Skip or Do it anyway.
 */
export function movesHeading(gymName: string, label: string, count: number): string {
  if (count === 0) return `Nothing in ${label} changes at ${gymName}.`
  return `${count} ${count === 1 ? 'slot' : 'slots'} of ${label} ${count === 1 ? 'changes' : 'change'} at ${gymName}:`
}

export interface MarkOffLine {
  itemId: EquipmentId
  /** "Seated leg press marked not here since Nov 10"; the screen puts "It's back" after it. */
  words: string
}

/** Each item marked not here at a gym (from the runner or Today), in the order marked, with the day. */
export function markOffLines(location: Pick<Location, 'markedOff'>, items: readonly ItemLike[]): MarkOffLine[] {
  return location.markedOff.map((m) => ({ itemId: m.id, words: `${itemName(m.id, items).name} marked not here since ${monthDayWords(m.on)}` }))
}

/** A Hold run day at a gym with neither swap machine (Shawn's Nov 1 answer 7). */
export function noSwapMachineWords(gymName: string): string {
  return `No elliptical or rower at ${gymName}`
}

const MORNING_WORDS: Record<ReadingResult, string> = { clean: 'clean', hold: 'hold', 'back-off': 'back off' }

/** Why nothing is suggested at a gym with neither machine: he picks. */
export function noSwapSuggestedWords(morning: ReadingResult | null): string {
  const read = morning ? `This morning read ${MORNING_WORDS[morning]}` : 'This morning calls for a swap'
  return `${read}, and program.md names no swap but those two, so nothing is suggested: pick what you did.`
}

const BOTH_MACHINES = 'elliptical or rower'
const MACHINE_WORDS: Record<RunSwapType, string> = { 'elliptical-swap': 'elliptical', 'rower-swap': 'rower' }

/**
 * The engine's swap headline with only the machine the call takes: "a 30 to 40 minute rower swap"
 * for "a 30 to 40 minute elliptical or rower swap". Should the engine's words ever stop naming both,
 * the swap's own name ("Rower swap"), so Today never offers a machine the gym doesn't have.
 */
export function swapHeadlineAt(headline: string, type: RunSwapType): string {
  return headline.includes(BOTH_MACHINES) ? headline.replace(BOTH_MACHINES, MACHINE_WORDS[type]) : runLabel(type)
}

/**
 * Today's run suggestion at the active gym: the engine's words (`suggestionWords`), except when it
 * calls for a swap (`swapCallAt`). Then the headline names only the first swap here, elliptical then
 * rower, as the run logger does (design section 7: Hold-day swaps offer only machines that are
 * there); with neither here, nothing is suggested and the line says neither is here.
 */
export function runSuggestionAtGym(
  suggestion: Pick<RunSuggestion, 'headline' | 'reasons' | 'swapSuggested'>,
  at: { available: Available; gymName: string; morning: ReadingResult | null },
): { headline: string; reasons: string[] } {
  const call = swapCallAt(suggestion, at.available)
  if (call?.kind === 'neither') {
    return { headline: noSwapMachineWords(at.gymName), reasons: [noSwapSuggestedWords(at.morning)] }
  }
  const words = suggestionWords(suggestion)
  return call?.kind === 'take' ? { ...words, headline: `Suggested: ${swapHeadlineAt(suggestion.headline, call.type)}` } : words
}

// ---- The export reminder (M6 brief, section 2): iOS can evict a home-screen app's storage ----

/**
 * Today's one quiet line about the backup: "No export in 9 days" once the last export is more than
 * a week old, or, never exported, once the first thing logged is (src/rules/backup.ts
 * `exportNudge`); null otherwise, and with nothing logged.
 */
export function exportLine(lastExportedAt: IsoDateTime | undefined, today: IsoDate, history: Pick<History, 'workouts' | 'runs' | 'morningChecks' | 'gateTests'>): string | null {
  const nudge = exportNudge(lastExportedAt, today, loggedRange(history).first)
  if (!nudge) return null
  return nudge.kind === 'since-export' ? `No export in ${nudge.days} days` : `No export yet; the logs go back ${nudge.days} days`
}

// ---- The KOOS due line (Batch A): monthly means 28 days, PROGRAM-QUESTIONS 158 ----

/**
 * Today's one quiet line about the questionnaire, in the export line's shape: "A KOOS check is
 * due" once the latest entry is 28 or more days old, or none is stored yet (src/rules/koos.ts
 * `koosDue`); null otherwise, and while the entries are still loading — a line that flashes
 * before the read lands would say something wrong. It routes to the form and carries NO score:
 * scores show on Progress only.
 */
export function koosLine(entries: readonly KoosEntry[] | undefined, today: IsoDate): string | null {
  if (entries === undefined) return null
  return koosDue(entries, today) ? 'A KOOS check is due' : null
}
