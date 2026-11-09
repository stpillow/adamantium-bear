import { describe, expect, it } from 'vitest'
import { homeLocation } from '../db/migrations.ts'
import type { History } from '../db/repo.ts'
import { program, templateFor } from '../program/program.ts'
import { endedEarly, newDownPeriod } from '../rules/downPeriod.ts'
import { DEFAULT_KIT, Settings, type DownPeriod, type MorningCheck, type SetLog, type Workout } from '../schema/index.ts'
import { phaseWeekFor, planSession, sessionBandWeek, sessionExtensions, type Gym } from './session.ts'

/*
 * A down period through the real program (Batch E, PROGRAM-QUESTIONS 181 to 188): the pause enters
 * planSession by the day planned (Today's, the runner's workout date, the Preview's, the Morning
 * check's next session), and the phase-week bands hold at the one the period began in.
 */

const home: Gym = { location: homeLocation(200, program.planetFitness, '2026-11-02', program.equipmentListVersion), kit: DEFAULT_KIT }
const settingsIn = (phase = 1, phaseEnteredWeek = 1): Settings =>
  Settings.parse({ injuredSide: program.injuredSide, startDate: program.startDate, dumbbellMax: 80, restTimerSeconds: 60, painPerSet: false, currentPhase: phase, phaseEnteredWeek })
const AT = '2026-11-14T13:00:00.000Z'
/** P1: declared Sat Nov 14 for 7 days, to Fri Nov 20. */
const P1 = newDownPeriod({ today: '2026-11-14', days: 7, declaredAt: AT })

const lift = (date: string, templateId: string, week: number): Workout => ({ id: `${date}-${templateId}`, date, templateId, phase: 1, week, isDeload: false, status: 'finished' })
const sets = (w: Workout, slotId: string, exerciseId: string, load: number, reps = 12): SetLog[] =>
  [1, 2, 3].map((n) => ({ id: `${w.id}:${slotId}:both:${n}`, workoutId: w.id, slotId, exerciseId, setNumber: n, side: 'both', load, loadUnit: 'lb', reps, rpe: 7, painDuring: 1, stopped: false }))
const cleanMorning = (date: string): MorningCheck => ({ id: `mc-${date}`, date, appliesTo: null, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [] })

/** P1-A's leg press at 90 lb, 3 × 12, clean on Tue Nov 3 and Tue Nov 10 (worked example 1); P1-B's box squat clean on Thu Nov 5 and Nov 12. */
function history(downPeriods: DownPeriod[] = []): History {
  const a1 = lift('2026-11-03', 'p1-a', 1)
  const a2 = lift('2026-11-10', 'p1-a', 2)
  const b1 = lift('2026-11-05', 'p1-b', 1)
  const b2 = lift('2026-11-12', 'p1-b', 2)
  return {
    workouts: [a1, b1, a2, b2],
    setLogs: [...sets(a1, 'p1a-1', 'leg-press', 90), ...sets(a2, 'p1a-1', 'leg-press', 90), ...sets(b1, 'p1b-1', 'smith-box-squat', 60), ...sets(b2, 'p1b-1', 'smith-box-squat', 60)],
    morningChecks: ['2026-11-04', '2026-11-06', '2026-11-11', '2026-11-13'].map(cleanMorning),
    runs: [],
    gateTests: [],
    sessionMoves: [],
    downPeriods,
  }
}

const slotOf = (plans: ReturnType<typeof planSession>, id: string) => {
  const plan = plans.find((p) => p.slot.id === id)
  if (!plan) throw new Error(`no slot ${id}`)
  return plan.prescriptions[0]
}

describe('the pause enters planSession by the day planned', () => {
  const planA = (before: string | undefined, periods: DownPeriod[], over: { pauseDate?: string; week?: number } = {}) =>
    planSession({ template: templateFor(1, 'A'), week: over.week ?? 3, settings: settingsIn(), history: history(periods), gym: home, ...(before ? { before } : {}), ...(over.pauseDate ? { pauseDate: over.pauseDate } : {}) })

  it('worked example 1: Tue Nov 17 inside P1, the leg press repeats 90 × 12 instead of stepping to 95 × 10', () => {
    expect(slotOf(planA('2026-11-17', []), 'p1a-1')).toMatchObject({ load: 95, repsTarget: 10, basis: 'progress-load' })
    const paused = slotOf(planA('2026-11-17', [P1]), 'p1a-1')
    expect(paused).toMatchObject({ load: 90, repsTarget: 12, sets: 3, basis: 'paused' })
    expect(paused?.note).toBe('Clean twice: same load, same target. Down period: progression paused until Friday Nov 20.')
  })

  it('a deload week inside a period deloads; the pause adds nothing', () => {
    const p2 = newDownPeriod({ today: '2026-11-23', days: 5, declaredAt: AT })
    expect(planA('2026-11-24', [p2], { week: 4 })).toEqual(planA('2026-11-24', [], { week: 4 }))
    expect(slotOf(planA('2026-11-24', [p2], { week: 4 }), 'p1a-1')).toMatchObject({ basis: 'deload', sets: 2, load: 90 })
  })

  it('a late-logged day inside the period pauses as that day; one before it does not', () => {
    const planB = (before: string, week: number) => planSession({ template: templateFor(1, 'B'), week, settings: settingsIn(), history: history([P1]), gym: home, before })
    expect(slotOf(planB('2026-11-19', 3), 'p1b-1')).toMatchObject({ load: 60, basis: 'paused' })
    // Thu Nov 12, before P1, plans from Nov 5 alone: clean once.
    expect(slotOf(planB('2026-11-12', 2), 'p1b-1')?.basis).toBe('same')
  })

  it('ended early, the day it was ended stays paused, and the next day plans as normal', () => {
    const ended = endedEarly(P1, '2026-11-17')
    const today = slotOf(planA('2026-11-17', [ended]), 'p1a-1')
    expect(today).toMatchObject({ basis: 'paused' })
    expect(today?.note).toBe('Clean twice: same load, same target. Down period: progression paused until Tuesday Nov 17.')
    expect(slotOf(planA('2026-11-18', [ended]), 'p1a-1')?.basis).toBe('progress-load')
  })

  it('the Morning check’s next session pauses by its own day, planned from every record', () => {
    expect(slotOf(planA(undefined, [P1], { pauseDate: '2026-11-17' }), 'p1a-1')?.basis).toBe('paused')
    expect(slotOf(planA(undefined, [P1], { pauseDate: '2026-11-24', week: 4 }), 'p1a-1')?.basis).toBe('deload')
    expect(slotOf(planA(undefined, [P1]), 'p1a-1')?.basis).toBe('progress-load')
  })

  it('outside every period the plan is the same with or without them', () => {
    for (const before of ['2026-11-12', '2026-11-13', '2026-11-21', '2026-11-30']) {
      expect(planA(before, [P1])).toEqual(planA(before, []))
    }
  })
})

