import { describe, expect, it } from 'vitest'
import { PROGRAM } from '../app/session.ts'
import { settingsOnImport } from '../rules/backup.ts'
import { sessionCompliance } from '../rules/compliance.ts'
import type { MorningCheck, SetLog } from '../schema/index.ts'
import { RICH_TODAY, richAclRsi, richHistory, richHome, richLocations, richMarriott, richSettings, richSettingsFlagged } from '../testing/richHistory.fixture.test.ts'
import { gatesView } from './Gates.helpers.ts'
import { afterSave, checkResultView, existingCheckLine, formIntros, formWords, lateChanges, lateResultView, loggedLines, nextTimeView, ownFlagWords, tagIntro, weekOwnFlagWords } from './MorningCheck.helpers.ts'
import { deloadWords, previewSlotsFor, previewView } from './Preview.helpers.ts'
import { phaseScreen, programControls } from './Program.helpers.ts'
import { progressView } from './Progress.helpers.ts'
import { loggedWords, loggerView } from './RunLogger.helpers.ts'
import { cardModel, loadBlocked, notLoggedWords, redFlagRunnerLine, runnerPlan, setTarget, summaryCheckLine, type RunnerSlot } from './SessionRunner.helpers.ts'
import { complianceLine, summaryBlocks } from './session/Summary.helpers.ts'
import { keptDownPeriodWords, redFlagView, settingsOnImportWords } from './Settings.helpers.ts'
import { liftPlanView, modeLine, todayView, yesterdayLogged } from './Today.helpers.ts'
import { weekView, writtenTargetWords } from './Week.helpers.ts'
import { writtenWeekMiles } from '../rules/written.ts'

/*
 * Tester mode's words and shapes, screen by screen (M-U3; PROGRAM-QUESTIONS 223 to 233). The guard
 * (src/rules/engineMode.guard.test.ts) proves nothing reaches the engine; this pins what a tester
 * sees instead, over the rich history.
 */

const history = richHistory
const gym = { location: richHome, kit: richSettings.kit }
const todaysCheck = history.morningChecks.find((c) => c.date === RICH_TODAY) as MorningCheck

describe('the mode line', () => {
  it('says why nothing is worked out, for each tester reason; nothing in full mode', () => {
    expect(modeLine({ mode: 'tester', reason: 'tester' })).toBe('Tester account: this app shows the program as written and works out nothing from your logs.')
    expect(modeLine({ mode: 'tester', reason: 'signed-out' })).toBe('Signed out: this app shows the program as written and works out nothing from your logs. Sign in from Settings, Account.')
    expect(modeLine({ mode: 'tester', reason: 'unconfirmed' })).toMatch(/^This phone hasn’t reached the app’s server yet/)
    for (const reason of ['admin', 'accounts-off', 'pre-accounts'] as const) expect(modeLine({ mode: 'full', reason })).toBeNull()
  })
})

describe('Today in tester mode', () => {
  it('no stop under a flagged state; today’s ticked flag is the tester’s own note', () => {
    const view = todayView({ mode: 'tester', today: RICH_TODAY, settings: richSettingsFlagged, history, program: PROGRAM })
    if (!view.written) throw new Error('tester view')
    expect(view.body.kind).toBe('lift')
    expect(view.ownFlags).toEqual(['You ticked on this morning’s check: Locking or catching: a mechanical block to straightening or bending. This app gives no medical advice and changes nothing because of it. If it worries you, contact a clinician.'])
    expect(Object.keys(view)).not.toContain('downPeriod')
    expect(Object.keys(view)).not.toContain('lateFlags')
  })
  it('a run day: program.md’s row note and the plan’s miles, never capped; no suggestion', () => {
    const view = todayView({ mode: 'tester', today: '2026-12-09', settings: richSettings, history, program: PROGRAM })
    expect(view.body).toMatchObject({ kind: 'run', label: 'Run: easy', note: 'Flattest route you have. Elliptical instead if the knee reads Hold', capped: false, targetReason: 'from the plan' })
    expect(Object.keys(view.body)).not.toContain('suggestion')
  })
  it('yesterday: logged, with no reading', () => {
    expect(yesterdayLogged('2026-12-09', history, PROGRAM.templates)).toEqual([{ label: 'Session A', words: 'Session A: logged.' }])
    expect(yesterdayLogged('2026-12-10', history, PROGRAM.templates)).toEqual([{ label: 'Run: easy', words: 'Run: easy: logged.' }])
  })
  it('the lift block: routes only at the hotel gym, and a window over the written sets', () => {
    const template = PROGRAM.templates.find((t) => t.id === 'p1-a')
    if (!template) throw new Error('seed')
    const plan = liftPlanView('tester', { template, week: 6, settings: richSettings, history, gym: richMarriott, before: '2026-12-08', minutes: 30, label: 'Session A', byId: new Map(PROGRAM.exercises.map((e) => [e.id, e])), items: PROGRAM.equipment })
    expect(plan.movesHeading).toMatch(/^\d+ slots? of Session A changes? at Marriott Downtown:$/)
    expect(plan.moves.join(' ')).not.toMatch(/clean|rack-capped/)
    expect(plan.window[0]).toMatch(/^The full session is about \d+ min, warm-up included\.$/)
  })
})

