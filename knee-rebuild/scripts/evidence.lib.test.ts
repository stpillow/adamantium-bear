import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import evidenceRaw from '../data/evidence.json'
import notesRaw from '../data/evidence.notes.json'
import { Evidence } from '../src/schema/evidence.ts'
import epmcCorePiussi from './fixtures/evidence/epmc-core-piussi.json'
import epmcCoreRetracted from './fixtures/evidence/epmc-core-retracted.json'
import epmcCoreSilbernagel from './fixtures/evidence/epmc-core-silbernagel.json'
import epmcCoreSmith from './fixtures/evidence/epmc-core-smith.json'
import epmcSearch from './fixtures/evidence/epmc-search.json'
import esearch from './fixtures/evidence/esearch.json'
import esummary from './fixtures/evidence/esummary.json'
import {
  Notes,
  authorsMatch,
  diffEntry,
  epmcRecordUrl,
  epmcSearchUrl,
  esearchUrl,
  esummaryUrl,
  exitCodeFor,
  formatDigest,
  newCandidates,
  normalizeTitle,
  noticesFor,
  parseEpmcCore,
  parseEpmcSearch,
  parseEsearch,
  parseEsummary,
  seenProblem,
  sourceOf,
  uncheckedNotices,
  type DigestReport,
  type FetchedRecord,
} from './evidence.lib.ts'
import * as lib from './evidence.lib.ts'

/*
 * The monthly digest's pure half (scripts/evidence.lib.ts) against responses recorded once from
 * Europe PMC and PubMed and trimmed to the fields it reads. Nothing here touches the network.
 */

const FIXTURES = new URL('./fixtures/evidence/', import.meta.url)
const fixtures = Object.fromEntries(readdirSync(FIXTURES).map((name) => [name, readFileSync(new URL(name, FIXTURES), 'utf8')]))
const evidence = Evidence.parse(evidenceRaw)
const silbernagel = evidence.entries.find((e) => e.id === 'silbernagel-2007-pain-monitoring')
const smith = evidence.entries.find((e) => e.id === 'smith-2017-painful-exercise')

const record = (json: unknown): FetchedRecord => {
  const r = parseEpmcCore(json)
  if (r === null) throw new Error('no record')
  return r
}

describe('the fixtures', () => {
  it('are recorded real responses trimmed to what the digest reads: no abstract or full text', () => {
    expect(Object.keys(fixtures).length).toBe(7)
    for (const [path, text] of Object.entries(fixtures)) {
      expect(text, path).not.toMatch(/abstractText|fullText|"abstract"/i)
    }
  })
})

describe('urls: only the two literature hosts, the query encoded, newest first', () => {
  it('Europe PMC search and record', () => {
    const u = new URL(epmcSearchUrl('TITLE:"pain-monitoring model"'))
    expect(u.origin).toBe('https://www.ebi.ac.uk')
    expect(u.pathname).toBe('/europepmc/webservices/rest/search')
    expect(u.searchParams.get('query')).toBe('TITLE:"pain-monitoring model"')
    expect(u.searchParams.get('resultType')).toBe('lite')
    expect(u.searchParams.get('pageSize')).toBe('100')
    expect(u.searchParams.get('cursorMark')).toBe('*')
    expect(u.searchParams.get('sort')).toBe('P_PDATE_D desc')
    expect(new URL(epmcSearchUrl('x', 'AoJ+next')).searchParams.get('cursorMark')).toBe('AoJ+next')
    const r = new URL(epmcRecordUrl('17307888'))
    expect(r.searchParams.get('query')).toBe('EXT_ID:17307888 AND SRC:MED')
    expect(r.searchParams.get('resultType')).toBe('core')
  })
  it('PubMed esearch and esummary carry the tool name, no key', () => {
    const s = new URL(esearchUrl('deload*[ti]'))
    expect(s.origin).toBe('https://eutils.ncbi.nlm.nih.gov')
    expect(s.pathname).toBe('/entrez/eutils/esearch.fcgi')
    expect(s.searchParams.get('term')).toBe('deload*[ti]')
    expect(s.searchParams.get('sort')).toBe('pub_date')
    expect(s.searchParams.get('retmax')).toBe('200')
    expect(s.searchParams.get('tool')).toBe('knee-rebuild-evidence')
    expect(s.searchParams.has('api_key')).toBe(false)
    const m = new URL(esummaryUrl(['1', '2']))
    expect(m.pathname).toBe('/entrez/eutils/esummary.fcgi')
    expect(m.searchParams.get('id')).toBe('1,2')
  })
  it('a saved query’s source: PubMed field tags mean PubMed', () => {
    expect(sourceOf('deload*[ti] AND (resistance training OR strength)')).toBe('pubmed')
    expect(sourceOf('"return to sport"[tiab] AND (meta-analysis[pt] OR systematic[sb])')).toBe('pubmed')
    expect(sourceOf('TITLE:"pain-monitoring model"')).toBe('europepmc')
  })
})

