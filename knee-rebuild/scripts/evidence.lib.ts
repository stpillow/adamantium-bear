import { z } from 'zod'
import { IsoDate } from '../src/schema/enums.ts'
import { LiteratureSource, wordCount, type EvidenceEntry, type Seen } from '../src/schema/evidence.ts'

/*
 * The monthly digest's pure half: request URLs, response parsers, the comparisons and the report.
 * scripts/evidence.ts does the fetching and printing. Dev-only, never bundled: nothing under src/
 * imports from scripts/ (src/rules/evidence.guard.test.ts). It writes no file and reads no
 * environment; the curator edits data/evidence.json by hand and opens a PR for Shawn.
 */

export const EPMC_SEARCH = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'
export const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/'
/** NCBI asks keyless callers to name their tool. */
export const TOOL = 'knee-rebuild-evidence'

/** A Europe PMC search page, newest first, so the newest papers fall inside the page cap. */
export function epmcSearchUrl(query: string, cursorMark = '*', pageSize = 100): string {
  const u = new URL(EPMC_SEARCH)
  u.searchParams.set('query', query)
  u.searchParams.set('resultType', 'lite')
  u.searchParams.set('format', 'json')
  u.searchParams.set('pageSize', String(pageSize))
  u.searchParams.set('cursorMark', cursorMark)
  u.searchParams.set('sort', 'P_PDATE_D desc')
  return u.toString()
}

/** One MEDLINE record from Europe PMC, with its publication types and corrections. */
export function epmcRecordUrl(pmid: string): string {
  const u = new URL(EPMC_SEARCH)
  u.searchParams.set('query', `EXT_ID:${pmid} AND SRC:MED`)
  u.searchParams.set('resultType', 'core')
  u.searchParams.set('format', 'json')
  return u.toString()
}

export function esearchUrl(term: string, retmax = 200): string {
  const u = new URL(`${EUTILS}esearch.fcgi`)
  u.searchParams.set('db', 'pubmed')
  u.searchParams.set('retmode', 'json')
  u.searchParams.set('retmax', String(retmax))
  u.searchParams.set('sort', 'pub_date')
  u.searchParams.set('tool', TOOL)
  u.searchParams.set('term', term)
  return u.toString()
}

export function esummaryUrl(pmids: readonly string[]): string {
  const u = new URL(`${EUTILS}esummary.fcgi`)
  u.searchParams.set('db', 'pubmed')
  u.searchParams.set('retmode', 'json')
  u.searchParams.set('tool', TOOL)
  u.searchParams.set('id', pmids.join(','))
  return u.toString()
}

/** PubMed's field tags ([ti], [tiab], [pt], [sb], [au], …) mark a PubMed query; anything else is Europe PMC's syntax. */
export function sourceOf(query: string): LiteratureSource {
  return /\[(?:ti|tiab|pt|sb|au|mh|dp)\]/i.test(query) ? 'pubmed' : 'europepmc'
}

/** A search hit, for the digest to show. */
export interface Candidate {
  pmid: string
  year: number | null
  /** "2026-02-24", or what PubMed gives ("2026/02/24"), for sorting. */
  date: string
  firstAuthor: string
  title: string
  journal: string
  pubTypes: string[]
}

const firstOf = (authorString: string) => (authorString.split(', ')[0] ?? '').replace(/\.$/, '').trim()
const yearOf = (text: string | undefined) => {
  const m = /\d{4}/.exec(text ?? '')
  return m ? Number(m[0]) : null
}

const EpmcSearch = z.object({
  hitCount: z.number(),
  nextCursorMark: z.string().optional(),
  resultList: z.object({
    result: z.array(
      z.object({
        pmid: z.string().optional(),
        title: z.string().optional(),
        authorString: z.string().optional(),
        journalTitle: z.string().optional(),
        pubYear: z.string().optional(),
        firstPublicationDate: z.string().optional(),
        pubType: z.string().optional(),
      }),
    ),
  }),
})

