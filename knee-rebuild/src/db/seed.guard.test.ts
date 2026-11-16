import { describe, expect, it } from 'vitest'

/*
 * The seed sweep (M-U1, PROGRAM-QUESTIONS 211): no phone is seeded with Shawn's values. A phone
 * without a settings row answers first run; the seed from before M-U1 (`defaultSettings`: program.json's
 * side and start date, Shawn's 80 lb rack) is a test fixture only, the pre-M-U1 home gym
 * (`homeLocation`, `HOME_ADDITIONS`) is written only by src/db's legacy paths (a phone from before
 * gyms, a file from before gyms), and the only New York in the app is the default zone's one name.
 * Tests are left out: their fixtures are Shawn's on purpose.
 */

const sources = {
  ...import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>('/scripts/**/*.ts', { query: '?raw', import: 'default', eager: true }),
}
const isTest = (path: string) => /\.test\.tsx?$/.test(path)
const app = Object.keys(sources).filter((path) => !isTest(path))
const outsideDb = app.filter((path) => !path.startsWith('/src/db/'))

/** Comments may name things; only code uses them. A `//` after a colon is a URL, not a comment. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('no install is seeded with Shawn’s values (M-U1)', () => {
  it('finds the sources', () => {
    expect(app.length).toBeGreaterThan(50)
    expect(app).toContain('/src/db/repo.ts')
  })

  it('the pre-M-U1 seed and home gym are used by nothing outside src/db', () => {
    for (const path of outsideDb) {
      const text = code(sources[path] ?? '')
      for (const name of ['defaultSettings', 'ensureSettings', 'homeLocation', 'HOME_ADDITIONS']) expect(text, `${path} uses ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`))
    }
  })

  it('defaultSettings and ensureSettings are called by nothing in src/db either: test fixtures only', () => {
    for (const path of app.filter((p) => p.startsWith('/src/db/'))) {
      const text = code(sources[path] ?? '')
      expect(text, `${path} calls defaultSettings`).not.toMatch(/(?<!function )\bdefaultSettings\(/)
      expect(text, `${path} calls ensureSettings`).not.toMatch(/(?<!function )\bensureSettings\(/)
    }
  })

  it('Reset seeds nothing: resetAll takes no arguments', () => {
    for (const path of app) expect(code(sources[path] ?? ''), path).not.toMatch(/\bresetAll\([^)]/)
  })

  it('program.json’s start date and injured side are read only by src/db’s legacy seed and the dev script', () => {
    for (const path of outsideDb.filter((p) => !p.startsWith('/scripts/'))) {
      expect(code(sources[path] ?? ''), path).not.toMatch(/\b(program|PROGRAM)\.(startDate|injuredSide)\b/)
    }
  })

  it('America/New_York is named once, as the default zone', () => {
    const naming = app.filter((path) => code(sources[path] ?? '').includes('America/New_York'))
    expect(naming).toEqual(['/src/schema/enums.ts'])
  })
})
