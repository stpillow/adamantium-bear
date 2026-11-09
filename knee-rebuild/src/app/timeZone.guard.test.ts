import { describe, expect, it } from 'vitest'

/*
 * The phone's own time zone is read in one place (M-U1, PROGRAM-QUESTIONS 204): src/app/timeZone.ts.
 * Everything else counts dates in the stored zone, handed down; a screen that read the phone's zone
 * would count in a zone the user never chose. Tests are left out.
 */

const sources = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const app = Object.keys(sources).filter((path) => !/\.test\.tsx?$/.test(path))

describe('only src/app/timeZone.ts reads the phone’s time zone', () => {
  it('finds the sources', () => {
    expect(app).toContain('/src/app/timeZone.ts')
  })
  it('nothing else asks Intl for the phone’s zone or the list of zones', () => {
    for (const path of app.filter((p) => p !== '/src/app/timeZone.ts')) {
      const source = sources[path] ?? ''
      expect(source, path).not.toMatch(/resolvedOptions\(/)
      expect(source, path).not.toMatch(/supportedValuesOf/)
      expect(source, path).not.toMatch(/getTimezoneOffset/)
    }
  })
  it('todayIn is always handed a zone outside the rules', () => {
    for (const path of app.filter((p) => !p.startsWith('/src/rules/'))) {
      for (const call of (sources[path] ?? '').matchAll(/\btodayIn\(([^()]|\([^()]*\))*\)/g)) expect(call[0], path).toMatch(/,/)
    }
  })
})
