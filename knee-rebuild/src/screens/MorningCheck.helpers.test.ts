import { describe, expect, it } from 'vitest'
import type { SlotPlan } from '../app/session.ts'
import type { History } from '../db/repo.ts'
import type { Prescription } from '../rules/prescription.ts'
import { MORNING_TAGS, type Exercise, type MorningCheck, type Run, type Settings, type Slot, type Workout } from '../schema/index.ts'
import { MorningCheck as MorningCheckSchema } from '../schema/index.ts'
import { NO_RED_FLAG } from '../rules/redFlags.ts'
import { PROGRAM, planSession } from '../app/session.ts'
import { RICH_TODAY, richHistory, richHome, richSettings } from '../testing/richHistory.fixture.test.ts'
import { todayView } from './Today.helpers.ts'
import {
  LATE_FLAG_INTRO,
  afterSave,
  withTodaysFlags,
  TAG_INTRO,
  TAG_LABELS,
  appliesTo,
  buildCheck,
  buildLateCheck,
  formWords,
  lateFlagWords,
  lateOfferLabel,
  lateReachWords,
  lateRefusalWords,
  lateSubjectWords,
  reachLiftDates,
  tagSectionLabel,
  weekLateFlagWords,
  checkId,
  dateWords,
  emptyForm,
  errorWords,
  exerciseSentences,
  formFromCheck,
  nextTemplateFor,
  nextWeekFor,
  runWords,
  sessionName,
  settingsAfter,
  sideWords,
  subjectFor,
  subjectWords,
  toggleFlag,
  withCheck,
} from './MorningCheck.helpers.ts'

const templates = [
  { id: 'p1-a', letter: 'A' as const },
  { id: 'p1-b', letter: 'B' as const },
  { id: 'p1-c', letter: 'C' as const },
]

const workout = (id: string, over: Partial<Workout> = {}): Workout => ({
  id, date: '2026-11-03', templateId: 'p1-a', phase: 1, week: 1, isDeload: false, startedAt: '2026-11-03T22:00:00.000Z', status: 'finished', ...over,
})
const run = (id: string, over: Partial<Run> = {}): Run => ({
  id, date: '2026-11-03', type: 'mbr', miles: 3, minutes: 30, effort: 'easy', maxPain: 1, strides: false, tempo: false, ...over,
})
const check = (over: Partial<MorningCheck> = {}): MorningCheck => ({
  id: 'mc-2026-11-04', date: '2026-11-04', appliesTo: null, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [], ...over,
})
const settings = (over: Partial<Settings> = {}): Settings => ({
  injuredSide: 'right', startDate: '2026-11-02', dumbbellMax: 80, restTimerSeconds: 60, painPerSet: false, currentPhase: 1, phaseEnteredWeek: 1, redFlag: { active: false, items: [] }, activeLocationId: 'planet-fitness', kit: ['ankle-strap', 'mini-band'], ...over,
})
const catalog = [
  { id: 'swelling-48h', text: 'Swelling that is not gone in 48 hours' },
  { id: 'giving-way', text: 'The knee giving way' },
  { id: 'locking', text: 'Locking or catching' },
]

describe('dateWords', () => {
  it('says the weekday, month and day with no clock involved', () => {
    expect(dateWords('2026-11-03')).toBe('Tuesday Nov 3')
    expect(dateWords('2026-11-02')).toBe('Monday Nov 2')
    expect(dateWords('2027-01-24')).toBe('Sunday Jan 24')
  })
})

