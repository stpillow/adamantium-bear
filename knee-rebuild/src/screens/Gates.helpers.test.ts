import { describe, expect, it } from 'vitest'
import { program } from '../program/program.ts'
import { addDays, weekOf } from '../rules/calendar.ts'
import { evaluateGate } from '../rules/gates.ts'
import { attachChecks } from '../rules/history.ts'
import { advancePhase, loadTestPrefill, phaseEntryWeek } from '../rules/progress.ts'
import { Settings, type AclRsiEntry, type Gate, type GateTest, type IsoDate, type Location, type MorningCheck, type ProgramOverride, type Run, type SetLog, type Workout } from '../schema/index.ts'
import {
  CALF_RAISE_EXERCISE_IDS,
  advanceQuestion,
  advanceState,
  advancedWords,
  bestWords,
  buildTest,
  clearWords,
  currentGate,
  detailWords,
  earlierTests,
  enterStart,
  enterWords,
  errorWords,
  formBest,
  KOOS_OFFER,
  trialsIntro,
  ZERO_TIME_BLOCKER,
  focusAfterConfirm,
  formBlocker,
  gateContext,
  gatesView,
  lineWords,
  manualTest,
  newGateTestId,
  noGateWords,
  openForm,
  orderedTests,
  passCountWords,
  prefillWords,
  sameForm,
  setValue,
  sideNames,
  stateWords,
  symmetryLine,
  testErrorSentence,
  trialName,
  withoutKey,
  type HistoryLike,
  type ItemView,
} from './Gates.helpers.ts'

/** The live seed's gates and phases: the done criterion is about the program's own gate 1 and gate 3. */
const PROGRAM = { gates: program.gates, phases: program.phases, exercises: program.exercises, redFlags: program.redFlags, templates: program.templates, weeklyTemplate: program.weeklyTemplate }
const START = '2026-11-02'
const TODAY = '2026-11-22' // Sunday of week 3, the last day of Phase 1 on the nominal schedule

function gateNumber(n: number): Gate {
  const gate = program.gates.find((g) => g.number === n)
  if (!gate) throw new Error(`no gate ${n} in the seed`)
  return gate
}
const gate1 = gateNumber(1)
const gate3 = gateNumber(3)

const settings = (over: Partial<Settings> = {}): Settings => ({
  ...Settings.parse({ injuredSide: 'right', startDate: START, dumbbellMax: 80, restTimerSeconds: 60, painPerSet: false }),
  ...over,
})

