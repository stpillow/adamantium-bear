import { describe, expect, it } from 'vitest'
import type { AclRsiEntry, Gate, GateTest, MorningCheck, Run, SetLog, Workout } from '../schema/index.ts'
import { evaluateGate, type GateContext } from './gates.ts'
import type { SubjectReading } from './history.ts'

const gate1: Gate = {
  number: 1, fromPhase: 1, toPhase: 2, title: 'Gate 1, to leave Phase 1',
  items: [
    { id: 'g1-clean-weeks', text: 'two consecutive clean weeks', evaluator: 'clean-weeks', windowDays: 14 },
    { id: 'g1-sl-leg-press', text: '10 single-leg leg presses within 20%', evaluator: 'symmetry', threshold: 0.8, testItem: 'sl-leg-press-10rm' },
    { id: 'g1-stance', text: '30 s single-leg stance eyes closed', evaluator: 'manual' },
    { id: 'g1-run', text: 'a 4-mile run with no next-morning reaction', evaluator: 'run-no-reaction', minMiles: 4 },
  ],
}
const gate3: Gate = {
  number: 3, fromPhase: 3, toPhase: 4, title: 'Gate 3',
  items: [
    { id: 'g3-single-hop', text: 'single hop', evaluator: 'symmetry', threshold: 0.9, testItem: 'single-hop', trials: 3 },
    { id: 'g3-no-swelling-plyo', text: 'no swelling the morning after a plyo session', evaluator: 'no-swelling-after-plyo', windowDays: 14 },
    { id: 'g3-six-meter-timed-hop', text: '6-meter timed hop, fastest counts', evaluator: 'symmetry', threshold: 0.9, testItem: 'six-meter-timed-hop', trials: 3, timed: true },
    { id: 'g3-acl-rsi', text: 'an ACL-RSI score of 76 or better', evaluator: 'acl-rsi', minScore: 76 },
  ],
}
const gate2: Gate = {
  number: 2, fromPhase: 2, toPhase: 3, title: 'Gate 2',
  items: [
    { id: 'g2-calf-raises', text: '20 single-leg calf raises each side', evaluator: 'calf-raises', minReps: 20, windowDays: 14 },
    { id: 'g2-no-swelling', text: 'no swelling for two weeks', evaluator: 'no-swelling', windowDays: 14 },
  ],
}

const check = (date: string, over: Partial<MorningCheck> = {}): MorningCheck => ({ id: `m-${date}`, date, appliesTo: null, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [], ...over })
const reading = (date: string, result: SubjectReading['result'] = 'clean'): SubjectReading => ({ kind: 'workout', id: `w-${date}`, date, result })
const test = (over: Partial<GateTest>): GateTest => ({ id: 't', date: '2026-11-20', gate: 1, item: 'sl-leg-press-10rm', valueInjured: 8, valueOther: 10, pass: true, manual: false, ...over })

function ctx(over: Partial<GateContext> = {}): GateContext {
  return { today: '2026-11-22', injuredSide: 'right', readings: [], gateTests: [], morningChecks: [], runs: [], workouts: [], setLogs: [], calfRaiseExerciseIds: ['single-leg-calf-raise-step'], aclRsiEntries: [], ...over }
}

const ACL_FIELDS = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8', 'i9', 'i10', 'i11', 'i12'] as const
/** An ACL-RSI entry whose 12 whole items sum to `sum`: the score is sum × 5⁄6, so 92 reads 76.6 and 91 reads 75.8. */
function aclEntry(date: string, sum: number): AclRsiEntry {
  return { date, ...(Object.fromEntries(ACL_FIELDS.map((f, i) => [f, Math.max(0, Math.min(10, sum - i * 10))])) as Omit<AclRsiEntry, 'date'>) }
}
const twoCleanWeeks = ['2026-11-10', '2026-11-12', '2026-11-14', '2026-11-17', '2026-11-19', '2026-11-21'].map((d) => reading(d))

