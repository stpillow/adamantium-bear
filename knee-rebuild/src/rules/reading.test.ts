import { describe, expect, it } from 'vitest'
import type { MorningCheck, SetLog } from '../schema/index.ts'
import { combinedReading, morningCheckApplies, morningReading, sessionReading, worse } from './reading.ts'

function set(setNumber: number, painDuring: number | undefined, extra: Partial<SetLog> = {}): SetLog {
  return { id: `s${setNumber}`, workoutId: 'w1', slotId: 'p1a-1', exerciseId: 'leg-press', setNumber, side: 'both', load: 8, loadUnit: 'plate', reps: 12, stopped: false, ...(painDuring === undefined ? {} : { painDuring }), ...extra }
}

const sets = (...pains: number[]) => pains.map((p, i) => set(i + 1, p))

describe('sessionReading (rule 1)', () => {
  it('clean: max 3 or under and not climbing', () => {
    expect(sessionReading(sets(2, 2, 2)).result).toBe('clean')
    expect(sessionReading(sets(3, 3, 3)).result).toBe('clean')
    expect(sessionReading(sets(0, 1, 2, 3)).result).toBe('clean')
  })
  it('hold: 4 to 5, or climbing by 2 or more between consecutive sets', () => {
    expect(sessionReading(sets(4, 4, 4)).result).toBe('hold')
    expect(sessionReading(sets(5)).result).toBe('hold')
    expect(sessionReading(sets(1, 3, 3)).result).toBe('hold')
    expect(sessionReading(sets(0, 1, 3)).result).toBe('hold')
  })
  it('back-off: over 5, or a set stopped for sharp joint-line pain', () => {
    expect(sessionReading(sets(6)).result).toBe('back-off')
    expect(sessionReading(sets(2, 2, 7)).result).toBe('back-off')
    expect(sessionReading([set(1, 1), set(2, 1, { stopped: true, stopReason: 'sharp-joint-line-pain' })]).result).toBe('back-off')
  })
  it('a set stopped for another reason is not clean', () => {
    expect(sessionReading([set(1, 1), set(2, 1, { stopped: true, stopReason: 'form' })]).result).toBe('hold')
  })
  it('no pain logged reads hold: unknown is not clean', () => {
    expect(sessionReading([]).result).toBe('hold')
    expect(sessionReading([set(1, undefined), set(2, undefined)]).result).toBe('hold')
  })
  it('orders unilateral sets injured side first when no timestamps exist', () => {
    const left = { ...set(1, 1), side: 'left' as const, id: 'l1' }
    const right = { ...set(1, 3), side: 'right' as const, id: 'r1' }
    // right is injured: order is right (3) then left (1): no climb
    expect(sessionReading([left, right], 'right').result).toBe('clean')
    // left is injured: order is left (1) then right (3): a climb of 2
    expect(sessionReading([left, right], 'left').result).toBe('hold')
  })
})

const check = (over: Partial<MorningCheck> = {}): MorningCheck => ({
  id: 'm1', date: '2026-11-04', appliesTo: null, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [], ...over,
})

describe('morningReading (rule 2)', () => {
  it('clean when stiffness is gone inside 30 minutes and nothing else is flagged', () => {
    expect(morningReading(check()).result).toBe('clean')
  })
  it('hold when worse than yesterday without swelling, warmth or a 2-point rise', () => {
    expect(morningReading(check({ worseThanYesterday: true, painChangePoints: 1 })).result).toBe('hold')
  })
  it('hold when stiffness lasts past 30 minutes (PROGRAM-QUESTIONS 5)', () => {
    expect(morningReading(check({ stiffnessUnder30Min: false })).result).toBe('hold')
  })
  it('back-off on swelling, warmth, or pain up 2 or more', () => {
    expect(morningReading(check({ visibleSwelling: true })).result).toBe('back-off')
    expect(morningReading(check({ warmth: true })).result).toBe('back-off')
    expect(morningReading(check({ painChangePoints: 2 })).result).toBe('back-off')
    expect(morningReading(check({ worseThanYesterday: true, painChangePoints: 2 })).result).toBe('back-off')
  })
  it('any red flag sets the red-flag state', () => {
    const r = morningReading(check({ redFlags: ['locking'] }))
    expect(r.redFlag).toBe(true)
    expect(r.result).toBe('back-off')
    expect(morningReading(check()).redFlag).toBe(false)
  })
  it('a red flag reads back-off whatever else the check says: never hold beside slow stiffness or a worse morning', () => {
    expect(morningReading(check({ redFlags: ['locking'], stiffnessUnder30Min: false })).result).toBe('back-off')
    expect(morningReading(check({ redFlags: ['locking'], worseThanYesterday: true })).result).toBe('back-off')
    expect(morningReading(check({ redFlags: ['locking'], worseThanYesterday: true, stiffnessUnder30Min: false })).reasons).toContain('red flag ticked: locking')
  })
})

describe('combinedReading (rule 3)', () => {
  it('takes the worse of the two', () => {
    expect(combinedReading({ result: 'clean', reasons: [] }, { result: 'hold', reasons: [], redFlag: false }).result).toBe('hold')
    expect(combinedReading({ result: 'back-off', reasons: [] }, { result: 'clean', reasons: [], redFlag: false }).result).toBe('back-off')
    expect(combinedReading({ result: 'clean', reasons: [] }, { result: 'clean', reasons: [], redFlag: false }).result).toBe('clean')
  })
  it('no morning check within 36 hours reads hold, never clean', () => {
    expect(combinedReading({ result: 'clean', reasons: [] }, undefined).result).toBe('hold')
    expect(combinedReading({ result: 'back-off', reasons: [] }, undefined).result).toBe('back-off')
  })
  it('worse() ranks back-off over hold over clean', () => {
    expect(worse('clean', 'hold')).toBe('hold')
    expect(worse('hold', 'back-off')).toBe('back-off')
    expect(worse('clean', 'clean')).toBe('clean')
  })
})

describe('morningCheckApplies', () => {
  const workout = { kind: 'workout' as const, id: 'w1', date: '2026-11-03' }
  it('follows an explicit link', () => {
    expect(morningCheckApplies(check({ appliesTo: { kind: 'workout', id: 'w1' }, date: '2026-11-09' }), workout)).toBe(true)
  })
  it('a link adds its session; it no longer hides the rest of the day before (M4 review)', () => {
    expect(morningCheckApplies(check({ appliesTo: { kind: 'workout', id: 'w2' }, date: '2026-11-04' }), workout)).toBe(true)
    expect(morningCheckApplies(check({ appliesTo: { kind: 'run', id: 'r1' }, date: '2026-11-04' }), workout)).toBe(true)
    expect(morningCheckApplies(check({ appliesTo: { kind: 'workout', id: 'w2' }, date: '2026-11-06' }), workout)).toBe(false)
  })
  it('otherwise only the morning after counts: a same-day check describes the day before', () => {
    expect(morningCheckApplies(check({ date: '2026-11-04' }), workout)).toBe(true)
    expect(morningCheckApplies(check({ date: '2026-11-03' }), workout)).toBe(false)
    expect(morningCheckApplies(check({ date: '2026-11-05' }), workout)).toBe(false)
  })
})
