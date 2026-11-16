import { describe, expect, it } from 'vitest'
import type { KoosEntry } from '../schema/index.ts'
import {
  KOOS_DUE_DAYS,
  KOOS_SUBSCALES,
  KOOS_SUBSCALE_ITEMS,
  KOOS_SUBSCALE_WORDS,
  koosAnswered,
  koosDue,
  koosProblem,
  koosReplacesToday,
  koosSeries,
  koosSubscaleScore,
  latestKoosEntry,
} from './koos.ts'

/** An entry with every item of `subscale` set to `value`, more fields laid over. */
const withSubscale = (date: string, subscale: keyof typeof KOOS_SUBSCALE_ITEMS, value: number, over: Partial<KoosEntry> = {}): KoosEntry => ({
  date,
  ...Object.fromEntries(KOOS_SUBSCALE_ITEMS[subscale].map((f) => [f, value])),
  ...over,
})

describe('the subscale map', () => {
  it('pins the five subscales and their item counts: Pain 9, Symptoms 7, ADL 17, Sport/Rec 5, QOL 4', () => {
    expect(KOOS_SUBSCALES).toEqual(['pain', 'symptoms', 'adl', 'sport', 'qol'])
    expect(KOOS_SUBSCALES.map((s) => KOOS_SUBSCALE_ITEMS[s].length)).toEqual([9, 7, 17, 5, 4])
    expect(KOOS_SUBSCALE_ITEMS.pain).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'])
    expect(KOOS_SUBSCALE_ITEMS.symptoms).toEqual(['sy1', 'sy2', 'sy3', 'sy4', 'sy5', 'sy6', 'sy7'])
    expect(KOOS_SUBSCALE_ITEMS.sport).toEqual(['sp1', 'sp2', 'sp3', 'sp4', 'sp5'])
    expect(KOOS_SUBSCALE_ITEMS.qol).toEqual(['q1', 'q2', 'q3', 'q4'])
    expect(KOOS_SUBSCALE_WORDS.adl).toBe('Daily living')
  })
})

describe('koosSubscaleScore: 100 − mean × 25, published formula, 100 = no problems', () => {
  it('all 0s score 100 and all 4s score 0, on every subscale', () => {
    for (const subscale of KOOS_SUBSCALES) {
      expect(koosSubscaleScore(withSubscale('2026-11-08', subscale, 0), subscale), subscale).toBe(100)
      expect(koosSubscaleScore(withSubscale('2026-11-08', subscale, 4), subscale), subscale).toBe(0)
    }
  })
  it('worked examples on observed answers: a mean of 2 scores 50; Pain 1,1,2,2,4 answered of 9 scores 50', () => {
    expect(koosSubscaleScore(withSubscale('2026-11-08', 'qol', 2), 'qol')).toBe(50)
    const pain = { date: '2026-11-08', p1: 1, p2: 1, p3: 2, p4: 2, p5: 4 }
    expect(koosAnswered(pain, 'pain')).toBe(5)
    expect(koosSubscaleScore(pain, 'pain')).toBe(50)
    // One decimal: QOL 1,1,1,0 → mean 0.75 → 81.25 → 81.3.
    expect(koosSubscaleScore({ date: '2026-11-08', q1: 1, q2: 1, q3: 1, q4: 0 }, 'qol')).toBe(81.3)
  })
  it('scores only with at least half the subscale’s items answered: the boundary on every subscale (Pain 5, Symptoms 4, ADL 9, Sport 3, QOL 2)', () => {
    const needs = { pain: 5, symptoms: 4, adl: 9, sport: 3, qol: 2 } as const
    for (const subscale of KOOS_SUBSCALES) {
      const need = needs[subscale]
      const fields = KOOS_SUBSCALE_ITEMS[subscale]
      const exactly = { date: '2026-11-08', ...Object.fromEntries(fields.slice(0, need).map((f) => [f, 2])) }
      expect(koosSubscaleScore(exactly, subscale), `${subscale} at ${need}`).toBe(50)
      const oneUnder = { date: '2026-11-08', ...Object.fromEntries(fields.slice(0, need - 1).map((f) => [f, 2])) }
      expect(koosSubscaleScore(oneUnder, subscale), `${subscale} at ${need - 1}`).toBeNull()
    }
    expect(koosSubscaleScore({ date: '2026-11-08' }, 'pain')).toBeNull()
  })
  it('reads only its own subscale’s items', () => {
    const entry = withSubscale('2026-11-08', 'pain', 4, { q1: 0, q2: 0 })
    expect(koosSubscaleScore(entry, 'pain')).toBe(0)
    expect(koosSubscaleScore(entry, 'qol')).toBe(100)
    expect(koosSubscaleScore(entry, 'sport')).toBeNull()
  })
})

describe('koosDue: a check is due monthly — 28 days or more since the last entry, or none yet', () => {
  it('is due with no entries, at exactly 28 days, and past; not at 27', () => {
    expect(KOOS_DUE_DAYS).toBe(28)
    expect(koosDue([], '2026-11-08')).toBe(true)
    const entry = withSubscale('2026-10-11', 'pain', 1)
    expect(koosDue([entry], '2026-11-07')).toBe(false) // 27 days
    expect(koosDue([entry], '2026-11-08')).toBe(true) // 28 days
    expect(koosDue([entry], '2026-12-01')).toBe(true)
    expect(koosDue([entry], '2026-10-11')).toBe(false) // same day
  })
  it('reads the latest entry, whatever order they came in', () => {
    const old = withSubscale('2026-09-01', 'pain', 1)
    const fresh = withSubscale('2026-11-01', 'pain', 1)
    expect(koosDue([fresh, old], '2026-11-08')).toBe(false)
    expect(koosDue([old, fresh], '2026-11-08')).toBe(false)
  })
})

describe('latest, series and the replace line', () => {
  const oct = withSubscale('2026-10-11', 'pain', 2)
  const nov = withSubscale('2026-11-08', 'pain', 1)
  it('latest is null with none and the newest of many; the series is date-ascending', () => {
    expect(latestKoosEntry([])).toBeNull()
    expect(latestKoosEntry([nov, oct])).toEqual(nov)
    expect(koosSeries([nov, oct]).map((e) => e.date)).toEqual(['2026-10-11', '2026-11-08'])
  })
  it('replacesToday is today’s entry when one is stored, and null when not', () => {
    expect(koosReplacesToday([oct, nov], '2026-11-08')).toEqual(nov)
    expect(koosReplacesToday([oct], '2026-11-08')).toBeNull()
  })
})

describe('koosProblem: the refusal words for one answer', () => {
  it('is fine on 0 to 4 whole and on a skipped item (the missing-data rule absorbs skips)', () => {
    for (const value of [0, 2, 4]) expect(koosProblem(value), String(value)).toBeNull()
    expect(koosProblem(null)).toBeNull()
  })
  it('refuses outside 0 to 4 and anything not whole, in words, never clamping', () => {
    expect(koosProblem(5)).toBe('A KOOS answer reads 0 to 4; 5 is outside that.')
    expect(koosProblem(-1)).toBe('A KOOS answer reads 0 to 4; -1 is outside that.')
    expect(koosProblem(2.5)).toBe('A KOOS answer is a whole number, 0 to 4.')
  })
})
