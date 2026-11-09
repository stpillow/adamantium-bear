import { describe, expect, it } from 'vitest'
import type { Exercise, MorningCheck, SetLog, Slot, Workout } from '../schema/index.ts'
import { addDays } from './calendar.ts'
import { attachChecks } from './history.ts'
import { prescribe } from './prescription.ts'
import { sessionSlotExercise, slotAtGym, slotExercise, type SlotExerciseInput } from './slotExercise.ts'

// Question 55: after a back-off moves a slot to its easier version, two cleans on it bring the slot back.

const ex = (over: Partial<Exercise>): Exercise => ({
  id: 'x', name: 'X', pattern: 'hamstring', equipment: 'x', loadType: 'stack', loadUnit: 'lb', increment: 5, loadDirection: 'up', unilateral: false, requires: [], ...over,
})
const nordic = ex({ id: 'nordic', name: 'Nordic negatives', loadType: 'bodyweight', loadUnit: 'none', increment: 0 })
const legCurl = ex({ id: 'leg-curl', name: 'Leg curls' })
const lyingCurl = ex({ id: 'lying-curl', name: 'Lying leg curl' })
const nordicSlot: Slot = {
  id: 'p3a-2', order: 2, label: '2', exerciseId: 'nordic', sets: 3, repsMin: 3, repsMax: 5, repUnit: 'reps', unilateral: false, injuredOnly: false,
  prescriptionText: '3 × 3–5', cues: [], progressionRule: 'fixed', substitutionIds: ['leg-curl', 'lying-curl'], optional: false,
}

type Read = 'clean' | 'hold' | 'back-off'
const PAIN: Record<Read, number> = { clean: 2, hold: 4, 'back-off': 6 }
interface Logged {
  date: string
  exerciseId: string
  read: Read
  load?: number
  reps?: number
  over?: Partial<SetLog>
  status?: Workout['status']
}

/** One workout per entry, three sets of the exercise, a clean check the next morning: the pain decides the reading. */
function history(entries: readonly Logged[]) {
  const workouts: Workout[] = []
  const sets: SetLog[] = []
  const checks: MorningCheck[] = []
  entries.forEach((e, i) => {
    const id = `w${i + 1}`
    workouts.push({ id, date: e.date, templateId: 'p3-a', phase: 3, week: 9, isDeload: false, status: e.status ?? 'finished' })
    for (const n of [1, 2, 3]) {
      sets.push({
        id: `${id}-${n}`, workoutId: id, slotId: nordicSlot.id, exerciseId: e.exerciseId, setNumber: n, side: 'both', load: e.load ?? 0,
        loadUnit: e.load === undefined ? 'none' : 'lb', reps: e.reps ?? 4, painDuring: PAIN[e.read], stopped: false, ...e.over,
      })
    }
    checks.push({ id: `m${i + 1}`, date: addDays(e.date, 1), appliesTo: { kind: 'workout', id }, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [] })
  })
  return attachChecks(workouts, sets, checks)
}

const input = (entries: readonly Logged[], over: Partial<SlotExerciseInput> = {}): SlotExerciseInput => ({
  slot: nordicSlot, own: nordic, substitutions: [legCurl, lyingCurl], records: history(entries), injuredSide: 'right', ...over,
})
const plan = (i: SlotExerciseInput) => {
  const placed = slotExercise(i)
  const [p] = prescribe({
    slot: i.slot, exercise: placed.exercise, substitutions: [...i.substitutions], readings: placed.readings, lastSets: placed.lastSets,
    week: 10, injuredSide: 'right', dumbbellMax: 80, redFlagActive: false, ...(placed.placement ? { placement: placed.placement } : {}),
  })
  if (!p) throw new Error('no prescription')
  return { placed, p }
}

const backedOff: Logged = { date: '2027-01-05', exerciseId: 'nordic', read: 'back-off', reps: 3 }
const curl = (date: string, read: Read, load = 40): Logged => ({ date, exerciseId: 'leg-curl', read, load, reps: 10 })

