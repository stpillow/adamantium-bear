import { describe, expect, it } from 'vitest'
import { ADDED_SLOTS_MAX, AddedSlot, type Exercise, type SessionTemplate, type Slot } from '../schema/index.ts'
import { ADDED_SLOT_PREFIX, NOT_YET_WORDS, addableByPattern, addableExercises, addedDefaults, addedFor, addedPrescriptionText, addedRepUnit, addedRule, addedSlotId, addedSlotProblem, heldToPhase, isAddedSlotId, notAddableReason, phaseExerciseIds, slotFromAdded, withAddedSlots } from './addedSlots.ts'

const ex = (over: Partial<Exercise> & { id: string }): Exercise => ({
  name: over.id,
  pattern: 'quad',
  equipment: 'dumbbells',
  loadType: 'dumbbell-each',
  loadUnit: 'lb',
  increment: 5,
  loadDirection: 'up',
  unilateral: false,
  requires: [],
  ...over,
})

const CURL = ex({ id: 'curl', pattern: 'pull' })
const PLANK = ex({ id: 'plank', pattern: 'core', loadType: 'time', loadUnit: 's', increment: 5 })
const BRIDGE = ex({ id: 'bridge', pattern: 'hip', loadType: 'bodyweight', loadUnit: 'none', increment: 0 })
const BAND = ex({ id: 'band-walk', pattern: 'hip', loadType: 'band', loadUnit: 'none', increment: 0 })
const BALANCE = ex({ id: 'balance', pattern: 'balance', loadType: 'bodyweight', loadUnit: 'none', increment: 0, stages: ['eyes open', 'eyes closed'], requires: [], unilateral: true })
const STEP = ex({ id: 'step-up', loadType: 'step-height', loadUnit: 'in', increment: 2 })
const CARRY = ex({ id: 'carry', pattern: 'carry' })
const SPLIT = ex({ id: 'split', unilateral: true })
const LATE = ex({ id: 'late-lift' })
const JUMP = ex({ id: 'jump', pattern: 'plyo', loadType: 'bodyweight', loadUnit: 'none', increment: 0 })
const DEAD_BUG = ex({ id: 'dead-bug', pattern: 'core', loadType: 'bodyweight', loadUnit: 'none', increment: 0, perSideLabel: 'each side' })
const CATALOG = new Map([CURL, PLANK, BRIDGE, BAND, BALANCE, STEP, CARRY, SPLIT, LATE, JUMP].map((e) => [e.id, e]))

const slot = (order: number): Slot => ({
  id: `p1a-${order}`,
  order,
  label: String(order),
  exerciseId: 'bridge',
  sets: 3,
  repsMin: 8,
  repsMax: 10,
  repUnit: 'reps',
  unilateral: false,
  injuredOnly: false,
  prescriptionText: '3 × 8–10',
  cues: [],
  progressionRule: 'fixed',
  substitutionIds: [],
  optional: false,
})
// Phase 1 uses bridge, band-walk and, as substitutions, curl, plank, balance, split, step-up and carry; late-lift and jump are phase 2's.
const TEMPLATE: SessionTemplate = {
  id: 'p1-a',
  phase: 1,
  letter: 'A',
  slots: [
    { ...slot(1), substitutionIds: ['curl', 'plank'] },
    { ...slot(2), exerciseId: 'band-walk', substitutionIds: ['balance', 'split', 'step-up', 'carry'] },
    slot(3),
  ],
}
const LATER: SessionTemplate = { id: 'p2-a', phase: 2, letter: 'A', slots: [{ ...slot(1), id: 'p2a-1', exerciseId: 'late-lift', substitutionIds: ['jump'] }] }
const TEMPLATES = [TEMPLATE, LATER]
const IN_PHASE_1 = phaseExerciseIds(TEMPLATES, 1)
const add = (id: string, exerciseId: string, over: Partial<AddedSlot> = {}): AddedSlot => ({
  id: addedSlotId(id),
  templateId: 'p1-a',
  exerciseId,
  sets: 3,
  repsMin: 8,
  repsMax: 10,
  addedOn: '2026-11-04',
  ...over,
})

