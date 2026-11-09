import { describe, expect, it } from 'vitest'

/*
 * Warm-up sets are display only (Shawn, Nov 8, decision 5; PROGRAM-QUESTIONS 165): never logged,
 * never stored, never read by a rule. This holds them there. Only src/app/session.ts (which hands a
 * slot's ramp to the runner, the Preview and the time window) and the module's own tests may import
 * src/rules/warmUpRamp.ts; screens take its `Ramp` type through src/app/session.ts. No rule module
 * but warmUpRamp.ts and fitWindow.ts (which counts a ramp's reps as plain numbers for the minutes,
 * PROGRAM-QUESTIONS 167) mentions a ramp, and nothing in storage or the log schema does, so no
 * reading, prescription, compliance count, training load or gate can come to rest on one.
 */

const sources = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const rules = import.meta.glob<string>('./*.ts', { query: '?raw', import: 'default', eager: true })

const IMPORTERS: readonly string[] = ['/src/rules/warmUpRamp.test.ts', '/src/app/session.ts', '/src/app/session.ramp.test.ts']
/** Rule modules that may mention a ramp: the module itself, and the time window that counts its reps. */
const RAMP_RULES: readonly string[] = ['./warmUpRamp.ts', './fitWindow.ts']

function importsRamp(source: string): boolean {
  return /(?:from|import\()\s*['"`](?:\.{1,2}\/)+(?:[\w.-]+\/)*warmUpRamp(?:\.ts)?['"`]/.test(source)
}

const mentionsRamp = (source: string) => /ramp/i.test(source)

describe('warm-up sets are display only', () => {
  it('catches an import of the module by any path, and nothing else', () => {
    expect(importsRamp("import { rampFor } from '../rules/warmUpRamp.ts'")).toBe(true)
    expect(importsRamp('import type { Ramp } from "./warmUpRamp"')).toBe(true)
    expect(importsRamp("const m = await import('../../rules/warmUpRamp.ts')")).toBe(true)
    expect(importsRamp("import { warmUpParts } from '../rules/warmUp.ts'")).toBe(false)
    expect(importsRamp("import type { Ramp } from '../app/session.ts'")).toBe(false)
  })

  it('finds the sources', () => {
    expect(Object.keys(sources)).toContain('/src/rules/warmUpRamp.ts')
    for (const path of IMPORTERS) expect(Object.keys(sources), path).toContain(path)
    expect(Object.keys(sources)).toContain('/src/schema/log.ts')
  })

  it('only the app’s session module and the tests import it', () => {
    for (const [path, source] of Object.entries(sources)) {
      if (path === '/src/rules/warmUpRamp.guard.test.ts' || IMPORTERS.includes(path)) continue
      expect(importsRamp(source), `${path} imports warmUpRamp`).toBe(false)
    }
  })

  it('no other rule module mentions a ramp', () => {
    for (const [path, source] of Object.entries(rules)) {
      if (path.endsWith('.test.ts') || RAMP_RULES.includes(path)) continue
      expect(mentionsRamp(source), `${path} mentions a ramp`).toBe(false)
    }
  })

  it('nothing in storage or the log schema mentions one, so a ramp is never stored', () => {
    for (const [path, source] of Object.entries(sources)) {
      if (!path.startsWith('/src/db/') && path !== '/src/schema/log.ts') continue
      expect(mentionsRamp(source), `${path} mentions a ramp`).toBe(false)
    }
  })
})
