import { describe, expect, it } from 'vitest'
import type { Exercise, SetLog, Slot } from '../schema/index.ts'
import { backOffLoad, backOffMoves, backOffStep, effectiveReading, nextSubstitution, prescribe, progressionNeedsRpe, WHOLE_KNEE_NOTE, type PrescriptionInput } from './prescription.ts'

const ex = (over: Partial<Exercise> = {}): Exercise => ({
  id: 'leg-press', name: 'Leg press', pattern: 'squat', equipment: 'seated leg press', loadType: 'stack', loadUnit: 'plate', increment: 1, loadDirection: 'up', unilateral: false, requires: [], ...over,
})
const slot = (over: Partial<Slot> = {}): Slot => ({
  id: 'p1a-1', order: 1, label: '1', exerciseId: 'leg-press', sets: 3, repsMin: 10, repsMax: 12, repUnit: 'reps', unilateral: false, injuredOnly: false,
  prescriptionText: '3 × 10–12', cues: [], progressionRule: 'double-progression', substitutionIds: [], optional: false, ...over,
})
const setLog = (setNumber: number, over: Partial<SetLog> = {}): SetLog => ({
  id: `s${setNumber}`, workoutId: 'w1', slotId: 'p1a-1', exerciseId: 'leg-press', setNumber, side: 'both', load: 8, loadUnit: 'plate', reps: 12, rpe: 7, painDuring: 2, stopped: false, ...over,
})
const threeSets = (over: Partial<SetLog> = {}) => [setLog(1, over), setLog(2, over), setLog(3, over)]

function input(over: Partial<PrescriptionInput> = {}): PrescriptionInput {
  return { slot: slot(), exercise: ex(), substitutions: [], readings: ['clean', 'clean'], lastSets: threeSets(), week: 2, injuredSide: 'right', dumbbellMax: 80, redFlagActive: false, ...over }
}
const one = (over: Partial<PrescriptionInput> = {}) => {
  const [p] = prescribe(input(over))
  if (!p) throw new Error('no prescription')
  return p
}

describe('effectiveReading', () => {
  it('reads the last two combined readings', () => {
    expect(effectiveReading([])).toBe('none')
    expect(effectiveReading(['clean'])).toBe('clean-once')
    expect(effectiveReading(['clean', 'clean'])).toBe('clean-twice')
    expect(effectiveReading(['clean', 'hold'])).toBe('clean-once')
    expect(effectiveReading(['hold', 'clean'])).toBe('hold')
    expect(effectiveReading(['back-off', 'clean'])).toBe('back-off')
  })
  it('two holds in a row read back-off (PROGRAM-QUESTIONS 4)', () => {
    expect(effectiveReading(['hold', 'hold'])).toBe('back-off')
  })
})

describe('worked examples', () => {
  it('leg press, Phase 1: 12, 12, 12 at RPE 7 with pain 2, clean twice and at repsMax: plus one plate, 3 × 10', () => {
    const p = one()
    expect(p).toMatchObject({ load: 9, repsTarget: 10, sets: 3, basis: 'progress-load', loadUnit: 'plate' })
  })
  it('step-up: 3 × 10 with 20 lb, clean twice at 6 in.: next is 8 in. at 20 lb', () => {
    const stepUp = ex({ id: 'step-up', loadType: 'step-height', loadUnit: 'in', increment: 2, heightIncrementIn: 2, holdsLoad: 'dumbbell-each', unilateral: true })
    const s = slot({ exerciseId: 'step-up', repsMin: 10, repsMax: 10, progressionRule: 'height-then-load', unilateral: true, heightIn: 6, heightMaxIn: 8, loadBeforeHeightLb: 20 })
    const sets = [...threeSets({ side: 'right', load: 20, loadUnit: 'lb', reps: 10, heightIn: 6 }), ...threeSets({ side: 'left', load: 20, loadUnit: 'lb', reps: 10, heightIn: 6 })]
    const [injured, healthy] = prescribe(input({ slot: s, exercise: stepUp, lastSets: sets }))
    expect(injured).toMatchObject({ side: 'right', heightIn: 8, load: 20, basis: 'progress-height' })
    expect(healthy).toMatchObject({ side: 'left', heightIn: 8, load: 20, budgetFromInjured: true })
  })
  it('week 4, a 3 × 10 slot: prescribed 2 × 10 at the same load', () => {
    const p = one({ week: 4, lastSets: threeSets({ reps: 10 }) })
    expect(p).toMatchObject({ sets: 2, load: 8, repsTarget: 10, basis: 'deload' })
    expect(p.perSet).toEqual([{ load: 8, reps: 10 }, { load: 8, reps: 10 }])
  })
})

describe('double progression', () => {
  it('clean twice but short of repsMax: same load, target repsMax', () => {
    expect(one({ lastSets: threeSets({ reps: 11 }) })).toMatchObject({ load: 8, repsTarget: 12, basis: 'progress-reps' })
  })
  it('clean twice at repsMax but over RPE 8 on one set: no load change yet', () => {
    expect(one({ lastSets: [setLog(1), setLog(2), setLog(3, { rpe: 9 })] })).toMatchObject({ load: 8, repsTarget: 12, basis: 'progress-reps' })
  })
  it('a missing RPE does not count as RPE 8 or under', () => {
    expect(one({ lastSets: threeSets({ rpe: undefined }) }).basis).toBe('progress-reps')
  })
  it('clean once: same load, same target', () => {
    expect(one({ readings: ['clean', 'hold'] })).toMatchObject({ load: 8, repsTarget: 12, basis: 'same' })
    expect(one({ readings: ['clean'], lastSets: threeSets({ reps: 10 }) })).toMatchObject({ load: 8, repsTarget: 10, basis: 'same' })
  })
  it('hold: repeat the last session exactly, set by set', () => {
    const p = one({ readings: ['hold'], lastSets: [setLog(1, { reps: 12 }), setLog(2, { reps: 11 }), setLog(3, { reps: 10 })] })
    expect(p.basis).toBe('repeat')
    expect(p.perSet).toEqual([{ load: 8, reps: 12 }, { load: 8, reps: 11 }, { load: 8, reps: 10 }])
  })
  it('no reading at all is treated as hold', () => {
    expect(one({ readings: [] }).basis).toBe('repeat')
  })
  it('back-off: load × 0.75 rounded down to the increment', () => {
    expect(one({ readings: ['back-off'] })).toMatchObject({ load: 6, basis: 'back-off' })
    expect(backOffLoad(35, 5)).toBe(25)
    expect(backOffLoad(40, 5)).toBe(30)
    expect(backOffLoad(8, 1)).toBe(6)
    expect(backOffLoad(90, 10)).toBe(60)
  })
  it('an assist stack moves the other way: less assist to progress, more to back off', () => {
    const pullUp = ex({ id: 'assisted-pull-up', loadDirection: 'down' })
    expect(one({ exercise: pullUp, lastSets: threeSets({ reps: 12 }) })).toMatchObject({ load: 7, basis: 'progress-load' })
    expect(one({ exercise: pullUp, readings: ['back-off'] })).toMatchObject({ load: 9, basis: 'back-off' })
  })
})

describe('first session, deload and red flag', () => {
  it('first time: no load to go on, start at repsMin', () => {
    expect(one({ lastSets: [], readings: [] })).toMatchObject({ load: null, repsTarget: 10, basis: 'first' })
  })
  it('first time on a bodyweight slot starts at 0', () => {
    expect(one({ lastSets: [], readings: [], exercise: ex({ loadType: 'bodyweight', loadUnit: 'none', increment: 0 }) }).load).toBe(0)
  })
  it('a new slot in a deload week runs its lightest version with deload sets (PROGRAM-QUESTIONS 8)', () => {
    expect(one({ lastSets: [], readings: [], week: 4 })).toMatchObject({ sets: 2, basis: 'first', load: 1 })
    expect(one({ lastSets: [], readings: [], week: 8, exercise: ex({ loadType: 'dumbbell-each', loadUnit: 'lb', increment: 5 }) }).load).toBe(5)
    expect(one({ lastSets: [], readings: [], week: 4, exercise: ex({ loadDirection: 'down' }) }).load).toBeNull()
    expect(one({ lastSets: [], readings: [], week: 5 }).load).toBeNull()
  })
  it('after a swap to a timed substitution the prescription counts seconds', () => {
    const wallSit = ex({ id: 'wall-sit', pattern: 'quad', loadType: 'time', loadUnit: 's', increment: 5 })
    const legExt = slot({ exerciseId: 'leg-extension', sets: 2, repsMin: 15, repsMax: 15, progressionRule: 'range-then-load', rangeStopDeg: 45 })
    const p = one({ slot: legExt, exercise: wallSit, lastSets: [], readings: [] })
    expect(p).toMatchObject({ repUnit: 'seconds', repsTarget: 30, load: 0 })
    expect(p.rangeStopDeg).toBeUndefined()
  })
  it('deload weeks skip progression even when clean twice at the top', () => {
    expect(one({ week: 8 })).toMatchObject({ sets: 2, load: 8, basis: 'deload' })
  })
  it('the red-flag state suspends progression', () => {
    expect(one({ redFlagActive: true })).toMatchObject({ load: 8, basis: 'suspended' })
  })
})

