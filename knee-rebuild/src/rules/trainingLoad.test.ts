import { describe, expect, it } from 'vitest'
import type { Run, SetLog, Workout } from '../schema/index.ts'
import { attachChecks } from './history.ts'
import { lateStartedAt } from './retro.ts'
import {
  ACUTE_HIGH,
  ACUTE_LOW,
  CLOCK_MAX_MINUTES,
  EFFORT_RPE,
  acuteChronic,
  clockMinutes,
  effortFromRpe,
  estimateMinutes,
  hrLoadOf,
  hrPair,
  hrReserve,
  minutesPreset,
  runRpe,
  setsRpe,
  trainingLoadOf,
  trainingLoads,
  weeklyTrainingLoads,
  windowTrainingLoad,
  workoutRpe,
  type TrainingLoadEntry,
} from './trainingLoad.ts'

const run = (id: string, date: string, minutes: number, over: Partial<Run> = {}): Run => ({ id, date, type: 'easy', miles: 3, minutes, effort: 'moderate', rpe: 5, maxPain: 1, strides: false, tempo: false, ...over })
const workout = (id: string, date: string, over: Partial<Workout> = {}): Workout => ({ id, date, templateId: 'p1-a', phase: 1, week: 1, isDeload: false, status: 'finished', ...over })
const set = (workoutId: string, n: number, over: Partial<SetLog> = {}): SetLog => ({ id: `${workoutId}-${n}`, workoutId, slotId: 'p1a-1', exerciseId: 'leg-press', setNumber: n, side: 'both', load: 90, loadUnit: 'lb', reps: 10, stopped: false, ...over })
const at = (hhmm: string) => `2026-11-10T${hhmm}:00.000Z`

describe('effort and RPE', () => {
  it('reads RPE 1–3 as easy, 4–6 moderate, 7–10 hard', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(effortFromRpe)).toEqual(['easy', 'easy', 'easy', 'moderate', 'moderate', 'moderate', 'hard', 'hard', 'hard', 'hard'])
  })
  it('refuses anything but a whole number from 1 to 10', () => {
    for (const bad of [0, 11, 6.5, Number.NaN, Infinity]) expect(() => effortFromRpe(bad), String(bad)).toThrow(RangeError)
  })
  it('reads an older run’s word as 3, 5 or 8, each of which reads back as its own word', () => {
    expect(EFFORT_RPE).toEqual({ easy: 3, moderate: 5, hard: 8 })
    for (const word of ['easy', 'moderate', 'hard'] as const) expect(effortFromRpe(EFFORT_RPE[word])).toBe(word)
  })
  it('a run’s rating wins over its word; without one the word stands in', () => {
    expect(runRpe({ rpe: 6, effort: 'easy' })).toEqual({ rpe: 6, source: 'rated' })
    expect(runRpe({ effort: 'moderate' })).toEqual({ rpe: 5, source: 'word' })
    expect(runRpe({ effort: 'hard' })).toEqual({ rpe: 8, source: 'word' })
  })
})

describe('a session’s RPE', () => {
  it('the sets’ average, rounded half up, with unrated sets left out rather than read as 0', () => {
    expect(setsRpe([])).toBeNull()
    expect(setsRpe([{}, {}])).toBeNull()
    expect(setsRpe([{ rpe: 7 }, { rpe: 8 }])).toBe(8)
    expect(setsRpe([{ rpe: 6 }, { rpe: 6.5 }, { rpe: 7 }])).toBe(7)
    expect(setsRpe([{ rpe: 6 }, {}, { rpe: 6 }])).toBe(6)
  })
  it('Shawn’s rating wins; otherwise the sets’ average; otherwise unknown', () => {
    expect(workoutRpe({ sessionRpe: 4 }, [{ rpe: 8 }])).toEqual({ rpe: 4, source: 'session' })
    expect(workoutRpe({}, [{ rpe: 7 }, { rpe: 8 }])).toEqual({ rpe: 8, source: 'sets' })
    expect(workoutRpe({}, [{}])).toBeNull()
  })
})

