import { describe, expect, it } from 'vitest'
import type { MorningCheck, Workout } from '../schema/index.ts'
import { planSession } from '../app/session.ts'
import { homeLocation } from '../db/migrations.ts'
import { exerciseById, program } from '../program/program.ts'
import { slotFromAdded } from '../rules/addedSlots.ts'
import { effectiveSlot } from '../rules/effectiveSlot.ts'
import { availableEquipment } from '../rules/equipment.ts'
import { needsLoadPick } from '../rules/prefill.ts'
import type { SlotRoute } from '../rules/equipment.ts'
import type { Prescription } from '../rules/prescription.ts'
import { asksForRack, notHereSlots, swapOffer } from '../rules/runnerGym.ts'
import { DEFAULT_KIT, Settings, type Exercise, type RepUnit, type SetLog, type Slot } from '../schema/index.ts'
import {
  activeCardKey,
  buildSet,
  countField,
  countLabel,
  countWords,
  cuesWrittenFor,
  doneWords,
  draftFromSet,
  durationWords,
  heldBarWords,
  itemInSentence,
  loadLabel,
  loadMax,
  loadWords,
  loggedMaxPain,
  markedWords,
  markHereLabel,
  markOffLabel,
  mergeSwaps,
  movedByEngine,
  movedWords,
  nothingHereWords,
  notHereEntries,
  notHereWords,
  notInBagWords,
  notLoggedLabels,
  notLoggedWords,
  offerNotes,
  parseStoredSlotIds,
  parseStoredSwaps,
  holdsOffWords,
  pickNotHereWords,
  picksOnList,
  prescriptionWords,
  RACK_ASK_LB,
  rackAskWords,
  rackSetWords,
  rangeStopOptions,
  routeLines,
  setWords,
  showsLoad,
  sideLine,
  staleStoredSwaps,
  standingMarkFor,
  swapChoices,
  swapPick,
  swapsFromSets,
  swapValue,
  todayGymWords,
  todayTooLabel,
  warmUpWords,
  rampWords,
  rampSetsWords,
  timedSets,
  withoutEnginePicks,
  summaryCheckLine,
} from './SessionRunner.helpers.ts'

const ex = (over: Partial<Exercise> = {}): Exercise => ({ id: 'leg-press', name: 'Leg press', pattern: 'squat', equipment: 'press', loadType: 'stack', loadUnit: 'plate', increment: 1, loadDirection: 'up', unilateral: false, requires: [], ...over })
const slot = (over: Partial<Slot> = {}): Slot => ({ id: 'p1a-1', order: 1, label: '1', exerciseId: 'leg-press', sets: 3, repsMin: 10, repsMax: 12, repUnit: 'reps', unilateral: false, injuredOnly: false, prescriptionText: '3 × 10–12', cues: [], progressionRule: 'double-progression', substitutionIds: ['leg-press-45'], optional: false, rpeTarget: 6, rpeTargetEnd: 7, ...over })
const rx = (over: Partial<Prescription> = {}): Prescription => ({ exerciseId: 'leg-press', side: 'both', sets: 3, load: 8, loadUnit: 'plate', repsTarget: 10, repUnit: 'reps', basis: 'progress-load', note: '', ...over })
const set = (over: Partial<SetLog> = {}): SetLog => ({ id: 'x', workoutId: 'w1', slotId: 'p1a-1', exerciseId: 'leg-press', setNumber: 1, side: 'both', load: 8, loadUnit: 'plate', reps: 12, rpe: 7, painDuring: 2, stopped: false, loggedAt: '2026-11-03T22:00:00.000Z', ...over })

describe('fields and words', () => {
  it('seconds log as seconds; everything else as reps, labelled by unit', () => {
    expect(countField('seconds')).toBe('seconds')
    expect(countField('minutes')).toBe('reps')
    expect(countLabel('yards')).toBe('Yards')
    expect(countLabel('minutes')).toBe('Minutes')
  })
  it('shows a load field only where a load exists', () => {
    expect(showsLoad(ex())).toBe(true)
    expect(showsLoad(ex({ loadType: 'bodyweight' }))).toBe(false)
    expect(showsLoad(ex({ loadType: 'step-height', holdsLoad: 'dumbbell-each' }))).toBe(true)
    expect(showsLoad(ex({ loadType: 'step-height' }))).toBe(false)
  })
  it('caps dumbbell fields at the rack', () => {
    expect(loadMax(ex({ loadType: 'dumbbell-each', loadUnit: 'lb', increment: 5 }), 80)).toBe(80)
    expect(loadMax(ex(), 80)).toBeGreaterThan(80)
  })
  it('says loads and prescriptions in words', () => {
    expect(loadWords(8, ex())).toBe('plate 8')
    expect(loadWords(90, ex({ loadUnit: 'lb', increment: 5 }))).toBe('90 lb')
    expect(loadWords(40, ex({ loadUnit: 'lb', increment: 5, loadDirection: 'down' }))).toBe('assist 40 lb')
    expect(loadLabel(ex({ loadUnit: 'lb', increment: 5 }))).toBe('Weight (lb)')
    expect(loadLabel(ex({ loadUnit: 'lb', increment: 5, loadDirection: 'down' }))).toBe('Assist (lb)')
    expect(loadLabel(ex())).toBe('Plate')
    expect(loadWords(null, ex())).toBe('load to pick')
    expect(loadWords(20, ex({ loadType: 'dumbbell-each', loadUnit: 'lb', increment: 5 }))).toBe('20 lb each')
    expect(prescriptionWords(rx(), slot(), ex())).toBe('3 × 10 · RPE 6→7 · plate 8')
    expect(prescriptionWords(rx({ perSet: [{ load: 8, reps: 12 }, { load: 8, reps: 11 }] }), slot(), ex())).toBe('3 × 12, 11 · RPE 6→7 · plate 8')
  })
  it('says a set in words, including unrated pain and a stop', () => {
    expect(setWords(set(), 'reps', ex())).toBe('12 × plate 8 · RPE 7 · pain 2')
    expect(setWords(set({ painDuring: undefined, stopped: true, stopReason: 'sharp-joint-line-pain' }), 'reps', ex())).toBe('12 × plate 8 · RPE 7 · pain not rated · stopped: sharp joint-line pain')
  })
  it('offers only the engine’s range stops, never past the phase stop', () => {
    expect(rangeStopOptions(45)).toEqual([45])
    expect(rangeStopOptions(30)).toEqual([45, 30])
  })
})

