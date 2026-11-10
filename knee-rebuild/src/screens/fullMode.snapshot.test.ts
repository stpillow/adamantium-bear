import { describe, expect, it } from 'vitest'
import { PROGRAM, availableAt, planSession, rampsInOrder, sessionExtensions, warmUpFor, windowFit, type Gym, type SlotPlan } from '../app/session.ts'
import type { History } from '../db/repo.ts'
import { exerciseById } from '../program/program.ts'
import { settingsOnImport } from '../rules/backup.ts'
import { addDays } from '../rules/calendar.ts'
import { sessionCompliance } from '../rules/compliance.ts'
import { morningReading } from '../rules/reading.ts'
import { lateFlagNote } from '../rules/redFlags.ts'
import type { IsoDate, Location, MorningCheck, Settings } from '../schema/index.ts'
import {
  RICH_TODAY,
  RICH_TODAYS,
  richAclRsi,
  richHistory,
  richHome,
  richKoos,
  richLocations,
  richMarriott,
  richSettings,
  richSettingsFlagged,
} from '../testing/richHistory.fixture.test.ts'
import { gatesView } from './Gates.helpers.ts'
import { afterSave, formWords, lateChanges, lateResultView, nextTimeView, settingsAfter, subjectFor, weekLateFlagWords } from './MorningCheck.helpers.ts'
import { previewSlotsFor, previewView } from './Preview.helpers.ts'
import { exerciseView, progressView } from './Progress.helpers.ts'
import { loggedWords, loggerView } from './RunLogger.helpers.ts'
import { cardModel, holdsOffFor, loadBlocked, runnerPlan, runsExerciseId, setStepKey, summaryCheckLine } from './SessionRunner.helpers.ts'
import { complianceLine } from './session/Summary.helpers.ts'
import { redFlagView, settingsOnImportWords } from './Settings.helpers.ts'
import { liftChanges, liftPlanView, todayView, yesterdayReadings } from './Today.helpers.ts'
import { weekView } from './Week.helpers.ts'

/*
 * The full-mode pin (M-U3, step 1): today's outputs, before tester mode touched anything, over a
 * rich logged history (src/testing/richHistory.fixture.test.ts), snapshotted and committed. From
 * then on this file is the proof that Shawn's full mode is byte-identical: later changes only add
 * `mode: 'full'` to these calls, or swap a screen's own composition (the parts that moved out of
 * Today.tsx, SessionRunner.tsx, ActiveCard.tsx, MorningCheck.tsx and Preview.tsx into mode-taking
 * helpers) for the helper that now does it, and no snapshot here may be updated in the same change.
 */

const SETTINGS: readonly [string, Settings][] = [
  ['plain', richSettings],
  ['flagged', richSettingsFlagged],
]
const gymAt = (location: Location, settings: Settings): Gym => ({ location, kit: settings.kit })
const nameOf = (id: string) => exerciseById(id).name
void sessionExtensions
const gymAvailable = (location: Location, settings: Settings) => availableAt(gymAt(location, settings))

/** A plan, with the catalog objects named by id: they are lookups, and the snapshot stays readable. */
function compact(plans: readonly SlotPlan[]) {
  return plans.map((p) => ({ slot: p.slot, exercise: p.exercise.id, substitutions: p.substitutions.map((e) => e.id), prescriptions: p.prescriptions, route: p.route }))
}

// ---- Screen compositions, as the screens composed them before M-U3 ----

/** Today.tsx's MovesBlock and FitBlock for a lift day: the gym's changes and the time window's words (`liftPlanView` since M-U3). */
function todayLiftComposition(today: IsoDate, settings: Settings, history: History, gym: Location, minutes: number | null) {
  const view = todayView({ mode: 'full', today, settings, history, program: PROGRAM })
  if (view.body.kind !== 'lift' || !view.body.template) return null
  const { template, workout } = view.body
  const plan = liftPlanView('full', {
    template,
    week: workout?.week ?? view.body.week,
    settings,
    history,
    gym,
    before: workout?.date ?? today,
    minutes,
    label: view.body.label,
    byId: new Map(PROGRAM.exercises.map((e) => [e.id, e])),
    items: PROGRAM.equipment,
  })
  return { moves: plan.moves, fit: plan.window }
}

