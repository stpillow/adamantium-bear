import { describe, expect, it } from 'vitest'
import { program } from '../program/program.ts'
import { Run, type MorningCheck, type Settings } from '../schema/index.ts'
import {
  MILES_MAX,
  RUN_TYPES,
  dateChoices,
  dayChoiceWords,
  dayChoicesNote,
  dateLostWords,
  emptyForm,
  errorWords,
  isSwapType,
  leadWords,
  loggedWords,
  loggerView,
  milesWords,
  MILES_STEP,
  formFromDraft,
  hrLoadWords,
  hrProblem,
  hrProblemWords,
  joinTime,
  splitTime,
  timeWords,
  morningFor,
  newRunId,
  noSuggestionWords,
  loggedDate,
  openForm,
  reasonSentence,
  resolveForm,
  rpeNote,
  rowerCue,
  rowerCueFor,
  runPlanWords,
  runRow,
  saveWords,
  stravaProblem,
  suggestionHead,
  swapGymNote,
  swapHereWords,
  takeSwapWords,
  toRun,
  typeDetail,
  weekLine,
  type HistoryLike,
  type LoggerView,
  type ProgramLike,
  type ResolvedForm,
} from './RunLogger.helpers.ts'
import { swapCallAt } from '../rules/gymDay.ts'

