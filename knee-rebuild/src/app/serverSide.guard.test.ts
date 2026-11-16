import { describe, expect, it } from 'vitest'

/*
 * The accounts' server side stays on the server (M-U2; PROGRAM-QUESTIONS 213 to 222). The Neon driver
 * is a runtime dependency of api/ only, PGlite a dev dependency of the tests only, and neither may
 * reach the PWA: no app source imports from api/, from either package or from node:, or names an
 * account secret, and only the two client modules call /api/ at all (scripts/bundleCheck.ts then
 * reads the built bundle itself). On the server: every SQL statement lives in api/_accounts.ts, only
 * the two functions read the environment, nothing logs or repeats an error's own text, and imports
 * inside api/ end in .js, since Vercel's compile keeps a .ts specifier as written and the function
 * would fail to load.
 */

const SELF = '/src/app/serverSide.guard.test.ts'
const src = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const api = import.meta.glob<string>('/api/**/*.ts', { query: '?raw', import: 'default', eager: true })
const scripts = import.meta.glob<string>('/scripts/**/*.ts', { query: '?raw', import: 'default', eager: true })
const packageJson = JSON.parse(import.meta.glob<string>('/package.json', { query: '?raw', import: 'default', eager: true })['/package.json'] ?? '{}') as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

const isTest = (path: string) => /\.test\.tsx?$/.test(path)
const appSources = Object.entries(src).filter(([path]) => !isTest(path))
const apiSources = Object.entries(api).filter(([path]) => !isTest(path))

/** Every import or re-export specifier in a source. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom|\bimport\(?)\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1] ?? '')
}

describe('the accounts’ server side never reaches the PWA', () => {
  it('finds the sources', () => {
    expect(appSources.length).toBeGreaterThan(100)
    for (const path of ['/api/auth.ts', '/api/strava.ts', '/api/_session.ts', '/api/_accounts.ts', '/api/_code.ts', '/api/_testDb.ts']) expect(Object.keys(api), path).toContain(path)
    expect(Object.keys(src)).toContain('/src/app/account.ts')
    expect(Object.keys(scripts)).toContain('/scripts/accounts.ts')
  })

  it('the specifier reader catches imports, re-exports and dynamic imports', () => {
    expect(specifiers("import { a } from '../../api/_session.js'\nexport { b } from './x.ts'\nconst m = await import('@neondatabase/serverless')")).toEqual(['../../api/_session.js', './x.ts', '@neondatabase/serverless'])
  })

  it('no app source imports from api/, the database packages, pg or node:', () => {
    for (const [path, source] of appSources) {
      for (const s of specifiers(source)) {
        expect(s, path).not.toMatch(/(?:^|\/)api\//)
        expect(s, path).not.toMatch(/^@neondatabase\/|^@electric-sql\/|^pg$|^pg\/|^node:/)
      }
    }
  })

  it('no app source names an account secret or the code hash’s tag', () => {
    for (const [path, source] of Object.entries(src)) {
      if (path === SELF) continue
      expect(source, path).not.toMatch(/DATABASE_URL|AUTH_COOKIE_KEY|AUTH_CODE_PEPPER|AUTH_KEY_GENERATION|AUTH_BOOTSTRAP_CODE|AUTH_BOOTSTRAP_NAME|kr-code-v1/)
    }
  })

  it('only the two client modules call /api/', () => {
    const calling = appSources.filter(([, source]) => source.includes('/api/')).map(([path]) => path)
    expect(calling.sort()).toEqual(['/src/app/account.ts', '/src/app/strava.ts'])
  })

  it('the Neon driver is a runtime dependency and PGlite a dev dependency only; the build runs the bundle check', () => {
    expect(packageJson.dependencies?.['@neondatabase/serverless']).toBeDefined()
    expect(packageJson.devDependencies?.['@neondatabase/serverless']).toBeUndefined()
    expect(packageJson.devDependencies?.['@electric-sql/pglite']).toBeDefined()
    expect(packageJson.dependencies?.['@electric-sql/pglite']).toBeUndefined()
    expect(packageJson.scripts?.build).toMatch(/vite build && tsx scripts\/bundleCheck\.ts$/)
  })

  it('only api/_testDb.ts and tests import PGlite; only tests import api/_testDb; only the two code tests import api/_codeFixtures', () => {
    for (const [path, source] of [...Object.entries(src), ...Object.entries(api), ...Object.entries(scripts)]) {
      if (path === SELF) continue
      if (specifiers(source).some((s) => /(?:^|\/)_codeFixtures(?:\.[jt]s)?$/.test(s))) expect(['/api/_code.test.ts', '/src/screens/Account.helpers.test.ts'], path).toContain(path)
      if (specifiers(source).some((s) => s.startsWith('@electric-sql/'))) expect(path === '/api/_testDb.ts' || isTest(path), path).toBe(true)
      if (specifiers(source).some((s) => /(?:^|\/)_testDb(?:\.[jt]s)?$/.test(s))) expect(isTest(path), path).toBe(true)
    }
  })
})

describe('the server functions', () => {
  it('every SQL statement lives in api/_accounts.ts (and the tests’ PGlite adapter)', () => {
    for (const [path, source] of [...apiSources, ...Object.entries(scripts).filter(([p]) => !isTest(p))]) {
      if (path === '/api/_accounts.ts' || path === '/api/_testDb.ts') continue
      expect(source, path).not.toMatch(/\.query\(/)
      expect(source, path).not.toMatch(/\b(?:SELECT|INSERT INTO|UPDATE \w+ SET|DELETE FROM|CREATE TABLE)\b/)
    }
  })

  it('only the two functions read the environment, once each', () => {
    for (const [path, source] of apiSources) {
      const reads = source.match(/process\.env/g)?.length ?? 0
      expect(reads, path).toBe(path === '/api/auth.ts' || path === '/api/strava.ts' ? 1 : 0)
    }
  })

  it('nothing in api/ logs, or repeats an error’s own message', () => {
    for (const [path, source] of apiSources) {
      expect(source, path).not.toMatch(/\bconsole\./)
      expect(source, path).not.toMatch(/\.message\b|\.stack\b|String\(e(?:rr(?:or)?)?\)/)
    }
  })

  it('api/ imports nothing from src/, and its relative imports end in .js', () => {
    for (const [path, source] of apiSources) {
      for (const s of specifiers(source)) {
        expect(s, path).not.toMatch(/(?:^|\/)src\//)
        if (s.startsWith('.')) expect(s, `${path} imports ${s}`).toMatch(/\.js$/)
      }
    }
  })

  it('each function answers a thrown error with a plain 500, never the error', () => {
    for (const path of ['/api/auth.ts', '/api/strava.ts']) {
      expect(api[path], path).toMatch(/\.catch\(\(\) => json\(\{ error: 'Something went wrong on the server\.' \}, 500\)\)/)
    }
  })
})