/** The pinned budget lines were written short; the card's words carry the same number. */
function shortBudget(line: string | null): string | null {
  if (line === null) return null
  const n = /^Budget (\d+):/.exec(line)?.[1]
  return n !== undefined ? `Budget ${n}` : 'Budget: injured first'
}

/** SessionRunner.tsx and ActiveCard.tsx for a workout: the plan, the steps, and each step's card as it opens (`runnerPlan`, `cardModel` since M-U3). */
function runnerComposition(workoutId: string, settings: Settings, history: History, location: Location, minutes: number | null) {
  const workout = history.workouts.find((w) => w.id === workoutId)
  const template = workout ? PROGRAM.templates.find((t) => t.id === workout.templateId) : undefined
  if (!workout || !template) throw new Error(`no workout ${workoutId}`)
  const sets = history.setLogs.filter((s) => s.workoutId === workout.id)
  const gym = gymAt(location, settings)
  const plan = runnerPlan('full', { template, workout, settings, history, gym, stored: {}, minutes, sets, late: false })
  const done = new Set(sets.map(setStepKey))
  const cards = plan.plans.map((rs) => {
    const slotSets = sets.filter((s) => s.slotId === rs.plan.slot.id)
    const runsId = runsExerciseId(rs)
    const held = holdsOffFor(plan.unswapped.find((u) => u.plan.slot.id === rs.plan.slot.id), rs.plan.exercise.id, location.dumbbellMaxLb)
    const input = { rs, editing: null, slotSets, sessionSets: sets, allSets: history.setLogs, injuredSide: settings.injuredSide, painPerSet: settings.painPerSet, swapped: plan.chosen[rs.plan.slot.id] !== undefined, late: false }
    const ramp = cardModel('full', { ...input, step: null })?.ramp ?? null
    const stepCards = plan.steps
      .filter((s) => s.slotId === rs.plan.slot.id && !done.has(s.key))
      .map((step) => {
        const model = cardModel('full', { ...input, step })
        if (!model || !model.draft) return null
        return {
          step: step.key,
          words: model.header.text,
          note: model.prescription?.note,
          moved: model.header.moved !== null,
          draft: model.draft,
          blockedOnLoad: loadBlocked('full', model, model.draft),
          budgetLine: shortBudget(model.budgetLine),
        }
      })
    return { slotId: rs.plan.slot.id, runsId, holdsOff: held?.why ?? null, ramp, stepCards }
  })
  return { fit: plan.fit, chosen: plan.chosen, steps: plan.steps.map((s) => s.key), cards }
}

/** MorningCheck.tsx's NextTime after a lift (`nextTimeView` since M-U3). */
function nextTimeComposition(workoutId: string, settings: Settings, history: History) {
  const workout = history.workouts.find((w) => w.id === workoutId)
  if (!workout) throw new Error(`no workout ${workoutId}`)
  const view = nextTimeView('full', { subject: { kind: 'workout', workout }, settings, history, gym: gymAt(richHome, settings), program: PROGRAM })
  return view.kind === 'plan' ? view.sentences : null
}

/** Preview.tsx's slots for a lift day (`previewSlotsFor` since M-U3). */
function previewComposition(date: IsoDate, today: IsoDate, settings: Settings, history: History) {
  const view = previewView({ mode: 'full', date, today, settings, history, program: PROGRAM })
  if (view.body.kind !== 'lift' || !view.body.template) return { view, slots: null }
  return { view, slots: previewSlotsFor('full', { template: view.body.template, week: view.body.week, date, today, settings, history, gym: gymAt(richHome, settings), items: PROGRAM.equipment, nameOf }) }
}

/** The late morning check's result (MorningCheck.tsx's LateCheckScreen and LateResult; `lateChanges` and `lateResultView` since M-U3). */
function lateCheckComposition(check: MorningCheck, today: IsoDate, settings: Settings, history: History) {
  const result = lateResultView('full', check, PROGRAM)
  if (result.kind !== 'full') throw new Error('full mode')
  const note = lateFlagNote(check, PROGRAM.redFlags)
  return { reading: result.reading, changes: lateChanges('full', { check, today, settings, history, program: PROGRAM }), note: result.note, weekNote: note ? weekLateFlagWords(note) : null }
}

const lateCheck: MorningCheck = {
  id: 'mc-2026-12-06',
  date: '2026-12-06',
  appliesTo: null,
  stiffnessUnder30Min: false,
  worseThanYesterday: true,
  visibleSwelling: false,
  warmth: false,
  painChangePoints: 2,
  redFlags: ['rom-worse'],
  loggedOn: RICH_TODAY,
}

