import { describe, expect, it } from 'vitest'
import { homeLocation } from '../db/migrations.ts'
import type { History } from '../db/repo.ts'
import { program, templateFor } from '../program/program.ts'
import { DEFAULT_KIT, Settings, type AddedSlot, type SessionLetter, type SetLog, type Workout } from '../schema/index.ts'
import { rampReps } from '../rules/warmUpRamp.ts'
import { planSession, rampsInOrder, sessionExtensions, slotRamp, warmUpFor, windowFit, type Gym, type SlotPlan } from './session.ts'

// Warm-up sets through the real program (Batch C, decisions 5 and 14; PROGRAM-QUESTIONS 165–167):
// which slots show them, that they stay out of the plan, and what they cost the time window.

const home: Gym = { location: homeLocation(80, program.planetFitness, '2026-11-02', program.equipmentListVersion), kit: DEFAULT_KIT }
const settingsIn = (phase: number, phaseEnteredWeek: number): Settings =>
  Settings.parse({ injuredSide: program.injuredSide, startDate: program.startDate, dumbbellMax: 80, restTimerSeconds: 60, painPerSet: false, currentPhase: phase, phaseEnteredWeek })
const historyOf = (over: Partial<History> = {}): History => ({ workouts: [], setLogs: [], morningChecks: [], runs: [], gateTests: [], sessionMoves: [], ...over })
const WEEK: Record<number, { week: number; entered: number }> = { 1: { week: 2, entered: 1 }, 2: { week: 5, entered: 4 }, 3: { week: 9, entered: 8 } }

const workout = (id: string, date: string, templateId: string): Workout => ({ id, date, templateId, phase: 1, week: 1, isDeload: false, status: 'finished' })
const sets = (workoutId: string, slotId: string, exerciseId: string, load: number): SetLog[] =>
  [1, 2, 3].map((n) => ({ id: `${workoutId}-${slotId}-${n}`, workoutId, slotId, exerciseId, setNumber: n, side: 'both', load, loadUnit: 'lb', reps: 10, stopped: false, rpe: 7, painDuring: 1 }))
/** Week 1's P1-A with the leg press at 180 and the bench at 40 each, and a P1-C that ran the chest press machine at 100. */
const loaded = historyOf({
  workouts: [workout('w1', '2026-11-02', 'p1-a'), workout('w2', '2026-11-04', 'p1-c')],
  setLogs: [...sets('w1', 'p1a-1', 'leg-press', 180), ...sets('w1', 'p1a-3', 'db-bench-press', 40), ...sets('w2', 'p1c-4', 'chest-press-machine', 100)],
})

const planOf = (phase: number, letter: SessionLetter, history: History = historyOf(), gym: Gym = home, extend = false, chosenExercise?: Record<string, string>): SlotPlan[] => {
  const { week, entered } = WEEK[phase] ?? { week: 2, entered: 1 }
  const settings = settingsIn(phase, entered)
  const template = templateFor(phase, letter)
  return planSession({ template, week, settings, history, gym, ...(extend ? { extend: sessionExtensions(template, history, settings, week) } : {}), ...(chosenExercise ? { chosenExercise } : {}) })
}
const eligible = (plans: readonly SlotPlan[]) =>
  plans.filter((p) => {
    const ramp = slotRamp(p, { late: false, alreadyWarm: false })
    return ramp.kind === 'sets' || ramp.why !== 'not-eligible'
  })
const byPlan = (plans: readonly SlotPlan[], id: string) => {
  const i = plans.findIndex((p) => p.slot.id === id)
  if (i < 0) throw new Error(`no slot ${id}`)
  return i
}

