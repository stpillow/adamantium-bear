import { describe, expect, it } from 'vitest'
import { needsFirstRun, onboardingState } from './onboarding.ts'

/*
 * When a phone counts as set up (M-U1, PROGRAM-QUESTIONS 207). A settings row means set up, whatever
 * else is stored: Shawn's phone, and every phone set up before first run existed, opens on Today.
 * Nothing stored at all (or only a time zone row) is a fresh phone: first run. Anything stored but
 * no settings row (an export stamp, a heart-rate row, a log) asks first run's questions too, and
 * first run keeps every row already there.
 */

describe('onboardingState', () => {
  it('a settings row means set up, with or without anything else', () => {
    expect(onboardingState({ settingsRow: true, otherRows: 0 })).toBe('onboarded')
    expect(onboardingState({ settingsRow: true, otherRows: 1 })).toBe('onboarded')
    expect(onboardingState({ settingsRow: true, otherRows: 4_000 })).toBe('onboarded')
  })
  it('nothing stored is a fresh phone', () => {
    expect(onboardingState({ settingsRow: false, otherRows: 0 })).toBe('fresh')
  })
  it('rows but no settings row (the export stamp alone, a heart-rate row alone, a log) is data without settings', () => {
    expect(onboardingState({ settingsRow: false, otherRows: 1 })).toBe('data-without-settings')
    expect(onboardingState({ settingsRow: false, otherRows: 12 })).toBe('data-without-settings')
  })
  it('asks the questions on every phone without a settings row', () => {
    expect(needsFirstRun('fresh')).toBe(true)
    expect(needsFirstRun('data-without-settings')).toBe(true)
    expect(needsFirstRun('onboarded')).toBe(false)
  })
})