describe('slotExercise: the easier version and the way back (PROGRAM-QUESTIONS 55)', () => {
  it('with no history the slot runs its own exercise, nothing to say', () => {
    const placed = slotExercise(input([]))
    expect(placed).toEqual({ exercise: nordic, readings: [], lastSets: [] })
  })

  it('a back-off on Nordics moves the slot to its first substitution, the leg curls', () => {
    const { placed, p } = plan(input([backedOff]))
    // The rule leaves the slot on its own exercise; the back-off itself makes the move, as before.
    expect(placed.exercise).toBe(nordic)
    expect(placed.placement).toBeUndefined()
    expect(placed.readings).toEqual(['back-off'])
    expect(p).toMatchObject({ exerciseId: 'leg-curl', basis: 'back-off', note: 'Back off: the easier version, Leg curls.' })
  })

  it('one clean on the leg curls stays on them, progressing on their own history', () => {
    const { placed, p } = plan(input([backedOff, curl('2027-01-08', 'clean')]))
    expect(placed.exercise).toBe(legCurl)
    expect(placed.readings).toEqual(['clean'])
    expect(placed.placement).toEqual({
      note: 'On Leg curls since Nordic negatives backed off: clean once; clean again and the slot goes back to Nordic negatives.',
      returned: false,
    })
    expect(p).toMatchObject({ exerciseId: 'leg-curl', load: 40, basis: 'same' })
    expect(p.note).toBe(`${placed.placement?.note} Clean once: same load, same target; clean again to progress.`)
  })

  it('a clean on the easier version from before the back-off counts toward the two, once one is since the move (Shawn, Nov 2)', () => {
    const { placed, p } = plan(input([curl('2026-12-01', 'clean'), backedOff, curl('2027-01-08', 'clean')]))
    expect(placed.exercise).toBe(nordic)
    expect(placed.placement).toEqual({ note: 'Back on Nordic negatives: Leg curls read clean twice.', returned: true })
    expect(p).toMatchObject({ exerciseId: 'nordic', basis: 'repeat' })
  })

  it('cleans from before the back-off alone never bring the slot back: the back-off is served at least once', () => {
    const before = [curl('2026-12-01', 'clean'), curl('2026-12-04', 'clean'), backedOff]
    const { placed, p } = plan(input(before))
    expect(placed.exercise).toBe(nordic)
    expect(placed.placement).toBeUndefined()
    expect(p).toMatchObject({ exerciseId: 'leg-curl', basis: 'back-off', note: 'Back off: the easier version, Leg curls.' })
    expect(slotExercise(input([...before, curl('2027-01-08', 'clean')])).placement?.returned).toBe(true)
  })

  it('a hold on the easier version from before the back-off still breaks the run of cleans', () => {
    const placed = slotExercise(input([curl('2026-12-01', 'hold'), backedOff, curl('2027-01-08', 'clean')]))
    expect(placed.exercise).toBe(legCurl)
    expect(placed.readings).toEqual(['clean', 'hold'])
    expect(placed.placement?.note).toMatch(/clean once/)
  })

  it('the easier version prescribes from all its readings, as every exercise does: an older hold and a hold since are two holds', () => {
    const { placed, p } = plan(input([curl('2026-12-01', 'hold'), backedOff, curl('2027-01-08', 'hold')]))
    expect(placed.exercise).toBe(legCurl)
    expect(placed.readings).toEqual(['hold', 'hold'])
    expect(p).toMatchObject({ exerciseId: 'leg-curl', load: 30, basis: 'back-off' })
  })

  it('two cleans in a row on the leg curls return the slot to Nordics at their last session', () => {
    const { placed, p } = plan(input([backedOff, curl('2027-01-08', 'clean'), curl('2027-01-12', 'clean', 45)]))
    expect(placed.exercise).toBe(nordic)
    expect(placed.placement).toEqual({ note: 'Back on Nordic negatives: Leg curls read clean twice.', returned: true })
    // The back-off still stands in the Nordics' own readings; it is served, so their last session repeats.
    expect(placed.readings).toEqual(['back-off'])
    expect(p).toMatchObject({ exerciseId: 'nordic', load: 0, repsTarget: 3, basis: 'repeat' })
    expect(p.perSet).toEqual([{ load: 0, reps: 3 }, { load: 0, reps: 3 }, { load: 0, reps: 3 }])
    expect(p.note).toBe('Back on Nordic negatives: Leg curls read clean twice. Same loads and reps as its last session.')
  })

  it('back on Nordics, their next reading is theirs again: a clean reads clean once, with nothing to say', () => {
    const { placed, p } = plan(input([backedOff, curl('2027-01-08', 'clean'), curl('2027-01-12', 'clean'), { date: '2027-01-15', exerciseId: 'nordic', read: 'clean' }]))
    expect(placed.exercise).toBe(nordic)
    expect(placed.placement).toBeUndefined()
    expect(placed.readings).toEqual(['clean', 'back-off'])
    expect(p.basis).toBe('same')
  })

  it('a hold on the leg curls resets the count', () => {
    const afterHold = slotExercise(input([backedOff, curl('2027-01-08', 'clean'), curl('2027-01-12', 'hold')]))
    expect(afterHold.exercise).toBe(legCurl)
    expect(afterHold.placement?.note).toBe('On Leg curls since Nordic negatives backed off; two clean readings in a row take the slot back to Nordic negatives.')
    const oneSince = slotExercise(input([backedOff, curl('2027-01-08', 'clean'), curl('2027-01-12', 'hold'), curl('2027-01-15', 'clean')]))
    expect(oneSince.exercise).toBe(legCurl)
    expect(oneSince.placement?.note).toMatch(/clean once/)
    const twoSince = slotExercise(input([backedOff, curl('2027-01-08', 'clean'), curl('2027-01-12', 'hold'), curl('2027-01-15', 'clean'), curl('2027-01-19', 'clean')]))
    expect(twoSince.exercise).toBe(nordic)
    expect(twoSince.placement?.returned).toBe(true)
  })

  it('a back-off on the leg curls stays on them and cuts their load (they are loaded, so there is no further move)', () => {
    const { placed, p } = plan(input([backedOff, curl('2027-01-08', 'clean'), curl('2027-01-12', 'back-off')]))
    expect(placed.exercise).toBe(legCurl)
    expect(p).toMatchObject({ exerciseId: 'leg-curl', load: 30, basis: 'back-off' })
  })

  it('a swap to another substitution in between is not counted, and does not move the slot', () => {
    const lying: Logged = { date: '2027-01-10', exerciseId: 'lying-curl', read: 'clean', load: 30, reps: 10 }
    const placed = slotExercise(input([backedOff, curl('2027-01-08', 'clean'), lying]))
    expect(placed.exercise).toBe(legCurl)
    expect(placed.placement?.note).toMatch(/clean once/)
  })

  it('a session that never happened is not history', () => {
    const placed = slotExercise(input([backedOff, { ...curl('2027-01-08', 'clean'), status: 'in-progress' }]))
    expect(placed.exercise).toBe(nordic)
    expect(placed.placement).toBeUndefined()
  })

  it('a load cut keeps the exercise: a swap after it does not put the slot on the swap', () => {
    const press = ex({ id: 'leg-press', name: 'Leg press', pattern: 'squat' })
    const box = ex({ id: 'box-squat', name: 'Smith box squat', pattern: 'squat', increment: 10 })
    const slot: Slot = { ...nordicSlot, id: 'p1a-1', exerciseId: 'leg-press', substitutionIds: ['box-squat'], repsMin: 10, repsMax: 12, progressionRule: 'double-progression' }
    const entries: Logged[] = [{ date: '2027-01-05', exerciseId: 'leg-press', read: 'back-off', load: 100 }, { date: '2027-01-08', exerciseId: 'box-squat', read: 'clean', load: 60 }]
    const { placed, p } = plan(input(entries, { slot, own: press, substitutions: [box] }))
    expect(placed.exercise).toBe(press)
    expect(placed.placement).toBeUndefined()
    expect(p).toMatchObject({ exerciseId: 'leg-press', load: 75, basis: 'back-off' })
  })

  it('a swap while the slot reads clean is a one-off: the slot stays on its own exercise', () => {
    const placed = slotExercise(input([{ date: '2027-01-05', exerciseId: 'nordic', read: 'clean' }, curl('2027-01-08', 'clean'), curl('2027-01-12', 'clean')]))
    expect(placed.exercise).toBe(nordic)
    expect(placed.placement).toBeUndefined()
  })

  it('two holds in a row on Nordics are a back-off, and move the slot the same way', () => {
    const holds: Logged[] = [{ date: '2027-01-01', exerciseId: 'nordic', read: 'hold' }, { date: '2027-01-05', exerciseId: 'nordic', read: 'hold' }, curl('2027-01-08', 'clean')]
    expect(slotExercise(input(holds)).exercise).toBe(legCurl)
  })
})