describe('subjectFor', () => {
  it('is null when nothing is dated that day', () => {
    expect(subjectFor([workout('w1', { date: '2026-11-02' })], [run('r1', { date: '2026-11-02' })], '2026-11-03')).toBeNull()
  })
  it('takes the latest-started workout of the day and skips planned ones', () => {
    const early = workout('early', { startedAt: '2026-11-03T12:00:00.000Z' })
    const late = workout('late', { startedAt: '2026-11-03T20:00:00.000Z', status: 'abandoned' })
    const planned = workout('planned', { startedAt: '2026-11-03T23:00:00.000Z', status: 'planned' })
    expect(subjectFor([early, planned, late], [], '2026-11-03')).toEqual({ kind: 'workout', workout: late })
    expect(subjectFor([planned], [], '2026-11-03')).toBeNull()
  })
  it('prefers a workout over a run on a stacked day, and takes the last run otherwise', () => {
    expect(subjectFor([workout('w1')], [run('r1')], '2026-11-03')).toEqual({ kind: 'workout', workout: workout('w1') })
    expect(subjectFor([], [run('r1'), run('r2', { type: 'easy' })], '2026-11-03')).toEqual({ kind: 'run', run: run('r2', { type: 'easy' }) })
  })
  it('still finds a workout that carries no instants', () => {
    const bare = workout('bare', { startedAt: undefined })
    expect(subjectFor([bare], [], '2026-11-03')?.kind).toBe('workout')
  })
  it('sorts a late entry by its fixed 17:00 UTC marker, whatever the zone (PROGRAM-QUESTIONS 212)', () => {
    // In Tokyo, 17:00 UTC is 2 am the next day: a session entered late for Nov 3 sorts after one started live at 8 pm Tokyo time (11:00 UTC).
    const live = workout('live', { startedAt: '2026-11-03T11:00:00.000Z' })
    const late = workout('late', { startedAt: '2026-11-03T17:00:00.000Z' })
    expect(subjectFor([live, late], [], '2026-11-03')).toEqual({ kind: 'workout', workout: late })
    // In New York, 17:00 UTC is noon: a session started live at 8 pm New York time (01:00 UTC the next day) sorts after it.
    const evening = workout('evening', { startedAt: '2026-11-04T01:00:00.000Z' })
    expect(subjectFor([late, evening], [], '2026-11-03')).toEqual({ kind: 'workout', workout: evening })
  })
})

describe('appliesTo and words', () => {
  it('links the check to the subject by kind and id', () => {
    expect(appliesTo(null)).toBeNull()
    expect(appliesTo({ kind: 'workout', workout: workout('w1') })).toEqual({ kind: 'workout', id: 'w1' })
    expect(appliesTo({ kind: 'run', run: run('r1') })).toEqual({ kind: 'run', id: 'r1' })
  })
  it('names a session by its template letter, falling back to the id', () => {
    expect(sessionName('p1-b', templates)).toBe('Session B')
    expect(sessionName('p9-z', templates)).toBe('p9-z')
  })
  it('names runs in words', () => {
    expect(runWords('mbr')).toBe('MBR run')
    expect(runWords('elliptical-swap')).toBe('elliptical swap')
  })
  it('says in words which session the check is for', () => {
    expect(subjectWords(null, '2026-11-03', templates)).toBe('No session was logged for yesterday, Tuesday Nov 3. This check stands on its own.')
    expect(subjectWords({ kind: 'workout', workout: workout('w1') }, '2026-11-03', templates)).toBe("For yesterday's Session A, Tuesday Nov 3.")
    expect(subjectWords({ kind: 'workout', workout: workout('w1', { status: 'abandoned' }) }, '2026-11-03', templates)).toBe("For yesterday's Session A (stopped early), Tuesday Nov 3.")
    expect(subjectWords({ kind: 'workout', workout: workout('w1', { status: 'in-progress' }) }, '2026-11-03', templates)).toBe("For yesterday's Session A (never finished), Tuesday Nov 3.")
    expect(subjectWords({ kind: 'run', run: run('r1', { type: 'long', date: '2026-11-06' }) }, '2026-11-06', templates)).toBe("For yesterday's long run, Friday Nov 6.")
  })
})

describe('the form', () => {
  it('starts with everything off, so an untouched save cannot read clean', () => {
    expect(emptyForm()).toEqual({ stiffnessUnder30Min: false, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [], tags: [], notes: '' })
  })
  it('prefills from a saved check', () => {
    const saved = check({ worseThanYesterday: true, painChangePoints: -1, redFlags: ['locking'], notes: 'tight' })
    expect(formFromCheck(saved)).toEqual({ stiffnessUnder30Min: true, worseThanYesterday: true, visibleSwelling: false, warmth: false, painChangePoints: -1, redFlags: ['locking'], tags: [], notes: 'tight' })
    expect(formFromCheck(check({ tags: ['brace', 'poor-sleep'] })).tags).toEqual(['brace', 'poor-sleep'])
    expect(formFromCheck(check()).notes).toBe('')
  })
  it('toggles a flag on and off without touching the others', () => {
    expect(toggleFlag([], 'locking')).toEqual(['locking'])
    expect(toggleFlag(['locking', 'numbness'], 'locking')).toEqual(['numbness'])
  })
})

