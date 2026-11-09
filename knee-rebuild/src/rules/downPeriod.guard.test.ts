import { describe, expect, it } from 'vitest'
import { planSession } from '../app/session.ts'
import type { History } from '../db/repo.ts'
import { homeLocation } from '../db/migrations.ts'
import { program } from '../program/program.ts'
import { DEFAULT_KIT, Settings, type DownPeriod, type Exercise, type MorningCheck, type ReadingResult, type Run, type SetLog, type SetSide, type Slot, type Workout } from '../schema/index.ts'
import { gateContext } from '../screens/Gates.helpers.ts'
import { addDays } from './calendar.ts'
import { sessionCompliance } from './compliance.ts'
import { newDownPeriod, endedEarly, pauseOn, type Pause } from './downPeriod.ts'
import { effectiveSlot } from './effectiveSlot.ts'
import { evaluateGate } from './gates.ts'
import { attachChecks, exerciseReadings, subjectReadings } from './history.ts'
import { tagCounts } from './morningTags.ts'
import { effectiveReading, prescribe, type Prescription, type PrescriptionInput } from './prescription.ts'
import { consecutiveCleanDays } from './progress.ts'
import { slotAtGym } from './slotExercise.ts'
import { acuteChronic, trainingLoads, weeklyTrainingLoads } from './trainingLoad.ts'
import { targetForWeek } from './weekPlan.ts'
import { kneeMorning } from './wholeKnee.ts'

/*
 * A down period pauses progression and keeps the readings real (Batch E, Shawn's Nov 8 decision 6;
 * PROGRAM-QUESTIONS 181 to 189). This guard holds both halves:
 * (a) who may mention it: the schema, the rule, the four engine sites it hooks (prescription,
 *     placement, mileage and its target type, the backup), the composition in app/session.ts, the
 *     database, and the screens that show or declare it. Never the readings, the history, the gates,
 *     training load, compliance, gym loads, the whole knee, the red flag, deloads, the time window,
 *     late checks or tags;
 * (b) the readings, the gates, training load, compliance counts, tag counts and the clean-days count
 *     come out identical with and without periods, and a plan for a day outside every period too;
 * (c) the pause can only ever make a prescription, a placement or a week's target equal or lower,
 *     never higher, over every seed slot and exercise.
 */

const sources = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const isTest = (path: string) => /\.test\.tsx?$/.test(path)
const mentions = (source: string) => /downPeriod|DownPeriod|pauseOn|isPaused|weekHeld|[bB]andWeek|pausedNote|pauseDate/.test(source)

/** Every app source (tests are exempt, as in morningTags.guard) that may mention a down period. */
const MENTIONS: readonly string[] = [
  '/src/schema/log.ts',
  '/src/schema/program.ts',
  '/src/rules/downPeriod.ts',
  '/src/rules/prescription.ts',
  '/src/rules/slotExercise.ts',
  '/src/rules/mileage.ts',
  '/src/rules/weekPlan.ts',
  '/src/rules/backup.ts',
  '/src/app/session.ts',
  '/src/db/db.ts',
  '/src/db/repo.ts',
  '/src/db/hooks.ts',
  '/src/db/backup.ts',
  '/src/screens/Today.helpers.ts',
  '/src/screens/Today.tsx',
  '/src/screens/Week.helpers.ts',
  '/src/screens/Week.tsx',
  '/src/screens/Gates.helpers.ts',
  '/src/screens/Progress.helpers.ts',
  '/src/screens/Progress.tsx',
  '/src/screens/Preview.helpers.ts',
  '/src/screens/Program.helpers.ts',
  '/src/screens/Program.tsx',
  '/src/screens/LocationEditor.helpers.ts',
  '/src/screens/LocationEditor.tsx',
  '/src/screens/Preview.tsx',
  '/src/screens/RunLogger.helpers.ts',
  '/src/screens/MorningCheck.tsx',
  '/src/screens/SessionRunner.tsx',
  '/src/screens/Settings.helpers.ts',
  // The import section, shared by Settings and first run since M-U1: a standing period stays through an import.
  '/src/screens/settings/parts.tsx',
]