describe('what can be added, and how it runs', () => {
  it('marks its ids with a prefix the engine can tell from program.md’s', () => {
    expect(addedSlotId('k3')).toBe(`${ADDED_SLOT_PREFIX}k3`)
    expect(isAddedSlotId('added-k3')).toBe(true)
    expect(isAddedSlotId('p1a-3')).toBe(false)
  })

  it('refuses a step-height exercise and a carry, in words, and takes the rest', () => {
    expect(notAddableReason(STEP)).toMatch(/step height/)
    expect(notAddableReason(CARRY)).toMatch(/yards or minutes/)
    expect(notAddableReason({ name: 'Row', pattern: 'cardio', loadType: 'stack' })).toMatch(/yards or minutes/)
    expect(notAddableReason(JUMP)).toMatch(/jumping or landing/)
    for (const e of [CURL, PLANK, BRIDGE, BAND, BALANCE, SPLIT, LATE]) expect(notAddableReason(e)).toBeNull()
  })

  it('counts holds and staged balance work in seconds, everything else in reps', () => {
    expect(addedRepUnit(PLANK)).toBe('seconds')
    expect(addedRepUnit(BALANCE)).toBe('seconds')
    expect(addedRepUnit(CURL)).toBe('reps')
  })

  it('takes the conservative rule: loaded climbs, bodyweight and band repeat, a hold adds time, staged work steps', () => {
    expect(addedRule(CURL)).toBe('double-progression')
    expect(addedRule(BRIDGE)).toBe('fixed')
    expect(addedRule(BAND)).toBe('fixed')
    expect(addedRule(PLANK)).toBe('time')
    expect(addedRule(BALANCE)).toBe('stage')
  })

  it('writes the prescription as program.md would: sets × range, seconds, each leg', () => {
    expect(addedPrescriptionText({ sets: 3, repsMin: 8, repsMax: 10 }, CURL)).toBe('3 × 8–10')
    expect(addedPrescriptionText({ sets: 2, repsMin: 30, repsMax: 45 }, PLANK)).toBe('2 × 30–45 s')
    expect(addedPrescriptionText({ sets: 3, repsMin: 10, repsMax: 10 }, SPLIT)).toBe('3 × 10 each leg')
    // Work program.md writes per side without logging it per side (the dead bug's "3 × 8 each side").
    expect(addedPrescriptionText({ sets: 3, repsMin: 8, repsMax: 12 }, DEAD_BUG)).toBe('3 × 8–12 each side')
  })
})

describe('addedSlotProblem', () => {
  it('is null for an exercise that can be added', () => {
    expect(addedSlotProblem(add('a', 'curl'), CURL, 0, IN_PHASE_1)).toBeNull()
  })
  it('says why not: no such exercise, one that can’t be added, a full session', () => {
    expect(addedSlotProblem(add('a', 'nope'), undefined, 0, IN_PHASE_1)).toMatch(/isn’t in the catalog/)
    expect(addedSlotProblem(add('a', 'step-up'), STEP, 0, IN_PHASE_1)).toMatch(/step height/)
    expect(addedSlotProblem(add('a', 'curl'), CURL, ADDED_SLOTS_MAX, IN_PHASE_1)).toMatch(/remove one first/)
  })
})

describe('slotFromAdded', () => {
  it('makes a slot that passes the program’s own schema, after the template’s, labelled +n', () => {
    const made = slotFromAdded(add('a', 'split'), SPLIT, 1, 4)
    expect(made).toMatchObject({ id: 'added-a', order: 4, label: '+1', exerciseId: 'split', sets: 3, repsMin: 8, repsMax: 10, repUnit: 'reps', unilateral: true, injuredOnly: false, optional: false, progressionRule: 'double-progression', perSideLabel: 'each leg', substitutionIds: [], cues: [] })
    expect(made.prescriptionText).toBe('3 × 8–10 each leg')
  })
  it('carries the side words program.md writes on work it doesn’t log per side', () => {
    const made = slotFromAdded({ id: 'added-d', sets: 3, repsMin: 8, repsMax: 12 }, DEAD_BUG, 1, 4)
    expect(made).toMatchObject({ unilateral: false, perSideLabel: 'each side', prescriptionText: '3 × 8–12 each side' })
  })
})

describe('withAddedSlots', () => {
  it('leaves a template with nothing added exactly as written', () => {
    expect(withAddedSlots(TEMPLATE, [], CATALOG, TEMPLATES)).toBe(TEMPLATE)
    expect(withAddedSlots(TEMPLATE, [add('x', 'curl', { templateId: 'p1-b' })], CATALOG, TEMPLATES)).toBe(TEMPLATE)
  })

  it('lays the added slots after the template’s own, in the order they were added, without touching the template', () => {
    const rows = [add('b', 'plank', { addedOn: '2026-11-05' }), add('a', 'curl')]
    const out = withAddedSlots(TEMPLATE, rows, CATALOG, TEMPLATES)
    expect(out.slots.map((s) => s.id)).toEqual(['p1a-1', 'p1a-2', 'p1a-3', 'added-a', 'added-b'])
    expect(out.slots.map((s) => s.order)).toEqual([1, 2, 3, 4, 5])
    expect(out.slots.slice(3).map((s) => s.label)).toEqual(['+1', '+2'])
    expect(TEMPLATE.slots).toHaveLength(3)
  })

  it('drops a row whose exercise the catalog no longer runs, and never reads another template’s rows', () => {
    const rows = [add('a', 'gone'), add('b', 'step-up'), add('c', 'curl'), add('d', 'curl', { templateId: 'p2-a' })]
    expect(addedFor('p1-a', rows, CATALOG, IN_PHASE_1).map((a) => a.id)).toEqual(['added-c'])
    expect(withAddedSlots(TEMPLATE, rows, CATALOG, TEMPLATES).slots.map((s) => s.id)).toEqual(['p1a-1', 'p1a-2', 'p1a-3', 'added-c'])
  })

  it('stops at the most a session takes', () => {
    const rows = Array.from({ length: ADDED_SLOTS_MAX + 2 }, (_, i) => add(`r${i}`, 'curl', { addedOn: `2026-11-${String(10 + i).padStart(2, '0')}` }))
    expect(withAddedSlots(TEMPLATE, rows, CATALOG, TEMPLATES).slots).toHaveLength(3 + ADDED_SLOTS_MAX)
  })
})