describe('a session’s minutes by the clock: from Start to the last set plus one rest, long gaps capped', () => {
  const live = { date: '2026-11-10', startedAt: at('10:00') }
  it('adds the gaps between sets and one rest after the last', () => {
    // 10 to the first set, 3 and 3 between, then a 60 s rest: 17 min.
    expect(clockMinutes(live, [at('10:16'), at('10:10'), at('10:13')], 60)).toBe(17)
  })
  it('caps a long gap between sets at 10 minutes and the wait before the first at 20', () => {
    // 10, 3, an hour capped to 10, 3, and the rest: 27 min.
    expect(clockMinutes(live, [at('10:10'), at('10:13'), at('11:13'), at('11:16')], 60)).toBe(27)
    expect(clockMinutes({ ...live, startedAt: at('08:00') }, [at('10:00')], 60)).toBe(21)
  })
  it('a set stamped before Start (an edit keeps its stamp) adds nothing', () => {
    expect(clockMinutes(live, [at('09:50'), at('10:05')], 60)).toBe(6)
  })
  it('can’t say for a late entry, without a start or a stamped set, or outside 1 to 180 minutes', () => {
    expect(clockMinutes({ date: '2026-11-10', startedAt: lateStartedAt('2026-11-10') }, [at('18:00')], 60)).toBeNull()
    expect(clockMinutes({ date: '2026-11-10' }, [at('10:10')], 60)).toBeNull()
    expect(clockMinutes(live, [undefined], 60)).toBeNull()
    expect(clockMinutes(live, [], 60)).toBeNull()
    expect(clockMinutes(live, [at('10:00')], 15)).toBeNull()
    expect(clockMinutes(live, ['not a time'], 60)).toBeNull()
    // 19 gaps of 10 minutes and a rest: 191 minutes, past the cap.
    const stamps = Array.from({ length: 20 }, (_, i) => new Date(Date.parse(at('10:00')) + i * 600_000).toISOString())
    expect(CLOCK_MAX_MINUTES).toBe(180)
    expect(clockMinutes(live, stamps, 60)).toBeNull()
    expect(clockMinutes(live, stamps.slice(0, 18), 60)).toBe(171)
  })
})

describe('a late session’s estimate: fitWindow’s work per set by its unit, a rest after each, and the warm-up', () => {
  it('3 sets of 10 reps with 90 s rests and a 10-minute warm-up: 7.5 + 10, rounded', () => {
    const sets = [1, 2, 3].map(() => ({ reps: 10, repUnit: 'reps' as const }))
    expect(estimateMinutes(sets, 90, 10)).toBe(18)
  })
  it('a minutes set as minutes, a seconds set as seconds, yards at 2 s each', () => {
    expect(estimateMinutes([{ reps: 5, repUnit: 'minutes' }], 60, 0)).toBe(6) // 320 + 60 s
    expect(estimateMinutes([{ seconds: 30, repUnit: 'seconds' }], 70, 0)).toBe(2) // 50 + 70 s
    expect(estimateMinutes([{ reps: 40, repUnit: 'yards' }], 80, 0)).toBe(3) // 100 + 80 s
  })
  it('is at least 1 and at most 300', () => {
    expect(estimateMinutes([], 60, 0)).toBe(1)
    expect(estimateMinutes(Array.from({ length: 100 }, () => ({ reps: 5, repUnit: 'minutes' as const })), 60, 10)).toBe(300)
  })
})

describe('the minutes Finish and End open on', () => {
  const sets = [
    { reps: 10, repUnit: 'reps' as const, loggedAt: at('10:10') },
    { reps: 10, repUnit: 'reps' as const, loggedAt: at('10:13') },
  ]
  it('the clock for a live session', () => {
    expect(minutesPreset({ workout: { date: '2026-11-10', startedAt: at('10:00') }, sets, restSeconds: 60, warmUpMinutes: 10 })).toEqual({ minutes: 14, source: 'clock' })
  })
  it('the estimate for a late entry, whose sets are stamped when they were typed', () => {
    expect(minutesPreset({ workout: { date: '2026-11-10', startedAt: lateStartedAt('2026-11-10') }, sets, restSeconds: 60, warmUpMinutes: 10 })).toEqual({ minutes: 14, source: 'estimate' })
  })
  it('the estimate when the clock can’t be trusted', () => {
    expect(minutesPreset({ workout: { date: '2026-11-10', startedAt: at('10:00') }, sets: sets.map((s) => ({ ...s, loggedAt: at('10:00') })), restSeconds: 15, warmUpMinutes: 0 })).toEqual({ minutes: 3, source: 'estimate' })
  })
})

