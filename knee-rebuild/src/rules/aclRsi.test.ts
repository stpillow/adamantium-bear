import { describe, expect, it } from 'vitest'
import type { AclRsiEntry } from '../schema/index.ts'
import { ACL_RSI_ITEM_FIELDS, aclRsiProblem, aclRsiReplacesToday, aclRsiScore, aclRsiSeries, latestAclRsiEntry } from './aclRsi.ts'

/** An entry with every item at `value`, overridden per field. */
const entry = (date: string, value: number, over: Partial<AclRsiEntry> = {}): AclRsiEntry => ({
  date,
  ...(Object.fromEntries(ACL_RSI_ITEM_FIELDS.map((f) => [f, value])) as Omit<AclRsiEntry, 'date'>),
  ...over,
})

/** An entry whose items sum to `sum` (0 to 120), spread greedily: the score only reads the sum. */
function entryWithSum(date: string, sum: number): AclRsiEntry {
  const items = ACL_RSI_ITEM_FIELDS.map((_, i) => Math.max(0, Math.min(10, sum - i * 10)))
  return { date, ...(Object.fromEntries(ACL_RSI_ITEM_FIELDS.map((f, i) => [f, items[i] ?? 0])) as Omit<AclRsiEntry, 'date'>) }
}

describe('aclRsiScore: mean × 10, to one decimal rounded down', () => {
  it('all 10s read 100, all 0s read 0, all 5s read 50', () => {
    expect(aclRsiScore(entry('2026-11-08', 10))).toBe(100)
    expect(aclRsiScore(entry('2026-11-08', 0))).toBe(0)
    expect(aclRsiScore(entry('2026-11-08', 5))).toBe(50)
  })
  it('the gate-3 line: items are whole, so exactly 76 is unreachable — a sum of 91 reads 75.8 and fails, 92 reads 76.6 and passes (PROGRAM-QUESTIONS 156)', () => {
    // sum 91: mean 7.583…, score 75.83… → shown 75.8, under the 76 line.
    const under = entryWithSum('2026-11-08', 91)
    expect(ACL_RSI_ITEM_FIELDS.reduce((t, f) => t + under[f], 0)).toBe(91)
    expect(aclRsiScore(under)).toBe(75.8)
    expect(aclRsiScore(under) >= 76).toBe(false)
    // sum 92: score 76.66… → shown 76.6, over the line.
    const over = entryWithSum('2026-11-08', 92)
    expect(aclRsiScore(over)).toBe(76.6)
    expect(aclRsiScore(over) >= 76).toBe(true)
  })
  it('rounds down to one decimal so the words never read better than the verdict', () => {
    // sum 83: 69.166… → 69.1, never 69.2.
    expect(aclRsiScore(entryWithSum('2026-11-08', 83))).toBe(69.1)
    // sum 96: exactly 80, no float dust.
    expect(aclRsiScore(entryWithSum('2026-11-08', 96))).toBe(80)
  })
})

describe('latestAclRsiEntry and the series', () => {
  it('is null with none, the newest by date of many, whatever order they came in', () => {
    expect(latestAclRsiEntry([])).toBeNull()
    const nov5 = entry('2026-11-05', 7)
    const nov8 = entry('2026-11-08', 8)
    expect(latestAclRsiEntry([nov8, nov5])).toEqual(nov8)
    expect(latestAclRsiEntry([nov5, nov8])).toEqual(nov8)
    expect(aclRsiSeries([nov8, nov5]).map((e) => e.date)).toEqual(['2026-11-05', '2026-11-08'])
  })
})

describe('aclRsiReplacesToday: today’s stored entry, for the "saving replaces it" line', () => {
  it('is today’s entry when one is stored, and null when not', () => {
    const nov5 = entry('2026-11-05', 7)
    expect(aclRsiReplacesToday([nov5], '2026-11-05')).toEqual(nov5)
    expect(aclRsiReplacesToday([nov5], '2026-11-06')).toBeNull()
    expect(aclRsiReplacesToday([], '2026-11-05')).toBeNull()
  })
})

describe('aclRsiProblem: the refusal words for one answer', () => {
  it('is fine on a whole number 0 to 10, the edges included, and on an unanswered item (Save waits on the count instead)', () => {
    for (const value of [0, 5, 10]) expect(aclRsiProblem(value), String(value)).toBeNull()
    expect(aclRsiProblem(null)).toBeNull()
  })
  it('refuses outside 0 to 10 and anything not whole, in words, never clamping', () => {
    expect(aclRsiProblem(11)).toBe('An ACL-RSI answer reads 0 to 10; 11 is outside that.')
    expect(aclRsiProblem(-1)).toBe('An ACL-RSI answer reads 0 to 10; -1 is outside that.')
    expect(aclRsiProblem(7.5)).toBe('An ACL-RSI answer is a whole number, 0 to 10.')
  })
})
