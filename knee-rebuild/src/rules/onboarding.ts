/*
 * When a phone counts as set up (M-U1, PROGRAM-QUESTIONS 207). Pure: src/db/repo.ts counts the
 * stored rows (`onboardingFacts`) and the shell asks this which way to go.
 */

/**
 * - `onboarded`: a settings row is stored (read as present, not parsed, so a row this build can't
 *   read still stops the app in words instead of asking the questions again). Today opens.
 * - `fresh`: nothing is stored but, at most, a time zone row. First run asks its questions.
 * - `data-without-settings`: rows are stored but no settings row (a heart-rate row, the export stamp,
 *   a log). First run asks its questions too, and keeps every row already there; no Shawn-specific
 *   value is seeded in their place.
 */
export type OnboardingState = 'fresh' | 'onboarded' | 'data-without-settings'

export interface StoredFacts {
  /** Whether the settings row is stored, as stored. */
  settingsRow: boolean
  /** Every row in every table except the settings row and the time zone row (the export stamp's row counts). */
  otherRows: number
}

export function onboardingState(facts: StoredFacts): OnboardingState {
  if (facts.settingsRow) return 'onboarded'
  return facts.otherRows > 0 ? 'data-without-settings' : 'fresh'
}

/** Whether first run asks its questions: every phone without a settings row. */
export function needsFirstRun(state: OnboardingState): boolean {
  return state !== 'onboarded'
}