describe('height-then-load (PROGRAM-QUESTIONS 2)', () => {
  const stepUp = ex({ id: 'step-up', loadType: 'step-height', loadUnit: 'in', increment: 2, heightIncrementIn: 2, holdsLoad: 'dumbbell-each', unilateral: true })
  const s = slot({ exerciseId: 'step-up', repsMin: 10, repsMax: 10, progressionRule: 'height-then-load', unilateral: true, injuredOnly: true, heightIn: 6, heightMaxIn: 8, loadBeforeHeightLb: 20 })
  const sets = (load: number, heightIn: number) => threeSets({ side: 'right', load, loadUnit: 'lb', reps: 10, heightIn })
  it('load climbs to 20 lb before height moves', () => {
    expect(one({ slot: s, exercise: stepUp, lastSets: sets(0, 6) })).toMatchObject({ load: 5, heightIn: 6, basis: 'progress-load' })
    expect(one({ slot: s, exercise: stepUp, lastSets: sets(15, 6) })).toMatchObject({ load: 20, heightIn: 6, basis: 'progress-load' })
  })
  it('at the phase top height, load moves again', () => {
    expect(one({ slot: s, exercise: stepUp, lastSets: sets(20, 8) })).toMatchObject({ load: 25, heightIn: 8, basis: 'progress-load' })
  })
  it('back-off drops the height first, then the load, then the easier version', () => {
    expect(one({ slot: s, exercise: stepUp, readings: ['back-off'], lastSets: sets(20, 8) })).toMatchObject({ heightIn: 6, load: 20, basis: 'back-off' })
    expect(one({ slot: s, exercise: stepUp, readings: ['back-off'], lastSets: sets(20, 6) })).toMatchObject({ heightIn: 6, load: 15, basis: 'back-off' })
    const stair = ex({ id: 'step-up-stair', loadType: 'step-height', loadUnit: 'in', increment: 2 })
    expect(one({ slot: s, exercise: stepUp, substitutions: [stair], readings: ['back-off'], lastSets: sets(0, 6) })).toMatchObject({ exerciseId: 'step-up-stair', basis: 'back-off' })
  })
  it('a step-down with no load to add stays at the top height', () => {
    const stepDown = ex({ id: 'lateral-step-down', loadType: 'step-height', loadUnit: 'in', increment: 2, heightIncrementIn: 2, unilateral: true })
    const sd = slot({ exerciseId: 'lateral-step-down', repsMin: 8, repsMax: 8, progressionRule: 'height-then-load', unilateral: true, injuredOnly: true, heightIn: 6, heightMaxIn: 8 })
    expect(one({ slot: sd, exercise: stepDown, lastSets: threeSets({ side: 'right', load: 0, loadUnit: 'in', reps: 8, heightIn: 6, rpe: 6 }) })).toMatchObject({ heightIn: 8, basis: 'progress-height' })
    expect(one({ slot: sd, exercise: stepDown, lastSets: threeSets({ side: 'right', load: 0, loadUnit: 'in', reps: 8, heightIn: 8, rpe: 6 }) })).toMatchObject({ heightIn: 8, basis: 'at-top' })
  })
})

describe('range-then-load (PROGRAM-QUESTIONS 3)', () => {
  const legExt = ex({ id: 'leg-extension', pattern: 'quad' })
  const phase2 = slot({ exerciseId: 'leg-extension', sets: 2, repsMin: 12, repsMax: 15, progressionRule: 'range-then-load', rangeStopDeg: 30 })
  it('moves the range stop to the phase stop before loading', () => {
    const p = one({ slot: phase2, exercise: legExt, lastSets: [setLog(1, { reps: 15, rangeStopDeg: 45, load: 5 }), setLog(2, { reps: 15, rangeStopDeg: 45, load: 5 })] })
    expect(p).toMatchObject({ rangeStopDeg: 30, load: 5, repsTarget: 12, basis: 'progress-range' })
  })
  it('loads once the range sits at the phase stop', () => {
    const p = one({ slot: phase2, exercise: legExt, lastSets: [setLog(1, { reps: 15, rangeStopDeg: 30, load: 5 }), setLog(2, { reps: 15, rangeStopDeg: 30, load: 5 })] })
    expect(p).toMatchObject({ rangeStopDeg: 30, load: 6, basis: 'progress-load' })
  })
})

describe('stage and time rules', () => {
  const balance = ex({ id: 'single-leg-balance', pattern: 'balance', loadType: 'time', loadUnit: 's', increment: 5, unilateral: true, stages: ['eyes open', 'eyes closed', 'on a folded mat'] })
  const bal = slot({ exerciseId: 'single-leg-balance', repsMin: 30, repsMax: 30, repUnit: 'seconds', progressionRule: 'stage', unilateral: true, injuredOnly: true })
  const holds = (stage: number, seconds = 30) => threeSets({ side: 'right', load: 0, loadUnit: 's', reps: undefined, seconds, stage, rpe: undefined })
  it('clean twice at the full hold moves up a stage; back-off moves down one', () => {
    expect(one({ slot: bal, exercise: balance, lastSets: holds(0) })).toMatchObject({ stage: 1, basis: 'progress-stage' })
    expect(one({ slot: bal, exercise: balance, lastSets: holds(2) })).toMatchObject({ stage: 2, basis: 'at-top' })
    expect(one({ slot: bal, exercise: balance, readings: ['back-off'], lastSets: holds(2) })).toMatchObject({ stage: 1, basis: 'back-off' })
    expect(one({ slot: bal, exercise: balance, lastSets: holds(0, 20) })).toMatchObject({ stage: 0, repsTarget: 30, basis: 'progress-reps' })
  })
  it('timed holds climb to the top of their range, then wait for the next phase (PROGRAM-QUESTIONS 45)', () => {
    const plank = ex({ id: 'copenhagen-plank-short', pattern: 'hip', loadType: 'time', loadUnit: 's', increment: 5, unilateral: true })
    const cp = slot({ exerciseId: 'copenhagen-plank-short', repsMin: 15, repsMax: 20, repUnit: 'seconds', progressionRule: 'time', unilateral: true, injuredOnly: true })
    const held = (seconds: number) => threeSets({ side: 'right', load: 0, loadUnit: 's', reps: undefined, seconds, rpe: undefined })
    expect(one({ slot: cp, exercise: plank, lastSets: held(15) })).toMatchObject({ repsTarget: 20, basis: 'progress-reps' })
    expect(one({ slot: cp, exercise: plank, lastSets: held(20) })).toMatchObject({ repsTarget: 20, basis: 'at-top' })
    expect(one({ slot: cp, exercise: plank, readings: ['back-off'], lastSets: held(20) })).toMatchObject({ repsTarget: 15, basis: 'back-off' })
  })
})

