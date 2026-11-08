import { VO2_MAX, VO2_MIN, type IsoDate, type Vo2Reading } from '../schema/index.ts'

/**
 * VO2 max readings (metrics phase 3): TYPED from what the watch shows, whenever it changes,
 * one per day keyed by date, nothing estimated, ever — the trend is the readings alone
 * (PROGRAM-QUESTIONS 153 to 155). It informs and changes nothing: no prescription, reading,
 * cap or gate may rest on it, which src/rules/vo2.guard.test.ts holds the way the training-load
 * guard does. Only the Progress screen's helpers may import this module.
 */

/**
 * Refusal words for a typed reading, null when it is fine. Never clamps (the NumberField /
 * PROGRAM-QUESTIONS 152 precedent: clamping would store a number nobody measured). An empty
 * field is not an error shown as an alert; it just leaves Save waiting under these words.
 */
export function vo2Problem(value: number | null): string | null {
  if (value === null) return 'Type the number from the watch first.'
  if (!Number.isInteger(value)) return 'VO2 max is a whole number.'
  if (value < VO2_MIN || value > VO2_MAX) return `VO2 max reads ${VO2_MIN} to ${VO2_MAX}; ${value} is outside that.`
  return null
}

/** The newest reading by date, or null with none stored. */
export function latestReading(readings: readonly Vo2Reading[]): Vo2Reading | null {
  return vo2Series(readings).at(-1) ?? null
}

/** The readings date-ascending: the trend is the readings alone, nothing estimated between them. */
export function vo2Series(readings: readonly Vo2Reading[]): Vo2Reading[] {
  return [...readings].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** Today's stored reading, for the "saving replaces it" line; null when today has none yet. */
export function replacesToday(readings: readonly Vo2Reading[], today: IsoDate): Vo2Reading | null {
  return readings.find((r) => r.date === today) ?? null
}