describe('sessionSlotExercise: a swap chosen for the session beats the slot\'s history', () => {
  const onCurls = [backedOff, curl('2027-01-08', 'clean')]
  it('with nothing chosen the history decides', () => {
    expect(sessionSlotExercise(input(onCurls), undefined)).toEqual(slotExercise(input(onCurls)))
  })
  it('a substitution chosen while the history has the slot on the easier version runs, on its own history, with no placement', () => {
    const lying: Logged = { date: '2026-12-01', exerciseId: 'lying-curl', read: 'hold', load: 30, reps: 10 }
    const placed = sessionSlotExercise(input([lying, ...onCurls]), 'lying-curl')
    expect(placed.exercise).toBe(lyingCurl)
    expect(placed.readings).toEqual(['hold'])
    expect(placed.lastSets.map((s) => s.load)).toEqual([30, 30, 30])
    expect(placed.placement).toBeUndefined()
  })
  it('the slot\'s own exercise chosen runs on its own readings, the back-off standing', () => {
    const placed = sessionSlotExercise(input(onCurls), 'nordic')
    expect(placed).toMatchObject({ exercise: nordic, readings: ['back-off'] })
    expect(placed.placement).toBeUndefined()
  })
  it('a choice that is not on the slot\'s list is ignored', () => {
    expect(sessionSlotExercise(input(onCurls), 'leg-press')).toEqual(slotExercise(input(onCurls)))
  })
})