describe('Week in tester mode', () => {
  it('no reading, check note, stop or down period; the plan’s target; a flag as the own note', () => {
    const view = weekView({ mode: 'tester', today: RICH_TODAY, selected: 5, settings: richSettingsFlagged, history, program: PROGRAM })
    expect(view.stop).toBeNull()
    expect(view.downPeriods).toEqual([])
    expect(view.target).toBe('Target from the plan')
    expect(view.capped).toBe(false)
    for (const day of view.days) {
      expect(day.reading).toBeNull()
      expect(day.checkNote).toBeNull()
      expect(day.downPeriod).toBeNull()
    }
    // Week 5's Tuesday lift; the next morning's check, logged late, ticked Giving way.
    expect(view.days.find((d) => d.date === '2026-12-01')?.lateFlagNote).toBe(
      'You ticked on the check for Wednesday Dec 2’s morning: The knee giving way, buckling, or a shifting sensation under load. This app gives no medical advice and changes nothing because of it. If it worries you, contact a clinician',
    )
    expect(writtenTargetWords(writtenWeekMiles(PROGRAM.mileagePlan, 14, richSettings.startDate, history.runs))).toBe('No target: week 14 is outside the 12-week plan')
  })
})

describe('Progress, Gates, the run logger and Preview in tester mode', () => {
  it('Progress: no clean days, tags, down periods or gate lines; the rest as for full', () => {
    const view = progressView({ mode: 'tester', today: RICH_TODAY, settings: richSettings, history, program: PROGRAM })
    expect(view.clean).toBeNull()
    expect(view.tags).toBeNull()
    expect(view.downPeriods).toEqual([])
    expect(view.refs).toEqual([])
    expect(view.exercises.length).toBeGreaterThan(5)
  })
  it('Gates: the criteria as written, nothing evaluated, no Advance', () => {
    const view = gatesView({ mode: 'tester', today: RICH_TODAY, settings: richSettings, history, program: PROGRAM, locations: richLocations, aclRsiEntries: richAclRsi })
    expect(view.kind).toBe('criteria')
    if (view.kind !== 'criteria') return
    expect(view.lead).toBe('The program’s criteria for leaving Phase 1, as written. This app doesn’t check them on a tester account, and the phase stays where it is.')
    expect(view.items.map((i) => i.text)).toEqual(PROGRAM.gates[0]?.items.map((i) => i.text))
    expect(Object.keys(view)).not.toContain('advance')
    expect(Object.keys(view)).not.toContain('result')
  })
  it('the run logger: the plan’s miles and program.md’s note; no suggestion, stop, swap call or morning', () => {
    const view = loggerView({ mode: 'tester', today: RICH_TODAY, picked: { date: '2026-12-09', type: null }, settings: richSettingsFlagged, history, program: PROGRAM, gym: { name: 'Planet Fitness', available: new Set() } })
    expect(view).toMatchObject({ kind: 'form', suggestion: null, stop: null, swapCall: null, morning: null, written: { note: 'Flattest route you have. Elliptical instead if the knee reads Hold' } })
    if (view.kind === 'form') expect(view.summary.target.capped).toBe(false)
    const run = history.runs.find((r) => r.date === '2026-12-09')
    if (!run) throw new Error('fixture')
    expect(loggedWords('tester', run, RICH_TODAY, history.morningChecks, true)).toBe('Logged for Wednesday Dec 9.')
    expect(loggedWords('tester', { ...run, date: RICH_TODAY }, RICH_TODAY, history.morningChecks)).toBe('Logged.')
  })
  it('Preview: program.md’s cell, the deload’s cut, no warm-up sets, the written caveat', () => {
    const template = PROGRAM.templates.find((t) => t.id === 'p1-a')
    if (!template) throw new Error('seed')
    const slots = previewSlotsFor('tester', { template, week: 4, date: '2026-11-24', today: RICH_TODAY, settings: richSettings, history, gym, items: PROGRAM.equipment, nameOf: (id) => id })
    expect(slots[0]).toMatchObject({ name: 'Leg press, both legs', lines: ['3 × 10–12, RPE 6→7'], notes: ['Deload week: 2 of the written 3 sets.'], ramp: null })
    expect(deloadWords({ written: 1, sets: 1 })).toBe('Deload week: 1 of the written 1 set.')
    expect(previewView({ mode: 'tester', date: '2026-12-01', today: RICH_TODAY, settings: richSettings, history, program: PROGRAM })).toMatchObject({ downPeriod: null, caveat: 'As program.md writes it. Logging changes none of it.' })
  })
})