describe('buildSet and draftFromSet', () => {
  it('stores seconds as seconds, drops unrated pain and RPE, records a stop', () => {
    const plank = slot({ repUnit: 'seconds' })
    const s = buildSet({ workoutId: 'w1', slot: plank, repUnit: 'seconds', exercise: ex({ loadType: 'time', loadUnit: 's', increment: 5 }), side: 'right', setNumber: 1, draft: { load: 0, count: 20, rpe: null, pain: null }, loggedAt: 't', stop: 'form' })
    expect(s).toMatchObject({ seconds: 20, stopped: true, stopReason: 'form', loadUnit: 's', load: 0 })
    expect(s.reps).toBeUndefined()
    expect(s.painDuring).toBeUndefined()
    expect(s.rpe).toBeUndefined()
  })
  it('stores a step-up’s dumbbells in lb with its height', () => {
    const stepUp = ex({ id: 'step-up', loadType: 'step-height', loadUnit: 'in', increment: 2, holdsLoad: 'dumbbell-each' })
    expect(buildSet({ workoutId: 'w1', slot: slot(), repUnit: 'reps', exercise: stepUp, side: 'right', setNumber: 1, draft: { load: 20, count: 10, rpe: 6, pain: 1, heightIn: 6 }, loggedAt: 't' })).toMatchObject({ load: 20, loadUnit: 'lb', heightIn: 6, reps: 10 })
  })
  it('stamps rackCapped when the side’s prescription was rack-capped, so the set never counts as clean; otherwise no field (M4b)', () => {
    const rdl = ex({ id: 'db-rdl', loadType: 'dumbbell-each', loadUnit: 'lb', increment: 5 })
    const input = { workoutId: 'w1', slot: slot(), repUnit: 'reps' as const, exercise: rdl, side: 'both' as const, setNumber: 1, draft: { load: 25, count: 10, rpe: 7, pain: 1 }, loggedAt: 't' }
    expect(buildSet({ ...input, rackCapped: true })).toMatchObject({ load: 25, loadUnit: 'lb', rackCapped: true })
    expect('rackCapped' in buildSet({ ...input, rackCapped: false })).toBe(false)
    expect('rackCapped' in buildSet(input)).toBe(false)
  })
  it('round-trips a logged set into a draft', () => {
    expect(draftFromSet(set())).toEqual({ load: 8, count: 12, rpe: 7, pain: 2 })
  })
})

describe('swaps', () => {
  const plans = [{ slot: slot(), prescriptions: [{ exerciseId: 'leg-press' }] }]
  it('recovers a user swap from the sets', () => {
    expect(swapsFromSets(plans, [set({ exerciseId: 'leg-press-45' })])).toEqual({ 'p1a-1': 'leg-press-45' })
  })
  it('does not mistake an engine move for a swap', () => {
    const moved = [{ slot: slot(), prescriptions: [{ exerciseId: 'smith-box-squat' }] }]
    expect(swapsFromSets(moved, [set({ exerciseId: 'smith-box-squat' })])).toEqual({})
    expect(swapsFromSets(plans, [set()])).toEqual({})
  })
  it('recovers a choice of the slot’s own exercise when the engine had moved it: the gym routed it, Shawn ran it anyway (M4b)', () => {
    const moved = [{ slot: slot(), prescriptions: [{ exerciseId: 'goblet-squat-bench' }] }]
    expect(swapsFromSets(moved, [set()])).toEqual({ 'p1a-1': 'leg-press' })
  })
  it('stored choices win, and a stored null returns the slot to its own exercise', () => {
    expect(mergeSwaps({ a: 'x' }, { a: null, b: 'y' })).toEqual({ a: undefined, b: 'y' })
  })
  it('a stored swap of what the plan now runs without it is no swap: a mark since made it the gym’s pick (M4b)', () => {
    const engine = new Map([['a', 'leg-press'], ['b', 'goblet-squat-bench']])
    expect(withoutEnginePicks({ a: 'leg-press', b: 'smith-box-squat', c: 'x', d: undefined }, engine)).toEqual({ a: undefined, b: 'smith-box-squat', c: 'x', d: undefined })
  })
  it('a swap no longer on its slot’s list is no swap: a Program edit took it off, so the engine runs the slot’s history (M6)', () => {
    const edited = [{ slot: slot({ substitutionIds: ['leg-press-45'] }) }, { slot: slot({ id: 'p1a-2', exerciseId: 'seated-leg-curl', substitutionIds: ['lying-leg-curl'] }) }]
    expect(picksOnList({ 'p1a-1': 'goblet-squat-bench', 'p1a-2': 'lying-leg-curl', 'p1a-3': 'x', 'p1a-4': undefined }, edited)).toEqual({
      'p1a-1': undefined,
      'p1a-2': 'lying-leg-curl',
      'p1a-3': undefined,
      'p1a-4': undefined,
    })
    // The slot's own exercise is on its list: Swap offers it once the engine has moved the slot.
    expect(picksOnList({ 'p1a-1': 'leg-press' }, edited)).toEqual({ 'p1a-1': 'leg-press' })
  })
  it('names the stored swaps a Program edit took off their slot’s list, to forget; a stored null and a slot not planned stay', () => {
    const edited = [{ slot: slot({ substitutionIds: ['leg-press-45'] }) }, { slot: slot({ id: 'p1a-2', exerciseId: 'seated-leg-curl', substitutionIds: [] }) }]
    expect(staleStoredSwaps({ 'p1a-1': 'goblet-squat-bench', 'p1a-2': null, 'p1a-9': 'x' }, edited)).toEqual(['p1a-1'])
    expect(staleStoredSwaps({ 'p1a-1': 'leg-press-45' }, edited)).toEqual([])
  })
  it('a slot nothing here runs is held again once a Program edit takes its swap off the list (PROGRAM-QUESTIONS 83, M6)', () => {
    // A hotel gym started empty: nothing on Session A slot 1's list is here, so it waits for Skip, Do it anyway or Swap.
    const hotel = { ...homeLocation(0, program.planetFitness, '2026-11-02', program.equipmentListVersion), id: 'loc-1', name: 'Hotel gym', startedFrom: 'empty' as const, present: [], dumbbellMaxLb: 0 }
    const template = program.templates.find((t) => t.id === 'p1-a')
    if (!template) throw new Error('no Session A')
    const settings = Settings.parse({ injuredSide: 'right', startDate: '2026-11-02', dumbbellMax: 80, restTimerSeconds: 60, painPerSet: false })
    const stored = { 'p1a-1': 'goblet-squat-bench' }
    // The runner's composition (SessionRunner.tsx): engine picks, swaps, then the slots held.
    const held = (programOverrides: { slotId: string; substitutionIds: string[]; editedOn: string }[]) => {
      const history = { workouts: [], setLogs: [], morningChecks: [], runs: [], gateTests: [], sessionMoves: [], programOverrides }
      const input = { template, week: 2, settings, history, gym: { location: hotel, kit: DEFAULT_KIT }, before: '2026-11-10' }
      const unswapped = planSession(input)
      const engine = new Map(unswapped.map((p) => [p.slot.id, p.exercise.id]))
      const chosen = picksOnList(withoutEnginePicks(mergeSwaps(swapsFromSets(unswapped, []), stored), engine), unswapped)
      const plans = planSession({ ...input, chosenExercise: chosen })
      const swapped = new Set(Object.keys(chosen).filter((id) => chosen[id] !== undefined))
      const p1 = plans.find((p) => p.slot.id === 'p1a-1')
      return { runs: p1?.exercise.id, held: notHereSlots(plans.map((p) => ({ slotId: p.slot.id, route: p.route })), new Set(), swapped, new Set()).has('p1a-1') }
    }
    expect(held([])).toEqual({ runs: 'goblet-squat-bench', held: false })
    // Goblet squat to a bench taken off p1a-1's list mid-session: the slot runs its own leg press, which isn't here, so it waits again.
    expect(held([{ slotId: 'p1a-1', substitutionIds: ['leg-press-45', 'smith-box-squat'], editedOn: '2026-11-10' }])).toEqual({ runs: 'leg-press', held: true })
  })
  it('parses the stored Do it anyway slots defensively', () => {
    expect(parseStoredSlotIds(null)).toEqual([])
    expect(parseStoredSlotIds('not json')).toEqual([])
    expect(parseStoredSlotIds('{"a":1}')).toEqual([])
    expect(parseStoredSlotIds('["p2a-1", 3, null, "p2a-7"]')).toEqual(['p2a-1', 'p2a-7'])
  })
  it('parses stored swaps defensively', () => {
    expect(parseStoredSwaps(null)).toEqual({})
    expect(parseStoredSwaps('not json')).toEqual({})
    expect(parseStoredSwaps('[1]')).toEqual({})
    expect(parseStoredSwaps('{"a":"x","b":null,"c":3}')).toEqual({ a: 'x', b: null })
  })
})