describe('slotExercise: one step at a time down a longer list', () => {
  // Step-up, then the lowest stair, then the split squat (program.md's single-leg row). Both steps start at 6 in.
  const stepUp = ex({ id: 'step-up', name: 'Step-up', pattern: 'single-leg', loadType: 'step-height', loadUnit: 'in', increment: 2, heightIncrementIn: 2, holdsLoad: 'dumbbell-each', unilateral: true })
  const stair = ex({ ...stepUp, id: 'step-up-stair', name: 'Step-up on the lowest stair' })
  const split = ex({ id: 'split-squat', name: 'Split squat', pattern: 'single-leg', loadType: 'dumbbell-each', unilateral: true })
  const slot: Slot = { ...nordicSlot, id: 'p1c-1', exerciseId: 'step-up', substitutionIds: ['step-up-stair', 'split-squat'], repsMin: 10, repsMax: 10, progressionRule: 'height-then-load', heightIn: 6, heightMaxIn: 8, loadBeforeHeightLb: 20 }
  const at6 = (date: string, exerciseId: string, read: Read): Logged => ({ date, exerciseId, read, reps: 10, over: { heightIn: 6, loadUnit: 'lb', slotId: 'p1c-1' } })
  const steps = (entries: readonly Logged[]) => slotExercise(input(entries, { slot, own: stepUp, substitutions: [stair, split] }))

  it('a step-up backed off at its starting height with nothing in the hands goes to the stair', () => {
    const { p } = plan(input([at6('2027-01-02', 'step-up', 'back-off')], { slot, own: stepUp, substitutions: [stair, split] }))
    expect(p).toMatchObject({ exerciseId: 'step-up-stair', basis: 'back-off' })
  })

  it('the stair backing off goes on to the split squat, whose two cleans bring the slot back to the stair, not past it', () => {
    const entries = [at6('2027-01-02', 'step-up', 'back-off'), at6('2027-01-06', 'step-up-stair', 'back-off'), at6('2027-01-09', 'split-squat', 'clean'), at6('2027-01-13', 'split-squat', 'clean')]
    const placed = steps(entries)
    expect(placed.exercise).toBe(stair)
    expect(placed.placement).toEqual({ note: 'Back on Step-up on the lowest stair: Split squat read clean twice.', returned: true })
    expect(placed.readings).toEqual(['back-off'])
  })

  it('back on the stair, its cleans since the step-up backed off count toward the step-up', () => {
    const base = [at6('2027-01-02', 'step-up', 'back-off'), at6('2027-01-06', 'step-up-stair', 'back-off'), at6('2027-01-09', 'split-squat', 'clean'), at6('2027-01-13', 'split-squat', 'clean')]
    const once = steps([...base, at6('2027-01-16', 'step-up-stair', 'clean')])
    expect(once.exercise).toBe(stair)
    expect(once.placement?.note).toBe('On Step-up on the lowest stair since Step-up backed off: clean once; clean again and the slot goes back to Step-up.')
    const twice = steps([...base, at6('2027-01-16', 'step-up-stair', 'clean'), at6('2027-01-20', 'step-up-stair', 'clean')])
    expect(twice.exercise).toBe(stepUp)
    expect(twice.placement).toEqual({ note: 'Back on Step-up: Step-up on the lowest stair read clean twice.', returned: true })
  })
})

