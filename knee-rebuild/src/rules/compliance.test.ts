import { describe, expect, it } from 'vitest'
import type { SetLog, Slot } from '../schema/index.ts'
import { sessionCompliance, sessionPhaseWeek } from './compliance.ts'

type SlotLike = Pick<Slot, 'id' | 'sets' | 'unilateral' | 'injuredOnly' | 'optional'> & Partial<Pick<Slot, 'phaseWeeks'>>
const slot = (id: string, sets: number, over: Partial<SlotLike> = {}): SlotLike => ({ id, sets, unilateral: false, injuredOnly: false, optional: false, ...over })
const logged = (slotId: string, n: number, over: Partial<Pick<SetLog, 'stopped'>> = {}): Pick<SetLog, 'slotId' | 'stopped'>[] =>
  Array.from({ length: n }, (_, i) => ({ slotId, stopped: false, ...(i === n - 1 ? over : {}) }))

const plain = { isDeload: false }

describe('sessionCompliance: the prescribed sets of the exercises that ran, against the sets logged (Batch B, PROGRAM-QUESTIONS 163)', () => {
  it('every prescribed set logged', () => {
    const slots = [slot('s1', 3), slot('s2', 3), slot('s3', 3)]
    const sets = [...logged('s1', 3), ...logged('s2', 3), ...logged('s3', 3)]
    expect(sessionCompliance({ slots, workout: plain, sets, phaseWeek: 1 })).toEqual({ prescribed: 9, logged: 9, extra: 0, exercises: 3, stopped: 0, excluded: false })
  })

  it('a shortfall counts against: 7 of 9', () => {
    const slots = [slot('s1', 3), slot('s2', 3), slot('s3', 3)]
    const sets = [...logged('s1', 3), ...logged('s2', 2), ...logged('s3', 2)]
    expect(sessionCompliance({ slots, workout: plain, sets, phaseWeek: 1 })).toMatchObject({ prescribed: 9, logged: 7, exercises: 3 })
  })

  it('counts the exercises that stopped early, once each', () => {
    const slots = [slot('s1', 3), slot('s2', 3)]
    const sets = [...logged('s1', 2, { stopped: true }), ...logged('s2', 3)]
    expect(sessionCompliance({ slots, workout: plain, sets, phaseWeek: 1 })).toMatchObject({ prescribed: 6, logged: 5, stopped: 1 })
  })

  it('a unilateral slot prescribes its sets on each side; injured-only on one', () => {
    const slots = [slot('uni', 3, { unilateral: true }), slot('inj', 2, { unilateral: true, injuredOnly: true })]
    const sets = [...logged('uni', 6), ...logged('inj', 2)]
    expect(sessionCompliance({ slots, workout: plain, sets, phaseWeek: 1 })).toMatchObject({ prescribed: 8, logged: 8, extra: 0 })
  })

  it('a deload session compares against the deload prescription: sets × 2/3 rounded down, minimum 2', () => {
    const slots = [slot('s1', 3), slot('s2', 4, { unilateral: true }), slot('one', 1)]
    const sets = [...logged('s1', 2), ...logged('s2', 4), ...logged('one', 1)]
    // 3 → 2, 4 → 2 a side, 1 stays 1: 2 + 4 + 1 = 7, all done.
    expect(sessionCompliance({ slots, workout: { isDeload: true }, sets, phaseWeek: 1 })).toMatchObject({ prescribed: 7, logged: 7, extra: 0 })
    // The same sets on a full week are a shortfall: 3 + 8 + 1 = 12.
    expect(sessionCompliance({ slots, workout: plain, sets, phaseWeek: 1 })).toMatchObject({ prescribed: 12, logged: 7 })
  })

  it('reads the stored deload flag, the record of what the engine prescribed that day, not the week number', () => {
    // It takes no week at all: a week-4 row stored without the flag reads full sets; a week-5 row stored with it reads deload sets.
    const slots = [slot('s1', 3)]
    const sets = logged('s1', 2)
    const week4Unflagged = { isDeload: false, week: 4 }
    const week5Flagged = { isDeload: true, week: 5 }
    expect(sessionCompliance({ slots, workout: week4Unflagged, sets, phaseWeek: 1 }).prescribed).toBe(3)
    expect(sessionCompliance({ slots, workout: week5Flagged, sets, phaseWeek: 1 }).prescribed).toBe(2)
  })

  it('a late entry works the same: only the stored sets and flag are read', () => {
    const slots = [slot('s1', 3), slot('s2', 3)]
    expect(sessionCompliance({ slots, workout: { isDeload: false }, sets: [...logged('s1', 3), ...logged('s2', 3)], phaseWeek: 2 })).toMatchObject({ prescribed: 6, logged: 6 })
  })

  it('an exercise that logged no set is out of the count, and says so (excluded)', () => {
    const slots = [slot('s1', 3), slot('s2', 3), slot('s3', 3)]
    const r = sessionCompliance({ slots, workout: plain, sets: [...logged('s1', 3), ...logged('s2', 3)], phaseWeek: 1 })
    expect(r).toMatchObject({ prescribed: 6, logged: 6, exercises: 2, excluded: true })
  })

  it('an optional slot, or one banded out of this week of the phase, never sets off the note', () => {
    const slots = [slot('s1', 3), slot('opt', 2, { optional: true }), slot('band', 3, { phaseWeeks: [3, null] })]
    expect(sessionCompliance({ slots, workout: plain, sets: logged('s1', 3), phaseWeek: 1 }).excluded).toBe(false)
    // In phase week 3 the banded slot runs, so its missing sets are named.
    expect(sessionCompliance({ slots, workout: plain, sets: logged('s1', 3), phaseWeek: 3 }).excluded).toBe(true)
    // Phase week unknown (an older phase's session): banded slots are never claimed.
    expect(sessionCompliance({ slots, workout: plain, sets: logged('s1', 3), phaseWeek: null }).excluded).toBe(false)
  })

  it('an optional slot that ran counts like any other', () => {
    const slots = [slot('s1', 3), slot('opt', 2, { optional: true })]
    expect(sessionCompliance({ slots, workout: plain, sets: [...logged('s1', 3), ...logged('opt', 1)], phaseWeek: 1 })).toMatchObject({ prescribed: 5, logged: 4, exercises: 2 })
  })

  it('Shawn’s own added slots are prescribed; exercises added for extra time are extra, never prescribed', () => {
    const slots = [slot('s1', 3), slot('added-1', 2), slot('extra-upper-1', 3), slot('extra-upper-2', 3)]
    const r = sessionCompliance({ slots, workout: plain, sets: [...logged('s1', 3), ...logged('added-1', 2), ...logged('extra-upper-1', 3)], phaseWeek: 1 })
    // The unused extension pool slot never sets off the note either.
    expect(r).toEqual({ prescribed: 5, logged: 5, extra: 3, exercises: 2, stopped: 0, excluded: false })
  })

  it('sets past a slot’s prescription are extra, not more than all of it', () => {
    const slots = [slot('s1', 10)]
    expect(sessionCompliance({ slots, workout: plain, sets: logged('s1', 11), phaseWeek: 1 })).toMatchObject({ prescribed: 10, logged: 10, extra: 1 })
  })

  it('nothing logged is nothing to count', () => {
    expect(sessionCompliance({ slots: [slot('s1', 3)], workout: plain, sets: [], phaseWeek: 1 })).toEqual({ prescribed: 0, logged: 0, extra: 0, exercises: 0, stopped: 0, excluded: true })
  })
})

describe('sessionPhaseWeek: the week of its phase a stored session fell in, when the Settings can say', () => {
  it('counts from the week the current phase was entered', () => {
    expect(sessionPhaseWeek({ phase: 2, week: 7 }, { currentPhase: 2, phaseEnteredWeek: 5 })).toBe(3)
    expect(sessionPhaseWeek({ phase: 2, week: 5 }, { currentPhase: 2, phaseEnteredWeek: 5 })).toBe(1)
  })
  it('is null for an older phase’s session, or one before the entry week', () => {
    expect(sessionPhaseWeek({ phase: 1, week: 3 }, { currentPhase: 2, phaseEnteredWeek: 5 })).toBeNull()
    expect(sessionPhaseWeek({ phase: 2, week: 4 }, { currentPhase: 2, phaseEnteredWeek: 5 })).toBeNull()
  })
})
