import { MORNING_TAGS, type MorningCheck, type MorningTag, type ReadingResult } from '../schema/index.ts'
import { checkFor, type SubjectReading } from './history.ts'
import { worst } from './reading.ts'

/*
 * Morning-check tags, counted (Batch D, Shawn's Nov 8 decision 10; PROGRAM-QUESTIONS 177, 178). Plain
 * counts on the phone, for Progress to say in words: after each tag, how the readings came out, with
 * the mornings without it beside. No score, no weighting, no claim about why. Tags feed no reading,
 * prescription, gate or load: this module and the screens that show its counts are the only code
 * that reads them (src/rules/morningTags.guard.test.ts).
 *
 * The pairing, recorded: a check's tags describe the day and night before its morning, so each check
 * pairs with one reading, the worst of the sessions it completes (the sessions the day before whose
 * reading uses this very check: history.ts's checkFor). A check with no session the day before pairs
 * with nothing and is skipped. One reading per check, so nothing is counted twice.
 */

/** Paired mornings a tag needs before its counts show; under it Progress says how many so far. */
export const TAG_MIN_SAMPLE = 5

export interface ReadingCounts {
  /** Mornings paired with a reading. */
  paired: number
  clean: number
  hold: number
  backOff: number
}

export interface TagCount extends ReadingCounts {
  tag: MorningTag
  /** Every check carrying the tag, paired with a reading or not. */
  tagged: number
  /** The same counts for every paired morning without this tag. */
  without: ReadingCounts
}

const EMPTY: ReadingCounts = { paired: 0, clean: 0, hold: 0, backOff: 0 }

function add(counts: ReadingCounts, result: ReadingResult): ReadingCounts {
  return {
    paired: counts.paired + 1,
    clean: counts.clean + (result === 'clean' ? 1 : 0),
    hold: counts.hold + (result === 'hold' ? 1 : 0),
    backOff: counts.backOff + (result === 'back-off' ? 1 : 0),
  }
}

/** Each check that completes a reading, with that reading: the worst of the sessions whose reading uses it. */
export function pairedMornings(checks: readonly MorningCheck[], readings: readonly SubjectReading[]): { check: MorningCheck; result: ReadingResult }[] {
  return checks
    .map((check) => {
      const completed = readings.filter((r) => checkFor(r, checks)?.id === check.id)
      return completed.length === 0 ? null : { check, result: worst(completed.map((r) => r.result)) }
    })
    .filter((p): p is { check: MorningCheck; result: ReadingResult } => p !== null)
}

/** Per tag, in the form's order: the readings on the mornings after it, and on the paired mornings without it. */
export function tagCounts(checks: readonly MorningCheck[], readings: readonly SubjectReading[]): TagCount[] {
  const paired = pairedMornings(checks, readings)
  return MORNING_TAGS.map((tag) => {
    let withTag = EMPTY
    let without = EMPTY
    for (const { check, result } of paired) {
      if (check.tags?.includes(tag)) withTag = add(withTag, result)
      else without = add(without, result)
    }
    return { tag, tagged: checks.filter((c) => c.tags?.includes(tag)).length, ...withTag, without }
  })
}

/** Whether any stored check carries a tag at all. */
export function anyTagged(checks: readonly MorningCheck[]): boolean {
  return checks.some((c) => (c.tags?.length ?? 0) > 0)
}