describe('slotExercise: the move is the slot’s own, its readings every slot’s (PROGRAM-QUESTIONS 84 and 88)', () => {
  // Phase 2 B6 (lateral step-down, then the stair) and C1 (step-up, then the stair): both slots log the stair.
  const lsd = ex({ id: 'lateral-step-down', name: 'Lateral step-down', pattern: 'single-leg', loadType: 'step-height', loadUnit: 'in', increment: 2, heightIncrementIn: 2, holdsLoad: 'dumbbell-each', unilateral: true })
  const stair = ex({ ...lsd, id: 'step-up-stair', name: 'Step-up on the lowest stair' })
  const b6: Slot = { ...nordicSlot, id: 'p2b-6', exerciseId: 'lateral-step-down', substitutionIds: ['step-up-stair'], repsMin: 10, repsMax: 10, progressionRule: 'height-then-load', heightIn: 6, heightMaxIn: 8 }
  const at6 = (date: string, exerciseId: string, read: Read, slotId: string): Logged => ({ date, exerciseId, read, reps: 10, over: { heightIn: 6, loadUnit: 'lb', slotId } })
  const onB6 = (entries: readonly Logged[]) => input(entries, { slot: b6, own: lsd, substitutions: [stair] })
  const backedOffB6 = at6('2027-01-05', 'lateral-step-down', 'back-off', 'p2b-6')

  it('a stair session in another slot after the back-off doesn’t put B6 on the stair: its back-off is served first', () => {
    const entries = [at6('2026-12-03', 'step-up-stair', 'clean', 'p1c-1'), backedOffB6, at6('2027-01-07', 'step-up-stair', 'clean', 'p2c-1')]
    const { placed, p } = plan(onB6(entries))
    expect(placed.exercise).toBe(lsd)
    expect(placed.placement).toBeUndefined()
    expect(p).toMatchObject({ exerciseId: 'step-up-stair', basis: 'back-off', note: 'Back off: the easier version, Step-up on the lowest stair.' })
  })

  it('two stair cleans in another slot, with a B week missed, still leave B6’s back-off to serve', () => {
    const entries = [backedOffB6, at6('2027-01-07', 'step-up-stair', 'clean', 'p2c-1'), at6('2027-01-14', 'step-up-stair', 'clean', 'p2c-1')]
    const { placed, p } = plan(onB6(entries))
    expect(placed.exercise).toBe(lsd)
    expect(p).toMatchObject({ exerciseId: 'step-up-stair', basis: 'back-off' })
  })

  it('once B6 has run the stair, the stair’s cleans from every slot count toward the two', () => {
    const entries = [backedOffB6, at6('2027-01-07', 'step-up-stair', 'clean', 'p2c-1'), at6('2027-01-12', 'step-up-stair', 'clean', 'p2b-6')]
    const placed = slotExercise(onB6(entries))
    expect(placed.exercise).toBe(lsd)
    expect(placed.placement).toEqual({ note: 'Back on Lateral step-down: Step-up on the lowest stair read clean twice.', returned: true })
  })
})

