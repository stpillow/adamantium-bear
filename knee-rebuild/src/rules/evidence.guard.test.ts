import { describe, expect, it } from 'vitest'
import programRaw from '../../data/program.json'
import { Program } from '../schema/program.ts'

/*
 * The evidence layer informs and changes nothing (Batch F, Shawn's Nov 8 decision 9;
 * PROGRAM-QUESTIONS 194, 195). It is read for display only: no prescription, reading, gate verdict,
 * load or warning reads it, and the phone makes no literature call, ever. This holds both halves.
 *
 * The gap it closes: guard.test.ts lets a rule module import anything under '../schema/', which
 * would include src/schema/evidence.ts. Here no rule module may import or even mention it, no
 * engine input (src/app, src/db, src/program, the domain schemas, gatesView) may either, and the
 * schema barrel doesn't export it. On the network side: CSP connect-src stays 'self', no source
 * names a literature API host, the evidence modules don't fetch, their links go only to doi.org,
 * PubMed and Europe PMC article pages (navigations Shawn taps), there is no api/evidence function,
 * and the dev-only digest (scripts/evidence*.ts) is never imported by the app, writes no file and
 * reads no environment.
 */

const sources = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const rules = import.meta.glob<string>('./*.ts', { query: '?raw', import: 'default', eager: true })
const scripts = import.meta.glob<string>('/scripts/**/*.ts', { query: '?raw', import: 'default', eager: true })
const api = import.meta.glob<string>('/api/**/*', { query: '?raw', import: 'default', eager: true })
const vercel = import.meta.glob<string>('/vercel.json', { query: '?raw', import: 'default', eager: true })['/vercel.json'] ?? ''
const indexHtml = import.meta.glob<string>('/index.html', { query: '?raw', import: 'default', eager: true })['/index.html'] ?? ''
const viteConfig = import.meta.glob<string>('/vite.config.ts', { query: '?raw', import: 'default', eager: true })['/vite.config.ts'] ?? ''

const SELF = '/src/rules/evidence.guard.test.ts'