describe('the phase-week bands hold while a period lasts (PROGRAM-QUESTIONS 188)', () => {
  // Phase 3 entered in week 8 (Mon Dec 21): its phase week 3 starts Mon Jan 4, 2027, when the single-leg plyo arrives.
  const settings = settingsIn(3, 8)
  const empty: History = { workouts: [], setLogs: [], morningChecks: [], runs: [], gateTests: [], sessionMoves: [] }
  const plyo = (h: History, before: string, week = 10) =>
    planSession({ template: templateFor(3, 'A'), week, settings, history: h, gym: home, before })
      .map((p) => p.slot.id)
      .filter((id) => id.includes('plyo'))
  const p5 = newDownPeriod({ today: '2027-01-02', days: 7, declaredAt: AT })

  it('a period from phase week 2 keeps phase week 3’s session on the two-legged plyo', () => {
    expect(plyo(empty, '2027-01-05')).toEqual(['p3a-plyo-4', 'p3a-plyo-5', 'p3a-plyo-6', 'p3a-plyo-7'])
    expect(plyo({ ...empty, downPeriods: [p5] }, '2027-01-05')).toEqual(['p3a-plyo-1', 'p3a-plyo-2', 'p3a-plyo-3'])
    // It held phase week 3's Monday, so the single-leg band waits for the next Monday, Jan 11, not the day after it ends.
    expect(plyo({ ...empty, downPeriods: [p5] }, '2027-01-09')).toEqual(['p3a-plyo-1', 'p3a-plyo-2', 'p3a-plyo-3'])
    expect(plyo({ ...empty, downPeriods: [p5] }, '2027-01-12', 11)).toEqual(['p3a-plyo-4', 'p3a-plyo-5', 'p3a-plyo-6', 'p3a-plyo-7'])
  })

  it('a 14-day period over phase weeks 3 and 4 resumes the single-leg band before the repeat hops and cuts', () => {
    const third = ['p3a-plyo-8', 'p3a-plyo-9', 'p3a-plyo-10', 'p3a-plyo-11']
    const singleLeg = ['p3a-plyo-4', 'p3a-plyo-5', 'p3a-plyo-6', 'p3a-plyo-7']
    // Without a period, Tue Jan 19 (week 12, phase week 5) runs the third band.
    expect(plyo(empty, '2027-01-19', 12)).toEqual(third)
    // From Mon Jan 4 (phase week 3) or Sun Jan 3 (phase week 2), 14 days: the first A after it runs the single-leg band.
    for (const start of ['2027-01-04', '2027-01-03']) {
      const long = { ...empty, downPeriods: [newDownPeriod({ today: start, days: 14, declaredAt: AT })] }
      expect(plyo(long, '2027-01-19', 12)).toEqual(singleLeg)
      expect(plyo(long, '2027-01-19', 12).some((id) => ['p3a-plyo-9', 'p3a-plyo-10', 'p3a-plyo-11'].includes(id))).toBe(false)
    }
    // From the Monday, band week 3 ran inside it, so week 4 runs after it and the third band comes a week later (Jan 26).
    const fromMonday = { ...empty, downPeriods: [newDownPeriod({ today: '2027-01-04', days: 14, declaredAt: AT })] }
    expect(plyo(fromMonday, '2027-01-26', 13)).toEqual(third)
    // From the Sunday, the bands were held at week 2: weeks 3 and 4 both run after it, the third band from Feb 2.
    const fromSunday = { ...empty, downPeriods: [newDownPeriod({ today: '2027-01-03', days: 14, declaredAt: AT })] }
    expect(plyo(fromSunday, '2027-01-26', 13)).toEqual(singleLeg)
    expect(plyo(fromSunday, '2027-02-02', 14)).toEqual(third)
  })

  it('the extra-time pool and the Summary’s band read the same week', () => {
    const h = { ...empty, downPeriods: [p5] }
    expect(phaseWeekFor(10, settings, h, '2027-01-05')).toBe(2)
    expect(phaseWeekFor(10, settings, h)).toBe(3)
    expect(sessionExtensions(templateFor(3, 'A'), h, settings, 10, '2027-01-05')).toEqual(sessionExtensions(templateFor(3, 'A'), empty, settings, 9))
    expect(sessionBandWeek({ phase: 3, week: 10, date: '2027-01-05' }, settings, h)).toBe(2)
    expect(sessionBandWeek({ phase: 3, week: 10, date: '2027-01-05' }, settings, empty)).toBe(3)
    expect(sessionBandWeek({ phase: 2, week: 10, date: '2027-01-05' }, settings, h)).toBeNull()
  })
})