describe('training load: RPE × minutes', () => {
  it('needs both, and minutes over 0', () => {
    expect(trainingLoadOf(7, 48)).toBe(336)
    expect(trainingLoadOf(null, 48)).toBeNull()
    expect(trainingLoadOf(7, null)).toBeNull()
    expect(trainingLoadOf(7, 0)).toBeNull()
  })

  it('counts finished and ended-early lifts and every run and swap, by the session’s date, with what is missing', () => {
    const records = attachChecks(
      [
        workout('w-rated', '2026-11-03', { sessionRpe: 7, durationMinutes: 48 }),
        workout('w-sets', '2026-11-05', { status: 'abandoned', durationMinutes: 40 }),
        workout('w-none', '2026-11-07', { durationMinutes: 30 }),
        workout('w-no-minutes', '2026-11-07', { sessionRpe: 6 }),
        workout('w-open', '2026-11-08', { status: 'in-progress', durationMinutes: 30, sessionRpe: 5 }),
        workout('w-planned', '2026-11-09', { status: 'planned' }),
      ],
      [set('w-rated', 1, { rpe: 9 }), set('w-sets', 1, { rpe: 7 }), set('w-sets', 2, { rpe: 8 }), set('w-none', 1)],
      [],
    )
    const runs = [
      run('r-rated', '2026-11-04', 30, { rpe: 6, effort: 'moderate' }),
      run('r-word', '2026-11-02', 20, { rpe: undefined, effort: 'hard' }),
      run('r-swap', '2026-11-06', 35, { type: 'elliptical-swap', miles: 0, rpe: 4 }),
      run('r-zero', '2026-11-07', 0),
    ]
    const entries = trainingLoads(records, runs)
    expect(entries.map((e) => [e.id, e.date, e.rpe, e.rpeSource, e.minutes, e.load, e.missing])).toEqual([
      ['r-word', '2026-11-02', 8, 'word', 20, 160, []],
      ['w-rated', '2026-11-03', 7, 'session', 48, 336, []],
      ['r-rated', '2026-11-04', 6, 'rated', 30, 180, []],
      ['w-sets', '2026-11-05', 8, 'sets', 40, 320, []],
      ['r-swap', '2026-11-06', 4, 'rated', 35, 140, []],
      ['r-zero', '2026-11-07', 5, 'rated', null, null, ['minutes']],
      ['w-no-minutes', '2026-11-07', 6, 'session', null, null, ['minutes']],
      ['w-none', '2026-11-07', null, null, 30, null, ['rpe']],
    ])
    expect(entries.find((e) => e.id === 'w-rated')).toMatchObject({ kind: 'workout', templateId: 'p1-a' })
    expect(entries.find((e) => e.id === 'r-swap')).toMatchObject({ kind: 'run', runType: 'elliptical-swap' })
  })

  it('a late entry counts on the day it happened, never the day it was typed', () => {
    const late = workout('w-late', '2026-11-03', { startedAt: lateStartedAt('2026-11-03'), sessionRpe: 6, durationMinutes: 50 })
    expect(trainingLoads(attachChecks([late], [], []), [])).toMatchObject([{ id: 'w-late', date: '2026-11-03', load: 300 }])
  })
})

