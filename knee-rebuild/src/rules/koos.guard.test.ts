import { describe, expect, it } from 'vitest'

/*
 * KOOS informs, changes nothing (Batch A): no prescription, reading, cap or gate may rest on a
 * KOOS number, and scores show on Progress only, never on the Gates screen, so a dipping
 * subscale can never read as an extra gate requirement (Shawn, Nov 8; PROGRAM-QUESTIONS 158).
 * This holds it there the way vo2.guard.test.ts holds VO2 max. Only the KOOS form's helpers,
 * the Progress helpers and the Today helpers (the due line) may import src/rules/koos.ts, and
 * no rule module may mention the entries, their table, or their repo and hook names — except
 * backup.ts, which carries the koosEntries table in the file like any other and is a carrier,
 * not a reader: it imports nothing from ./koos.ts and parses rows without scoring one, the
 * pinned exemption below. gates.ts gets its own named assertion: the gates rule may neither
 * import nor mention KOOS, which makes "never a gate requirement" structural. The storage half
 * is that loadHistory never carries the entries, so no rule can reach them through History.
 */

// Every app source, read at test time through Vite (no node APIs needed).
const sources = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const rules = import.meta.glob<string>('./*.ts', { query: '?raw', import: 'default', eager: true })

/** The code allowed to import it: the form's helpers, the Progress helpers, the Today helpers (the due line), and the module's own tests. */
const IMPORTERS: readonly string[] = [
  '/src/rules/koos.test.ts',
  '/src/screens/Progress.helpers.ts',
  '/src/screens/Progress.helpers.test.ts',
  '/src/screens/Today.helpers.ts',
  '/src/screens/Today.helpers.test.ts',
  '/src/screens/Koos.helpers.ts',
  '/src/screens/Koos.helpers.test.ts',
]

/** A static or dynamic import of the module, by any relative path, with or without the extension. */
function importsKoos(source: string): boolean {
  return /(?:from|import\()\s*['"`](?:\.{1,2}\/)+(?:[\w.-]+\/)*koos(?:\.ts)?['"`]/.test(source)
}

/** Any mention at all: the word covers the schema, the table, the repo and hook names, and every koos* rule export. */
function mentionsKoos(source: string): boolean {
  return /koos/i.test(source)
}

/** The rule modules that may mention the entries: the module itself, and the backup, which carries the table. */
const KOOS_EXEMPT: readonly string[] = ['./koos.ts', './backup.ts']

describe('KOOS informs, changes nothing', () => {
  it('catches an import of the module by any path, and a mention by any of its names, and nothing else', () => {
    expect(importsKoos("import { koosDue } from '../rules/koos.ts'")).toBe(true)
    expect(importsKoos('import { koosSeries } from "./koos"')).toBe(true)
    expect(importsKoos("const m = await import('../../rules/koos.ts')")).toBe(true)
    expect(importsKoos("import { fmt } from './Progress.helpers.ts'")).toBe(false)
    expect(importsKoos("import { loadSeries } from '../rules/progress.ts'")).toBe(false)
    expect(mentionsKoos("import { KoosEntry } from '../schema/index.ts'")).toBe(true)
    expect(mentionsKoos('await db.koosEntries.toArray()')).toBe(true)
    expect(mentionsKoos('await getKoosEntries()')).toBe(true)
    expect(mentionsKoos('const rows = useKoosEntries()')).toBe(true)
    expect(mentionsKoos("await saveKoosEntry({ date })")).toBe(true)
    expect(mentionsKoos("await deleteKoosEntry('2026-11-08')")).toBe(true)
    expect(mentionsKoos('// a KOOS check is due')).toBe(true)
    expect(mentionsKoos('return run.rpe ?? 5')).toBe(false)
  })

  it('finds the sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    expect(Object.keys(sources)).toContain('/src/rules/koos.ts')
    for (const path of IMPORTERS) expect(Object.keys(sources), path).toContain(path)
  })

  it('only the KOOS form, Progress and Today helpers import it', () => {
    for (const [path, source] of Object.entries(sources)) {
      if (path === '/src/rules/koos.guard.test.ts' || IMPORTERS.includes(path)) continue
      expect(importsKoos(source), `${path} imports koos`).toBe(false)
    }
  })

  it('no rule module but koos.ts and the backup mentions an entry, its table, or its repo and hook names', () => {
    for (const [path, source] of Object.entries(rules)) {
      if (path.endsWith('.test.ts') || KOOS_EXEMPT.includes(path)) continue
      expect(mentionsKoos(source), `${path} mentions KOOS`).toBe(false)
    }
  })

  it('the gates rule neither imports nor mentions KOOS: a dipping subscale is never a gate requirement, as code', () => {
    const gates = rules['./gates.ts'] ?? ''
    expect(gates.length).toBeGreaterThan(0)
    expect(importsKoos(gates)).toBe(false)
    expect(mentionsKoos(gates)).toBe(false)
  })

  it('the backup’s exemption is deliberate and real: it carries the table in the file, nothing more', () => {
    expect(mentionsKoos(rules['./backup.ts'] ?? '')).toBe(true)
    // A carrier, not a reader: it imports nothing from ./koos.ts, and parses rows without scoring one.
    expect(importsKoos(rules['./backup.ts'] ?? '')).toBe(false)
    expect(/\bgetKoosEntries\b|\buseKoosEntries\b|\bkoosSubscaleScore\b|\bkoosDue\b/.test(rules['./backup.ts'] ?? '')).toBe(false)
  })
})