describe('bodyweight back-offs and the dumbbell cap', () => {
  it('a bodyweight exercise backs off to its first substitution', () => {
    const nordic = ex({ id: 'nordic-negatives', pattern: 'hamstring', loadType: 'bodyweight', loadUnit: 'none', increment: 0 })
    const curl = ex({ id: 'single-leg-seated-leg-curl', pattern: 'hamstring', unilateral: true })
    const s = slot({ exerciseId: 'nordic-negatives', repsMin: 3, repsMax: 5, progressionRule: 'fixed' })
    expect(one({ slot: s, exercise: nordic, substitutions: [curl], readings: ['back-off'], lastSets: threeSets({ load: 0, loadUnit: 'none', reps: 4 }) })).toMatchObject({ exerciseId: 'single-leg-seated-leg-curl', basis: 'back-off' })
  })
  it('with nothing lighter written, a back-off cuts a set', () => {
    const pogo = ex({ id: 'pogo-hops', pattern: 'plyo', loadType: 'time', loadUnit: 's', increment: 5 })
    const s = slot({ exerciseId: 'pogo-hops', repsMin: 15, repsMax: 15, repUnit: 'seconds', progressionRule: 'fixed' })
    expect(one({ slot: s, exercise: pogo, readings: ['back-off'], lastSets: threeSets({ load: 0, loadUnit: 's', reps: undefined, seconds: 15 }) })).toMatchObject({ sets: 2, basis: 'back-off' })
  })
  it('a dumbbell load past the rack turns into the next substitution (PROGRAM-QUESTIONS 9)', () => {
    const rdl = ex({ id: 'db-rdl', pattern: 'hinge', loadType: 'dumbbell-each', loadUnit: 'lb', increment: 5 })
    const slRdl = ex({ id: 'single-leg-rdl', pattern: 'hinge', loadType: 'dumbbell-single', loadUnit: 'lb', increment: 5, unilateral: true })
    const s = slot({ exerciseId: 'db-rdl', repsMin: 10, repsMax: 10 })
    const p = one({ slot: s, exercise: rdl, substitutions: [slRdl], lastSets: threeSets({ load: 80, loadUnit: 'lb', reps: 10 }) })
    expect(p).toMatchObject({ exerciseId: 'single-leg-rdl', load: null, basis: 'progress-load' })
    expect(one({ slot: s, exercise: rdl, substitutions: [slRdl], lastSets: threeSets({ load: 70, loadUnit: 'lb', reps: 10 }) })).toMatchObject({ exerciseId: 'db-rdl', load: 75 })
  })
})

describe('sides', () => {
  it('unilateral slots get the injured side first and the healthy side on its budget', () => {
    const bss = ex({ id: 'bulgarian-split-squat', loadType: 'dumbbell-each', loadUnit: 'lb', increment: 5, unilateral: true })
    const s = slot({ exerciseId: 'bulgarian-split-squat', repsMin: 8, repsMax: 8, unilateral: true })
    const sets = [...threeSets({ side: 'right', load: 20, loadUnit: 'lb', reps: 8 }), ...threeSets({ side: 'left', load: 25, loadUnit: 'lb', reps: 8 })]
    const [a, b] = prescribe(input({ slot: s, exercise: bss, lastSets: sets, injuredSide: 'right' }))
    expect(a).toMatchObject({ side: 'right', load: 25, repsTarget: 8 })
    expect(b).toMatchObject({ side: 'left', load: 30, repsTarget: 8, budgetFromInjured: true })
  })
  it('bilateral slots prescribe once, for both', () => {
    expect(prescribe(input()).map((p) => p.side)).toEqual(['both'])
  })
})

describe('progressionNeedsRpe', () => {
  it('is true for the load rules only', () => {
    expect(progressionNeedsRpe({ progressionRule: 'double-progression' })).toBe(true)
    expect(progressionNeedsRpe({ progressionRule: 'height-then-load' })).toBe(true)
    expect(progressionNeedsRpe({ progressionRule: 'range-then-load' })).toBe(true)
    expect(progressionNeedsRpe({ progressionRule: 'stage' })).toBe(false)
    expect(progressionNeedsRpe({ progressionRule: 'time' })).toBe(false)
    expect(progressionNeedsRpe({ progressionRule: 'fixed' })).toBe(false)
  })
})

describe('the next easier version is the one after the current exercise', () => {
  const own = ex({ id: 'single-leg-hip-thrust', pattern: 'hip', loadType: 'bodyweight', loadUnit: 'none', increment: 0, unilateral: true })
  const smith = ex({ id: 'smith-hip-thrust', pattern: 'hip', loadType: 'smith-plates', loadUnit: 'lb', increment: 10 })
  const db = ex({ id: 'db-hip-thrust', pattern: 'hip', loadType: 'dumbbell-single', loadUnit: 'lb', increment: 5 })
  const s = slot({ exerciseId: 'single-leg-hip-thrust', repsMin: 10, repsMax: 10, progressionRule: 'fixed', substitutionIds: ['smith-hip-thrust', 'db-hip-thrust'] })
  it('a back-off on a bodyweight substitution moves to the one after it, never to itself', () => {
    const band = ex({ id: 'lateral-band-walk', pattern: 'hip', loadType: 'band', loadUnit: 'none', increment: 0 })
    const cable = ex({ id: 'cable-hip-abduction', pattern: 'hip', unilateral: true })
    const abd = slot({ exerciseId: 'hip-abductor-machine', progressionRule: 'fixed', substitutionIds: ['cable-hip-abduction', 'lateral-band-walk', 'copenhagen-plank-short'] })
    const plank = ex({ id: 'copenhagen-plank-short', pattern: 'hip', loadType: 'time', loadUnit: 's', increment: 5, unilateral: true })
    const p = one({ slot: abd, exercise: band, substitutions: [cable, band, plank], readings: ['back-off'], lastSets: threeSets({ exerciseId: 'lateral-band-walk', load: 0, loadUnit: 'none', reps: 12 }) })
    expect(p.exerciseId).toBe('copenhagen-plank-short')
  })
  it('the slot’s own bodyweight exercise backs off to the first substitution', () => {
    expect(one({ slot: s, exercise: own, substitutions: [smith, db], readings: ['back-off'], lastSets: threeSets({ load: 0, loadUnit: 'none', reps: 10 }) }).exerciseId).toBe('smith-hip-thrust')
  })
  it('the dumbbell cap on a substitution moves on, not back to itself', () => {
    const rdl = ex({ id: 'db-rdl', pattern: 'hinge', loadType: 'dumbbell-each', loadUnit: 'lb', increment: 5 })
    const slRdl = ex({ id: 'single-leg-rdl', pattern: 'hinge', loadType: 'dumbbell-single', loadUnit: 'lb', increment: 5, unilateral: true })
    const smithRdl = ex({ id: 'smith-rdl', pattern: 'hinge', loadType: 'smith-plates', loadUnit: 'lb', increment: 10 })
    const sl = slot({ exerciseId: 'single-leg-rdl', repsMin: 8, repsMax: 8, unilateral: false, substitutionIds: ['db-rdl', 'smith-rdl'] })
    // Phase 2 C2: single-leg RDL's substitutions are DB RDL then Smith RDL; on DB RDL at the rack's top, the next is Smith RDL.
    const p = one({ slot: sl, exercise: rdl, substitutions: [rdl, smithRdl], lastSets: threeSets({ exerciseId: 'db-rdl', load: 80, loadUnit: 'lb', reps: 8 }) })
    expect(p.exerciseId).toBe('smith-rdl')
    void slRdl
  })
})

describe('nextSubstitution', () => {
  const a = ex({ id: 'a' })
  const b = ex({ id: 'b' })
  it('is the first substitution from the slot’s own exercise, the next one from a substitution, none from the last', () => {
    expect(nextSubstitution({ id: 'own' }, [a, b])?.id).toBe('a')
    expect(nextSubstitution({ id: 'a' }, [a, b])?.id).toBe('b')
    expect(nextSubstitution({ id: 'b' }, [a, b])).toBeUndefined()
  })
})