describe('buildCheck', () => {
  it('keys the check on the date, links the subject, orders flags as the program lists them, drops a blank note', () => {
    const form = { ...emptyForm(), stiffnessUnder30Min: true, painChangePoints: 2, redFlags: ['locking', 'swelling-48h'], notes: '   ' }
    const built = buildCheck({ today: '2026-11-04', link: { kind: 'workout', id: 'w1' }, form, catalog })
    expect(built).toEqual({
      id: 'mc-2026-11-04',
      date: '2026-11-04',
      appliesTo: { kind: 'workout', id: 'w1' },
      stiffnessUnder30Min: true,
      worseThanYesterday: false,
      visibleSwelling: false,
      warmth: false,
      painChangePoints: 2,
      redFlags: ['swelling-48h', 'locking'],
    })
    expect(checkId('2026-11-04')).toBe('mc-2026-11-04')
  })
  it('keeps a trimmed note and a null subject', () => {
    const built = buildCheck({ today: '2026-11-04', link: null, form: { ...emptyForm(), notes: '  stairs fine  ' }, catalog })
    expect(built.appliesTo).toBeNull()
    expect(built.notes).toBe('stairs fine')
  })
  it('ignores a ticked id that is not in the catalog', () => {
    expect(buildCheck({ today: '2026-11-04', link: null, form: { ...emptyForm(), redFlags: ['made-up'] }, catalog }).redFlags).toEqual([])
  })
})

describe('settingsAfter and withCheck', () => {
  it('leaves settings untouched (same object) when nothing is flagged', () => {
    const s = settings()
    expect(settingsAfter(s, check())).toBe(s)
  })
  it('turns the red-flag state on when a flag is ticked (rule 9)', () => {
    expect(settingsAfter(settings(), check({ redFlags: ['locking'] })).redFlag).toEqual({ active: true, since: '2026-11-04', items: ['locking'] })
  })
  it('adds the check to the history, replacing a same-id save', () => {
    const history: History = { workouts: [], setLogs: [], morningChecks: [check({ painChangePoints: 5 })], runs: [], gateTests: [], sessionMoves: [] }
    const amended = check({ painChangePoints: 1 })
    const next = withCheck(history, amended)
    expect(next.morningChecks).toEqual([amended])
    expect(history.morningChecks[0]?.painChangePoints).toBe(5)
    expect(withCheck(history, check({ id: 'mc-2026-11-05', date: '2026-11-05' })).morningChecks).toHaveLength(2)
  })
})

describe('next time', () => {
  const exercise = (over: Partial<Exercise> = {}): Exercise => ({
    id: 'leg-press', name: 'Leg press', pattern: 'squat', equipment: 'seated leg press', loadType: 'stack', loadUnit: 'plate', increment: 1, loadDirection: 'up', unilateral: false, requires: [], ...over,
  })
  const slot = (over: Partial<Slot> = {}): Slot => ({
    id: 'p1a-1', order: 1, label: '1', exerciseId: 'leg-press', sets: 3, repsMin: 10, repsMax: 12, repUnit: 'reps', unilateral: false, injuredOnly: false,
    prescriptionText: '3 × 10–12', cues: [], progressionRule: 'double-progression', substitutionIds: [], optional: false, ...over,
  })
  const prescription = (over: Partial<Prescription> = {}): Prescription => ({
    exerciseId: 'leg-press', side: 'both', sets: 3, load: 8, loadUnit: 'plate', repsTarget: 10, repUnit: 'reps', basis: 'same', note: 'Clean once: same load, same target; clean again to progress.', ...over,
  })
  const plan = (over: Partial<SlotPlan> = {}): SlotPlan => ({ slot: slot(), exercise: exercise(), substitutions: [], prescriptions: [prescription()], route: { kind: 'own', exerciseId: 'leg-press', passedOver: [] }, ...over })

  it('the next time a session comes round is next week', () => {
    expect(nextWeekFor({ date: '2026-11-03' }, '2026-11-02')).toBe(2)
    expect(nextWeekFor({ date: '2026-11-17' }, '2026-11-02')).toBe(4)
    // The start date moved a week later after the session: next week is week 3, not a week-4 deload.
    expect(nextWeekFor({ date: '2026-11-17' }, '2026-11-09')).toBe(3)
  })
  it('one sentence per exercise, from the prescription note', () => {
    expect(exerciseSentences([plan()], 'right')).toEqual([{ slotId: 'p1a-1', name: 'Leg press', optional: false, lines: ['Clean once: same load, same target; clean again to progress.'] }])
  })
  it('one line per side when the sides get different notes, injured side first', () => {
    const uni = plan({
      slot: slot({ id: 'p2b-1', exerciseId: 'bulgarian-split-squat', unilateral: true }),
      exercise: exercise({ id: 'bulgarian-split-squat', name: 'Bulgarian split squat', unilateral: true }),
      prescriptions: [prescription({ side: 'right', note: 'Hold: repeat the last session’s loads and reps exactly.' }), prescription({ side: 'left', note: 'Clean twice: same load, every set to 12 reps.' })],
    })
    expect(exerciseSentences([uni], 'right')[0]?.lines).toEqual(['Right (injured): Hold: repeat the last session’s loads and reps exactly.', 'Left: Clean twice: same load, every set to 12 reps.'])
  })
  it('collapses identical side notes to one sentence and marks optional slots', () => {
    const same = plan({ slot: slot({ optional: true, unilateral: true }), prescriptions: [prescription({ side: 'right' }), prescription({ side: 'left' })] })
    expect(exerciseSentences([same], 'right')[0]).toMatchObject({ optional: true, lines: ['Clean once: same load, same target; clean again to progress.'] })
    expect(exerciseSentences([plan({ prescriptions: [] })], 'right')[0]?.lines).toEqual(['Nothing is written for this slot.'])
  })
  it('names sides in words with the injured one marked', () => {
    expect(sideWords('right', 'right')).toBe('Right (injured)')
    expect(sideWords('left', 'right')).toBe('Left')
    expect(sideWords('both', 'right')).toBe('Both')
  })
})

