import { describe, expect, it } from 'vitest'
import { dateWords, monthDayWords, shortDateWords } from './dateWords.ts'

describe('dates in words', () => {
  it('reads a date three ways', () => {
    expect(dateWords('2026-11-03')).toBe('Tuesday, November 3')
    expect(monthDayWords('2026-11-10')).toBe('Nov 10')
    expect(shortDateWords('2026-11-02')).toBe('Monday Nov 2')
    expect(shortDateWords('2026-11-20')).toBe('Friday Nov 20')
    expect(shortDateWords('2027-01-03')).toBe('Sunday Jan 3')
  })

  it('refuses what is not a date', () => {
    expect(() => dateWords('2026-13-01')).toThrow(RangeError)
    expect(() => monthDayWords('nope')).toThrow(RangeError)
  })
})