describe('where you train (M4b): moves go forward on the slot’s list, to what is here', () => {
  // Inline copies of the seed's shapes: Phase 1 C1 (step-up), Phase 1 C2 (DB RDL), Phase 2 A7 (balance).
  const gym = (dumbbellMaxLb: number, ...items: string[]) => ({ available: new Set([...items, ...(dumbbellMaxLb > 0 ? ['dumbbells'] : [])]), dumbbellMaxLb })
  const dbRdl = ex({ id: 'db-rdl', name: 'Dumbbell Romanian deadlift', pattern: 'hinge', loadType: 'dumbbell-each', loadUnit: 'lb', increment: 5, requires: ['dumbbells'] })
  const slRdl = ex({ id: 'single-leg-rdl', name: 'Single-leg RDL', pattern: 'hinge', loadType: 'dumbbell-single', loadUnit: 'lb', increment: 5, unilateral: true, requires: ['dumbbells'] })
  const smithRdl = ex({ id: 'smith-rdl', name: 'Smith machine RDL', pattern: 'hinge', loadType: 'smith-plates', loadUnit: 'lb', increment: 10, requires: ['smith-machine'] })
  const p1c2 = slot({ id: 'p1c-2', exerciseId: 'db-rdl', repsMin: 10, repsMax: 10, rpeTarget: 7, substitutionIds: ['single-leg-rdl', 'smith-rdl'] })
  const rdl = (over: Partial<PrescriptionInput>) => one({ slot: p1c2, exercise: dbRdl, substitutions: [slRdl, smithRdl], ...over })
  const rdlSets = (exerciseId: string, load: number) => threeSets({ exerciseId, load, loadUnit: 'lb', reps: 10 })

  describe('the rack', () => {
    it('a swapped single-leg RDL over the rack goes to the Smith RDL, not itself', () => {
      const p = rdl({ exercise: slRdl, lastSets: rdlSets('single-leg-rdl', 80), gym: gym(80, 'smith-machine') })
      expect(p).toMatchObject({ exerciseId: 'smith-rdl', load: null, loadUnit: 'lb', repsTarget: 10, basis: 'progress-load' })
      expect(p.note).toBe('Clean twice at the top of the range: load up one step (5 lb), back to 10 reps. That is past the rack’s 80 lb dumbbells: swap to Smith machine RDL. First time: pick a load that lands at RPE 7 and start at 10 reps.')
      expect(rdl({ exercise: slRdl, readings: ['hold'], lastSets: rdlSets('single-leg-rdl', 30), gym: gym(25, 'smith-machine') }).exerciseId).toBe('smith-rdl')
    })

    it('a 60 lb hold at a 25 lb rack falls to the next fallback that is here', () => {
      const p = rdl({ readings: ['hold'], lastSets: rdlSets('db-rdl', 60), gym: gym(25, 'smith-machine') })
      expect(p).toMatchObject({ exerciseId: 'single-leg-rdl', load: null, basis: 'repeat' })
      expect(p.perSet).toBeUndefined()
      expect(p.rackCapped).toBeUndefined()
      expect(p.note).toBe('Hold: repeat the last session’s loads and reps exactly. That is past the rack’s 25 lb dumbbells: swap to Single-leg RDL. First time: pick a load that lands at RPE 7 and start at 10 reps.')
      // The same hold at Settings' 80 lb rack, with no gym given, repeats 60 lb as before.
      expect(rdl({ readings: ['hold'], lastSets: rdlSets('db-rdl', 60) })).toMatchObject({ exerciseId: 'db-rdl', load: 60, basis: 'repeat' })
    })

    it('a move past the rack says so on the prescription, so Today and Swap can name it; a back-off’s move does not', () => {
      expect(rdl({ readings: ['hold'], lastSets: rdlSets('db-rdl', 60), gym: gym(25, 'smith-machine') }).rackMoved).toBe(true)
      expect(rdl({ week: 4, lastSets: rdlSets('db-rdl', 60), gym: gym(3, 'smith-machine') }).rackMoved).toBe(true)
      expect(rdl({ readings: ['hold'], lastSets: rdlSets('db-rdl', 60), gym: gym(80, 'smith-machine') }).rackMoved).toBeUndefined()
      expect(rdl({ exercise: slRdl, readings: ['hold'], lastSets: rdlSets('single-leg-rdl', 30), gym: gym(25) }).rackMoved).toBeUndefined()
    })

    it('the cap reads every basis: a deload week at a lighter rack moves too, at the lightest version', () => {
      const deload = rdl({ week: 4, lastSets: rdlSets('db-rdl', 60), gym: gym(25, 'smith-machine') })
      expect(deload).toMatchObject({ exerciseId: 'single-leg-rdl', load: 5, sets: 2, basis: 'deload' })
      // The moved prescription keeps its own note: why the slot moved, then how the exercise moved to starts.
      expect(deload.note).toBe(
        'Deload week: 2 sets instead of 3, same loads and reps, no progression. That is past the rack’s 25 lb dumbbells: swap to Single-leg RDL. First time in a deload week: the lightest version, 2 sets, perfect reps.',
      )
      const same = rdl({ readings: ['clean'], lastSets: rdlSets('db-rdl', 30), gym: gym(25) })
      expect(same).toMatchObject({ exerciseId: 'single-leg-rdl', basis: 'same' })
      expect(same.note).toBe('Clean once: same load, same target; clean again to progress. That is past the rack’s 25 lb dumbbells: swap to Single-leg RDL. First time: pick a load that lands at RPE 7 and start at 10 reps.')
    })

    it('where a move lands meets the rack too: a lightest version past a rack typed as 3 lb moves on, or is rack-capped', () => {
      const moved = rdl({ week: 4, lastSets: rdlSets('db-rdl', 60), gym: gym(3, 'smith-machine') })
      expect(moved).toMatchObject({ exerciseId: 'smith-rdl', load: 10, sets: 2, basis: 'deload' })
      expect(moved.rackCapped).toBeUndefined()
      expect(moved.note).toBe(
        'Deload week: 2 sets instead of 3, same loads and reps, no progression. That is past the rack’s 3 lb dumbbells: swap to Single-leg RDL. First time in a deload week: the lightest version, 2 sets, perfect reps. That is past the rack’s 3 lb dumbbells: swap to Smith machine RDL. First time in a deload week: the lightest version, 2 sets, perfect reps.',
      )
      const capped = rdl({ week: 4, lastSets: rdlSets('db-rdl', 60), gym: gym(3) })
      expect(capped).toMatchObject({ exerciseId: 'single-leg-rdl', load: 3, rackCapped: true, basis: 'deload' })
    })

    it('with no fallback here, the rack max is prescribed, rack-capped, and the note says so', () => {
      const p = rdl({ exercise: slRdl, readings: ['hold'], lastSets: [...rdlSets('single-leg-rdl', 30).slice(0, 2), setLog(3, { exerciseId: 'single-leg-rdl', load: 20, loadUnit: 'lb', reps: 10 })], gym: gym(25) })
      expect(p).toMatchObject({ exerciseId: 'single-leg-rdl', load: 25, rackCapped: true, basis: 'repeat' })
      expect(p.perSet).toEqual([{ load: 25, reps: 10 }, { load: 25, reps: 10 }, { load: 20, reps: 10 }])
      expect(p.note).toBe('Hold: repeat the last session’s loads and reps exactly. The rack stops at 25 lb and nothing written to swap to is here: 25 lb, rack-capped, so the session won’t count as clean.')
    })

    it('ascending sets past the rack: only the sets past it come down; the lighter first set stays where it was', () => {
      const ascending = [10, 25, 30].map((load, i) => setLog(i + 1, { exerciseId: 'single-leg-rdl', load, loadUnit: 'lb', reps: 10 }))
      const p = rdl({ exercise: slRdl, readings: ['hold'], lastSets: ascending, gym: gym(25) })
      expect(p).toMatchObject({ exerciseId: 'single-leg-rdl', load: 10, rackCapped: true, basis: 'repeat' })
      expect(p.perSet).toEqual([{ load: 10, reps: 10 }, { load: 25, reps: 10 }, { load: 25, reps: 10 }])
    })

    it('with nothing written to swap to, the rack max is rack-capped at Settings’ rack too', () => {
      const s = slot({ exerciseId: 'db-rdl', repsMin: 10, repsMax: 10 })
      const p = one({ slot: s, exercise: dbRdl, lastSets: rdlSets('db-rdl', 80) })
      expect(p).toMatchObject({ exerciseId: 'db-rdl', load: 80, rackCapped: true, basis: 'progress-load' })
      expect(p.note).toBe('Clean twice at the top of the range: load up one step (5 lb), back to 10 reps. The rack stops at 80 lb and nothing is written to swap to: 80 lb, rack-capped, so the session won’t count as clean.')
      expect(one({ slot: s, exercise: dbRdl, lastSets: rdlSets('db-rdl', 70) }).rackCapped).toBeUndefined()
    })

    it('a unilateral slot moves as one when either side is past the rack', () => {
      const bss = ex({ id: 'bulgarian-split-squat', name: 'Bulgarian split squat', loadType: 'dumbbell-each', loadUnit: 'lb', increment: 5, unilateral: true, requires: ['flat-bench'] })
      const split = ex({ id: 'split-squat', name: 'Split squat', loadType: 'dumbbell-each', loadUnit: 'lb', increment: 5, unilateral: true, requires: [] })
      const s = slot({ exerciseId: 'bulgarian-split-squat', repsMin: 8, repsMax: 8, unilateral: true, substitutionIds: ['split-squat'] })
      const sets = [...threeSets({ side: 'right', load: 25, loadUnit: 'lb', reps: 8 }), ...threeSets({ side: 'left', load: 30, loadUnit: 'lb', reps: 8 })]
      const [injured, healthy] = prescribe(input({ slot: s, exercise: bss, substitutions: [split], readings: ['hold'], lastSets: sets, gym: gym(25, 'flat-bench') }))
      expect(injured).toMatchObject({ side: 'right', exerciseId: 'split-squat', load: null })
      expect(injured?.note).toBe('Hold: repeat the last session’s loads and reps exactly. The other side is past the rack’s 25 lb dumbbells, so the slot swaps to Split squat. First time: pick a load and start at 8 reps.')
      expect(healthy).toMatchObject({ side: 'left', exerciseId: 'split-squat', load: null, budgetFromInjured: true })
      expect(healthy?.note).toBe('Hold: repeat the last session’s loads and reps exactly. That is past the rack’s 25 lb dumbbells: swap to Split squat. First time: pick a load and start at 8 reps.')
    })

    it('no gym given reads as everything here at Settings’ rack', () => {
      const cases: Partial<PrescriptionInput>[] = [
        { lastSets: rdlSets('db-rdl', 80) },
        { exercise: slRdl, lastSets: rdlSets('single-leg-rdl', 80) },
        { readings: ['back-off'], lastSets: rdlSets('db-rdl', 60) },
        { readings: ['hold'], lastSets: rdlSets('db-rdl', 60) },
      ]
      for (const c of cases) expect(rdl({ ...c, gym: gym(80, 'smith-machine') })).toEqual(rdl(c))
    })
  })

  describe('bodyweight back-offs', () => {
    const stepUp = ex({ id: 'step-up', name: 'Step-up', pattern: 'single-leg', loadType: 'step-height', loadUnit: 'in', increment: 2, heightIncrementIn: 2, holdsLoad: 'dumbbell-each', unilateral: true, requires: ['step-platforms'] })
    const stair = ex({ id: 'step-up-stair', name: 'Step-up on the lowest stair in the club', pattern: 'single-leg', loadType: 'step-height', loadUnit: 'in', increment: 2, heightIncrementIn: 2, holdsLoad: 'dumbbell-each', unilateral: true, requires: ['stair'] })
    const split = ex({ id: 'split-squat', name: 'Split squat', pattern: 'single-leg', loadType: 'dumbbell-each', loadUnit: 'lb', increment: 5, unilateral: true, requires: [] })
    const p1c1 = slot({ id: 'p1c-1', exerciseId: 'step-up', repsMin: 10, repsMax: 10, rpeTarget: 6, progressionRule: 'height-then-load', unilateral: true, heightIn: 6, heightMaxIn: 8, loadBeforeHeightLb: 20, substitutionIds: ['step-up-stair', 'split-squat'] })
    const bodyweight = (exerciseId: string) => [...threeSets({ exerciseId, side: 'right', load: 0, loadUnit: 'lb', reps: 10, heightIn: 6 }), ...threeSets({ exerciseId, side: 'left', load: 0, loadUnit: 'lb', reps: 10, heightIn: 6 })]
    const backOff = (exercise: Exercise, available: string[]) =>
      prescribe(input({ slot: p1c1, exercise, substitutions: [stair, split], readings: ['back-off'], lastSets: bodyweight(exercise.id), gym: gym(80, ...available) }))

    it('a back-off from the stair step-up, at a gym with no step platforms, goes forward to the split squat, never back to the step-up', () => {
      const out = backOff(stair, ['stair'])
      expect(out.map((p) => p.exerciseId)).toEqual(['split-squat', 'split-squat'])
      expect(out[0]).toMatchObject({ side: 'right', basis: 'back-off', loadUnit: 'lb', load: null, repsTarget: 10, note: 'Back off: the easier version, Split squat.' })
      // A split squat has no step: the stair's height doesn't follow it.
      expect(out[0]?.heightIn).toBeUndefined()
    })

    it('a back-off from the step-up with no stair passes over the stair to the split squat', () => {
      expect(backOff(stepUp, ['step-platforms']).map((p) => p.exerciseId)).toEqual(['split-squat', 'split-squat'])
      expect(backOff(stepUp, ['step-platforms', 'stair']).map((p) => p.exerciseId)).toEqual(['step-up-stair', 'step-up-stair'])
    })

    it('with nothing lighter here, a back-off cuts a set and says nothing on the list is here', () => {
      const curl = ex({ id: 'single-leg-seated-leg-curl', name: 'Single-leg seated leg curl', pattern: 'hamstring', requires: ['seated-leg-curl'] })
      const nordic = ex({ id: 'nordic-negatives', pattern: 'hamstring', loadType: 'bodyweight', loadUnit: 'none', increment: 0, requires: ['mats'] })
      const s = slot({ exerciseId: 'nordic-negatives', repsMin: 3, repsMax: 5, progressionRule: 'fixed', substitutionIds: ['single-leg-seated-leg-curl'] })
      const p = one({ slot: s, exercise: nordic, substitutions: [curl], readings: ['back-off'], lastSets: threeSets({ exerciseId: 'nordic-negatives', load: 0, loadUnit: 'none', reps: 4 }), gym: gym(80, 'mats') })
      expect(p).toMatchObject({ exerciseId: 'nordic-negatives', sets: 2, basis: 'back-off', note: 'Back off: 2 sets instead of 3; nothing lighter on the list is here.' })
    })
  })

  describe('the stage ceiling', () => {
    const bosuLadder = ['folded mat', 'folded mat, slow head turns', 'folded mat, eyes closed', 'bosu', 'bosu, slow head turns', 'bosu, eyes closed']
    const matOrBosu = ex({
      id: 'balance-mat-bosu', name: 'Balance on a folded mat or bosu', pattern: 'balance', loadType: 'time', loadUnit: 's', increment: 5, unilateral: true,
      requires: [{ anyOf: ['mats', 'bosu'] }], stages: bosuLadder, stageRequires: [['mats'], ['mats'], ['mats'], ['bosu'], ['bosu'], ['bosu']],
    })
    const singleLeg = ex({
      id: 'single-leg-balance', name: 'Single-leg balance', pattern: 'balance', loadType: 'time', loadUnit: 's', increment: 5, unilateral: true,
      requires: [], stages: ['eyes open', 'eyes closed', 'on a folded mat'], stageRequires: [[], [], ['mats']],
    })
    const p2a7 = slot({ id: 'p2a-7', exerciseId: 'balance-mat-bosu', repsMin: 30, repsMax: 30, repUnit: 'seconds', progressionRule: 'stage', unilateral: true, injuredOnly: true, substitutionIds: ['single-leg-balance'] })
    const holds = (exerciseId: string, stage: number) => threeSets({ exerciseId, side: 'right', load: 0, loadUnit: 's', reps: undefined, seconds: 30, stage, rpe: undefined })
    const balance = (over: Partial<PrescriptionInput>) => one({ slot: p2a7, exercise: matOrBosu, substitutions: [singleLeg], ...over })

    it('stops the ladder at the last stage the gym supports', () => {
      expect(balance({ lastSets: holds('balance-mat-bosu', 2), gym: gym(80, 'mats') })).toMatchObject({ stage: 2, basis: 'at-top', note: 'Bosu isn’t marked here; staying at folded mat, eyes closed.' })
      const named = balance({ lastSets: holds('balance-mat-bosu', 2), gym: { ...gym(80, 'mats'), names: new Map([['bosu', 'Bosu or balance pad']]) } })
      expect(named.note).toBe('Bosu or balance pad isn’t marked here; staying at folded mat, eyes closed.')
      expect(balance({ lastSets: holds('balance-mat-bosu', 1), gym: gym(80, 'mats') })).toMatchObject({ stage: 2, basis: 'progress-stage' })
      expect(balance({ lastSets: holds('balance-mat-bosu', 2), gym: gym(80, 'mats', 'bosu') })).toMatchObject({ stage: 3, basis: 'progress-stage' })
      expect(balance({ lastSets: holds('balance-mat-bosu', 2) })).toMatchObject({ stage: 3, basis: 'progress-stage' })
    })

    it('brings a ladder from a gym with a bosu back down to the top stage here, on every basis', () => {
      expect(balance({ readings: ['hold'], lastSets: holds('balance-mat-bosu', 4), gym: gym(80, 'mats') })).toMatchObject({
        stage: 2, basis: 'repeat', note: 'Hold: repeat the last session’s loads and reps exactly. Bosu isn’t marked here; back to folded mat, eyes closed.',
      })
      expect(balance({ readings: ['back-off'], lastSets: holds('balance-mat-bosu', 5), gym: gym(80, 'mats') })).toMatchObject({ stage: 2, basis: 'back-off', note: 'Back off: Bosu isn’t marked here; back to folded mat, eyes closed.' })
      expect(balance({ readings: ['back-off'], lastSets: holds('balance-mat-bosu', 3), gym: gym(80, 'mats') })).toMatchObject({ stage: 2, basis: 'back-off', note: 'Back off: back a stage, to folded mat, eyes closed.' })
    })

    it('single-leg balance with no mats stays at eyes closed', () => {
      const s = slot({ id: 'p1a-7', exerciseId: 'single-leg-balance', repsMin: 30, repsMax: 30, repUnit: 'seconds', progressionRule: 'stage', unilateral: true, injuredOnly: true })
      const p = one({ slot: s, exercise: singleLeg, lastSets: holds('single-leg-balance', 1), gym: gym(80) })
      expect(p).toMatchObject({ stage: 1, basis: 'at-top', note: 'Mats aren’t marked here; staying at eyes closed.' })
    })

    it('a bosu and no mat moves the slot to the next exercise here, from its first stage (PROGRAM-QUESTIONS 76)', () => {
      const p = balance({ lastSets: holds('balance-mat-bosu', 1), gym: gym(80, 'bosu') })
      expect(p).toMatchObject({ exerciseId: 'single-leg-balance', stage: 0, repUnit: 'seconds', repsTarget: 30, basis: 'first' })
      expect(p.note).toBe('Mats aren’t marked here, and the first stage is folded mat: Single-leg balance instead. First time: start at 30 seconds.')
      // With the mats back, the slot runs its own ladder again.
      expect(balance({ lastSets: holds('balance-mat-bosu', 1), gym: gym(80, 'bosu', 'mats') })).toMatchObject({ exerciseId: 'balance-mat-bosu', stage: 2 })
    })
  })

  describe('a gym with no dumbbells (PROGRAM-QUESTIONS 64 and 91)', () => {
    const split = ex({ id: 'split-squat', name: 'Split squat', pattern: 'single-leg', loadType: 'dumbbell-each', loadUnit: 'lb', increment: 5, unilateral: true, requires: [] })
    const stepUp = ex({ id: 'step-up', name: 'Step-up', pattern: 'single-leg', loadType: 'step-height', loadUnit: 'in', increment: 2, heightIncrementIn: 2, holdsLoad: 'dumbbell-each', unilateral: true, requires: ['step-platforms'] })
    const stair = ex({ ...stepUp, id: 'step-up-stair', name: 'Step-up on the lowest stair in the club', requires: ['stair'] })
    const backExtension = ex({ id: 'back-extension-45', name: '45° back extension', pattern: 'hinge', loadType: 'dumbbell-single', loadUnit: 'lb', increment: 5, requires: ['back-extension-bench'] })
    const splitSlot = slot({ id: 'p2c-6', exerciseId: 'reverse-lunge', repsMin: 8, repsMax: 8, unilateral: true, substitutionIds: ['split-squat'] })
    const p1c1 = slot({ id: 'p1c-1', exerciseId: 'step-up', repsMin: 10, repsMax: 10, rpeTarget: 6, progressionRule: 'height-then-load', unilateral: true, heightIn: 6, heightMaxIn: 8, loadBeforeHeightLb: 20, substitutionIds: ['step-up-stair', 'split-squat'] })
    const inHands = (load: number) => [...threeSets({ exerciseId: 'step-up', side: 'right', load, loadUnit: 'lb', reps: 10, heightIn: 6 }), ...threeSets({ exerciseId: 'step-up', side: 'left', load, loadUnit: 'lb', reps: 10, heightIn: 6 })]

    it('a first session on an exercise that holds dumbbells without needing them is bodyweight: nothing to pick, nothing capped', () => {
      const first = (week: number, rack: number) => prescribe(input({ slot: splitSlot, exercise: split, substitutions: [split], readings: [], lastSets: [], week, gym: gym(rack) }))
      const [injured, healthy] = first(6, 0)
      expect(injured).toMatchObject({ side: 'right', exerciseId: 'split-squat', load: 0, loadUnit: 'lb', repsTarget: 8, basis: 'first', note: 'First time: bodyweight; start at 8 reps.' })
      expect(injured?.rackCapped).toBeUndefined()
      expect(healthy).toMatchObject({ side: 'left', load: 0 })
      expect(first(8, 0)[0]).toMatchObject({ load: 0, sets: 2, basis: 'first', note: 'First time in a deload week: bodyweight, 2 sets, perfect reps.' })
      expect(first(8, 0)[0]?.rackCapped).toBeUndefined()
      // With dumbbells here it is a load to pick, as before, and in a deload week the lightest one.
      expect(first(6, 25)[0]).toMatchObject({ load: null, note: 'First time: pick a load and start at 8 reps.' })
      expect(first(8, 25)[0]).toMatchObject({ load: 5 })
      const s = slot({ id: 'p1c-6', exerciseId: 'back-extension-45', repsMin: 10, repsMax: 12 })
      expect(one({ slot: s, exercise: backExtension, readings: [], lastSets: [], gym: gym(0, 'back-extension-bench') })).toMatchObject({ load: 0, basis: 'first', note: 'First time: bodyweight; start at 10 reps.' })
    })

    it('a step-up with dumbbells in the hands moves to the split squat, which starts at bodyweight, in a deload week too', () => {
      const moved = (week: number, readings: ('clean' | 'hold' | 'back-off')[]) =>
        prescribe(input({ slot: p1c1, exercise: stepUp, substitutions: [stair, split], readings, lastSets: inHands(10), week, gym: gym(0, 'step-platforms') }))
      const deload = moved(4, ['clean'])
      expect(deload.map((p) => [p.exerciseId, p.load, p.sets])).toEqual([['split-squat', 0, 2], ['split-squat', 0, 2]])
      expect(deload[0]?.rackCapped).toBeUndefined()
      expect(deload[0]?.note).toBe('Deload week: 2 sets instead of 3, same loads and reps, no progression. There are no dumbbells here: swap to Split squat. First time in a deload week: bodyweight, 2 sets, perfect reps.')
      const hold = moved(3, ['hold'])
      expect(hold[0]).toMatchObject({ exerciseId: 'split-squat', load: 0, basis: 'repeat' })
      expect(hold[0]?.note).toBe('Hold: repeat the last session’s loads and reps exactly. There are no dumbbells here: swap to Split squat. First time: bodyweight; start at 10 reps.')
    })
  })
})

