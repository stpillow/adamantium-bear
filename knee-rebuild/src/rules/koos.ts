import { KOOS_MAX, KOOS_MIN, type IsoDate, type KoosEntry } from '../schema/index.ts'
import { daysBetween } from './calendar.ts'

/**
 * KOOS entries (Batch A; PROGRAM-QUESTIONS 156 to 160): the validated 42-item questionnaire,
 * answered over the last week, one entry per day keyed by date. Five subscales, each scored by
 * the published formula 100 − mean × 25 (100 = no problems), only when at least half the
 * subscale's items are answered. It INFORMS AND CHANGES NOTHING: no prescription, reading, cap
 * or gate may rest on a KOOS number — scores show on Progress only, never on the Gates screen,
 * so a dipping subscale can never read as an extra gate requirement (Shawn, Nov 8).
 * src/rules/koos.guard.test.ts holds every rule module off it, gates.ts by name.
 */

export type KoosSubscale = 'pain' | 'symptoms' | 'adl' | 'sport' | 'qol'

/** The five subscales, in the order the form and Progress list them. */
export const KOOS_SUBSCALES: readonly KoosSubscale[] = ['pain', 'symptoms', 'adl', 'sport', 'qol']

/** Each subscale's item fields on a KoosEntry (symptoms carries S1 to S5 and the two stiffness items, per the published scoring). */
export const KOOS_SUBSCALE_ITEMS: Record<KoosSubscale, readonly (keyof Omit<KoosEntry, 'date'>)[]> = {
  pain: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'],
  symptoms: ['sy1', 'sy2', 'sy3', 'sy4', 'sy5', 'sy6', 'sy7'],
  adl: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15', 'a16', 'a17'],
  sport: ['sp1', 'sp2', 'sp3', 'sp4', 'sp5'],
  qol: ['q1', 'q2', 'q3', 'q4'],
}

/** Each subscale's name in words. */
export const KOOS_SUBSCALE_WORDS: Record<KoosSubscale, string> = {
  pain: 'Pain',
  symptoms: 'Symptoms',
  adl: 'Daily living',
  sport: 'Sport and recreation',
  qol: 'Quality of life',
}

/** How many of the subscale's items the entry answered. */
export function koosAnswered(entry: KoosEntry, subscale: KoosSubscale): number {
  return KOOS_SUBSCALE_ITEMS[subscale].filter((field) => entry[field] !== undefined).length
}

/** At least half the subscale's items: Pain 5 of 9, Symptoms 4 of 7, ADL 9 of 17, Sport/Rec 3 of 5, QOL 2 of 4. */
export function koosNeeded(subscale: KoosSubscale): number {
  return Math.ceil(KOOS_SUBSCALE_ITEMS[subscale].length / 2)
}

/**
 * One subscale's score by the published formula: 100 − mean(observed) × 25, so 100 is no
 * problems and 0 extreme problems, to one decimal. Computed only when at least half the
 * subscale's items are answered (the published missing-data rule); null otherwise, said in
 * words at the surface, never guessed.
 */
export function koosSubscaleScore(entry: KoosEntry, subscale: KoosSubscale): number | null {
  const answered = KOOS_SUBSCALE_ITEMS[subscale].map((field) => entry[field]).filter((v): v is number => v !== undefined)
  if (answered.length < koosNeeded(subscale)) return null
  const mean = answered.reduce((total, v) => total + v, 0) / answered.length
  return Math.round((100 - mean * 25) * 10) / 10
}

/** The entries date-ascending, whatever order they came in: the trend is the entries alone. */
export function koosSeries(entries: readonly KoosEntry[]): KoosEntry[] {
  return [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** The newest entry by date, or null with none stored. */
export function latestKoosEntry(entries: readonly KoosEntry[]): KoosEntry | null {
  return koosSeries(entries).at(-1) ?? null
}

/** Today's stored entry, for the "saving replaces it" line; null when today has none yet. */
export function koosReplacesToday(entries: readonly KoosEntry[], today: IsoDate): KoosEntry | null {
  return entries.find((e) => e.date === today) ?? null
}

/** Monthly means 28 days or more since the last entry (PROGRAM-QUESTIONS 158). */
export const KOOS_DUE_DAYS = 28

/** Whether a KOOS check is due: no entry yet, or the latest is KOOS_DUE_DAYS or more days old. */
export function koosDue(entries: readonly KoosEntry[], today: IsoDate): boolean {
  const latest = latestKoosEntry(entries)
  if (!latest) return true
  return daysBetween(latest.date, today) >= KOOS_DUE_DAYS
}

/**
 * Refusal words for one answer, null when it is fine. Never clamps (the 152/154 precedent).
 * A skipped item is fine: the published missing-data rule absorbs skips, and the Save summary
 * says in words which subscales will score.
 */
export function koosProblem(value: number | null): string | null {
  if (value === null) return null
  if (!Number.isInteger(value)) return `A KOOS answer is a whole number, ${KOOS_MIN} to ${KOOS_MAX}.`
  if (value < KOOS_MIN || value > KOOS_MAX) return `A KOOS answer reads ${KOOS_MIN} to ${KOOS_MAX}; ${value} is outside that.`
  return null
}