const START = '2026-11-02'
/** The gym a swap is logged at: the active one. */
const GYM = 'loc-1'

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
  mileagePlan: [10, 11, 12, 9, 13, 14, 15, 11, 16, 17, 18, 14].map((targetMiles, i) => ({ week: i + 1, targetMiles, isDown: [4, 8, 12].includes(i + 1) })),
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
const run = (date: string, miles: number, type: Run['type'] = 'easy', maxPain = 1, id = `run-${date}`): Run => ({
  id,
  date,
  type,
  miles,
  minutes: 30,
  effort: 'easy',
  maxPain,
  strides: false,
  tempo: false,
})
const check = (date: string, over: Partial<MorningCheck> = {}): MorningCheck => ({
  id: `mc-${date}`,
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

function formView(input: Parameters<typeof loggerView>[0]): Extract<LoggerView, { kind: 'form' }> {
  const view = loggerView(input)
  if (view.kind !== 'form') throw new Error('expected the form view')
  return view
}

/** A gym with both swap machines, one with the rower only, and one with neither. */
const BOTH = { name: 'Planet Fitness', available: new Set(['elliptical', 'rower']) }
const ROWER_ONLY = { name: 'Marriott Downtown', available: new Set(['rower', 'treadmill']) }
const NEITHER = { name: 'Marriott Downtown', available: new Set(['treadmill']) }

const base = { picked: { date: null, type: null }, settings: settings(), history: history(), program: PROGRAM, gym: BOTH }

describe('dateChoices', () => {
  it('is empty before the program starts', () => {
    expect(dateChoices('2026-11-01', START)).toEqual([])
  })
  it('runs from the program start up to today in week 1', () => {
    expect(dateChoices('2026-11-02', START)).toEqual(['2026-11-02'])
    expect(dateChoices('2026-11-05', START)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'])
  })
  it('reaches back the last 14 days across program weeks (Nov 6: log after the fact), oldest first', () => {
    const days = dateChoices('2026-11-20', START)
    expect(days).toHaveLength(15)
    expect(days[0]).toBe('2026-11-06')
    expect(days.at(-1)).toBe('2026-11-20')
    // A Sunday run logged the next morning still keeps its date and week.
    expect(dateChoices('2026-11-09', START)).toContain('2026-11-08')
  })
  it('says which days can be logged, and how a late run reads', () => {
    expect(dayChoicesNote()).toBe('The last 14 days can be logged. A run logged late is read like any other: with no morning check the day after, it reads hold.')
  })
  it('names each choice by its weekday, and today as Today', () => {
    expect(dayChoiceWords('2026-11-05', '2026-11-05')).toBe('Today')
    expect(dayChoiceWords('2026-11-02', '2026-11-05')).toBe('Mon')
  })
  it('adds the date once a weekday could name two days', () => {
    expect(dayChoiceWords('2026-11-09', '2026-11-16')).toBe('Mon Nov 9')
    expect(dayChoiceWords('2026-11-10', '2026-11-16')).toBe('Tue')
  })
})

describe('morningFor', () => {
  it('reads the check logged that morning, or null', () => {
    expect(morningFor('2026-11-04', [check('2026-11-04', { worseThanYesterday: true })])).toBe('hold')
    expect(morningFor('2026-11-04', [check('2026-11-03')])).toBeNull()
  })
})

describe('loggerView', () => {
  it('says when week 1 starts before the program begins', () => {
    expect(loggerView({ ...base, today: '2026-11-01' })).toEqual({ kind: 'before-start', line: 'Week 1 starts Monday Nov 2' })
  })
  it('opens on today and preselects the type from today’s scheduled session', () => {
    const view = formView({ ...base, today: '2026-11-02' })
    expect(view).toMatchObject({ date: '2026-11-02', week: 1, scheduled: 'run:mbr', preselected: 'mbr', type: 'mbr', scheduledLabel: 'Run: MBR' })
    expect(view.suggestion).toMatchObject({ type: 'mbr', miles: 3 })
  })
  it('follows session moves, and suggests the run moved onto the day', () => {
    const view = formView({ ...base, today: '2026-11-05', history: history({ sessionMoves: [{ id: 'm', week: 1, dayA: 'thu', dayB: 'fri' }] }) })
    expect(view).toMatchObject({ scheduled: 'run:long', preselected: 'long' })
    expect(view.suggestion).toMatchObject({ type: 'long', miles: 4 })
  })
  it('preselects nothing on a lift day, and a picked type overrides the preselection', () => {
    const lift = formView({ ...base, today: '2026-11-03' })
    expect(lift).toMatchObject({ preselected: null, type: null, suggestion: null, scheduledLabel: 'Session A' })
    expect(formView({ ...base, today: '2026-11-02', picked: { date: null, type: 'long' } }).type).toBe('long')
  })
  it('suggests only the day’s scheduled run: a run picked on a lift or off day gets no share, tempo or strides', () => {
    // Week 10, Phase 3 from week 8: Thursday Jan 7 holds Session B, Friday the long run with the tempo.
    const phase3 = settings({ currentPhase: 3, phaseEnteredWeek: 8 })
    const clean = history({ morningChecks: [check('2027-01-07'), check('2027-01-10')] })
    for (const type of ['long', 'easy', 'mbr'] as const) {
      const lift = formView({ ...base, today: '2027-01-07', settings: phase3, history: clean, picked: { date: null, type } })
      expect(lift).toMatchObject({ scheduled: 'lift:B', type, suggestion: null })
      expect(resolveForm(emptyForm(), lift)).toMatchObject({ miles: 0, strides: false, tempo: false })
    }
    const off = formView({ ...base, today: '2027-01-10', settings: phase3, history: clean, picked: { date: null, type: 'easy' } })
    expect(off).toMatchObject({ scheduled: 'off', suggestion: null })
  })
  it('on a run day, a different run type picked still gets the scheduled run’s suggestion', () => {
    const view = formView({ ...base, today: '2026-11-02', picked: { date: null, type: 'long' } })
    expect(view.suggestion).toMatchObject({ type: 'mbr', miles: 3 })
    expect(formView({ ...base, today: '2026-11-04', picked: { date: null, type: 'elliptical-swap' } }).suggestion?.type).toBe('easy')
  })
  it('logs for an earlier day this week', () => {
    const earlier = formView({ ...base, today: '2026-11-05', picked: { date: '2026-11-04', type: null } })
    expect(earlier).toMatchObject({ date: '2026-11-04', preselected: 'easy', dateLost: null })
  })
  it('keeps the date the logger opened on when midnight passes', () => {
    // Opened Friday 11:55 pm for the long run; saved at 12:02 am Saturday.
    const form = { ...openForm('2026-11-06'), type: 'long' as const, miles: 4, maxPain: 2, rpe: 3 }
    const view = formView({ ...base, today: '2026-11-07', picked: { date: form.date, type: form.type } })
    expect(view).toMatchObject({ date: '2026-11-06', scheduled: 'run:long', dateLost: null })
    const draft = toRun(resolveForm(form, view), 'r', GYM)
    expect(draft.ok && draft.run).toMatchObject({ date: '2026-11-06', type: 'long', miles: 4 })
  })
  it('a date pinned on Sunday is still Sunday on Monday', () => {
    expect(formView({ ...base, today: '2026-11-09', picked: { date: '2026-11-08', type: 'easy' } })).toMatchObject({ date: '2026-11-08', week: 1, dateLost: null })
  })
  it('a pinned date that is no longer a choice is said in words and blocks Save until a day is picked again', () => {
    // Opened Saturday Nov 7, still open 15 days later: past the 14-day window.
    const form = { ...openForm('2026-11-07'), type: 'easy' as const, miles: 3, maxPain: 1, rpe: 3 }
    const view = formView({ ...base, today: '2026-11-22', picked: { date: form.date, type: form.type } })
    expect(view.dateLost).toBe('2026-11-07')
    expect(view.dates[0]).toBe('2026-11-08')
    expect(view.dates).toHaveLength(15)
    expect(toRun(resolveForm(form, view), 'r', GYM)).toEqual({ ok: false, blocker: 'Pick the day first' })
    expect(leadWords(view)).toBe('Pick the day this run happened')
    const repicked = formView({ ...base, today: '2026-11-22', picked: { date: '2026-11-22', type: form.type } })
    expect(repicked.dateLost).toBeNull()
    expect(toRun(resolveForm({ ...form, date: '2026-11-22' }, repicked), 'r', GYM).ok).toBe(true)
  })
  it('on Monday, a run picked for Sunday logs into the week it happened', () => {
    // Fri long and Sun off swapped in week 1; the long run happened Sunday, at a pain that reads hold.
    const moves = [{ id: 'm', week: 1, dayA: 'fri' as const, dayB: 'sun' as const }]
    const view = formView({ ...base, today: '2026-11-09', history: history({ sessionMoves: moves }), picked: { date: '2026-11-08', type: null } })
    expect(view).toMatchObject({ date: '2026-11-08', week: 1, scheduled: 'run:long', preselected: 'long' })
    const draft = toRun(resolveForm({ ...emptyForm(), miles: 4, maxPain: 5, rpe: 6 }, view), 'run-2026-11-08', GYM)
    expect(draft.ok && draft.run).toMatchObject({ date: '2026-11-08', type: 'long', miles: 4 })
    // Saved, it reads hold in week 1, so week 2 is capped at week 1's miles.
    const runs = [run('2026-11-02', 3, 'mbr'), run('2026-11-04', 3), ...(draft.ok ? [draft.run] : [])]
    const checks = [check('2026-11-03'), check('2026-11-05')]
    const monday = formView({ ...base, today: '2026-11-09', history: history({ runs, morningChecks: checks, sessionMoves: moves }) })
    expect(monday.summary.target).toMatchObject({ target: 10, capped: true })
  })
  it('a hold morning suggests the swap without switching the type', () => {
    const view = formView({ ...base, today: '2026-11-04', history: history({ morningChecks: [check('2026-11-04', { worseThanYesterday: true })] }) })
    expect(view.type).toBe('easy')
    expect(view.suggestion?.swapSuggested).toBe(true)
    expect(view.suggestion?.reasons[0]).toContain('read hold')
  })
  it('counts the week’s miles against the target, capped by last week’s hold', () => {
    const runs = [run('2026-11-09', 3, 'mbr'), run('2026-11-11', 3), run('2026-11-13', 4.5, 'long', 4), run('2026-11-16', 2, 'mbr')]
    const view = formView({ ...base, today: '2026-11-18', history: history({ runs }) })
    expect(view.summary).toMatchObject({ miles: 2, target: { target: 10.5, capped: true } })
    expect(view.weekRuns.map((r) => r.date)).toEqual(['2026-11-16'])
    expect(view.suggestion?.type).toBe('easy')
  })
  it('suggests nothing while the red-flag state is on, and carries the stop message', () => {
    const view = formView({ ...base, today: '2026-11-02', settings: settings({ redFlag: { active: true, since: '2026-11-02', items: ['locking'] } }) })
    expect(view.suggestion).toBeNull()
    expect(view.stop).toEqual({ headline: 'Stop. Call the ortho or PT.', items: ['Locking or catching'] })
  })
  it('lists this week’s runs by date', () => {
    const runs = [run('2026-11-04', 3), run('2026-11-02', 3, 'mbr'), run('2026-10-30', 2)]
    expect(formView({ ...base, today: '2026-11-05', history: history({ runs }) }).weekRuns.map((r) => r.date)).toEqual(['2026-11-02', '2026-11-04'])
  })
})

describe('swaps at the gym (M4b, design section 7)', () => {
  const holdMorning = history({ morningChecks: [check('2026-11-04', { worseThanYesterday: true })] })
  const backOffMorning = history({ morningChecks: [check('2026-11-04', { visibleSwelling: true })] })
  it('marks each swap here or not at the active gym, both kept in the list', () => {
    expect(formView({ ...base, today: '2026-11-04' })).toMatchObject({
      gym: 'Planet Fitness',
      swaps: [
        { type: 'elliptical-swap', here: true },
        { type: 'rower-swap', here: true },
      ],
    })
    expect(formView({ ...base, today: '2026-11-04', gym: ROWER_ONLY }).swaps).toEqual([
      { type: 'elliptical-swap', here: false },
      { type: 'rower-swap', here: true },
    ])
  })
  it('says Here or Not at the gym on each swap choice, and scheduled on the day’s run', () => {
    const view = formView({ ...base, today: '2026-11-04', gym: ROWER_ONLY })
    expect(typeDetail('elliptical-swap', view)).toBe('Not at Marriott Downtown')
    expect(typeDetail('rower-swap', view)).toBe('Here')
    expect(typeDetail('easy', view)).toBe('scheduled')
    expect(typeDetail('long', view)).toBeUndefined()
    expect(swapHereWords(true, 'Marriott Downtown')).toBe('Here')
    expect(swapHereWords(false, 'Marriott Downtown')).toBe('Not at Marriott Downtown')
  })
  it('on a hold or back-off morning names the first swap here: the elliptical, then the rower', () => {
    expect(formView({ ...base, today: '2026-11-04', history: holdMorning })).toMatchObject({ swapCall: { kind: 'take', type: 'elliptical-swap' }, morning: 'hold' })
    expect(formView({ ...base, today: '2026-11-04', history: backOffMorning, gym: ROWER_ONLY })).toMatchObject({ swapCall: { kind: 'take', type: 'rower-swap' }, morning: 'back-off' })
    // A clean morning calls for no swap, whatever the gym has.
    expect(formView({ ...base, today: '2026-11-04', history: history({ morningChecks: [check('2026-11-04')] }), gym: NEITHER }).swapCall).toBeNull()
    const view = formView({ ...base, today: '2026-11-04', history: holdMorning, gym: ROWER_ONLY })
    expect(view.suggestion && suggestionHead(view.suggestion, view)).toBe('Rower swap')
  })
  it('with neither machine here suggests no swap and says neither is here; he picks (Shawn’s Nov 1 answer 7)', () => {
    const view = formView({ ...base, today: '2026-11-04', history: holdMorning, gym: NEITHER })
    expect(view).toMatchObject({ swapCall: { kind: 'neither' }, morning: 'hold', type: 'easy' })
    expect(view.suggestion && suggestionHead(view.suggestion, view)).toBe('No elliptical or rower at Marriott Downtown')
  })
  it('takes the rower cue verbatim from program.md’s running rules (live seed)', () => {
    expect(rowerCue(program.running.rules)).toBe('On the rower, strap in, drive with the legs only through the pain-free range, and keep the stroke rate around 22–24.')
    expect(rowerCue(['Swap any run for the elliptical.'])).toBeNull()
  })
  it('shows the rower cue when the rower swap is the call or the type picked, never for the elliptical or a run', () => {
    const cue = 'On the rower, strap in.'
    const rowerCall = formView({ ...base, today: '2026-11-04', history: holdMorning, gym: ROWER_ONLY })
    expect(rowerCueFor(rowerCall, cue)).toBe(cue)
    const rowerPicked = formView({ ...base, today: '2026-11-04', picked: { date: null, type: 'rower-swap' } })
    expect(rowerCueFor(rowerPicked, cue)).toBe(cue)
    const ellipticalCall = formView({ ...base, today: '2026-11-04', history: holdMorning })
    expect(rowerCueFor(ellipticalCall, cue)).toBeNull()
    expect(rowerCueFor(formView({ ...base, today: '2026-11-04' }), cue)).toBeNull()
    expect(rowerCueFor(rowerPicked, null)).toBeNull()
  })
  it('a swap not at the gym still logs, and stores the gym it was logged at', () => {
    const view = formView({ ...base, today: '2026-11-04', gym: NEITHER, picked: { date: null, type: 'elliptical-swap' } })
    const draft = toRun(resolveForm({ ...emptyForm(), minutes: 35, maxPain: 1, rpe: 4 }, view), 'r', 'loc-1')
    expect(draft).toMatchObject({ ok: true, run: { type: 'elliptical-swap', miles: 0, minutes: 35, locationId: 'loc-1' } })
  })
})

describe('a run swap logged for an earlier day (M4b review)', () => {
  it('the date the gym is read for is the one the view logs: the pinned pick while it is a choice, else today', () => {
    expect(loggedDate('2026-11-03', START, '2026-11-02')).toBe('2026-11-02')
    expect(loggedDate('2026-11-03', START, null)).toBe('2026-11-03')
    // A pinned date no longer a choice is the view's dateLost; until a day is picked again the gym follows today.
    expect(loggedDate('2026-11-25', START, '2026-11-06')).toBe('2026-11-25')
    expect(formView({ ...base, today: '2026-11-03', picked: { date: '2026-11-02', type: null } }).date).toBe(loggedDate('2026-11-03', START, '2026-11-02'))
  })
  it('says which gym the swap is stored at, and that another is a tap away', () => {
    expect(swapGymNote('2026-11-02', 'Marriott Downtown')).toBe('A swap stores the gym it was done at: Monday’s is preset to Marriott Downtown. Tap another if it was elsewhere.')
  })
  it('a back-dated swap judged and stored at the gym picked for that day, not today’s', () => {
    // Monday at Marriott (no elliptical), logged Tuesday with Planet Fitness active and Marriott picked for Monday.
    const view = formView({ ...base, today: '2026-11-03', gym: ROWER_ONLY, picked: { date: '2026-11-02', type: 'elliptical-swap' } })
    expect(typeDetail('elliptical-swap', view)).toBe('Not at Marriott Downtown')
    expect(toRun(resolveForm({ ...openForm('2026-11-03'), date: '2026-11-02', minutes: 35, maxPain: 1, rpe: 4 }, view), 'r', 'loc-1')).toMatchObject({ ok: true, run: { date: '2026-11-02', locationId: 'loc-1' } })
  })
})

describe('openForm', () => {
  it('pins the date the logger opens on, so the live clock never moves it', () => {
    expect(openForm('2026-11-06')).toEqual({ ...emptyForm(), date: '2026-11-06' })
  })
})

describe('words for the date', () => {
  it('says which pinned day can no longer be logged, and what to do', () => {
    expect(dateLostWords('2026-11-07')).toBe(
      'Saturday Nov 7, the day this run was started for, can no longer be logged: runs log for the last 14 days up to today. Pick a day to save it.',
    )
  })
  it('Save names the day when it is not today', () => {
    expect(saveWords('2026-11-06', '2026-11-06')).toBe('Save run')
    expect(saveWords('2026-11-06', '2026-11-07')).toBe('Save run for Friday Nov 6')
  })
})

describe('words for the view', () => {
  const view = formView({ ...base, today: '2026-11-02' })
  it('leads with the date and what it holds', () => {
    expect(leadWords(view)).toBe('Monday, November 2 · Run: MBR')
  })
  it('heads the suggestion with the type and miles', () => {
    expect(view.suggestion && suggestionHead(view.suggestion, view)).toBe('Run: MBR · 3 miles')
    expect(suggestionHead({ type: 'long', miles: null, headline: 'easy, by feel', strides: false, tempo: false, fasterAllowed: false, swapSuggested: false, reasons: [] }, view)).toBe('Run: long')
  })
  it('heads with the first swap here when the engine calls for one, and keeps the run’s plan in words', () => {
    const swap = { type: 'easy' as const, miles: 3, headline: 'a 30 to 40 minute elliptical or rower swap', strides: false, tempo: false, fasterAllowed: false, swapSuggested: true, reasons: [] }
    expect(suggestionHead(swap, { swapCall: swapCallAt(swap, BOTH.available), gym: 'Planet Fitness' })).toBe('Elliptical swap')
    expect(suggestionHead(swap, { swapCall: swapCallAt(swap, ROWER_ONLY.available), gym: 'Marriott Downtown' })).toBe('Rower swap')
    expect(suggestionHead(swap, { swapCall: swapCallAt(swap, NEITHER.available), gym: 'Marriott Downtown' })).toBe('No elliptical or rower at Marriott Downtown')
    expect(runPlanWords(swap)).toBe('Run: easy · 3 miles')
  })
  it('a run with no swap called heads with the run, whatever the gym has', () => {
    expect(view.suggestion && suggestionHead(view.suggestion, { swapCall: swapCallAt(view.suggestion, NEITHER.available), gym: 'Marriott Downtown' })).toBe('Run: MBR · 3 miles')
    expect(view.suggestion && swapCallAt(view.suggestion, NEITHER.available)).toBeNull()
    expect(swapCallAt(null, BOTH.available)).toBeNull()
  })
  it('says why there is no suggestion', () => {
    expect(noSuggestionWords({ date: '2026-11-03', scheduledLabel: 'Session A', type: null, stop: null }, '2026-11-03')).toBe(
      'Today holds Session A, not a run, so there is no suggestion. Pick the type to log one anyway.',
    )
    expect(noSuggestionWords({ date: '2026-11-03', scheduledLabel: 'Session A', type: 'rower-swap', stop: null }, '2026-11-05')).toBe(
      'Tuesday holds Session A, not a run, so there is no suggestion. It still logs, with what you enter.',
    )
    expect(noSuggestionWords({ date: '2026-11-08', scheduledLabel: 'Off', type: 'long', stop: null }, '2026-11-08')).toBe(
      'Today holds Off, not a run, so there is no suggestion. It still logs, with what you enter.',
    )
    expect(noSuggestionWords({ date: '2026-11-02', scheduledLabel: 'Run: MBR', type: 'mbr', stop: { headline: 'x', items: [] } }, '2026-11-02')).toContain('red-flag state')
  })
  it('turns the engine’s fragments into sentences', () => {
    expect(reasonSentence('no morning check yet today')).toBe('No morning check yet today.')
    expect(reasonSentence('Already a sentence.')).toBe('Already a sentence.')
  })
  it('names the swaps', () => {
    expect(takeSwapWords('elliptical-swap')).toBe('Take the elliptical swap')
    expect(takeSwapWords('rower-swap')).toBe('Take the rower swap')
    expect(RUN_TYPES).toEqual(['mbr', 'easy', 'long', 'elliptical-swap', 'rower-swap'])
    expect(isSwapType('rower-swap')).toBe(true)
    expect(isSwapType('long')).toBe(false)
    expect(isSwapType(null)).toBe(false)
  })
})

describe('MILES_MAX', () => {
  it('is a single run’s ceiling: well over the plan’s longest run, under a stray extra digit like 34.5', () => {
    expect(MILES_MAX).toBe(30)
    expect(Math.max(...PROGRAM.mileagePlan.map((w) => w.targetMiles))).toBeLessThan(MILES_MAX)
  })
})

describe('milesWords', () => {
  it('says miles without trailing zeros', () => {
    expect(milesWords(1)).toBe('1 mile')
    expect(milesWords(2.5)).toBe('2.5 miles')
    expect(milesWords(0.25)).toBe('0.25 miles')
    expect(milesWords(10)).toBe('10 miles')
  })
})

describe('formFromDraft (Strava import)', () => {
  it('opens on the activity with max pain unrated, so Save waits on it, and the effort Strava had or none', () => {
    const form = formFromDraft({ date: '2026-11-05', type: 'easy', miles: 3.11, minutes: 27.25, rpe: null, stravaUrl: 'https://www.strava.com/activities/1', notes: 'Morning Run' })
    expect(form).toMatchObject({ date: '2026-11-05', type: 'easy', miles: 3.11, minutes: 27.25, rpe: null, maxPain: null, stravaUrl: 'https://www.strava.com/activities/1', notes: 'Morning Run', strides: null, tempo: null })
    expect(formFromDraft({ date: '2026-11-05', type: 'easy', miles: 3, minutes: 27, rpe: 7, stravaUrl: '', notes: '' }).rpe).toBe(7)
  })
  it('a draft kept by a tab from before RPE opens on its effort word as 3, 5 or 8, and one with neither opens unrated', () => {
    expect(formFromDraft({ date: '2026-11-05', type: 'easy', miles: 3, minutes: 27, effort: 'hard', stravaUrl: '', notes: '' }).rpe).toBe(8)
    expect(formFromDraft({ date: '2026-11-05', type: 'easy', miles: 3, minutes: 27, effort: null, stravaUrl: '', notes: '' }).rpe).toBeNull()
    expect(formFromDraft({ date: '2026-11-05', type: 'easy', miles: 3, minutes: 27, stravaUrl: '', notes: '' }).rpe).toBeNull()
  })
  it('carries the watch’s heart rate in; a draft kept by a pre-phase-2 tab lacks the keys and opens on null (the rpe precedent)', () => {
    const withHr = formFromDraft({ date: '2026-11-05', type: 'easy', miles: 3, minutes: 27, rpe: null, avgHr: 150, maxHr: 171, stravaUrl: '', notes: '' })
    expect(withHr).toMatchObject({ avgHr: 150, maxHr: 171 })
    const without = formFromDraft({ date: '2026-11-05', type: 'easy', miles: 3, minutes: 27, rpe: null, stravaUrl: '', notes: '' })
    expect(without).toMatchObject({ avgHr: null, maxHr: null })
    expect(formFromDraft({ date: '2026-11-05', type: 'easy', miles: 3, minutes: 27, rpe: null, avgHr: null, maxHr: null, stravaUrl: '', notes: '' })).toMatchObject({ avgHr: null, maxHr: null })
  })
})

describe('time in minutes and seconds (Nov 6)', () => {
  it('stores 27:13 as minutes with the seconds a fraction of one, and reads it back exactly', () => {
    const stored = joinTime(27, 13)
    expect(stored).toBeCloseTo(27 + 13 / 60, 10)
    expect(splitTime(stored)).toEqual({ minutes: 27, seconds: 13 })
  })
  it('reads an old whole-minute run as so many minutes and no seconds', () => {
    expect(splitTime(35)).toEqual({ minutes: 35, seconds: 0 })
  })
  it('carries seconds past 59 into the minutes, and never goes below zero', () => {
    expect(splitTime(joinTime(10, 75))).toEqual({ minutes: 11, seconds: 15 })
    expect(joinTime(0, -5)).toBe(0)
    expect(splitTime(-1)).toEqual({ minutes: 0, seconds: 0 })
  })
  it('round-trips every second of a long run without drift', () => {
    for (let total = 0; total <= 3 * 3600; total += 7) {
      const m = Math.floor(total / 60)
      const sec = total % 60
      expect(splitTime(joinTime(m, sec))).toEqual({ minutes: m, seconds: sec })
    }
  })
  it('says whole minutes in words, and minutes with seconds as a clock reads them', () => {
    expect(timeWords(35)).toBe('35 minutes')
    expect(timeWords(1)).toBe('1 minute')
    expect(timeWords(joinTime(27, 13))).toBe('27:13')
    expect(timeWords(joinTime(62, 5))).toBe('1:02:05')
    expect(timeWords(joinTime(8, 3))).toBe('8:03')
  })
})

describe('distance in hundredths of a mile (Nov 6)', () => {
  it('steps by 0.01 mile and keeps two decimals', () => {
    expect(MILES_STEP).toBe(0.01)
    expect(milesWords(3.17)).toBe('3.17 miles')
    expect(milesWords(0.01)).toBe('0.01 miles')
  })
})

describe('weekLine', () => {
  const fromPlan = { miles: 3, target: { target: 10, capped: false, reason: 'from the plan' } }
  it('reads like the brief: miles against the target, with this run, and where the target came from', () => {
    expect(weekLine(fromPlan, { type: 'easy', miles: 3 })).toBe('This week: 3 of 10 miles · with this run 6 · target from the plan')
  })
  it('gives the rule’s reason when the target is capped', () => {
    const capped = { miles: 2, target: { target: 10.5, capped: true, reason: 'last week read hold: capped at last week’s 10.5 miles' } }
    expect(weekLine(capped, { type: 'mbr', miles: 2.25 })).toBe('This week: 2 of 10.5 miles · with this run 4.25 · last week read hold: capped at last week’s 10.5 miles')
  })
  it('says a swap adds no miles', () => {
    expect(weekLine(fromPlan, { type: 'elliptical-swap', miles: 0 })).toBe('This week: 3 of 10 miles · a swap adds no miles · target from the plan')
  })
  it('outside the plan, has no target to count against', () => {
    const outside = { miles: 4, target: { target: null, capped: false, reason: 'week 13 is outside the 12-week plan' } }
    expect(weekLine(outside, { type: 'easy', miles: 3 })).toBe('This week: 4 miles · with this run 7 · week 13 is outside the 12-week plan')
  })
  it('without a pending run, just the week', () => {
    expect(weekLine(fromPlan, null)).toBe('This week: 3 of 10 miles · target from the plan')
  })
})

describe('resolveForm', () => {
  const suggestion = { type: 'easy' as const, miles: 3.5, headline: '3.5 miles', strides: true, tempo: false, fasterAllowed: false, swapSuggested: false, reasons: [] }
  it('follows the suggestion until a field is touched', () => {
    const resolved = resolveForm(emptyForm(), { date: '2026-11-04', type: 'easy', suggestion })
    expect(resolved).toMatchObject({ date: '2026-11-04', miles: 3.5, strides: true, tempo: false, swap: false, maxPain: null, rpe: null, effort: null })
    expect(resolveForm({ ...emptyForm(), rpe: 5 }, { date: '2026-11-04', type: 'easy', suggestion })).toMatchObject({ rpe: 5, effort: 'moderate' })
    expect(resolveForm({ ...emptyForm(), miles: 4, strides: false }, { date: '2026-11-04', type: 'easy', suggestion })).toMatchObject({ miles: 4, strides: false })
  })
  it('logs a swap as 0 miles with no strides or tempo', () => {
    expect(resolveForm({ ...emptyForm(), miles: 4, strides: true }, { date: '2026-11-04', type: 'rower-swap', suggestion })).toMatchObject({ swap: true, miles: 0, strides: false, tempo: false })
  })
  it('starts at 0 miles with no suggestion', () => {
    expect(resolveForm(emptyForm(), { date: '2026-11-03', type: null, suggestion: null })).toMatchObject({ miles: 0, strides: false, tempo: false })
  })
})

describe('stravaProblem', () => {
  it('accepts an empty field and a strava.com https link', () => {
    expect(stravaProblem('')).toBeNull()
    expect(stravaProblem('  ')).toBeNull()
    expect(stravaProblem('https://www.strava.com/activities/123')).toBeNull()
    expect(stravaProblem('https://strava.com/activities/123')).toBeNull()
  })
  it('says the refusal in words for anything the schema refuses', () => {
    for (const link of ['http://www.strava.com/activities/1', 'https://strava.app.link/abc', 'strava.com/activities/1', 'https://evil.example/strava.com']) {
      expect(stravaProblem(link)).toContain('refused')
    }
  })
})

describe('toRun', () => {
  const ready: ResolvedForm = { date: '2026-11-04', dateLost: null, type: 'easy', swap: false, miles: 3.25, minutes: 32, rpe: 2, effort: 'easy', avgHr: null, maxHr: null, maxPain: 2, strides: true, tempo: false, stravaUrl: '', notes: '' }
  it('keeps Save disabled with words until max pain and effort are rated and a type is picked', () => {
    expect(toRun({ ...ready, maxPain: null }, 'r', GYM)).toEqual({ ok: false, blocker: 'Rate max pain first' })
    expect(toRun({ ...ready, type: null }, 'r', GYM)).toEqual({ ok: false, blocker: 'Pick the type first' })
    expect(toRun({ ...ready, type: null, maxPain: null }, 'r', GYM)).toEqual({ ok: false, blocker: 'Pick the type and rate max pain first' })
    expect(toRun({ ...ready, rpe: null, effort: null }, 'r', GYM)).toEqual({ ok: false, blocker: 'Rate effort first' })
    expect(toRun({ ...ready, maxPain: null, rpe: null, effort: null }, 'r', GYM)).toEqual({ ok: false, blocker: 'Rate max pain and effort first' })
    expect(toRun({ ...ready, type: null, maxPain: null, rpe: null, effort: null }, 'r', GYM)).toEqual({ ok: false, blocker: 'Pick the type, rate max pain and effort first' })
  })
  it('stores the RPE as rated and the effort word as its band, for every RPE from 1 to 10', () => {
    for (let rpe = 1; rpe <= 10; rpe++) {
      const draft = toRun({ ...ready, rpe, effort: null }, 'r', GYM)
      expect(draft.ok, String(rpe)).toBe(true)
      if (!draft.ok) continue
      expect(draft.run.rpe).toBe(rpe)
      expect(draft.run.effort).toBe(rpe <= 3 ? 'easy' : rpe <= 6 ? 'moderate' : 'hard')
      expect(Run.parse(draft.run)).toEqual(draft.run)
    }
  })
  it('says what an RPE reads as, in words', () => {
    expect(rpeNote(null)).toBe('Required. 1–3 reads easy, 4–6 moderate, 7–10 hard.')
    expect(rpeNote(6)).toBe('RPE 6 reads moderate. 1–3 easy, 4–6 moderate, 7–10 hard.')
  })
  it('a lost date blocks Save before anything else', () => {
    expect(toRun({ ...ready, dateLost: '2026-11-01', maxPain: null }, 'r', GYM)).toEqual({ ok: false, blocker: 'Pick the day first' })
  })
  it('a rated 0 is a rating, not a missing one', () => {
    expect(toRun({ ...ready, maxPain: 0 }, 'r', GYM).ok).toBe(true)
  })
  it('refuses to save a refused Strava link', () => {
    expect(toRun({ ...ready, stravaUrl: 'http://strava.com/x' }, 'r', GYM)).toEqual({ ok: false, blocker: 'Fix or clear the Strava link first' })
  })
  it('builds a run the schema accepts, leaving blank optional fields off', () => {
    const draft = toRun(ready, 'run-2026-11-04', GYM)
    expect(draft).toEqual({ ok: true, run: { id: 'run-2026-11-04', date: '2026-11-04', type: 'easy', miles: 3.25, minutes: 32, effort: 'easy', rpe: 2, maxPain: 2, strides: true, tempo: false } })
    if (draft.ok) expect(Run.parse(draft.run)).toEqual(draft.run)
  })
  it('trims the link and the note', () => {
    const draft = toRun({ ...ready, stravaUrl: ' https://www.strava.com/activities/9 ', notes: '  windy  ' }, 'r', GYM)
    expect(draft.ok && draft.run).toMatchObject({ stravaUrl: 'https://www.strava.com/activities/9', notes: 'windy' })
    if (draft.ok) expect(() => Run.parse(draft.run)).not.toThrow()
  })
  it('a swap logs 0 miles', () => {
    const draft = toRun({ ...ready, type: 'elliptical-swap', swap: true, miles: 0, strides: false }, 'r', GYM)
    expect(draft.ok && draft.run).toMatchObject({ type: 'elliptical-swap', miles: 0, strides: false, tempo: false })
  })
  it('a swap stores the gym it was done at; a run outside stores none (M4b)', () => {
    const swap = toRun({ ...ready, type: 'rower-swap', swap: true, miles: 0, strides: false }, 'r', GYM)
    expect(swap.ok && swap.run.locationId).toBe(GYM)
    if (swap.ok) expect(Run.parse(swap.run)).toEqual(swap.run)
    expect(toRun({ ...ready, type: 'elliptical-swap', swap: true, miles: 0 }, 'r', 'planet-fitness')).toMatchObject({ ok: true, run: { locationId: 'planet-fitness' } })
    const outside = toRun(ready, 'r', GYM)
    expect(outside.ok && 'locationId' in outside.run).toBe(false)
  })
  it('a swap’s only measure is its minutes, so Save waits on them instead of storing 0', () => {
    const swap: ResolvedForm = { ...ready, type: 'rower-swap', swap: true, miles: 0, minutes: 0, strides: false }
    expect(toRun(swap, 'r', GYM)).toEqual({ ok: false, blocker: 'Set the time first' })
    expect(toRun({ ...swap, maxPain: null }, 'r', GYM)).toEqual({ ok: false, blocker: 'Rate max pain first' })
    expect(toRun({ ...swap, minutes: 35 }, 'r', GYM).ok).toBe(true)
  })
  it('a run keeps its miles as the measure, so untouched minutes still save', () => {
    expect(toRun({ ...ready, minutes: 0 }, 'r', GYM).ok).toBe(true)
  })

  it('empty or valid heart-rate fields never block Save, and a saved run carries them only when set: absent stays absent, never 0', () => {
    expect(toRun(ready, 'r', GYM)).toMatchObject({ ok: true })
    const empty = toRun(ready, 'r', GYM)
    expect(empty.ok && 'avgHr' in empty.run).toBe(false)
    expect(empty.ok && 'maxHr' in empty.run).toBe(false)
    const both = toRun({ ...ready, avgHr: 150, maxHr: 171 }, 'r', GYM)
    expect(both.ok && both.run).toMatchObject({ avgHr: 150, maxHr: 171 })
    if (both.ok) expect(Run.parse(both.run)).toEqual(both.run)
    const alone = toRun({ ...ready, avgHr: 150 }, 'r', GYM)
    expect(alone.ok && alone.run).toMatchObject({ avgHr: 150 })
    expect(alone.ok && 'maxHr' in alone.run).toBe(false)
    if (alone.ok) expect(Run.parse(alone.run)).toEqual(alone.run)
  })

  it('a typed heart rate out of bounds, or an average above the max, blocks Save in words, never as a raw schema error', () => {
    expect(toRun({ ...ready, avgHr: 20 }, 'r', GYM)).toEqual({ ok: false, blocker: 'Fix the heart rate first: average heart rate is a whole number from 30 to 250' })
    expect(toRun({ ...ready, avgHr: 300 }, 'r', GYM)).toMatchObject({ ok: false })
    expect(toRun({ ...ready, maxHr: 300 }, 'r', GYM)).toEqual({ ok: false, blocker: 'Fix the heart rate first: max heart rate is a whole number from 30 to 250' })
    expect(toRun({ ...ready, avgHr: 172, maxHr: 171 }, 'r', GYM)).toEqual({ ok: false, blocker: 'Fix the heart rate first: average is above max' })
  })
})

describe('hrProblem and its words', () => {
  it('an empty or valid field is never a problem; the pair check needs both set', () => {
    expect(hrProblem(null, null)).toBeNull()
    expect(hrProblem(150, null)).toBeNull()
    expect(hrProblem(null, 171)).toBeNull()
    expect(hrProblem(150, 171)).toBeNull()
    expect(hrProblem(150, 150)).toBeNull()
  })
  it('refuses out-of-bounds, non-whole and inverted values in words', () => {
    expect(hrProblem(29, null)).toBe('average heart rate is a whole number from 30 to 250')
    expect(hrProblem(150.5, null)).toContain('average heart rate')
    expect(hrProblem(null, 251)).toBe('max heart rate is a whole number from 30 to 250')
    expect(hrProblem(172, 171)).toBe('average is above max')
    expect(hrProblemWords(172, 171)).toBe('Average is above max. Fix it or clear the field to save.')
    expect(hrProblemWords(150, 171)).toBeNull()
  })
})

describe('hrLoadWords (the saved screen)', () => {
  const hr = { maxHr: 190, restingHr: 50 }
  it('says the HR load beside the sRPE words when the run has minutes and an average and Settings hold both numbers', () => {
    expect(hrLoadWords({ minutes: 40, avgHr: 150 }, hr)).toBe('HR load 72, from an average of 150 over 40 minutes.')
    expect(hrLoadWords({ minutes: 27 + 13 / 60, avgHr: 150 }, hr)).toBe('HR load 49, from an average of 150 over 27:13.')
  })
  it('says nothing rather than 0 when anything is missing: no average, no minutes, no settings, or half the settings', () => {
    expect(hrLoadWords({ minutes: 40 }, hr)).toBeNull()
    expect(hrLoadWords({ minutes: 0, avgHr: 150 }, hr)).toBeNull()
    expect(hrLoadWords({ minutes: 40, avgHr: 150 }, null)).toBeNull()
    expect(hrLoadWords({ minutes: 40, avgHr: 150 }, undefined)).toBeNull()
    expect(hrLoadWords({ minutes: 40, avgHr: 150 }, { maxHr: 190 })).toBeNull()
  })
  it('an average below resting is a computed 0, said as 0, not silence: effort below resting is no load', () => {
    expect(hrLoadWords({ minutes: 40, avgHr: 40 }, hr)).toBe('HR load 0, from an average of 40 over 40 minutes.')
  })
})

describe('newRunId', () => {
  it('is readable and never collides with another run that day', () => {
    expect(newRunId('2026-11-04', [])).toBe('run-2026-11-04')
    expect(newRunId('2026-11-04', ['run-2026-11-04'])).toBe('run-2026-11-04-2')
    expect(newRunId('2026-11-04', ['run-2026-11-04', 'run-2026-11-04-2'])).toBe('run-2026-11-04-3')
  })
})

describe('loggedWords', () => {
  it('today’s run: tomorrow’s morning check reads it', () => {
    expect(loggedWords(run('2026-11-04', 3), '2026-11-04', [])).toBe('Logged. Tomorrow’s morning check reads it.')
  })
  it('an earlier run already covered by a check names that check', () => {
    expect(loggedWords(run('2026-11-02', 3), '2026-11-05', [check('2026-11-03')])).toBe('Logged for Monday Nov 2. The morning check from Tuesday Nov 3 reads it.')
  })
  it('yesterday’s run: this morning’s check reads it, even one saved before the run and linked to the lift', () => {
    expect(loggedWords(run('2026-11-04', 3), '2026-11-05', [])).toBe('Logged for yesterday, Wednesday Nov 4. This morning’s check reads it.')
    const linked = check('2026-11-05', { appliesTo: { kind: 'workout', id: 'w' } })
    expect(loggedWords(run('2026-11-04', 3), '2026-11-05', [linked])).toBe('Logged for Wednesday Nov 4. The morning check from Thursday Nov 5 reads it.')
  })
  it('an older run on a day whose next-morning check linked the lift is read by that check', () => {
    const linked = check('2026-11-04', { appliesTo: { kind: 'workout', id: 'w' } })
    expect(loggedWords(run('2026-11-03', 2), '2026-11-05', [linked])).toBe('Logged for Tuesday Nov 3. The morning check from Wednesday Nov 4 reads it.')
  })
  it('an older run no check covers reads as the engine reads it without one', () => {
    expect(loggedWords(run('2026-11-02', 3), '2026-11-05', [])).toBe('Logged for Monday Nov 2. No morning check from the day after covers it, so it reads hold.')
    expect(loggedWords(run('2026-11-02', 3, 'easy', 7), '2026-11-05', [])).toContain('reads back off')
  })
})

describe('runRow', () => {
  it('gives date, type, miles and max pain in words', () => {
    expect(runRow(run('2026-11-02', 3, 'mbr', 2))).toEqual({ when: 'Monday Nov 2', what: 'Run: MBR', miles: '3 miles', pain: 'max pain 2' })
    expect(runRow(run('2026-11-04', 0, 'rower-swap'))).toMatchObject({ what: 'Rower swap', miles: 'no miles (swap)' })
  })
})

describe('errorWords', () => {
  it('says a rejected write in words', () => {
    expect(errorWords(new Error('quota exceeded'))).toBe('quota exceeded')
    expect(errorWords('')).toBe('no reason was given')
  })
})
