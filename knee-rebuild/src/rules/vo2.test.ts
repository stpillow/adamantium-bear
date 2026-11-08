import { describe, expect, it } from 'vitest'
import type { Vo2Reading } from '../schema/index.ts'
import { latestReading, replacesToday, vo2Problem, vo2Series } from './vo2.ts'

const r = (date: string, vo2: number): Vo2Reading => ({ date, vo2 })

describe('vo2Problem: the refusal words for a typed reading', () => {
  it('is fine on a whole number inside the bounds, the edges included', () => {
    for (const value of [20, 44, 90]) expect(vo2Problem(value), String(value)).toBeNull()
  })
  it('asks for the number first while the field is empty', () => {
    expect(vo2Problem(null)).toBe('Type the number from the watch first.')
  })
  it('refuses a number that isn’t whole (rules-level defense: the numeric field never hands one over)', () => {
    expect(vo2Problem(42.5)).toBe('VO2 max is a whole number.')
  })
  it('refuses outside 20 to 90 in words, naming the value, and never clamps', () => {
    expect(vo2Problem(19)).toBe('VO2 max reads 20 to 90; 19 is outside that.')
    expect(vo2Problem(91)).toBe('VO2 max reads 20 to 90; 91 is outside that.')
    expect(vo2Problem(0)).toBe('VO2 max reads 20 to 90; 0 is outside that.')
  })
})

describe('latestReading', () => {
  it('is null with no readings', () => {
    expect(latestReading([])).toBeNull()
  })
  it('is the one reading alone, and the newest date of many, whatever order they came in', () => {
    expect(latestReading([r('2026-11-07', 44)])).toEqual(r('2026-11-07', 44))
    expect(latestReading([r('2026-11-14', 45), r('2026-11-07', 44), r('2026-11-10', 43)])).toEqual(r('2026-11-14', 45))
  })
})

describe('vo2Series: the trend is the readings alone, nothing estimated', () => {
  it('is empty with none, and date-ascending however the rows came in', () => {
    expect(vo2Series([])).toEqual([])
    expect(vo2Series([r('2026-11-07', 44)])).toEqual([r('2026-11-07', 44)])
    expect(vo2Series([r('2026-11-14', 45), r('2026-11-07', 44), r('2026-11-10', 43)])).toEqual([r('2026-11-07', 44), r('2026-11-10', 43), r('2026-11-14', 45)])
  })
  it('invents nothing between readings: the series holds exactly the stored rows', () => {
    const readings = [r('2026-11-07', 44), r('2026-12-19', 46)]
    expect(vo2Series(readings)).toHaveLength(2)
  })
})

describe('replacesToday: today’s stored reading, for the "saving replaces it" line', () => {
  it('is today’s reading when one is stored, and null when not', () => {
    const readings = [r('2026-11-07', 44), r('2026-11-10', 43)]
    expect(replacesToday(readings, '2026-11-10')).toEqual(r('2026-11-10', 43))
    expect(replacesToday(readings, '2026-11-11')).toBeNull()
    expect(replacesToday([], '2026-11-10')).toBeNull()
  })
})
