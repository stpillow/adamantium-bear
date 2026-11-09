import { describe, expect, it } from 'vitest'
import { parseHash, routeHash } from '../app/router.ts'
import { program } from '../program/program.ts'
import { planSession } from '../app/session.ts'
import type { History } from '../db/repo.ts'
import { suggestRun, type RunSuggestion } from '../rules/weekPlan.ts'
import type { Location, MorningCheck, Run, SessionTemplate, SetLog, Settings, Workout } from '../schema/index.ts'
import {
  NEW_LOCATION_HASH,
  atGymWords,
  dateWords,
  earlierPhaseWords,
  exportLine,
  koosLine,
  gymRows,
  itemWords,
  lackWords,
  liftChanges,
  markOffLines,
  monthDayWords,
  movesHeading,
  noSwapMachineWords,
  noSwapSuggestedWords,
  runSuggestionAtGym,
  startWords,
  newWorkout,
  newWorkoutId,
  openWorkoutWords,
  openWorkouts,
  phaseName,
  runLabel,
  runWeekWords,
  suggestionWords,
  swapHeadlineAt,
  sessionLabel,
  sessionLetter,
  sessionNote,
  shortDateWords,
  todayView,
  todaysWorkout,
  workoutLabel,
  yesterdayReadings,
  type HistoryLike,
  type ProgramLike,
} from './Today.helpers.ts'

const START = '2026-11-02'

const template = (id: string, phase: number, letter: 'A' | 'B' | 'C'): SessionTemplate => ({ id, phase, letter, slots: [] })

/** Inline fixtures, not the live seed: these tests pin the screen's wiring, not the program's content. */
const PROGRAM: ProgramLike = {
  phases: [
    { number: 1, name: 'Foundation', weekStart: 1, weekEnd: 3, estimatedDates: 'Nov 2–22', summary: 'Base', notes: [], gateToLeave: 1 },
    { number: 2, name: 'Single-leg strength and balance', weekStart: 4, weekEnd: 7, estimatedDates: 'Nov 23–Dec 20', summary: 'Single leg', notes: [], gateToLeave: 2 },
    { number: 3, name: 'Power', weekStart: 8, weekEnd: 12, estimatedDates: 'Dec 21–Jan 24', summary: 'Power', notes: [], gateToLeave: 3 },
    { number: 4, name: 'Lacrosse', weekStart: 13, weekEnd: null, estimatedDates: 'Jan 25 on', summary: 'Sport', notes: [], gateToLeave: null },
  ],
  weeklyTemplate: { mon: 'run:mbr', tue: 'lift:A', wed: 'run:easy', thu: 'lift:B', fri: 'run:long', sat: 'lift:C', sun: 'off' },
  weeklyTemplateRows: [
    { day: 'Mon', session: 'Run: MBR', notes: 'Easy and conversational' },
    { day: 'Tue', session: 'Lift A', notes: '' },
    { day: 'Wed', session: 'Run: easy', notes: 'Flattest route you have' },
    { day: 'Thu', session: 'Lift B', notes: '' },
    { day: 'Fri', session: 'Run: long', notes: 'The week’s longest run' },
    { day: 'Sat', session: 'Lift C', notes: '' },
    { day: 'Sun', session: 'Off', notes: 'Kona walk and mobility only' },
  ],
  redFlags: [
    { id: 'locking', text: 'Locking or catching: a mechanical block to straightening or bending' },
    { id: 'numbness', text: 'Numbness or tingling below the knee' },
  ],
  templates: [template('p1-a', 1, 'A'), template('p1-b', 1, 'B'), template('p1-c', 1, 'C'), template('p2-a', 2, 'A')],
  mileagePlan: [10, 11, 12, 9, 13, 14, 15, 11, 16, 17, 18, 14].map((targetMiles, i) => ({ week: i + 1, targetMiles, isDown: [4, 8, 12].includes(i + 1) })),
}

const settings = (over: Partial<Settings> = {}): Settings => ({
  injuredSide: 'right',
  startDate: START,
  dumbbellMax: 80,
  restTimerSeconds: 60,
  painPerSet: false,
  currentPhase: 1,
  phaseEnteredWeek: 1,
  redFlag: { active: false, items: [] },
  activeLocationId: 'planet-fitness',
  kit: ['ankle-strap', 'mini-band'],
  ...over,
})
const history = (over: Partial<HistoryLike> = {}): HistoryLike => ({ workouts: [], setLogs: [], morningChecks: [], runs: [], sessionMoves: [], ...over })
const workout = (id: string, date: string, status: Workout['status'], templateId = 'p1-a', startedAt?: string): Workout => ({
  id,
  date,
  templateId,
  phase: 1,
  week: 1,
  isDeload: false,
  status,
  ...(startedAt ? { startedAt } : {}),
})
const set = (workoutId: string, setNumber: number, painDuring: number): SetLog => ({
  id: `${workoutId}:leg-press:both:${setNumber}`,
  workoutId,
  slotId: 'p1a-1',
  exerciseId: 'leg-press',
  setNumber,
  side: 'both',
  load: 8,
  loadUnit: 'plate',
  reps: 12,
  painDuring,
  stopped: false,
})
const check = (date: string, over: Partial<MorningCheck> = {}): MorningCheck => ({
  id: `m-${date}`,
  date,
  appliesTo: null,
  stiffnessUnder30Min: true,
  worseThanYesterday: false,
  visibleSwelling: false,
  warmth: false,
  painChangePoints: 0,
  redFlags: [],
  ...over,
})
const run = (id: string, date: string, maxPain: number): Run => ({ id, date, type: 'mbr', miles: 3, minutes: 30, effort: 'easy', maxPain, strides: false, tempo: false })

describe('date words', () => {
  it('spells the weekday, month and day', () => {
    expect(dateWords('2026-11-03')).toBe('Tuesday, November 3')
    expect(dateWords('2027-01-01')).toBe('Friday, January 1')
    expect(dateWords('2026-11-01')).toBe('Sunday, November 1')
  })
  it('has a short form for the start line', () => {
    expect(shortDateWords('2026-11-02')).toBe('Monday Nov 2')
    expect(shortDateWords('2027-01-25')).toBe('Monday Jan 25')
  })
  it('refuses a string that is not a date', () => {
    expect(() => dateWords('yesterday')).toThrow(RangeError)
    expect(() => shortDateWords('2026-13-01')).toThrow(RangeError)
  })
})

