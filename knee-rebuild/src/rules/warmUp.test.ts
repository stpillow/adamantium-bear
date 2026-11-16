import { describe, expect, it } from 'vitest'
import { warmUpParts } from './warmUp.ts'

const lift = { bikeMinutes: 5, circuitMinutesByPhase: { '1': 5, '2': 5, '3': 3, '4': 3 } }

describe('warmUpParts (PROGRAM-QUESTIONS 166)', () => {
  it('the bike’s 5 and the circuit for the phase: 10 in Phases 1–2, 8 from Phase 3', () => {
    expect(warmUpParts(lift, 1, true)).toEqual({ bike: 5, circuit: 5, total: 10 })
    expect(warmUpParts(lift, 2, true)).toEqual({ bike: 5, circuit: 5, total: 10 })
    expect(warmUpParts(lift, 3, true)).toEqual({ bike: 5, circuit: 3, total: 8 })
    expect(warmUpParts(lift, 4, true)).toEqual({ bike: 5, circuit: 3, total: 8 })
  })

  it('no upright bike at the gym: the circuit only, and the bike is named as missing', () => {
    expect(warmUpParts(lift, 1, false)).toEqual({ bike: null, circuit: 5, total: 5 })
    expect(warmUpParts(lift, 3, false)).toEqual({ bike: null, circuit: 3, total: 3 })
  })

  it('a phase with no circuit written takes the longest one written, never less', () => {
    expect(warmUpParts(lift, 9, true)).toEqual({ bike: 5, circuit: 5, total: 10 })
    expect(warmUpParts({ bikeMinutes: 5, circuitMinutesByPhase: {} }, 1, true)).toEqual({ bike: 5, circuit: 0, total: 5 })
  })

  it('reads the bike’s minutes from the seed, not a constant', () => {
    expect(warmUpParts({ ...lift, bikeMinutes: 7 }, 1, true).total).toBe(12)
  })
})