describe('the morning check in tester mode', () => {
  it('the form: the same taps, a neutral flag intro, no "not flags", no reading words', () => {
    expect(formWords(false, 'tester').painNote).toBe('Minus means less pain than yesterday.')
    expect(formWords(true, 'tester').painNote).toBe('Minus means less pain than the day before.')
    expect(formIntros('tester', true, PROGRAM)).toEqual({
      flagSection: 'Red-flag list, as your own note',
      flagIntro: 'Tick any that describe this morning. This app gives no medical advice and decides nothing from these; what you tick is kept as your own note.',
      lateFlagIntro: null,
      notFlags: null,
    })
    expect(tagIntro('tester')).toBe('Optional. Tap any that fit; none is fine.')
    expect(existingCheckLine('tester', todaysCheck)).toEqual({ kind: 'words', line: 'Already checked in this morning. Saving again replaces it.' })
  })
  it('saving writes nothing to the settings, even with a flag ticked', () => {
    expect(afterSave('tester', richSettings, todaysCheck)).toBe(richSettings)
    expect(afterSave('full', richSettings, todaysCheck)).not.toBe(richSettings)
  })
  it('the result: what was logged and the own note; no reading, no stop, no next time, nothing changed', () => {
    const view = checkResultView('tester', { check: todaysCheck, settings: richSettings }, PROGRAM)
    expect(view).toEqual({
      kind: 'written',
      logged: ['Stiffness gone within 30 minutes: yes', 'Worse than yesterday: no', 'Visible swelling: no', 'Warmth: no', 'Pain change: no change', 'Tags: slept badly; wore the brace', 'Note: Stiff on the stairs.'],
      ownFlag: ownFlagWords({ date: RICH_TODAY, items: ['Locking or catching: a mechanical block to straightening or bending'] }, RICH_TODAY),
    })
    const late: MorningCheck = { ...todaysCheck, id: 'mc-2026-12-06', date: '2026-12-06', loggedOn: RICH_TODAY, painChangePoints: -2, tags: [], redFlags: ['numbness'] }
    expect(lateResultView('tester', late, PROGRAM)).toMatchObject({ kind: 'written', ownFlag: 'You ticked on the check for Sunday Dec 6’s morning: Numbness or tingling below the knee. This app gives no medical advice and changes nothing because of it. If it worries you, contact a clinician.' })
    expect(loggedLines({ ...late, painChangePoints: 1 }, true)).toContain('Pain change: up 1 point')
    expect(loggedLines(late, true)).toContain('Pain change: down 2 points')
    expect(lateChanges('tester', { check: late, today: RICH_TODAY, settings: richSettings, history, program: PROGRAM })).toEqual([])
    const workout = history.workouts[0]
    if (!workout) throw new Error('fixture')
    expect(nextTimeView('tester', { subject: { kind: 'workout', workout }, settings: richSettings, history, gym, program: PROGRAM })).toEqual({ kind: 'written' })
    expect(weekOwnFlagWords({ date: '2026-12-02', items: ['A'] })).not.toMatch(/\.$/)
  })
})