describe('session words', () => {
  it('names lifts, runs and the off day the way the brief does', () => {
    expect(sessionLabel('lift:A')).toBe('Session A')
    expect(sessionLabel('lift:C')).toBe('Session C')
    expect(sessionLabel('run:mbr')).toBe('Run: MBR')
    expect(sessionLabel('run:easy')).toBe('Run: easy')
    expect(sessionLabel('run:long')).toBe('Run: long')
    expect(sessionLabel('off', PROGRAM.weeklyTemplateRows)).toBe('Off: Kona walk and mobility only')
    expect(sessionLabel('off')).toBe('Off')
  })
  it('finds the program’s note for a session, and nothing for a lift', () => {
    expect(sessionNote('run:mbr', PROGRAM.weeklyTemplateRows)).toBe('Easy and conversational')
    expect(sessionNote('off', PROGRAM.weeklyTemplateRows)).toBe('Kona walk and mobility only')
    expect(sessionNote('lift:A', PROGRAM.weeklyTemplateRows)).toBeNull()
    expect(sessionNote('run:long', [])).toBeNull()
  })
  it('extracts the letter from lift days only', () => {
    expect(sessionLetter('lift:B')).toBe('B')
    expect(sessionLetter('run:easy')).toBeNull()
    expect(sessionLetter('off')).toBeNull()
  })
  it('labels runs and swaps', () => {
    expect(runLabel('long')).toBe('Run: long')
    expect(runLabel('elliptical-swap')).toBe('Elliptical swap')
    expect(runLabel('rower-swap')).toBe('Rower swap')
  })
  it('labels a stored workout from its template', () => {
    expect(workoutLabel({ templateId: 'p1-b' }, PROGRAM.templates)).toBe('Session B')
    expect(workoutLabel({ templateId: 'gone' }, PROGRAM.templates)).toBe('Session')
  })
  it('names the phase, with a fallback that still says which phase', () => {
    expect(phaseName(PROGRAM.phases, 1)).toBe('Foundation')
    expect(phaseName(PROGRAM.phases, 4)).toBe('Lacrosse')
    expect(phaseName([], 2)).toBe('Phase 2')
  })
})

describe('todaysWorkout', () => {
  it('prefers the open attempt, then the finished one, then an abandoned one', () => {
    const abandoned = workout('w1', '2026-11-03', 'abandoned', 'p1-a', '2026-11-03T08:00:00Z')
    const open = workout('w2', '2026-11-03', 'in-progress', 'p1-a', '2026-11-03T09:00:00Z')
    const finished = workout('w3', '2026-11-03', 'finished', 'p1-a', '2026-11-03T07:00:00Z')
    expect(todaysWorkout([abandoned, open, finished], '2026-11-03', 'p1-a')?.id).toBe('w2')
    expect(todaysWorkout([abandoned, finished], '2026-11-03', 'p1-a')?.id).toBe('w3')
    expect(todaysWorkout([abandoned], '2026-11-03', 'p1-a')?.id).toBe('w1')
  })
  it('matches the date and the template, or any template when none is known', () => {
    const a = workout('w1', '2026-11-03', 'finished', 'p1-a')
    expect(todaysWorkout([a], '2026-11-04', 'p1-a')).toBeNull()
    expect(todaysWorkout([a], '2026-11-03', 'p1-b')).toBeNull()
    expect(todaysWorkout([a], '2026-11-03', null)?.id).toBe('w1')
    expect(todaysWorkout([], '2026-11-03', 'p1-a')).toBeNull()
  })
  it('takes the most recently started of two with the same status', () => {
    const early = workout('w1', '2026-11-03', 'abandoned', 'p1-a', '2026-11-03T08:00:00Z')
    const late = workout('w2', '2026-11-03', 'abandoned', 'p1-a', '2026-11-03T10:00:00Z')
    expect(todaysWorkout([early, late], '2026-11-03', 'p1-a')?.id).toBe('w2')
  })
})

describe('newWorkout', () => {
  it('is the session Start writes: in progress, stamped with the time and the active gym (M4b)', () => {
    const workout = newWorkout({ id: '2026-11-10-p1-a', date: '2026-11-10', templateId: 'p1-a', phase: 1, week: 2, isDeload: false, startedAt: '2026-11-10T11:00:00.000Z', locationId: 'loc-1' })
    expect(workout).toEqual({
      id: '2026-11-10-p1-a',
      date: '2026-11-10',
      templateId: 'p1-a',
      phase: 1,
      week: 2,
      isDeload: false,
      startedAt: '2026-11-10T11:00:00.000Z',
      status: 'in-progress',
      locationId: 'loc-1',
    })
  })
  it('stamps Planet Fitness too, rather than leaving it to the absent-means-Planet-Fitness reading', () => {
    expect(newWorkout({ id: 'w', date: '2026-11-10', templateId: 'p1-a', phase: 1, week: 2, isDeload: false, startedAt: '2026-11-10T11:00:00.000Z', locationId: 'planet-fitness' }).locationId).toBe('planet-fitness')
  })
})

describe('newWorkoutId', () => {
  it('is the date and the template, with a suffix when that day already has an attempt', () => {
    expect(newWorkoutId('2026-11-03', 'p1-a', [])).toBe('2026-11-03-p1-a')
    expect(newWorkoutId('2026-11-03', 'p1-a', ['2026-11-03-p1-a'])).toBe('2026-11-03-p1-a-2')
    expect(newWorkoutId('2026-11-03', 'p1-a', ['2026-11-03-p1-a', '2026-11-03-p1-a-2'])).toBe('2026-11-03-p1-a-3')
  })
})