describe('parsing the responses', () => {
  it('a Europe PMC search: the hit count, the next page and candidates with a PMID', () => {
    const page = parseEpmcSearch(epmcSearch)
    expect(page.hitCount).toBe(16)
    expect(page.nextCursorMark).toBe('AoJwwL6U4YwDKDQ5OTkyOTc5')
    expect(page.candidates[0]).toEqual({
      pmid: '41730991',
      year: 2026,
      date: '2026-02-24',
      firstAuthor: 'Pancar Z',
      title: 'Effects of deload periods in resistance training on muscle hypertrophy and strength endurance in untrained young men using a randomized within subject design.',
      journal: 'Sci Rep',
      pubTypes: ['research-article', 'randomized controlled trial', 'journal article'],
    })
    expect(page.withoutPmid).toBe(1)
    expect(page.candidates.map((c) => c.pmid)).toEqual(['41730991', '39446750', '38499934', '38274324'])
  })
  it('a PubMed esearch and esummary', () => {
    const s = parseEsearch(esearch)
    expect(s.count).toBeGreaterThan(0)
    expect(s.pmids[0]).toBe('41730991')
    const summaries = parseEsummary(esummary)
    expect(summaries.map((c) => c.pmid).sort()).toEqual(['39446750', '41730991'])
    const pancar = summaries.find((c) => c.pmid === '41730991')
    expect(pancar?.year).toBe(2026)
    expect(pancar?.firstAuthor).toBe('Pancar Z')
    expect(pancar?.journal).toBe('Scientific reports')
  })
  it('a Europe PMC core record', () => {
    const r = record(epmcCoreSilbernagel)
    expect(r.pmid).toBe('17307888')
    expect(r.year).toBe(2007)
    expect(r.journal).toBe('The American journal of sports medicine')
    expect(r.doi).toBe('10.1177/0363546506298279')
    expect(r.pmcid).toBeUndefined()
    expect(r.corrections.map((c) => c.type)).toEqual(['Comment in', 'Comment in'])
    expect(parseEpmcCore({ hitCount: 0, resultList: { result: [] } })).toBeNull()
  })
})

describe('comparing a stored entry with its fetched record', () => {
  it('titles compare without case, spacing, tags, entities or the final period', () => {
    expect(normalizeTitle('<i>JOSPT</i>  October &amp; 2024 Corrigendum.')).toBe('jospt october & 2024 corrigendum')
    expect(normalizeTitle('Knee biomechanics.')).toBe(normalizeTitle('knee  biomechanics'))
  })
  it('authors: the full list matches exactly; "et al." matches a longer list that starts the same', () => {
    expect(authorsMatch('Silbernagel KG, Thomeé R, Eriksson BI, Karlsson J.', 'Silbernagel KG, Thomeé R, Eriksson BI, Karlsson J.')).toBe(true)
    expect(authorsMatch('Smith BE, Hendrick P, Smith TO, et al.', 'Smith BE, Hendrick P, Smith TO, Bateman M, Moffatt F, Rathleff MS.')).toBe(true)
    expect(authorsMatch('Smith BE, Hendrick P, Smith TO, et al.', 'Smith BE, Hendrick P, Smith TO.')).toBe(false)
    expect(authorsMatch('Smith BE, Hendrick P', 'Smith BE, Hendrick P, Smith TO.')).toBe(false)
    expect(authorsMatch('Pamboris GM, Pavlou K', 'Pamboris GM, Pavlou K.')).toBe(true)
    expect(authorsMatch('Smith B, et al.', 'Smithson B, Other C.')).toBe(false)
  })
  it('a matching entry has no changes, and an et al. entry matches', () => {
    expect(silbernagel && diffEntry(silbernagel, record(epmcCoreSilbernagel))).toEqual([])
    expect(smith?.authors).toMatch(/et al\.$/)
    expect(smith && diffEntry(smith, record(epmcCoreSmith))).toEqual([])
  })
  it('a drifted title, year, journal, DOI, PMC id or author list is a change', () => {
    const r = record(epmcCoreSilbernagel)
    if (!silbernagel) throw new Error('no entry')
    expect(diffEntry(silbernagel, { ...r, title: 'Continued sports activity during rehabilitation: a revised title.' })).toEqual([
      'title: stored “Continued sports activity, using a pain-monitoring model, during rehabilitation in patients with Achilles tendinopathy: a randomized controlled study.”, fetched “Continued sports activity during rehabilitation: a revised title.”',
    ])
    expect(diffEntry(silbernagel, { ...r, year: 2008 })).toEqual(['year: stored 2007, fetched 2008'])
    expect(diffEntry(silbernagel, { ...r, doi: undefined })).toEqual(['doi: stored 10.1177/0363546506298279, fetched none'])
    expect(diffEntry(silbernagel, { ...r, pmcid: 'PMC1' })).toEqual(['pmcid: stored none, fetched PMC1'])
    expect(diffEntry(silbernagel, { ...r, journal: 'Another journal' })).toHaveLength(1)
    expect(diffEntry(silbernagel, { ...r, authorString: 'Someone A.' })).toHaveLength(1)
  })
  it('a retraction, an erratum and comments: only the first two are notices', () => {
    expect(noticesFor(record(epmcCoreSilbernagel))).toEqual([])
    expect(noticesFor(record(epmcCorePiussi))).toEqual([{ type: 'Erratum in', reference: 'J Orthop Sports Phys Ther. 2024 Oct;54(10):679. doi: 10.2519/jospt.2024.54.10.679.' }])
    const retracted = noticesFor(record(epmcCoreRetracted)).map((n) => n.type)
    expect(retracted).toEqual(['Retracted Publication', 'Retraction in'])
    expect(noticesFor({ ...record(epmcCoreSilbernagel), corrections: [{ type: 'Expression of concern in', reference: 'x' }, { type: 'Update in', reference: 'y' }, { type: 'Erratum for', reference: 'z' }] }).map((n) => n.type)).toEqual([
      'Expression of concern in',
      'Update in',
    ])
  })
  it('a notice already checked by a curator no longer counts', () => {
    const notices = [{ type: 'Erratum in', reference: 'J Orthop Sports Phys Ther. 2024 Oct;54(10):679.' }]
    expect(uncheckedNotices('piussi-2024-time-to-rts', notices, [])).toHaveLength(1)
    expect(uncheckedNotices('piussi-2024-time-to-rts', notices, [{ entryId: 'piussi-2024-time-to-rts', type: 'Erratum in', reference: 'J Orthop Sports Phys Ther. 2024 Oct;54(10):679.', checkedOn: '2026-12-01', why: 'A corrected author list; the takeaway stands.' }])).toEqual([])
  })
  it('a seen note must name the fetched first author and year', () => {
    expect(seenProblem({ pmid: '1', why: 'Logerstedt 2017 guideline; no takeaway yet.' }, { authorString: 'Logerstedt DS, Scalzitti D.', year: 2017 })).toBeNull()
    expect(seenProblem({ pmid: '1', why: 'Logerstedt 2017 guideline; no takeaway yet.' }, { authorString: 'Someone A.', year: 2017 })).toMatch(/Someone/)
    expect(seenProblem({ pmid: '1', why: 'Logerstedt 2017 guideline; no takeaway yet.' }, { authorString: 'Logerstedt DS.', year: 2010 })).toMatch(/2010/)
  })
})

