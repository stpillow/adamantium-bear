import { z } from 'zod'
import { IsoDate, Pattern } from './enums.ts'

/*
 * The evidence layer's schema (Batch F, Shawn's Nov 8 decision 9; PROGRAM-QUESTIONS 191 to 202).
 * data/evidence.json is hand-curated from records fetched from Europe PMC and PubMed during
 * development; the app reads it for display only. Nothing under src/rules, and no engine input,
 * reads this file or its data (src/rules/evidence.guard.test.ts). Deliberately not exported from
 * ./index.ts, so no domain import can reach it by accident.
 */

const kebab = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'expected a kebab-case id')
export const Pmid = z.string().regex(/^[1-9]\d{0,8}$/, 'a PubMed id')
export const Pmcid = z.string().regex(/^PMC\d+$/, 'a PubMed Central id')
export const Doi = z.string().regex(/^10\.\d{4,9}\/\S+$/, 'a DOI')

/** The four GRADE certainty words, best first. Shown as words, never color. */
export const Grade = z.enum(['high', 'moderate', 'low', 'very low'])
export type Grade = z.infer<typeof Grade>

/** The study design as published. */
export const Design = z.enum([
  'meta-analysis',
  'systematic-review',
  'rct',
  'cohort',
  'case-control',
  'cross-sectional',
  'diagnostic-accuracy',
  'case-series',
  'narrative-review',
  'expert-opinion',
  'guideline',
])
export type Design = z.infer<typeof Design>

/** What the GRADE rule starts from for this question (PROGRAM-QUESTIONS 191). */
export const AssessedAs = z.enum(['randomized', 'observational', 'opinion'])
export type AssessedAs = z.infer<typeof AssessedAs>
export const START: Readonly<Record<AssessedAs, Grade>> = { randomized: 'high', observational: 'low', opinion: 'very low' }

/**
 * The starting points the rule gives each design. A review starts where its included studies do.
 * A guideline without a GRADE rating of its own is read as consensus. Anything else is a named
 * exception: lower only, never higher, and only with a `startReason` (PROGRAM-QUESTIONS 191).
 */
export const NATURAL_START: Readonly<Record<Design, readonly AssessedAs[]>> = {
  'meta-analysis': ['randomized', 'observational'],
  'systematic-review': ['randomized', 'observational'],
  rct: ['randomized'],
  cohort: ['observational'],
  'case-control': ['observational'],
  'cross-sectional': ['observational'],
  'diagnostic-accuracy': ['observational'],
  'case-series': ['opinion'],
  'narrative-review': ['opinion'],
  'expert-opinion': ['opinion'],
  guideline: ['opinion'],
}

/** The app's own rules an entry can speak to, in the order the Evidence view lists them. */
export const AppRule = z.enum(['pain-monitoring', 'criteria-progression', 'deload', 'warm-up'])
export type AppRule = z.infer<typeof AppRule>
export const ReadFrom = z.enum(['abstract-only', 'full-text'])
export type ReadFrom = z.infer<typeof ReadFrom>
export const LiteratureSource = z.enum(['europepmc', 'pubmed'])
export type LiteratureSource = z.infer<typeof LiteratureSource>

export const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length

/** Abbreviations whose period ends no sentence. */
const ABBREVIATIONS = /\b(?:vs|e\.g|i\.e|et al|approx|cf)\./g