describe('yesterdayReadings', () => {
  const lifted = workout('w1', '2026-11-03', 'finished')
  const sets = [set('w1', 1, 2), set('w1', 2, 2), set('w1', 3, 2)]
  it('reads yesterday’s session through the engine, with the morning check attached', () => {
    const h = history({ workouts: [lifted], setLogs: sets, morningChecks: [check('2026-11-04')] })
    expect(yesterdayReadings('2026-11-04', h, PROGRAM.templates, 'right')).toEqual([{ label: 'Session A', result: 'clean', checkDone: true }])
  })
  it('reads hold with the check still to do, and says the check is not done', () => {
    const h = history({ workouts: [lifted], setLogs: sets })
    expect(yesterdayReadings('2026-11-04', h, PROGRAM.templates, 'right')).toEqual([{ label: 'Session A', result: 'hold', checkDone: false }])
  })
  it('includes a run, and nothing from other days', () => {
    const h = history({ workouts: [lifted], setLogs: sets, runs: [run('r1', '2026-11-02', 1)], morningChecks: [check('2026-11-03')] })
    expect(yesterdayReadings('2026-11-03', h, PROGRAM.templates, 'right')).toEqual([{ label: 'Run: MBR', result: 'clean', checkDone: true }])
    expect(yesterdayReadings('2026-11-05', h, PROGRAM.templates, 'right')).toEqual([])
  })
  it('is empty when nothing happened yesterday', () => {
    expect(yesterdayReadings('2026-11-04', history(), PROGRAM.templates, 'right')).toEqual([])
  })
  it('leaves out a session that was never finished; openWorkouts lists it instead', () => {
    const open = workout('w1', '2026-11-03', 'in-progress')
    const h = history({ workouts: [open], setLogs: sets })
    expect(yesterdayReadings('2026-11-04', h, PROGRAM.templates, 'right')).toEqual([])
    expect(openWorkouts(h.workouts, PROGRAM.templates)).toEqual([{ workoutId: 'w1', label: 'Session A', dateWords: 'Tuesday, November 3' }])
  })
})

describe('openWorkouts', () => {
  it('lists every open workout but the one Today resumes, oldest first, today’s included', () => {
    const stale = workout('w0', '2026-11-02', 'in-progress', 'p1-c')
    const resuming = workout('w1', '2026-11-03', 'in-progress', 'p1-a', '2026-11-03T18:00:00Z')
    const moved = workout('w2', '2026-11-03', 'in-progress', 'p1-b', '2026-11-03T17:00:00Z')
    const done = workout('w3', '2026-11-03', 'finished')
    expect(openWorkouts([resuming, done, stale, moved], PROGRAM.templates, 'w1')).toEqual([
      { workoutId: 'w0', label: 'Session C', dateWords: 'Monday, November 2' },
      { workoutId: 'w2', label: 'Session B', dateWords: 'Tuesday, November 3' },
    ])
    expect(openWorkouts([resuming], PROGRAM.templates, 'w1')).toEqual([])
    expect(openWorkouts([resuming], PROGRAM.templates)).toEqual([{ workoutId: 'w1', label: 'Session A', dateWords: 'Tuesday, November 3' }])
  })
})

