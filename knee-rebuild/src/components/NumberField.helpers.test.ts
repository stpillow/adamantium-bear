import { describe, expect, it } from 'vitest'
import { textFromValue, wholeFromText } from './NumberField.helpers.ts'

describe('wholeFromText', () => {
  it('reads digits as a whole number, and empty as null: an empty optional field is a value, never 0', () => {
    expect(wholeFromText('150')).toBe(150)
    expect(wholeFromText(' 150 ')).toBe(150)
    expect(wholeFromText('0')).toBe(0)
    expect(wholeFromText('')).toBeNull()
    expect(wholeFromText('   ')).toBeNull()
  })
  it('never clamps or invents: out-of-range numbers come back as typed (the words beside the field refuse them), non-digits as null', () => {
    expect(wholeFromText('300')).toBe(300)
    expect(wholeFromText('12')).toBe(12)
    expect(wholeFromText('1.5')).toBeNull()
    expect(wholeFromText('-5')).toBeNull()
    expect(wholeFromText('abc')).toBeNull()
    expect(wholeFromText('1e3')).toBeNull()
  })
})

describe('textFromValue', () => {
  it('shows null as an empty field and a number as itself', () => {
    expect(textFromValue(null)).toBe('')
    expect(textFromValue(150)).toBe('150')
    expect(textFromValue(0)).toBe('0')
  })
})
