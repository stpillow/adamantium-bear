import { describe, expect, it } from 'vitest'
import { program } from '../program/program.ts'
import type { MorningCheck, Run, SetLog, Workout } from '../schema/index.ts'
import { evaluateGate } from './gates.ts'
import { attachChecks, checkFor, exerciseReadings, runReading, subjectReadings } from './history.ts'
import { isLateCheck, lateCheckFor, lateCheckReach } from './lateCheck.ts'
import { consecutiveCleanDays } from './progress.ts'
import { morningReading } from './reading.ts'
import { targetForWeek } from './weekPlan.ts'
import { kneeMorning } from './wholeKnee.ts'

/*
 * Batch D: a morning check for a past day (PROGRAM-QUESTIONS 174 to 176). The calendar: the program
 * starts Monday Nov 2, 2026; Tue Session A, Wed easy run, Thu Session B, Sat Session C.
 */

const START = '2026-11-02'

const workout = (date: string, letter: 'a' | 'b' | 'c', status: Workout['status'] = 'finished'): Workout => ({
  id: `${date}-p1-${letter}`,
  date,
  templateId: `p1-${letter}`,
  phase: 1,
  week: 1,
  isDeload: false,
  status,
})
const set = (w: Workout, pain = 2): SetLog => ({ id: `${w.id}:s1`, workoutId: w.id, slotId: 'p1a-1', exerciseId: 'leg-press', setNumber: 1, side: 'both', load: 8, loadUnit: 'plate', reps: 12, painDuring: pain, stopped: false })
const run = (date: string, over: Partial<Run> = {}): Run => ({ id: `run-${date}`, date, type: 'easy', miles: 3, minutes: 30, effort: 'easy', maxPain: 1, strides: false, tempo: false, ...over })
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

// Example 1's facts: today is Fri Nov 20 (week 3). A on Nov 10 with its check on Nov 11; A on Nov 17
// with no check on Nov 18; an easy run on Nov 18 covered by Nov 19's check; B on Nov 19 covered by today's.
const A10 = workout('2026-11-10', 'a')
const A17 = workout('2026-11-17', 'a')
const B19 = workout('2026-11-19', 'b')
const workouts = [A10, A17, B19]
const setLogs = workouts.map((w) => set(w))
const runs = [run('2026-11-18')]
const checks = [check('2026-11-11'), check('2026-11-19'), check('2026-11-20')]
const TODAY = '2026-11-20'
const offer = (sessionDay: string, over: { today?: string; checks?: MorningCheck[]; workouts?: Workout[]; runs?: Run[] } = {}) =>
  lateCheckFor({ sessionDay, today: over.today ?? TODAY, startDate: START, workouts: over.workouts ?? workouts, runs: over.runs ?? runs, checks: over.checks ?? checks })

describe('isLateCheck: late is stored, never worked out from the date', () => {
  it('only a check carrying loggedOn is late; an old on-time check is not', () => {
    expect(isLateCheck(check('2026-11-11'))).toBe(false)
    expect(isLateCheck(check('2026-11-18', { loggedOn: '2026-11-20' }))).toBe(true)
  })
})