describe('todayView', () => {
  const view = (today: string, s: Partial<Settings> = {}, h: Partial<HistoryLike> = {}) => todayView({ today, settings: settings(s), history: history(h), program: PROGRAM })

  it('before the start date: the start line, no week, Start disabled by the screen', () => {
    const v = view('2026-11-01')
    expect(v.body).toEqual({ kind: 'before-start', line: 'Week 1 starts Monday Nov 2' })
    expect(v.week).toBeNull()
    expect(v.deload).toBe(false)
    expect(v.dateWords).toBe('Sunday, November 1')
    expect(v.phaseName).toBe('Foundation')
  })
  it('a lift day: the session, its template, phase and week', () => {
    const v = view('2026-11-03')
    expect(v.week).toBe(1)
    expect(v.phaseNumber).toBe(1)
    expect(v.phaseHasSessions).toBe(true)
    expect(v.body).toMatchObject({ kind: 'lift', letter: 'A', label: 'Session A', week: 1, isDeload: false, workout: null, reading: null, checkDone: false })
    expect(v.body.kind === 'lift' && v.body.template?.id).toBe('p1-a')
    expect(v.yesterday).toEqual([])
  })
  it('a deload week says so and stamps the workout as deload', () => {
    const v = view('2026-11-24', { currentPhase: 2, phaseEnteredWeek: 4 })
    expect(v.week).toBe(4)
    expect(v.deload).toBe(true)
    expect(v.phaseName).toBe('Single-leg strength and balance')
    expect(v.body).toMatchObject({ kind: 'lift', letter: 'A', isDeload: true })
    expect(v.body.kind === 'lift' && v.body.template?.id).toBe('p2-a')
  })
  it('a run day points at the run logger with the program’s note; the off day carries its note', () => {
    expect(view('2026-11-02').body).toMatchObject({ kind: 'run', label: 'Run: MBR', note: 'Easy and conversational', target: 10, weekMiles: 0, loggedToday: [] })
    expect(view('2026-11-08').body).toEqual({ kind: 'off', label: 'Off: Kona walk and mobility only' })
  })
  it('follows a moved session', () => {
    const v = view('2026-11-03', {}, { sessionMoves: [{ id: 'mv1', week: 1, dayA: 'tue', dayB: 'wed' }] })
    expect(v.body).toMatchObject({ kind: 'run', label: 'Run: easy' })
  })
  it('the red-flag state replaces the day with the stop message', () => {
    const v = view('2026-11-03', { redFlag: { active: true, since: '2026-11-03', items: ['locking', 'numbness'] } })
    expect(v.body).toEqual({
      kind: 'stop',
      headline: 'Stop. Call the ortho or PT.',
      items: ['Locking or catching: a mechanical block to straightening or bending', 'Numbness or tingling below the knee'],
    })
  })
  it('Phase 4 has no template to start, and says so for every day of the week', () => {
    const stray = workout('w9', '2027-01-26', 'in-progress', 'p3-a')
    const v = view('2027-01-26', { currentPhase: 4, phaseEnteredWeek: 13 }, { workouts: [stray] })
    expect(v.week).toBe(13)
    expect(v.phaseName).toBe('Lacrosse')
    expect(v.phaseHasSessions).toBe(false)
    expect(v.body).toMatchObject({ kind: 'lift', letter: 'A', template: null, workout: null })
    expect(v.open).toEqual([{ workoutId: 'w9', label: 'Session', dateWords: 'Tuesday, January 26' }])
    expect(view('2027-01-27', { currentPhase: 4, phaseEnteredWeek: 13 }).phaseHasSessions).toBe(false)
  })
  it('an open workout today is handed back to resume, not listed as unfinished', () => {
    const open = workout('2026-11-03-p1-a', '2026-11-03', 'in-progress', 'p1-a', '2026-11-03T18:00:00Z')
    const v = view('2026-11-03', {}, { workouts: [open] })
    expect(v.body).toMatchObject({ kind: 'lift', workout: { id: '2026-11-03-p1-a', status: 'in-progress' }, reading: null })
    expect(v.open).toEqual([])
  })
  it('an open workout today for another session is listed as unfinished, not resumed', () => {
    const moved = workout('2026-11-03-p1-b', '2026-11-03', 'in-progress', 'p1-b', '2026-11-03T17:00:00Z')
    const v = view('2026-11-03', {}, { workouts: [moved] })
    expect(v.body).toMatchObject({ kind: 'lift', letter: 'A', workout: null })
    expect(v.open).toEqual([{ workoutId: '2026-11-03-p1-b', label: 'Session B', dateWords: 'Tuesday, November 3' }])
  })
  it('a finished workout today carries its reading in the engine’s words', () => {
    const done = workout('w1', '2026-11-03', 'finished')
    const v = view('2026-11-03', {}, { workouts: [done], setLogs: [set('w1', 1, 2), set('w1', 2, 2), set('w1', 3, 6)] })
    expect(v.body).toMatchObject({ kind: 'lift', workout: { id: 'w1', status: 'finished' }, reading: { result: 'back-off' }, checkDone: false })
    const withCheck = view('2026-11-03', {}, { workouts: [done], setLogs: [set('w1', 1, 2)], morningChecks: [check('2026-11-04')] })
    expect(withCheck.body).toMatchObject({ kind: 'lift', reading: { result: 'clean' }, checkDone: true })
  })
  describe('a phase advanced on a day whose lift is logged keeps that day’s session (PROGRAM-QUESTIONS 117)', () => {
    const phase2 = { currentPhase: 2, phaseEnteredWeek: 4 }
    it('a finished lift stays today’s, under its own template: no new phase’s Start the same day', () => {
      const done = workout('2026-11-17-p1-a', '2026-11-17', 'finished', 'p1-a')
      const before = view('2026-11-17', {}, { workouts: [done], setLogs: [set(done.id, 1, 2)] })
      const after = view('2026-11-17', phase2, { workouts: [done], setLogs: [set(done.id, 1, 2)] })
      expect(before.body).toMatchObject({ kind: 'lift', letter: 'A', workout: { id: done.id, status: 'finished' }, earlierPhase: null })
      expect(after.body).toMatchObject({ kind: 'lift', letter: 'A', workout: { id: done.id, status: 'finished' }, reading: { result: 'hold' }, earlierPhase: 1 })
      expect(after.body.kind === 'lift' && after.body.template?.id).toBe('p1-a')
      expect(after.open).toEqual([])
    })
    it('an attempt ended early in the earlier phase is the day’s lift too, and says the new phase starts next lift day', () => {
      const left = workout('2026-11-17-p1-a', '2026-11-17', 'abandoned', 'p1-a')
      const v = view('2026-11-17', phase2, { workouts: [left] })
      expect(v.body).toMatchObject({ kind: 'lift', workout: { id: left.id, status: 'abandoned' }, earlierPhase: 1 })
      expect(earlierPhaseWords('Session A', 1, PROGRAM.phases, 2)).toBe(
        'Session A was left early today, in Phase 1: Foundation; what was logged is kept. Phase 2: Single-leg strength and balance starts with the next lift day.',
      )
    })
    it('the next lift day starts the new phase’s template', () => {
      const done = workout('2026-11-17-p1-a', '2026-11-17', 'finished', 'p1-a')
      const v = view('2026-11-24', phase2, { workouts: [done] })
      expect(v.body).toMatchObject({ kind: 'lift', letter: 'A', workout: null, earlierPhase: null })
      expect(v.body.kind === 'lift' && v.body.template?.id).toBe('p2-a')
    })
  })
  it('yesterday’s reading and an unfinished session ride along with the day', () => {
    const lifted = workout('w1', '2026-11-03', 'finished')
    const stale = workout('w0', '2026-11-02', 'in-progress', 'p1-c')
    const v = view('2026-11-04', {}, { workouts: [lifted, stale], setLogs: [set('w1', 1, 4)], morningChecks: [check('2026-11-04')] })
    expect(v.body.kind).toBe('run')
    expect(v.yesterday).toEqual([{ label: 'Session A', result: 'hold', checkDone: true }])
    expect(v.open).toEqual([{ workoutId: 'w0', label: 'Session C', dateWords: 'Monday, November 2' }])
  })
})