describe('what a back-off does, and whether it moves the slot (PROGRAM-QUESTIONS 49 and 55)', () => {
  const nordic = ex({ id: 'nordic-negatives', name: 'Nordic negatives', pattern: 'hamstring', loadType: 'bodyweight', loadUnit: 'none', increment: 0 })
  const curl = ex({ id: 'single-leg-seated-leg-curl', name: 'Single-leg seated leg curl', pattern: 'hamstring', loadUnit: 'lb', increment: 5 })
  const nordicSlot = slot({ id: 'p3a-2', exerciseId: 'nordic-negatives', repsMin: 3, repsMax: 5, progressionRule: 'fixed', substitutionIds: ['single-leg-seated-leg-curl'] })
  const stepUp = ex({ id: 'step-up', pattern: 'single-leg', loadType: 'step-height', loadUnit: 'in', increment: 2, heightIncrementIn: 2, holdsLoad: 'dumbbell-each', unilateral: true })
  const stepSlot = slot({ id: 'p1c-1', exerciseId: 'step-up', repsMin: 10, repsMax: 10, progressionRule: 'height-then-load', unilateral: true, heightIn: 6, heightMaxIn: 8, loadBeforeHeightLb: 20 })
  const steps = (load: number, heightIn: number) => [...threeSets({ side: 'right', load, loadUnit: 'lb', reps: 10, heightIn }), ...threeSets({ side: 'left', load, loadUnit: 'lb', reps: 10, heightIn: heightIn + 2 })]

  it('names each back-off', () => {
    expect(backOffStep(slot(), ex(), 8, undefined)).toBe('lighter-load')
    expect(backOffStep(slot(), ex({ loadDirection: 'down' }), 8, undefined)).toBe('more-assist')
    expect(backOffStep(slot({ progressionRule: 'stage' }), ex({ loadType: 'time' }), 0, undefined)).toBe('stage-down')
    expect(backOffStep(slot({ progressionRule: 'time' }), ex({ loadType: 'time' }), 0, undefined)).toBe('less-time')
    expect(backOffStep(stepSlot, stepUp, 0, 8)).toBe('step-down')
    expect(backOffStep(stepSlot, stepUp, 10, 6)).toBe('lighter-in-hands')
    expect(backOffStep(stepSlot, stepUp, 0, 6)).toBe('easier-version')
    expect(backOffStep(nordicSlot, nordic, 0, undefined)).toBe('easier-version')
    expect(backOffStep(slot(), ex({ loadType: 'dumbbell-each' }), 0, undefined)).toBe('easier-version')
  })

  it('moves only when the back-off goes to the easier version, read from the injured side', () => {
    expect(backOffMoves({ slot: nordicSlot, exercise: nordic, lastSets: threeSets({ load: 0, loadUnit: 'none', reps: 4 }), injuredSide: 'right' })).toBe(true)
    expect(backOffMoves({ slot: slot(), exercise: ex(), lastSets: threeSets(), injuredSide: 'right' })).toBe(false)
    // The injured side sits at the starting height; the other side could still step down.
    expect(backOffMoves({ slot: stepSlot, exercise: stepUp, lastSets: steps(0, 6), injuredSide: 'right' })).toBe(true)
    expect(backOffMoves({ slot: stepSlot, exercise: stepUp, lastSets: steps(0, 6), injuredSide: 'left' })).toBe(false)
    expect(backOffMoves({ slot: stepSlot, exercise: stepUp, lastSets: steps(10, 6), injuredSide: 'right' })).toBe(false)
  })

  it('with no last session there is nothing to back off from', () => {
    expect(backOffMoves({ slot: nordicSlot, exercise: nordic, lastSets: [], injuredSide: 'right' })).toBe(false)
  })

  it('a placement note leads every side’s note', () => {
    const [injured, healthy] = prescribe(input({ slot: stepSlot, exercise: stepUp, readings: ['clean'], lastSets: steps(10, 6), placement: { note: 'Why it runs.', returned: false } }))
    expect(injured?.note).toBe('Why it runs. Clean once: same load, same target; clean again to progress.')
    expect(healthy?.note).toBe('Why it runs. Clean once: same load, same target; clean again to progress.')
  })

  it('back from the easier version, the standing back-off is served: the last session repeats', () => {
    const lastSets = [setLog(1, { exerciseId: 'nordic-negatives', load: 0, loadUnit: 'none', reps: 4 }), setLog(2, { exerciseId: 'nordic-negatives', load: 0, loadUnit: 'none', reps: 3 })]
    const back = one({ slot: nordicSlot, exercise: nordic, substitutions: [curl], readings: ['back-off'], lastSets, placement: { note: 'Back on Nordic negatives: Single-leg seated leg curl read clean twice.', returned: true } })
    expect(back).toMatchObject({ exerciseId: 'nordic-negatives', load: 0, repsTarget: 4, basis: 'repeat' })
    expect(back.perSet).toEqual([{ load: 0, reps: 4 }, { load: 0, reps: 3 }])
    expect(back.note).toBe('Back on Nordic negatives: Single-leg seated leg curl read clean twice. Same loads and reps as its last session.')
    // Without the return, the same readings back off to the easier version again.
    expect(one({ slot: nordicSlot, exercise: nordic, substitutions: [curl], readings: ['back-off'], lastSets })).toMatchObject({ exerciseId: 'single-leg-seated-leg-curl', basis: 'back-off' })
  })

  it('a return in a deload week is still a deload, led by why the slot is back', () => {
    const lastSets = threeSets({ exerciseId: 'nordic-negatives', load: 0, loadUnit: 'none', reps: 4 })
    const p = one({ slot: nordicSlot, exercise: nordic, substitutions: [curl], readings: ['back-off'], lastSets, week: 4, placement: { note: 'Back on Nordic negatives.', returned: true } })
    expect(p).toMatchObject({ exerciseId: 'nordic-negatives', sets: 2, basis: 'deload' })
    expect(p.note).toMatch(/^Back on Nordic negatives\. Deload week/)
  })
})