/** An import of the evidence schema, the data or the loader, by any relative path. */
function importsEvidenceCore(source: string): boolean {
  return /(?:from|import\()\s*['"`](?:\.{1,2}\/)+(?:[\w.-]+\/)*(?:evidence(?:\.ts)?|evidence(?:\.notes)?\.json)['"`]/.test(source)
}

/** An import of the evidence screen code: the helpers or the Program view. */
function importsEvidenceUi(source: string): boolean {
  return /(?:from|import\()\s*['"`](?:\.{1,2}\/)+(?:[\w.-]+\/)*Evidence(?:\.helpers)?(?:\.tsx?)?['"`]/.test(source)
}

/** A mention of the layer by any of its words. */
function mentionsEvidence(source: string): boolean {
  return /evidence|citation|pubmed|europe ?pmc|\bdoi\b|rationale/i.test(source)
}

/** The literature APIs' hosts: none may appear in the app or its server function. */
const LITERATURE_HOSTS = /ebi\.ac\.uk|eutils\.ncbi|api\.crossref|api\.openalex|semanticscholar|entrez/i

const CORE_IMPORTERS: readonly string[] = [
  '/src/schema/evidence.test.ts',
  '/src/evidence/evidence.ts',
  '/src/evidence/evidence.test.ts',
  '/src/screens/Evidence.helpers.ts',
  '/src/screens/Evidence.helpers.test.ts',
]
const UI_IMPORTERS: readonly string[] = ['/src/screens/Program.tsx', '/src/screens/Gates.tsx', '/src/screens/program/Evidence.tsx', '/src/screens/Evidence.helpers.test.ts']
const EVIDENCE_MODULES: readonly string[] = ['/src/schema/evidence.ts', '/src/evidence/evidence.ts', '/src/screens/Evidence.helpers.ts', '/src/screens/program/Evidence.tsx']

/** The engine's inputs: none may import or mention the layer. */
const ENGINE_INPUT = (path: string) =>
  path.startsWith('/src/app/') ||
  path.startsWith('/src/db/') ||
  path.startsWith('/src/program/') ||
  ['/src/main.tsx', '/src/schema/log.ts', '/src/schema/program.ts', '/src/schema/enums.ts', '/src/schema/index.ts', '/src/screens/Gates.helpers.ts'].includes(path)

const isTest = (path: string) => /\.test\.tsx?$/.test(path)

describe('the evidence layer changes nothing', () => {
  it('the checks catch an import by any path and a mention by any word, and leave the rest alone', () => {
    expect(importsEvidenceCore("import { Evidence } from '../schema/evidence.ts'")).toBe(true)
    expect(importsEvidenceCore('import raw from "../../data/evidence.json"')).toBe(true)
    expect(importsEvidenceCore('import notes from "../data/evidence.notes.json"')).toBe(true)
    expect(importsEvidenceCore("import { getEvidence } from '../evidence/evidence'")).toBe(true)
    expect(importsEvidenceCore("const m = await import('../../evidence/evidence.ts')")).toBe(true)
    expect(importsEvidenceCore("import { x } from './Progress.helpers.ts'")).toBe(false)
    expect(importsEvidenceUi("const m = await import('./Evidence.helpers.ts')")).toBe(true)
    expect(importsEvidenceUi("import { Evidence } from './program/Evidence.tsx'")).toBe(true)
    expect(importsEvidenceUi("import { x } from './Progress.helpers.ts'")).toBe(false)
    for (const text of ['const e = getEvidence()', 'a citation', 'PubMed', 'Europe PMC', 'europepmc', 'the doi field', 'gate rationale']) expect(mentionsEvidence(text), text).toBe(true)
    expect(mentionsEvidence('const doing = 1; return reading')).toBe(false)
  })

  it('finds the sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    for (const path of [...CORE_IMPORTERS, ...UI_IMPORTERS, ...EVIDENCE_MODULES]) expect(Object.keys(sources), path).toContain(path)
    expect(Object.keys(scripts)).toContain('/scripts/evidence.ts')
    expect(Object.keys(scripts)).toContain('/scripts/evidence.lib.ts')
    expect(Object.keys(api)).toContain('/api/strava.ts')
    expect(vercel).toContain('Content-Security-Policy')
    expect(indexHtml).toContain('<html')
  })

  it('only the loader, the helpers and their tests read the data, the schema or the loader', () => {
    for (const [path, source] of Object.entries(sources)) {
      if (path === SELF || CORE_IMPORTERS.includes(path)) continue
      expect(importsEvidenceCore(source), `${path} imports the evidence core`).toBe(false)
    }
  })

  it('only the Program and Gates screens (and the helpers’ test) import the evidence screen code', () => {
    for (const [path, source] of Object.entries(sources)) {
      if (path === SELF || UI_IMPORTERS.includes(path) || path === '/src/screens/Evidence.helpers.ts') continue
      expect(importsEvidenceUi(source), `${path} imports the evidence screens`).toBe(false)
    }
  })

  it('no rule module imports or mentions it', () => {
    for (const [path, source] of Object.entries(rules)) {
      if (path.endsWith('.test.ts')) continue
      expect(importsEvidenceCore(source) || importsEvidenceUi(source), `${path} imports it`).toBe(false)
      expect(mentionsEvidence(source), `${path} mentions it`).toBe(false)
    }
  })

  it('no engine input imports or mentions it: app, db, program, the domain schemas, the barrel, gatesView', () => {
    const inputs = Object.keys(sources).filter(ENGINE_INPUT)
    expect(inputs.length).toBeGreaterThan(20)
    for (const path of inputs) {
      const source = sources[path] ?? ''
      expect(importsEvidenceCore(source) || importsEvidenceUi(source), `${path} imports it`).toBe(false)
      expect(mentionsEvidence(source), `${path} mentions it`).toBe(false)
    }
    expect(importsEvidenceCore(sources['/src/screens/Program.helpers.ts'] ?? '')).toBe(false)
    expect(importsEvidenceUi(sources['/src/screens/Program.helpers.ts'] ?? '')).toBe(false)
  })

  it('the seed and its schema carry no evidence key', () => {
    expect(Object.keys(Program.shape).filter((k) => /evidence|citation|rationale/i.test(k))).toEqual([])
    expect(Object.keys(programRaw).filter((k) => /evidence|citation|rationale/i.test(k))).toEqual([])
  })
})

describe('the phone makes no literature call', () => {
  it('CSP connect-src stays the page’s own origin', () => {
    expect(vercel).toContain("connect-src 'self';")
    for (const m of vercel.matchAll(/connect-src([^;"]*)/g)) expect((m[1] ?? '').trim()).toBe("'self'")
  })

  it('index.html sets no CSP of its own and warms no connection to another host', () => {
    expect(indexHtml).not.toMatch(/http-equiv=["']?Content-Security-Policy/i)
    expect(indexHtml).not.toMatch(/rel=["']?(?:preconnect|dns-prefetch)/i)
    expect(indexHtml).not.toMatch(LITERATURE_HOSTS)
  })

  it('no app source or server function names a literature API host', () => {
    for (const [path, source] of Object.entries(sources)) {
      if (path === SELF) continue
      expect(source, path).not.toMatch(LITERATURE_HOSTS)
    }
    for (const [path, source] of Object.entries(api)) expect(source, path).not.toMatch(LITERATURE_HOSTS)
    expect(viteConfig).not.toMatch(LITERATURE_HOSTS)
    expect(viteConfig).not.toMatch(/doi\.org|pubmed|europepmc/i)
  })

  it('there is no on-tap search function: decision 9 left it unbuilt', () => {
    expect(Object.keys(api).filter((p) => /evidence|citation|literature/i.test(p))).toEqual([])
  })

  it('the evidence modules never fetch, and link only to doi.org, PubMed and Europe PMC article pages', () => {
    for (const path of EVIDENCE_MODULES) {
      const source = sources[path] ?? ''
      expect(source, path).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|EventSource|WebSocket/)
      for (const m of source.matchAll(/https?:\/\/[^\s'"`)]*/g)) {
        expect(m[0], path).toMatch(/^https:\/\/(?:doi\.org\/|pubmed\.ncbi\.nlm\.nih\.gov\/|europepmc\.org\/article\/)/)
      }
    }
  })
})

describe('the digest stays on the developer’s machine', () => {
  it('no app source imports from scripts/', () => {
    for (const [path, source] of Object.entries(sources)) {
      expect(/(?:from|import\()\s*['"`](?:\.{1,2}\/)+(?:[\w.-]+\/)*scripts\//.test(source), path).toBe(false)
    }
  })

  it('the digest writes no file and reads no environment: no secrets, no writes', () => {
    const digest = Object.entries(scripts).filter(([path]) => /^\/scripts\/evidence[^/]*\.ts$/.test(path) && !isTest(path))
    expect(digest.length).toBeGreaterThanOrEqual(2)
    for (const [path, source] of digest) expect(source, path).not.toMatch(/writeFile|appendFile|createWriteStream|process\.env|api_key/)
  })
})