describe('run days', () => {
  const view = (today: string, s: Partial<Settings> = {}, h: Partial<HistoryLike> = {}) => todayView({ today, settings: settings(s), history: history(h), program: PROGRAM })
  const run = (date: string, miles: number, type: Run['type'] = 'mbr'): Run => ({ id: `r-${date}`, date, type, miles, minutes: 30, effort: 'easy', maxPain: 1, strides: false, tempo: false })
  it('suggests the run’s share of the week, under the ceiling', () => {
    const v = view('2026-11-06', {}, { runs: [run('2026-11-02', 3), run('2026-11-04', 3, 'easy')] })
    expect(v.body).toMatchObject({ kind: 'run', weekMiles: 6, target: 10 })
    expect(v.body.kind === 'run' && v.body.suggestion?.miles).toBe(4)
  })
  it('shows what was already logged today', () => {
    const v = view('2026-11-02', {}, { runs: [run('2026-11-02', 3)] })
    expect(v.body.kind === 'run' && v.body.loggedToday.map((r: Run) => r.miles)).toEqual([3])
  })
  it('shows the cap’s reason only when the rule capped the week (M4 review)', () => {
    // Week 3 (plan 12) logs 12 miles and one run reads hold; week 4 is the down week, plan 9.
    const weekThree = [run('2026-11-16', 3.5), { ...run('2026-11-18', 3.5, 'easy'), maxPain: 4 }, run('2026-11-20', 5, 'long')]
    const checks = ['2026-11-17', '2026-11-19', '2026-11-21'].map((date) => check(date))
    const deload = view('2026-11-23', {}, { runs: weekThree, morningChecks: checks })
    expect(deload.body).toMatchObject({ kind: 'run', target: 9, capped: false })
    expect(deload.body.kind === 'run' && runWeekWords(deload.body)).toBe('This week: 0 of 9 miles')
    // Week 1 logs 6 of 10 with a hold, so week 2 (plan 11) is capped at 6.
    const weekOne = [run('2026-11-02', 3), { ...run('2026-11-04', 3, 'easy'), maxPain: 4 }]
    const capped = view('2026-11-09', {}, { runs: weekOne, morningChecks: [check('2026-11-03'), check('2026-11-05')] })
    expect(capped.body).toMatchObject({ kind: 'run', target: 6, capped: true })
    expect(capped.body.kind === 'run' && runWeekWords(capped.body)).toBe('This week: 0 of 6 miles · last week read hold: capped at last week’s 6 miles')
  })
  it('names no target outside the plan', () => {
    const v = view('2027-01-25', { currentPhase: 3, phaseEnteredWeek: 8 }, { runs: [run('2027-01-25', 2)] })
    expect(v.body).toMatchObject({ kind: 'run', target: null, capped: false })
    expect(v.body.kind === 'run' && runWeekWords(v.body)).toBe('This week: 2 miles')
  })
  it('a hold morning suggests the swap', () => {
    const check = { id: 'm', date: '2026-11-04', appliesTo: null, stiffnessUnder30Min: true, worseThanYesterday: true, visibleSwelling: false, warmth: false, painChangePoints: 1, redFlags: [] }
    const v = view('2026-11-04', {}, { morningChecks: [check] })
    expect(v.body.kind === 'run' && v.body.suggestion?.swapSuggested).toBe(true)
    expect(v.body.kind === 'run' && v.body.suggestion && suggestionWords(v.body.suggestion).headline).toBe('Suggested: a 30 to 40 minute elliptical or rower swap')
  })
  it('prints the engine’s headline and its reasons as sentences, writing no prescription of its own (M4 review)', () => {
    const clean = check('2026-11-06')
    const v = view('2026-11-06', {}, { runs: [run('2026-11-02', 3), run('2026-11-04', 3, 'easy')], morningChecks: [clean] })
    if (v.body.kind !== 'run' || !v.body.suggestion) throw new Error('expected a run suggestion')
    expect(suggestionWords(v.body.suggestion)).toEqual({ headline: `Suggested: ${v.body.suggestion.headline}`, reasons: [] })
    expect(suggestionWords(v.body.suggestion).headline).toBe('Suggested: 4 miles')
    // Outside the plan the engine has no miles; whatever it says is what the screen prints.
    const late = view('2027-01-29', { currentPhase: 3, phaseEnteredWeek: 8 }, { morningChecks: [check('2027-01-29')] })
    if (late.body.kind !== 'run' || !late.body.suggestion) throw new Error('expected a run suggestion')
    expect(suggestionWords(late.body.suggestion).headline).toBe(`Suggested: ${late.body.suggestion.headline}`)
    expect(suggestionWords(late.body.suggestion).reasons).toEqual(late.body.suggestion.reasons.map((r) => `${r.charAt(0).toUpperCase()}${r.slice(1)}.`))
    expect(suggestionWords(late.body.suggestion).reasons).toContain('Carry a 2 × 5 min comfortably-hard segment with 3 min easy between.')
    // ...and the headline over that tempo does not say easy.
    expect(suggestionWords(late.body.suggestion).headline).toBe('Suggested: distance by feel')
  })
})

// ---- Where you train, on Today (M4b Part C) ----

const gym = (id: string, name: string, over: Partial<Location> = {}): Location => ({
  id,
  name,
  present: [],
  dumbbellMaxLb: 0,
  startedFrom: 'empty',
  listVersion: 1,
  extras: [],
  markedOff: [],
  createdOn: '2026-11-02',
  archived: false,
  ...over,
})
const HOME = gym('planet-fitness', 'Planet Fitness', { startedFrom: 'planet-fitness', dumbbellMaxLb: 80, createdOn: '2026-11-01' })
const MARRIOTT = gym('loc-1', 'Marriott Downtown', { dumbbellMaxLb: 25, createdOn: '2026-11-09' })
const OLD_HOTEL = gym('loc-2', 'Old hotel', { createdOn: '2026-11-03', archived: true })
const ITEMS = [
  { id: 'smith-machine', name: 'Smith machine', carried: false },
  { id: 'seated-leg-press', name: 'Seated leg press', carried: false },
  { id: 'leg-press-45', name: '45° leg press', carried: false },
  { id: 'step-platforms', name: 'Step platforms', carried: false },
  { id: 'stair', name: 'Stair', carried: false },
  { id: 'bosu', name: 'Bosu or balance pad', carried: false },
  { id: 'ankle-strap', name: 'Cable ankle strap', carried: true },
]

describe('the gym line and Change', () => {
  it('names the gym Today plans for', () => {
    expect(atGymWords(HOME)).toBe('At Planet Fitness')
    expect(atGymWords(MARRIOTT)).toBe('At Marriott Downtown')
  })
  it('lists every gym that is not archived, Planet Fitness first, with the active one marked', () => {
    expect(gymRows([MARRIOTT, OLD_HOTEL, HOME], 'loc-1')).toEqual([
      { id: 'planet-fitness', name: 'Planet Fitness', active: false, mark: 'Use here' },
      { id: 'loc-1', name: 'Marriott Downtown', active: true, mark: '✓ Active' },
    ])
    expect(gymRows([HOME], 'planet-fitness')).toEqual([{ id: 'planet-fitness', name: 'Planet Fitness', active: true, mark: '✓ Active' }])
  })
  it('ends with New location, which opens the editor on a new gym', () => {
    expect(NEW_LOCATION_HASH).toBe('#/location/new')
    // The router's own route, both ways, so the link can't drift to a hash that lands back on Today.
    expect(parseHash(NEW_LOCATION_HASH)).toEqual({ name: 'new-location' })
    expect(routeHash({ name: 'new-location' })).toBe(NEW_LOCATION_HASH)
  })
})