describe('summary helpers', () => {
  it('finds the highest logged pain', () => {
    expect(loggedMaxPain([set({ painDuring: 2 }), set({ painDuring: 4 }), set({ painDuring: undefined })])).toBe(4)
    expect(loggedMaxPain([set({ painDuring: undefined })])).toBeNull()
  })
  it('says a duration in words', () => {
    expect(durationWords('2026-11-03T22:00:00Z', '2026-11-03T22:48:00Z')).toBe('48 min')
    expect(durationWords('2026-11-03T22:00:00Z', '2026-11-04T00:05:00Z')).toBe('2 h 5 min')
    expect(durationWords(undefined, 'x')).toBeNull()
    expect(durationWords('2026-11-03T22:00:00Z', '2026-11-03T22:00:20Z')).toBeNull()
  })
})

describe('a slot and an exercise that count sides differently (design section 4)', () => {
  it('a unilateral slot on a two-legged exercise is done one leg at a time; the reverse logs as both sides (PROGRAM-QUESTIONS 54)', () => {
    expect(sideLine(true, false)).toBe('One leg at a time: the slot is single-leg in the program, so each side logs on its own, injured side first.')
    expect(sideLine(false, true)).toBe('Logs as both sides: this slot is two-legged in the program.')
    expect(sideLine(true, true)).toBeNull()
    expect(sideLine(false, false)).toBeNull()
  })
  it('Phase 2 A1 at a hotel with a bench and 25 lb dumbbells: the single-leg leg press moves to the goblet squat, and says so', () => {
    const slot = program.templates.find((t) => t.id === 'p2-a')?.slots.find((s) => s.id === 'p2a-1')
    expect(slot?.unilateral).toBe(true)
    expect(sideLine(slot?.unilateral ?? false, exerciseById('goblet-squat-bench').unilateral)).toMatch(/^One leg at a time/)
  })
})

describe('per-side words', () => {
  it('says "each side" on two-sided slots the program counts per side', () => {
    const pallof = slot({ repsMin: 10, repsMax: 10, perSideLabel: 'each side', rpeTarget: undefined, rpeTargetEnd: undefined })
    expect(prescriptionWords(rx({ sets: 2, repsTarget: 10 }), pallof, ex())).toBe('2 × 10 each side · plate 8')
    expect(countWords(10, 'reps', pallof)).toBe('10 reps each side')
    expect(countWords(30, 'seconds', slot({ unilateral: true, perSideLabel: 'each leg' }))).toBe('30 s')
  })
  it('an added farmer’s hold swapped to its side plank reads "each side" on the card, as program.md writes the side plank', () => {
    const hold = exerciseById('farmers-hold')
    const plank = exerciseById('side-plank')
    const added = slotFromAdded({ id: 'added-h', sets: 3, repsMin: 30, repsMax: 45 }, hold, 1, 10)
    expect(countWords(30, 'seconds', added)).toBe('30 s')
    const swapped = effectiveSlot(added, plank)
    expect(countWords(30, 'seconds', swapped)).toBe('30 s each side')
    expect(prescriptionWords(rx({ exerciseId: 'side-plank', sets: 3, repsTarget: 30, repUnit: 'seconds', load: null, loadUnit: 's' }), swapped, plank)).toBe('3 × 30 s each side')
  })
})

