import { describe, expect, it } from 'vitest'
import type { Exercise, SessionTemplate, Slot } from '../schema/index.ts'
import { EXTENSION_MAX, EXTRA_PREFIX, extensionPool, isExtraSlotId } from './extensions.ts'

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
const slot = (id: string, exerciseId: string, over: Partial<Slot> = {}): Slot => ({
  id,
  order: 1,
  label: '1',
  exerciseId,
  sets: 3,
  repsMin: 8,
  repsMax: 10,
  repUnit: 'reps',
  unilateral: false,
  injuredOnly: false,
  prescriptionText: '3 × 8–10',
  cues: ['Slow'],
  progressionRule: 'double-progression',
  substitutionIds: ['sub'],
  optional: false,
  ...over,
})
const template = (id: string, letter: 'A' | 'B' | 'C', slots: Slot[], phase = 1): SessionTemplate => ({ id, phase, letter, slots })

const SQUAT = ex({ id: 'squat' })
const PRESS = ex({ id: 'press', pattern: 'quad' })
const LUNGE = ex({ id: 'lunge', pattern: 'single-leg' })
const CALF = ex({ id: 'calf', pattern: 'calf' })
const HOP = ex({ id: 'hop', pattern: 'plyo', loadType: 'bodyweight', loadUnit: 'none', increment: 0 })
const STEP = ex({ id: 'step', loadType: 'step-height', loadUnit: 'in' })
const BIKE = ex({ id: 'bike', pattern: 'cardio' })
const PULL1 = ex({ id: 'row', pattern: 'pull' })
const PULL2 = ex({ id: 'pulldown', pattern: 'pull' })
const PUSH1 = ex({ id: 'bench', pattern: 'push' })
const CATALOG = new Map([SQUAT, PRESS, LUNGE, CALF, HOP, STEP, BIKE, PULL1, PULL2, PUSH1].map((e) => [e.id, e]))

const A = template('p1-a', 'A', [slot('a1', 'squat', { order: 1 }), slot('a2', 'press', { order: 2 })])
const B = template('p1-b', 'B', [
  slot('b1', 'squat', { order: 1, label: '1' }),
  slot('b2', 'lunge', { order: 2, label: '2' }),
  slot('b3', 'hop', { order: 3, label: '3' }),
  slot('b4', 'calf', { order: 4, label: '4', optional: true }),
  slot('b5', 'step', { order: 5, label: '5' }),
])
const C = template('p1-c', 'C', [slot('c1', 'bike', { order: 1 }), slot('c2', 'calf', { order: 2, label: '2' }), slot('c3', 'lunge', { order: 3 })])
const OTHER_PHASE = template('p2-b', 'B', [slot('q1', 'calf', { order: 1 })], 2)
const TEMPLATES = [A, B, C, OTHER_PHASE]
const pool = (t: SessionTemplate, templates = TEMPLATES, phaseWeek = 1) => extensionPool({ template: t, templates, phaseWeek, catalog: CATALOG })