describe('the Start button at a gym', () => {
  it('Start names the session; Resume names the gym only when it is not the active one', () => {
    expect(startWords('Session A', null, HOME, HOME)).toBe('Start Session A')
    expect(startWords('Session A', { status: 'in-progress' }, HOME, HOME)).toBe('Resume Session A')
    expect(startWords('Session A', { status: 'in-progress' }, MARRIOTT, HOME)).toBe('Resume Session A at Marriott Downtown')
    expect(startWords('Session A', { status: 'abandoned' }, MARRIOTT, HOME)).toBe('Resume Session A at Marriott Downtown')
  })
})

describe('an open session from another day at a gym', () => {
  it('carries the gym stamped at Start, none for a session stamped with none', () => {
    const away = { ...workout('w0', '2026-11-02', 'in-progress', 'p1-c'), locationId: 'loc-1' }
    expect(openWorkouts([away, workout('w1', '2026-11-03', 'in-progress')], PROGRAM.templates)).toEqual([
      { workoutId: 'w0', label: 'Session C', dateWords: 'Monday, November 2', locationId: 'loc-1' },
      { workoutId: 'w1', label: 'Session A', dateWords: 'Tuesday, November 3' },
    ])
  })
  it('names the gym it runs at only when that is not the active one, as Resume does', () => {
    const open = { workoutId: 'w0', label: 'Session C', dateWords: 'Monday, November 2', locationId: 'loc-1' }
    expect(openWorkoutWords(open, HOME, [HOME, MARRIOTT])).toBe('Session C from Monday, November 2 is still open at Marriott Downtown.')
    expect(openWorkoutWords(open, MARRIOTT, [HOME, MARRIOTT])).toBe('Session C from Monday, November 2 is still open.')
    // Stamped with no gym: it ran at Planet Fitness.
    const unstamped = { workoutId: 'w1', label: 'Session A', dateWords: 'Tuesday, November 3' }
    expect(openWorkoutWords(unstamped, MARRIOTT, [HOME, MARRIOTT])).toBe('Session A from Tuesday, November 3 is still open at Planet Fitness.')
    expect(openWorkoutWords(unstamped, HOME, [HOME, MARRIOTT])).toBe('Session A from Tuesday, November 3 is still open.')
    // Archived since: the session still runs there.
    const archived = { ...open, locationId: 'loc-2' }
    expect(openWorkoutWords(archived, HOME, [HOME, OLD_HOTEL])).toBe('Session C from Monday, November 2 is still open at Old hotel.')
  })
})

describe('equipment in words', () => {
  it('lowercases a list name inside a sentence, but not the Smith machine', () => {
    expect(itemWords('Seated leg press')).toBe('seated leg press')
    expect(itemWords('Smith machine')).toBe('Smith machine')
    expect(itemWords('45° leg press')).toBe('45° leg press')
  })
  it('says what is missing, with carried items as not in the bag', () => {
    expect(lackWords(['smith-machine'], ITEMS)).toBe('no Smith machine')
    expect(lackWords(['ankle-strap'], ITEMS)).toBe('no cable ankle strap in your bag')
    expect(lackWords([{ anyOf: ['step-platforms', 'stair'] }], ITEMS)).toBe('no step platforms, no stair')
    expect(lackWords(['seated-leg-press', 'leg-press-45'], ITEMS)).toBe('no seated leg press, no 45° leg press')
  })
  it('names an item the list does not carry from its id', () => {
    expect(lackWords(['kettlebell-rack'], ITEMS)).toBe('no kettlebell rack')
  })
  it('a mark-off says since when', () => {
    expect(monthDayWords('2026-11-10')).toBe('Nov 10')
    expect(monthDayWords('2027-01-04')).toBe('Jan 4')
    const marked = { ...MARRIOTT, markedOff: [{ id: 'seated-leg-press', on: '2026-11-10' }, { id: 'smith-machine', on: '2026-11-12' }] }
    expect(markOffLines(marked, ITEMS)).toEqual([
      { itemId: 'seated-leg-press', words: 'Seated leg press marked not here since Nov 10' },
      { itemId: 'smith-machine', words: 'Smith machine marked not here since Nov 12' },
    ])
    expect(markOffLines(HOME, ITEMS)).toEqual([])
  })
})