describe('HR load: Banister TRIMP, shown beside the sRPE load (metrics phase 2)', () => {
  const hr = { maxHr: 190, restingHr: 50 }

  it('hrPair needs both Settings numbers: one stepper touched computes nothing, and an impossible pair computes nothing', () => {
    expect(hrPair({ maxHr: 190, restingHr: 50 })).toEqual({ maxHr: 190, restingHr: 50 })
    expect(hrPair({ maxHr: 190 })).toBeNull()
    expect(hrPair({ restingHr: 50 })).toBeNull()
    expect(hrPair({})).toBeNull()
    expect(hrPair(null)).toBeNull()
    expect(hrPair(undefined)).toBeNull()
    expect(hrPair({ maxHr: 100, restingHr: 100 })).toBeNull()
    expect(hrPair({ maxHr: 100, restingHr: 120 })).toBeNull()
  })

  it('minutes × HRr × 0.64 × e^(1.92 × HRr): 40 minutes at an average of 150 over 50–190 is about 72, unrounded', () => {
    const reserve = (150 - 50) / (190 - 50)
    expect(hrReserve(150, 50, 190)).toBeCloseTo(reserve, 10)
    expect(hrLoadOf(40, 150, hr)).toBeCloseTo(40 * reserve * 0.64 * Math.exp(1.92 * reserve), 10)
    expect(hrLoadOf(40, 150, hr)).toBeCloseTo(72.1, 0)
  })

  it('clamps the reserve to 0..1: below resting is a computed 0 — a true zero, not null — and above max reads as 1', () => {
    expect(hrReserve(40, 50, 190)).toBe(0)
    expect(hrReserve(250, 50, 190)).toBe(1)
    expect(hrLoadOf(40, 40, hr)).toBe(0)
    expect(hrLoadOf(40, 250, hr)).toBeCloseTo(40 * 0.64 * Math.exp(1.92), 10)
  })

  it('is null when the minutes are missing or 0, the average is missing, or the settings are missing or impossible', () => {
    expect(hrLoadOf(null, 150, hr)).toBeNull()
    expect(hrLoadOf(0, 150, hr)).toBeNull()
    expect(hrLoadOf(undefined, 150, hr)).toBeNull()
    expect(hrLoadOf(40, null, hr)).toBeNull()
    expect(hrLoadOf(40, undefined, hr)).toBeNull()
    expect(hrLoadOf(40, 150, null)).toBeNull()
    // Resting at max would divide by zero (NaN survives the clamp); resting above it would print plausible garbage. Both are null.
    expect(hrLoadOf(40, 150, { maxHr: 150, restingHr: 150 })).toBeNull()
    expect(hrLoadOf(40, 150, { maxHr: 100, restingHr: 120 })).toBeNull()
  })

  it('trainingLoads with the hr parameter omitted compiles and yields a null hrLoad everywhere (phase-1 call sites safe)', () => {
    const runs = [run('r-hr', '2026-11-04', 40, { avgHr: 150, maxHr: 171 })]
    const records = attachChecks([workout('w1', '2026-11-03', { sessionRpe: 7, durationMinutes: 48 })], [], [])
    expect(trainingLoads(records, runs).map((e) => e.hrLoad)).toEqual([null, null])
    expect(trainingLoads(records, runs, null).map((e) => e.hrLoad)).toEqual([null, null])
  })

  it('computes an hrLoad only for a run with minutes and an average heart rate; a lift never carries one, even with settings present', () => {
    const runs = [run('r-hr', '2026-11-04', 40, { avgHr: 150, maxHr: 171 }), run('r-plain', '2026-11-05', 30), run('r-zero', '2026-11-06', 0, { avgHr: 150 })]
    const records = attachChecks([workout('w1', '2026-11-03', { sessionRpe: 7, durationMinutes: 48 })], [], [])
    const entries = trainingLoads(records, runs, hr)
    expect(entries.map((e) => [e.id, e.hrLoad === null ? null : Math.round(e.hrLoad)])).toEqual([
      ['w1', null],
      ['r-hr', 72],
      ['r-plain', null],
      ['r-zero', null],
    ])
    // Whether the entry carried a heart rate at all is its own fact: r-zero logged one, time or no time.
    expect(entries.map((e) => [e.id, e.hasHr])).toEqual([
      ['w1', false],
      ['r-hr', true],
      ['r-plain', false],
      ['r-zero', true],
    ])
    // The sRPE load is untouched beside it.
    expect(entries.find((e) => e.id === 'r-hr')).toMatchObject({ load: 200 })
  })

  it('sums the week’s HR load and counts the runs that had one, beside the sRPE sums', () => {
    const runs = [run('r1', '2026-11-02', 40, { avgHr: 150, maxHr: 171 }), run('r2', '2026-11-04', 30)]
    const records = attachChecks([workout('w1', '2026-11-03', { sessionRpe: 7, durationMinutes: 48 })], [], [])
    const weeks = weeklyTrainingLoads(trainingLoads(records, runs, hr), '2026-11-02', 2)
    expect(weeks[0]).toMatchObject({ week: 1, load: 200 + 150 + 336, sessions: 3, withHr: 1, hrNotCounted: 0, runs: 2 })
    expect(weeks[0]?.hrLoad).toBeCloseTo(72.06, 1)
    expect(weeks[1]).toMatchObject({ week: 2, load: 0, hrLoad: 0, withHr: 0, hrNotCounted: 0, runs: 0 })
  })

  it('a run with heart rate but no time still counts as having heart rate; hrNotCounted says its load could not be computed', () => {
    const runs = [run('r-zero', '2026-11-02', 0, { avgHr: 150 }), run('r-hr', '2026-11-04', 40, { avgHr: 150, maxHr: 171 })]
    const weeks = weeklyTrainingLoads(trainingLoads([], runs, hr), '2026-11-02', 1)
    expect(weeks[0]).toMatchObject({ withHr: 2, hrNotCounted: 1, runs: 2 })
    expect(weeks[0]?.hrLoad).toBeCloseTo(72.06, 1)
  })

  it('the acute:chronic warning reads the sRPE load alone: a disagreeing HR load changes nothing (structural: its signature takes no HR)', () => {
    const today = '2026-12-15'
    const startDate = '2026-06-01'
    const entries = [entry('c1', '2026-11-10', 100), entry('c2', '2026-11-17', 100), entry('c3', '2026-11-24', 100), entry('c4', '2026-12-07', 100), entry('a', '2026-12-08', 200)]
    const disagreeing = entries.map((e) => ({ ...e, hrLoad: 5000 }))
    const plain = acuteChronic(entries, today, startDate)
    const withHr = acuteChronic(disagreeing, today, startDate)
    expect([withHr.band, withHr.acute, withHr.chronicWeek, withHr.ratio]).toEqual([plain.band, plain.acute, plain.chronicWeek, plain.ratio])
    expect(plain.band).toBe('high')
  })
})