/** One sentence: it ends in a single period, and no . ! or ? before it is followed by a space (semicolons are fine). */
export function isOneSentence(text: string): boolean {
  const s = text.trim().replace(ABBREVIATIONS, (m) => m.replace(/\./g, ''))
  return s.endsWith('.') && !s.endsWith('..') && !/[.!?]["'’”)\]]?\s/.test(s.slice(0, -1))
}

/** Proper nouns that may open the clause after a semicolon; acronyms (ACL, FIFA) and citations (Logerstedt 2017) may too. */
const PROPER_AFTER_SEMICOLON = new Set(['Nordic', 'Copenhagen', 'Bulgarian', 'Romanian', 'Dutch', 'Delphi'])

/**
 * Two sentences spliced with a semicolon: "…better function; Pain monitoring was never tested…".
 * A capital after a semicolon opens a second sentence unless it starts an acronym, a listed proper
 * noun or a citation; the clause after a semicolon is lowercase.
 */
export function joinsTwoSentences(text: string): boolean {
  for (const m of text.matchAll(/;\s+([A-Z][\w’'-]*)(\s+\d{4}\b)?/g)) {
    const word = m[1] ?? ''
    if (/^[A-Z0-9][A-Z0-9-]*$/.test(word) || PROPER_AFTER_SEMICOLON.has(word) || m[2] !== undefined) continue
    return true
  }
  return false
}

const sentence = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .refine(isOneSentence, 'one sentence, ending in a period')
    .refine((t) => !joinsTwoSentences(t), 'one sentence: a capital after a semicolon starts a second one')
    .refine((t) => wordCount(t) <= max, `at most ${max} words`)

/** Grade rank: 0 is high, 3 is very low. */
const rank = (g: Grade) => Grade.options.indexOf(g)

/**
 * GRADE as PROGRAM-QUESTIONS 191 states it. The source's own rating wins and then only
 * indirectness applies (its GRADE already counts imprecision); otherwise start where the design is
 * assessed and step down one for indirectness and one for imprecision. Very low is the floor.
 */
export function derivedGrade(e: { sourceGrade?: Grade | undefined; assessedAs?: AssessedAs | undefined; indirect: boolean; imprecise: boolean }): Grade {
  const start = e.sourceGrade ?? START[e.assessedAs ?? 'opinion']
  const steps = (e.indirect ? 1 : 0) + (e.sourceGrade === undefined && e.imprecise ? 1 : 0)
  return Grade.options[Math.min(rank(start) + steps, 3)] ?? 'very low'
}

/** Why a start differs from the design's natural one, or null when it needs no reason. */
export function startProblem(e: { design: Design; assessedAs?: AssessedAs | undefined; startReason?: string | undefined }): string | null {
  if (e.assessedAs === undefined) return e.startReason === undefined ? null : 'a start reason without an assessed start'
  const natural = NATURAL_START[e.design]
  if (natural.includes(e.assessedAs)) return e.startReason === undefined ? null : 'a start reason on a natural start'
  const highest = Math.min(...natural.map((a) => rank(START[a])))
  if (rank(START[e.assessedAs]) < highest) return `${e.design} can’t start as ${e.assessedAs}: never higher than the design`
  return e.startReason === undefined ? `${e.design} read as ${e.assessedAs} needs a start reason` : null
}

const REVIEW_DESIGNS: readonly Design[] = ['meta-analysis', 'systematic-review']

/**
 * A review starts high only if it pooled randomized trials alone (PROGRAM-QUESTIONS 191b); the
 * schema can't read the pool, so a review read as randomized must say so in its basis, and one
 * whose basis admits non-randomized or "and/or controlled" trials is refused (Nascimento 2018).
 */
export function reviewPoolProblem(e: { design: Design; assessedAs?: AssessedAs | undefined; gradeBasis: string }): string | null {
  if (!REVIEW_DESIGNS.includes(e.design) || e.assessedAs !== 'randomized') return null
  const saysRandomized = /\brandomi[sz]ed (controlled )?trials\b|\bRCTs\b/i.test(e.gradeBasis)
  const admitsOthers = /and\/or|non-?randomi[sz]ed|quasi|mixed|observational|cohort/i.test(e.gradeBasis)
  return saysRandomized && !admitsOthers ? null : `a ${e.design} starting high must say in its basis that it pooled randomized trials only`
}

export const Search = z.strictObject({
  id: kebab,
  source: LiteratureSource,
  query: z.string().min(1),
  /** What it looks for, in words ("pain-monitoring", "return to running (g1-run)"). */
  purpose: z.string().min(1),
  savedOn: IsoDate,
  hitsOnSave: z.number().int().min(0).optional(),
})
export type Search = z.infer<typeof Search>

export const EvidenceEntry = z
  .strictObject({
    id: kebab,
    /** As fetched, verbatim ("Silbernagel KG, Thomeé R, …" or "… et al."). */
    authors: z.string().min(1),
    title: z.string().min(1),
    journal: z.string().min(1),
    year: z.number().int().min(1950).max(2100),
    pmid: Pmid,
    pmcid: Pmcid.optional(),
    doi: Doi.optional(),
    design: Design,
    sourceGrade: Grade.optional(),
    assessedAs: AssessedAs.optional(),
    /** One sentence, for a start lower than the design's own (Thomeé 1997). */
    startReason: sentence(40).optional(),
    indirect: z.boolean(),
    imprecise: z.boolean(),
    grade: Grade,
    gradeBasis: z.string().min(1),
    population: z.string().refine((t) => wordCount(t) >= 3, 'the population in words'),
    takeaway: sentence(40),
    read: ReadFrom,
    openAccess: z.boolean(),
    phases: z.array(z.number().int().min(1).max(4)),
    patterns: z.array(Pattern),
    appRules: z.array(AppRule),
    foundBy: z.array(kebab).min(1),
    verifiedOn: IsoDate,
    verifiedAgainst: LiteratureSource,
  })
  .superRefine((e, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    if ((e.sourceGrade === undefined) === (e.assessedAs === undefined)) issue('exactly one of sourceGrade or assessedAs')
    if (e.sourceGrade !== undefined && e.imprecise) issue('the source’s own GRADE already counts imprecision')
    const start = startProblem(e)
    if (start !== null) issue(start)
    const pool = reviewPoolProblem(e)
    if (pool !== null) issue(pool)
    const rule = derivedGrade(e)
    if (e.grade !== rule) issue(`grade ${e.grade} isn’t the rule’s ${rule}`)
    if (e.indirect && !/indirect|population|post-?ACLR|outcome/i.test(e.gradeBasis)) issue('the basis says why it is indirect')
  })
export type EvidenceEntry = z.infer<typeof EvidenceEntry>

export const GateRationale = z.strictObject({ itemId: kebab, why: sentence(40), entryIds: z.array(kebab).min(1) })
export type GateRationale = z.infer<typeof GateRationale>

/** A paper looked at and deliberately not curated, so the digest stops proposing it. Never rendered. */
export const Seen = z.strictObject({ pmid: Pmid, why: sentence(30) })
export type Seen = z.infer<typeof Seen>

const duplicates = (values: readonly string[]) => values.filter((v, i) => values.indexOf(v) !== i)

export const Evidence = z
  .strictObject({
    version: z.literal(1),
    curatedOn: IsoDate,
    searches: z.array(Search).min(1),
    entries: z.array(EvidenceEntry).min(1),
    gateRationales: z.array(GateRationale),
    seen: z.array(Seen),
  })
  .superRefine((ev, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    const entryIds = ev.entries.map((e) => e.id)
    for (const d of duplicates(entryIds)) issue(`entry ${d} is listed twice`)
    for (const d of duplicates(ev.entries.map((e) => e.pmid))) issue(`PMID ${d} is on two entries`)
    for (const d of duplicates(ev.entries.flatMap((e) => (e.doi === undefined ? [] : [e.doi.toLowerCase()])))) issue(`DOI ${d} is on two entries`)
    for (const d of duplicates(ev.searches.map((s) => s.id))) issue(`search ${d} is listed twice`)
    for (const d of duplicates(ev.searches.map((s) => `${s.source} ${s.query}`))) issue(`the ${d} search is saved twice`)
    for (const d of duplicates(ev.gateRationales.map((r) => r.itemId))) issue(`gate item ${d} has two rationales`)
    for (const d of duplicates(ev.seen.map((s) => s.pmid))) issue(`seen PMID ${d} is listed twice`)
    const searchIds = new Set(ev.searches.map((s) => s.id))
    const known = new Set(entryIds)
    for (const e of ev.entries) for (const s of e.foundBy) if (!searchIds.has(s)) issue(`${e.id} was found by ${s}, which isn’t a saved search`)
    for (const r of ev.gateRationales) for (const id of r.entryIds) if (!known.has(id)) issue(`the ${r.itemId} rationale cites ${id}, which isn’t an entry`)
    const cited = new Set(ev.gateRationales.flatMap((r) => r.entryIds))
    for (const e of ev.entries) {
      if (e.phases.length + e.patterns.length + e.appRules.length === 0 && !cited.has(e.id)) issue(`${e.id} shows nowhere: no phase, pattern, rule or gate rationale`)
    }
    const pmids = new Set(ev.entries.map((e) => e.pmid))
    for (const s of ev.seen) if (pmids.has(s.pmid)) issue(`seen PMID ${s.pmid} is also an entry`)
  })
export type Evidence = z.infer<typeof Evidence>