describe('lateCheckFor: when a past morning can take a check (PROGRAM-QUESTIONS 174)', () => {
  it('Example 1: Session A on Tue Nov 17 with no check on Nov 18 is offered that morning', () => {
    expect(offer('2026-11-17')).toEqual({ ok: true, morning: '2026-11-18', sessionDay: '2026-11-17' })
  })
  it('yesterday’s session goes to this morning’s on-time check, never the late flow (the takeover stays)', () => {
    expect(offer('2026-11-19')).toEqual({ ok: false, refusal: { kind: 'morning-is-today' } })
  })
  it('a morning still ahead is refused', () => {
    expect(offer('2026-11-20')).toEqual({ ok: false, refusal: { kind: 'morning-ahead' } })
    expect(offer('2026-11-25')).toEqual({ ok: false, refusal: { kind: 'morning-ahead' } })
  })
  it('Example 4: the window is the 14 days a late session may be dated, and never before the start', () => {
    // Today Fri Nov 20: session days Nov 6 to Nov 18, mornings Nov 7 to Nov 19.
    const thu5 = workout('2026-11-05', 'b')
    const fri6 = run('2026-11-06')
    expect(offer('2026-11-05', { workouts: [thu5] })).toEqual({ ok: false, refusal: { kind: 'outside-window' } })
    expect(offer('2026-11-06', { runs: [fri6] })).toEqual({ ok: true, morning: '2026-11-07', sessionDay: '2026-11-06' })
    // Today Mon Nov 9: sessions on Nov 2 to Nov 7 take late mornings Nov 3 to Nov 8; nothing before the start.
    const mon2 = run('2026-11-02')
    expect(offer('2026-11-02', { today: '2026-11-09', runs: [mon2], checks: [] })).toMatchObject({ ok: true, morning: '2026-11-03' })
    expect(offer('2026-11-01', { today: '2026-11-09', runs: [run('2026-11-01')], checks: [] })).toEqual({ ok: false, refusal: { kind: 'outside-window' } })
  })
  it('a run qualifies: there is no phase floor', () => {
    expect(offer('2026-11-12', { runs: [run('2026-11-12')], checks: [] })).toMatchObject({ ok: true, morning: '2026-11-13' })
  })
  it('a day with nothing logged, or only a lift left open or planned, is refused: an open lift completes no reading', () => {
    expect(offer('2026-11-16')).toEqual({ ok: false, refusal: { kind: 'nothing-logged' } })
    expect(offer('2026-11-14', { workouts: [workout('2026-11-14', 'c', 'in-progress')] })).toEqual({ ok: false, refusal: { kind: 'nothing-logged' } })
    expect(offer('2026-11-14', { workouts: [workout('2026-11-14', 'c', 'planned')] })).toEqual({ ok: false, refusal: { kind: 'nothing-logged' } })
    // A lift ended early counts: its sets are read.
    expect(offer('2026-11-14', { workouts: [workout('2026-11-14', 'c', 'abandoned')], checks: [] })).toMatchObject({ ok: true, morning: '2026-11-15' })
  })
  it('Example 5: a check already dated that morning is found by date, not id, and stays as it is', () => {
    const imported = check('2026-11-14', { id: 'mc-2026-11-14-run' })
    const sat13 = run('2026-11-13')
    expect(offer('2026-11-13', { runs: [sat13], checks: [imported] })).toEqual({ ok: false, refusal: { kind: 'check-exists', morning: '2026-11-14' } })
  })
  it('a day whose every session already has a linked check is refused', () => {
    const linked = check('2026-11-16', { appliesTo: { kind: 'run', id: 'run-2026-11-12' } })
    expect(offer('2026-11-12', { runs: [run('2026-11-12')], checks: [linked] })).toEqual({ ok: false, refusal: { kind: 'all-covered' } })
    // One of two sessions still uncovered: offered.
    expect(offer('2026-11-12', { runs: [run('2026-11-12')], workouts: [workout('2026-11-12', 'b')], checks: [linked] })).toMatchObject({ ok: true })
  })
})