const entry = (id: string, date: string, load: number | null): TrainingLoadEntry => ({
  kind: 'run',
  id,
  date,
  runType: 'easy',
  rpe: load === null ? 5 : 1,
  rpeSource: 'rated',
  minutes: load,
  load,
  hrLoad: null,
  hasHr: false,
  missing: load === null ? ['minutes'] : [],
})

describe('a window’s training load', () => {
  it('both ends count, and what isn’t counted is listed, never read as 0', () => {
    const entries = [entry('a', '2026-11-01', 100), entry('b', '2026-11-02', 50), entry('c', '2026-11-03', null), entry('d', '2026-11-04', 25), entry('e', '2026-11-05', 1000)]
    const w = windowTrainingLoad(entries, '2026-11-02', '2026-11-04')
    expect(w.load).toBe(75)
    expect(w.counted).toBe(2)
    expect(w.notCounted.map((e) => e.id)).toEqual(['c'])
  })
})

describe('acuteChronic: the 7 days through yesterday against the average week of the 28 days before', () => {
  const today = '2026-12-15'
  // Weeks 1 to 12 are long past, so no deload week touches either window.
  const startDate = '2026-06-01'
  const chronic = [entry('c1', '2026-11-10', 100), entry('c2', '2026-11-17', 100), entry('c3', '2026-11-24', 100), entry('c4', '2026-12-07', 100)]
  const withAcute = (load: number) => [...chronic, entry('a', '2026-12-08', load)]

  it('acute is Dec 8 to 14 (today left out), chronic Nov 10 to Dec 7 as an average week', () => {
    const r = acuteChronic([...withAcute(120), entry('today', '2026-12-15', 5000), entry('before', '2026-11-09', 5000)], today, startDate)
    expect(r).toMatchObject({ acuteFrom: '2026-12-08', acuteTo: '2026-12-14', chronicFrom: '2026-11-10', chronicTo: '2026-12-07', acute: 120, chronicWeek: 100, ratio: 1.2, band: 'steady', skews: [] })
  })

  it('above 1.5 is high and below 0.8 low, on the exact ratio: 1.5 and 0.8 themselves are steady', () => {
    expect([ACUTE_HIGH, ACUTE_LOW]).toEqual([1.5, 0.8])
    expect(acuteChronic(withAcute(150), today, startDate).band).toBe('steady')
    expect(acuteChronic(withAcute(150.1), today, startDate).band).toBe('high')
    expect(acuteChronic(withAcute(80), today, startDate).band).toBe('steady')
    expect(acuteChronic(withAcute(79.9), today, startDate).band).toBe('low')
    expect(acuteChronic(chronic, today, startDate)).toMatchObject({ acute: 0, ratio: 0, band: 'low' })
  })

  it('too early until the history reaches back 35 days, and says the day it starts', () => {
    const late = [entry('first', '2026-11-11', 100), entry('a', '2026-12-08', 100)]
    expect(acuteChronic(late, today, startDate)).toMatchObject({ band: 'too-early', ratio: null, startsOn: '2026-12-16' })
    expect(acuteChronic([entry('first', '2026-11-10', 100), entry('a', '2026-12-08', 100)], today, startDate)).toMatchObject({ band: 'high', startsOn: null })
    expect(acuteChronic([], today, startDate)).toMatchObject({ band: 'too-early', ratio: null, startsOn: null })
  })

  it('an uncounted session still dates the history', () => {
    expect(acuteChronic([entry('first', '2026-11-10', null), entry('a', '2026-12-08', 100)], today, startDate).band).toBe('none')
  })

  it('nothing counted in the 28 days before is none: there is nothing to compare against', () => {
    expect(acuteChronic([entry('old', '2026-11-01', 100), entry('a', '2026-12-08', 100)], today, startDate)).toMatchObject({ band: 'none', ratio: null, chronicWeek: 0 })
  })

  it('says which way uncounted sessions skew it: in the last 7 days it reads lower, in the 4 weeks before higher', () => {
    const r = acuteChronic([...withAcute(120), entry('x', '2026-12-10', null), entry('y', '2026-11-20', null), entry('z', '2026-11-21', null)], today, startDate)
    expect(r.notCountedAcute.map((e) => e.id)).toEqual(['x'])
    expect(r.notCountedChronic.map((e) => e.id)).toEqual(['y', 'z'])
    expect(r.skews).toEqual([
      { why: 'not-counted', window: 'acute', reads: 'lower' },
      { why: 'not-counted', window: 'chronic', reads: 'higher' },
    ])
  })

  it('and a deload week in either window: in the last 7 days it reads lower, in the 4 weeks before higher', () => {
    // Program from Nov 2: week 4 is Nov 23 to 29 (in the 4 weeks before), week 7 is Dec 14 to 20.
    expect(acuteChronic(withAcute(120), today, '2026-11-02').skews).toEqual([{ why: 'deload', window: 'chronic', reads: 'higher' }])
    // On Dec 22 the last 7 days are Dec 15 to 21; week 8, the deload, starts Dec 21.
    const later = [entry('c', '2026-11-17', 100), entry('a', '2026-12-16', 100)]
    expect(acuteChronic(later, '2026-12-22', '2026-11-02').skews).toEqual([
      { why: 'deload', window: 'acute', reads: 'lower' },
      { why: 'deload', window: 'chronic', reads: 'higher' },
    ])
  })
})

describe('weekly training load, by program week', () => {
  it('sums each week, counts what is counted and what isn’t, marks the deloads, and drops what falls outside', () => {
    const entries = [entry('pre', '2026-11-01', 999), entry('a', '2026-11-02', 100), entry('b', '2026-11-08', 50), entry('c', '2026-11-08', null), entry('d', '2026-11-23', 70), entry('late', '2026-12-01', 5)]
    expect(weeklyTrainingLoads(entries, '2026-11-02', 4)).toEqual([
      { week: 1, load: 150, sessions: 2, notCounted: 1, isDeload: false, hrLoad: 0, withHr: 0, hrNotCounted: 0, runs: 3 },
      { week: 2, load: 0, sessions: 0, notCounted: 0, isDeload: false, hrLoad: 0, withHr: 0, hrNotCounted: 0, runs: 0 },
      { week: 3, load: 0, sessions: 0, notCounted: 0, isDeload: false, hrLoad: 0, withHr: 0, hrNotCounted: 0, runs: 0 },
      { week: 4, load: 70, sessions: 1, notCounted: 0, isDeload: true, hrLoad: 0, withHr: 0, hrNotCounted: 0, runs: 1 },
    ])
  })
})
