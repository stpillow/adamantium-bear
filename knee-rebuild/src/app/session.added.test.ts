import { describe, expect, it } from 'vitest'
import { homeLocation } from '../db/migrations.ts'
import type { History } from '../db/repo.ts'
import { program, templateFor } from '../program/program.ts'
import { DEFAULT_KIT, Settings, type AddedSlot } from '../schema/index.ts'
import { planSession, sessionExtensions, windowFit, type Gym } from './session.ts'

// planSession with exercises Shawn added to a session (Dexie version 5): they run after the template's
// own slots, prescribe and log like any slot, and program.md's template is never written.

const home: Gym = { location: homeLocation(80, program.planetFitness, '2026-11-02', program.equipmentListVersion), kit: DEFAULT_KIT }
const settings = Settings.parse({ injuredSide: program.injuredSide, startDate: program.startDate, dumbbellMax: 80, restTimerSeconds: 60, painPerSet: false, currentPhase: 1, phaseEnteredWeek: 1 })
const historyOf = (over: Partial<History> = {}): History => ({ workouts: [], setLogs: [], morningChecks: [], runs: [], gateTests: [], sessionMoves: [], ...over })
const added = (over: Partial<AddedSlot> = {}): AddedSlot => ({ id: 'added-k1', templateId: 'p1-a', exerciseId: 'db-bench-press', sets: 3, repsMin: 8, repsMax: 10, addedOn: '2026-11-04', ...over })
const plan = (history: History, week = 2) => planSession({ template: templateFor(1, 'A'), week, settings, history, gym: home })

describe('planSession with added exercises', () => {
  it('runs them after the template’s own slots, as ordinary slots with a prescription of their own', () => {
    const own = plan(historyOf())
    const plans = plan(historyOf({ addedSlots: [added()] }))
    expect(plans.map((p) => p.slot.id)).toEqual([...own.map((p) => p.slot.id), 'added-k1'])
    const mine = plans.at(-1)
    expect(mine?.slot).toMatchObject({ label: '+1', exerciseId: 'db-bench-press', sets: 3, repsMin: 8, repsMax: 10, progressionRule: 'double-progression', optional: false })
    expect(mine?.exercise.id).toBe('db-bench-press')
    expect(mine?.prescriptions[0]).toMatchObject({ sets: 3, repUnit: 'reps' })
  })

  it('leaves the other slots’ plans exactly as they were, and never writes the seed template', () => {
    const before = structuredClone(templateFor(1, 'A'))
    const own = plan(historyOf())
    const plans = plan(historyOf({ addedSlots: [added()] }))
    expect(plans.slice(0, own.length)).toEqual(own)
    expect(templateFor(1, 'A')).toEqual(before)
  })

  it('an exercise added to another session does not show up here, and a history with none plans as written', () => {
    const own = plan(historyOf())
    expect(plan(historyOf({ addedSlots: [added({ templateId: 'p1-b' })] }))).toEqual(own)
    const { addedSlots: _none, ...bare } = historyOf()
    void _none
    expect(plan(bare)).toEqual(own)
  })

  it('an accessory added in Phase 1 runs with the catalog’s own cues and substitutions, and the seed’s slots are untouched (PROGRAM-QUESTIONS 169)', () => {
    const own = plan(historyOf())
    const plans = plan(historyOf({ addedSlots: [added({ exerciseId: 'farmers-hold', repsMin: 30, repsMax: 45 })] }))
    expect(plans.slice(0, own.length)).toEqual(own)
    const mine = plans.at(-1)
    const hold = program.exercises.find((e) => e.id === 'farmers-hold')
    expect(mine?.slot).toMatchObject({ label: '+1', exerciseId: 'farmers-hold', repUnit: 'seconds', progressionRule: 'double-progression', cues: hold?.accessory?.cues, substitutionIds: ['side-plank'] })
    expect(mine?.prescriptions[0]).toMatchObject({ sets: 3, repUnit: 'seconds' })
  })

  it('a deload week takes fewer sets of an added exercise, as it does of every slot', () => {
    const deload = plan(historyOf({ addedSlots: [added({ sets: 3 })] }), 4)
    expect(deload.at(-1)?.prescriptions[0]?.sets).toBe(2)
  })
})