describe('which slots show warm-up sets (PROGRAM-QUESTIONS 165)', () => {
  it('the big two-legged and two-handed lifts of every session, and nothing else', () => {
    const table: Record<string, string[]> = {
      '1A': ['p1a-1 leg-press', 'p1a-3 db-bench-press'],
      '1B': ['p1b-1 smith-box-squat', 'p1b-4 seated-db-shoulder-press'],
      '1C': ['p1c-2 db-rdl', 'p1c-4 incline-db-press'],
      '2A': ['p2a-3 db-bench-press'],
      '2B': ['p2b-4 seated-db-shoulder-press'],
      '2C': ['p2c-4 incline-db-press'],
      '3A': ['p3a-1 leg-press', 'p3a-3 db-bench-press'],
      '3B': ['p3b-4 seated-db-shoulder-press'],
      '3C': ['p3c-4 incline-db-press'],
    }
    for (const [key, expected] of Object.entries(table)) {
      const plans = planOf(Number(key[0]), key[1] as SessionLetter)
      expect(eligible(plans).map((p) => `${p.slot.id} ${p.exercise.id}`), key).toEqual(expected)
    }
  })

  it('the back extension, the hip thrust, the one-legged work and the accessories get none', () => {
    const c = planOf(1, 'C')
    expect(slotRamp(c[byPlan(c, 'p1c-6')] as SlotPlan, { late: false, alreadyWarm: false })).toEqual({ kind: 'none', why: 'not-eligible' })
    const b = planOf(1, 'B')
    expect(slotRamp(b[byPlan(b, 'p1b-2')] as SlotPlan, { late: false, alreadyWarm: false })).toEqual({ kind: 'none', why: 'not-eligible' })
    const added = (exerciseId: string): AddedSlot => ({ id: `added-${exerciseId}`, templateId: 'p1-a', exerciseId, sets: 3, repsMin: 8, repsMax: 10, addedOn: '2026-11-04' })
    const withAccessories = planOf(1, 'A', historyOf({ addedSlots: [added('overhead-press-machine'), added('lateral-raise')] }))
    for (const p of withAccessories.filter((x) => x.slot.id.startsWith('added-'))) expect(slotRamp(p, { late: false, alreadyWarm: false }), p.exercise.id).toEqual({ kind: 'none', why: 'not-eligible' })
  })

  it('in P1-A’s extra-time pool: the other sessions’ squat, presses and RDL, and program.md’s two machine presses', () => {
    const plans = planOf(1, 'A', historyOf(), home, true)
    expect(eligible(plans.filter((p) => p.slot.id.startsWith('extra-'))).map((p) => `${p.slot.label} ${p.exercise.id}`)).toEqual([
      '+B1 smith-box-squat',
      '+B4 seated-db-shoulder-press',
      '+C2 db-rdl',
      '+C4 incline-db-press',
      '+U2 chest-press-machine',
      '+U3 smith-bench-press',
    ])
  })

  it('a first time shows none until a load exists; with one, the ramp is from the day’s load', () => {
    const first = planOf(1, 'A')
    expect(slotRamp(first[0] as SlotPlan, { late: false, alreadyWarm: false })).toEqual({ kind: 'none', why: 'no-load' })
    const plans = planOf(1, 'A', loaded)
    expect(slotRamp(plans[byPlan(plans, 'p1a-1')] as SlotPlan, { late: false, alreadyWarm: false })).toMatchObject({ kind: 'sets', workingLoad: 180, sets: [{ load: 90, reps: 8 }, { load: 135, reps: 5 }] })
    expect(slotRamp(plans[byPlan(plans, 'p1a-3')] as SlotPlan, { late: false, alreadyWarm: false })).toMatchObject({ kind: 'sets', workingLoad: 40, sets: [{ load: 20 }, { load: 30 }] })
  })

  it('a session entered after the fact shows none anywhere', () => {
    for (const ramp of rampsInOrder(planOf(1, 'A', loaded, home, true), true)) expect(ramp).toMatchObject({ kind: 'none', why: 'late' })
  })

  it('a rack move starts the machine it moved to as a first time: no warm-up sets until a load is picked there', () => {
    const shortRack: Gym = { ...home, location: { ...home.location, dumbbellMaxLb: 30 } }
    const plans = planOf(1, 'A', loaded, shortRack)
    const bench = plans[byPlan(plans, 'p1a-3')] as SlotPlan
    expect(bench.prescriptions[0]).toMatchObject({ exerciseId: 'chest-press-machine', load: null, rackMoved: true })
    expect(slotRamp(bench, { late: false, alreadyWarm: false })).toEqual({ kind: 'none', why: 'no-load' })
  })

  it('a swap ramps from the exercise swapped to, at its own load', () => {
    const plans = planOf(1, 'A', loaded, home, false, { 'p1a-3': 'chest-press-machine' })
    const bench = plans[byPlan(plans, 'p1a-3')] as SlotPlan
    expect(bench.prescriptions[0]).toMatchObject({ exerciseId: 'chest-press-machine', load: 100 })
    expect(slotRamp(bench, { late: false, alreadyWarm: false })).toMatchObject({ kind: 'sets', sets: [{ load: 50 }, { load: 75 }] })
  })
})

describe('once per exercise per session', () => {
  it('in plan order, an added slot of the bench after program.md’s shows none (the fit and the Preview)', () => {
    const history = historyOf({ ...loaded, addedSlots: [{ id: 'added-k1', templateId: 'p1-a', exerciseId: 'db-bench-press', sets: 3, repsMin: 8, repsMax: 10, addedOn: '2026-11-04' }] })
    const plans = planOf(1, 'A', history)
    const ramps = rampsInOrder(plans, false)
    expect(ramps[byPlan(plans, 'p1a-3')]).toMatchObject({ kind: 'sets' })
    expect(ramps[byPlan(plans, 'added-k1')]).toEqual({ kind: 'none', why: 'already-warm', workingLoad: 40 })
  })

  it('keyed on the exercise each slot runs today: the bench swapped to the chest press machine and the +U2 chest press machine ramp once', () => {
    const plans = planOf(1, 'A', loaded, home, true, { 'p1a-3': 'chest-press-machine' })
    const ramps = rampsInOrder(plans, false)
    const u2 = plans.findIndex((p) => p.slot.label === '+U2')
    expect(plans[u2]?.exercise.id).toBe('chest-press-machine')
    expect(ramps[byPlan(plans, 'p1a-3')]).toMatchObject({ kind: 'sets' })
    expect(ramps[u2]).toMatchObject({ kind: 'none', why: 'already-warm' })
  })

  it('in the runner, warm means a set of that exercise is already logged, whichever slot ran first', () => {
    const plans = planOf(1, 'A', loaded)
    const bench = plans[byPlan(plans, 'p1a-3')] as SlotPlan
    expect(slotRamp(bench, { late: false, alreadyWarm: true })).toMatchObject({ kind: 'none', why: 'already-warm' })
  })
})