describe('the gym in words (M4b, design section 4)', () => {
  const items = program.equipment
  const hotel = 'Hotel gym'
  const nameOf = (id: string) => exerciseById(id).name

  it('names a list item inside a sentence, keeping the Smith machine’s capital', () => {
    expect(itemInSentence('Seated leg press')).toBe('seated leg press')
    expect(itemInSentence('Smith machine')).toBe('Smith machine')
    expect(itemInSentence('45° leg press')).toBe('45° leg press')
  })

  it('a moved slot: what isn’t here, what runs instead, and what else was passed over', () => {
    const route: SlotRoute = {
      kind: 'moved',
      exerciseId: 'goblet-squat-bench',
      passedOver: [
        { exerciseId: 'leg-press', missing: ['seated-leg-press'] },
        { exerciseId: 'leg-press-45', missing: ['leg-press-45'] },
        { exerciseId: 'smith-box-squat', missing: ['smith-machine'] },
      ],
    }
    expect(movedWords(route, 'Goblet squat to a bench', hotel, items)).toBe('Not at Hotel gym: Seated leg press. Using Goblet squat to a bench (no 45° leg press, no Smith machine).')
  })
  it('a moved slot names what the own exercise lacks once, and an item left out of the bag as the bag’s', () => {
    const one: SlotRoute = { kind: 'moved', exerciseId: 'goblet-squat-bench', passedOver: [{ exerciseId: 'smith-box-squat', missing: ['smith-machine', 'flat-bench'] }, { exerciseId: 'x', missing: ['flat-bench'] }] }
    expect(movedWords(one, 'Split squat', hotel, items)).toBe('Not at Hotel gym: Smith machine and flat bench. Using Split squat.')
    const strap: SlotRoute = { kind: 'moved', exerciseId: 'lateral-band-walk', passedOver: [{ exerciseId: 'cable-hip-abduction', missing: ['cable-station', 'ankle-strap'] }] }
    expect(movedWords(strap, 'Lateral band walk', hotel, items)).toBe('Not at Hotel gym: Cable station. Not in your bag: Cable ankle strap. Using Lateral band walk.')
    const bosu: SlotRoute = { kind: 'moved', exerciseId: 'single-leg-balance', passedOver: [{ exerciseId: 'balance-mat-bosu', missing: ['mats'] }] }
    expect(movedWords(bosu, 'Single-leg balance', hotel, items)).toBe('Not at Hotel gym: Mats. Using Single-leg balance.')
  })

  it('a slot with nothing here says what its exercise needs', () => {
    expect(nothingHereWords('Step-off landing from a 6–8 in. step, stuck for 2 s', ['step-platforms'], items)).toBe('Nothing here for Step-off landing from a 6–8 in. step, stuck for 2 s (needs step platforms).')
    expect(nothingHereWords('Single-leg calf raise on a step', [{ anyOf: ['step-platforms', 'stair'] }], items)).toBe('Nothing here for Single-leg calf raise on a step (needs step platforms or stair).')
  })

  it('offers to mark an item here, or not here, by its list name', () => {
    expect(markHereLabel('step-platforms', items)).toBe('Mark step platforms here')
    expect(markHereLabel('smith-machine', items)).toBe('Mark Smith machine here')
    expect(markOffLabel('smith-machine', items)).toBe("Smith machine isn't here: mark it")
    expect(markOffLabel('step-platforms', items)).toBe("Step platforms aren't here: mark them")
  })

  it('says what no mark at a gym adds: a carried item is the bag’s', () => {
    expect(notInBagWords(['ankle-strap'], items)).toBe('Not in your bag: cable ankle strap. "In your bag" in Where you train adds it.')
  })
  it('the warm-up drops the bike where there is none, and says nothing else is written for it', () => {
    expect(warmUpWords({ bike: 5, circuit: 5, total: 10 })).toEqual({ line: 'Warm-up · bike 5 min · knee circuit 5 min', noBike: null })
    expect(warmUpWords({ bike: null, circuit: 10, total: 10 })).toEqual({ line: 'Warm-up · knee circuit 10 min', noBike: 'No upright bike here; nothing else is written for it.' })
    expect(warmUpWords({ bike: 5, circuit: 3, total: 8 }).line).toBe('Warm-up · bike 5 min · knee circuit 3 min')
  })

  describe('warm-up sets in words (PROGRAM-QUESTIONS 165)', () => {
    const sets = (...s: [number, number, ('empty-bar' | 'empty-sled' | 'lightest-plate' | null)?][]) => ({ kind: 'sets' as const, workingLoad: 100, sets: s.map(([load, reps, light]) => ({ load, reps, light: light ?? null })) })
    it('says the sets above set 1, never logged, in the card’s load words', () => {
      expect(rampWords(sets([90, 8], [135, 5]), exerciseById('leg-press'))).toBe('Warm-up sets first, not logged: 90 lb × 8, then 135 lb × 5.')
      expect(rampWords(sets([20, 8], [30, 5]), exerciseById('db-bench-press'))).toBe('Warm-up sets first, not logged: 20 lb each × 8, then 30 lb each × 5.')
      expect(rampWords(sets([20, 8], [30, 5]), exerciseById('goblet-squat-bench'))).toBe('Warm-up sets first, not logged: 20 lb × 8, then 30 lb × 5.')
    })
    it('one set in the singular; the empty bar, the empty sled and the lightest plate in words', () => {
      expect(rampWords(sets([0, 8, 'empty-bar']), exerciseById('smith-box-squat'))).toBe('Warm-up set first, not logged: empty bar × 8.')
      expect(rampWords(sets([0, 8, 'empty-sled']), exerciseById('leg-press-45'))).toBe('Warm-up set first, not logged: empty sled × 8.')
      expect(rampWords(sets([5, 8, 'lightest-plate'], [10, 5]), exerciseById('chest-press-machine'))).toBe('Warm-up sets first, not logged: the lightest plate × 8, then 10 lb × 5.')
      expect(rampSetsWords(sets([90, 8], [135, 5]), exerciseById('leg-press'))).toBe('90 lb × 8, then 135 lb × 5')
    })
    it('a load too light to warm up for says so; nothing on a stack or dumbbells says nothing', () => {
      expect(rampWords({ kind: 'none', why: 'too-light', workingLoad: 5 }, exerciseById('db-bench-press'))).toBe('No warm-up sets today: 5 lb each is light enough to start on.')
      expect(rampWords({ kind: 'none', why: 'too-light', workingLoad: 0 }, exerciseById('smith-box-squat'))).toBe('No warm-up sets today: the empty bar is light enough to start on.')
      expect(rampWords({ kind: 'none', why: 'too-light', workingLoad: 0 }, exerciseById('leg-press-45'))).toBe('No warm-up sets today: the empty sled is light enough to start on.')
      expect(rampWords({ kind: 'none', why: 'too-light', workingLoad: 0 }, exerciseById('db-bench-press'))).toBeNull()
    })
    it('no line for an exercise the rule doesn’t cover, a first time, one already warm, or a late entry', () => {
      for (const why of ['not-eligible', 'no-load', 'already-warm', 'late'] as const) expect(rampWords({ kind: 'none', why, workingLoad: 40 }, exerciseById('db-bench-press')), why).toBeNull()
      expect(rampSetsWords({ kind: 'none', why: 'late' }, exerciseById('leg-press'))).toBeNull()
    })
  })

  it('Swap lists the slot’s own exercise and its substitutions in order, each here or not with what it needs', () => {
    const own = exerciseById('leg-press')
    const subs = ['leg-press-45', 'smith-box-squat', 'goblet-squat-bench'].map(exerciseById)
    const choices = swapChoices(own, subs, new Set(['flat-bench', 'dumbbells']), items)
    expect(choices.map((c) => [c.exercise.id, c.here, c.words])).toEqual([
      ['leg-press', false, 'Not here · needs seated leg press'],
      ['leg-press-45', false, 'Not here · needs 45° leg press'],
      ['smith-box-squat', false, 'Not here · needs Smith machine'],
      ['goblet-squat-bench', true, 'Here'],
    ])
    expect(choices[2]?.missing).toEqual(['smith-machine'])
  })

  it('Swap says why the exercise the plan runs is off the card, rather than a plain Here that does nothing when tapped (M4b review)', () => {
    const own = exerciseById('db-rdl')
    const subs = ['single-leg-rdl', 'smith-rdl'].map(exerciseById)
    const hotelHas = new Set(['dumbbells'])
    const past = swapChoices(own, subs, hotelHas, items, { exerciseId: 'db-rdl', why: 'rack', cardName: 'Single-leg RDL', rackLb: 25 })
    expect(past.map((c) => c.words)).toEqual(['Here · past the 25 lb rack: the slot stays on Single-leg RDL', 'Here', 'Not here · needs Smith machine'])
    expect(holdsOffWords('Dumbbell Romanian deadlift', 'rack', 'Single-leg RDL', 25)).toBe('Dumbbell Romanian deadlift is past this gym’s 25 lb rack, so the slot stays on Single-leg RDL.')
    expect(holdsOffWords('Split squat', 'rack', 'Bulgarian split squat', 0)).toBe('There are no dumbbells here for Split squat, so the slot stays on Bulgarian split squat.')
    // The Nordics backed off to the single-leg seated curl at any gym: picking them keeps the back-off.
    const nordics = swapChoices(exerciseById('nordic-negatives'), ['single-leg-seated-leg-curl'].map(exerciseById), new Set(['mats', 'lat-pulldown', 'seated-leg-curl']), items, {
      exerciseId: 'nordic-negatives',
      why: 'engine',
      cardName: 'Single-leg seated leg curl',
      rackLb: 80,
    })
    expect(nordics[0]?.words).toBe('Here · backed off today: the slot stays on Single-leg seated leg curl')
    expect(holdsOffWords('Nordic hamstring negatives', 'engine', 'Single-leg seated leg curl', 80)).toBe('Nordic hamstring negatives backed off, so the slot stays on Single-leg seated leg curl today.')
  })

  it('cues written for the slot’s own exercise say so when another exercise runs: moved, swapped or backed off (M4b review)', () => {
    expect(cuesWrittenFor('leg-press', 'goblet-squat-bench', nameOf)).toBe('Cues written for Leg press, both legs')
    expect(cuesWrittenFor('nordic-negatives', 'single-leg-seated-leg-curl', nameOf)).toBe('Cues written for Nordic hamstring negatives')
    expect(cuesWrittenFor('leg-press', 'leg-press', nameOf)).toBeNull()
  })

  it('Finish lists the slots the gym changed, in words', () => {
    const route = (kind: SlotRoute['kind'], from: string): SlotRoute => ({ kind, exerciseId: from, passedOver: [{ exerciseId: from, missing: ['x'] }] })
    const plans = [
      { slot: { id: 'a1', label: '1' }, exercise: { id: 'goblet-squat-bench', name: 'Goblet squat to a bench' }, route: route('moved', 'leg-press') },
      { slot: { id: 'a2', label: '2' }, exercise: { id: 'db-rdl', name: 'Dumbbell Romanian deadlift' }, route: { kind: 'own' as const, exerciseId: 'db-rdl', passedOver: [] } },
      { slot: { id: 'a7', label: '7' }, exercise: { id: 'step-off-landing', name: 'Step-off landing' }, route: route('none', 'step-off-landing') },
      { slot: { id: 'a8', label: '8' }, exercise: { id: 'leg-extension', name: 'Leg extension' }, route: route('moved', 'leg-extension') },
    ]
    const entries = notHereEntries(plans, new Set(['a8']), (id) => ({ 'leg-press': 'Leg press, both legs', 'step-off-landing': 'Step-off landing', 'leg-extension': 'Leg extension' })[id] ?? id)
    expect(entries.map((e) => e.label)).toEqual(['1', '7', '8'])
    expect(notHereWords(hotel, entries)).toBe('Not at Hotel gym: 1 Leg press, both legs (Goblet squat to a bench instead); 7 Step-off landing (nothing here); 8 Leg extension (done anyway).')
    const anyway = notHereEntries([plans[2] as (typeof plans)[number]], new Set(['a7']), () => 'Step-off landing')
    expect(notHereWords(hotel, anyway)).toBe('Not at Hotel gym: 7 Step-off landing (nothing here; done anyway).')
    expect(notHereWords(hotel, [])).toBeNull()
  })

  it('the card says what the gym did to the slot, unless a swap chose', () => {
    const moved: SlotRoute = { kind: 'moved', exerciseId: 'goblet-squat-bench', passedOver: [{ exerciseId: 'leg-press', missing: ['seated-leg-press'] }] }
    const base = { gymName: hotel, items, nameOf }
    expect(routeLines({ ...base, route: moved, swapped: false })).toEqual(['Not at Hotel gym: Seated leg press. Using Goblet squat to a bench.'])
    expect(routeLines({ ...base, route: moved, swapped: true })).toEqual([])
    const none: SlotRoute = { kind: 'none', exerciseId: 'step-off-landing', passedOver: [{ exerciseId: 'step-off-landing', missing: ['step-platforms'] }] }
    expect(routeLines({ ...base, route: none, swapped: false })).toEqual(['Nothing here for Step-off landing from a 6–8 in. step, stuck for 2 s (needs step platforms).'])
    const own: SlotRoute = { kind: 'own', exerciseId: 'db-rdl', passedOver: [] }
    expect(routeLines({ ...base, route: own, swapped: false })).toEqual([])
    // A rack cap is the engine's note on the card ("… 25 lb, rack-capped, so the session won’t count as clean."): the gym's lines don't say it twice.
    expect(routeLines({ ...base, route: own, swapped: true })).toEqual([])
  })

  it('says the engine moved the card only when the gym did not: the gym’s line says that', () => {
    const moved: SlotRoute = { kind: 'moved', exerciseId: 'goblet-squat-bench', passedOver: [{ exerciseId: 'leg-press', missing: ['seated-leg-press'] }] }
    const own: SlotRoute = { kind: 'own', exerciseId: 'leg-press', passedOver: [] }
    expect(movedByEngine('leg-press', 'goblet-squat-bench', moved, false)).toBe(false)
    expect(movedByEngine('leg-press', 'smith-box-squat', moved, false)).toBe(true)
    expect(movedByEngine('leg-press', 'leg-press-45', own, false)).toBe(true)
    expect(movedByEngine('leg-press', 'leg-press', own, false)).toBe(false)
    expect(movedByEngine('leg-press', 'leg-press-45', own, true)).toBe(false)
    // A rack move is said once, by the prescription's note.
    expect(movedByEngine('dumbbell-rdl', 'single-leg-rdl', { kind: 'own', exerciseId: 'dumbbell-rdl' }, false, true)).toBe(false)
  })

  it('a Swap pick of what the gym would run anyway is no swap', () => {
    expect(swapValue('goblet-squat-bench', 'goblet-squat-bench')).toBeNull()
    expect(swapValue('leg-press', 'goblet-squat-bench')).toBe('leg-press')
    expect(swapValue(null, 'goblet-squat-bench')).toBeNull()
  })

  it('a Swap pick: what it stores, when it is Do it anyway, and when it may offer a mark', () => {
    // A moved slot: picking the slot's own exercise is a swap, and may offer a mark; the gym's own pick is none.
    expect(swapPick({ pickId: 'leg-press', engineId: 'goblet-squat-bench', cardId: 'goblet-squat-bench', routeKind: 'moved' })).toEqual({ value: 'leg-press', anyway: false, offers: true })
    expect(swapPick({ pickId: 'goblet-squat-bench', engineId: 'goblet-squat-bench', cardId: 'smith-box-squat', routeKind: 'moved' })).toEqual({ value: null, anyway: false, offers: true })
    // A slot with nothing here: its own exercise (the gym's pick) is Do it anyway, which makes its own offer.
    expect(swapPick({ pickId: 'seated-leg-curl', engineId: 'seated-leg-curl', cardId: 'seated-leg-curl', routeKind: 'none' })).toEqual({ value: null, anyway: true, offers: false })
    expect(swapPick({ pickId: 'lying-leg-curl', engineId: 'seated-leg-curl', cardId: 'seated-leg-curl', routeKind: 'none' })).toEqual({ value: 'lying-leg-curl', anyway: false, offers: true })
    // Back to (no pick) and a pick of what is already on the card offer nothing.
    expect(swapPick({ pickId: null, engineId: 'seated-leg-curl', cardId: 'lying-leg-curl', routeKind: 'none' })).toEqual({ value: null, anyway: false, offers: false })
    expect(swapPick({ pickId: 'smith-box-squat', engineId: 'goblet-squat-bench', cardId: 'smith-box-squat', routeKind: 'moved' })).toEqual({ value: 'smith-box-squat', anyway: false, offers: false })
  })

  it('the exercise whose lacks the card keeps offering to mark: a slot run anyway, or a swap, after a reload too', () => {
    const none = { routeKind: 'none' as const, routeExerciseId: 'seated-leg-curl' }
    expect(standingMarkFor({ ...none, swapped: false, cardId: 'seated-leg-curl', held: false })).toBe('seated-leg-curl')
    // Still held for Skip or Do it anyway: those are the offers, not a mark.
    expect(standingMarkFor({ ...none, swapped: false, cardId: 'seated-leg-curl', held: true })).toBeNull()
    expect(standingMarkFor({ ...none, swapped: true, cardId: 'lying-leg-curl', held: false })).toBe('lying-leg-curl')
    expect(standingMarkFor({ routeKind: 'moved', routeExerciseId: 'goblet-squat-bench', swapped: true, cardId: 'smith-box-squat', held: false })).toBe('smith-box-squat')
    expect(standingMarkFor({ routeKind: 'moved', routeExerciseId: 'goblet-squat-bench', swapped: false, cardId: 'goblet-squat-bench', held: false })).toBeNull()
    expect(standingMarkFor({ routeKind: 'own', routeExerciseId: 'leg-press', swapped: false, cardId: 'leg-press', held: false })).toBeNull()
  })

  it('a swap to an exercise that isn’t here says so in words; dumbbells and the bag are said by the offer’s own lines', () => {
    const hotelHas = new Set(['flat-bench', 'dumbbells'])
    expect(pickNotHereWords(exerciseById('smith-box-squat'), hotelHas, hotel, items)).toBe('Not at Hotel gym: Smith machine, which Smith machine box squat needs.')
    expect(pickNotHereWords(exerciseById('smith-box-squat'), new Set<string>(), hotel, items)).toBe('Not at Hotel gym: Smith machine and flat bench, which Smith machine box squat needs.')
    expect(pickNotHereWords(exerciseById('single-leg-calf-raise-step'), hotelHas, hotel, items)).toBe('Not at Hotel gym: Step platforms or stair, which Single-leg calf raise on a step needs.')
    expect(pickNotHereWords(exerciseById('goblet-squat-bench'), hotelHas, hotel, items)).toBeNull()
    expect(pickNotHereWords(exerciseById('goblet-squat-bench'), new Set(['flat-bench']), hotel, items)).toBeNull()
    expect(pickNotHereWords(exerciseById('cable-hip-abduction'), new Set(['cable-station']), hotel, items)).toBeNull()
  })

  it('turns a mark offer into words and buttons, dropping what is already marked', () => {
    const hotelHas = new Set(['flat-bench', 'dumbbells', 'mini-band'])
    const notHerePick = swapOffer(exerciseById('goblet-squat-bench'), exerciseById('smith-box-squat'), hotelHas, ['ankle-strap', 'mini-band'])
    expect(offerNotes(notHerePick, hotelHas, items)).toEqual({ lines: [], marks: [{ id: 'smith-machine', here: true, label: 'Mark Smith machine here' }] })
    expect(offerNotes(notHerePick, new Set([...hotelHas, 'smith-machine']), items)).toEqual({ lines: [], marks: [] })
    const strap = swapOffer(exerciseById('lateral-band-walk'), exerciseById('cable-hip-abduction'), hotelHas, ['ankle-strap', 'mini-band'])
    expect(offerNotes(strap, hotelHas, items)).toEqual({
      lines: ['Not in your bag: cable ankle strap. "In your bag" in Where you train adds it.'],
      marks: [{ id: 'cable-station', here: true, label: 'Mark cable station here' }],
    })
    const noRack = swapOffer(exerciseById('smith-rdl'), exerciseById('db-rdl'), new Set<string>(), [])
    expect(offerNotes(noRack, new Set<string>(), items)).toEqual({ lines: ["No dumbbells here: each gym's dumbbells are set in Where you train."], marks: [] })
    const pf = new Set(['seated-leg-press', 'flat-bench', 'dumbbells'])
    const herePick = swapOffer(exerciseById('leg-press'), exerciseById('goblet-squat-bench'), pf, [])
    expect(offerNotes(herePick, pf, items)).toEqual({ lines: [], marks: [{ id: 'seated-leg-press', here: false, label: "Seated leg press isn't here: mark it" }] })
    expect(offerNotes(herePick, new Set(['flat-bench', 'dumbbells']), items)).toEqual({ lines: [], marks: [] })
    expect(offerNotes(null, pf, items)).toEqual({ lines: [], marks: [] })
  })

  it('says a mark was saved, and where: Today offers "It’s back" only for the gym it plans at (M4b review)', () => {
    expect(markedWords(true, 'step-platforms', hotel, items, true)).toBe('Marked here at Hotel gym: step platforms.')
    expect(markedWords(false, 'smith-machine', hotel, items, true)).toBe('Marked not here at Hotel gym: Smith machine. Today offers "It\'s back" when it is.')
    // The runner's Change moved only this session: Today still plans at Planet Fitness and shows its mark-offs, not this gym's.
    expect(markedWords(false, 'cable-station', 'Marriott Downtown', items, false)).toBe('Marked not here at Marriott Downtown: cable station. Where you train clears it when it is back.')
  })
  it('says where Today plans when the session runs at another gym', () => {
    expect(todayGymWords('Planet Fitness')).toBe('Today plans at Planet Fitness; a Change here moves only this session.')
    expect(todayTooLabel('Marriott Downtown')).toBe('Use Marriott Downtown on Today too')
  })

  it('the Done bar on a slot with nothing here, and the end of the session with such slots left', () => {
    expect(heldBarWords(hotel)).toBe('Nothing at Hotel gym for this slot: Skip, Do it anyway or Swap.')
    expect(doneWords(hotel, [])).toEqual({ heading: 'Every required set is logged', line: 'Optional slots are still open below. Finish when you’re done.', bar: 'Every required set is logged.' })
    expect(doneWords(hotel, ['7 Step-off landing', '8 Lateral step-down'])).toEqual({
      heading: 'Every set Hotel gym can run is logged',
      line: 'Nothing here for 7 Step-off landing; 8 Lateral step-down: tap a row below for Skip, Do it anyway or Swap, or finish.',
      bar: 'Every set Hotel gym can run is logged.',
    })
  })

  it('separates slots with semicolons, since program.md’s names carry their own commas', () => {
    expect(doneWords(hotel, ['2 Seated leg curl', '5 Copenhagen plank, short lever']).line).toBe(
      'Nothing here for 2 Seated leg curl; 5 Copenhagen plank, short lever: tap a row below for Skip, Do it anyway or Swap, or finish.',
    )
    // The M4b drive's Finish at Marriott Downtown: one set of the goblet squat logged, the rest open.
    expect(notLoggedWords({ notLogged: ['4 Lat pulldown', '5 Cable hip abduction, ankle strap', '6 Single-leg calf raise on a step'], notFinished: ['1 Goblet squat to a bench'] }, true)).toBe(
      'Not logged: 4 Lat pulldown; 5 Cable hip abduction, ankle strap; 6 Single-leg calf raise on a step. They keep last session’s prescription. Not finished: 1 Goblet squat to a bench.',
    )
  })

  it('Finish says every required set is logged, or every other one when the not-here line names some', () => {
    const none = { notLogged: [], notFinished: [] }
    expect(notLoggedWords(none, false)).toBe('Every required set is logged.')
    expect(notLoggedWords(none, true)).toBe('Every other required set is logged.')
    expect(notLoggedWords({ notLogged: ['3 Dumbbell bench press'], notFinished: [] }, false)).toBe('Not logged: 3 Dumbbell bench press. They keep last session’s prescription.')
  })
  it('Finish calls a slot with some of its sets logged not finished, not not logged (M4b review)', () => {
    expect(notLoggedWords({ notLogged: [], notFinished: ['1 Goblet squat to a bench'] }, false)).toBe('Not finished: 1 Goblet squat to a bench.')
  })

  it('Finish’s not-logged list leaves out the slots the not-here line already names', () => {
    const plans = [
      { slot: { id: 'a1', label: '1', optional: false }, exercise: { name: 'Goblet squat to a bench' } },
      { slot: { id: 'a7', label: '7', optional: false }, exercise: { name: 'Step-off landing' } },
      { slot: { id: 'a9', label: '9', optional: true }, exercise: { name: 'Elliptical' } },
      { slot: { id: 'a2', label: '2', optional: false }, exercise: { name: 'Dumbbell Romanian deadlift' } },
    ]
    const steps = [
      { key: 'a1:both:1', slotId: 'a1' },
      { key: 'a7:both:1', slotId: 'a7' },
      { key: 'a9:both:1', slotId: 'a9' },
      { key: 'a2:both:1', slotId: 'a2' },
    ]
    expect(notLoggedLabels(plans, steps, new Set(['a2:both:1']), new Set(), new Set(['a7']))).toEqual({ notLogged: ['1 Goblet squat to a bench'], notFinished: [] })
    expect(notLoggedLabels(plans, steps, new Set(), new Set(['a1']), new Set())).toEqual({ notLogged: ['7 Step-off landing', '2 Dumbbell Romanian deadlift'], notFinished: [] })
    // One of the goblet squat's three sets logged: started, not finished.
    const three = [{ key: 'a1:both:1', slotId: 'a1' }, { key: 'a1:both:2', slotId: 'a1' }, { key: 'a1:both:3', slotId: 'a1' }]
    expect(notLoggedLabels(plans.slice(0, 1), three, new Set(['a1:both:1']), new Set(), new Set())).toEqual({ notLogged: [], notFinished: ['1 Goblet squat to a bench'] })
  })
})