describe('the whole knee: the next lift after a morning that read back off (PROGRAM-QUESTIONS 6)', () => {
  const knee = (phaseOneLoads: NonNullable<PrescriptionInput['wholeKnee']>['phaseOneLoads'] = {}): NonNullable<PrescriptionInput['wholeKnee']> => ({ morning: '2026-12-09', phaseOneLoads })
  const press = ex({ loadUnit: 'lb', increment: 5 })
  const lbSets = threeSets({ load: 100, loadUnit: 'lb' })

  it('backs off whatever the readings say', () => {
    for (const readings of [['clean', 'clean'], ['clean'], ['hold'], []] as const) {
      expect(one({ exercise: press, readings: [...readings], lastSets: lbSets, wholeKnee: knee() }), readings.join()).toMatchObject({ load: 75, basis: 'back-off' })
    }
  })

  it('leads the note, and only a back-off gets the lead', () => {
    expect(one({ exercise: press, lastSets: lbSets, wholeKnee: knee() }).note).toBe(`${WHOLE_KNEE_NOTE} Back off: load × 0.75, rounded down to 75 lb.`)
    expect(one({ exercise: press, lastSets: lbSets, wholeKnee: knee(), redFlagActive: true })).toMatchObject({ basis: 'suspended', note: 'Red-flag state: progression is suspended; repeat the last session exactly.' })
    expect(one({ exercise: press, lastSets: [], wholeKnee: knee() }).basis).toBe('first')
  })

  it('a Phase 1 load in another unit is not a floor', () => {
    expect(one({ exercise: press, lastSets: lbSets, wholeKnee: knee({ both: { load: 7, loadUnit: 'plate' } }) })).toMatchObject({ load: 75 })
  })

  it('reads the side’s own Phase 1 load, or the lightest side when that side has none', () => {
    const rdl = ex({ id: 'single-leg-rdl', pattern: 'hinge', loadType: 'dumbbell-single', loadUnit: 'lb', increment: 5, unilateral: true })
    const s = slot({ exerciseId: 'single-leg-rdl', unilateral: true })
    const sided = [...threeSets({ side: 'right', load: 40, loadUnit: 'lb' }), ...threeSets({ side: 'left', load: 40, loadUnit: 'lb' })]
    const [right, left] = prescribe(input({ slot: s, exercise: rdl, lastSets: sided, wholeKnee: knee({ right: { load: 20, loadUnit: 'lb' }, left: { load: 35, loadUnit: 'lb' } }) }))
    expect(right).toMatchObject({ side: 'right', load: 20 })
    expect(left).toMatchObject({ side: 'left', load: 30 })
    const [fromBoth] = prescribe(input({ slot: s, exercise: rdl, lastSets: sided, wholeKnee: knee({ both: { load: 25, loadUnit: 'lb' } }) }))
    expect(fromBoth).toMatchObject({ side: 'right', load: 25 })
  })

  it('a step at its starting height takes the floor on the dumbbells in the hands', () => {
    const stepUp = ex({ id: 'step-up', pattern: 'single-leg', loadType: 'step-height', loadUnit: 'in', increment: 2, heightIncrementIn: 2, holdsLoad: 'dumbbell-each', unilateral: true })
    const s = slot({ exerciseId: 'step-up', repsMin: 10, repsMax: 10, progressionRule: 'height-then-load', heightIn: 6, heightMaxIn: 16, loadBeforeHeightLb: 20 })
    const atStart = threeSets({ load: 20, loadUnit: 'lb', reps: 10, heightIn: 6 })
    expect(one({ slot: s, exercise: stepUp, lastSets: atStart, wholeKnee: knee({ both: { load: 10, loadUnit: 'lb' } }) })).toMatchObject({
      load: 10, heightIn: 6, note: `${WHOLE_KNEE_NOTE} Back off: 10 lb in the hands at the starting height; the last Phase 1 load, 10 lb, is lighter than load × 0.75 (15 lb), so it wins.`,
    })
    // Above the starting height the back-off steps down first; the load stays.
    expect(one({ slot: s, exercise: stepUp, lastSets: threeSets({ load: 20, loadUnit: 'lb', reps: 10, heightIn: 10 }), wholeKnee: knee({ both: { load: 10, loadUnit: 'lb' } }) })).toMatchObject({ load: 20, heightIn: 8 })
  })

  it('bodyweight work goes to its easier version, led by the morning', () => {
    const nordic = ex({ id: 'nordic-negatives', pattern: 'hamstring', loadType: 'bodyweight', loadUnit: 'none', increment: 0 })
    const curl = ex({ id: 'single-leg-seated-leg-curl', name: 'Single-leg seated leg curl', pattern: 'hamstring', loadUnit: 'lb' })
    const s = slot({ exerciseId: 'nordic-negatives', repsMin: 3, repsMax: 5, progressionRule: 'fixed', substitutionIds: ['single-leg-seated-leg-curl'] })
    expect(one({ slot: s, exercise: nordic, substitutions: [curl], lastSets: threeSets({ load: 0, loadUnit: 'none', reps: 4 }), wholeKnee: knee() })).toMatchObject({
      exerciseId: 'single-leg-seated-leg-curl', basis: 'back-off', note: `${WHOLE_KNEE_NOTE} Back off: the easier version, Single-leg seated leg curl.`,
    })
  })

  it('wins over a return from the easier version for that session', () => {
    const nordic = ex({ id: 'nordic-negatives', pattern: 'hamstring', loadType: 'bodyweight', loadUnit: 'none', increment: 0 })
    const curl = ex({ id: 'single-leg-seated-leg-curl', name: 'Single-leg seated leg curl', pattern: 'hamstring', loadUnit: 'lb' })
    const s = slot({ exerciseId: 'nordic-negatives', repsMin: 3, repsMax: 5, progressionRule: 'fixed', substitutionIds: ['single-leg-seated-leg-curl'] })
    const p = one({ slot: s, exercise: nordic, substitutions: [curl], readings: ['back-off'], lastSets: threeSets({ load: 0, loadUnit: 'none', reps: 4 }), placement: { note: 'Back on Nordics.', returned: true }, wholeKnee: knee() })
    expect(p).toMatchObject({ exerciseId: 'single-leg-seated-leg-curl', basis: 'back-off', note: `Back on Nordics. ${WHOLE_KNEE_NOTE} Back off: the easier version, Single-leg seated leg curl.` })
  })
})