export function parseEpmcSearch(json: unknown): { hitCount: number; nextCursorMark: string | null; candidates: Candidate[]; withoutPmid: number } {
  const page = EpmcSearch.parse(json)
  const rows = page.resultList.result
  const candidates = rows.flatMap((r) =>
    r.pmid === undefined
      ? []
      : [
          {
            pmid: r.pmid,
            year: yearOf(r.pubYear),
            date: r.firstPublicationDate ?? r.pubYear ?? '',
            firstAuthor: firstOf(r.authorString ?? ''),
            title: r.title ?? '',
            journal: r.journalTitle ?? '',
            pubTypes: (r.pubType ?? '').split(';').map((t) => t.trim()).filter(Boolean),
          },
        ],
  )
  return { hitCount: page.hitCount, nextCursorMark: page.nextCursorMark ?? null, candidates, withoutPmid: rows.length - candidates.length }
}

const Esearch = z.object({ esearchresult: z.object({ count: z.string(), idlist: z.array(z.string()) }) })

export function parseEsearch(json: unknown): { count: number; pmids: string[] } {
  const r = Esearch.parse(json).esearchresult
  return { count: Number(r.count), pmids: r.idlist }
}

const Summary = z.object({
  uid: z.string(),
  pubdate: z.string().optional(),
  sortpubdate: z.string().optional(),
  title: z.string().optional(),
  fulljournalname: z.string().optional(),
  pubtype: z.array(z.string()).optional(),
  authors: z.array(z.object({ name: z.string() })).optional(),
})

export function parseEsummary(json: unknown): Candidate[] {
  const result = z.object({ result: z.record(z.string(), z.unknown()) }).parse(json).result
  const uids = z.array(z.string()).parse(result.uids ?? [])
  return uids.flatMap((uid) => {
    const s = Summary.safeParse(result[uid])
    if (!s.success) return []
    return [
      {
        pmid: s.data.uid,
        year: yearOf(s.data.pubdate),
        date: s.data.sortpubdate ?? s.data.pubdate ?? '',
        firstAuthor: s.data.authors?.[0]?.name ?? '',
        title: s.data.title ?? '',
        journal: s.data.fulljournalname ?? '',
        pubTypes: s.data.pubtype ?? [],
      },
    ]
  })
}

/** What verification compares, from a Europe PMC core record. */
export interface FetchedRecord {
  pmid: string
  title: string
  journal: string
  year: number | null
  doi?: string | undefined
  pmcid?: string | undefined
  authorString: string
  pubTypes: string[]
  corrections: { type: string; reference: string }[]
}

const Core = z.object({
  hitCount: z.number(),
  resultList: z.object({
    result: z.array(
      z.object({
        pmid: z.string().optional(),
        title: z.string().optional(),
        authorString: z.string().optional(),
        pubYear: z.string().optional(),
        doi: z.string().optional(),
        pmcid: z.string().optional(),
        journalInfo: z.object({ journal: z.object({ title: z.string().optional() }).optional() }).optional(),
        pubTypeList: z.object({ pubType: z.array(z.string()) }).optional(),
        commentCorrectionList: z.object({ commentCorrection: z.array(z.object({ type: z.string(), reference: z.string().optional() })) }).optional(),
      }),
    ),
  }),
})

export function parseEpmcCore(json: unknown): FetchedRecord | null {
  const r = Core.parse(json).resultList.result[0]
  if (r === undefined || r.pmid === undefined) return null
  return {
    pmid: r.pmid,
    title: r.title ?? '',
    journal: r.journalInfo?.journal?.title ?? '',
    year: yearOf(r.pubYear),
    doi: r.doi,
    pmcid: r.pmcid,
    authorString: r.authorString ?? '',
    pubTypes: r.pubTypeList?.pubType ?? [],
    corrections: (r.commentCorrectionList?.commentCorrection ?? []).map((c) => ({ type: c.type, reference: c.reference ?? '' })),
  }
}

const ENTITIES: Readonly<Record<string, string>> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" }
const decode = (t: string) => t.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m)