describe('AddedSlot', () => {
  it('holds the choices only, and refuses a range that runs backwards or too many sets', () => {
    expect(AddedSlot.safeParse(add('a', 'curl')).success).toBe(true)
    expect(AddedSlot.safeParse(add('a', 'curl', { repsMin: 10, repsMax: 8 })).success).toBe(false)
    expect(AddedSlot.safeParse(add('a', 'curl', { sets: 7 })).success).toBe(false)
    expect(AddedSlot.safeParse({ ...add('a', 'curl'), extra: 1 }).success).toBe(false)
  })
})

describe('the picker', () => {
  it('lists what can be added, by name, and leaves out what can’t', () => {
    const names = addableExercises([...CATALOG.values()].map((e) => ({ ...e, name: e.id })), TEMPLATES, 1).map((e) => e.name)
    expect(names).toEqual(['balance', 'band-walk', 'bridge', 'curl', 'plank', 'split'])
  })

  it('starts a lift at 3 × 8–12 and a hold at 3 × 30–45 seconds', () => {
    expect(addedDefaults(CURL)).toEqual({ sets: 3, repsMin: 8, repsMax: 12 })
    expect(addedDefaults(PLANK)).toEqual({ sets: 3, repsMin: 30, repsMax: 45 })
    expect(addedDefaults(BALANCE)).toEqual({ sets: 3, repsMin: 30, repsMax: 45 })
  })
})

describe('staying inside the program', () => {
  it('knows what program.md has used by a phase: a slot’s own exercise and its substitutions, in that phase or an earlier one', () => {
    expect([...phaseExerciseIds(TEMPLATES, 1)].sort()).toEqual(['balance', 'band-walk', 'bridge', 'carry', 'curl', 'plank', 'split', 'step-up'])
    expect([...phaseExerciseIds(TEMPLATES, 2)]).toEqual(expect.arrayContaining(['late-lift', 'jump', 'bridge']))
  })

  it('refuses, in words, an exercise program.md holds for a later phase', () => {
    expect(addedSlotProblem(add('a', 'late-lift'), LATE, 0, IN_PHASE_1)).toBe(NOT_YET_WORDS)
    expect(addedSlotProblem(add('a', 'late-lift'), LATE, 0, phaseExerciseIds(TEMPLATES, 2))).toBeNull()
  })

  it('leaves a later phase’s exercise, and any jumping work, out of the picker, and out of a session an imported file put it on', () => {
    expect(addableExercises([...CATALOG.values()], TEMPLATES, 1).map((e) => e.id)).not.toContain('late-lift')
    expect(addableExercises([...CATALOG.values()], TEMPLATES, 2).map((e) => e.id)).toContain('late-lift')
    expect(addableExercises([...CATALOG.values()], TEMPLATES, 2).map((e) => e.id)).not.toContain('jump')
    const rows = [add('a', 'late-lift'), add('b', 'jump'), add('c', 'curl')]
    expect(withAddedSlots(TEMPLATE, rows, CATALOG, TEMPLATES).slots.map((s) => s.id)).toEqual(['p1a-1', 'p1a-2', 'p1a-3', 'added-c'])
  })
})

