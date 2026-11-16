import { describe, expect, it } from 'vitest'

/*
 * A check logged late is marked by one stored field, `loggedOn` (Batch D; PROGRAM-QUESTIONS 174 to
 * 176). Nothing may branch on it but the few places the decision names: the schema that stores it,
 * the late-check rule (isLateCheck), the red-flag rule that keeps a late check from the takeover and
 * notes its flags, and the form helper that writes it. Everything else, the gates included, asks
 * isLateCheck; the readings never ask at all, so a late check reads exactly as an on-time one.
 */

const sources = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

const MENTIONS: readonly string[] = ['/src/schema/log.ts', '/src/rules/lateCheck.ts', '/src/rules/redFlags.ts', '/src/screens/MorningCheck.helpers.ts']

/** A read or write of the field: `.loggedOn`, `loggedOn:`, a destructured `{ loggedOn }`. moves.ts's own `loggedOn(…)` function, about something else, is not one. */
function mentionsLoggedOn(source: string): boolean {
  return /\.loggedOn\b|\bloggedOn\s*[:?,}=]|\[['"]loggedOn['"]\]/.test(source)
}

const isTest = (path: string) => /\.test\.tsx?$/.test(path)

describe('only the named places read the late mark', () => {
  it('catches the field’s forms and leaves moves.ts’s function alone', () => {
    for (const form of ['c.loggedOn !== undefined', '{ loggedOn: today }', 'const { loggedOn } = c', "row['loggedOn']", 'check?.loggedOn']) expect(mentionsLoggedOn(form), form).toBe(true)
    expect(mentionsLoggedOn('if (loggedOn(date, runs, workouts)) return')).toBe(false)
  })

  it('finds the sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    for (const path of MENTIONS) expect(mentionsLoggedOn(sources[path] ?? ''), path).toBe(true)
  })

  it('no other app source mentions loggedOn', () => {
    for (const [path, source] of Object.entries(sources)) {
      if (isTest(path) || MENTIONS.includes(path)) continue
      expect(mentionsLoggedOn(source), `${path} mentions loggedOn`).toBe(false)
    }
  })

  it('the gates ask isLateCheck, and the reading rules never ask at all', () => {
    expect(sources['/src/rules/gates.ts']).toMatch(/import \{ isLateCheck \} from '\.\/lateCheck\.ts'/)
    for (const path of ['/src/rules/reading.ts', '/src/rules/history.ts', '/src/rules/wholeKnee.ts', '/src/rules/weekPlan.ts', '/src/rules/prescription.ts', '/src/rules/progress.ts']) {
      expect(sources[path], path).toBeDefined()
      expect(/\bisLateCheck\b/.test(sources[path] ?? '') || mentionsLoggedOn(sources[path] ?? ''), path).toBe(false)
    }
  })
})