describe('a slot run at a gym with no dumbbells can always be logged (M4b review)', () => {
  // "Hampton Inn", added without touching Dumbbells (the New form starts at None), with a flat bench.
  const hampton = { ...homeLocation(80, program.planetFitness, '2026-11-02', program.equipmentListVersion), id: 'loc-1', name: 'Hampton Inn', startedFrom: 'empty' as const, present: ['flat-bench'], dumbbellMaxLb: 0 }
  const available = availableEquipment(hampton, program.equipment, program.planetFitness, DEFAULT_KIT)
  const settingsIn = (phase: number) => Settings.parse({ injuredSide: 'right', startDate: '2026-11-02', dumbbellMax: 80, restTimerSeconds: 60, painPerSet: false, currentPhase: phase, phaseEnteredWeek: 1 })
  const none = { workouts: [], setLogs: [], morningChecks: [], runs: [], gateTests: [], sessionMoves: [] }

  it('every slot whose load field stops at 0 with no load to start from asks for the rack, and any rack it offers opens the field', () => {
    let asked = 0
    for (const template of program.templates) {
      for (const plan of planSession({ template, week: 2, settings: settingsIn(template.phase), history: none, gym: { location: hampton, kit: DEFAULT_KIT }, before: '2026-11-10' })) {
        for (const p of plan.prescriptions) {
          const exercise = exerciseById(p.exerciseId)
          const stuck = showsLoad(exercise) && loadMax(exercise, 0) === 0 && needsLoadPick(p, true, exercise.loadDirection, { load: 0 })
          if (!stuck) continue
          asked += 1
          // Run anyway (not held): the card asks for the heaviest dumbbell here.
          expect(asksForRack(exercise, available, false), `${plan.slot.id} ${exercise.id}`).toBe(true)
          for (const lb of RACK_ASK_LB) expect(loadMax(exercise, lb)).toBeGreaterThan(0)
        }
      }
    }
    // Phase 1 A's dumbbell bench press, the farmer's carry, the seated shoulder press and more.
    expect(asked).toBeGreaterThan(3)
  })

  it('says why the field stops at 0 and what a rack tap saved', () => {
    expect(RACK_ASK_LB).toEqual([25, 50, 60, 75, 80])
    expect(rackAskWords('Hampton Inn')).toBe('No dumbbells are set for Hampton Inn, so the load stops at 0 lb. Tap the heaviest one here, or set another weight in Where you train.')
    expect(rackSetWords('Hampton Inn', 25)).toBe('Dumbbells at Hampton Inn now go to 25 lb.')
  })
})