describe('what changes at a gym (live seed, from the plan the runner runs)', () => {
  const byId = new Map(program.exercises.map((e) => [e.id, e]))
  const template = (id: string) => {
    const t = program.templates.find((x) => x.id === id)
    if (!t) throw new Error(`no template ${id}`)
    return t
  }
  const none: History = { workouts: [], setLogs: [], morningChecks: [], runs: [], gateTests: [], sessionMoves: [] }
  /** Today's list for a session at a gym: planSession there, as the runner plans it, then its changes in words. */
  const changes = (t: SessionTemplate, location: Location, opts: { kit?: readonly string[]; history?: History; week?: number; settings?: Settings; before?: string } = {}) => {
    const plans = planSession({ template: t, week: opts.week ?? 2, settings: opts.settings ?? settings(), history: opts.history ?? none, gym: { location, kit: opts.kit ?? ['ankle-strap', 'mini-band'] }, before: opts.before ?? '2026-11-10' })
    return liftChanges({ plans, byId, items: program.equipment, rackLb: location.dumbbellMaxLb })
  }
  const home = { ...HOME, present: [...program.planetFitness, 'leg-press-45', 'rower'] }
  const done = (id: string, date: string, templateId: string, phase: number, week: number): Workout => ({ id, date, templateId, phase, week, isDeload: false, status: 'finished' })
  const threeSets = (workoutId: string, slotId: string, exerciseId: string, over: Partial<SetLog>): SetLog[] =>
    [1, 2, 3].map((n) => ({ id: `${workoutId}-${exerciseId}-${n}`, workoutId, slotId, exerciseId, setNumber: n, side: 'both', load: 0, loadUnit: 'lb', reps: 10, rpe: 7, painDuring: 2, stopped: false, ...over }))

  it('nothing changes at the home gym', () => {
    for (const t of program.templates) expect(changes(t, home), t.id).toEqual([])
  })
  it('a slot moves for want of a carried item, said as not in the bag', () => {
    expect(changes(template('p1-c'), home, { kit: ['mini-band'] })).toEqual(['Cable hip abduction, ankle strap → Lateral band walk (no cable ankle strap in your bag)'])
  })
  it('a gym with a few things moves each slot to the first one there, saying what the own exercise lacks', () => {
    const moves = changes(template('p1-a'), { ...MARRIOTT, present: ['flat-bench', 'cable-station', 'mats'] })
    expect(moves).toContain('Leg press, both legs → Goblet squat to a bench (no seated leg press)')
    expect(moves).toContain('Hip abductor machine → Cable hip abduction, ankle strap (no hip abductor machine)')
    expect(moves).toContain('Lat pulldown → Single-arm cable pulldown (no lat pulldown)')
  })
  it('a slot with nothing on its list here says so', () => {
    const moves = changes(template('p3-a'), { ...MARRIOTT, present: [] }, { settings: settings({ currentPhase: 3, phaseEnteredWeek: 8 }), week: 8, before: '2026-12-22' })
    expect(moves).toContain('Nothing here for Step-off landing from a 6–8 in. step, stuck for 2 s (no step platforms)')
  })
  it('a mark-off moves the slot like a missing item', () => {
    expect(changes(template('p1-a'), { ...home, markedOff: [{ id: 'seated-leg-press', on: '2026-11-10' }] })).toEqual(['Leg press, both legs → 45° leg press (no seated leg press)'])
  })

  it('what the rack moves or caps is listed too, as the runner runs it (M4b review)', () => {
    // Home Session C ran the RDL at 50 lb, the farmer’s carry at 50 lb each and the incline press at 35 lb, all clean.
    const marriott = { ...MARRIOTT, present: ['flat-bench', 'adjustable-bench', 'step-platforms', 'back-extension-bench', 'cable-station', 'leg-extension-machine'] }
    const last = done('w1', '2026-11-07', 'p1-c', 1, 1)
    const history: History = {
      ...none,
      workouts: [last],
      setLogs: [...threeSets('w1', 'p1c-2', 'db-rdl', { load: 50 }), ...threeSets('w1', 'p1c-7', 'farmers-carry', { load: 50 }), ...threeSets('w1', 'p1c-4', 'incline-db-press', { load: 35 })],
      morningChecks: [check('2026-11-08')],
    }
    expect(changes(template('p1-c'), marriott, { history, before: '2026-11-14' })).toEqual([
      'Dumbbell Romanian deadlift → Single-leg RDL (past the 25 lb rack)',
      'Assisted pull-up → Single-arm cable pulldown (no assisted pull-up/dip machine)',
      'Incline dumbbell press: rack-capped at 25 lb, so it won’t count as clean',
      "Farmer's carry → Suitcase carry (past the 25 lb rack)",
    ])
  })

  it('a slot its history moved is listed from where the history put it, as the runner routes it (PROGRAM-QUESTIONS 86)', () => {
    // Phase 3 A: the Nordics backed off onto the single-leg seated leg curl, which then ran clean once.
    const phase3 = settings({ currentPhase: 3, phaseEnteredWeek: 8 })
    const history: History = {
      ...none,
      workouts: [done('w1', '2026-12-29', 'p3-a', 3, 9), done('w2', '2027-01-05', 'p3-a', 3, 10)],
      setLogs: [...threeSets('w1', 'p3a-2', 'nordic-negatives', { loadUnit: 'none', reps: 3, painDuring: 6 }), ...threeSets('w2', 'p3a-2', 'single-leg-seated-leg-curl', { load: 40 })],
      morningChecks: [check('2026-12-30'), check('2027-01-06')],
    }
    // A hotel with mats and a lat pulldown, so the Nordics are here, and no leg curl.
    const hotel = { ...MARRIOTT, present: ['mats', 'lat-pulldown', 'flat-bench', 'cable-station'] }
    const moves = changes(template('p3-a'), hotel, { history, settings: phase3, week: 11, before: '2027-01-12' })
    expect(moves).toContain('Nothing here for Single-leg seated leg curl (no seated leg curl)')
    expect(moves.some((m) => m.startsWith('Nordic'))).toBe(false)
  })
  it('says how many slots change, or that none does: a slot with nothing here changes but doesn’t move', () => {
    expect(movesHeading('Marriott Downtown', 'Session A', 3)).toBe('3 slots of Session A change at Marriott Downtown:')
    expect(movesHeading('Marriott Downtown', 'Session A', 1)).toBe('1 slot of Session A changes at Marriott Downtown:')
    expect(movesHeading('Planet Fitness', 'Session A', 0)).toBe('Nothing in Session A changes at Planet Fitness.')
  })
})

