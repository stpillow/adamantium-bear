/**
 * The monthly evidence digest (Batch F; docs/evidence-digest.md). Dev-only: never bundled, never
 * run by the app. It re-runs the saved searches in data/evidence.json against Europe PMC and
 * PubMed and prints new candidates, then checks every entry against its fetched record and prints
 * changes, retractions, errata and newer versions. It writes nothing: a Claude Code session reads
 * the report, edits data/evidence.json by hand from fetched records, and opens a PR for Shawn.
 *
 *   npm run evidence                     the searches, then verification
 *   npm run evidence -- --verify         verification only
 *   npm run evidence -- --search <id>    one saved search
 *   npm run evidence -- --json           the report as JSON, for a session to read
 *
 * Exit codes: 0 clean; 2 something for the curator to act on (a changed record, a notice not yet
 * read, a seen note naming the wrong paper); 1 the data didn't parse or the network failed.
 * The npm script sets NODE_USE_ENV_PROXY=1 so Node's fetch uses a configured HTTPS proxy.
 */
import { parseArgs } from 'node:util'
import evidenceRaw from '../data/evidence.json'
import notesRaw from '../data/evidence.notes.json'
import { Evidence, type Search } from '../src/schema/evidence.ts'
import {
  Notes,
  diffEntry,
  epmcRecordUrl,
  epmcSearchUrl,
  esearchUrl,
  esummaryUrl,
  exitCodeFor,
  formatDigest,
  newCandidates,
  noticesFor,
  parseEpmcCore,
  parseEpmcSearch,
  parseEsearch,
  parseEsummary,
  seenProblem,
  uncheckedNotices,
  type Candidate,
  type DigestReport,
} from './evidence.lib.ts'

const { values } = parseArgs({
  options: {
    verify: { type: 'boolean', short: 'v' },
    search: { type: 'string', short: 's' },
    json: { type: 'boolean', short: 'j' },
    max: { type: 'string' },
  },
})

/** NCBI allows 3 requests a second without a key; Europe PMC is gentler, but the same pause costs little. */
const PAUSE_MS = 350
/** At most two pages of 100 per Europe PMC search: newest first, so new papers are on them. */
const EPMC_PAGES = 2

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function getJson(url: string): Promise<unknown> {
  await sleep(PAUSE_MS)
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${response.status} from ${new URL(url).host}`)
  return response.json()
}

async function runSearch(search: Search): Promise<{ hitCount: number; found: Candidate[] }> {
  if (search.source === 'europepmc') {
    const found: Candidate[] = []
    let cursor = '*'
    let hitCount = 0
    for (let page = 0; page < EPMC_PAGES; page++) {
      const result = parseEpmcSearch(await getJson(epmcSearchUrl(search.query, cursor)))
      hitCount = result.hitCount
      found.push(...result.candidates)
      if (result.nextCursorMark === null || result.nextCursorMark === cursor || found.length >= hitCount) break
      cursor = result.nextCursorMark
    }
    return { hitCount, found }
  }
  const { count, pmids } = parseEsearch(await getJson(esearchUrl(search.query)))
  return { hitCount: count, found: pmids.map((pmid) => ({ pmid, year: null, date: '', firstAuthor: '', title: '', journal: '', pubTypes: [] })) }
}

async function main(): Promise<number> {
  const parsedEvidence = Evidence.safeParse(evidenceRaw)
  const parsedNotes = Notes.safeParse(notesRaw)
  if (!parsedEvidence.success || !parsedNotes.success) {
    const issues = [...(parsedEvidence.error?.issues ?? []), ...(parsedNotes.error?.issues ?? [])]
    console.error(`data/evidence.json or its notes didn’t parse:\n${issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')}`)
    return 1
  }
  const evidence = parsedEvidence.data
  const notes = parsedNotes.data
  const max = values.max === undefined ? 20 : Number(values.max)
  const report: DigestReport = { mode: values.verify ? 'verify' : 'digest', curatedOn: evidence.curatedOn, searches: [], verify: [], seen: [], errors: [] }
  const known = new Set([...evidence.entries.map((e) => e.pmid), ...evidence.seen.map((s) => s.pmid)])

  try {
    if (!values.verify) {
      const searches = values.search === undefined ? evidence.searches : evidence.searches.filter((s) => s.id === values.search)
      if (searches.length === 0) {
        console.error(`No saved search is called ${values.search}.`)
        return 1
      }
      for (const search of searches) {
        const { hitCount, found } = await runSearch(search)
        const { shown, total } = newCandidates(found, known, max)
        // PubMed's esearch gives ids only; fetch the summaries of the new ones it will show.
        const filled = search.source === 'pubmed' && shown.length > 0 ? parseEsummary(await getJson(esummaryUrl(shown.map((c) => c.pmid)))) : shown
        const ordered = newCandidates(filled, known, max).shown
        report.searches.push({ id: search.id, source: search.source, query: search.query, hitCount, hitsOnSave: search.hitsOnSave, total, shown: ordered })
        if (!values.json) process.stderr.write('.')
      }
      if (!values.json) process.stderr.write('\n')
    }
    if (values.verify || values.search === undefined) {
      for (const entry of evidence.entries) {
        const record = parseEpmcCore(await getJson(epmcRecordUrl(entry.pmid)))
        if (record === null) {
          report.verify.push({ id: entry.id, pmid: entry.pmid, changes: ['no MEDLINE record found for this PMID'], notices: [] })
          continue
        }
        const notices = uncheckedNotices(entry.id, noticesFor(record), notes.noticesChecked)
        report.verify.push({ id: entry.id, pmid: entry.pmid, changes: diffEntry(entry, record), notices })
      }
      for (const seen of evidence.seen) {
        const record = parseEpmcCore(await getJson(epmcRecordUrl(seen.pmid)))
        report.seen.push({ pmid: seen.pmid, problem: record === null ? 'no MEDLINE record found' : seenProblem(seen, record) })
      }
    }
  } catch (e: unknown) {
    report.errors.push(e instanceof Error ? e.message : String(e))
    console.log(values.json ? JSON.stringify(report, null, 2) : formatDigest(report))
    return 1
  }

  console.log(values.json ? JSON.stringify(report, null, 2) : formatDigest(report))
  return exitCodeFor(report)
}

process.exitCode = await main()