const workout = (date: IsoDate, over: Partial<Workout> = {}): Workout => ({
  id: `w-${date}`, date, templateId: 'p1-a', phase: 1, week: weekOf(date, START), isDeload: false, status: 'finished', ...over,
})
const set = (workoutId: string, exerciseId: string, side: SetLog['side'], setNumber: number, load: number, over: Partial<SetLog> = {}): SetLog => ({
  id: `${workoutId}:${exerciseId}:${side}:${setNumber}`, workoutId, slotId: 'p1a-1', exerciseId, setNumber, side, load, loadUnit: 'lb', reps: 12, rpe: 7, painDuring: 2, stopped: false, ...over,
})
const check = (date: IsoDate, over: Partial<MorningCheck> = {}): MorningCheck => ({
  id: `mc-${date}`, date, appliesTo: null, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [], ...over,
})
const run = (date: IsoDate, type: Run['type'], miles: number): Run => ({ id: `run-${date}`, date, type, miles, minutes: miles * 10, effort: 'easy', maxPain: 1, strides: false, tempo: false })
const daysFrom = (from: IsoDate, to: IsoDate): IsoDate[] => {
  const out: IsoDate[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/**
 * Two Phase 1 weeks as the app logs them: lifts Tuesday, Thursday and Saturday (three sets of the
 * leg press at pain 2), runs Monday, Wednesday and Friday (Friday's long run is 4 miles), and a clean
 * morning check every day. Nothing here is entered on the Gates screen.
 */
function loggedPhase1(): HistoryLike {
  const liftDays = ['2026-11-10', '2026-11-12', '2026-11-14', '2026-11-17', '2026-11-19', '2026-11-21']
  const workouts = liftDays.map((d) => workout(d))
  const setLogs = workouts.flatMap((w) => [1, 2, 3].map((n) => set(w.id, 'leg-press', 'both', n, 140)))
  const runs = [run('2026-11-09', 'mbr', 3), run('2026-11-11', 'easy', 3), run('2026-11-13', 'long', 3.5), run('2026-11-16', 'mbr', 3), run('2026-11-18', 'easy', 3), run('2026-11-20', 'long', 4)]
  const morningChecks = daysFrom('2026-11-10', TODAY).map((d) => check(d))
  return { workouts, setLogs, morningChecks, runs, gateTests: [], sessionMoves: [] }
}

const byId = (view: ReturnType<typeof gatesView>, id: string): ItemView => {
  if (view.kind !== 'gate') throw new Error('expected a gate')
  const item = view.items.find((i) => i.item.id === id)
  if (!item) throw new Error(`no item ${id}`)
  return item
}

describe('done criterion: gate 1 evaluates from logged data alone', () => {
  it('reads the clean weeks and the 4-mile run from workouts, set logs, morning checks and runs; the test and the toggle wait for entry', () => {
    const history = loggedPhase1()
    const result = evaluateGate(gate1, gateContext({ today: TODAY, settings: settings(), history, aclRsiEntries: [] }))
    expect(result.items.map((i) => [i.item.id, i.pass])).toEqual([
      ['g1-clean-weeks', true],
      ['g1-sl-leg-press', false],
      ['g1-stance', false],
      ['g1-run', true],
    ])
    expect(result.passes).toBe(false)

    const view = gatesView({ today: TODAY, settings: settings(), history, program: PROGRAM, aclRsiEntries: [] })
    if (view.kind !== 'gate') throw new Error('expected gate 1')
    expect(view.gate.number).toBe(1)
    expect(view.countLine).toBe('2 of 4 items pass')
    expect(byId(view, 'g1-clean-weeks')).toMatchObject({ kind: 'auto', mark: '✓', word: 'Passes', detail: '12 readings in the last 14 days, all clean.' })
    expect(byId(view, 'g1-run')).toMatchObject({ kind: 'auto', mark: '✓', word: 'Passes', detail: '4 miles on Friday Nov 20 with a clean morning after.' })
    expect(byId(view, 'g1-sl-leg-press')).toMatchObject({ kind: 'symmetry', mark: '○', word: 'Not yet', detail: 'No test entered yet.' })
    expect(byId(view, 'g1-stance')).toMatchObject({ kind: 'manual', mark: '○', word: 'Not yet', detail: 'Not ticked.' })
    expect(view.advance).toEqual({ enabled: false, why: '2 items don’t pass yet' })
  })

  it('one hold in the window fails the clean weeks, from the logged pain alone, and the detail names it', () => {
    const history = loggedPhase1()
    const sore = { ...history, setLogs: history.setLogs.map((s) => (s.workoutId === 'w-2026-11-17' ? { ...s, painDuring: 4 } : s)) }
    const view = gatesView({ today: TODAY, settings: settings(), history: sore, program: PROGRAM, aclRsiEntries: [] })
    expect(byId(view, 'g1-clean-weeks')).toMatchObject({ pass: false, word: 'Not yet', detail: '1 of 12 readings in the last 14 days read hold. Hold on Tuesday Nov 17 (Session A).' })
  })

  it('a session waiting on its morning check says so, rather than reading as a session that went badly', () => {
    const history = loggedPhase1()
    const waiting = { ...history, morningChecks: history.morningChecks.filter((c) => c.date !== TODAY) }
    const view = gatesView({ today: TODAY, settings: settings(), history: waiting, program: PROGRAM, aclRsiEntries: [] })
    expect(byId(view, 'g1-clean-weeks')).toMatchObject({
      pass: false,
      detail: '1 of 12 readings in the last 14 days read hold. Saturday Nov 21’s Session A reads hold until its morning check is in; log it to count.',
    })
    // A run waiting on its check and a back-off say so in the same way.
    const run20 = { ...history, morningChecks: history.morningChecks.filter((c) => c.date !== '2026-11-21') }
    const late = gatesView({ today: '2026-11-21', settings: settings(), history: run20, program: PROGRAM, aclRsiEntries: [] })
    expect(byId(late, 'g1-clean-weeks').detail).toContain('Friday Nov 20’s Run: long reads hold until its morning check is in; log it to count.')
  })

  it('with the leg-press test entered and the stance ticked, the gate passes and advances only on confirmation', () => {
    const history = loggedPhase1()
    const view = gatesView({ today: TODAY, settings: settings(), history, program: PROGRAM, aclRsiEntries: [] })
    const legPress = byId(view, 'g1-sl-leg-press')
    if (legPress.kind !== 'symmetry') throw new Error('expected a symmetry item')
    // Phase 1 runs no single-leg leg press, so the loads come from the test itself (PROGRAM-QUESTIONS 114).
    expect(legPress.entry).toMatchObject({ key: 'sl-leg-press-10rm', threshold: 0.8, trials: null, unit: 'lb', step: 5, prefill: null })

    // The test lifted right (injured) 80 lb and left 100 lb.
    const form = setValue(setValue(openForm(legPress.entry.trials, legPress.entry.prefill), 'injured', 0, 80), 'other', 0, 100)
    expect(symmetryLine(formBest(form), legPress.entry.threshold)).toBe('80% · the line is 80%: passes')
    const draft = buildTest({ gate: gate1, item: legPress.item, form, today: TODAY, id: newGateTestId('2026-11-22T15:00:00.000Z', 'sl-leg-press-10rm', []) })
    if (!draft.ok) throw new Error(draft.blocker)
    expect(draft.test).toEqual({ id: 'gate-test-2026-11-22T15:00:00.000Z-sl-leg-press-10rm', date: TODAY, gate: 1, item: 'sl-leg-press-10rm', valueInjured: 80, valueOther: 100, pass: true, manual: false })

    const stance = byId(view, 'g1-stance')
    const tick = manualTest({ gate: gate1, item: stance.item, pass: true, today: TODAY, id: newGateTestId('2026-11-22T15:01:00.000Z', stance.item.id, []) })
    const passing = gatesView({ today: TODAY, settings: settings(), history: { ...history, gateTests: [draft.test, tick] }, program: PROGRAM, aclRsiEntries: [] })
    if (passing.kind !== 'gate') throw new Error('expected gate 1')
    expect(passing.countLine).toBe('4 of 4 items pass')
    expect(passing.result.passes).toBe(true)
    expect(passing.advance).toEqual({ enabled: true })
    // Sunday of week 3, after its Lift C: the phase is entered next week (PROGRAM-QUESTIONS 113).
    expect(passing.entryWeek).toBe(phaseEntryWeek({ today: TODAY, startDate: START, template: program.weeklyTemplate, moves: [], workouts: history.workouts }))
    expect(passing.entryWeek).toBe(4)
    expect(passing.question).toBe('Advance to Phase 2: Single-leg strength and balance? From the next session the templates change; week bands count from next week, week 4, since this week’s lifts have begun.')

    // Nothing has moved yet: the phase changes only when the confirmed advance is saved.
    const next = advancePhase(settings(), passing.gate, passing.result.passes, passing.entryWeek)
    expect(next).toMatchObject({ currentPhase: 2, phaseEnteredWeek: 4 })
    expect(advancedWords(next, program.phases)).toBe('Phase 2: Single-leg strength and balance, entered in week 4.')
  })

  it('says Phase 1 doesn’t run the test’s exercise, so nothing can prefill it, rather than "yet" (PROGRAM-QUESTIONS 114)', () => {
    const view = gatesView({ today: TODAY, settings: settings(), history: loggedPhase1(), program: PROGRAM, aclRsiEntries: [] })
    const legPress = byId(view, 'g1-sl-leg-press')
    if (legPress.kind !== 'symmetry') throw new Error('expected a symmetry item')
    expect(legPress.entry).toMatchObject({ prefill: null, unit: 'lb', step: 5 })
    expect(openForm(legPress.entry.trials, legPress.entry.prefill)).toEqual({ injured: [null], other: [null] })
    expect(legPress.entry.prefillLine).toBe('Phase 1 doesn’t run this exercise (Single-leg leg press), so no session can prefill this test. Enter the loads from the test.')
  })

  it('a set logged on the test exercise in Phase 1 still doesn’t prefill it: the phase can’t produce one', () => {
    const logged = loggedPhase1()
    const sl = workout('2026-11-19', { id: 'w-sl' })
    const slSets = [set('w-sl', 'single-leg-leg-press', 'right', 1, 80, { reps: 10 }), set('w-sl', 'single-leg-leg-press', 'left', 1, 100, { reps: 10 })]
    const history: HistoryLike = { ...logged, workouts: [...logged.workouts, sl], setLogs: [...logged.setLogs, ...slSets] }
    // The rule itself still finds the session; the screen doesn't offer it for a phase that doesn't run the exercise.
    expect(loadTestPrefill(attachChecks(history.workouts, history.setLogs, []), 'single-leg-leg-press', 'right').prefill).toMatchObject({ date: '2026-11-19', injured: 80, other: 100 })
    const legPress = byId(gatesView({ today: TODAY, settings: settings(), history, program: PROGRAM, aclRsiEntries: [] }), 'g1-sl-leg-press')
    if (legPress.kind !== 'symmetry') throw new Error('expected a symmetry item')
    expect(legPress.entry.prefill).toBeNull()
  })

  it('reads the lists the sessions run: a Program edit that puts the test’s exercise on a Phase 1 slot logged side by side lets its session prefill the test', () => {
    const logged = loggedPhase1()
    const sl = workout('2026-11-19', { id: 'w-sl', templateId: 'p1-c' })
    // The step-up's slot is logged side by side, so the runner logs the single-leg leg press there right then left.
    const slSets = [set('w-sl', 'single-leg-leg-press', 'right', 1, 80, { reps: 10, slotId: 'p1c-1' }), set('w-sl', 'single-leg-leg-press', 'left', 1, 100, { reps: 10, slotId: 'p1c-1' })]
    // Shawn added the single-leg leg press to Phase 1 C's step-up substitutions, so a Phase 1 session can run it.
    const edit: ProgramOverride = { slotId: 'p1c-1', substitutionIds: ['step-up-stair', 'split-squat', 'single-leg-leg-press'], editedOn: '2026-11-16' }
    const history: HistoryLike = { ...logged, workouts: [...logged.workouts, sl], setLogs: [...logged.setLogs, ...slSets], programOverrides: [edit] }
    const legPress = byId(gatesView({ today: TODAY, settings: settings(), history, program: PROGRAM, aclRsiEntries: [] }), 'g1-sl-leg-press')
    if (legPress.kind !== 'symmetry') throw new Error('expected a symmetry item')
    expect(legPress.entry.prefill).toMatchObject({ date: '2026-11-19', injured: 80, other: 100 })
    expect(legPress.entry.prefillLine).toBe('Prefilled from Thursday Nov 19’s session: Single-leg leg press, 80 lb right and 100 lb left, the heaviest set on each side. Change either to what the test lifted.')
    // An edit to another slot, or one naming an exercise the catalog no longer has, leaves Phase 1 as program.md writes it.
    for (const other of [
      { slotId: 'p1b-1', substitutionIds: ['bulgarian-split-squat'], editedOn: '2026-11-16' },
      { slotId: 'p1a-1', substitutionIds: ['single-leg-leg-press-retired'], editedOn: '2026-11-16' },
      // An imported file's edit the repo would refuse: a leg press on the carry, counted in yards. The runner drops it, so the phase doesn't run it.
      { slotId: 'p1c-7', substitutionIds: ['suitcase-carry', 'single-leg-leg-press'], editedOn: '2026-11-16' },
    ] satisfies ProgramOverride[]) {
      const row = byId(gatesView({ today: TODAY, settings: settings(), history: { ...history, programOverrides: [other] }, program: PROGRAM, aclRsiEntries: [] }), 'g1-sl-leg-press')
      if (row.kind !== 'symmetry') throw new Error('expected a symmetry item')
      expect(row.entry.prefill).toBeNull()
      expect(row.entry.prefillLine).toBe('Phase 1 doesn’t run this exercise (Single-leg leg press), so no session can prefill this test. Enter the loads from the test.')
    }
  })

  it('a Program edit that puts the test’s exercise only on a both-legs slot says no session can prefill it, never "yet" (PROGRAM-QUESTIONS 134)', () => {
    const logged = loggedPhase1()
    // Added to Phase 1 A's leg press, logged once for both legs: the runner logs that slot's sets as both, never a side.
    const edit: ProgramOverride = { slotId: 'p1a-1', substitutionIds: ['goblet-squat-bench', 'leg-press-45', 'smith-box-squat', 'single-leg-leg-press'], editedOn: '2026-11-02' }
    const sl = workout('2026-11-19', { id: 'w-sl' })
    const slSets = [1, 2, 3].map((n) => set('w-sl', 'single-leg-leg-press', 'both', n, 80, { reps: 10 }))
    const history: HistoryLike = { ...logged, workouts: [...logged.workouts, sl], setLogs: [...logged.setLogs, ...slSets], programOverrides: [edit] }
    const row = byId(gatesView({ today: TODAY, settings: settings(), history, program: PROGRAM, aclRsiEntries: [] }), 'g1-sl-leg-press')
    if (row.kind !== 'symmetry') throw new Error('expected a symmetry item')
    expect(row.entry.prefill).toBeNull()
    expect(row.entry.prefillLine).toBe('Phase 1 runs this exercise (Single-leg leg press) only on a slot logged for both legs at once, so no session can prefill this test. Enter the loads from the test.')
  })

  it('a phase that runs the test’s exercise but hasn’t logged both sides yet says "yet"', () => {
    const phase2 = settings({ currentPhase: 2, phaseEnteredWeek: 4 })
    const row = byId(gatesView({ today: '2026-11-24', settings: phase2, history: { ...loggedPhase1(), gateTests: [] }, program: PROGRAM, aclRsiEntries: [] }), 'g2-sl-leg-press')
    if (row.kind !== 'symmetry') throw new Error('expected a symmetry item')
    expect(row.entry.prefill).toBeNull()
    expect(row.entry.prefillLine).toBe('Nothing to prefill: no session has logged both sides of this exercise (Single-leg leg press) yet. Enter the loads from the test.')
  })
})

describe('done criterion: the hop-test worked example', () => {
  it('best 56 injured against 62 other reads 90.3% and passes gate 3’s 90% line', () => {
    const phase3 = settings({ currentPhase: 3, phaseEnteredWeek: 8 })
    const view = gatesView({ today: TODAY, settings: phase3, history: { ...loggedPhase1(), gateTests: [] }, program: PROGRAM, aclRsiEntries: [] })
    if (view.kind !== 'gate') throw new Error('expected gate 3')
    expect(view.gate.number).toBe(3)
    const hop = byId(view, 'g3-single-hop')
    if (hop.kind !== 'symmetry') throw new Error('expected a symmetry item')
    expect(hop.entry).toMatchObject({ key: 'single-hop', threshold: 0.9, trials: 3, unit: 'in', prefill: null, prefillLine: null })
    expect(hop.entry.sides).toEqual({ injured: 'Right · injured', other: 'Left' })

    let form = openForm(hop.entry.trials, hop.entry.prefill)
    // Every trial starts not entered: a 0 would be a hop he couldn't do.
    expect(form).toEqual({ injured: [null, null, null], other: [null, null, null] })
    expect(symmetryLine(formBest(form), hop.entry.threshold)).toBe('Enter both sides to see the symmetry.')
    ;[50, 56, 54].forEach((v, i) => (form = setValue(form, 'injured', i, v)))
    ;[60, 62, 61].forEach((v, i) => (form = setValue(form, 'other', i, v)))
    const best = formBest(form)
    expect(best).toEqual({ injured: 56, other: 62 })
    expect(bestWords(best.injured, 'in')).toBe('Best 56 in')
    expect(symmetryLine(best, hop.entry.threshold)).toBe('90.3% · the line is 90%: passes')

    const draft = buildTest({ gate: gate3, item: hop.item, form, today: TODAY, id: 'gate-test-2026-11-22T16:00:00.000Z-single-hop' })
    if (!draft.ok) throw new Error(draft.blocker)
    expect(draft.test).toEqual({
      id: 'gate-test-2026-11-22T16:00:00.000Z-single-hop', date: TODAY, gate: 3, item: 'single-hop',
      valueInjured: 56, valueOther: 62, trialsInjured: [50, 56, 54], trialsOther: [60, 62, 61], pass: true, manual: false,
    })

    const after = gatesView({ today: TODAY, settings: phase3, history: { ...loggedPhase1(), gateTests: [draft.test] }, program: PROGRAM, aclRsiEntries: [] })
    const evaluated = byId(after, 'g3-single-hop')
    expect(evaluated).toMatchObject({ pass: true, mark: '✓', word: 'Passes', detail: '90.3% (56 vs 62) against a 90% line, tested Sunday Nov 22.' })
    if (evaluated.kind !== 'symmetry') throw new Error('expected a symmetry item')
    expect(evaluated.entry.earlier).toEqual([{ id: draft.test.id, when: 'Sunday Nov 22', percent: '90.3%', values: '56 vs 62 in', pass: true, word: '✓ passes', note: null }])
  })

  it('just under the line reads not yet, and the saved test fails the item', () => {
    const form = { injured: [55, 55.5, 50], other: [60, 62, 61] }
    expect(symmetryLine(formBest(form), 0.9)).toBe('89.5% · the line is 90%: not yet')
    const hop = gate3.items[0]
    if (!hop) throw new Error('no hop item')
    const draft = buildTest({ gate: gate3, item: hop, form, today: TODAY, id: 't' })
    expect(draft.ok && draft.test.pass).toBe(false)
  })
})

describe('symmetry forms: hop tests (PROGRAM-QUESTIONS 108, Shawn Nov 2)', () => {
  const hop = gate3.items[0]
  if (!hop) throw new Error('no hop item')
  const phase3 = settings({ currentPhase: 3, phaseEnteredWeek: 8 })

  it('saves once one trial on each side is entered; trials not entered are left out of the test', () => {
    const none = openForm(3, null)
    expect(formBlocker(none, 3)).toBe('Enter at least one trial on each side to save')
    const injuredOnly = setValue(none, 'injured', 0, 56)
    expect(formBlocker(injuredOnly, 3)).toBe('Enter at least one trial on each side to save')
    expect(symmetryLine(formBest(injuredOnly), 0.9)).toBe('Enter the other side to see the symmetry.')
    expect(symmetryLine(formBest(setValue(none, 'other', 2, 62)), 0.9)).toBe('Enter the injured side to see the symmetry.')

    const form = setValue(injuredOnly, 'other', 1, 62)
    expect(form).toEqual({ injured: [56, null, null], other: [null, 62, null] })
    expect(formBlocker(form, 3)).toBeNull()
    expect(formBest(form)).toEqual({ injured: 56, other: 62 })
    expect(symmetryLine(formBest(form), 0.9)).toBe('90.3% · the line is 90%: passes')
    expect(buildTest({ gate: gate3, item: hop, form, today: TODAY, id: 't' })).toEqual({
      ok: true,
      test: { id: 't', date: TODAY, gate: 3, item: 'single-hop', valueInjured: 56, valueOther: 62, trialsInjured: [56], trialsOther: [62], pass: true, manual: false },
    })
  })

  it('every trial control names its side, so the two sides’ trial 1 never share a name', () => {
    const sides = sideNames('right')
    expect(trialName(sides.injured, 0)).toBe('Right · injured, trial 1')
    expect(trialName(sides.other, 2)).toBe('Left, trial 3')
    expect(enterWords(trialName(sides.injured, 0), 0, 'in')).toBe('Enter right · injured, trial 1, starting at 0 in')
    expect(clearWords(trialName(sides.other, 0))).toBe('Clear left, trial 1: back to not entered')
    const names = [sides.injured, sides.other].flatMap((side) => [0, 1, 2].flatMap((i) => [enterWords(trialName(side, i), 0, 'in'), clearWords(trialName(side, i))]))
    expect(new Set(names).size).toBe(12)
  })

  it('0 is a trial (he couldn’t hop), distinct from not entered: 0 on the injured side reads 0% and fails', () => {
    let form = setValue(openForm(3, null), 'injured', 0, 0)
    expect(form.injured).toEqual([0, null, null])
    expect(formBest(form).injured).toBe(0)
    expect(bestWords(0, 'in')).toBe('Best 0 in')
    expect(bestWords(null, 'in')).toBe('Best: nothing entered yet')
    // Clearing a trial takes it back to not entered.
    expect(setValue(form, 'injured', 0, null).injured).toEqual([null, null, null])

    form = setValue(setValue(form, 'other', 0, 62), 'other', 1, 60)
    expect(symmetryLine(formBest(form), 0.9)).toBe('0% · the line is 90%: not yet')
    expect(formBlocker(form, 3)).toBeNull()
    const draft = buildTest({ gate: gate3, item: hop, form, today: TODAY, id: 'gate-test-2026-11-22T16:00:00.000Z-single-hop' })
    if (!draft.ok) throw new Error(draft.blocker)
    expect(draft.test).toMatchObject({ valueInjured: 0, valueOther: 62, trialsInjured: [0], trialsOther: [62, 60], pass: false, manual: false })

    const after = gatesView({ today: TODAY, settings: phase3, history: { ...loggedPhase1(), gateTests: [draft.test] }, program: PROGRAM, aclRsiEntries: [] })
    const evaluated = byId(after, 'g3-single-hop')
    expect(evaluated).toMatchObject({ pass: false, mark: '○', word: 'Not yet', detail: '0% (0 vs 62) against a 90% line, tested Sunday Nov 22.' })
    if (evaluated.kind !== 'symmetry') throw new Error('expected a symmetry item')
    expect(evaluated.entry.earlier[0]).toMatchObject({ percent: '0%', values: '0 vs 62 in', pass: false, word: '○ not yet' })
  })

  it('0 on both sides cannot be a percent: the line says so and Save waits', () => {
    const form = { injured: [0, null, null], other: [0, 0, null] }
    expect(symmetryLine(formBest(form), 0.9)).toBe('Both sides are 0, so there is no percent.')
    expect(formBlocker(form, 3)).toBe('Both sides are 0, so there is no percent to save')
    expect(buildTest({ gate: gate3, item: hop, form, today: TODAY, id: 't' })).toEqual({ ok: false, blocker: 'Both sides are 0, so there is no percent to save' })
    // The other side alone at 0 can't be a percent either.
    const otherZero = { injured: [20, null, null], other: [0, null, null] }
    expect(symmetryLine(formBest(otherZero), 0.9)).toBe('The other side is 0, so there is no percent.')
    expect(formBlocker(otherZero, 3)).toBe('The other side is 0, so there is no percent to save')
  })
})

describe('symmetry forms: load tests', () => {
  it('a load test needs both sides; the line says what is missing', () => {
    expect(formBlocker({ injured: [80], other: [null] }, null)).toBe('Enter both sides to save')
    expect(formBlocker({ injured: [80], other: [100] }, null)).toBeNull()
    expect(symmetryLine({ injured: 80, other: null }, 0.8)).toBe('Enter the other side to see the symmetry.')
    expect(symmetryLine({ injured: null, other: null }, 0.8)).toBe('Enter both sides to see the symmetry.')
    expect(symmetryLine({ injured: 70, other: 100 }, 0.8)).toBe('70% · the line is 80%: not yet')
    expect(openForm(null, { injured: 80, other: 100 })).toEqual({ injured: [80], other: [100] })
  })

  it('save, then the form and its blocker: the form keeps what was saved, and Save waits until a value changes', () => {
    const bulgarian = gateNumber(2).items.find((i) => i.id === 'g2-bulgarian')
    if (!bulgarian) throw new Error('no Bulgarian item in the seed')
    // The prefill read 40 lb right and 50 lb left; the test lifted 47.5 on the right.
    const form = setValue(openForm(null, { injured: 40, other: 50 }), 'injured', 0, 47.5)
    const draft = buildTest({ gate: gateNumber(2), item: bulgarian, form, today: '2026-12-12', id: 'gate-test-a' })
    if (!draft.ok) throw new Error(draft.blocker)
    expect(draft.test).toMatchObject({ valueInjured: 47.5, valueOther: 50, pass: true })

    // Once saved, the form is the saved one: a second tap would write the same test again.
    const saved = form
    expect(sameForm(saved, { injured: [47.5], other: [50] })).toBe(true)
    expect(formBlocker(form, null, saved)).toBe('Saved; change a value to save another')
    expect(buildTest({ gate: gateNumber(2), item: bulgarian, form, today: '2026-12-12', id: 'gate-test-b', lastSaved: saved })).toEqual({ ok: false, blocker: 'Saved; change a value to save another' })
    expect(symmetryLine(formBest(form), 0.9)).toBe('95% · the line is 90%: passes')

    // A changed value is a new test; changing it back to what was saved waits again.
    const changed = setValue(form, 'other', 0, 55)
    expect(sameForm(changed, saved)).toBe(false)
    expect(formBlocker(changed, null, saved)).toBeNull()
    expect(formBlocker(setValue(changed, 'other', 0, 50), null, saved)).toBe('Saved; change a value to save another')

    // A hop test the same way: its trials stay as saved, and Save waits.
    const hop = setValue(setValue(openForm(3, null), 'injured', 0, 56), 'other', 0, 62)
    expect(formBlocker(hop, 3, hop)).toBe('Saved; change a value to save another')
    expect(formBlocker(setValue(hop, 'injured', 1, 57), 3, hop)).toBeNull()
    expect(sameForm(setValue(hop, 'injured', 1, 0), hop)).toBe(false)
  })

  it('a 0 lb side: the line and the Save button say the same thing, never a percent beside "Enter both sides"', () => {
    const needs = 'A load test needs a load on each side, so 0 can’t be saved'
    for (const form of [{ injured: [0], other: [10] }, { injured: [10], other: [0] }, { injured: [0], other: [0] }]) {
      expect(formBlocker(form, null)).toBe(needs)
      expect(symmetryLine(formBest(form), 0.9, true)).toBe(`${needs}.`)
      expect(buildTest({ gate: gate3, item: { id: 'x', text: 'x', evaluator: 'symmetry', threshold: 0.9, testItem: 'bulgarian-load' }, form, today: TODAY, id: 't' })).toEqual({ ok: false, blocker: needs })
    }
    // Loads on both sides read as before; hop trials keep 0 as a trial (PROGRAM-QUESTIONS 108).
    expect(symmetryLine({ injured: 70, other: 100 }, 0.8, true)).toBe('70% · the line is 80%: not yet')
    expect(symmetryLine({ injured: 0, other: 62 }, 0.9)).toBe('0% · the line is 90%: not yet')
  })

  it('a load not entered shows in words, and Enter starts it at the exercise’s first step, not at 0 (a hop starts at 0)', () => {
    const view = gatesView({ today: TODAY, settings: settings(), history: loggedPhase1(), program: PROGRAM, aclRsiEntries: [] })
    const legPress = byId(view, 'g1-sl-leg-press')
    if (legPress.kind !== 'symmetry') throw new Error('expected a symmetry item')
    expect(openForm(legPress.entry.trials, legPress.entry.prefill)).toEqual({ injured: [null], other: [null] })
    expect(enterStart(legPress.entry)).toBe(5)
    expect(enterWords(legPress.entry.sides.injured, enterStart(legPress.entry), legPress.entry.unit)).toBe('Enter right · injured, starting at 5 lb')
    const hop = { trials: 3, step: 1 }
    expect(enterStart(hop)).toBe(0)
    expect(enterWords('Trial 1', 0, 'in')).toBe('Enter trial 1, starting at 0 in')
  })

  it('an item without a test key cannot save', () => {
    const item = { id: 'x', text: 'x', evaluator: 'symmetry' as const, threshold: 0.9 }
    expect(buildTest({ gate: gate3, item, form: { injured: [1], other: [1] }, today: TODAY, id: 't' })).toEqual({ ok: false, blocker: 'This item has no test key in the program data' })
  })

  it('setValue changes one value and leaves the form it came from alone', () => {
    const form = openForm(3, null)
    const next = setValue(form, 'other', 1, 62)
    expect(next).toEqual({ injured: [null, null, null], other: [null, 62, null] })
    expect(form.other).toEqual([null, null, null])
  })
})

describe('the load prefill (loadTestPrefill)', () => {
  const records = (workouts: Workout[], sets: SetLog[]) => attachChecks(workouts, sets, [])
  it('takes the latest session that logged both sides, each side’s heaviest set', () => {
    const w1 = workout('2026-12-01', { id: 'w1' })
    const w2 = workout('2026-12-08', { id: 'w2' })
    const sets = [
      set('w1', 'single-leg-leg-press', 'right', 1, 90), set('w1', 'single-leg-leg-press', 'left', 1, 100),
      set('w2', 'single-leg-leg-press', 'right', 1, 95), set('w2', 'single-leg-leg-press', 'right', 2, 100), set('w2', 'single-leg-leg-press', 'left', 1, 105),
    ]
    expect(loadTestPrefill(records([w1, w2], sets), 'single-leg-leg-press', 'right').prefill).toMatchObject({ date: '2026-12-08', injured: 100, other: 105 })
    expect(loadTestPrefill(records([w1, w2], sets), 'single-leg-leg-press', 'left').prefill).toMatchObject({ date: '2026-12-08', injured: 105, other: 100 })
  })

  it('passes over a session missing a side and one still in progress; abandoned sessions count', () => {
    const w1 = workout('2026-12-01', { id: 'w1', status: 'abandoned' })
    const w2 = workout('2026-12-08', { id: 'w2' })
    const w3 = workout('2026-12-10', { id: 'w3', status: 'in-progress' })
    const sets = [
      set('w1', 'bulgarian-split-squat', 'right', 1, 25), set('w1', 'bulgarian-split-squat', 'left', 1, 30),
      set('w2', 'bulgarian-split-squat', 'right', 1, 30, { stopped: true, stopReason: 'sharp-joint-line-pain' }),
      set('w3', 'bulgarian-split-squat', 'right', 1, 35), set('w3', 'bulgarian-split-squat', 'left', 1, 35),
    ]
    expect(loadTestPrefill(records([w1, w2, w3], sets), 'bulgarian-split-squat', 'right').prefill).toMatchObject({ date: '2026-12-01', injured: 25, other: 30 })
    expect(loadTestPrefill(records([w2], sets), 'bulgarian-split-squat', 'right').prefill).toBeNull()
  })

  const exercise = { name: 'Bulgarian split squat', loadUnit: 'lb' as const }
  const none = { rackCapped: 0, noLoad: 0 }
  const at = (date: IsoDate, injured: number, other: number) => ({ date, workoutId: 'w', locationId: 'planet-fitness', injured, other })

  it('says where the numbers came from', () => {
    expect(prefillWords({ exercise, prefill: at('2026-12-01', 25, 30), injuredSide: 'left' })).toBe(
      'Prefilled from Tuesday Dec 1’s session: Bulgarian split squat, 25 lb left and 30 lb right, the heaviest set on each side. Change either to what the test lifted.',
    )
    expect(prefillWords({ exercise: null, prefill: null, injuredSide: 'right' })).toBe('Nothing to prefill from: enter the values from the test.')
  })

  it('names the gym when the session ran away from the active one, and says what was passed over', () => {
    expect(prefillWords({ exercise, prefill: at('2026-12-08', 40, 50), injuredSide: 'right', gymName: 'Marriott Downtown', passedOver: { rackCapped: 1, noLoad: 0 } })).toBe(
      'Prefilled from Tuesday Dec 8’s session at Marriott Downtown: Bulgarian split squat, 40 lb right and 50 lb left, the heaviest set on each side. Passed over a later session that the rack capped. Change either to what the test lifted.',
    )
    expect(prefillWords({ exercise, prefill: at('2026-12-08', 40, 50), injuredSide: 'right', passedOver: { rackCapped: 0, noLoad: 2 } })).toContain('Passed over 2 later sessions with no load on a side.')
    expect(prefillWords({ exercise, prefill: at('2026-12-08', 40, 50), injuredSide: 'right', passedOver: { rackCapped: 2, noLoad: 1 } })).toContain('Passed over 3 later sessions: 2 that the rack capped, 1 with no load on a side.')
    expect(prefillWords({ exercise, prefill: null, injuredSide: 'right', passedOver: { rackCapped: 1, noLoad: 0 } })).toBe(
      'Nothing to prefill: every session that logged both sides of this exercise (Bulgarian split squat) was rack-capped. Enter the loads from the test.',
    )
    expect(prefillWords({ exercise, prefill: null, injuredSide: 'right', passedOver: { rackCapped: 1, noLoad: 1 } })).toContain('was rack-capped or had no load on a side.')
    expect(prefillWords({ exercise, prefill: null, injuredSide: 'right', passedOver: none })).toBe('Nothing to prefill: no session has logged both sides of this exercise (Bulgarian split squat) yet. Enter the loads from the test.')
  })

  it('says a phase that runs the exercise only on a both-legs slot can’t prefill the test, also over the last test (PROGRAM-QUESTIONS 134)', () => {
    expect(prefillWords({ exercise, prefill: null, injuredSide: 'right', bothLegsIn: 1, passedOver: none })).toBe(
      'Phase 1 runs this exercise (Bulgarian split squat) only on a slot logged for both legs at once, so no session can prefill this test. Enter the loads from the test.',
    )
    expect(prefillWords({ exercise, prefill: null, injuredSide: 'right', bothLegsIn: 1, openedOn: { date: '2026-11-20', valueInjured: 70, valueOther: 90 } })).toBe(
      'Opened on the last test, Friday Nov 20: Bulgarian split squat, 70 lb right and 90 lb left. Phase 1 runs this exercise only on a slot logged for both legs at once, so no session can prefill this test. Change either to save a new test.',
    )
    // A phase that doesn't run it at all says that instead.
    expect(prefillWords({ exercise, prefill: null, injuredSide: 'right', notRunIn: 1, bothLegsIn: 1 })).toBe(
      'Phase 1 doesn’t run this exercise (Bulgarian split squat), so no session can prefill this test. Enter the loads from the test.',
    )
  })

  it('gate 2’s Bulgarian opens on the last uncapped session, not the hotel’s rack-capped 25 against 25', () => {
    const home = workout('2026-12-08', { id: 'w-home', templateId: 'p2-b', phase: 2 })
    const hotel = workout('2026-12-10', { id: 'w-hotel', templateId: 'p2-b', phase: 2, locationId: 'hotel' })
    const sets = [
      set('w-home', 'bulgarian-split-squat', 'right', 1, 40, { reps: 8 }), set('w-home', 'bulgarian-split-squat', 'left', 1, 50, { reps: 8 }),
      set('w-hotel', 'bulgarian-split-squat', 'right', 1, 25, { reps: 8, rackCapped: true }), set('w-hotel', 'bulgarian-split-squat', 'left', 1, 25, { reps: 8, rackCapped: true }),
    ]
    const history: HistoryLike = { workouts: [home, hotel], setLogs: sets, morningChecks: [], runs: [], gateTests: [], sessionMoves: [] }
    const phase2 = settings({ currentPhase: 2, phaseEnteredWeek: 4, activeLocationId: 'hotel' })
    const gym = (id: string, name: string): Location => ({ id, name, present: [], dumbbellMaxLb: 25, startedFrom: 'empty', listVersion: 1, extras: [], markedOff: [], createdOn: '2026-11-01', archived: false })
    const view = gatesView({ today: '2026-12-11', settings: phase2, history, program: PROGRAM, locations: [gym('planet-fitness', 'Planet Fitness'), gym('hotel', 'Hampton Inn')], aclRsiEntries: [] })
    const row = byId(view, 'g2-bulgarian')
    if (row.kind !== 'symmetry') throw new Error('expected a symmetry item')
    expect(row.entry.prefill).toMatchObject({ date: '2026-12-08', injured: 40, other: 50 })
    expect(row.entry.prefillLine).toBe(
      'Prefilled from Tuesday Dec 8’s session at Planet Fitness: Bulgarian split squat, 40 lb right and 50 lb left, the heaviest set on each side. Passed over a later session that the rack capped. Change either to what the test lifted.',
    )
    expect(symmetryLine(formBest(openForm(null, row.entry.prefill)), 0.9)).toBe('80% · the line is 90%: not yet')
  })
})

describe('the form a load test opens on, coming back to Gates (PROGRAM-QUESTIONS 118)', () => {
  const bulgarianSession = (date: IsoDate, injured: number, other: number) => {
    const w = workout(date, { id: `w-${date}`, templateId: 'p2-b', phase: 2 })
    return { w, sets: [set(w.id, 'bulgarian-split-squat', 'right', 1, injured, { reps: 8 }), set(w.id, 'bulgarian-split-squat', 'left', 1, other, { reps: 8 })] }
  }
  const test = (date: IsoDate, injured: number, other: number, over: Partial<GateTest> = {}): GateTest => ({
    id: `gate-test-${date}T15:00:00.000Z-bulgarian-load`, date, gate: 2, item: 'bulgarian-load', valueInjured: injured, valueOther: other, pass: injured / other >= 0.9, manual: false, ...over,
  })
  const phase2 = settings({ currentPhase: 2, phaseEnteredWeek: 4 })
  const entryOf = (history: HistoryLike, today: IsoDate, id = 'g2-bulgarian') => {
    const row = byId(gatesView({ today, settings: phase2, history, program: PROGRAM, aclRsiEntries: [] }), id)
    if (row.kind !== 'symmetry') throw new Error('expected a symmetry item')
    return row.entry
  }
  const history = (sessions: ReturnType<typeof bulgarianSession>[], gateTests: GateTest[]): HistoryLike => ({
    workouts: sessions.map((s) => s.w), setLogs: sessions.flatMap((s) => s.sets), morningChecks: [], runs: [], gateTests, sessionMoves: [],
  })

  it('a saved test newer than the session the prefill reads opens on the test, and Save waits: one tap can’t write the older session as a newer test', () => {
    // Thursday's session read 40 against 50; Saturday's test lifted 47.5 against 50 and passed.
    const entry = entryOf(history([bulgarianSession('2026-12-10', 40, 50)], [test('2026-12-12', 47.5, 50)]), '2026-12-12')
    expect(entry.prefill).toMatchObject({ date: '2026-12-10', injured: 40, other: 50 })
    expect(entry.opening).toEqual({ injured: [47.5], other: [50] })
    expect(entry.openingSaved).toBe(true)
    expect(formBlocker(entry.opening, entry.trials, entry.openingSaved ? entry.opening : null)).toBe('Saved; change a value to save another')
    expect(symmetryLine(formBest(entry.opening), entry.threshold, true)).toBe('95% · the line is 90%: passes')
    expect(entry.prefillLine).toBe('Opened on the last test, Saturday Dec 12: Bulgarian split squat, 47.5 lb right and 50 lb left, newer than any session that could prefill it. Change either to save a new test.')
    // A test the same day as the session is the newer of the two.
    expect(entryOf(history([bulgarianSession('2026-12-12', 40, 50)], [test('2026-12-12', 47.5, 50)]), '2026-12-12').opening).toEqual({ injured: [47.5], other: [50] })
    // A failing test is kept the same way: a passing session prefill can't overwrite it with one tap.
    const failing = entryOf(history([bulgarianSession('2026-12-10', 45, 50)], [test('2026-12-12', 40, 50)]), '2026-12-12')
    expect(failing).toMatchObject({ opening: { injured: [40], other: [50] }, openingSaved: true })
  })

  it('a session newer than the last test opens on the session, as before, with Save live', () => {
    const entry = entryOf(history([bulgarianSession('2026-12-17', 45, 50)], [test('2026-12-12', 47.5, 50)]), '2026-12-17')
    expect(entry.opening).toEqual({ injured: [45], other: [50] })
    expect(entry.openingSaved).toBe(false)
    expect(entry.prefillLine).toMatch(/^Prefilled from Thursday Dec 17’s session/)
    // With no test yet, the prefill as before; with no test and no session, not entered.
    expect(entryOf(history([bulgarianSession('2026-12-10', 40, 50)], []), '2026-12-12')).toMatchObject({ opening: { injured: [40], other: [50] }, openingSaved: false })
    expect(entryOf(history([], []), '2026-12-12')).toMatchObject({ opening: { injured: [null], other: [null] }, openingSaved: false })
  })

  it('gate 1, which no session can prefill, opens on its last test once there is one; hop tests always open not entered', () => {
    const legPress: GateTest = { id: 'gate-test-2026-11-22T15:00:00.000Z-sl-leg-press-10rm', date: TODAY, gate: 1, item: 'sl-leg-press-10rm', valueInjured: 80, valueOther: 100, pass: true, manual: false }
    const g1 = byId(gatesView({ today: TODAY, settings: settings(), history: { ...loggedPhase1(), gateTests: [legPress] }, program: PROGRAM, aclRsiEntries: [] }), 'g1-sl-leg-press')
    if (g1.kind !== 'symmetry') throw new Error('expected a symmetry item')
    expect(g1.entry).toMatchObject({ opening: { injured: [80], other: [100] }, openingSaved: true })
    expect(g1.entry.prefillLine).toBe('Opened on the last test, Sunday Nov 22: Single-leg leg press, 80 lb right and 100 lb left. Phase 1 doesn’t run this exercise, so no session can prefill this test. Change either to save a new test.')
    const hopTest: GateTest = { id: 'gate-test-x-single-hop', date: TODAY, gate: 3, item: 'single-hop', valueInjured: 56, valueOther: 62, trialsInjured: [56], trialsOther: [62], pass: true, manual: false }
    const hop = byId(gatesView({ today: TODAY, settings: settings({ currentPhase: 3 }), history: { ...loggedPhase1(), gateTests: [hopTest] }, program: PROGRAM, aclRsiEntries: [] }), 'g3-single-hop')
    if (hop.kind !== 'symmetry') throw new Error('expected a symmetry item')
    expect(hop.entry).toMatchObject({ opening: { injured: [null, null, null], other: [null, null, null] }, openingSaved: false })
  })
})

describe('manual items and test order', () => {
  it('a toggle writes a manual test with the item’s own id and zero values', () => {
    expect(manualTest({ gate: gate1, item: { id: 'g1-stance' }, pass: false, today: TODAY, id: 'gate-test-x' })).toEqual({ id: 'gate-test-x', date: TODAY, gate: 1, item: 'g1-stance', valueInjured: 0, valueOther: 0, pass: false, manual: true })
  })

  it('the latest test wins: an untick after a tick the same day reads not ticked, whatever order storage returns', () => {
    const tick = manualTest({ gate: gate1, item: { id: 'g1-stance' }, pass: true, today: TODAY, id: newGateTestId('2026-11-22T14:00:00.000Z', 'g1-stance', []) })
    const untick = manualTest({ gate: gate1, item: { id: 'g1-stance' }, pass: false, today: TODAY, id: newGateTestId('2026-11-22T14:05:00.000Z', 'g1-stance', []) })
    for (const gateTests of [[tick, untick], [untick, tick]]) {
      const view = gatesView({ today: TODAY, settings: settings(), history: { ...loggedPhase1(), gateTests }, program: PROGRAM, aclRsiEntries: [] })
      expect(byId(view, 'g1-stance')).toMatchObject({ pass: false, word: 'Not yet', detail: 'Unticked Sunday Nov 22.' })
    }
    const older = { ...tick, date: '2026-11-20', id: newGateTestId('2026-11-20T14:00:00.000Z', 'g1-stance', []) }
    expect(orderedTests([tick, older]).map((t) => t.date)).toEqual(['2026-11-20', TODAY])
  })

  it('ids lead with the stamp and never collide', () => {
    expect(newGateTestId('2026-11-22T14:00:00.000Z', 'single-hop', [])).toBe('gate-test-2026-11-22T14:00:00.000Z-single-hop')
    expect(newGateTestId('S', 'k', ['gate-test-S-k', 'gate-test-S-k-2'])).toBe('gate-test-S-k-3')
  })

  it('earlier tests list newest first, by date then write order, with the percent each read', () => {
    const t = (id: string, date: IsoDate, valueInjured: number, extra: Partial<GateTest> = {}): GateTest => ({ id, date, gate: 2, item: 'bulgarian-load', valueInjured, valueOther: 40, pass: false, manual: false, ...extra })
    const tests = [t('gate-test-b', '2026-12-08', 36), t('gate-test-a', '2026-12-08', 30), t('gate-test-c', '2026-12-01', 35), t('gate-test-d', '2026-12-09', 40, { gate: 3 }), t('gate-test-e', '2026-12-09', 40, { item: 'other' })]
    expect(earlierTests(tests, 2, 'bulgarian-load', 0.9, 'lb').map((e) => [e.when, e.percent, e.values, e.word])).toEqual([
      ['Tuesday Dec 8', '90%', '36 vs 40 lb', '✓ passes'],
      ['Tuesday Dec 8', '75%', '30 vs 40 lb', '○ not yet'],
      ['Tuesday Dec 1', '87.5%', '35 vs 40 lb', '○ not yet'],
    ])
    expect(earlierTests([t('z', '2026-12-01', 30, { valueOther: 0 })], 2, 'bulgarian-load', 0.9, 'lb')[0]?.percent).toBe('no percent (the other side was 0)')
  })
})

describe('advancing the phase', () => {
  const items = (passes: boolean[]) => ({ items: passes.map((pass) => ({ pass })), passes: passes.every(Boolean) })
  it('is enabled only when every item passes, and says why otherwise', () => {
    expect(advanceState(items([true, true]), { active: false, items: [] })).toEqual({ enabled: true })
    expect(advanceState(items([true, false]), { active: false, items: [] })).toEqual({ enabled: false, why: '1 item doesn’t pass yet' })
    expect(advanceState(items([false, false, true]), { active: false, items: [] })).toEqual({ enabled: false, why: '2 items don’t pass yet' })
  })

  it('waits while a session is open: it was planned in this phase, and advancing would replan it mid-session (PROGRAM-QUESTIONS 117)', () => {
    expect(advanceState(items([true]), { active: false, items: [] }, [{ label: 'Session C', dateWords: 'Saturday, November 21' }])).toEqual({
      enabled: false,
      why: 'Session C from Saturday, November 21 is still open: finish it or end it early, then advance',
    })
    expect(advanceState(items([true]), { active: false, items: [] }, [{ label: 'Session A', dateWords: 'Tuesday, November 17' }, { label: 'Session C', dateWords: 'Saturday, November 21' }])).toEqual({
      enabled: false,
      why: '2 sessions are still open: finish them or end them early, then advance',
    })
    // Items that don't pass say so first.
    expect(advanceState(items([false, true]), { active: false, items: [] }, [{ label: 'Session C', dateWords: 'Saturday, November 21' }])).toEqual({ enabled: false, why: '1 item doesn’t pass yet' })

    const passing: GateTest[] = [
      { id: 'gate-test-2026-11-21T15:00:00.000Z-sl-leg-press-10rm', date: '2026-11-21', gate: 1, item: 'sl-leg-press-10rm', valueInjured: 80, valueOther: 100, pass: true, manual: false },
      manualTest({ gate: gate1, item: { id: 'g1-stance' }, pass: true, today: '2026-11-21', id: 'gate-test-2026-11-21T15:01:00.000Z-g1-stance' }),
    ]
    const logged = loggedPhase1()
    // Saturday's Session C is open; the gate reads only closed sessions, so it passes underneath.
    const open = workout('2026-11-21', { id: '2026-11-21-p1-c', templateId: 'p1-c', status: 'in-progress' })
    const history = { ...logged, workouts: [...logged.workouts.filter((w) => w.date !== '2026-11-21'), open], gateTests: passing }
    const view = gatesView({ today: '2026-11-21', settings: settings(), history, program: PROGRAM, aclRsiEntries: [] })
    if (view.kind !== 'gate') throw new Error('expected gate 1')
    expect(view.result.passes).toBe(true)
    expect(view.advance).toEqual({ enabled: false, why: 'Session C from Saturday, November 21 is still open: finish it or end it early, then advance' })
  })

  it('waits while the red-flag state suspends progression (rule 9)', () => {
    expect(advanceState(items([true]), { active: true, since: TODAY, items: ['locking'] })).toEqual({ enabled: false, why: 'The red-flag state is on: clear it in Settings, with a note, before advancing' })
    const flag = program.redFlags[0]
    if (!flag) throw new Error('no red flags in the seed')
    const view = gatesView({ today: TODAY, settings: settings({ redFlag: { active: true, since: TODAY, items: [flag.id] } }), history: loggedPhase1(), program: PROGRAM, aclRsiEntries: [] })
    if (view.kind !== 'gate') throw new Error('expected gate 1')
    expect(view.stop).toEqual({ headline: 'Stop. Call the ortho or PT.', items: [flag.text] })
    expect(gatesView({ today: TODAY, settings: settings(), history: loggedPhase1(), program: PROGRAM, aclRsiEntries: [] })).toMatchObject({ kind: 'gate', stop: null })
  })

  it('focus after the confirm closes: Not yet goes back to Advance phase, Yes to the line saying what changed, anything else stays put', () => {
    // After Yes the Advance button is the next gate's, disabled, so focus on it would fall to the page.
    expect(focusAfterConfirm('not-yet')).toBe('advance-button')
    expect(focusAfterConfirm('advanced')).toBe('advanced-line')
    // A tick in the checklist closes the confirm too; focus stays on the tick.
    expect(focusAfterConfirm('checklist')).toBeNull()
  })

  it('asks a Phase 4 question that doesn’t promise templates', () => {
    expect(advanceQuestion(gate3, program.phases, 12, 12)).toBe('Advance to Phase 4: Lacrosse? Its sessions arrive with the next program update; until then Today says they are not written yet.')
  })

  it('says which week the bands count from: this week while its lifts are all ahead, else next week (PROGRAM-QUESTIONS 113)', () => {
    expect(advanceQuestion(gate1, program.phases, 3, 3)).toBe('Advance to Phase 2: Single-leg strength and balance? From the next session the templates change and week bands count from this week.')
    expect(advanceQuestion(gate1, program.phases, 4, 3)).toBe('Advance to Phase 2: Single-leg strength and balance? From the next session the templates change; week bands count from next week, week 4, since this week’s lifts have begun.')
    // Before the program starts, the phase is entered in week 1.
    expect(advanceQuestion(gate1, program.phases, 1, 0)).toBe('Advance to Phase 2: Single-leg strength and balance? From the next session the templates change and week bands count from week 1.')
  })

  it('the view enters the phase this week on Monday before Lift A, and next week once a lift is logged or passed', () => {
    const passingTests = (date: IsoDate): GateTest[] => [
      { id: `gate-test-${date}T15:00:00.000Z-sl-leg-press-10rm`, date, gate: 1, item: 'sl-leg-press-10rm', valueInjured: 80, valueOther: 100, pass: true, manual: false },
      manualTest({ gate: gate1, item: { id: 'g1-stance' }, pass: true, today: date, id: `gate-test-${date}T15:01:00.000Z-g1-stance` }),
    ]
    const monday = '2026-11-23'
    const logged = loggedPhase1()
    const history = { ...logged, morningChecks: [...logged.morningChecks, check(monday)], gateTests: passingTests(monday) }
    const view = gatesView({ today: monday, settings: settings(), history, program: PROGRAM, aclRsiEntries: [] })
    if (view.kind !== 'gate') throw new Error('expected gate 1')
    expect(view.advance).toEqual({ enabled: true })
    expect(view.entryWeek).toBe(4)
    expect(view.question).toBe('Advance to Phase 2: Single-leg strength and balance? From the next session the templates change and week bands count from this week.')
    // A move counts: Tuesday's Lift A moved onto Monday and already passed by Tuesday.
    const tuesday = '2026-11-24'
    const moved = gatesView({
      today: tuesday,
      settings: settings(),
      history: { ...history, morningChecks: [...history.morningChecks, check(tuesday)], sessionMoves: [{ id: 'm1', week: 4, dayA: 'mon', dayB: 'tue' }] },
      program: PROGRAM,
      aclRsiEntries: [],
    })
    if (moved.kind !== 'gate') throw new Error('expected gate 1')
    expect(moved.entryWeek).toBe(5)
  })

  it('Phase 4 has no gate to check', () => {
    expect(currentGate(program.gates, 4)).toBeNull()
    expect(currentGate(program.gates, 2)?.number).toBe(2)
    expect(gatesView({ today: TODAY, settings: settings({ currentPhase: 4 }), history: loggedPhase1(), program: PROGRAM, aclRsiEntries: [] })).toEqual({
      kind: 'no-gate',
      line: 'Gate 3 passed; Phase 4’s sessions arrive with the next program update.',
    })
    expect(noGateWords([], 2)).toBe('No gate leads out of Phase 2 in the program data.')
  })
})

describe('words', () => {
  it('counts and states', () => {
    expect(passCountWords({ items: [{ pass: true }, { pass: false }, { pass: true }, { pass: true }] })).toBe('3 of 4 items pass')
    expect(passCountWords({ items: [{ pass: true }, { pass: false }] })).toBe('1 of 2 items passes')
    expect(stateWords(true)).toEqual({ mark: '✓', word: 'Passes' })
    expect(stateWords(false)).toEqual({ mark: '○', word: 'Not yet' })
    expect(lineWords(0.9)).toBe('90%')
    expect(lineWords(0.8)).toBe('80%')
    expect(sideNames('left')).toEqual({ injured: 'Left · injured', other: 'Right' })
  })

  it('details read as sentences with dates in words', () => {
    expect(detailWords('ticked 2026-11-20')).toBe('Ticked Friday Nov 20.')
    expect(detailWords('swelling flagged on 2026-11-19, 2026-11-20')).toBe('Swelling flagged on Thursday Nov 19, Friday Nov 20.')
    expect(detailWords('80% (80 vs 100) against a 80% line, tested 2026-11-22')).toBe('80% (80 vs 100) against an 80% line, tested Sunday Nov 22.')
    expect(detailWords('90% (9 vs 10) against a 90% line')).toBe('90% (9 vs 10) against a 90% line.')
    expect(detailWords('Done.')).toBe('Done.')
    expect(detailWords('')).toBe('')
  })

  it('rejected writes in one sentence', () => {
    expect(testErrorSentence(new Error('QuotaExceededError'))).toBe('The test did not save (QuotaExceededError). Nothing was written; tap Save again.')
    expect(errorWords('  ')).toBe('no reason was given')
    expect(withoutKey({ a: 1, b: 2 }, 'a')).toEqual({ b: 2 })
  })
})

describe('the seed’s gates fit the screen', () => {
  it('every symmetry item has a line and a test key; load tests name a two-sided exercise to prefill from', () => {
    const symmetry = program.gates.flatMap((g) => g.items.filter((i) => i.evaluator === 'symmetry'))
    expect(symmetry.length).toBeGreaterThan(0)
    for (const item of symmetry) {
      expect(item.threshold, item.id).toBeDefined()
      expect(item.testItem, item.id).toBeDefined()
      if (item.trials !== undefined) continue
      const exercise = program.exercises.find((e) => e.id === item.prefillExerciseId)
      expect(exercise?.unilateral, item.id).toBe(true)
    }
    expect(CALF_RAISE_EXERCISE_IDS.every((id) => program.exercises.some((e) => e.id === id))).toBe(true)
  })

  it('the prefill comes from the gate item’s prefillExerciseId in the program data, not from the test key', () => {
    const item = { id: 'g2-x', text: 'loads within 10%', evaluator: 'symmetry' as const, threshold: 0.9, testItem: 'sl-leg-press-load', prefillExerciseId: 'bulgarian-split-squat' }
    const gate: Gate = { number: 2, fromPhase: 2, toPhase: 3, title: 'Gate 2, to leave Phase 2', items: [item] }
    const bss = workout('2026-12-08', { id: 'w-bss', templateId: 'p2-b', phase: 2 })
    const sets = [set('w-bss', 'bulgarian-split-squat', 'right', 1, 30), set('w-bss', 'bulgarian-split-squat', 'left', 1, 35), set('w-bss', 'single-leg-leg-press', 'right', 2, 90), set('w-bss', 'single-leg-leg-press', 'left', 2, 100)]
    const history: HistoryLike = { workouts: [bss], setLogs: sets, morningChecks: [], runs: [], gateTests: [], sessionMoves: [] }
    const phase2 = settings({ currentPhase: 2, phaseEnteredWeek: 4 })
    const read = (g: Gate) => {
      const row = byId(gatesView({ today: '2026-12-09', settings: phase2, history, program: { ...PROGRAM, gates: [g] }, aclRsiEntries: [] }), 'g2-x')
      if (row.kind !== 'symmetry') throw new Error('expected a symmetry item')
      return row.entry
    }
    expect(read(gate)).toMatchObject({ unit: 'lb', step: 5, prefill: { date: '2026-12-08', injured: 30, other: 35 } })
    expect(read(gate).prefillLine).toContain('Bulgarian split squat, 30 lb right and 35 lb left')
    const bare = { id: item.id, text: item.text, evaluator: item.evaluator, threshold: item.threshold, testItem: item.testItem }
    expect(read({ ...gate, items: [bare] })).toMatchObject({ prefill: null, prefillLine: 'Nothing to prefill from: enter the values from the test.' })
  })
})

describe('the timed hop entry (Batch A, PROGRAM-QUESTIONS 157)', () => {
  const phase3 = settings({ currentPhase: 3, phaseEnteredWeek: 8 })
  const viewOf = (gateTests: GateTest[] = [], aclRsiEntries: AclRsiEntry[] = []) =>
    gatesView({ today: TODAY, settings: phase3, history: { ...loggedPhase1(), gateTests }, program: PROGRAM, aclRsiEntries })
  const timedItem = gate3.items.find((i) => i.id === 'g3-six-meter-timed-hop')
  if (!timedItem) throw new Error('no timed hop item in the seed')

  it('enters seconds to a tenth with a 60 s ceiling, and its words carry the direction; distance hops keep inches', () => {
    const row = byId(viewOf(), 'g3-six-meter-timed-hop')
    if (row.kind !== 'symmetry') throw new Error('expected a symmetry item')
    expect(row.entry).toMatchObject({ key: 'six-meter-timed-hop', threshold: 0.9, trials: 3, timed: true, unit: 's', step: 0.1, max: 60, prefill: null, prefillLine: null })
    expect(trialsIntro(row.entry)).toBe(
      'Up to 3 trials per side, in seconds to a tenth; the fastest of each side counts, and the line reads the other side’s time over the injured side’s, so a slower injured side reads under 100%. A time reads in seconds; 0 isn’t a time — leave the trial empty if the hop didn’t happen.',
    )
    // Enter starts a timed trial at a positive second, never at the refused 0.
    expect(enterStart(row.entry)).toBe(1)
    expect(enterWords(trialName(row.entry.sides.injured, 0), enterStart(row.entry), row.entry.unit)).toBe('Enter right · injured, trial 1, starting at 1 s')
    const single = byId(viewOf(), 'g3-single-hop')
    if (single.kind !== 'symmetry') throw new Error('expected a symmetry item')
    expect(single.entry).toMatchObject({ timed: false, unit: 'in', step: 1, max: 600 })
    expect(enterStart(single.entry)).toBe(0)
    expect(trialsIntro(single.entry)).toContain('A hop you couldn’t do is 0')
  })

  it('the fastest of each side counts and the live line reads other over injured', () => {
    let form = openForm(3, null)
    ;[2.4, 2.3, 2.5].forEach((v, i) => (form = setValue(form, 'injured', i, v)))
    form = setValue(form, 'other', 0, 2.1)
    const best = formBest(form, true)
    expect(best).toEqual({ injured: 2.3, other: 2.1 })
    expect(bestWords(best.injured, 's', true)).toBe('Fastest 2.3 s')
    expect(bestWords(null, 's', true)).toBe('Fastest: nothing entered yet')
    expect(symmetryLine(best, 0.9, false, true)).toBe('91.3% · the line is 90%: passes')
    expect(symmetryLine({ injured: 2.4, other: 2.1 }, 0.9, false, true)).toBe('87.5% · the line is 90%: not yet')
    expect(formBlocker(form, 3, null, true)).toBeNull()
  })

  it('a 0 s trial is refused in words — 0 isn’t a time — and Save waits on it; a missing side waits in the usual words', () => {
    const zero = setValue(setValue(openForm(3, null), 'injured', 0, 0), 'other', 0, 2.1)
    expect(symmetryLine(formBest(zero, true), 0.9, false, true)).toBe(`${ZERO_TIME_BLOCKER}.`)
    expect(formBlocker(zero, 3, null, true)).toBe(ZERO_TIME_BLOCKER)
    // A 0 beside a usable trial still waits: clear it or it isn't a time.
    const beside = setValue(zero, 'injured', 1, 2.3)
    expect(formBlocker(beside, 3, null, true)).toBe(ZERO_TIME_BLOCKER)
    const oneSide = setValue(openForm(3, null), 'injured', 0, 2.3)
    expect(formBlocker(oneSide, 3, null, true)).toBe('Enter at least one trial on each side to save')
    expect(symmetryLine(formBest(oneSide, true), 0.9, false, true)).toBe('Enter the other side to see the symmetry.')
  })

  it('buildTest keeps the fastest, decides on the inverted ratio, and carries the one-line note into GateTest.notes', () => {
    const form = { injured: [2.4, 2.3, null], other: [2.1, null, null] }
    const draft = buildTest({ gate: gate3, item: timedItem, form, today: TODAY, id: 't-timed', note: '  Soft landing, a little slow off the injured side  ' })
    expect(draft).toEqual({
      ok: true,
      test: {
        id: 't-timed', date: TODAY, gate: 3, item: 'six-meter-timed-hop',
        valueInjured: 2.3, valueOther: 2.1, trialsInjured: [2.4, 2.3], trialsOther: [2.1],
        notes: 'Soft landing, a little slow off the injured side', pass: true, manual: false,
      },
    })
    if (!draft.ok) throw new Error('expected a draft')
    // The earlier list recomputes with the right direction and shows the note in words.
    expect(earlierTests([draft.test], 3, 'six-meter-timed-hop', 0.9, 's', true)).toEqual([
      { id: 't-timed', when: 'Sunday Nov 22', percent: '91.3%', values: '2.3 vs 2.1 s', pass: true, word: '✓ passes', note: 'Soft landing, a little slow off the injured side' },
    ])
    // A distance hop takes the note the same way; a blank note stores nothing.
    const hopItem = gate3.items.find((i) => i.id === 'g3-single-hop')
    if (!hopItem) throw new Error('no single hop item')
    const hop = buildTest({ gate: gate3, item: hopItem, form: { injured: [56, null, null], other: [62, null, null] }, today: TODAY, id: 't-hop', note: 'Shoes on' })
    expect(hop.ok && hop.test.notes).toBe('Shoes on')
    const bare = buildTest({ gate: gate3, item: hopItem, form: { injured: [56, null, null], other: [62, null, null] }, today: TODAY, id: 't-bare', note: '   ' })
    expect(bare.ok && 'notes' in bare.test).toBe(false)
  })

  it('the evaluated row reads the saved test through the gate rule, in the inverted words', () => {
    const draft = buildTest({ gate: gate3, item: timedItem, form: { injured: [2.3, null, null], other: [2.1, null, null] }, today: TODAY, id: 'gate-test-2026-11-22T16:30:00.000Z-six-meter-timed-hop' })
    if (!draft.ok) throw new Error(draft.blocker)
    const row = byId(viewOf([draft.test]), 'g3-six-meter-timed-hop')
    expect(row).toMatchObject({ pass: true, mark: '✓', word: 'Passes', detail: '91.3% (other 2.1 s over injured 2.3 s) against a 90% line, tested Sunday Nov 22.' })
  })
})

describe('the ACL-RSI row and the KOOS offer (Batch A, PROGRAM-QUESTIONS 156, 158)', () => {
  const phase3 = settings({ currentPhase: 3, phaseEnteredWeek: 8 })
  const ACL_FIELDS = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8', 'i9', 'i10', 'i11', 'i12'] as const
  const aclEntry = (date: IsoDate, sum: number): AclRsiEntry =>
    ({ date, ...(Object.fromEntries(ACL_FIELDS.map((f, i) => [f, Math.max(0, Math.min(10, sum - i * 10))])) as Omit<AclRsiEntry, 'date'>) })
  const viewOf = (aclRsiEntries: AclRsiEntry[]) => gatesView({ today: TODAY, settings: phase3, history: loggedPhase1(), program: PROGRAM, aclRsiEntries })

  it('the ACL-RSI item is its own row kind: auto words with the latest score and date; the manual trust toggle stays beside it', () => {
    const view = viewOf([])
    expect(byId(view, 'g3-acl-rsi')).toMatchObject({ kind: 'acl-rsi', pass: false, mark: '○', word: 'Not yet', detail: 'No questionnaire entered yet.' })
    expect(byId(view, 'g3-trust')).toMatchObject({ kind: 'manual' })
    const scored = viewOf([aclEntry('2026-11-20', 92)])
    expect(byId(scored, 'g3-acl-rsi')).toMatchObject({ kind: 'acl-rsi', pass: true, mark: '✓', word: 'Passes', detail: 'Scored 76.6 on Friday Nov 20; the line is 76.' })
    const under = viewOf([aclEntry('2026-11-10', 120), aclEntry('2026-11-20', 91)])
    expect(byId(under, 'g3-acl-rsi')).toMatchObject({ pass: false, detail: 'Scored 75.8 on Friday Nov 20; the line is 76.' })
  })

  it('the KOOS offer is a standing line of plain routing words: it names Progress as where scores live and carries none itself', () => {
    const view = viewOf([])
    if (view.kind !== 'gate') throw new Error('expected a gate')
    expect(view.koosOffer).toBe(KOOS_OFFER)
    expect(view.koosOffer).toBe('Attempting a gate? A KOOS check goes with it: fill the questionnaire in when you test. Scores show on Progress, never here.')
    // No number rides on the offer: a dipping subscale can never read as an extra gate requirement.
    expect(view.koosOffer).not.toMatch(/\d/)
  })
})