describe('a late check reads exactly as the same check saved that morning (PROGRAM-QUESTIONS 176)', () => {
  const variants: Partial<MorningCheck>[] = [{}, { visibleSwelling: true }, { worseThanYesterday: true }, { stiffnessUnder30Min: false }, { redFlags: ['locking'] }, { painChangePoints: 2 }]
  for (const over of variants) {
    it(`late equals on time: ${JSON.stringify(over)}`, () => {
      const onTime = check('2026-11-18', { appliesTo: { kind: 'workout', id: A17.id }, ...over })
      const late = { ...onTime, loggedOn: TODAY }
      expect(morningReading(late)).toEqual(morningReading(onTime))
      const withOnTime = [...checks, onTime]
      const withLate = [...checks, late]
      const records = (cs: MorningCheck[]) => attachChecks(workouts, setLogs, cs)
      const strip = (rs: ReturnType<typeof records>) => rs.map((r) => ({ ...r, morningCheck: r.morningCheck ? { ...r.morningCheck, loggedOn: undefined } : undefined }))
      expect(strip(records(withLate))).toEqual(strip(records(withOnTime)))
      expect(subjectReadings(records(withLate), runs, withLate, 'right')).toEqual(subjectReadings(records(withOnTime), runs, withOnTime, 'right'))
      expect(exerciseReadings(records(withLate), 'leg-press', 'right')).toEqual(exerciseReadings(records(withOnTime), 'leg-press', 'right'))
      for (const date of ['2026-11-19', '2026-11-21', '2026-11-24']) expect(kneeMorning(withLate, workouts, date)).toEqual(kneeMorning(withOnTime, workouts, date))
      const readings = (cs: MorningCheck[]) => subjectReadings(records(cs), runs, cs, 'right')
      for (const week of [3, 4]) expect(targetForWeek(program.mileagePlan, week, START, runs, readings(withLate))).toEqual(targetForWeek(program.mileagePlan, week, START, runs, readings(withOnTime)))
      expect(consecutiveCleanDays(readings(withLate), TODAY, withLate)).toBe(consecutiveCleanDays(readings(withOnTime), TODAY, withOnTime))
    })
  }

  it('applies to the session day before it only: never to a session on its own morning', () => {
    const late = check('2026-11-18', { appliesTo: { kind: 'workout', id: A17.id }, visibleSwelling: true, loggedOn: TODAY })
    const all = [...checks, late]
    const readings = subjectReadings(attachChecks(workouts, setLogs, all), runs, all, 'right')
    expect(readings.find((r) => r.id === A17.id)?.result).toBe('back-off')
    // The Nov 18 run keeps the Nov 19 check.
    expect(readings.find((r) => r.id === 'run-2026-11-18')?.result).toBe('clean')
    expect(checkFor({ kind: 'run', id: 'run-2026-11-18', date: '2026-11-18' }, all)?.id).toBe('mc-2026-11-19')
  })

  it('the gates read late evidence conservatively: late swelling fails, a clean late check passes nothing', () => {
    const gate = program.gates.find((g) => g.items.some((i) => i.evaluator === 'no-swelling'))
    expect(gate).toBeDefined()
    if (!gate) return
    const ctx = (cs: MorningCheck[]) => ({ today: TODAY, injuredSide: 'right' as const, readings: [], gateTests: [], morningChecks: cs, runs, workouts, setLogs, calfRaiseExerciseIds: [], aclRsiEntries: [] })
    const item = (cs: MorningCheck[]) => evaluateGate(gate, ctx(cs)).items.find((i) => i.item.evaluator === 'no-swelling')
    expect(item([check('2026-11-18', { loggedOn: TODAY })])?.pass).toBe(false)
    expect(item([check('2026-11-18')])?.pass).toBe(true)
    expect(item([check('2026-11-19'), check('2026-11-18', { loggedOn: TODAY, visibleSwelling: true })])?.pass).toBe(false)
  })
})

describe('Example 1 and 2: what a late check reaches (lateCheckReach)', () => {
  const base = { workouts, setLogs, runs, before: checks, injuredSide: 'right' as const }
  it('a clean late check lifts Nov 17’s A from hold to clean and changes no lift plan', () => {
    const late = check('2026-11-18', { appliesTo: { kind: 'workout', id: A17.id }, loggedOn: TODAY })
    expect(runReading(runs[0] as Run, [...checks, late]).result).toBe('clean')
    expect(lateCheckReach({ ...base, after: [...checks, late], liftDates: ['2026-11-21'] })).toEqual({
      readings: [{ kind: 'workout', id: A17.id, date: '2026-11-17', from: 'hold', to: 'clean' }],
      lifts: [],
    })
  })
  it('a late back-off reaches forward through kneeMorning only to the first lift after it: B on Nov 19, not C on Nov 21', () => {
    const late = check('2026-11-18', { appliesTo: { kind: 'workout', id: A17.id }, visibleSwelling: true, loggedOn: TODAY })
    expect(lateCheckReach({ ...base, after: [...checks, late], liftDates: ['2026-11-19', '2026-11-21'] })).toEqual({
      readings: [{ kind: 'workout', id: A17.id, date: '2026-11-17', from: 'hold', to: 'back-off' }],
      lifts: [{ date: '2026-11-19', from: null, to: '2026-11-18' }],
    })
  })
  it('Example 2’s variant: with B skipped, Saturday’s C plans at whole-knee back-off, as an on-time check would have made it', () => {
    const late = check('2026-11-18', { appliesTo: { kind: 'workout', id: A17.id }, visibleSwelling: true, loggedOn: TODAY })
    const noB = [A10, A17]
    const reach = lateCheckReach({ ...base, workouts: noB, setLogs: noB.map((w) => set(w)), after: [...checks, late], liftDates: ['2026-11-21'] })
    expect(reach.lifts).toEqual([{ date: '2026-11-21', from: null, to: '2026-11-18' }])
    expect(kneeMorning([...checks, { ...late, loggedOn: undefined }], noB, '2026-11-21')).toEqual(kneeMorning([...checks, late], noB, '2026-11-21'))
  })
})