describe('slotAtGym: the gym routes the slot forward from where its history put it (PROGRAM-QUESTIONS 86)', () => {
  // Nordics need a mat; the leg curls need their machines.
  const nordicMat = { ...nordic, requires: ['mats'] }
  const seated = { ...legCurl, requires: ['seated-leg-curl'] }
  const lying = { ...lyingCurl, requires: ['lying-leg-curl'] }
  const atGym = (entries: readonly Logged[]) => input(entries, { own: nordicMat, substitutions: [seated, lying] })
  const all = new Set(['mats', 'seated-leg-curl', 'lying-leg-curl'])
  const onCurls = [backedOff, curl('2027-01-08', 'clean')]

  it('with everything here it is the history’s pick, routed own', () => {
    const here = slotAtGym(atGym(onCurls), undefined, all)
    expect(here).toEqual({ ...slotExercise(atGym(onCurls)), route: { kind: 'own', exerciseId: 'leg-curl', passedOver: [] } })
    expect(slotAtGym(atGym([]), undefined, all)).toEqual({ exercise: nordicMat, readings: [], lastSets: [], route: { kind: 'own', exerciseId: 'nordic', passedOver: [] } })
  })

  it('the slot’s own exercise not here moves the slot to the first one here, on that one’s own history', () => {
    const here = slotAtGym(atGym([curl('2026-12-01', 'clean')]), undefined, new Set(['seated-leg-curl', 'lying-leg-curl']))
    expect(here.route).toEqual({ kind: 'moved', exerciseId: 'leg-curl', passedOver: [{ exerciseId: 'nordic', missing: ['mats'] }] })
    expect(here.exercise).toBe(seated)
    expect(here.readings).toEqual(['clean'])
    expect(here.lastSets.map((s) => s.load)).toEqual([40, 40, 40])
    expect(here.placement).toBeUndefined()
  })

  it('on the easier version, a gym without it moves on down the list, never back up to the harder own exercise', () => {
    const here = slotAtGym(atGym(onCurls), undefined, new Set(['mats', 'lying-leg-curl']))
    expect(here.route).toEqual({ kind: 'moved', exerciseId: 'lying-curl', passedOver: [{ exerciseId: 'leg-curl', missing: ['seated-leg-curl'] }] })
    expect(here.exercise).toBe(lying)
    expect(here.placement).toBeUndefined()
  })

  it('with nothing here from the history’s pick on, the slot stays on it, marked none, its placement kept', () => {
    const here = slotAtGym(atGym(onCurls), undefined, new Set(['mats']))
    expect(here.route).toEqual({
      kind: 'none',
      exerciseId: 'leg-curl',
      passedOver: [{ exerciseId: 'leg-curl', missing: ['seated-leg-curl'] }, { exerciseId: 'lying-curl', missing: ['lying-leg-curl'] }],
    })
    expect(here.exercise).toBe(seated)
    expect(here.placement?.note).toMatch(/^On Leg curls since Nordic negatives backed off/)
  })

  it('with nothing on the list here, the slot keeps its own exercise and its history, marked none', () => {
    const here = slotAtGym(atGym([]), undefined, new Set())
    expect(here.route.kind).toBe('none')
    expect(here.exercise).toBe(nordicMat)
  })

  it('back on its own exercise after two cleans, a gym without it takes the next one here, with no placement', () => {
    const entries = [backedOff, curl('2027-01-08', 'clean'), curl('2027-01-12', 'clean')]
    expect(slotExercise(atGym(entries)).placement?.returned).toBe(true)
    const here = slotAtGym(atGym(entries), undefined, new Set(['seated-leg-curl']))
    expect(here.route).toMatchObject({ kind: 'moved', exerciseId: 'leg-curl' })
    expect(here.exercise).toBe(seated)
    expect(here.readings).toEqual(['clean', 'clean'])
    expect(here.placement).toBeUndefined()
  })

  it('another gym’s pass-over isn’t the slot’s easier version: back where the program’s easier version is, the slot runs it (PROGRAM-QUESTIONS 89)', () => {
    // Nordics back off at home; the next A is at a hotel with no seated curl, where the back-off passes over to the lying curl.
    const atHotel: Logged = { date: '2027-01-08', exerciseId: 'lying-curl', read: 'clean', load: 30, reps: 10 }
    const home = new Set(['mats', 'seated-leg-curl'])
    const here = slotAtGym(atGym([backedOff, atHotel]), undefined, home)
    expect(here.route).toEqual({ kind: 'own', exerciseId: 'leg-curl', passedOver: [] })
    expect(here.exercise).toBe(seated)
    expect(here.readings).toEqual([])
    expect(here.placement).toEqual({
      note: 'On Leg curls since Nordic negatives backed off; two clean readings in a row take the slot back to Nordic negatives.',
      returned: false,
    })
    // At the hotel again, the history’s pick still runs there, as before.
    expect(slotAtGym(atGym([backedOff, atHotel]), undefined, new Set(['mats', 'lying-leg-curl']))).toMatchObject({ exercise: lying, route: { kind: 'own', exerciseId: 'lying-curl' } })
  })

  it('a clean on that easier version from before the move counts once it has run since: the hotel’s lying curl counts for neither', () => {
    const atHotel: Logged = { date: '2027-01-08', exerciseId: 'lying-curl', read: 'clean', load: 30, reps: 10 }
    const home = new Set(['mats', 'seated-leg-curl'])
    const before = [curl('2026-12-01', 'clean'), backedOff, atHotel]
    const here = slotAtGym(atGym(before), undefined, home)
    expect(here.exercise).toBe(seated)
    expect(here.placement?.note).toBe('On Leg curls since Nordic negatives backed off: clean once; clean again and the slot goes back to Nordic negatives.')
    // Its first clean at home since the move makes the two (Shawn, Nov 2): the slot goes back to the Nordics.
    const back = slotAtGym(atGym([...before, curl('2027-01-12', 'clean')]), undefined, home)
    expect(back).toMatchObject({ exercise: nordicMat, placement: { note: 'Back on Nordic negatives: Leg curls read clean twice.', returned: true }, route: { kind: 'own', exerciseId: 'nordic' } })
  })

  it('a swap chosen for the session beats the gym, here or not; the route stays what the gym does without it', () => {
    const noMats = new Set(['seated-leg-curl'])
    const here = slotAtGym(atGym([]), 'lying-curl', noMats)
    expect(here.exercise).toBe(lying)
    expect(here.placement).toBeUndefined()
    expect(here.route).toEqual(slotAtGym(atGym([]), undefined, noMats).route)
    expect(slotAtGym(atGym([]), 'nordic', noMats).exercise).toBe(nordicMat)
  })
})

