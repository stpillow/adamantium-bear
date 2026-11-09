import { describe, expect, it } from 'vitest'
import type { SessionCompliance } from '../../rules/compliance.ts'
import { complianceLine, complianceNote } from './Summary.helpers.ts'

const c = (over: Partial<SessionCompliance> = {}): SessionCompliance => ({ prescribed: 9, logged: 9, extra: 0, exercises: 3, stopped: 0, excluded: false, ...over })

describe('the Summary’s set count in words (Batch B)', () => {
  it('all of them, with the restriction in the line itself', () => {
    expect(complianceLine(c())).toBe('All 9 prescribed sets of the 3 exercises run.')
    expect(complianceLine(c({ prescribed: 1, logged: 1, exercises: 1 }))).toBe('All 1 prescribed set of the 1 exercise run.')
  })

  it('a shortfall, and stopped early named as a count (the block below names the reason)', () => {
    expect(complianceLine(c({ logged: 7 }))).toBe('7 of 9 prescribed sets of the 3 exercises run.')
    expect(complianceLine(c({ prescribed: 18, logged: 16, exercises: 4, stopped: 1 }))).toBe('16 of 18 prescribed sets of the 4 exercises run; 1 stopped early.')
  })

  it('sets past the prescription and spare-time exercises are extra, never prescribed', () => {
    expect(complianceLine(c({ prescribed: 10, logged: 10, extra: 1, exercises: 1 }))).toBe('All 10 prescribed sets of the 1 exercise run, plus 1 extra set.')
    expect(complianceLine(c({ extra: 6, logged: 8, stopped: 2 }))).toBe('8 of 9 prescribed sets of the 3 exercises run, plus 6 extra sets; 2 stopped early.')
    expect(complianceLine(c({ prescribed: 0, logged: 0, exercises: 0, extra: 3 }))).toBe('No prescribed exercise logged a set; 3 sets extra.')
  })

  it('nothing logged says nothing (the Summary already says "Nothing was logged.")', () => {
    expect(complianceLine(c({ prescribed: 0, logged: 0, exercises: 0, excluded: true }))).toBeNull()
    expect(complianceNote(c({ prescribed: 0, logged: 0, exercises: 0, excluded: true }))).toBeNull()
  })

  it('the note says what is left out, without claiming a count it can’t know', () => {
    expect(complianceNote(c({ excluded: true }))).toBe('Counts the exercises that logged a set. Anything skipped or dropped for time isn’t stored, so it isn’t counted.')
    expect(complianceNote(c())).toBeNull()
  })
})
