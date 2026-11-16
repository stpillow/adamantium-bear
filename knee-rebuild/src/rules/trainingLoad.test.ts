import { describe, expect, it } from 'vitest'
import type { Run, SetLog, Workout } from '../schema/index.ts'
import { addDays } from './calendar.ts'
import { attachChecks } from './history.ts'
import { lateStartedAt } from './retro.ts'
import {
  ACUTE_HIGH,
  ACUTE_LAMBDA,
  ACUTE_LOW,
  CHRONIC_LAMBDA,
  CLOCK_MAX_MINUTES,
  EFFORT_RPE,
  acuteChronic,
  bandFor,
  clockMinutes,
  dailyTrainingLoads,
  effortFromRpe,
  estimateMinutes,
  hrLoadOf,
  hrPair,
  hrReserve,
  minutesPreset,
  runRpe,
  setsRpe,
  smoothedLoad,
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
    // Dense, so the band is high under EWMA: 100 a day Jun 1 to Dec 7, then 400 a day Dec 8 to 14 (ratio about 1.65).
    const entries = [...daily('c', '2026-06-01', '2026-12-07', 100), ...daily('a', '2026-12-08', '2026-12-14', 400)]
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

/** One entry a day, `from` to `to`, each carrying `load`. */
function daily(prefix: string, from: string, to: string, load: number): TrainingLoadEntry[] {
  const out: TrainingLoadEntry[] = []
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10)
    out.push(entry(`${prefix}-${date}`, date, load))
  }
  return out
}

describe('a window’s training load', () => {
  it('both ends count, and what isn’t counted is listed, never read as 0', () => {
    const entries = [entry('a', '2026-11-01', 100), entry('b', '2026-11-02', 50), entry('c', '2026-11-03', null), entry('d', '2026-11-04', 25), entry('e', '2026-11-05', 1000)]
    const w = windowTrainingLoad(entries, '2026-11-02', '2026-11-04')
    expect(w.load).toBe(75)
    expect(w.counted).toBe(2)
    expect(w.notCounted.map((e) => e.id)).toEqual(['c'])
  })
})

describe('the smoothing: EWMA of the daily training load, bias-corrected (Batch B, PROGRAM-QUESTIONS 162)', () => {
  it('λ = 2 / (N + 1): 0.25 over 7 days, 2/29 over 28', () => {
    expect(ACUTE_LAMBDA).toBe(0.25)
    expect(CHRONIC_LAMBDA).toBeCloseTo(2 / 29, 12)
  })

  it('the daily series is zero-filled and counts only counted load; uncounted entries add nothing to it', () => {
    const entries = [entry('a', '2026-11-01', 100), entry('b', '2026-11-01', 50), entry('c', '2026-11-03', null), entry('d', '2026-11-04', 25), entry('e', '2026-11-05', 1000)]
    expect(dailyTrainingLoads(entries, '2026-11-01', '2026-11-04')).toEqual([150, 0, 0, 25])
    expect(dailyTrainingLoads(entries, '2026-11-05', '2026-11-04')).toEqual([])
  })

  it('seeded at 0 and divided by 1 − (1 − λ)^t: constant training reads its own level from the first day', () => {
    expect(smoothedLoad([], 0.25)).toBe(0)
    expect(smoothedLoad([100, 100, 100, 100, 100, 100, 100], ACUTE_LAMBDA)).toBeCloseTo(100, 10)
    expect(smoothedLoad([100, 100, 100, 100, 100, 100, 100], CHRONIC_LAMBDA)).toBeCloseTo(100, 10)
    // [100, 0, 0] at λ 0.25: raw 25 × 0.75² = 14.0625; correction 1 − 0.75³ = 0.578125; 14.0625 / 0.578125 = 24.32.
    expect(smoothedLoad([100, 0, 0], 0.25)).toBeCloseTo(24.3243, 4)
    // [0, 0, 100]: raw 25 / 0.578125 = 43.24 — yesterday weighs most.
    expect(smoothedLoad([0, 0, 100], 0.25)).toBeCloseTo(43.2432, 4)
  })

  it('the band is strict on the exact ratio: 1.5 and 0.8 themselves are steady', () => {
    expect([ACUTE_HIGH, ACUTE_LOW]).toEqual([1.5, 0.8])
    expect(bandFor(1.5)).toBe('steady')
    expect(bandFor(1.5000001)).toBe('high')
    expect(bandFor(0.8)).toBe('steady')
    expect(bandFor(0.7999999)).toBe('low')
  })
})