describe('a down period holds the slot on its easier version (Batch E, PROGRAM-QUESTIONS 182)', () => {
  const pause = { start: '2027-01-14', until: '2027-01-20', untilWords: 'Wednesday Jan 20', day: 2, of: 7 }
  const twoCleans = [backedOff, curl('2027-01-08', 'clean'), curl('2027-01-12', 'clean', 45)]

  it('two cleans on the leg curls inside the period: the slot stays on them, and the clean-twice step up repeats', () => {
    const { placed, p } = plan(input(twoCleans, { pause }))
    expect(placed.exercise).toBe(legCurl)
    expect(placed.placement).toEqual({
      note: 'On Leg curls since Nordic negatives backed off: clean twice, and the slot goes back to Nordic negatives after the down period (until Wednesday Jan 20).',
      returned: false,
    })
    // prescribe gets no pause in this helper: placement only. The curl's own clean twice would step up; session.ts passes the pause to both.
    expect(p.exerciseId).toBe('leg-curl')
    const [paused] = prescribe({ slot: nordicSlot, exercise: placed.exercise, substitutions: [legCurl, lyingCurl], readings: placed.readings, lastSets: placed.lastSets, week: 10, injuredSide: 'right', dumbbellMax: 80, redFlagActive: false, pause, ...(placed.placement ? { placement: placed.placement } : {}) })
    expect(paused).toMatchObject({ exerciseId: 'leg-curl', load: 45, basis: 'paused' })
  })

  it('after the period, the same history goes back to the Nordics', () => {
    expect(slotExercise(input(twoCleans)).exercise).toBe(nordic)
  })

  it('one clean or none reads as outside a period', () => {
    for (const entries of [[backedOff], [backedOff, curl('2027-01-08', 'clean')], [backedOff, curl('2027-01-08', 'hold')]]) {
      expect(slotExercise(input(entries, { pause }))).toEqual(slotExercise(input(entries)))
    }
  })

  it('a Swap chosen for the session still wins, the harder own exercise included (Shawn’s pick, not the engine’s step)', () => {
    expect(sessionSlotExercise(input(twoCleans, { pause }), 'nordic')).toEqual(sessionSlotExercise(input(twoCleans), 'nordic'))
    const everything = new Set<string>()
    const atGym = slotAtGym(input(twoCleans, { pause }), undefined, everything)
    expect(atGym.exercise).toBe(legCurl)
    expect(slotAtGym(input(twoCleans, { pause }), 'nordic', everything).exercise).toBe(nordic)
  })
})