/** For comparing titles and journals: entities decoded, tags gone, case, spacing and the final period ignored. */
export function normalizeTitle(text: string): string {
  return decode(decode(text))
    .replace(/<[^>]+>/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '')
    .trim()
}

/** The stored author list matches when it is the fetched one; "…, et al." matches a longer list that starts with the names given. */
export function authorsMatch(stored: string, fetched: string): boolean {
  const s = normalizeTitle(stored)
  const f = normalizeTitle(fetched)
  const etAl = /,?\s*et al$/.exec(s)
  if (etAl === null) return s === f
  const prefix = s.slice(0, etAl.index)
  return f.startsWith(`${prefix}, `)
}

/** What changed between the stored entry and the record, in words; empty when nothing did. */
export function diffEntry(entry: Pick<EvidenceEntry, 'title' | 'journal' | 'year' | 'doi' | 'pmcid' | 'authors'>, record: FetchedRecord): string[] {
  const changes: string[] = []
  if (normalizeTitle(entry.title) !== normalizeTitle(record.title)) changes.push(`title: stored “${entry.title}”, fetched “${record.title}”`)
  if (normalizeTitle(entry.journal) !== normalizeTitle(record.journal)) changes.push(`journal: stored “${entry.journal}”, fetched “${record.journal}”`)
  if (entry.year !== record.year) changes.push(`year: stored ${entry.year}, fetched ${record.year ?? 'none'}`)
  if ((entry.doi ?? '').toLowerCase() !== (record.doi ?? '').toLowerCase()) changes.push(`doi: stored ${entry.doi ?? 'none'}, fetched ${record.doi ?? 'none'}`)
  if ((entry.pmcid ?? '') !== (record.pmcid ?? '')) changes.push(`pmcid: stored ${entry.pmcid ?? 'none'}, fetched ${record.pmcid ?? 'none'}`)
  if (!authorsMatch(entry.authors, record.authorString)) changes.push(`authors: stored “${entry.authors}”, fetched “${record.authorString}”`)
  return changes
}

/** A retraction, erratum, expression of concern or newer version: a curator reads it before anything else. */
export interface Notice {
  type: string
  reference: string
}

const NOTICE_TYPES = /^(?:retraction in|erratum in|expression of concern in|update in|republished in)$/i
const NOTICE_PUB_TYPES = /^(?:retracted publication|retraction of publication)$/i

export function noticesFor(record: FetchedRecord): Notice[] {
  return [
    ...record.pubTypes.filter((t) => NOTICE_PUB_TYPES.test(t)).map((type) => ({ type, reference: `PMID ${record.pmid} itself` })),
    ...record.corrections.filter((c) => NOTICE_TYPES.test(c.type)).map((c) => ({ type: c.type, reference: c.reference })),
  ]
}

/** A notice a curator has read and recorded in the notes file. */
export const CheckedNotice = z.strictObject({
  entryId: z.string().min(1),
  type: z.string().min(1),
  reference: z.string().min(1),
  checkedOn: IsoDate,
  /** What it changed, in our words: "a corrected author list; the takeaway stands". */
  why: z.string().min(1),
})
export type CheckedNotice = z.infer<typeof CheckedNotice>

export function uncheckedNotices(entryId: string, notices: readonly Notice[], checked: readonly CheckedNotice[]): Notice[] {
  return notices.filter((n) => !checked.some((c) => c.entryId === entryId && c.type === n.type && c.reference === n.reference))
}

/**
 * data/evidence.notes.json: the curator's own words that the app never shows (Batch F, critique 13):
 * why each entry is here and its caveats, and the notices already read. Read by the scripts only.
 */
export const Notes = z.strictObject({
  version: z.literal(1),
  relevance: z.record(z.string(), z.string().min(1).refine((t) => wordCount(t) <= 80, 'at most 80 words')),
  noticesChecked: z.array(CheckedNotice),
})
export type Notes = z.infer<typeof Notes>

