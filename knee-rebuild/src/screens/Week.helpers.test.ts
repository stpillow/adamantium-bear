import { lateCheckOffer } from './MorningCheck.helpers.ts'
import { describe, expect, it } from 'vitest'
import { weekSchedule } from '../rules/calendar.ts'
import type { WeekMiles } from '../rules/weekPlan.ts'
import type { DownPeriod, MileageWeek, MorningCheck, Run, SessionMove, SessionTemplate, SetLog, Settings, Workout } from '../schema/index.ts'
import {
  buildMove,
  checkNote,
  countWords,
  dayAction,
  loggedWords,
  moveErrorSentence,
  moveLines,
  movePrompt,
  movedFrom,
  movesForWeek,
  milesWords,
  neighbourWeeks,
  nextMoveId,
  openingWeek,
  relationWords,
  shownWeek,
  statusWords,
  summaryWorkout,
  targetWords,
  undoErrorSentence,
  weekChoices,
  weekHeader,
  weekSpanWords,
  weekDownPeriodLines,
  weekView,
  type HistoryLike,
  type ProgramLike,
  dayLateFlagNote,
} from './Week.helpers.ts'

const START = '2026-11-02'
const template = (id: string, phase: number, letter: 'A' | 'B' | 'C'): SessionTemplate => ({ id, phase, letter, slots: [] })
const plan: MileageWeek[] = [10, 11, 12, 9, 13, 14, 15, 11, 16, 17, 18, 14].map((targetMiles, i) => ({ week: i + 1, targetMiles, isDown: [4, 8, 12].includes(i + 1) }))