describe('extra time, through the real program', () => {
  const week = 2
  const template = templateFor(1, 'A')
  const pool = sessionExtensions(template, historyOf(), settings, week)
  const withPool = (history: History) => planSession({ template, week, settings, history, gym: home, extend: pool })

  it('offers the other sessions’ exercises first and then upper-body work, none of it already in the session or any jumping, step-height, carry or cardio work', () => {
    const own = new Set(template.slots.map((s) => s.exerciseId))
    const ids = pool.map((s) => s.exerciseId)
    expect(ids.length).toBeGreaterThan(6)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(own.has(id), id).toBe(false)
    const byId = new Map(program.exercises.map((e) => [e.id, e]))
    for (const id of ids) expect(['plyo', 'carry', 'cardio']).not.toContain(byId.get(id)?.pattern)
    // The first of it is from B or C (the label says which); the last is upper-body work.
    expect(pool[0]?.label).toMatch(/^\+[BC]/)
    expect(pool.at(-1)?.label).toMatch(/^\+U/)
  })

  it('after the other sessions’ 14, the +U part: program.md’s seven upper-body slots as before, then the 16 upper accessories, then the 4 core (PROGRAM-QUESTIONS 170)', () => {
    const others = pool.filter((s) => !s.label.startsWith('+U'))
    const upper = pool.filter((s) => s.label.startsWith('+U'))
    expect(others).toHaveLength(14)
    expect(pool.slice(0, 14)).toEqual(others)
    expect(upper.map((s) => s.label)).toEqual(Array.from({ length: 27 }, (_, i) => `+U${i + 1}`))
    const byId = new Map(program.exercises.map((e) => [e.id, e]))
    // +U1 to +U7: program.md's own pulls and pushes, exactly as before Batch C.
    expect(upper.slice(0, 7).map((s) => s.exerciseId)).toEqual(['single-arm-cable-pulldown', 'chest-press-machine', 'smith-bench-press', 'chest-supported-db-row', 'single-arm-cable-row', 'face-pull', 'rear-delt-machine'])
    expect(upper.slice(0, 7).every((s) => byId.get(s.exerciseId)?.accessory === undefined && s.sets === 3 && s.repsMin === 8 && s.repsMax === 12 && s.cues.length === 0)).toBe(true)
    // +U8 to +U23: the upper tier; +U24 to +U27: core, each with the catalog's own cues.
    expect(upper.slice(7, 23).map((s) => byId.get(s.exerciseId)?.accessory?.tier)).toEqual(Array.from({ length: 16 }, () => 'upper'))
    expect(upper.slice(23).map((s) => s.exerciseId)).toEqual(['cable-crunch', 'hanging-knee-raise', 'farmers-hold', 'ab-rollout'])
    for (const s of upper.slice(7)) expect(s.cues, s.exerciseId).toEqual(byId.get(s.exerciseId)?.accessory?.cues)
    expect(upper.find((s) => s.exerciseId === 'farmers-hold')).toMatchObject({ repUnit: 'seconds', prescriptionText: '3 × 30–45 s' })
  })

  it('plans them as ordinary slots after the session’s own, with a prescription, and changes nothing before them', () => {
    const own = planSession({ template, week, settings, history: historyOf(), gym: home })
    const plans = withPool(historyOf())
    expect(plans.slice(0, own.length)).toEqual(own)
    expect(plans.slice(own.length).map((p) => p.slot.id)).toEqual(pool.map((s) => s.id))
    for (const p of plans.slice(own.length)) expect(p.prescriptions.length).toBeGreaterThan(0)
  })

  it('windowFit adds some for 90 minutes, leaves the session whole for 20 and takes none of them', () => {
    // Door to door (PROGRAM-QUESTIONS 166): Phase 1's 10-minute warm-up comes off the top.
    const door = { warmUpMinutes: 10, ramps: true }
    const plans = withPool(historyOf())
    const long = windowFit(plans, 60, 90, door)
    expect(long.added.length).toBeGreaterThan(0)
    expect(long.added.length).toBeLessThanOrEqual(6)
    expect(long.dropped).toEqual([])
    expect(long.keptMinutes).toBeLessThanOrEqual(90)
    const short = windowFit(plans, 60, 20, door)
    expect(short.added).toEqual([])
    expect(short.dropped.length).toBeGreaterThan(0)
    expect(windowFit(plans, 60, null, door).added).toEqual([])
  })
})
