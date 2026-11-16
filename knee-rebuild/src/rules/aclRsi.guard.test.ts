import { describe, expect, it } from 'vitest'

/*
 * ACL-RSI is read by the gates rule alone (Batch A): unlike VO2 max and KOOS, the questionnaire
 * IS a gate input — gate 3 requires the latest entry's score to reach 76 (Shawn, Nov 8;
 * PROGRAM-QUESTIONS 156, 159) — so the allow-list is deliberately inverted relative to the vo2
 * guard. gates.ts is pinned below as a deliberate READER (the way trainingLoad.guard pins its
 * stravaImport exemption), backup.ts as a carrier, and every other rule module stays off both
 * the import and the names, so no prescription, reading or cap can come to rest on the score.
 * The entries never ride in History either: they reach the gate through GateContext.aclRsiEntries,
 * fed from the Gates screen, the calfRaiseExerciseIds pattern.
 */

// Every app source, read at test time through Vite (no node APIs needed).
const sources = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const rules = import.meta.glob<string>('./*.ts', { query: '?raw', import: 'default', eager: true })

/** The code allowed to import it: the gates rule (the deliberate reader) and its tests, the ACL-RSI form's helpers, and the module's own tests. */
const IMPORTERS: readonly string[] = [
  '/src/rules/aclRsi.test.ts',
  '/src/rules/gates.ts',
  '/src/rules/gates.test.ts',
  '/src/screens/AclRsi.helpers.ts',
  '/src/screens/AclRsi.helpers.test.ts',
]

/** A static or dynamic import of the module, by any relative path, with or without the extension. */
function importsAclRsi(source: string): boolean {
  return /(?:from|import\()\s*['"`](?:\.{1,2}\/)+(?:[\w.-]+\/)*aclRsi(?:\.ts)?['"`]/.test(source)
}

/** Any mention at all: the word covers the schema, the table, the repo and hook names, the evaluator and every aclRsi* rule export. */
function mentionsAclRsi(source: string): boolean {
  return /acl-?rsi/i.test(source)
}

/** The rule modules that may mention the entries: the module itself, the gates rule (the one reader), and the backup (the carrier). */
const ACL_RSI_EXEMPT: readonly string[] = ['./aclRsi.ts', './gates.ts', './backup.ts']

describe('ACL-RSI is read by the gates rule alone', () => {
  it('catches an import of the module by any path, and a mention by any of its names, and nothing else', () => {
    expect(importsAclRsi("import { aclRsiScore } from '../rules/aclRsi.ts'")).toBe(true)
    expect(importsAclRsi('import { latestAclRsiEntry } from "./aclRsi"')).toBe(true)
    expect(importsAclRsi("const m = await import('../../rules/aclRsi.ts')")).toBe(true)
    expect(importsAclRsi("import { fmt } from './Gates.helpers.ts'")).toBe(false)
    expect(mentionsAclRsi("import { AclRsiEntry } from '../schema/index.ts'")).toBe(true)
    expect(mentionsAclRsi('await db.aclRsiEntries.toArray()')).toBe(true)
    expect(mentionsAclRsi('await getAclRsiEntries()')).toBe(true)
    expect(mentionsAclRsi('const rows = useAclRsiEntries()')).toBe(true)
    expect(mentionsAclRsi("case 'acl-rsi':")).toBe(true)
    expect(mentionsAclRsi('return run.rpe ?? 5')).toBe(false)
  })

  it('finds the sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    expect(Object.keys(sources)).toContain('/src/rules/aclRsi.ts')
    for (const path of IMPORTERS) expect(Object.keys(sources), path).toContain(path)
  })

  it('only the gates rule and the ACL-RSI form helpers import it', () => {
    for (const [path, source] of Object.entries(sources)) {
      if (path === '/src/rules/aclRsi.guard.test.ts' || IMPORTERS.includes(path)) continue
      expect(importsAclRsi(source), `${path} imports aclRsi`).toBe(false)
    }
  })

  it('no rule module but aclRsi.ts, the gates rule and the backup mentions an entry, its table, or its repo and hook names', () => {
    for (const [path, source] of Object.entries(rules)) {
      if (path.endsWith('.test.ts') || ACL_RSI_EXEMPT.includes(path)) continue
      expect(mentionsAclRsi(source), `${path} mentions ACL-RSI`).toBe(false)
    }
  })

  it('the gates rule’s exemption is deliberate and real: it reads the latest entry’s score for the gate item, nothing more', () => {
    const gates = rules['./gates.ts'] ?? ''
    expect(mentionsAclRsi(gates)).toBe(true)
    expect(importsAclRsi(gates)).toBe(true)
    // It reads, never stores or fetches: no repo or hook call, and the entries come in through GateContext.
    expect(/\bgetAclRsiEntries\b|\buseAclRsiEntries\b|\bsaveAclRsiEntry\b|\bdeleteAclRsiEntry\b/.test(gates)).toBe(false)
    expect(/aclRsiEntries: readonly AclRsiEntry\[\]/.test(gates)).toBe(true)
  })

  it('the backup’s exemption is deliberate and real: it carries the table in the file, nothing more', () => {
    expect(mentionsAclRsi(rules['./backup.ts'] ?? '')).toBe(true)
    // A carrier, not a reader: it imports nothing from ./aclRsi.ts, and parses rows without scoring one.
    expect(importsAclRsi(rules['./backup.ts'] ?? '')).toBe(false)
    expect(/\bgetAclRsiEntries\b|\buseAclRsiEntries\b|\baclRsiScore\b|\blatestAclRsiEntry\b/.test(rules['./backup.ts'] ?? '')).toBe(false)
  })
})