describe('errorWords', () => {
  it('turns a rejected write into words', () => {
    expect(errorWords(new Error('QuotaExceededError: storage is full'))).toBe('QuotaExceededError: storage is full')
    expect(errorWords('nope')).toBe('nope')
    expect(errorWords(new Error('  '))).toBe('no reason was given')
  })
})

describe('nextTemplateFor', () => {
  const templates = [
    { id: 'p2-c', phase: 2, letter: 'C' as const },
    { id: 'p3-c', phase: 3, letter: 'C' as const },
    { id: 'p3-a', phase: 3, letter: 'A' as const },
  ]
  it("plans the current phase's version of the letter once a gate has advanced the phase", () => {
    expect(nextTemplateFor('p2-c', templates, 3)).toBe('p3-c')
    expect(nextTemplateFor('p2-c', templates, 2)).toBe('p2-c')
  })
  it("keeps the session's own template when the current phase has no such letter, and knows no unknown one", () => {
    expect(nextTemplateFor('p2-c', templates, 4)).toBe('p2-c')
    expect(nextTemplateFor('p9-z', templates, 3)).toBeNull()
  })
})

describe('tags on the form (Batch D, PROGRAM-QUESTIONS 177)', () => {
  it('names every tag, in the catalog’s order', () => {
    expect(Object.keys(TAG_LABELS)).toEqual([...MORNING_TAGS])
    expect(Object.values(TAG_LABELS)).toEqual(['Slept badly', 'Sat or drove for hours', 'On my feet most of the day', 'Wore the brace', 'Took an anti-inflammatory (ibuprofen, naproxen)', 'New shoes'])
    expect(tagSectionLabel(false)).toBe('Yesterday and last night')
    expect(tagSectionLabel(true)).toBe('The day before and that night')
    expect(TAG_INTRO).toBe('Optional. Tap any that fit; none is fine. Tags change no reading.')
  })
  it('stores tags in the catalog’s order, drops unknown ids, and leaves the field off when none is ticked', () => {
    const built = buildCheck({ today: '2026-11-04', link: null, form: { ...emptyForm(), tags: ['nsaid', 'made-up', 'poor-sleep'] }, catalog })
    expect(built.tags).toEqual(['poor-sleep', 'nsaid'])
    expect(MorningCheckSchema.safeParse(built).success).toBe(true)
    expect('tags' in buildCheck({ today: '2026-11-04', link: null, form: emptyForm(), catalog })).toBe(false)
    expect('tags' in buildCheck({ today: '2026-11-04', link: null, form: { ...emptyForm(), tags: ['made-up'] }, catalog })).toBe(false)
  })
})