describe('acuteChronic: the smoothed week-rates through yesterday, recent against longer', () => {
  const today = '2026-12-15'
  // Weeks 1 to 12 are long past, so no deload week touches either span.
  const startDate = '2026-06-01'
  // A long steady history from Jan 1: the bias correction is then negligible on both sides ((27/29)^348 ≈ 1.5e-11).
  const steady = (through: string) => daily('s', '2026-01-01', through, 100)

  it('the spans are the 7 days through yesterday and the 28 before; today is left out', () => {
    const plain = acuteChronic(steady('2026-12-14'), today, startDate)
    const withToday = acuteChronic([...steady('2026-12-14'), entry('today', '2026-12-15', 5000)], today, startDate)
    expect(withToday).toEqual(plain)
    expect(plain).toMatchObject({ acuteFrom: '2026-12-08', acuteTo: '2026-12-14', chronicFrom: '2026-11-10', chronicTo: '2026-12-07', band: 'steady', skews: [] })
    // 100 a day for a long stretch: both EWMAs 100, both printed as a week at that rate, 700; ratio 1.
    expect(plain.acute).toBeCloseTo(700, 6)
    expect(plain.chronicWeek).toBeCloseTo(700, 6)
    expect(plain.ratio).toBeCloseTo(1, 10)
  })

  it('just over and just under 1.5: one heavy day yesterday on top of the steady 100', () => {
    // Yesterday at 100 + d: acute 100 + 0.25d, chronic 100 + (2/29)d; the line is d = 5800/17 ≈ 341.2.
    const spike = (d: number) => [...steady('2026-12-13'), entry('y', '2026-12-14', 100 + d)]
    const over = acuteChronic(spike(342), today, startDate)
    expect(over.band).toBe('high') // 185.5 / 123.59 = 1.5010
    expect(over.ratio).toBeCloseTo(1.501, 3)
    const under = acuteChronic(spike(340), today, startDate)
    expect(under.band).toBe('steady') // 185 / 123.45 = 1.4986
    expect(under.ratio).toBeCloseTo(1.4986, 3)
  })

  it('just over and just under 0.8: the last 3 days at y after the steady 100', () => {
    // acute 100 × 0.75³ + y(1 − 0.75³) = 42.19 + 0.578y; chronic 100 × (27/29)³ + y(1 − (27/29)³) = 80.70 + 0.193y.
    const drop = (y: number) => [...steady('2026-12-11'), ...daily('d', '2026-12-12', '2026-12-14', y)]
    const under = acuteChronic(drop(52), today, startDate)
    expect(under.band).toBe('low') // 72.25 / 90.74 = 0.7962
    expect(under.ratio).toBeCloseTo(0.7962, 3)
    const over = acuteChronic(drop(53), today, startDate)
    expect(over.band).toBe('steady') // 72.83 / 90.93 = 0.8009
    expect(over.ratio).toBeCloseTo(0.8009, 3)
  })

  it('the seam (PROGRAM-QUESTIONS 162a): a one-week doubling reads steady under EWMA where the rolling windows read high', () => {
    // 100 a day Nov 1 to Dec 7, then 200 a day Dec 8 to 14. Acute: 200 − 100 × 0.75⁷ = 186.65.
    // Chronic, raw: 100(1 − q³⁷)q⁷ + 200(1 − q⁷) = 135.05 with q = 27/29; over 44 days the correction is
    // 1 − q⁴⁴ = 0.9569, so 141.13. Ratio 1.32: steady.
    const entries = [...daily('a', '2026-11-01', '2026-12-07', 100), ...daily('b', '2026-12-08', '2026-12-14', 200)]
    const r = acuteChronic(entries, today, startDate)
    expect(r.band).toBe('steady')
    expect(r.ratio).toBeCloseTo(1.3225, 3)
    expect(r.acute).toBeCloseTo(7 * 186.652, 2)
    expect(r.chronicWeek).toBeCloseTo(7 * 141.133, 2)
    // The rolling windows on the same days: 1,400 against 2,800 / 4 = 700, a ratio of 2.0, which read high.
    expect(windowTrainingLoad(entries, '2026-12-08', '2026-12-14').load / (windowTrainingLoad(entries, '2026-11-10', '2026-12-07').load / 4)).toBe(2)
  })

  it('too early until the history reaches back 35 days, and says the day it starts', () => {
    const late = [entry('first', '2026-11-11', 100), entry('a', '2026-12-08', 100)]
    expect(acuteChronic(late, today, startDate)).toMatchObject({ band: 'too-early', ratio: null, chronicWeek: null, startsOn: '2026-12-16' })
    const reaches = acuteChronic([entry('first', '2026-11-10', 100), entry('a', '2026-12-08', 100)], today, startDate)
    expect(reaches.startsOn).toBeNull()
    expect(reaches.band).not.toBe('too-early')
    expect(acuteChronic([], today, startDate)).toMatchObject({ band: 'too-early', ratio: null, startsOn: null, acute: 0 })
  })

  it('an uncounted session still dates the history', () => {
    expect(acuteChronic([entry('first', '2026-11-10', null), entry('a', '2026-12-08', 100)], today, startDate).band).toBe('none')
  })

  it('nothing counted in the 28 days before the last 7 is none: there is nothing to compare against', () => {
    expect(acuteChronic([entry('old', '2026-11-01', 100), entry('a', '2026-12-08', 100)], today, startDate)).toMatchObject({ band: 'none', ratio: null })
  })

  it('a return from a layoff is none, not a ratio built on the faint tail of months-old training', () => {
    // 100 a day March to August, nothing September to Dec 7, then 100 a day Dec 8 to 14.
    const entries = [...daily('old', '2026-03-01', '2026-08-31', 100), ...daily('back', '2026-12-08', '2026-12-14', 100)]
    expect(acuteChronic(entries, today, startDate)).toMatchObject({ band: 'none', ratio: null, skews: [] })
    // Without the gate the smoothed ratio would read 2.2, high, on an easy week back.
    const series = dailyTrainingLoads(entries, '2026-03-01', '2026-12-14')
    expect(smoothedLoad(series, ACUTE_LAMBDA) / smoothedLoad(series, CHRONIC_LAMBDA)).toBeCloseTo(2.198, 2)
  })

  const chronic = [entry('c1', '2026-11-10', 100), entry('c2', '2026-11-17', 100), entry('c3', '2026-11-24', 100), entry('c4', '2026-12-07', 100)]
  const withAcute = (load: number) => [...chronic, entry('a', '2026-12-08', load)]

  /** The counted counterfactual: the same entries with every uncounted one (or only those named) filled in at `load`. */
  const filled = (entries: readonly TrainingLoadEntry[], load: number, ids?: readonly string[]) =>
    entries.map((e) => (e.load === null && (ids === undefined || ids.includes(e.id)) ? entry(e.id, e.date, load) : e))
  /** Which way the shown ratio reads against the counterfactual's: lower when the true one is higher. */
  const readsAgainst = (shown: number | null, truth: number | null) => {
    if (shown === null || truth === null) throw new Error('no ratio')
    return shown < truth ? 'lower' : 'higher'
  }

  it('says which way uncounted sessions skew it, and the counted counterfactual agrees', () => {
    const entries = [...withAcute(120), entry('x', '2026-12-10', null), entry('y', '2026-11-20', null), entry('z', '2026-11-21', null)]
    const r = acuteChronic(entries, today, startDate)
    expect(r.notCountedAcute.map((e) => e.id)).toEqual(['x'])
    expect(r.notCountedChronic.map((e) => e.id)).toEqual(['y', 'z'])
    expect(r.skews).toEqual([
      { why: 'not-counted', window: 'acute', reads: 'lower' },
      { why: 'not-counted', window: 'chronic', reads: 'higher' },
    ])
    // Each line against the real change: count only that span's sessions and see which way the ratio moves.
    expect(readsAgainst(r.ratio, acuteChronic(filled(entries, 100, ['x']), today, startDate).ratio)).toBe('lower')
    expect(readsAgainst(r.ratio, acuteChronic(filled(entries, 100, ['y', 'z']), today, startDate).ratio)).toBe('higher')
  })

  it('a High reading with an uncounted session 7 days back reads HIGHER, not lower (the acute weight no longer dominates there)', () => {
    // 100 a day from Jan 1 to Dec 7, Dec 8 (7 days back) uncounted, 100 a day Dec 9 to 11, 300 a day Dec 12 to 14.
    const entries = [...daily('s', '2026-01-01', '2026-12-07', 100), entry('x', '2026-12-08', null), ...daily('m', '2026-12-09', '2026-12-11', 100), ...daily('h', '2026-12-12', '2026-12-14', 300)]
    const r = acuteChronic(entries, today, startDate)
    expect(r.band).toBe('high')
    expect(r.ratio).toBeCloseTo(1.575, 3)
    const truth = acuteChronic(filled(entries, 400), today, startDate)
    expect(truth.ratio).toBeCloseTo(1.506, 3)
    expect(r.skews).toEqual([{ why: 'not-counted', window: 'acute', reads: 'higher' }])
    expect(readsAgainst(r.ratio, truth.ratio)).toBe('higher')
  })

  it('the same on a sparser history: 200 every other day 8 to 60 days back, 350 a day 1 to 5 back, a 300 session 7 back uncounted', () => {
    const back = (n: number) => addDays(today, -n)
    const entries = [
      ...Array.from({ length: 27 }, (_, i) => entry(`o${i}`, back(8 + 2 * i), 200)),
      ...[1, 2, 3, 4, 5].map((n) => entry(`h${n}`, back(n), 350)),
      entry('x', back(7), null),
    ]
    const r = acuteChronic(entries, today, startDate)
    expect(r.band).toBe('high')
    expect(r.ratio).toBeCloseTo(1.6703, 3)
    const truth = acuteChronic(filled(entries, 300), today, startDate)
    expect(truth.ratio).toBeCloseTo(1.6184, 3)
    expect(r.skews).toEqual([{ why: 'not-counted', window: 'acute', reads: 'higher' }])
    expect(readsAgainst(r.ratio, truth.ratio)).toBe('higher')
  })

  it('a Low reading with an uncounted session 8 days back reads LOWER, not higher', () => {
    // 100 a day from Jan 1 to Dec 6, Dec 7 (8 days back) uncounted, 20 a day Dec 8 to 14.
    const entries = [...daily('s', '2026-01-01', '2026-12-06', 100), entry('x', '2026-12-07', null), ...daily('l', '2026-12-08', '2026-12-14', 20)]
    const r = acuteChronic(entries, today, startDate)
    expect(r.band).toBe('low')
    expect(r.ratio).toBeCloseTo(0.425, 3)
    const truth = acuteChronic(filled(entries, 600), today, startDate)
    expect(truth.ratio).toBeCloseTo(0.53, 2)
    expect(r.skews).toEqual([{ why: 'not-counted', window: 'chronic', reads: 'lower' }])
    expect(readsAgainst(r.ratio, truth.ratio)).toBe('lower')
  })

  it('uncounted sessions on both sides of the ratio in one span can read either way', () => {
    // Steady 100, then 300 a day 2 to 6 days back; uncounted sessions 1 and 7 days back.
    const back = (n: number) => addDays(today, -n)
    const entries = [...daily('s', '2026-01-01', back(8), 100), entry('x7', back(7), null), ...[2, 3, 4, 5, 6].map((n) => entry(`h${n}`, back(n), 300)), entry('x1', back(1), null)]
    const r = acuteChronic(entries, today, startDate)
    expect(r.skews).toEqual([{ why: 'not-counted', window: 'acute', reads: 'either' }])
    // Counted alone, each moves the ratio its own way.
    expect(readsAgainst(r.ratio, acuteChronic(filled(entries, 300, ['x1']), today, startDate).ratio)).toBe('lower')
    expect(readsAgainst(r.ratio, acuteChronic(filled(entries, 300, ['x7']), today, startDate).ratio)).toBe('higher')
  })

  it('a deload week in either span says which way it pushes the ratio, from the days it covers', () => {
    // Program from Nov 2: week 4 is Nov 23 to 29 (in the 4 weeks before), week 7 is Dec 14 to 20.
    expect(acuteChronic(withAcute(120), today, '2026-11-02').skews).toEqual([{ why: 'deload', window: 'chronic', reads: 'higher' }])
    // On Dec 22 the last 7 days are Dec 15 to 21; week 8, the deload, starts Dec 21 (yesterday, 1 day back).
    const later = [entry('c', '2026-11-17', 100), entry('a', '2026-12-16', 100)]
    expect(acuteChronic(later, '2026-12-22', '2026-11-02').skews).toEqual([
      { why: 'deload', window: 'acute', reads: 'lower' },
      { why: 'deload', window: 'chronic', reads: 'higher' },
    ])
  })

  it('a post-deload ramp reading High: the deload days 5 to 7 back pushed it over the line, so it reads higher', () => {
    // Program from Nov 2, today Dec 4: 100 a day to Nov 22, the deload week Nov 23 to 29 at 60, then 260 a day.
    const ramp = (deload: number) => [...daily('s', '2026-01-01', '2026-11-22', 100), ...daily('d', '2026-11-23', '2026-11-29', deload), ...daily('r', '2026-11-30', '2026-12-03', 260)]
    const r = acuteChronic(ramp(60), '2026-12-04', '2026-11-02')
    expect(r.band).toBe('high')
    expect(r.ratio).toBeCloseTo(1.551, 3)
    const truth = acuteChronic(ramp(100), '2026-12-04', '2026-11-02')
    expect(truth.band).toBe('steady')
    expect(truth.ratio).toBeCloseTo(1.498, 3)
    expect(r.skews).toEqual([
      { why: 'deload', window: 'acute', reads: 'higher' },
      { why: 'deload', window: 'chronic', reads: 'higher' },
    ])
    expect(readsAgainst(r.ratio, truth.ratio)).toBe('higher')
  })

  it('the stated direction always matches the counted counterfactual, wherever one uncounted session falls (1 to 35 days back, High, Steady and Low)', () => {
    const back = (n: number) => addDays(today, -n)
    for (const recent of [20, 100, 350]) {
      for (let n = 1; n <= 35; n++) {
        const entries = [...daily('s', '2026-01-01', back(36), 100), ...Array.from({ length: 35 }, (_, i) => i + 1).filter((d) => d !== n).map((d) => entry(`d${d}`, back(d), d <= 4 ? recent : 100)), entry('x', back(n), null)]
        const r = acuteChronic(entries, today, startDate)
        const truth = acuteChronic(filled(entries, 200), today, startDate)
        expect(r.skews.map((s) => s.reads), `${recent} recent, ${n} back`).toEqual([readsAgainst(r.ratio, truth.ratio)])
      }
    }
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