describe('a down period: clean twice repeats instead of stepping up (Batch E, PROGRAM-QUESTIONS 181)', () => {
  const pause = { start: '2026-11-14', until: '2026-11-20', untilWords: 'Friday Nov 20', day: 4, of: 7 }
  const NOTE = 'Clean twice: same load, same target. Down period: progression paused until Friday Nov 20.'

  it('worked example: leg press clean twice at the top, 8 plates × 12 inside the period, repeats at 8 × 12', () => {
    expect(one()).toMatchObject({ load: 9, repsTarget: 10, basis: 'progress-load' })
    const p = one({ pause })
    expect(p).toMatchObject({ load: 8, repsTarget: 12, sets: 3, basis: 'paused', note: NOTE })
    expect(p.perSet).toBeUndefined()
  })

  it('pauses every step up: reps, load, assist, height, held load, range and stage', () => {
    expect(one({ pause, lastSets: threeSets({ reps: 11 }) })).toMatchObject({ load: 8, repsTarget: 11, basis: 'paused' })
    expect(one({ pause, exercise: ex({ loadDirection: 'down' }) })).toMatchObject({ load: 8, basis: 'paused' })
    const stepUp = ex({ id: 'step-up', loadType: 'step-height', loadUnit: 'in', increment: 2, heightIncrementIn: 2, holdsLoad: 'dumbbell-each', unilateral: true })
    const s = slot({ exerciseId: 'step-up', repsMin: 10, repsMax: 10, progressionRule: 'height-then-load', unilateral: true, injuredOnly: true, heightIn: 6, heightMaxIn: 8, loadBeforeHeightLb: 20 })
    const stepSets = (load: number, heightIn: number) => threeSets({ side: 'right', load, loadUnit: 'lb', reps: 10, heightIn })
    expect(one({ pause, slot: s, exercise: stepUp, lastSets: stepSets(20, 6) })).toMatchObject({ heightIn: 6, load: 20, basis: 'paused' })
    expect(one({ pause, slot: s, exercise: stepUp, lastSets: stepSets(10, 6) })).toMatchObject({ heightIn: 6, load: 10, basis: 'paused' })
    expect(one({ pause, slot: s, exercise: stepUp, lastSets: stepSets(20, 8) })).toMatchObject({ heightIn: 8, load: 20, basis: 'paused' })
    const legExt = ex({ id: 'leg-extension', pattern: 'quad' })
    const phase2 = slot({ exerciseId: 'leg-extension', sets: 2, repsMin: 12, repsMax: 15, progressionRule: 'range-then-load', rangeStopDeg: 30 })
    expect(one({ pause, slot: phase2, exercise: legExt, lastSets: [setLog(1, { reps: 15, rangeStopDeg: 45, load: 5 }), setLog(2, { reps: 15, rangeStopDeg: 45, load: 5 })] })).toMatchObject({ rangeStopDeg: 45, load: 5, basis: 'paused' })
    const balance = ex({ id: 'single-leg-balance', pattern: 'balance', loadType: 'time', loadUnit: 's', increment: 5, unilateral: true, stages: ['eyes open', 'eyes closed', 'on a folded mat'] })
    const bal = slot({ exerciseId: 'single-leg-balance', repsMin: 30, repsMax: 30, repUnit: 'seconds', progressionRule: 'stage', unilateral: true, injuredOnly: true })
    expect(one({ pause, slot: bal, exercise: balance, lastSets: threeSets({ side: 'right', load: 0, loadUnit: 's', reps: undefined, seconds: 30, stage: 0, rpe: undefined }) })).toMatchObject({ stage: 0, basis: 'paused' })
  })

  it('changes nothing else: deload, red flag, whole knee, back off, hold, none, clean once and a first session read as outside one', () => {
    const knee = { morning: '2026-11-17', phaseOneLoads: {} }
    const cases: Partial<PrescriptionInput>[] = [
      { week: 4 },
      { redFlagActive: true },
      { wholeKnee: knee },
      { readings: ['back-off'] },
      { readings: ['hold', 'hold'] },
      { readings: ['hold'] },
      { readings: [] },
      { readings: ['clean'] },
      { readings: ['clean', 'hold'] },
      { lastSets: [], readings: [] },
      { lastSets: [], readings: [], week: 4 },
    ]
    for (const c of cases) expect(prescribe(input({ ...c, pause })), JSON.stringify(c)).toEqual(prescribe(input(c)))
  })

  it('both sides repeat, and the healthy side still takes the injured side’s count', () => {
    const lunge = ex({ id: 'split-squat', loadType: 'dumbbell-each', loadUnit: 'lb', increment: 5, unilateral: true })
    const s = slot({ exerciseId: 'split-squat', unilateral: true, repsMin: 8, repsMax: 10 })
    const sets = [...threeSets({ side: 'right', load: 20, loadUnit: 'lb', reps: 9 }), ...threeSets({ side: 'left', load: 20, loadUnit: 'lb', reps: 10 })]
    const [injured, healthy] = prescribe(input({ pause, slot: s, exercise: lunge, lastSets: sets }))
    expect(injured).toMatchObject({ side: 'right', load: 20, repsTarget: 9, basis: 'paused' })
    expect(healthy).toMatchObject({ side: 'left', load: 20, repsTarget: 9, budgetFromInjured: true, basis: 'paused' })
  })
})
