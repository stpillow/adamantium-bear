import { describe, expect, it } from 'vitest'
import { scan } from './bundleCheck.ts'

describe('the bundle check', () => {
  it('passes the PWA as it should be', () => {
    expect(scan([
      { path: 'assets/index-abc.js', text: 'fetch("/api/auth?action=me",{credentials:"same-origin"})' },
      { path: 'index.html', text: '<html><script src="/assets/index-abc.js"></script></html>' },
      { path: 'manifest.webmanifest', text: '{"name":"Knee Rebuild"}' },
    ])).toEqual([])
  })
  it('fails on the Neon driver, PGlite, a secret’s name, the code tag or Neon’s host', () => {
    for (const text of ['import("@neondatabase/serverless")', 'new PGlite()', 'process.env.DATABASE_URL', 'AUTH_COOKIE_KEY', 'AUTH_CODE_PEPPER', 'AUTH_BOOTSTRAP_CODE', '"kr-code-v1:"', 'ep-x.us-east-2.aws.neon.tech']) {
      expect(scan([{ path: 'assets/App-1.js', text }]), text).toHaveLength(1)
    }
    expect(scan([{ path: 'sw.js', text: 'pglite' }])).toEqual(['sw.js: pglite'])
    expect(scan([{ path: 'index.html', text: 'neondatabase' }])).toEqual(['index.html: neondatabase'])
  })
  it('reads only the files the PWA ships as text', () => {
    expect(scan([{ path: 'icon-192.png', text: 'pglite' }])).toEqual([])
  })
})