describe('evaluateGate (rule 8)', () => {
  it('a gate passes only when every item passes, and never advances on its own', () => {
    const full = ctx({
      readings: twoCleanWeeks,
      gateTests: [test({}), test({ id: 'man', item: 'g1-stance', manual: true, pass: true })],
      runs: [{ id: 'r1', date: '2026-11-20', type: 'long', miles: 4, minutes: 40, effort: 'easy', maxPain: 1, strides: false, tempo: false }],
      morningChecks: [check('2026-11-21')],
    })
    const result = evaluateGate(gate1, full)
    expect(result.items.map((i) => i.pass)).toEqual([true, true, true, true])
    expect(result.passes).toBe(true)
    const noTick = evaluateGate(gate1, { ...full, gateTests: [test({})] })
    expect(noTick.passes).toBe(false)
    expect(noTick.items[2]?.detail).toBe('not ticked')
  })

  it('clean weeks: one hold in the window fails; sessions must exist in both weeks', () => {
    expect(evaluateGate(gate1, ctx({ readings: [...twoCleanWeeks, reading('2026-11-15', 'hold')] })).items[0]?.pass).toBe(false)
    expect(evaluateGate(gate1, ctx({ readings: twoCleanWeeks.slice(3) })).items[0]?.pass).toBe(false)
    expect(evaluateGate(gate1, ctx({ readings: [...twoCleanWeeks, reading('2026-11-05', 'back-off')] })).items[0]?.pass).toBe(true)
  })

  it('clean weeks hand back the readings that aren’t clean, oldest first, so the screen can name them', () => {
    const hold = reading('2026-11-15', 'hold')
    const backOff = reading('2026-11-13', 'back-off')
    const item = evaluateGate(gate1, ctx({ readings: [...twoCleanWeeks, hold, backOff, reading('2026-11-05', 'hold')] })).items[0]
    expect(item).toMatchObject({ pass: false, detail: '2 of 8 readings in the last 14 days read hold, back-off', misses: [backOff, hold] })
    expect(evaluateGate(gate1, ctx({ readings: twoCleanWeeks })).items[0]?.misses).toBeUndefined()
  })

  it('clean weeks leave a rack-capped clean out: it neither counts as clean nor breaks the streak (Shawn, Nov 2)', () => {
    const capped = (date: string, result: SubjectReading['result'] = 'clean'): SubjectReading => ({ ...reading(date, result), rackCapped: true })
    const withCapped = evaluateGate(gate1, ctx({ readings: [...twoCleanWeeks, capped('2026-11-16')] })).items[0]
    expect(withCapped).toMatchObject({ pass: true, detail: '6 readings in the last 14 days, all clean (1 rack-capped session left out)' })
    // A capped clean is not a session for "both weeks" either.
    const onlyCapped = evaluateGate(gate1, ctx({ readings: [...twoCleanWeeks.slice(0, 3), capped('2026-11-17'), capped('2026-11-19')] })).items[0]
    expect(onlyCapped).toMatchObject({ pass: false, detail: 'needs sessions in both of the last two weeks (3 readings so far, 2 rack-capped sessions left out)' })
    // A capped hold or back-off still breaks it.
    expect(evaluateGate(gate1, ctx({ readings: [...twoCleanWeeks, capped('2026-11-16', 'hold')] })).items[0]?.pass).toBe(false)
    expect(evaluateGate(gate1, ctx({ readings: [...twoCleanWeeks, capped('2026-11-16', 'back-off')] })).items[0]?.pass).toBe(false)
  })

  it('symmetry reads the latest test for the item against the gate line', () => {
    expect(evaluateGate(gate1, ctx({ gateTests: [test({ valueInjured: 7, valueOther: 10 })] })).items[1]).toMatchObject({ pass: false, detail: expect.stringContaining('70%') })
    expect(evaluateGate(gate1, ctx({ gateTests: [test({ date: '2026-11-10', valueInjured: 7 }), test({ date: '2026-11-20', valueInjured: 9 })] })).items[1]?.pass).toBe(true)
    expect(evaluateGate(gate1, ctx()).items[1]?.detail).toBe('no test entered yet')
  })

  it('the latest test is the last one written: by date, then by id, whatever order the tests arrive in', () => {
    // Ids lead with the write's ISO stamp: a tick at 18:00 and an untick at 18:05 on the same day.
    const tick = test({ id: 'gate-test-2026-11-22T18:00:00.000Z-g1-stance', date: '2026-11-22', item: 'g1-stance', manual: true, pass: true })
    const untick = test({ id: 'gate-test-2026-11-22T18:05:00.000Z-g1-stance', date: '2026-11-22', item: 'g1-stance', manual: true, pass: false })
    expect(evaluateGate(gate1, ctx({ gateTests: [tick, untick] })).items[2]).toMatchObject({ pass: false, detail: 'unticked 2026-11-22' })
    expect(evaluateGate(gate1, ctx({ gateTests: [untick, tick] })).items[2]).toMatchObject({ pass: false, detail: 'unticked 2026-11-22' })
    // A later date still wins over a later id.
    const nextDay = test({ id: 'gate-test-2026-11-21T09:00:00.000Z-g1-stance', date: '2026-11-23', item: 'g1-stance', manual: true, pass: true })
    expect(evaluateGate(gate1, ctx({ today: '2026-11-23', gateTests: [nextDay, untick, tick] })).items[2]).toMatchObject({ pass: true, detail: 'ticked 2026-11-23' })
    // The same for symmetry tests: the second test of the day wins, passed in either order.
    const first = test({ id: 'gate-test-2026-11-22T18:00:00.000Z-sl-leg-press-10rm', date: '2026-11-22', valueInjured: 9 })
    const second = test({ id: 'gate-test-2026-11-22T18:05:00.000Z-sl-leg-press-10rm', date: '2026-11-22', valueInjured: 7 })
    expect(evaluateGate(gate1, ctx({ gateTests: [second, first] })).items[1]).toMatchObject({ pass: false, detail: expect.stringContaining('70%') })
  })

  it('worked example: hop test 56 vs 62 is 90.3% and passes gate 3', () => {
    const hop = test({ gate: 3, item: 'single-hop', trialsInjured: [50, 56, 54], trialsOther: [60, 62, 61], valueInjured: 56, valueOther: 62 })
    const result = evaluateGate(gate3, ctx({ gateTests: [hop] }))
    expect(result.items[0]).toMatchObject({ pass: true, detail: expect.stringContaining('90.3%') })
  })

  it('a hop test with one trial a side reads its bests; 0 on the injured side reads 0% and fails (PROGRAM-QUESTIONS 108)', () => {
    const one = test({ gate: 3, item: 'single-hop', trialsInjured: [56], trialsOther: [62], valueInjured: 56, valueOther: 62 })
    expect(evaluateGate(gate3, ctx({ gateTests: [one] })).items[0]).toMatchObject({ pass: true, detail: expect.stringContaining('90.3% (56 vs 62)') })
    const zero = test({ gate: 3, item: 'single-hop', trialsInjured: [0], trialsOther: [62, 60], valueInjured: 0, valueOther: 62 })
    expect(evaluateGate(gate3, ctx({ gateTests: [zero] })).items[0]).toMatchObject({ pass: false, detail: expect.stringContaining('0% (0 vs 62)') })
  })

  it('the timed hop keeps the fastest trial and inverts the ratio: other ÷ injured (Batch A, PROGRAM-QUESTIONS 157)', () => {
    const timed = (over: Partial<GateTest>) => test({ gate: 3, item: 'six-meter-timed-hop', ...over })
    // Injured fastest 2.3 s, other fastest 2.1 s: 2.1 / 2.3 = 91.3%, passes the 90% line.
    const passes = timed({ trialsInjured: [2.4, 2.3, 2.5], trialsOther: [2.2, 2.1, 2.6], valueInjured: 2.3, valueOther: 2.1 })
    expect(evaluateGate(gate3, ctx({ gateTests: [passes] })).items[2]).toMatchObject({ pass: true, detail: '91.3% (other 2.1 s over injured 2.3 s) against a 90% line, tested 2026-11-20' })
    // Injured 2.4 s against 2.1 s: 87.5%, fails. A faster injured side reads over 100% and passes.
    const fails = timed({ trialsInjured: [2.4, 2.6], trialsOther: [2.1], valueInjured: 2.4, valueOther: 2.1 })
    expect(evaluateGate(gate3, ctx({ gateTests: [fails] })).items[2]).toMatchObject({ pass: false, detail: expect.stringContaining('87.5%') })
    const faster = timed({ trialsInjured: [2.0], trialsOther: [2.2], valueInjured: 2.0, valueOther: 2.2 })
    expect(evaluateGate(gate3, ctx({ gateTests: [faster] })).items[2]).toMatchObject({ pass: true, detail: expect.stringContaining('110%') })
    expect(evaluateGate(gate3, ctx()).items[2]?.detail).toBe('no test entered yet')
  })

  it('a timed trial of 0 is no time: all-zero on a side fails with "no usable time", distinct from a distance hop’s 0 (PROGRAM-QUESTIONS 108 vs 157)', () => {
    const timed = (over: Partial<GateTest>) => test({ gate: 3, item: 'six-meter-timed-hop', ...over })
    const zeroInjured = timed({ trialsInjured: [0, 0, 0], trialsOther: [2.1, 2.2], valueInjured: 0, valueOther: 2.1 })
    expect(evaluateGate(gate3, ctx({ gateTests: [zeroInjured] })).items[2]).toMatchObject({ pass: false, detail: 'no usable time on the injured side, tested 2026-11-20' })
    const zeroOther = timed({ trialsInjured: [2.3], trialsOther: [0], valueInjured: 2.3, valueOther: 0 })
    expect(evaluateGate(gate3, ctx({ gateTests: [zeroOther] })).items[2]).toMatchObject({ pass: false, detail: 'no usable time on the other side, tested 2026-11-20' })
    // A 0 among usable trials is ignored: the fastest positive counts.
    const mixed = timed({ trialsInjured: [0, 2.3], trialsOther: [2.1], valueInjured: 2.3, valueOther: 2.1 })
    expect(evaluateGate(gate3, ctx({ gateTests: [mixed] })).items[2]).toMatchObject({ pass: true, detail: expect.stringContaining('91.3%') })
  })

  it('the ACL-RSI item reads the latest entry’s score against the 76 line: no entry fails in words (Batch A, PROGRAM-QUESTIONS 156)', () => {
    expect(evaluateGate(gate3, ctx()).items[3]).toMatchObject({ pass: false, detail: 'no questionnaire entered yet' })
    // Items are whole, so exactly 76 is unreachable: sum 92 reads 76.6 and passes, sum 91 reads 75.8 and fails.
    expect(evaluateGate(gate3, ctx({ aclRsiEntries: [aclEntry('2026-11-20', 92)] })).items[3]).toMatchObject({ pass: true, detail: 'scored 76.6 on 2026-11-20; the line is 76' })
    expect(evaluateGate(gate3, ctx({ aclRsiEntries: [aclEntry('2026-11-20', 91)] })).items[3]).toMatchObject({ pass: false, detail: 'scored 75.8 on 2026-11-20; the line is 76' })
    // The latest entry wins by date, whatever order the rows arrive in — like the hop items read their latest tests.
    const older = aclEntry('2026-11-10', 120)
    const newer = aclEntry('2026-11-21', 91)
    for (const aclRsiEntries of [[older, newer], [newer, older]]) {
      expect(evaluateGate(gate3, ctx({ aclRsiEntries })).items[3]).toMatchObject({ pass: false, detail: 'scored 75.8 on 2026-11-21; the line is 76' })
    }
    // Without a minScore in the data, the line defaults to the strict published 76.
    const bare: Gate = { ...gate3, items: [{ id: 'g3-acl-rsi', text: 'ACL-RSI', evaluator: 'acl-rsi' }] }
    expect(evaluateGate(bare, ctx({ aclRsiEntries: [aclEntry('2026-11-20', 91)] })).items[0]).toMatchObject({ pass: false, detail: 'scored 75.8 on 2026-11-20; the line is 76' })
  })

  it('no swelling after plyos needs checks, no swelling, and a Phase 3 A or C session in the window', () => {
    const plyo: Workout = { id: 'w9', date: '2026-11-18', templateId: 'p3-a', phase: 3, week: 8, isDeload: true, status: 'finished' }
    expect(evaluateGate(gate3, ctx({ morningChecks: [check('2026-11-19')], workouts: [plyo] })).items[1]?.pass).toBe(true)
    expect(evaluateGate(gate3, ctx({ morningChecks: [check('2026-11-19')] })).items[1]?.pass).toBe(false)
    expect(evaluateGate(gate3, ctx({ morningChecks: [check('2026-11-19', { visibleSwelling: true })], workouts: [plyo] })).items[1]?.pass).toBe(false)
    expect(evaluateGate(gate3, ctx({ workouts: [plyo] })).items[1]?.pass).toBe(false)
  })

  it('calf raises need a set of 20 or more on each side inside the window', () => {
    const w: Workout = { id: 'w5', date: '2026-11-15', templateId: 'p2-a', phase: 2, week: 6, isDeload: false, status: 'finished' }
    const calf = (side: SetLog['side'], reps: number): SetLog => ({ id: `${side}-${reps}`, workoutId: 'w5', slotId: 'p2a-6', exerciseId: 'single-leg-calf-raise-step', setNumber: 1, side, load: 0, loadUnit: 'lb', reps, stopped: false })
    const c = ctx({ workouts: [w], morningChecks: [check('2026-11-16')] })
    expect(evaluateGate(gate2, { ...c, setLogs: [calf('right', 20), calf('left', 22)] }).items[0]?.pass).toBe(true)
    expect(evaluateGate(gate2, { ...c, setLogs: [calf('right', 20), calf('left', 19)] }).items[0]?.pass).toBe(false)
    expect(evaluateGate(gate2, { ...c, workouts: [{ ...w, date: '2026-11-01' }], setLogs: [calf('right', 20), calf('left', 22)] }).items[0]?.pass).toBe(false)
    expect(evaluateGate(gate2, c).items[1]?.pass).toBe(true)
    expect(evaluateGate(gate2, { ...c, morningChecks: [] }).items[1]?.pass).toBe(false)
  })

  it('calf raises: an added or extra-time slot of the same exercise counts, a different exercise never does, and two slots the same day are still one pass (Batch C, PROGRAM-QUESTIONS 168)', () => {
    const w: Workout = { id: 'w5', date: '2026-11-15', templateId: 'p2-a', phase: 2, week: 6, isDeload: false, status: 'finished' }
    const calf = (side: SetLog['side'], reps: number, slotId: string, exerciseId = 'single-leg-calf-raise-step'): SetLog => ({ id: `${slotId}-${side}-${reps}`, workoutId: 'w5', slotId, exerciseId, setNumber: 1, side, load: 0, loadUnit: 'lb', reps, stopped: false })
    const c = ctx({ workouts: [w], morningChecks: [check('2026-11-16')] })
    const pass = (setLogs: SetLog[]) => evaluateGate(gate2, { ...c, setLogs }).items[0]?.pass
    // Shawn's added slot, and an extra-time slot copied from another session, count: the exercise is the same.
    expect(pass([calf('right', 20, 'added-k1'), calf('left', 22, 'added-k1')])).toBe(true)
    expect(pass([calf('right', 20, 'extra-p2a-6'), calf('left', 22, 'extra-p2a-6')])).toBe(true)
    // A similar movement, or a substitution, never does, whatever its reps.
    expect(pass([calf('right', 25, 'added-k1', 'standing-calf-raise'), calf('left', 25, 'added-k1', 'standing-calf-raise')])).toBe(false)
    expect(pass([calf('right', 20, 'p2a-6'), calf('left', 25, 'added-k1', 'standing-calf-raise')])).toBe(false)
    // Each side is a yes or no, so the same side 20+ on two slots is still one side, not a pass.
    expect(pass([calf('right', 20, 'p2a-6'), calf('right', 21, 'added-k1')])).toBe(false)
    // Each side did its 20 on a slot of the exercise: the left on the program's slot and the right on an added one passes.
    expect(pass([calf('left', 20, 'p2a-6'), calf('right', 20, 'added-k1')])).toBe(true)
  })

  it('the 4-mile run needs a clean morning after it; swaps and shorter runs do not count', () => {
    const run = (over: Partial<Run>): Run => ({ id: 'r1', date: '2026-11-20', type: 'long', miles: 4, minutes: 40, effort: 'easy', maxPain: 1, strides: false, tempo: false, ...over })
    expect(evaluateGate(gate1, ctx({ runs: [run({})], morningChecks: [check('2026-11-21')] })).items[3]?.pass).toBe(true)
    expect(evaluateGate(gate1, ctx({ runs: [run({ miles: 3.9 })], morningChecks: [check('2026-11-21')] })).items[3]?.pass).toBe(false)
    expect(evaluateGate(gate1, ctx({ runs: [run({ type: 'elliptical-swap' })], morningChecks: [check('2026-11-21')] })).items[3]?.pass).toBe(false)
    expect(evaluateGate(gate1, ctx({ runs: [run({})], morningChecks: [check('2026-11-21', { worseThanYesterday: true })] })).items[3]?.pass).toBe(false)
    expect(evaluateGate(gate1, ctx({ runs: [run({})] })).items[3]?.pass).toBe(false)
  })
})