describe('timedSets: the logged sets as the minutes stepper reads them', () => {
  const base = { workoutId: 'w', exerciseId: 'x', setNumber: 1, side: 'both', load: 0, loadUnit: 'none', stopped: false } as const
  it('carries each set’s count, its slot’s unit, its stamp and its RPE', () => {
    const units: Record<string, RepUnit> = { a: 'reps', b: 'minutes' }
    const sets: SetLog[] = [
      { ...base, id: '1', slotId: 'a', reps: 10, rpe: 7, loggedAt: '2026-11-10T10:10:00.000Z' },
      { ...base, id: '2', slotId: 'b', reps: 5 },
      { ...base, id: '3', slotId: 'c', seconds: 30 },
      { ...base, id: '4', slotId: 'gone', reps: 8 },
    ]
    expect(timedSets(sets, (slotId) => units[slotId])).toEqual([
      { reps: 10, repUnit: 'reps', loggedAt: '2026-11-10T10:10:00.000Z', rpe: 7 },
      { reps: 5, repUnit: 'minutes' },
      { seconds: 30, repUnit: 'seconds' },
      { reps: 8, repUnit: 'reps' },
    ])
  })
})

describe('summaryCheckLine: the morning check that completes a summary’s readings (Batch D, PROGRAM-QUESTIONS 174)', () => {
  const w = (id: string, date: string, status: Workout['status'] = 'finished'): Workout => ({ id, date, templateId: 'p1-a', phase: 1, week: 3, isDeload: false, status })
  const mc = (date: string, over: Partial<MorningCheck> = {}): MorningCheck => ({ id: `mc-${date}`, date, appliesTo: null, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [], ...over })
  const line = (workout: Workout, today: string, morningChecks: MorningCheck[] = []) => summaryCheckLine({ mode: 'full', workout, today, startDate: '2026-11-02', history: { workouts: [workout], runs: [], morningChecks } })
  it('a session dated today keeps the sentence it always had', () => {
    expect(line(w('a', '2026-11-20'), '2026-11-20')).toEqual({ text: 'These are the session readings. Tomorrow’s morning check completes them, and the Morning check screen then says what changes next time; until it is done, each reads hold.', action: null })
  })
  it('yesterday’s goes to this morning’s check on the plain route, never a late one', () => {
    expect(line(w('a', '2026-11-19'), '2026-11-20')).toEqual({
      text: 'These are the session readings. This morning’s check completes them, and the Morning check screen then says what changes next time; until it is done, each reads hold at best.',
      action: { kind: 'morning', label: 'Morning check' },
    })
    expect(line(w('a', '2026-11-19'), '2026-11-20', [mc('2026-11-20')]).text).toBe('These are the session readings. The morning check from Friday Nov 20 completes them.')
  })
  it('an older one: covered, offered late, or hold at best for good', () => {
    expect(line(w('a', '2026-11-17'), '2026-11-20', [mc('2026-11-18')])).toEqual({ text: 'These are the session readings. The morning check from Wednesday Nov 18 completes them.', action: null })
    expect(line(w('a', '2026-11-17'), '2026-11-20')).toEqual({
      text: 'These are the session readings. The check for the next morning, Wednesday Nov 18, completes them; until it is logged, each reads hold at best.',
      action: { kind: 'late', morning: '2026-11-18', label: 'Log the morning check for Wednesday Nov 18' },
    })
    expect(line(w('a', '2026-11-03'), '2026-11-20')).toEqual({ text: 'These are the session readings. No morning check from the next morning completes them, so each reads hold at best.', action: null })
  })
})

describe('activeCardKey', () => {
  const base = { editingId: null, stepKey: 'p1a-1:both:1', slotId: 'p1a-1', exerciseId: 'leg-press' }
  it('is the step, the edited set or the viewed slot, with the exercise', () => {
    expect(activeCardKey({ ...base, mode: 'full' })).toBe('full:p1a-1:both:1:leg-press')
    expect(activeCardKey({ ...base, mode: 'full', editingId: 'w1:p1a-1:both:2' })).toBe('full:edit:w1:p1a-1:both:2:leg-press')
    expect(activeCardKey({ ...base, mode: 'full', stepKey: null, exerciseId: null })).toBe('full:view:p1a-1:')
  })
  it('changes with the mode, so a flip remounts the card with the new mode’s draft (M-U3, PROGRAM-QUESTIONS 233)', () => {
    expect(activeCardKey({ ...base, mode: 'tester' })).not.toBe(activeCardKey({ ...base, mode: 'full' }))
    expect(activeCardKey({ ...base, mode: 'tester', editingId: 'x' })).not.toBe(activeCardKey({ ...base, mode: 'full', editingId: 'x' }))
  })
})
