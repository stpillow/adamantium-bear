import { PROGRAM } from '../app/session.ts'
import { entriesForPattern, entriesForPhase, entriesForRule, getEvidence, rationaleFor, type Loaded } from '../evidence/evidence.ts'
import { Pattern, type Settings } from '../schema/index.ts'
import type { AppRule, Design, EvidenceEntry, Grade } from '../schema/evidence.ts'
import { currentTemplates, shortDate } from './LocationEditor.helpers.ts'
import { patternWords } from './Program.helpers.ts'

/*
 * The evidence layer's words and view models (Batch F, PROGRAM-QUESTIONS 191 to 201): the Program
 * screen's Evidence view and the Gates screen's "Why this test". Read-only presentation of the
 * bundled, hand-curated list: no citation changes a prescription, a reading, a gate verdict, a load
 * or a warning, and nothing here fetches. A citation's link is a plain navigation Shawn taps.
 */

export const ATTRIBUTION = 'Citations found through Europe PMC and PubMed (US National Library of Medicine).'
export const NO_RATIONALE_NOTE = 'Items without “Why this test” have no study listed yet; their lines come from program.md.'
export const EVIDENCE_LEAD = 'Published studies behind this phase, the rules it runs on and its movement patterns, for reading. Nothing here changes what the app prescribes.'
export const EVIDENCE_NOTE =
  'None of these studies is of a non-operative multi-ligament sprain: many are after ACL surgery, others are of tendon injuries, kneecap pain or uninjured people, so every one is graded down for that unless it is already very low. The grade is a word: high, moderate, low or very low certainty.'
export const OPENS_OUTSIDE = 'Studies open in the browser; the app itself never contacts these sites.'
export const PHASE_4_PATTERNS = 'Phase 4’s sessions aren’t written yet, so there are no movement patterns to list.'

const GRADE_WORDS: Readonly<Record<Grade, string>> = {
  high: 'High certainty (GRADE)',
  moderate: 'Moderate certainty (GRADE)',
  low: 'Low certainty (GRADE)',
  'very low': 'Very low certainty (GRADE)',
}
export const gradeWords = (g: Grade) => GRADE_WORDS[g]

const DESIGN_WORDS: Readonly<Record<Design, string>> = {
  rct: 'Randomized trial',
  'meta-analysis': 'Meta-analysis',
  'systematic-review': 'Systematic review',
  cohort: 'Cohort study',
  'case-control': 'Case-control study',
  'cross-sectional': 'Cross-sectional study',
  'diagnostic-accuracy': 'Measurement study (reliability or accuracy)',
  'case-series': 'Case series',
  'narrative-review': 'Narrative review',
  'expert-opinion': 'Expert consensus or opinion',
  guideline: 'Clinical practice guideline',
}
export const designWords = (d: Design) => DESIGN_WORDS[d]

const RULE_HEADINGS: Readonly<Record<AppRule, string>> = {
  'pain-monitoring': 'Pain monitoring (clean, hold, back-off)',
  'criteria-progression': 'Gates, not dates',
  deload: 'Deload weeks',
  'warm-up': 'Warm-up',
}
const RULE_ORDER: readonly AppRule[] = ['pain-monitoring', 'criteria-progression', 'deload', 'warm-up']

export const populationWords = (e: Pick<EvidenceEntry, 'population'>) => `Studied: ${e.population.replace(/\.$/, '')}.`

export function indirectWords(e: Pick<EvidenceEntry, 'indirect'>): string | null {
  return e.indirect ? 'Indirect for your knee (not a non-operative multi-ligament sprain, or a different outcome), which costs one GRADE level unless it is already very low.' : null
}

export const readWords = (e: Pick<EvidenceEntry, 'read'>) => (e.read === 'abstract-only' ? '(abstract only)' : null)

export const countWords = (n: number) => (n === 0 ? 'No study listed yet' : n === 1 ? '1 study' : `${n} studies`)
export const toggleWords = (open: boolean, n: number) => (open ? 'Hide studies' : `Show ${countWords(n)}`)

/**
 * "Silbernagel et al., 2007": the first author's name up to their initials (kept whole when it has
 * none, as a group author has), "et al." when more names follow.
 */
export function shortCite(e: Pick<EvidenceEntry, 'authors' | 'year'>): string {
  const list = e.authors.trim().replace(/\.$/, '')
  const first = (list.split(', ')[0] ?? list).trim()
  const tokens = first.split(' ')
  const last = tokens[tokens.length - 1] ?? ''
  const name = tokens.length > 1 && /^[A-Z][A-Z-]{0,4}$/.test(last) ? tokens.slice(0, -1).join(' ') : first
  const more = list.includes(', ') || list.endsWith('et al')
  return `${name}${more ? ' et al.' : ''}, ${e.year}`
}

export function citationLine(e: Pick<EvidenceEntry, 'authors' | 'title' | 'journal' | 'year'>): string {
  const title = /[.?!]$/.test(e.title.trim()) ? e.title.trim() : `${e.title.trim()}.`
  return `${e.authors.trim().replace(/\.$/, '')}. ${title} ${e.journal}, ${e.year}.`
}

/** doi.org link, each path segment encoded: old SICI DOIs carry < > ; # ? that would break the URL raw. */
export function doiHref(doi: string): string {
  return `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}`
}

export interface LinkView {
  label: 'DOI' | 'PubMed' | 'Europe PMC'
  href: string
}