describe('the session in tester mode', () => {
  const template = PROGRAM.templates.find((t) => t.id === 'p1-c')
  const workout = history.workouts.find((w) => w.id === `${RICH_TODAY}-p1-c`)
  if (!template || !workout) throw new Error('fixture')
  const sets = history.setLogs.filter((s) => s.workoutId === workout.id)
  const input = { template, workout, settings: richSettings, history, gym, stored: {}, minutes: null, sets, late: false }

  it('the plan is the written session: the written sides and sets, no extras', () => {
    const plan = runnerPlan('tester', input)
    expect(plan.plans.every((rs) => rs.mode === 'tester')).toBe(true)
    expect(plan.fit.added).toEqual([])
    expect(plan.steps.filter((s) => s.slotId === 'p1c-1').map((s) => s.key)).toEqual(['p1c-1:right:1', 'p1c-1:left:1', 'p1c-1:right:2', 'p1c-1:left:2', 'p1c-1:right:3', 'p1c-1:left:3'])
  })

  it('the card: program.md’s cell and load note, a typed load, the count at the low end, RPE unrated', () => {
    const plan = runnerPlan('tester', input)
    const stepUp = plan.plans.find((rs) => rs.plan.slot.id === 'p1c-1') as RunnerSlot
    const base = { rs: stepUp, editing: null, slotSets: sets.filter((s) => s.slotId === 'p1c-1'), sessionSets: sets, allSets: history.setLogs, injuredSide: 'right' as const, painPerSet: true, swapped: false, late: false }
    const healthy = cardModel('tester', { ...base, step: plan.steps.find((s) => s.key === 'p1c-1:left:1') ?? null })
    expect(healthy?.header).toEqual({ text: '3 × 10 each leg, RPE 6', note: null, moved: null, writtenFor: null, deload: null, loadNote: 'Bodyweight in week 1, dumbbells after' })
    expect(healthy?.draft).toEqual({ load: 0, count: 10, rpe: null, pain: null, heightIn: 6 })
    expect(healthy?.budgetLine).toBeNull()
    expect(healthy?.ramp).toBeNull()
    expect(healthy?.loadBar).toBe('Type the load first')
    if (healthy?.draft) expect(loadBlocked('tester', healthy, healthy.draft)).toBe(true)
    // The injured side's own last set this session carries forward.
    const injured = cardModel('tester', { ...base, step: plan.steps.find((s) => s.key === 'p1c-1:right:3') ?? null })
    expect(injured?.draft).toMatchObject({ load: 20, count: 8, pain: 2, heightIn: 6 })
  })

  it('after a swap: what was written for the slot, and the swap’s own unit', () => {
    const plan = runnerPlan('tester', { ...input, stored: { 'p1c-5': 'wall-sit' } })
    const ext = plan.plans.find((rs) => rs.plan.slot.id === 'p1c-5') as RunnerSlot
    const model = cardModel('tester', { rs: ext, step: plan.steps.find((s) => s.slotId === 'p1c-5') ?? null, editing: null, slotSets: [], sessionSets: sets, allSets: history.setLogs, injuredSide: 'right', painPerSet: true, swapped: true, late: false })
    expect(model?.header.writtenFor).toBe('Written for Leg extension; Wall sit runs here instead.')
    expect(model?.repUnit).toBe('seconds')
    expect(model?.draft?.count).toBe(30)
  })

  it('a tester’s set never carries the rack mark', () => {
    for (const rs of runnerPlan('tester', input).plans) for (const side of ['left', 'right', 'both'] as const) expect(setTarget(rs, side)?.rackCapped).toBe(false)
  })

  it('a mode flip mid-session plans again without a crash, and keeps what is logged', () => {
    const full = runnerPlan('full', input)
    const tester = runnerPlan('tester', input)
    expect(full.plans.map((rs) => rs.plan.slot.id).slice(0, 3)).toEqual(tester.plans.map((rs) => rs.plan.slot.id).slice(0, 3))
    for (const plan of [full, tester]) {
      const done = plan.steps.filter((s) => sets.some((set: SetLog) => `${set.slotId}:${set.side}:${set.setNumber}` === s.key))
      expect(done.map((s) => s.key)).toEqual(['p1c-1:right:1', 'p1c-1:right:2'])
    }
    // A full plan never opens the engine's card in tester mode.
    const first = full.plans[0]
    if (first) expect(cardModel('tester', { rs: first, step: null, editing: null, slotSets: [], sessionSets: [], allSets: [], injuredSide: 'right', painPerSet: true, swapped: false, late: false })).toBeNull()
  })

  it('the Summary: no reading, written sets, the check line without a reading', () => {
    const finished = history.workouts.find((w) => w.id === '2026-12-08-p1-a')
    const a = PROGRAM.templates.find((t) => t.id === 'p1-a')
    if (!finished || !a) throw new Error('fixture')
    const logged = history.setLogs.filter((s) => s.workoutId === finished.id)
    for (const block of summaryBlocks('tester', a, logged, 'right')) expect(Object.keys(block)).not.toContain('reading')
    expect(complianceLine(sessionCompliance({ slots: a.slots, workout: finished, sets: logged, phaseWeek: 6 }), 'tester')).toMatch(/written sets|written set/)
    expect(summaryCheckLine({ mode: 'tester', workout: finished, today: RICH_TODAY, startDate: richSettings.startDate, history })).toEqual({ text: 'The morning check from Wednesday Dec 9 is logged.', action: null })
    expect(summaryCheckLine({ mode: 'tester', workout: { id: 'x', date: RICH_TODAY }, today: RICH_TODAY, startDate: richSettings.startDate, history }).text).toBe('Tomorrow morning’s check is on the Morning check screen.')
    const noCheckToday = { ...history, morningChecks: history.morningChecks.filter((c) => c.date !== RICH_TODAY) }
    expect(summaryCheckLine({ mode: 'tester', workout: { id: 'x', date: '2026-12-11' }, today: RICH_TODAY, startDate: richSettings.startDate, history: noCheckToday })).toEqual({ text: 'This morning’s check is on the Morning check screen.', action: { kind: 'morning', label: 'Morning check' } })
    expect(summaryCheckLine({ mode: 'tester', workout: { id: '2026-12-05-p1-c', date: '2026-12-05' }, today: RICH_TODAY, startDate: richSettings.startDate, history })).toEqual({
      text: 'The check for the next morning, Sunday Dec 6, can still be logged.',
      action: { kind: 'late', morning: '2026-12-06', label: 'Log the morning check for Sunday Dec 6' },
    })
    expect(notLoggedWords({ notLogged: ['1 Leg press'], notFinished: [] }, false, 'tester')).toBe('Not logged: 1 Leg press.')
    expect(redFlagRunnerLine('tester', richSettingsFlagged)).toBeNull()
    expect(redFlagRunnerLine('full', richSettingsFlagged)).toBe('Red-flag state: progression is suspended; loads repeat the last session.')
  })
})

describe('Settings and Program in tester mode', () => {
  it('no red-flag section, and the import says nothing of one or of a down period', () => {
    expect(redFlagView('tester', richSettingsFlagged.redFlag, PROGRAM.redFlags)).toBeNull()
    expect(settingsOnImportWords('tester', settingsOnImport(richSettingsFlagged, richSettings), PROGRAM.redFlags, PROGRAM.phases).redFlag).toBeNull()
    expect(keptDownPeriodWords(history.downPeriods ?? [], [], '2026-12-01', 'tester')).toBeNull()
  })
  it('the Program screen is read-only, in the calendar’s phase week', () => {
    expect(programControls('tester')).toEqual({ canEdit: false })
    expect(programControls('full')).toEqual({ canEdit: true })
    expect(phaseScreen(richSettings, '2026-12-01', [], history.downPeriods ?? [], 'tester').lead).toBe('Phase 1, Foundation: week 5 of the phase, as written. A tester account can’t edit it.')
  })
})