describe('new candidates', () => {
  it('leaves out curated and seen PMIDs, newest first, at most the cap, with the total', () => {
    const page = parseEpmcSearch(epmcSearch)
    const out = newCandidates(page.candidates, new Set(['38274324']), 2)
    expect(out.total).toBe(3)
    expect(out.shown.map((c) => c.pmid)).toEqual(['41730991', '39446750'])
  })
})

describe('no helper splices sentences with a semicolon (PROGRAM-QUESTIONS 193)', () => {
  it('the digest library has no sentence-joining helper: a capital after "; " is a second sentence the schema refuses, so takeaways are rewritten by hand', () => {
    expect(Object.keys(lib)).not.toContain('joinSentences')
  })
})

describe('the curator’s notes (data/evidence.notes.json, read by the scripts only)', () => {
  const notes = Notes.parse(notesRaw)
  it('carry a relevance note, in our words, for every entry and for nothing else', () => {
    expect(Object.keys(notes.relevance).sort()).toEqual(evidence.entries.map((e) => e.id).sort())
  })
})

describe('the report', () => {
  const report: DigestReport = {
    mode: 'digest',
    curatedOn: '2026-11-09',
    searches: [{ id: 'epmc-deload', source: 'europepmc', query: '(TITLE:deload OR TITLE:deloading)', hitCount: 17, hitsOnSave: 16, total: 1, shown: parseEpmcSearch(epmcSearch).candidates.slice(1, 2) }],
    verify: [
      { id: 'piussi-2024-time-to-rts', pmid: '38032099', changes: [], notices: noticesFor(record(epmcCorePiussi)) },
      { id: 'silbernagel-2007-pain-monitoring', pmid: '17307888', changes: [], notices: [] },
    ],
    seen: [{ pmid: '29089004', problem: null }],
    errors: [],
  }
  it('prints the counts, the new candidates and the notices in words', () => {
    const text = formatDigest(report)
    expect(text).toContain('epmc-deload (europepmc): 17 hits, 16 when saved; 1 new')
    expect(text).toContain('PMID 39446750 · 2024 · De Marco K · Resistance Training Prescription During Planned Deloading Periods')
    expect(text).toContain('piussi-2024-time-to-rts (PMID 38032099): Erratum in J Orthop Sports Phys Ther. 2024 Oct;54(10):679.')
    expect(text).toContain('Verified 2 entries: 0 changed, 1 with a notice to read.')
  })
  it('exits 2 when there is a change or a notice to read, 0 when clean', () => {
    expect(exitCodeFor(report)).toBe(2)
    expect(exitCodeFor({ ...report, verify: [report.verify[1] ?? report.verify[0]!] })).toBe(0)
    expect(exitCodeFor({ ...report, verify: [], seen: [{ pmid: '1', problem: 'names Smith' }] })).toBe(2)
  })
})