describe('the accessory and core catalog (Batch C, PROGRAM-QUESTIONS 169)', () => {
  // No session of either phase lists these: without the catalog's exemption, neither could ever be added.
  const RAISE = ex({ id: 'raise', name: 'Lateral raise', pattern: 'push', accessory: { tier: 'upper', sets: 3, repsMin: 12, repsMax: 15, cues: ['Soft elbow.', 'Keep it light.'], substitutionIds: ['curl', 'front-raise'] } })
  const HOLD = ex({ id: 'hold', name: 'Farmer’s hold', pattern: 'core', accessory: { tier: 'core', repUnit: 'seconds', sets: 3, repsMin: 30, repsMax: 45, cues: ['Stand tall.'], substitutionIds: ['plank'] } })
  const PUSHUP = ex({ id: 'push-up', name: 'Push-up', pattern: 'push', loadType: 'bodyweight', loadUnit: 'none', increment: 0, accessory: { tier: 'upper', sets: 3, repsMin: 8, repsMax: 12, cues: ['On the toes.'], substitutionIds: [] } })
  const WITH = new Map([...CATALOG, [RAISE.id, RAISE], [HOLD.id, HOLD], [PUSHUP.id, PUSHUP]])

  it('is held to no phase: addable in Phase 1, refused by nothing, while a later phase’s exercise still waits', () => {
    expect(heldToPhase(RAISE, IN_PHASE_1)).toBe(false)
    expect(heldToPhase(LATE, IN_PHASE_1)).toBe(true)
    expect(heldToPhase(CURL, IN_PHASE_1)).toBe(false)
    expect(addedSlotProblem(add('a', 'raise'), RAISE, 0, IN_PHASE_1)).toBeNull()
    expect(addedSlotProblem(add('a', 'hold', { repsMin: 30, repsMax: 45 }), HOLD, 0, new Set())).toBeNull()
    expect(addedSlotProblem(add('a', 'late-lift'), LATE, 0, IN_PHASE_1)).toBe(NOT_YET_WORDS)
    expect(addableExercises([...WITH.values()], TEMPLATES, 1).map((e) => e.id)).toEqual(expect.arrayContaining(['raise', 'hold', 'push-up']))
    expect(addableExercises([...WITH.values()], TEMPLATES, 1).map((e) => e.id)).not.toContain('late-lift')
  })

  it('runs with its own cues and ordered substitutions; anything else still runs with none', () => {
    const made = slotFromAdded(add('a', 'raise'), RAISE, 1, 4)
    expect(made).toMatchObject({ cues: ['Soft elbow.', 'Keep it light.'], substitutionIds: ['curl', 'front-raise'], repUnit: 'reps', progressionRule: 'double-progression', unilateral: false })
    expect(slotFromAdded(add('a', 'curl'), CURL, 1, 4)).toMatchObject({ cues: [], substitutionIds: [] })
  })

  it('starts at its own sets and range; the farmer’s hold at 3 × 30–45 s, counted in seconds, climbing by load', () => {
    expect(addedDefaults(RAISE)).toEqual({ sets: 3, repsMin: 12, repsMax: 15 })
    expect(addedDefaults(HOLD)).toEqual({ sets: 3, repsMin: 30, repsMax: 45 })
    expect(addedRepUnit(HOLD)).toBe('seconds')
    expect(addedRule(HOLD)).toBe('double-progression')
    expect(addedPrescriptionText(addedDefaults(HOLD), HOLD)).toBe('3 × 30–45 s')
    expect(slotFromAdded({ id: 'added-h', ...addedDefaults(HOLD) }, HOLD, 1, 4)).toMatchObject({ repUnit: 'seconds', prescriptionText: '3 × 30–45 s' })
    // A bodyweight accessory repeats under the fixed rule (flagged for Shawn).
    expect(addedRule(PUSHUP)).toBe('fixed')
    // Anything else keeps the old defaults.
    expect(addedDefaults(CURL)).toEqual({ sets: 3, repsMin: 8, repsMax: 12 })
  })

  it('a stored add of one stays on its session in every phase', () => {
    const rows = [add('a', 'raise'), add('b', 'hold', { repsMin: 30, repsMax: 45, addedOn: '2026-11-05' }), add('c', 'late-lift')]
    expect(addedFor('p1-a', rows, WITH, IN_PHASE_1).map((a) => a.id)).toEqual(['added-a', 'added-b'])
    const out = withAddedSlots(TEMPLATE, rows, WITH, TEMPLATES)
    expect(out.slots.slice(3).map((s) => [s.id, s.label, s.repUnit])).toEqual([
      ['added-a', '+1', 'reps'],
      ['added-b', '+2', 'seconds'],
    ])
  })

  it('the picker groups what can be added by pattern, in the enum’s order, each group by name', () => {
    const groups = addableByPattern([...WITH.values()], TEMPLATES, 1)
    expect(groups.map((g) => [g.pattern, g.exercises.map((e) => e.id)])).toEqual([
      ['quad', ['split']],
      ['hip', ['band-walk', 'bridge']],
      ['balance', ['balance']],
      ['push', ['raise', 'push-up']],
      ['pull', ['curl']],
      ['core', ['hold', 'plank']],
    ])
    // Nothing empty, nothing held back, nothing a session can't take.
    expect(groups.flatMap((g) => g.exercises).map((e) => e.id).sort()).toEqual(addableExercises([...WITH.values()], TEMPLATES, 1).map((e) => e.id).sort())
  })
})