describe('extensionPool', () => {
  it('takes the other sessions’ exercises first, the next session first, then upper-body work with pulls and pushes taking turns', () => {
    expect(pool(A).map((s) => s.exerciseId)).toEqual(['lunge', 'calf', 'row', 'bench', 'pulldown'])
  })

  it('reads B then C for A, C then A for B, and A then B for C', () => {
    // B already runs squat, lunge, hop, calf and step, so C offers nothing new (bike is cardio) and A offers its press; upper body follows.
    expect(pool(B).map((s) => s.id).slice(0, 3)).toEqual(['extra-a2', 'extra-row', 'extra-bench'])
    // C already runs bike, calf and lunge: A offers squat and press, B's duplicates, jump, optional and step-height work are passed over.
    expect(pool(C).map((s) => s.id).slice(0, 3)).toEqual(['extra-a1', 'extra-a2', 'extra-row'])
  })

  it('leaves out an exercise the session already runs, jumping and landing work, step-height work, cardio, and optional slots', () => {
    const ids = pool(A).map((s) => s.exerciseId)
    for (const gone of ['squat', 'press', 'hop', 'step', 'bike']) expect(ids).not.toContain(gone)
    // b4 is the same exercise as c2 (calf) and optional: the optional one is skipped, the other session's slot is taken.
    expect(pool(A).filter((s) => s.exerciseId === 'calf').map((s) => s.id)).toEqual([`${EXTRA_PREFIX}c2`])
  })

  it('offers each exercise once, and never reads another phase’s sessions', () => {
    const ids = pool(A).map((s) => s.exerciseId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(pool(A, [A, OTHER_PHASE]).map((s) => s.exerciseId)).toEqual(['row', 'bench', 'pulldown'])
  })

  it('carries the other session’s prescription and rule, as it writes it, under an id and a label of its own, free of a superset or a week band', () => {
    const grouped = template('p1-b', 'B', [slot('b1', 'lunge', { order: 1, groupId: 'g', phaseWeeks: [1, null], progressionRule: 'fixed', sets: 2, cues: ['Hips square'] })])
    const [first] = pool(A, [A, grouped])
    expect(first).toMatchObject({ id: 'extra-b1', label: '+B1', exerciseId: 'lunge', sets: 2, progressionRule: 'fixed', cues: ['Hips square'], substitutionIds: ['sub'], optional: false })
    expect(first).not.toHaveProperty('groupId')
    expect(first).not.toHaveProperty('phaseWeeks')
  })

  it('leaves out a slot the phase week has not reached', () => {
    const banded = template('p1-b', 'B', [slot('b1', 'lunge', { order: 1, phaseWeeks: [3, null] })])
    expect(pool(A, [A, banded], 1).map((s) => s.exerciseId)).not.toContain('lunge')
    expect(pool(A, [A, banded], 3).map((s) => s.exerciseId)).toContain('lunge')
  })

  it('numbers the slots after the session’s own, and makes upper-body slots 3 × 8–12 that pass the program’s own schema', () => {
    const slots = pool(A)
    expect(slots.map((s) => s.order)).toEqual([3, 4, 5, 6, 7])
    const upper = slots.filter((s) => s.id.startsWith('extra-') && ['row', 'bench', 'pulldown'].includes(s.exerciseId))
    expect(upper.map((s) => s.label)).toEqual(['+U1', '+U2', '+U3'])
    expect(upper[0]).toMatchObject({ sets: 3, repsMin: 8, repsMax: 12, progressionRule: 'double-progression', optional: false })
  })

  it('is the same every time, and tells its ids from program.md’s and Shawn’s own', () => {
    expect(pool(A)).toEqual(pool(A))
    expect(isExtraSlotId('extra-b1')).toBe(true)
    expect(isExtraSlotId('added-k1')).toBe(false)
    expect(isExtraSlotId('p1a-1')).toBe(false)
    expect(EXTENSION_MAX).toBe(6)
  })

  it('after program.md’s pulls and pushes, the accessory catalog: the upper tier taking turns, then core, each with its own defaults, cues and substitutions (PROGRAM-QUESTIONS 170)', () => {
    const acc = (id: string, pattern: Exercise['pattern'], tier: 'upper' | 'core', over: Partial<Exercise> = {}) =>
      ex({ id, pattern, accessory: { tier, sets: 2, repsMin: 10, repsMax: 15, cues: [`${id} cue`], substitutionIds: ['row'] }, ...over })
    // Catalog order mixes them on purpose: the passes, not the order of the file, decide.
    const CRUNCH = acc('crunch', 'core', 'core')
    const CURL = acc('curl', 'pull', 'upper')
    const RAISE = acc('raise', 'push', 'upper')
    const SHRUG = acc('shrug', 'pull', 'upper')
    const HOLD = acc('hold', 'core', 'core', { accessory: { tier: 'core', repUnit: 'seconds', sets: 3, repsMin: 30, repsMax: 45, cues: ['Stand tall.'], substitutionIds: [] } })
    const PLANK = ex({ id: 'plank', pattern: 'core', loadType: 'time' })
    const catalog = new Map([CRUNCH, ...CATALOG.values(), CURL, RAISE, SHRUG, HOLD, PLANK].map((e) => [e.id, e]))
    const slots = extensionPool({ template: A, templates: TEMPLATES, phaseWeek: 1, catalog })
    expect(slots.map((s) => s.exerciseId)).toEqual(['lunge', 'calf', 'row', 'bench', 'pulldown', 'curl', 'raise', 'shrug', 'crunch', 'hold'])
    expect(slots.filter((s) => s.label.startsWith('+U')).map((s) => s.label)).toEqual(['+U1', '+U2', '+U3', '+U4', '+U5', '+U6', '+U7', '+U8'])
    // A core exercise program.md writes (no accessory) is not upper-body work and is never offered here.
    expect(slots.map((s) => s.exerciseId)).not.toContain('plank')
    const curl = slots.find((s) => s.exerciseId === 'curl')
    expect(curl).toMatchObject({ id: 'extra-curl', sets: 2, repsMin: 10, repsMax: 15, cues: ['curl cue'], substitutionIds: ['row'], progressionRule: 'double-progression' })
    expect(slots.find((s) => s.exerciseId === 'hold')).toMatchObject({ repUnit: 'seconds', repsMin: 30, repsMax: 45, prescriptionText: '3 × 30–45 s' })
    // The session already running an accessory is never offered it again.
    const withCurl = template('p1-a', 'A', [...A.slots, slot('a3', 'curl', { order: 3 })])
    expect(extensionPool({ template: withCurl, templates: TEMPLATES, phaseWeek: 1, catalog }).map((s) => s.exerciseId)).not.toContain('curl')
  })
})
