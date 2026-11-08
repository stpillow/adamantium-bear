import { ACL_RSI_MAX, ACL_RSI_MIN, type AclRsiEntry, type IsoDate } from '../schema/index.ts'

/**
 * ACL-RSI entries (Batch A; PROGRAM-QUESTIONS 156): the 12-item psychological-readiness scale
 * (Webster, Feller & Lambros 2008), each item 0 to 10 on the published anchors, one entry per
 * day keyed by date. The overall score is the mean × 10, 0 to 100, higher readier. Read by the
 * GATES RULE ALONE among rule modules: gate 3 requires the latest entry's score to reach 76,
 * the strict published threshold (Shawn, Nov 8). src/rules/aclRsi.guard.test.ts pins gates.ts
 * as the one deliberate rule-level reader, with the backup a carrier; the manual "would trust
 * it at full speed" toggle stays its own separate gate item.
 */

/** The 12 item fields, in the published order. */
export const ACL_RSI_ITEM_FIELDS = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8', 'i9', 'i10', 'i11', 'i12'] as const

/**
 * The overall score: mean of the 12 items × 10, to one decimal rounded down so the words never
 * read better than the verdict (the 188/209 discipline). Items are whole 0 to 10, so the score
 * is sum × 5⁄6: exactly 76 is unreachable — a sum of 91 reads 75.8 and fails the gate-3 line, a
 * sum of 92 reads 76.6 and passes (PROGRAM-QUESTIONS 156). The 1e-9 only absorbs floating point
 * on exact tenths (a sum of 96 is 80, not 79.9).
 */
export function aclRsiScore(entry: AclRsiEntry): number {
  const sum = ACL_RSI_ITEM_FIELDS.reduce((total, field) => total + entry[field], 0)
  return Math.floor((sum * 25) / 3 + 1e-9) / 10
}

/** The entries date-ascending, whatever order they came in. */
export function aclRsiSeries(entries: readonly AclRsiEntry[]): AclRsiEntry[] {
  return [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** The newest entry by date, or null with none stored: what the gate reads, like the hop items read their latest tests. */
export function latestAclRsiEntry(entries: readonly AclRsiEntry[]): AclRsiEntry | null {
  return aclRsiSeries(entries).at(-1) ?? null
}

/** Today's stored entry, for the "saving replaces it" line; null when today has none yet. */
export function aclRsiReplacesToday(entries: readonly AclRsiEntry[], today: IsoDate): AclRsiEntry | null {
  return entries.find((e) => e.date === today) ?? null
}

/**
 * Refusal words for one answer, null when it is fine. Never clamps (the 152/154 precedent).
 * An unanswered item is not an error here: Save waits on the all-12 count in words instead,
 * since the published scale has no missing-data rule.
 */
export function aclRsiProblem(value: number | null): string | null {
  if (value === null) return null
  if (!Number.isInteger(value)) return `An ACL-RSI answer is a whole number, ${ACL_RSI_MIN} to ${ACL_RSI_MAX}.`
  if (value < ACL_RSI_MIN || value > ACL_RSI_MAX) return `An ACL-RSI answer reads ${ACL_RSI_MIN} to ${ACL_RSI_MAX}; ${value} is outside that.`
  return null
}