describe('a Hold run day at a gym', () => {
  const swapDay: Pick<RunSuggestion, 'headline' | 'reasons' | 'swapSuggested'> = {
    headline: 'a 30 to 40 minute elliptical or rower swap',
    reasons: ['this morning read hold: an elliptical or rower swap at the same effort is the call'],
    swapSuggested: true,
  }
  it('with a swap machine here, names only the first one here, elliptical then rower, as the logger does', () => {
    expect(runSuggestionAtGym(swapDay, { available: new Set(['rower']), gymName: 'Marriott Downtown', morning: 'hold' })).toEqual({
      headline: 'Suggested: a 30 to 40 minute rower swap',
      reasons: suggestionWords(swapDay).reasons,
    })
    expect(runSuggestionAtGym(swapDay, { available: new Set(['elliptical', 'rower']), gymName: 'Planet Fitness', morning: 'hold' }).headline).toBe(
      'Suggested: a 30 to 40 minute elliptical swap',
    )
  })
  it('names the machine in the engine’s own words on a hold and a back-off morning (live rule)', () => {
    const day = { session: 'run:easy' as const, week: 1, target: 10, milesSoFar: 0, currentPhase: 1, phaseWeek: 1 }
    for (const morning of ['hold', 'back-off'] as const) {
      const s = suggestRun({ ...day, morning })
      if (!s) throw new Error('no suggestion')
      expect(swapHeadlineAt(s.headline, 'rower-swap'), morning).toBe('a 30 to 40 minute rower swap')
    }
  })
  it('if the engine’s words ever stop naming both machines, says the swap by its name', () => {
    expect(swapHeadlineAt('a swap', 'elliptical-swap')).toBe('Elliptical swap')
  })
  it('with neither machine here, suggests nothing and says neither is here (Shawn’s Nov 1 answer 7)', () => {
    expect(noSwapMachineWords('Marriott Downtown')).toBe('No elliptical or rower at Marriott Downtown')
    expect(runSuggestionAtGym(swapDay, { available: new Set(['treadmill']), gymName: 'Marriott Downtown', morning: 'hold' })).toEqual({
      headline: 'No elliptical or rower at Marriott Downtown',
      reasons: ['This morning read hold, and program.md names no swap but those two, so nothing is suggested: pick what you did.'],
    })
    expect(noSwapSuggestedWords('back-off')).toBe('This morning read back off, and program.md names no swap but those two, so nothing is suggested: pick what you did.')
  })
  it('a run with no swap called is the engine’s run, whatever the gym has', () => {
    const run = { headline: '4 miles', reasons: [], swapSuggested: false }
    expect(runSuggestionAtGym(run, { available: new Set(), gymName: 'Marriott Downtown', morning: 'clean' })).toEqual(suggestionWords(run))
  })
  it('todayView carries the morning’s reading on a run day, and the phase week on a lift day', () => {
    const hold = check('2026-11-04', { worseThanYesterday: true })
    const runDay = todayView({ today: '2026-11-04', settings: settings(), history: history({ morningChecks: [hold] }), program: PROGRAM })
    expect(runDay.body).toMatchObject({ kind: 'run', morning: 'hold' })
    const noCheck = todayView({ today: '2026-11-02', settings: settings(), history: history(), program: PROGRAM })
    expect(noCheck.body).toMatchObject({ kind: 'run', morning: null })
    const lift = todayView({ today: '2026-11-24', settings: settings({ currentPhase: 2, phaseEnteredWeek: 4 }), history: history(), program: PROGRAM })
    expect(lift.body).toMatchObject({ kind: 'lift', week: 4, phaseWeek: 1 })
  })
})

describe('the export reminder (M6)', () => {
  const run = (date: string): Run => ({ id: `run-${date}`, date, type: 'mbr', miles: 3, minutes: 30, effort: 'easy', maxPain: 0, strides: false, tempo: false })
  const logged = { workouts: [], runs: [run('2026-11-02'), run('2026-11-04')], morningChecks: [], gateTests: [] }
  const none = { workouts: [], runs: [], morningChecks: [], gateTests: [] }

  it('says nothing until the last export is more than 7 days old, then counts the days', () => {
    expect(exportLine('2026-11-10T15:00:00.000Z', '2026-11-17', logged)).toBeNull()
    expect(exportLine('2026-11-10T15:00:00.000Z', '2026-11-18', logged)).toBe('No export in 8 days')
    expect(exportLine('2026-11-10T15:00:00.000Z', '2026-11-19', logged)).toBe('No export in 9 days')
  })

  it('never exported: counts from the first day logged, and says nothing with nothing logged', () => {
    expect(exportLine(undefined, '2026-11-09', logged)).toBeNull()
    expect(exportLine(undefined, '2026-11-11', logged)).toBe('No export yet; the logs go back 9 days')
    expect(exportLine(undefined, '2026-12-20', none)).toBeNull()
  })
})

describe('the KOOS due line (Batch A): one quiet word when a check is 28+ days out, no score ever', () => {
  it('due with no entry stored, and once the latest entry is 28 days old; 27 is not due', () => {
    expect(koosLine([], '2026-11-08')).toBe('A KOOS check is due')
    expect(koosLine([{ date: '2026-10-11' }], '2026-11-08')).toBe('A KOOS check is due')
    expect(koosLine([{ date: '2026-10-11' }], '2026-11-07')).toBeNull()
    expect(koosLine([{ date: '2026-11-08' }], '2026-11-08')).toBeNull()
  })

  it('says nothing while the entries are still loading: a line that flashes before the read lands would be wrong', () => {
    expect(koosLine(undefined, '2026-11-08')).toBeNull()
  })
})

describe('a red flag on a check logged late is a note on Today, never the stop (Batch D, PROGRAM-QUESTIONS 175)', () => {
  const late = check('2026-11-18', { redFlags: [PROGRAM.redFlags[0]?.id ?? 'locking'], loggedOn: '2026-11-20' })
  it('shows under the body, which stays the day’s session, for 14 days from the morning', () => {
    const v = todayView({ today: '2026-11-20', settings: settings(), history: history({ morningChecks: [late] }), program: PROGRAM })
    expect(v.body.kind).not.toBe('stop')
    expect(v.lateFlags).toHaveLength(1)
    expect(v.lateFlags[0]).toMatch(/^A red flag was ticked on the check for Wednesday Nov 18’s morning, logged late on Friday Nov 20: .+\. Any of these means a call to the ortho or PT\./)
    expect(todayView({ today: '2026-12-02', settings: settings(), history: history({ morningChecks: [late] }), program: PROGRAM }).lateFlags).toHaveLength(1)
    expect(todayView({ today: '2026-12-03', settings: settings(), history: history({ morningChecks: [late] }), program: PROGRAM }).lateFlags).toEqual([])
  })
  it('rides beside the stop when today’s check took over too', () => {
    const v = todayView({ today: '2026-11-20', settings: settings({ redFlag: { active: true, since: '2026-11-20', items: ['locking'] } }), history: history({ morningChecks: [late] }), program: PROGRAM })
    expect(v.body.kind).toBe('stop')
    expect(v.lateFlags).toHaveLength(1)
  })
  it('a flag on an on-time check is not a late note', () => {
    expect(todayView({ today: '2026-11-20', settings: settings(), history: history({ morningChecks: [check('2026-11-18', { redFlags: ['locking'] })] }), program: PROGRAM }).lateFlags).toEqual([])
  })
})