describe('warm-up sets stay out of the plan', () => {
  it('planSession gives the same plan whatever the ramps, the fit or the warm-up do', () => {
    const plans = planOf(1, 'A', loaded, home, true)
    const before = structuredClone(plans)
    rampsInOrder(plans, false)
    windowFit(plans, 60, 45, { warmUpMinutes: 10, ramps: true })
    expect(plans).toEqual(before)
    expect(planOf(1, 'A', loaded, home, true)).toEqual(before)
    expect(JSON.stringify(plans)).not.toMatch(/ramp/i)
  })
})

describe('the time window, door to door, on the real program (PROGRAM-QUESTIONS 166, 167)', () => {
  const settings = settingsIn(1, 1)
  const warm = warmUpFor(1, home)

  it('Planet Fitness has the upright bike: Phase 1’s warm-up is 10 minutes; Phase 3’s is 8', () => {
    expect(warm).toEqual({ bike: 5, circuit: 5, total: 10 })
    expect(warmUpFor(3, home).total).toBe(8)
    const noBike: Gym = { ...home, location: { ...home.location, markedOff: [{ id: 'upright-bike', on: '2026-11-02' }] } }
    expect(warmUpFor(1, noBike)).toEqual({ bike: null, circuit: 5, total: 5 })
  })

  it('P1-A at 45 minutes, a first time: the warm-up off the top keeps 1–4', () => {
    const fit = windowFit(planOf(1, 'A'), settings.restTimerSeconds, 45, { warmUpMinutes: warm.total, ramps: true })
    expect(fit).toMatchObject({ dropped: ['p1a-9', 'p1a-8', 'p1a-5', 'p1a-6', 'p1a-7'], keep: ['p1a-1', 'p1a-2', 'p1a-3', 'p1a-4'], fullMinutes: 63, keptMinutes: 34, warmUpMinutes: 10, ramped: [] })
    // Without the warm-up it kept 1–8.
    expect(windowFit(planOf(1, 'A'), 60, 45, { warmUpMinutes: 0, ramps: true }).dropped).toEqual(['p1a-9'])
  })

  it('P1-A at 45 with loads on the leg press and the bench: their warm-up sets are counted too', () => {
    const fit = windowFit(planOf(1, 'A', loaded), 60, 45, { warmUpMinutes: warm.total, ramps: true })
    expect(fit).toMatchObject({ dropped: ['p1a-9', 'p1a-8', 'p1a-5', 'p1a-6', 'p1a-7'], fullMinutes: 70, keptMinutes: 42, ramped: ['p1a-1', 'p1a-3'], fits: true })
    // A late entry counts no warm-up sets.
    expect(windowFit(planOf(1, 'A', loaded), 60, 45, { warmUpMinutes: warm.total, ramps: false })).toMatchObject({ fullMinutes: 63, ramped: [] })
  })

  it('the shortest window the stepper allows, 15, leaves 5 minutes: less than the first exercise, which stays alone and runs past', () => {
    const fit = windowFit(planOf(1, 'A', loaded), 60, 15, { warmUpMinutes: warm.total, ramps: true })
    expect(fit).toMatchObject({ keep: ['p1a-1'], fits: false, warmUpPastWindow: false, firstPastWindow: true })
  })

  it('more time adds extras only into what the warm-up leaves', () => {
    const plans = planOf(1, 'A', historyOf(), home, true)
    const without = windowFit(plans, 60, 90, { warmUpMinutes: 0, ramps: true })
    const withWarm = windowFit(plans, 60, 90, { warmUpMinutes: warm.total, ramps: true })
    expect(withWarm.added.length).toBeLessThan(without.added.length)
    expect(withWarm.keptMinutes).toBeLessThanOrEqual(90)
  })

  it('the fit counts the ramp reps it shows: 8 then 5 before the leg press', () => {
    const plans = planOf(1, 'A', loaded)
    expect(rampReps(rampsInOrder(plans, false)[0] ?? { kind: 'none', why: 'late' })).toEqual([8, 5])
  })
})