describe('a morning check for a past day (Batch D, PROGRAM-QUESTIONS 174, 175)', () => {
  const form = { ...emptyForm(), stiffnessUnder30Min: true, tags: ['long-sitting'] }
  it('builds a record dated the morning it describes, keyed on it, marked with the day it was saved', () => {
    const late = buildLateCheck({ morning: '2026-11-18', today: '2026-11-20', link: { kind: 'workout', id: '2026-11-17-p1-a' }, form, catalog })
    expect(late).toEqual({
      id: 'mc-2026-11-18',
      date: '2026-11-18',
      appliesTo: { kind: 'workout', id: '2026-11-17-p1-a' },
      stiffnessUnder30Min: true,
      worseThanYesterday: false,
      visibleSwelling: false,
      warmth: false,
      painChangePoints: 0,
      redFlags: [],
      tags: ['long-sitting'],
      loggedOn: '2026-11-20',
    })
    expect(MorningCheckSchema.safeParse(late).success).toBe(true)
    // Everything but the late mark matches the same check saved that morning.
    const { loggedOn: _l, ...rest } = late
    void _l
    expect(rest).toEqual(buildCheck({ today: '2026-11-18', link: { kind: 'workout', id: '2026-11-17-p1-a' }, form, catalog }))
  })
  it('settingsAfter returns the settings themselves for a late flagged check: no takeover', () => {
    const s = settings()
    const late = buildLateCheck({ morning: '2026-11-18', today: '2026-11-20', link: null, form: { ...form, redFlags: ['locking'] }, catalog })
    expect(settingsAfter(s, late)).toBe(s)
    expect(s.redFlag).toEqual(NO_RED_FLAG)
  })
  it('leads with the session and the morning in words', () => {
    expect(lateSubjectWords({ kind: 'workout', workout: workout('w1', { date: '2026-11-17' }) }, '2026-11-17', templates)).toBe('For Session A on Tuesday Nov 17: the check for the next morning, Wednesday Nov 18, logged late.')
    expect(lateSubjectWords({ kind: 'run', run: run('r1', { type: 'easy', date: '2026-11-18' }) }, '2026-11-18', templates)).toBe('For the easy run on Wednesday Nov 18: the check for the next morning, Thursday Nov 19, logged late.')
    expect(lateSubjectWords(null, '2026-11-18', templates)).toBe('For Wednesday Nov 18: the check for the next morning, Thursday Nov 19, logged late.')
  })
  it('the late form compares with the day before, not yesterday', () => {
    expect(formWords(false, 'full')).toEqual({ worse: 'Worse than yesterday', painLabel: 'Pain change since yesterday', painNote: 'Minus means less pain than yesterday. Up 2 or more reads back off.' })
    expect(formWords(true, 'full')).toEqual({ worse: 'Worse than the day before', painLabel: 'Pain change since the day before', painNote: 'Minus means less pain than the day before. Up 2 or more reads back off.' })
    expect(LATE_FLAG_INTRO).toContain('a note, not a stop')
  })
  it('says each refusal in words', () => {
    expect(lateRefusalWords({ kind: 'morning-is-today' }, '2026-11-19')).toBe('That morning is today: use this morning’s check.')
    expect(lateRefusalWords({ kind: 'morning-ahead' }, '2026-11-20')).toBe('Saturday Nov 21 hasn’t come yet.')
    expect(lateRefusalWords({ kind: 'outside-window' }, '2026-11-05')).toBe('Only the last 14 days can take a morning check after the fact.')
    expect(lateRefusalWords({ kind: 'nothing-logged' }, '2026-11-16')).toBe('Nothing finished was logged on Monday Nov 16, so there is no morning check to add. A session left open counts once it is finished or ended.')
    expect(lateRefusalWords({ kind: 'check-exists', morning: '2026-11-14' }, '2026-11-13')).toBe('A morning check for Saturday Nov 14 is already saved; it stays as it is.')
    expect(lateRefusalWords({ kind: 'all-covered' }, '2026-11-12')).toBe('Every session that day already has its morning check.')
    expect(lateOfferLabel('2026-11-18')).toBe('Log the morning check for Wednesday Nov 18')
  })
  it('keeps the program’s instruction in the red-flag note, and never says it doesn’t stop the program', () => {
    const note = { date: '2026-11-18', savedOn: '2026-11-20', items: ['Locking'] }
    expect(lateFlagWords(note)).toBe(
      'A red flag was ticked on the check for Wednesday Nov 18’s morning, logged late on Friday Nov 20: Locking. Any of these means a call to the ortho or PT. Logged late, it doesn’t take over Today or suspend progression; if it is still happening, tick it on this morning’s check.',
    )
    expect(weekLateFlagWords(note)).toBe('Red flag on the next morning’s check, logged late on Friday Nov 20: Locking. A note, not a stop: any of these means a call to the ortho or PT')
    expect(lateFlagWords(note)).not.toMatch(/doesn.t stop the program/)
  })
  it('names what the late check changed, or that nothing did', () => {
    const history = { workouts: [workout('2026-11-17-p1-a', { date: '2026-11-17' })], runs: [run('run-2026-11-18', { type: 'easy', date: '2026-11-18' })] }
    expect(
      lateReachWords(
        { readings: [{ kind: 'workout', id: '2026-11-17-p1-a', date: '2026-11-17', from: 'hold', to: 'back-off' }], lifts: [{ date: '2026-11-21', from: null, to: '2026-11-18' }] },
        history,
        templates,
      ),
    ).toEqual([
      'Session A on Tuesday Nov 17 now reads back off; it read hold.',
      'The lift on Saturday Nov 21 now plans its lower-body work at back-off loads: the morning of Wednesday Nov 18 read back off.',
      'A reading can also change the miles cap of the week after it; Week shows where each week stands.',
    ])
    expect(lateReachWords({ readings: [{ kind: 'run', id: 'run-2026-11-18', date: '2026-11-18', from: 'hold', to: 'clean' }], lifts: [{ date: '2026-11-19', from: '2026-11-18', to: null }] }, history, templates)).toEqual([
      'The easy run on Wednesday Nov 18 now reads clean; it read hold.',
      'The lift on Thursday Nov 19 no longer plans its lower-body work at back-off loads.',
      'A reading can also change the miles cap of the week after it; Week shows where each week stands.',
    ])
    expect(lateReachWords({ readings: [], lifts: [] }, history, templates)).toEqual(['No reading or plan changed: the sessions read as they already did.'])
  })
  it('reaches the open lift and the next scheduled one', () => {
    const template = { mon: 'run:mbr', tue: 'lift:A', wed: 'run:easy', thu: 'lift:B', fri: 'run:long', sat: 'lift:C', sun: 'off' } as const
    const base = { today: '2026-11-20', startDate: '2026-11-02', template, moves: [] }
    expect(reachLiftDates({ ...base, workouts: [] })).toEqual(['2026-11-21'])
    expect(reachLiftDates({ ...base, workouts: [workout('open', { date: '2026-11-19', status: 'in-progress' })] })).toEqual(['2026-11-19', '2026-11-21'])
    // Today's lift already done: the next one is from tomorrow.
    expect(reachLiftDates({ ...base, today: '2026-11-21', workouts: [workout('c', { date: '2026-11-21' })] })).toEqual(['2026-11-24'])
  })
})

