import { describe, expect, it } from 'vitest'

/*
 * VO2 max informs, changes nothing (metrics phase 3): it changes no prescription, reading, cap or
 * gate. This holds it there, the way trainingLoad.guard.test.ts holds the training load. Only the
 * Progress screen's helpers (and the module's own tests) may import src/rules/vo2.ts, and no rule
 * module may mention the readings, their table or their repo and hook names — except backup.ts,
 * which carries the vo2Readings table in the file like any other and is a carrier, not a reader:
 * it imports nothing from ./vo2.ts and parses rows without computing on vo2, a deliberate
 * exemption pinned below (the Strava-import precedent in the heart-rate guard). The storage half
 * of the guard is that loadHistory never carries the readings, so no rule can reach them through
 * History.
 */

// Every app source, read at test time through Vite (no node APIs needed).
const sources = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const rules = import.meta.glob<string>('./*.ts', { query: '?raw', import: 'default', eager: true })

/** The screen code allowed to import it, and the module's own tests. */
const IMPORTERS: readonly string[] = ['/src/rules/vo2.test.ts', '/src/screens/Progress.helpers.ts', '/src/screens/Progress.helpers.test.ts']

/** A static or dynamic import of the module, by any relative path, with or without the extension. */
function importsVo2(source: string): boolean {
  return /(?:from|import\()\s*['"`](?:\.{1,2}\/)+(?:[\w.-]+\/)*vo2(?:\.ts)?['"`]/.test(source)
}

/** A mention of the readings: the field, the schema, the table, or the repo and hook names. */
function mentionsVo2(source: string): boolean {
  return /\bvo2\b|\bVo2Reading\b|\bvo2Readings\b|\bgetVo2Readings\b|\buseVo2Readings\b|\bsaveVo2Reading\b|\bdeleteVo2Reading\b/.test(source)
}

/** The rule modules that may mention the readings: the module itself, and the backup, which carries the table. */
const VO2_EXEMPT: readonly string[] = ['./vo2.ts', './backup.ts']

describe('VO2 max informs, changes nothing', () => {
  it('catches an import of the module by any path, and a mention by any of its names, and nothing else', () => {
    expect(importsVo2("import { vo2Problem } from '../rules/vo2.ts'")).toBe(true)
    expect(importsVo2('import { vo2Series } from "./vo2"')).toBe(true)
    expect(importsVo2("const m = await import('../../rules/vo2.ts')")).toBe(true)
    expect(importsVo2("import { fmt } from './Progress.helpers.ts'")).toBe(false)
    expect(importsVo2("import { loadSeries } from '../rules/progress.ts'")).toBe(false)
    expect(mentionsVo2('if (reading.vo2 > 50) return')).toBe(true)
    expect(mentionsVo2("import { Vo2Reading } from '../schema/index.ts'")).toBe(true)
    expect(mentionsVo2('await db.vo2Readings.toArray()')).toBe(true)
    expect(mentionsVo2('await getVo2Readings()')).toBe(true)
    expect(mentionsVo2('const rows = useVo2Readings()')).toBe(true)
    expect(mentionsVo2("await saveVo2Reading({ date, vo2: 44 })")).toBe(true)
    expect(mentionsVo2("await deleteVo2Reading('2026-11-07')")).toBe(true)
    expect(mentionsVo2('const vo2x = 1')).toBe(false)
    expect(mentionsVo2('return run.rpe ?? 5')).toBe(false)
  })

  it('finds the sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    expect(Object.keys(sources)).toContain('/src/rules/vo2.ts')
    for (const path of IMPORTERS) expect(Object.keys(sources), path).toContain(path)
  })

  it('only the Progress helpers import it', () => {
    for (const [path, source] of Object.entries(sources)) {
      if (path === '/src/rules/vo2.guard.test.ts' || IMPORTERS.includes(path)) continue
      expect(importsVo2(source), `${path} imports vo2`).toBe(false)
    }
  })

  it('no rule module but vo2.ts and the backup mentions a reading, its table, or its repo and hook names', () => {
    for (const [path, source] of Object.entries(rules)) {
      if (path.endsWith('.test.ts') || VO2_EXEMPT.includes(path)) continue
      expect(mentionsVo2(source), `${path} mentions VO2 max`).toBe(false)
    }
  })

  it('the backup’s exemption is deliberate and real: it carries the table in the file, nothing more', () => {
    expect(mentionsVo2(rules['./backup.ts'] ?? '')).toBe(true)
    // A carrier, not a reader: it imports nothing from ./vo2.ts, and parses rows without computing on vo2.
    expect(importsVo2(rules['./backup.ts'] ?? '')).toBe(false)
    expect(/\bgetVo2Readings\b|\buseVo2Readings\b|\.vo2\b/.test(rules['./backup.ts'] ?? '')).toBe(false)
  })
})