/** A seen note must name the paper it means: the fetched first author's surname and the year. */
export function seenProblem(seen: Seen, record: Pick<FetchedRecord, 'authorString' | 'year'>): string | null {
  const surname = firstOf(record.authorString).split(' ').slice(0, -1).join(' ') || firstOf(record.authorString)
  if (!seen.why.includes(surname)) return `the note doesn’t name ${surname}, the fetched first author`
  if (record.year === null || !seen.why.includes(String(record.year))) return `the note doesn’t name ${record.year ?? 'the'} year`
  return null
}

/** Candidates not yet curated or seen, newest first, at most `max`, with how many there were. */
export function newCandidates(found: readonly Candidate[], known: ReadonlySet<string>, max = 20): { shown: Candidate[]; total: number } {
  const unique = [...new Map(found.filter((c) => !known.has(c.pmid)).map((c) => [c.pmid, c])).values()]
  unique.sort((a, b) => b.date.replace(/\//g, '-').localeCompare(a.date.replace(/\//g, '-')) || b.pmid.localeCompare(a.pmid))
  return { shown: unique.slice(0, max), total: unique.length }
}

export interface DigestReport {
  mode: 'digest' | 'verify'
  curatedOn: string
  searches: { id: string; source: LiteratureSource; query: string; hitCount: number; hitsOnSave?: number | undefined; total: number; shown: Candidate[] }[]
  verify: { id: string; pmid: string; changes: string[]; notices: Notice[] }[]
  seen: { pmid: string; problem: string | null }[]
  errors: string[]
}

export function formatDigest(r: DigestReport): string {
  const lines: string[] = [`Evidence digest (${r.mode}), against data/evidence.json curated ${r.curatedOn}`]
  if (r.searches.length > 0) {
    lines.push('', 'Saved searches')
    for (const s of r.searches) {
      lines.push(`- ${s.id} (${s.source}): ${s.hitCount} hits, ${s.hitsOnSave ?? 'unknown'} when saved; ${s.total} new`)
      for (const c of s.shown) lines.push(`    PMID ${c.pmid} · ${c.year ?? '----'} · ${c.firstAuthor} · ${c.title} · ${c.journal}${c.pubTypes.length ? ` · ${c.pubTypes.join(', ')}` : ''}`)
      if (s.total > s.shown.length) lines.push(`    … and ${s.total - s.shown.length} more`)
    }
    lines.push(`New candidates in all: ${r.searches.reduce((n, s) => n + s.total, 0)} (a PMID found by two searches counts in each).`)
  }
  if (r.verify.length > 0) {
    lines.push('', 'Entries against their records')
    for (const v of r.verify) {
      for (const c of v.changes) lines.push(`- ${v.id} (PMID ${v.pmid}): CHANGED ${c}`)
      for (const n of v.notices) lines.push(`- ${v.id} (PMID ${v.pmid}): ${n.type} ${n.reference}`)
    }
    const changed = r.verify.filter((v) => v.changes.length > 0).length
    const noticed = r.verify.filter((v) => v.notices.length > 0).length
    lines.push(`Verified ${r.verify.length} entries: ${changed} changed, ${noticed} with a notice to read.`)
  }
  if (r.seen.length > 0) {
    const bad = r.seen.filter((s) => s.problem !== null)
    for (const s of bad) lines.push(`- seen PMID ${s.pmid}: ${s.problem}`)
    lines.push(`Checked ${r.seen.length} seen notes: ${bad.length} naming the wrong paper.`)
  }
  if (r.errors.length > 0) lines.push('', 'Errors', ...r.errors.map((e) => `- ${e}`))
  return lines.join('\n')
}

/** 2 when a curator must act (a change, an unread notice, a seen note naming the wrong paper), else 0. Errors are the caller's 1. */
export function exitCodeFor(r: DigestReport): 0 | 2 {
  const act = r.verify.some((v) => v.changes.length > 0 || v.notices.length > 0) || r.seen.some((s) => s.problem !== null)
  return act ? 2 : 0
}