describe('a red flag ticked while the phone ran tester mode, then the phone runs full (M-U3, glossary: red-flag state)', () => {
  const check = richHistory.morningChecks.find((c) => c.date === RICH_TODAY) as MorningCheck
  const template = PROGRAM.templates.find((t) => t.id === 'p1-a')
  if (!template) throw new Error('seed')
  const plan = (settings: Settings) => planSession({ template, week: 6, settings, history: richHistory, gym: { location: richHome, kit: settings.kit }, before: RICH_TODAY })
  const suspended = (settings: Settings) => plan(settings).some((p) => p.prescriptions.some((x) => x.basis === 'suspended'))

  it('the tester save writes nothing; once full, the stop shows and progression is suspended', () => {
    expect(check.redFlags).toEqual(['locking'])
    const saved = afterSave('tester', richSettings, check)
    expect(saved).toBe(richSettings)
    expect(suspended(saved)).toBe(false)

    const full = withTodaysFlags('full', saved, richHistory.morningChecks, RICH_TODAY)
    expect(full.redFlag).toEqual({ active: true, since: RICH_TODAY, items: ['locking'] })
    const today = todayView({ mode: 'full', today: RICH_TODAY, settings: full, history: richHistory, program: PROGRAM })
    expect(today.body.kind).toBe('stop')
    expect(suspended(full)).toBe(true)
  })

  it('in tester mode, and once applied or cleared today, nothing changes', () => {
    expect(withTodaysFlags('tester', richSettings, richHistory.morningChecks, RICH_TODAY)).toBe(richSettings)
    const applied = afterSave('full', richSettings, check)
    expect(withTodaysFlags('full', applied, richHistory.morningChecks, RICH_TODAY)).toBe(applied)
    const cleared = { ...richSettings, redFlag: { active: false, items: [], clearedOn: RICH_TODAY, clearNote: 'PT saw it' } }
    expect(withTodaysFlags('full', cleared, richHistory.morningChecks, RICH_TODAY)).toBe(cleared)
  })
})
