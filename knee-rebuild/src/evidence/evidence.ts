import raw from '../../data/evidence.json'
import { Evidence, Grade, type AppRule, type EvidenceEntry } from '../schema/evidence.ts'
import type { Pattern } from '../schema/enums.ts'

/*
 * The curated citation list (data/evidence.json, Batch F), validated without throwing and only when
 * first asked for: the Program screen's Evidence view and the Gates screen's "Why this test" read it.
 * It is bundled at build time, so it works offline; nothing here fetches. Read only by
 * src/screens/Evidence.helpers.ts; never by src/rules or any engine input (evidence.guard.test.ts).
 */

export type Loaded = { kind: 'ok'; evidence: Evidence } | { kind: 'error'; error: string }

export function parseEvidence(input: unknown): Loaded {
  const parsed = Evidence.safeParse(input)
  if (parsed.success) return { kind: 'ok', evidence: parsed.data }
  return { kind: 'error', error: parsed.error.issues.map((i) => `${i.path.join('.') || 'the list'}: ${i.message}`).join('; ') }
}

let cached: Loaded | null = null

/** The bundled list, parsed on first use and kept: a failure never blocks the app's start. */
export function getEvidence(): Loaded {
  cached ??= parseEvidence(raw)
  return cached
}

/** Best grade first, then the newest, then by id. */
export function sortEntries(entries: readonly EvidenceEntry[]): EvidenceEntry[] {
  return [...entries].sort((a, b) => Grade.options.indexOf(a.grade) - Grade.options.indexOf(b.grade) || b.year - a.year || a.id.localeCompare(b.id))
}

export const entriesForPhase = (evidence: Evidence, phase: number) => sortEntries(evidence.entries.filter((e) => e.phases.includes(phase)))
export const entriesForPattern = (evidence: Evidence, pattern: Pattern) => sortEntries(evidence.entries.filter((e) => e.patterns.includes(pattern)))
export const entriesForRule = (evidence: Evidence, rule: AppRule) => sortEntries(evidence.entries.filter((e) => e.appRules.includes(rule)))

/** A gate item's "why this test": the sentence and the studies it rests on; null where no study is listed. */
export function rationaleFor(evidence: Evidence, itemId: string): { why: string; entries: EvidenceEntry[] } | null {
  const r = evidence.gateRationales.find((g) => g.itemId === itemId)
  if (!r) return null
  const entries = sortEntries(evidence.entries.filter((e) => r.entryIds.includes(e.id)))
  return entries.length === 0 ? null : { why: r.why, entries }
}