/** The engine's other rules: none may know a down period exists. */
const NEVER: readonly string[] = [
  '/src/rules/reading.ts',
  '/src/rules/history.ts',
  '/src/rules/gates.ts',
  '/src/rules/trainingLoad.ts',
  '/src/rules/compliance.ts',
  '/src/rules/gymLoads.ts',
  '/src/rules/wholeKnee.ts',
  '/src/rules/redFlags.ts',
  '/src/rules/deload.ts',
  '/src/rules/fitWindow.ts',
  '/src/rules/lateCheck.ts',
  '/src/rules/morningTags.ts',
  '/src/rules/progress.ts',
  '/src/rules/session.ts',
]

describe('who may mention a down period', () => {
  it('finds the sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    for (const path of [...MENTIONS, ...NEVER]) expect(Object.keys(sources), path).toContain(path)
  })

  it('no app source outside the list mentions it', () => {
    for (const [path, source] of Object.entries(sources)) {
      if (isTest(path) || MENTIONS.includes(path)) continue
      expect(mentions(source), `${path} mentions a down period`).toBe(false)
    }
  })

  it('the readings, history, gates, load, compliance, the whole knee, the red flag, deloads, the window, late checks and tags never do', () => {
    for (const path of NEVER) expect(mentions(sources[path] ?? ''), path).toBe(false)
  })

  it('every listed file really does mention it (the list stays tight)', () => {
    for (const path of MENTIONS) expect(mentions(sources[path] ?? ''), path).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
// (b) Readings stay real

const START = '2026-11-02'
const TODAY = '2026-11-28'
const AT = '2026-11-01T13:00:00.000Z'
const settings = Settings.parse({ injuredSide: 'right', startDate: START, dumbbellMax: 80, restTimerSeconds: 60, painPerSet: false, currentPhase: 1, phaseEnteredWeek: 1 })
const gym = { location: homeLocation(200, program.planetFitness, START, program.equipmentListVersion), kit: DEFAULT_KIT }
const templateA = program.templates.find((t) => t.id === 'p1-a')
if (!templateA) throw new Error('P1-A is in the seed')
const firstSlot = templateA.slots[0]
if (!firstSlot) throw new Error('P1-A has a slot')
const legPress: Slot = firstSlot

const lift = (date: string, week: number): Workout => ({ id: `${date}-p1-a`, date, templateId: 'p1-a', phase: 1, week, isDeload: week === 4, status: 'finished', sessionRpe: 6, durationMinutes: 50 })
const sets = (w: Workout, pain: number): SetLog[] =>
  [1, 2, 3].map((n) => ({ id: `${w.id}:${legPress.id}:both:${n}`, workoutId: w.id, slotId: legPress.id, exerciseId: legPress.exerciseId, setNumber: n, side: 'both', load: 90, loadUnit: 'lb', reps: 12, rpe: 7, painDuring: pain, stopped: false }))
const run = (date: string, maxPain: number, miles = 4): Run => ({ id: `run-${date}`, date, type: 'long', miles, minutes: miles * 10, effort: 'easy', rpe: 4, maxPain, strides: false, tempo: false })
const check = (date: string, over: Partial<MorningCheck> = {}): MorningCheck => ({ id: `mc-${date}`, date, appliesTo: null, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [], ...over })

// Sessions before (Nov 3, 10), inside (Nov 17), straddling the end (a run Nov 20, its check Nov 21) and after (Nov 24) the period.
const lifts = [lift('2026-11-03', 1), lift('2026-11-10', 2), lift('2026-11-17', 3), lift('2026-11-24', 4)]
const base: History = {
  workouts: lifts,
  setLogs: lifts.flatMap((w, i) => sets(w, [1, 2, 4, 6][i] ?? 1)),
  runs: [run('2026-11-06', 1), run('2026-11-13', 4), run('2026-11-20', 2), run('2026-11-27', 1)],
  morningChecks: [
    check('2026-11-04', { tags: ['poor-sleep'] }),
    check('2026-11-07'),
    check('2026-11-11', { worseThanYesterday: true }),
    check('2026-11-14', { tags: ['brace'] }),
    check('2026-11-18'),
    check('2026-11-21', { visibleSwelling: true }),
    check('2026-11-25'),
  ],
  gateTests: [],
  sessionMoves: [],
}
const PERIODS: DownPeriod[] = [newDownPeriod({ today: '2026-11-14', days: 7, declaredAt: AT }), endedEarly(newDownPeriod({ today: '2026-11-25', days: 5, declaredAt: AT }), '2026-11-26')]

function decisions(h: History) {
  const records = attachChecks(h.workouts, h.setLogs, h.morningChecks)
  const readings = subjectReadings(records, h.runs, h.morningChecks, 'right')
  const loads = trainingLoads(records, h.runs)
  const context = gateContext({ today: TODAY, settings, history: h, aclRsiEntries: [] })
  return {
    readings,
    exercise: exerciseReadings(records, legPress.exerciseId, 'right'),
    knee: ['2026-11-12', '2026-11-17', '2026-11-19', '2026-11-22', '2026-11-26'].map((d) => kneeMorning(h.morningChecks, h.workouts, d)),
    clean: consecutiveCleanDays(readings, TODAY, h.morningChecks),
    gates: program.gates.map((gate) => evaluateGate(gate, context)),
    loads,
    weekly: weeklyTrainingLoads(loads, START, 4),
    acwr: acuteChronic(loads, TODAY, START),
    compliance: lifts.map((w) => sessionCompliance({ slots: templateA?.slots ?? [], workout: w, sets: h.setLogs.filter((s) => s.workoutId === w.id), phaseWeek: 1 })),
    tags: tagCounts(h.morningChecks, readings),
  }
}

describe('readings stay real: nothing is invented or marked hold', () => {
  it('readings, effective readings, the whole knee, clean days, every gate, load, compliance and tag counts are the same with and without periods', () => {
    const plain = decisions(base)
    // The fixture is not empty: a back-off is read inside a period, and a hold before one.
    expect(plain.readings.map((r) => r.result)).toEqual(expect.arrayContaining(['clean', 'hold', 'back-off']))
    expect(decisions({ ...base, downPeriods: PERIODS })).toEqual(plain)
  })

  it('a plan for a day outside every period is the same with and without them', () => {
    for (const [before, week] of [['2026-11-10', 2], ['2026-11-12', 2], ['2026-11-21', 3], ['2026-11-24', 4], ['2026-12-01', 5]] as const) {
      const plan = (h: History) => planSession({ template: templateA, week, settings, history: h, gym, before }).map((p) => p.prescriptions)
      expect(plan({ ...base, downPeriods: PERIODS }), before).toEqual(plan(base))
    }
  })
})

// ---------------------------------------------------------------------------------------------
// (c) Never higher

const byId = new Map(program.exercises.map((e) => [e.id, e]))
const ex = (id: string): Exercise => {
  const e = byId.get(id)
  if (!e) throw new Error(`no exercise ${id}`)
  return e
}
const PAUSE: Pause = { start: '2026-11-14', until: '2026-11-20', untilWords: 'Friday Nov 20', day: 3, of: 7 }

function lastSession(slot: Slot, exercise: Exercise, atTop: boolean): SetLog[] {
  const s = effectiveSlot(slot, exercise)
  const sides: SetSide[] = !s.unilateral ? ['both'] : s.injuredOnly ? ['right'] : ['right', 'left']
  const load = exercise.loadDirection === 'down' ? 3 : exercise.holdsLoad !== undefined ? 20 : ['bodyweight', 'time', 'band', 'step-height'].includes(exercise.loadType) ? 0 : 20
  const value = atTop ? s.repsMax : s.repsMin
  const rangeStopDeg = s.rangeStopDeg ?? (s.progressionRule === 'range-then-load' ? 90 : undefined)
  return sides.flatMap((side) =>
    Array.from({ length: s.sets }, (_, i) => ({
      id: `${side}-${i}`, workoutId: 'w', slotId: slot.id, exerciseId: exercise.id, setNumber: i + 1, side, load, loadUnit: exercise.loadUnit, rpe: 7, painDuring: 1, stopped: false,
      ...(s.repUnit === 'seconds' ? { seconds: value } : { reps: value }),
      ...(s.heightIn !== undefined ? { heightIn: s.heightIn } : {}),
      ...(rangeStopDeg !== undefined ? { rangeStopDeg } : {}),
      ...(exercise.stages ? { stage: 0 } : {}),
    })),
  )
}

/** Where on [own, ...subs] a prescription runs: later is easier. */
const position = (slot: Slot, p: Prescription) => [slot.exerciseId, ...slot.substitutionIds].indexOf(p.exerciseId)

/** `paused` asks no more than `other` of the same exercise: load (less assist is harder), height, stage, range (a smaller stop is harder), then reps at the same load. */
function notHarder(paused: Prescription, other: Pick<Prescription, 'load' | 'heightIn' | 'stage' | 'rangeStopDeg' | 'repsTarget'>, exercise: Exercise, label: string): void {
  const down = exercise.loadDirection === 'down'
  if (paused.load !== null && other.load !== null) expect(down ? paused.load >= other.load : paused.load <= other.load, `${label} load`).toBe(true)
  if (paused.heightIn !== undefined && other.heightIn !== undefined) expect(paused.heightIn, `${label} height`).toBeLessThanOrEqual(other.heightIn)
  if (paused.stage !== undefined && other.stage !== undefined) expect(paused.stage, `${label} stage`).toBeLessThanOrEqual(other.stage)
  if (paused.rangeStopDeg !== undefined && other.rangeStopDeg !== undefined) expect(paused.rangeStopDeg, `${label} range`).toBeGreaterThanOrEqual(other.rangeStopDeg)
  if (paused.load === other.load && paused.heightIn === other.heightIn && paused.stage === other.stage && paused.rangeStopDeg === other.rangeStopDeg) {
    expect(paused.repsTarget, `${label} reps`).toBeLessThanOrEqual(other.repsTarget)
  }
}

const READINGS: ReadingResult[][] = [[], ['clean'], ...(['clean', 'hold', 'back-off'] as const).flatMap((a) => (['clean', 'hold', 'back-off'] as const).map((b) => [a, b]))]

describe('the pause never makes anything harder', () => {
  it('every seed slot, on its own exercise and each substitution, over readings, the top of the range or not, deload, red flag and whole knee', () => {
    let pausedCases = 0
    for (const template of program.templates) {
      for (const slot of template.slots) {
        const substitutions = slot.substitutionIds.map(ex)
        for (const exercise of [ex(slot.exerciseId), ...substitutions]) {
          for (const readings of READINGS) {
            for (const atTop of [true, false]) {
              for (const week of [2, 4]) {
                for (const redFlagActive of [false, true]) {
                  for (const wholeKnee of [undefined, { morning: '2026-11-16', phaseOneLoads: {} }]) {
                    const lastSets = lastSession(slot, exercise, atTop)
                    const input: PrescriptionInput = { slot, exercise, substitutions, readings, lastSets, week, injuredSide: 'right', dumbbellMax: 80, redFlagActive, ...(wholeKnee ? { wholeKnee } : {}) }
                    const unpaused = prescribe(input)
                    const paused = prescribe({ ...input, pause: PAUSE })
                    const label = `${slot.id} ${exercise.id} ${readings.join('/')} top=${atTop} w${week} flag=${redFlagActive} knee=${wholeKnee !== undefined}`
                    const progressing = week !== 4 && !redFlagActive && !wholeKnee && effectiveReading(readings) === 'clean-twice'
                    if (!progressing) {
                      expect(paused, label).toEqual(unpaused)
                      continue
                    }
                    expect(paused.map((p) => p.sets), label).toEqual(unpaused.map((p) => p.sets))
                    for (const [i, p] of paused.entries()) {
                      const u = unpaused[i]
                      if (!u) throw new Error(label)
                      pausedCases += 1
                      expect(p.basis, label).toBe('paused')
                      expect(p.exerciseId, label).toBe(exercise.id)
                      // Never past the last session on that side.
                      const last = lastSets.find((s) => s.side === p.side)
                      if (!last) throw new Error(label)
                      notHarder(p, { load: last.load, heightIn: last.heightIn, stage: last.stage, rangeStopDeg: last.rangeStopDeg, repsTarget: Math.max(...lastSets.filter((s) => s.side === p.side).map((s) => s.reps ?? s.seconds ?? 0)) }, exercise, `${label} vs last`)
                      // Against the unpaused step, unless the rack moved or capped it (then the last session is the measure).
                      if (u.rackMoved || u.rackCapped) continue
                      expect(position(slot, p), label).toBeGreaterThanOrEqual(position(slot, u))
                      if (p.exerciseId === u.exerciseId) notHarder(p, u, exercise, `${label} vs unpaused`)
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(pausedCases).toBeGreaterThan(500)
  })

  it('a slot on its easier version stays there while paused, never moving up the list; a chosen swap is the same either way', () => {
    // P1-C's step-up backed off at its starting height with nothing in the hands: the slot moved to the stair, which then read clean twice.
    const c = program.templates.find((t) => t.id === 'p1-c')
    const slot = c?.slots.find((s) => s.exerciseId === 'step-up')
    if (!c || !slot) throw new Error('P1-C has the step-up')
    const own = ex(slot.exerciseId)
    const substitutions = slot.substitutionIds.map(ex)
    const on = substitutions[0]
    if (!on) throw new Error('the step-up has an easier version')
    const workouts: Workout[] = ['2026-11-07', '2026-11-14', '2026-11-21'].map((date, i) => ({ id: `w${i}`, date, templateId: 'p1-c', phase: 1, week: i + 1, isDeload: false, status: 'finished' }))
    const setsFor = (w: Workout, exerciseId: string, pain: number): SetLog[] =>
      [1, 2, 3].map((n) => ({ id: `${w.id}-${n}`, workoutId: w.id, slotId: slot.id, exerciseId, setNumber: n, side: 'right', load: 0, loadUnit: 'in', reps: 10, heightIn: 6, painDuring: pain, stopped: false }))
    const [w0, w1, w2] = workouts
    if (!w0 || !w1 || !w2) throw new Error('three sessions')
    const records = attachChecks(workouts, [...setsFor(w0, own.id, 6), ...setsFor(w1, on.id, 1), ...setsFor(w2, on.id, 1)], workouts.map((w) => check(addDays(w.date, 1))))
    const input = { slot, own, substitutions, records, injuredSide: 'right' as const }
    const everything = new Set(program.equipment.map((e) => e.id))
    const unpaused = slotAtGym(input, undefined, everything)
    const paused = slotAtGym({ ...input, pause: PAUSE }, undefined, everything)
    const ids = [own.id, ...substitutions.map((s) => s.id)]
    expect(unpaused.exercise.id).toBe(own.id)
    expect(paused.exercise.id).toBe(on.id)
    expect(ids.indexOf(paused.exercise.id)).toBeGreaterThanOrEqual(ids.indexOf(unpaused.exercise.id))
    // A chosen swap runs the same exercise on the same history; only `route`, what the gym would have done from the history's pick, differs.
    const pick = (x: ReturnType<typeof slotAtGym>) => ({ exercise: x.exercise.id, readings: x.readings, lastSets: x.lastSets, placement: x.placement })
    for (const chosen of ids) expect(pick(slotAtGym({ ...input, pause: PAUSE }, chosen, everything))).toEqual(pick(slotAtGym(input, chosen, everything)))
  })

  it('a week’s run target is never higher with a period than without, over the seed plan', () => {
    const readings = subjectReadings(attachChecks(base.workouts, base.setLogs, base.morningChecks), base.runs, base.morningChecks, 'right')
    const sets: DownPeriod[][] = [PERIODS, [newDownPeriod({ today: '2026-11-09', days: 14, declaredAt: AT })], [endedEarly(newDownPeriod({ today: '2026-11-15', days: 9, declaredAt: AT }), '2026-11-16')]]
    for (const periods of sets) {
      for (let week = 1; week <= 12; week++) {
        const paused = targetForWeek(program.mileagePlan, week, START, base.runs, readings, periods)
        const unpaused = targetForWeek(program.mileagePlan, week, START, base.runs, readings)
        expect(paused.target ?? 0, `week ${week}`).toBeLessThanOrEqual(unpaused.target ?? 0)
        if (paused.downPeriod === undefined) expect(paused).toEqual(unpaused)
      }
    }
    expect(pauseOn('2026-11-17', PERIODS)?.until).toBe('2026-11-20')
  })
})