/** Built from the ids, never stored, so a host can't be mistyped in the data. */
export function linksFor(e: Pick<EvidenceEntry, 'doi' | 'pmid'>): LinkView[] {
  return [
    ...(e.doi === undefined ? [] : [{ label: 'DOI' as const, href: doiHref(e.doi) }]),
    { label: 'PubMed', href: `https://pubmed.ncbi.nlm.nih.gov/${e.pmid}/` },
    { label: 'Europe PMC', href: `https://europepmc.org/article/MED/${e.pmid}` },
  ]
}

export interface EntryView {
  id: string
  title: string
  citation: string
  cite: string
  /** "Randomized trial · Low certainty (GRADE)". */
  kindLine: string
  /** Gates’ line: "Sprague et al., 2021, Randomized trial: Low certainty (GRADE)." */
  gateLine: string
  population: string
  indirect: string | null
  takeaway: string
  abstractOnly: string | null
  graded: string
  links: (LinkView & { ariaLabel: string })[]
}

export function entryView(e: EvidenceEntry): EntryView {
  const cite = shortCite(e)
  return {
    id: e.id,
    title: e.title,
    citation: citationLine(e),
    cite,
    kindLine: `${designWords(e.design)} · ${gradeWords(e.grade)}`,
    gateLine: `${cite}, ${designWords(e.design)}: ${gradeWords(e.grade)}.`,
    population: populationWords(e),
    indirect: indirectWords(e),
    takeaway: e.takeaway,
    abstractOnly: readWords(e),
    graded: `How it was graded: ${e.gradeBasis}`,
    links: linksFor(e).map((l) => ({ ...l, ariaLabel: `${l.label}: ${cite}, opens in the browser` })),
  }
}

/** The patterns of the exercises on the current phase's templates: the whole phase, not this week; none in Phase 4. */
export function phasePatterns(settings: Settings): Pattern[] {
  const byId = new Map(PROGRAM.exercises.map((e) => [e.id, e.pattern]))
  const present = new Set(currentTemplates(settings).flatMap((t) => t.slots.map((s) => byId.get(s.exerciseId))))
  return Pattern.options.filter((p) => present.has(p))
}

export interface GroupView {
  id: string
  heading: string
  countWords: string
  entries: EntryView[]
}

export interface SectionView {
  id: string
  heading: string
  count: number
  countWords: string
  /** The section's studies; empty for the rules section, whose studies sit in its groups. */
  entries: EntryView[]
  groups: GroupView[]
}

export type EvidenceView = { kind: 'error'; words: string } | { kind: 'ok'; sections: SectionView[]; patternsNote: string | null; footer: string[] }

const section = (id: string, heading: string, entries: readonly EvidenceEntry[]): SectionView => ({
  id,
  heading,
  count: entries.length,
  countWords: countWords(entries.length),
  entries: entries.map(entryView),
  groups: [],
})

/** The phase, then the rules the app runs on, then each pattern in the enum's order. */
export function evidenceView(phase: number, patterns: readonly Pattern[], loaded: Loaded = getEvidence()): EvidenceView {
  if (loaded.kind === 'error') return { kind: 'error', words: `The evidence list didn’t load (${loaded.error}). Nothing the app prescribes depends on it.` }
  const ev = loaded.evidence
  const name = PROGRAM.phases.find((p) => p.number === phase)?.name
  const groups = RULE_ORDER.map((rule) => {
    const entries = entriesForRule(ev, rule)
    return { id: `rule-${rule}`, heading: RULE_HEADINGS[rule], countWords: countWords(entries.length), entries: entries.map(entryView) }
  })
  const ruleCount = new Set(RULE_ORDER.flatMap((rule) => entriesForRule(ev, rule).map((e) => e.id))).size
  const sections: SectionView[] = [
    section(`phase-${phase}`, name ? `Phase ${phase} · ${name}` : `Phase ${phase}`, entriesForPhase(ev, phase)),
    { id: 'rules', heading: 'Rules the app runs on', count: ruleCount, countWords: countWords(ruleCount), entries: [], groups },
    ...Pattern.options.filter((p) => patterns.includes(p)).map((p) => section(p, patternWords(p), entriesForPattern(ev, p))),
  ]
  return {
    kind: 'ok',
    sections,
    patternsNote: patterns.length === 0 ? PHASE_4_PATTERNS : null,
    footer: [ATTRIBUTION, `Curated by hand on ${shortDate(ev.curatedOn)} from searches saved with the app.`, OPENS_OUTSIDE],
  }
}

/** A gate item's "Why this test": the sentence and its citations, or null where no study is listed (PROGRAM-QUESTIONS 197). */
export function rationaleView(itemId: string, loaded: Loaded = getEvidence()): { why: string; citations: EntryView[] } | null {
  if (loaded.kind === 'error') return null
  const r = rationaleFor(loaded.evidence, itemId)
  return r === null ? null : { why: r.why, citations: r.entries.map(entryView) }
}

/** The lines under the checklist: the attribution once any item has a rationale, and the note when some don't. */
export function gateEvidenceLines(itemIds: readonly string[], loaded: Loaded = getEvidence()): string[] {
  const has = itemIds.map((id) => rationaleView(id, loaded) !== null)
  if (!has.some(Boolean)) return []
  return has.every(Boolean) ? [ATTRIBUTION] : [ATTRIBUTION, NO_RATIONALE_NOTE]
}