describe('full mode, pinned before tester mode', () => {
  it('the planner: planSession for every template, weeks 1 to 6, at both gyms', () => {
    for (const [name, settings] of SETTINGS) {
      for (const template of PROGRAM.templates) {
        for (const week of [1, 2, 3, 4, 5, 6]) {
          const plans = planSession({ template, week, settings, history: richHistory, gym: gymAt(richHome, settings), before: RICH_TODAY })
          expect(compact(plans)).toMatchSnapshot(`${name} ${template.id} week ${week}`)
        }
        const away = planSession({ template, week: 5, settings, history: richHistory, gym: gymAt(richMarriott, settings), before: '2026-12-01', chosenExercise: { [template.slots[0]?.id ?? '']: template.slots[0]?.substitutionIds[1] } })
        expect(compact(away)).toMatchSnapshot(`${name} ${template.id} at the hotel`)
      }
    }
  })

  it('the planner: ramps, the time window and the gym changes', () => {
    for (const [name, settings] of SETTINGS) {
      for (const template of PROGRAM.templates.filter((t) => t.phase === settings.currentPhase)) {
        for (const location of richLocations) {
          const gym = gymAt(location, settings)
          const extend = sessionExtensions(template, richHistory, settings, 6, RICH_TODAY)
          const plans = planSession({ template, week: 6, settings, history: richHistory, gym, before: RICH_TODAY, extend })
          const warm = warmUpFor(template.phase, gym)
          expect({
            ramps: rampsInOrder(plans, false),
            late: rampsInOrder(plans, true),
            fits: [null, 30, 75].map((m) => windowFit(plans, settings.restTimerSeconds, m, { warmUpMinutes: warm.total, ramps: true })),
            changes: liftChanges({ plans, byId: new Map(PROGRAM.exercises.map((e) => [e.id, e])), items: PROGRAM.equipment, rackLb: location.dumbbellMaxLb }),
          }).toMatchSnapshot(`${name} ${template.id} at ${location.id}`)
        }
      }
    }
  })

  it('Today: the view, yesterday, and the lift block’s moves and time window', () => {
    for (const [name, settings] of SETTINGS) {
      for (const today of RICH_TODAYS) {
        expect(todayView({ mode: 'full', today, settings, history: richHistory, program: PROGRAM })).toMatchSnapshot(`${name} ${today} view`)
        expect(yesterdayReadings(today, richHistory, PROGRAM.templates, settings.injuredSide)).toMatchSnapshot(`${name} ${today} yesterday`)
        for (const location of richLocations) {
          for (const minutes of [null, 30, 75]) {
            expect(todayLiftComposition(today, settings, richHistory, location, minutes)).toMatchSnapshot(`${name} ${today} ${location.id} ${minutes} lift`)
          }
        }
      }
    }
  })

  it('Week: weeks 1 to 6', () => {
    for (const [name, settings] of SETTINGS) {
      for (const week of [1, 2, 3, 4, 5, 6]) {
        expect(weekView({ mode: 'full', today: RICH_TODAY, selected: week, settings, history: richHistory, program: PROGRAM })).toMatchSnapshot(`${name} week ${week}`)
      }
    }
  })

  it('Progress: the view and every logged exercise', () => {
    for (const [name, settings] of SETTINGS) {
      const view = progressView({ mode: 'full', today: RICH_TODAY, settings, history: richHistory, program: PROGRAM, hrSettings: { id: 'heart-rate', maxHr: 185, restingHr: 52 }, vo2Readings: [{ date: '2026-12-01', vo2: 44 }], koosEntries: richKoos })
      expect({ ...view, records: view.records.length }).toMatchSnapshot(`${name} progress`)
      for (const row of view.exercises) {
        expect(exerciseView({ records: view.records, setLogs: richHistory.setLogs, row, injuredSide: settings.injuredSide, catalog: PROGRAM.exercises })).toMatchSnapshot(`${name} exercise ${row.id}`)
      }
    }
  })

  it('Gates', () => {
    for (const [name, settings] of SETTINGS) {
      for (const today of [RICH_TODAY, '2026-11-26']) {
        expect(gatesView({ mode: 'full', today, settings, history: richHistory, program: PROGRAM, locations: richLocations, aclRsiEntries: richAclRsi })).toMatchSnapshot(`${name} ${today} gates`)
      }
    }
  })

  it('the run logger: the view for each day, and the logged words for each run', () => {
    for (const [name, settings] of SETTINGS) {
      for (const date of ['2026-11-30', '2026-12-02', '2026-12-04', '2026-12-07', '2026-12-09', '2026-12-11', RICH_TODAY]) {
        for (const location of richLocations) {
          expect(loggerView({ mode: 'full', today: RICH_TODAY, picked: { date, type: null }, settings, history: richHistory, program: PROGRAM, gym: { name: location.name, available: gymAvailable(location, settings) } })).toMatchSnapshot(`${name} ${date} ${location.id} logger`)
        }
      }
      expect(richHistory.runs.map((r) => loggedWords('full', r, RICH_TODAY, richHistory.morningChecks, true))).toMatchSnapshot(`${name} logged words`)
    }
  })

  it('the morning check: settings after, the form words, next time, a late check', () => {
    const todays = richHistory.morningChecks.find((c) => c.date === RICH_TODAY)
    if (!todays) throw new Error('fixture has today’s check')
    const clean = { ...todays, redFlags: [] }
    for (const [name, settings] of SETTINGS) {
      expect([afterSave('full', settings, todays), afterSave('full', settings, clean), afterSave('full', settings, lateCheck)]).toMatchSnapshot(`${name} settings after`)
      for (const c of [todays, clean, lateCheck]) expect(afterSave('full', settings, c)).toStrictEqual(settingsAfter(settings, c))
      for (const workout of richHistory.workouts) expect(nextTimeComposition(workout.id, settings, richHistory)).toMatchSnapshot(`${name} next time after ${workout.id}`)
      expect(lateCheckComposition(lateCheck, RICH_TODAY, settings, richHistory)).toMatchSnapshot(`${name} late check`)
      expect(morningReading(todays)).toMatchSnapshot(`${name} today’s reading`)
    }
    expect([formWords(false, 'full'), formWords(true, 'full')]).toMatchSnapshot('form words')
    expect(subjectFor(richHistory.workouts, richHistory.runs, addDays(RICH_TODAY, -1))).toMatchSnapshot('subject')
  })

  it('Preview and the session: slots, the check line and the compliance line', () => {
    for (const [name, settings] of SETTINGS) {
      for (const date of ['2026-11-24', '2026-12-08', '2026-12-10', RICH_TODAY, '2026-12-15']) {
        expect(previewComposition(date, RICH_TODAY, settings, richHistory)).toMatchSnapshot(`${name} preview ${date}`)
      }
      for (const workout of richHistory.workouts) {
        const template = PROGRAM.templates.find((t) => t.id === workout.templateId)
        const sets = richHistory.setLogs.filter((s) => s.workoutId === workout.id)
        expect({
          check: summaryCheckLine({ mode: 'full', workout, today: RICH_TODAY, startDate: settings.startDate, history: richHistory }),
          compliance: template ? complianceLine(sessionCompliance({ slots: template.slots, workout, sets, phaseWeek: 1 }), 'full') : null,
        }).toMatchSnapshot(`${name} summary ${workout.id}`)
      }
    }
  })

  it('the runner: today’s session in progress, and a fresh one at the hotel', () => {
    for (const [name, settings] of SETTINGS) {
      expect(runnerComposition(`${RICH_TODAY}-p1-c`, settings, richHistory, richHome, null)).toMatchSnapshot(`${name} runner today`)
      expect(runnerComposition(`${RICH_TODAY}-p1-c`, settings, richHistory, richMarriott, 45)).toMatchSnapshot(`${name} runner today at the hotel`)
      expect(runnerComposition('2026-12-08-p1-a', settings, richHistory, richMarriott, null)).toMatchSnapshot(`${name} runner week 6 A at the hotel`)
    }
  })

  it('Settings: the red flag and the import words', () => {
    for (const [name, settings] of SETTINGS) {
      expect(redFlagView('full', settings.redFlag, PROGRAM.redFlags)).toMatchSnapshot(`${name} red flag`)
      expect(settingsOnImportWords('full', settingsOnImport(settings, { ...richSettings, currentPhase: 2 }), PROGRAM.redFlags, PROGRAM.phases)).toMatchSnapshot(`${name} import words`)
    }
  })
})