/** Inline fixtures, not the live seed: these tests pin the screen's wiring, not the program's content. */
const PROGRAM: ProgramLike = {
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
  mileagePlan: plan,
  templates: [template('p1-a', 1, 'A'), template('p1-b', 1, 'B'), template('p1-c', 1, 'C')],
  redFlags: [{ id: 'locking', text: 'Locking or catching' }],
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
const run = (id: string, date: string, miles: number, maxPain = 1, type: Run['type'] = 'easy', minutes = 30): Run => ({ id, date, type, miles, minutes, effort: 'easy', maxPain, strides: false, tempo: false })
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
const miles = (over: Omit<Partial<WeekMiles>, 'target'> & { target?: Partial<WeekMiles['target']> } = {}): WeekMiles => ({
  miles: 6,
  sessions: 3,
  swaps: 1,
  ...over,
  target: { target: 12, capped: false, reason: 'from the plan', ...over.target },
})

describe('which weeks the screen pages through', () => {
  it('offers weeks 1 to 12, and every week up to the current one once past 12', () => {
    expect(weekChoices(3)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(weekChoices(0)).toHaveLength(12)
    expect(weekChoices(15)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })
  it('opens on the current week, or week 1 before the program starts', () => {
    expect(openingWeek(3)).toBe(3)
    expect(openingWeek(0)).toBe(1)
    expect(openingWeek(-2)).toBe(1)
    expect(openingWeek(15)).toBe(15)
  })
  it('shows the week picked while it is a choice, else the opening week', () => {
    expect(shownWeek(null, 3)).toBe(3)
    expect(shownWeek(7, 3)).toBe(7)
    expect(shownWeek(13, 3)).toBe(3)
    expect(shownWeek(14, 15)).toBe(14)
    expect(shownWeek(16, 15)).toBe(15)
  })
  it('steps a week at a time and stops at the ends', () => {
    expect(neighbourWeeks(3, 3)).toEqual({ prev: 2, next: 4 })
    expect(neighbourWeeks(1, 3)).toEqual({ prev: null, next: 2 })
    expect(neighbourWeeks(12, 3)).toEqual({ prev: 11, next: null })
    expect(neighbourWeeks(12, 15)).toEqual({ prev: 11, next: 13 })
    expect(neighbourWeeks(15, 15)).toEqual({ prev: 14, next: null })
  })
})

describe('header words', () => {
  it('names the week and its dates the way the brief does', () => {
    expect(weekHeader(START, 3)).toBe('Week 3 · Nov 16–22')
    expect(weekHeader(START, 1)).toBe('Week 1 · Nov 2–8')
  })
  it('spells a week that crosses a month or a year', () => {
    expect(weekSpanWords(START, 5)).toBe('Nov 30–Dec 6')
    expect(weekSpanWords(START, 9)).toBe('Dec 28–Jan 3')
  })
  it('says where the week sits from today', () => {
    expect(relationWords(3, 3, START)).toBe('This week')
    expect(relationWords(2, 3, START)).toBe('Last week')
    expect(relationWords(4, 3, START)).toBe('Next week')
    expect(relationWords(1, 4, START)).toBe('3 weeks ago')
    expect(relationWords(6, 3, START)).toBe('In 3 weeks')
    expect(relationWords(1, 0, START)).toBe('The program starts Monday Nov 2')
  })
})

describe('miles words', () => {
  it('reads "6 of 12 miles · 2 runs and 1 swap"', () => {
    expect(milesWords(miles())).toBe('6 of 12 miles · 2 runs and 1 swap')
  })
  it('counts runs and swaps in words', () => {
    expect(countWords(3, 0)).toBe('3 runs')
    expect(countWords(1, 0)).toBe('1 run')
    expect(countWords(0, 2)).toBe('2 swaps')
    expect(countWords(0, 0)).toBe('no runs logged')
    expect(milesWords(miles({ miles: 0, sessions: 0, swaps: 0 }))).toBe('0 of 12 miles · no runs logged')
  })
  it('drops the target for a week outside the plan', () => {
    expect(milesWords(miles({ miles: 1, sessions: 1, swaps: 0, target: { target: null } }))).toBe('1 mile · 1 run')
  })
  it('gives the capped reason in the brief’s words, hold or back off', () => {
    const capped = miles({ target: { target: 10.5, capped: true, reason: 'last week read hold: capped at last week’s 10.5 miles' } })
    expect(targetWords(capped, ['clean', 'hold', 'clean'])).toBe('Capped at last week’s 10.5 miles: last week read hold')
    expect(targetWords(capped, ['hold', 'back-off'])).toBe('Capped at last week’s 10.5 miles: last week read back off')
  })
  it('names this week, and says its miles are so far, when the week before the one shown is still going (M4 review)', () => {
    const capped = miles({ target: { target: 6, capped: true, reason: 'last week read hold: capped at last week’s 6 miles' } })
    expect(targetWords(capped, ['clean', 'hold'], true)).toBe('Capped at this week’s 6 miles so far: this week read hold')
    expect(targetWords(capped, ['back-off'], true)).toBe('Capped at this week’s 6 miles so far: this week read back off')
    expect(targetWords(miles(), [], true)).toBe('Target from the plan')
  })
  it('says the target is the plan’s when nothing capped it, and why there is none outside the plan', () => {
    expect(targetWords(miles(), [])).toBe('Target from the plan')
    expect(targetWords(miles({ target: { target: null, reason: 'week 13 is outside the 12-week plan' } }), [])).toBe('No target: week 13 is outside the 12-week plan')
  })
})

describe('day rows', () => {
  it('gives every status a word, with a mark where the brief has one', () => {
    expect(statusWords('done')).toBe('✓ Done')
    expect(statusWords('missed')).toBe('– Missed')
    expect(statusWords('today')).toBe('● Today')
    expect(statusWords('upcoming')).toBe('Upcoming')
    expect(statusWords('off')).toBe('Off')
  })
  it('a done lift day opens its summary, a finished session before an attempt left early', () => {
    const left = workout('w1', '2026-11-03', 'abandoned', 'p1-a', '2026-11-03T12:00:00Z')
    const done = workout('w1-2', '2026-11-03', 'finished', 'p1-a', '2026-11-03T13:00:00Z')
    expect(summaryWorkout([left, done])?.id).toBe('w1-2')
    expect(summaryWorkout([])).toBeNull()
    expect(dayAction({ date: '2026-11-03', session: 'lift:A', status: 'done', workouts: [left, done] }, '2026-11-05')).toEqual({ kind: 'summary', workoutId: 'w1-2', label: 'Open the summary' })
    // A lift logged on a run day reads Missed for the run, yet its summary stays a tap away.
    expect(dayAction({ date: '2026-11-04', session: 'run:easy', status: 'missed', workouts: [done] }, '2026-11-05')).toEqual({ kind: 'summary', workoutId: 'w1-2', label: 'Open the summary' })
    // A session still in progress has no summary yet: the day opens its preview, which offers the session.
    const open = workout('w1-3', '2026-11-03', 'in-progress', 'p1-a', '2026-11-03T14:00:00Z')
    expect(dayAction({ date: '2026-11-03', session: 'lift:A', status: 'missed', workouts: [open] }, '2026-11-05')).toEqual({ kind: 'preview', date: '2026-11-03', label: 'See the session' })
  })
  it("today's run day opens the run logger; a lift day with nothing logged opens its preview; other days open nothing", () => {
    expect(dayAction({ date: '2026-11-04', session: 'run:easy', status: 'today', workouts: [] }, '2026-11-04')).toEqual({ kind: 'run', label: 'Log the run' })
    expect(dayAction({ date: '2026-11-04', session: 'run:easy', status: 'done', workouts: [] }, '2026-11-04')?.kind).toBe('run')
    expect(dayAction({ date: '2026-11-02', session: 'run:mbr', status: 'missed', workouts: [] }, '2026-11-04')).toBeNull()
    expect(dayAction({ date: '2026-11-04', session: 'lift:A', status: 'today', workouts: [] }, '2026-11-04')).toEqual({ kind: 'preview', date: '2026-11-04', label: 'See the session' })
    expect(dayAction({ date: '2026-11-07', session: 'lift:C', status: 'upcoming', workouts: [] }, '2026-11-04')).toEqual({ kind: 'preview', date: '2026-11-07', label: 'See the session' })
    expect(dayAction({ date: '2026-11-08', session: 'off', status: 'off', workouts: [] }, '2026-11-04')).toBeNull()
  })
  it('says what was logged: sessions, runs in miles, swaps in minutes', () => {
    const words = loggedWords({ workouts: [workout('w', '2026-11-03', 'finished', 'p1-b')], runs: [run('r', '2026-11-03', 3), run('s', '2026-11-03', 0, 1, 'rower-swap', 35), run('t', '2026-11-03', 1, 1, 'mbr')] }, PROGRAM.templates)
    expect(words).toEqual(['Session B finished', 'Run: easy, 3 miles', 'Rower swap, 35 minutes', 'Run: MBR, 1 mile'])
    expect(loggedWords({ workouts: [workout('w', '2026-11-03', 'abandoned')], runs: [] }, PROGRAM.templates)).toEqual(['Session A left early'])
  })
  it('names the day a moved session came from', () => {
    expect(movedFrom(PROGRAM.weeklyTemplate, 'wed', 'lift:A')).toBe('tue')
    expect(movedFrom(PROGRAM.weeklyTemplate, 'tue', 'lift:A')).toBeNull()
  })
  it('says when a logged day still waits on its morning check', () => {
    const day = { date: '2026-11-04', runs: [run('r', '2026-11-04', 3)], workouts: [] }
    expect(checkNote(day, [], '2026-11-04')).toBe('Morning check not done yet; until then it reads hold at best')
    expect(checkNote(day, [], '2026-11-09')).toBe('No morning check was logged for it')
    expect(checkNote(day, [check('2026-11-05')], '2026-11-05')).toBeNull()
    expect(checkNote({ date: '2026-11-04', runs: [], workouts: [] }, [], '2026-11-04')).toBeNull()
  })
})

describe('moves', () => {
  it('builds a swap of two days of the week, and nothing for the same day twice', () => {
    expect(buildMove(3, 'tue', 'wed', [])).toEqual({ id: 'move-000001', week: 3, dayA: 'tue', dayB: 'wed' })
    expect(buildMove(3, 'tue', 'tue', [])).toBeNull()
  })
  it('gives each new move an id that sorts after every stored one, so it applies last', () => {
    expect(nextMoveId([])).toBe('move-000001')
    expect(nextMoveId(['move-000001', 'move-000002'])).toBe('move-000003')
    expect(nextMoveId(['move-000004', 'move-000002'])).toBe('move-000005')
    for (const ids of [['mv1'], ['move-000001', 'zzz'], ['move-999999']]) {
      const id = nextMoveId(ids)
      expect(ids.every((existing) => id > existing), `${id} after ${ids.join(', ')}`).toBe(true)
    }
  })
  it('applied in id order, a second move swaps the days as they stood after the first', () => {
    const first = buildMove(1, 'tue', 'wed', []) as SessionMove
    const second = buildMove(1, 'wed', 'thu', [first.id]) as SessionMove
    const stored = [second, first].sort((a, b) => a.id.localeCompare(b.id))
    expect(weekSchedule(PROGRAM.weeklyTemplate, 1, stored)).toMatchObject({ tue: 'run:easy', wed: 'lift:B', thu: 'lift:A' })
  })
  it('lists the week’s own moves in words, each read against the schedule just before it', () => {
    const moves: SessionMove[] = [
      { id: 'move-000001', week: 1, dayA: 'tue', dayB: 'wed' },
      { id: 'move-000002', week: 2, dayA: 'mon', dayB: 'sun' },
      { id: 'move-000003', week: 1, dayA: 'wed', dayB: 'sun' },
      { id: 'move-000004', week: 1, dayA: 'fri', dayB: 'fri' },
    ]
    expect(movesForWeek(moves, 1).map((m) => m.id)).toEqual(['move-000001', 'move-000003'])
    expect(moveLines(PROGRAM.weeklyTemplate, 1, moves)).toEqual([
      { id: 'move-000001', title: 'Tuesday and Wednesday swapped', detail: 'Session A now Wednesday · Run: easy now Tuesday', undoable: false },
      { id: 'move-000003', title: 'Wednesday and Sunday swapped', detail: 'Session A now Sunday · Off now Wednesday', undoable: false },
    ])
    expect(moveLines(PROGRAM.weeklyTemplate, 1, moves, 'move-000003').map((m) => m.undoable)).toEqual([false, true])
  })
  it('prompts for the second tap in words', () => {
    expect(movePrompt('lift:A', 'tue')).toBe('Moving Session A from Tuesday. Tap “Swap here” on the day it goes to; the two days trade sessions.')
  })
  it('says a refused write in one sentence', () => {
    expect(moveErrorSentence(new Error('QuotaExceededError'))).toBe('The move did not save (QuotaExceededError). Nothing changed; try again.')
    expect(undoErrorSentence('blocked')).toBe('The undo did not save (blocked). The move still stands; try again.')
  })
})

describe('weekView', () => {
  // Week 2: three runs, each with its morning check; Friday's long run hit pain 4 and reads hold.
  const weekTwo = history({
    runs: [run('r-mon', '2026-11-09', 3, 1, 'mbr'), run('r-wed', '2026-11-11', 3), run('r-fri', '2026-11-13', 4.5, 4, 'long')],
    morningChecks: [check('2026-11-10'), check('2026-11-12'), check('2026-11-14')],
  })

  it('opens on the current week with its header, relation and neighbours', () => {
    const v = weekView({ today: '2026-11-18', selected: null, settings: settings(), history: history(), program: PROGRAM })
    expect(v).toMatchObject({ week: 3, currentWeek: 3, homeWeek: 3, header: 'Week 3 · Nov 16–22', relation: 'This week', deload: false, prev: 2, next: 4 })
  })
  it('opens on week 1 before the program starts, every day upcoming', () => {
    const v = weekView({ today: '2026-11-01', selected: null, settings: settings(), history: history(), program: PROGRAM })
    expect(v).toMatchObject({ week: 1, currentWeek: 0, relation: 'The program starts Monday Nov 2', prev: null, next: 2 })
    expect(v.days.map((d) => d.statusWord)).toEqual(['Upcoming', 'Upcoming', 'Upcoming', 'Upcoming', 'Upcoming', 'Upcoming', 'Off'])
  })
  it('badges a deload week', () => {
    expect(weekView({ today: '2026-11-18', selected: 4, settings: settings(), history: history(), program: PROGRAM }).deload).toBe(true)
  })
  it('M4 done: three logged runs show against the week’s target, and the hold caps the following week', () => {
    const two = weekView({ today: '2026-11-14', selected: null, settings: settings(), history: weekTwo, program: PROGRAM })
    expect(two.miles).toBe('10.5 of 11 miles · 3 runs')
    expect(two.target).toBe('Target from the plan')
    expect(two.days.map((d) => d.statusWord)).toEqual(['Done', 'Missed', 'Done', 'Missed', 'Done', 'Today', 'Off'])
    expect(two.days.map((d) => d.reading)).toEqual(['clean', null, 'clean', null, 'hold', null, null])
    const three = weekView({ today: '2026-11-14', selected: 3, settings: settings(), history: weekTwo, program: PROGRAM })
    expect(three).toMatchObject({ miles: '0 of 10.5 miles · no runs logged', target: 'Capped at this week’s 10.5 miles so far: this week read hold', capped: true, relation: 'Next week' })
    // Once week 2 is over, the cap reads as last week's.
    const after = weekView({ today: '2026-11-16', selected: null, settings: settings(), history: weekTwo, program: PROGRAM })
    expect(after).toMatchObject({ week: 3, target: 'Capped at last week’s 10.5 miles: last week read hold', capped: true, relation: 'This week' })
  })
  it('rows carry the session in words, the status, what was logged and what a tap does', () => {
    const h = history({
      workouts: [workout('2026-11-03-p1-a', '2026-11-03', 'finished')],
      setLogs: [set('2026-11-03-p1-a', 1, 2)],
      runs: [run('r-mon', '2026-11-02', 3, 1, 'mbr')],
      morningChecks: [check('2026-11-03'), check('2026-11-04')],
    })
    const v = weekView({ today: '2026-11-04', selected: null, settings: settings(), history: h, program: PROGRAM })
    const [mon, tue, wed, , , , sun] = v.days
    expect(mon).toMatchObject({ dateWords: 'Monday Nov 2', sessionWords: 'Run: MBR', statusMark: '✓', statusWord: 'Done', reading: 'clean', logged: ['Run: MBR, 3 miles'], action: null, movable: false, swappable: false })
    expect(tue).toMatchObject({ movable: false, swappable: false })
    expect(wed).toMatchObject({ movable: true, swappable: true })
    expect(tue).toMatchObject({ sessionWords: 'Session A', reading: 'clean', checkNote: null, action: { kind: 'summary', workoutId: '2026-11-03-p1-a' } })
    expect(wed).toMatchObject({ dateWords: 'Wednesday Nov 4', statusMark: '●', statusWord: 'Today', action: { kind: 'run' }, isToday: true })
    expect(sun).toMatchObject({ sessionWords: 'Off: Kona walk and mobility only', statusWord: 'Off', movable: false, swappable: true })
  })
  it('follows moves: the strip, the moved-from line and the list with Undo', () => {
    const h = history({ sessionMoves: [{ id: 'move-000001', week: 1, dayA: 'tue', dayB: 'wed' }] })
    const v = weekView({ today: '2026-11-02', selected: null, settings: settings(), history: h, program: PROGRAM })
    expect(v.days[1]).toMatchObject({ sessionWords: 'Run: easy', movedFrom: 'Moved from Wednesday' })
    expect(v.days[2]).toMatchObject({ sessionWords: 'Session A', movedFrom: 'Moved from Tuesday' })
    expect(v.moves).toMatchObject([{ id: 'move-000001', undoable: true }])
    expect(v.undoNote).toBeNull()
    expect(weekView({ today: '2026-11-02', selected: 2, settings: settings(), history: h, program: PROGRAM }).moves).toEqual([])
  })
  it('keeps a finished session where it was logged: no move, no landing, no undo across it', () => {
    // Session A finished on Tuesday; a later move put Thursday's B on Wednesday and back is not offered.
    const h = history({
      workouts: [workout('2026-11-03-p1-a', '2026-11-03', 'finished')],
      setLogs: [set('2026-11-03-p1-a', 1, 2)],
      sessionMoves: [
        { id: 'move-000001', week: 1, dayA: 'thu', dayB: 'sat' },
        { id: 'move-000002', week: 1, dayA: 'sat', dayB: 'tue' },
      ],
    })
    const v = weekView({ today: '2026-11-04', selected: null, settings: settings(), history: h, program: PROGRAM })
    expect(v.days[1]).toMatchObject({ movable: false, swappable: false })
    expect(v.moves.map((m) => m.undoable)).toEqual([false, false])
    expect(v.undoNote).toBe('The latest move touches a day with something logged, so it stays.')
    expect(v.moveNote).toBeNull()
  })
  it('only the latest of several moves can be undone', () => {
    const h = history({
      sessionMoves: [
        { id: 'move-000001', week: 1, dayA: 'tue', dayB: 'wed' },
        { id: 'move-000002', week: 1, dayA: 'thu', dayB: 'sat' },
      ],
    })
    const v = weekView({ today: '2026-11-02', selected: null, settings: settings(), history: h, program: PROGRAM })
    expect(v.moves.map((m) => m.undoable)).toEqual([false, true])
    expect(v.undoNote).toBe('Only the latest move can be undone; each one swapped days as they stood after the ones before it.')
  })
  it('a finished week stays as it happened', () => {
    const h = history({ sessionMoves: [{ id: 'move-000001', week: 1, dayA: 'tue', dayB: 'wed' }] })
    const v = weekView({ today: '2026-11-18', selected: 1, settings: settings(), history: h, program: PROGRAM })
    expect(v.days.every((d) => !d.movable && !d.swappable)).toBe(true)
    expect(v.moveNote).toBe('That week is over; its days stay as they happened.')
    expect(v.moves.map((m) => m.undoable)).toEqual([false])
    expect(v.undoNote).toBe('That week is over; its moves stay.')
  })
  it('a row already done today still says it is today', () => {
    const v = weekView({ today: '2026-11-02', selected: null, settings: settings(), history: history({ runs: [run('r', '2026-11-02', 3, 1, 'mbr')] }), program: PROGRAM })
    expect(v.days[0]).toMatchObject({ dateWords: 'Today, Monday Nov 2', statusWord: 'Done', checkNote: 'Morning check not done yet; until then it reads hold at best' })
  })
  it('past week 12 shows the current week without a target', () => {
    const v = weekView({ today: '2027-02-03', selected: null, settings: settings(), history: history(), program: PROGRAM })
    expect(v).toMatchObject({ week: 14, prev: 13, next: null, target: 'No target: week 14 is outside the 12-week plan', miles: '0 miles · no runs logged' })
  })
  it('carries the stop message when the red-flag state is on', () => {
    const v = weekView({ today: '2026-11-04', selected: null, settings: settings({ redFlag: { active: true, items: ['locking'] } }), history: history(), program: PROGRAM })
    expect(v.stop?.items).toEqual(['Locking or catching'])
    expect(weekView({ today: '2026-11-04', selected: null, settings: settings(), history: history(), program: PROGRAM }).stop).toBeNull()
  })
})

describe('a past day missing its morning check offers it (Batch D, PROGRAM-QUESTIONS 174)', () => {
  // Example 1: today Fri Nov 20; Session A on Tue Nov 17 has no check on Nov 18.
  const h = history({
    workouts: [workout('2026-11-17-p1-a', '2026-11-17', 'finished'), workout('2026-11-19-p1-b', '2026-11-19', 'finished', 'p1-b')],
    setLogs: [set('2026-11-17-p1-a', 1, 2), set('2026-11-19-p1-b', 1, 2)],
    runs: [run('r-wed', '2026-11-18', 3)],
    morningChecks: [check('2026-11-19'), check('2026-11-20')],
  })
  it('offers it on the session day’s row, and not on yesterday’s', () => {
    const v = weekView({ today: '2026-11-20', selected: null, settings: settings(), history: h, program: PROGRAM })
    const tue = v.days.find((d) => d.date === '2026-11-17')
    expect(tue).toMatchObject({ checkNote: 'No morning check was logged for it', lateCheck: { morning: '2026-11-18', label: 'Log the morning check for Wednesday Nov 18' }, lateFlagNote: null })
    expect(v.days.find((d) => d.date === '2026-11-19')?.lateCheck).toBeNull()
    expect(v.days.find((d) => d.date === '2026-11-18')?.lateCheck).toBeNull()
    expect(v.days.find((d) => d.date === '2026-11-16')?.lateCheck).toBeNull()
  })
  it('once logged late the offer goes, the reading recomputes, and a flag on it stays a note on the row', () => {
    const late = check('2026-11-18', { id: 'mc-2026-11-18', appliesTo: { kind: 'workout', id: '2026-11-17-p1-a' }, redFlags: ['locking'], loggedOn: '2026-11-20' })
    const v = weekView({ today: '2026-11-20', selected: null, settings: settings(), history: { ...h, morningChecks: [...h.morningChecks, late] }, program: PROGRAM })
    const tue = v.days.find((d) => d.date === '2026-11-17')
    expect(tue).toMatchObject({ lateCheck: null, checkNote: null, reading: 'back-off' })
    expect(tue?.lateFlagNote).toBe('Red flag on the next morning’s check, logged late on Friday Nov 20: Locking or catching. A note, not a stop: any of these means a call to the ortho or PT')
    // No takeover: the Week's stop stays off.
    expect(v.stop).toBeNull()
    // The row keeps the note for good, weeks later.
    const later = weekView({ today: '2026-12-20', selected: 3, settings: settings(), history: { ...h, morningChecks: [...h.morningChecks, late] }, program: PROGRAM })
    expect(later.days.find((d) => d.date === '2026-11-17')?.lateFlagNote).toContain('Locking or catching')
  })
  it('the offer’s own rule: a lift left open offers nothing', () => {
    expect(lateCheckOffer({ date: '2026-11-17', today: '2026-11-20', startDate: START, history: { workouts: [workout('w', '2026-11-17', 'in-progress')], runs: [], morningChecks: [] } })).toBeNull()
    expect(dayLateFlagNote('2026-11-17', [check('2026-11-18', { redFlags: ['locking'] })], PROGRAM.redFlags)).toBeNull()
  })
})

describe('a down period on the Week screen (Batch E, PROGRAM-QUESTIONS 183, 185)', () => {
  const AT = '2026-11-14T13:00:00.000Z'
  const P1: DownPeriod = { id: 'dp-2026-11-14', start: '2026-11-14', plannedEnd: '2026-11-20', declaredAt: AT }
  const view = (today: string, selected: number | null, periods: DownPeriod[] = [P1]) => weekView({ today, selected, settings: settings(), history: history({ downPeriods: periods }), program: PROGRAM })

  it('week 3, whose Monday the period covers: the target held at last week’s, in words', () => {
    const v = view('2026-11-18', 3)
    expect(v.target).toBe('Held at last week’s 11 miles: a down period covers the start of this week')
    expect(v.capped).toBe(true)
    // Week 4 climbs back one plan step from 11 (the test plan drops to 9, so the drop stands): no down-period words.
    expect(view('2026-11-18', 4).target).toBe('Target from the plan')
    // Week 5 is the first climbing week over the drop: min(13, 9 + 4) = 13, from the plan.
    expect(view('2026-11-18', 5).target).toBe('Target from the plan')
  })

  it('a climbing week says so', () => {
    const over5 = { ...P1, id: 'dp-2026-11-28', start: '2026-11-28', plannedEnd: '2026-12-04' }
    // Week 5 (Mon Nov 30) holds at week 4's 9; week 6 climbs one plan step: 9 + (14 − 13) = 10.
    expect(view('2026-12-08', 5, [over5]).target).toBe('Held at last week’s 9 miles: a down period covers the start of this week')
    expect(view('2026-12-08', 6, [over5]).target).toBe('Up one plan step from last week’s 9 miles, after a down period')
  })

  it('the days it covers carry the words, and the week lists the period as history', () => {
    const v = view('2026-11-18', 3)
    expect(v.days.map((d) => d.downPeriod)).toEqual(['Down period', 'Down period', 'Down period', 'Down period', 'Down period', null, null])
    expect(v.downPeriods).toEqual(['Down period: Saturday Nov 14 to Friday Nov 20 (7 days)'])
    const ended = view('2026-11-25', 3, [{ ...P1, endedOn: '2026-11-17' }])
    expect(ended.days.map((d) => d.downPeriod)).toEqual(['Down period', 'Down period', null, null, null, null, null])
    expect(ended.downPeriods).toEqual(['Down period: Saturday Nov 14 to Friday Nov 20, ended early on Tuesday Nov 17 (4 of 7 days)'])
    expect(view('2026-11-18', 2).downPeriods).toEqual(['Down period: Saturday Nov 14 to Friday Nov 20 (7 days)'])
    expect(view('2026-11-18', 4).downPeriods).toEqual([])
    expect(weekDownPeriodLines(START, 1, [P1])).toEqual([])
  })
})
