import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mintAccount, revokeAccount, accountById, type Db } from './_accounts.ts'
import {
  SESSION_MAX_AGE,
  accountsMode,
  checkSession,
  clientKey,
  cookie,
  generation,
  ipv6Prefix,
  isJson,
  json,
  readBody,
  readSession,
  requireSession,
  sameOrigin,
  seal,
  sealSession,
  sessionCookie,
  sessionSub,
  unseal,
  type AuthEnv,
} from './_session.ts'
import { testDb, type TestDb } from './_testDb.ts'

const NOW = 1_800_000_000
const ENV: AuthEnv = { DATABASE_URL: 'postgres://unused', AUTH_COOKIE_KEY: 'c'.repeat(40), AUTH_CODE_PEPPER: 'p'.repeat(40) }
const ORIGIN = 'https://knee-rebuild.vercel.app'
const req = (headers: Record<string, string> = {}, init: RequestInit = {}) => new Request(`${ORIGIN}/api/auth?action=me`, { ...init, headers })
const noDb = () => Promise.reject(new Error('the database was asked for'))

let db: TestDb
const getDb = () => Promise.resolve<Db>(db)
beforeAll(async () => {
  db = await testDb()
})
afterAll(async () => {
  await db.close()
})
beforeEach(async () => {
  await db.reset()
})

describe('the switch', () => {
  it('is off unless the database and the cookie key are both set', () => {
    expect(accountsMode({})).toBe('off')
    expect(accountsMode({ DATABASE_URL: 'postgres://x' })).toBe('off')
    expect(accountsMode({ AUTH_COOKIE_KEY: 'c'.repeat(40), AUTH_CODE_PEPPER: 'p'.repeat(40) })).toBe('off')
    expect(accountsMode({ ...ENV, DATABASE_URL: '' })).toBe('off')
  })
  it('is on with long, untrimmed secrets and a readable generation', () => {
    expect(accountsMode(ENV)).toBe('on')
    expect(accountsMode({ ...ENV, AUTH_KEY_GENERATION: '7' })).toBe('on')
    expect(accountsMode({ ...ENV, AUTH_KEY_GENERATION: '' })).toBe('on')
  })
  it('is broken, failing closed, when half set', () => {
    expect(accountsMode({ ...ENV, AUTH_CODE_PEPPER: undefined })).toBe('broken')
    expect(accountsMode({ ...ENV, AUTH_CODE_PEPPER: 'short' })).toBe('broken')
    expect(accountsMode({ ...ENV, AUTH_COOKIE_KEY: 'short' })).toBe('broken')
    expect(accountsMode({ ...ENV, AUTH_CODE_PEPPER: `${'p'.repeat(40)}\n` })).toBe('broken')
    expect(accountsMode({ ...ENV, AUTH_COOKIE_KEY: ` ${'c'.repeat(40)}` })).toBe('broken')
    expect(accountsMode({ ...ENV, DATABASE_URL: ' postgres://unused' })).toBe('broken')
    expect(accountsMode({ ...ENV, DATABASE_URL: 'postgres://unused\n' })).toBe('broken')
    for (const g of ['0', '-1', '1.5', 'two', ' 2']) expect(accountsMode({ ...ENV, AUTH_KEY_GENERATION: g }), g).toBe('broken')
  })
  it('reads the generation, 1 when unset', () => {
    expect(generation({})).toBe(1)
    expect(generation({ AUTH_KEY_GENERATION: '12' })).toBe(12)
    expect(generation({ AUTH_KEY_GENERATION: '0' })).toBeNull()
  })
})

describe('sealing with a context', () => {
  it('without one is the Strava derivation; a context makes a different key', async () => {
    const plain = await seal({ a: 1 }, ENV.AUTH_COOKIE_KEY!)
    expect(await unseal(plain, ENV.AUTH_COOKIE_KEY!)).toEqual({ a: 1 })
    expect(await unseal(plain, ENV.AUTH_COOKIE_KEY!, 'kr-session-v1')).toBeNull()
    const ctx = await seal({ a: 1 }, ENV.AUTH_COOKIE_KEY!, 'kr-session-v1')
    expect(await unseal(ctx, ENV.AUTH_COOKIE_KEY!)).toBeNull()
    expect(await unseal(ctx, ENV.AUTH_COOKIE_KEY!, 'kr-session-v1')).toEqual({ a: 1 })
  })
  it('a Strict cookie when asked; Lax by default', () => {
    expect(cookie('kr_session', 'v', 9, 'Strict')).toBe('kr_session=v; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=9')
    expect(cookie('kr_strava', 'v', 9)).toBe('kr_strava=v; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=9')
  })
  it('json carries every cookie it is given', () => {
    const res = json({}, 200, {}, ['a=1', 'b=2'])
    expect(res.headers.getSetCookie()).toEqual(['a=1', 'b=2'])
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('requests', () => {
  it('same origin: the Origin header, else Sec-Fetch-Site; null and other origins refused', () => {
    expect(sameOrigin(req({ origin: ORIGIN }))).toBe(true)
    expect(sameOrigin(req({ origin: 'https://evil.example' }))).toBe(false)
    expect(sameOrigin(req({ origin: 'null' }))).toBe(false)
    expect(sameOrigin(req({ origin: 'https://knee-rebuild.vercel.app.evil.example' }))).toBe(false)
    expect(sameOrigin(req({ 'sec-fetch-site': 'same-origin' }))).toBe(true)
    expect(sameOrigin(req({ 'sec-fetch-site': 'same-site' }))).toBe(false)
    expect(sameOrigin(req({ 'sec-fetch-site': 'cross-site' }))).toBe(false)
    expect(sameOrigin(req({}))).toBe(false)
  })
  it('JSON content type, with parameters, and nothing that only starts like it', () => {
    expect(isJson(req({ 'content-type': 'application/json' }))).toBe(true)
    expect(isJson(req({ 'content-type': 'Application/JSON; charset=utf-8' }))).toBe(true)
    expect(isJson(req({ 'content-type': 'application/json-x' }))).toBe(false)
    expect(isJson(req({ 'content-type': 'text/plain' }))).toBe(false)
    expect(isJson(req({}))).toBe(false)
  })
  it('reads a body up to the limit, and refuses a longer one before or while reading', async () => {
    const post = (body: string, headers: Record<string, string> = {}) => new Request(`${ORIGIN}/x`, { method: 'POST', body, headers })
    expect(await readBody(post('{"code":"x"}'), 1024)).toBe('{"code":"x"}')
    expect(await readBody(post('x'.repeat(1025)), 1024)).toBeNull()
    expect(await readBody(post('x', { 'content-length': '5000' }), 1024)).toBeNull()
    expect(await readBody(new Request(`${ORIGIN}/x`, { method: 'POST' }), 1024)).toBe('')
  })
  it('keys IPv6 clients by their /64, and never keeps the address', async () => {
    expect(ipv6Prefix('2001:db8:abcd:12:1:2:3:4')).toBe('2001:db8:abcd:12::/64')
    expect(ipv6Prefix('2001:0db8:abcd:0012::99')).toBe('2001:db8:abcd:12::/64')
    expect(ipv6Prefix('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(ipv6Prefix('::1')).toBe('0:0:0:0::/64')
    expect(ipv6Prefix('[2001:db8::1%eth0]')).toBe('2001:db8:0:0::/64')
    expect(ipv6Prefix('203.0.113.9')).toBeNull()
    expect(ipv6Prefix('zz::1')).toBeNull()
    const pepper = ENV.AUTH_CODE_PEPPER!
    const key = (h: Record<string, string>) => clientKey(pepper, req(h))
    expect(await key({ 'x-real-ip': '2001:db8:abcd:12::1' })).toBe(await key({ 'x-real-ip': '2001:db8:abcd:12:ffff::2' }))
    expect(await key({ 'x-real-ip': '2001:db8:abcd:12::1' })).not.toBe(await key({ 'x-real-ip': '2001:db8:abcd:13::1' }))
    expect(await key({ 'x-real-ip': '203.0.113.9' })).toBe(await key({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))
    expect(await key({ 'x-real-ip': '::ffff:203.0.113.9' })).toBe(await key({ 'x-real-ip': '203.0.113.9' }))
    expect(await key({ 'x-real-ip': '203.0.113.9' })).not.toContain('203')
    expect(await key({ 'x-real-ip': '203.0.113.9' })).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('the session cookie', () => {
  const header = async (sub: string, iat = NOW, env = ENV) => `kr_session=${await sealSession(sub, env, iat)}`

  it('is Strict, HttpOnly, Secure, on /api, for 400 days', async () => {
    const c = await sessionCookie('a', ENV, NOW)
    expect(c).toMatch(/^kr_session=[\w-]+\.[\w-]+; Path=\/api; HttpOnly; Secure; SameSite=Strict; Max-Age=34560000$/)
    expect(c).not.toContain('"sub"')
  })

  it('reads back within its life and generation only', async () => {
    expect(await readSession(await header('a'), ENV, NOW)).toEqual({ k: 's', sub: 'a', iat: NOW, gen: 1 })
    expect(await readSession(await header('a'), ENV, NOW + SESSION_MAX_AGE)).not.toBeNull()
    expect(await readSession(await header('a'), ENV, NOW + SESSION_MAX_AGE + 1)).toBeNull()
    expect(await readSession(await header('a', NOW + 301), ENV, NOW)).toBeNull()
    expect(await readSession(await header('a'), { ...ENV, AUTH_KEY_GENERATION: '2' }, NOW)).toBeNull()
    expect(await readSession(await header('a'), { ...ENV, AUTH_COOKIE_KEY: 'd'.repeat(40) }, NOW)).toBeNull()
    expect(await readSession(null, ENV, NOW)).toBeNull()
  })

  it('refuses a tampered value, a value of the wrong kind, and a payload of the wrong types', async () => {
    const good = await sealSession('a', ENV, NOW)
    expect(await readSession(`kr_session=${good.slice(0, -2)}AA`, ENV, NOW)).toBeNull()
    for (const bad of [{ k: 'strava-state', sub: 'a', iat: NOW, gen: 1 }, { k: 's', sub: 7, iat: NOW, gen: 1 }, { k: 's', sub: 'a', iat: '1', gen: 1 }, { k: 's', sub: 'a', iat: NOW, gen: 1.5 }, { k: 's', sub: '', iat: NOW, gen: 1 }, 'a', null]) {
      expect(await readSession(`kr_session=${await seal(bad, ENV.AUTH_COOKIE_KEY!, 'kr-session-v1')}`, ENV, NOW), JSON.stringify(bad)).toBeNull()
    }
    // Strava's sealing (no context) under the same key never passes as a session.
    expect(await readSession(`kr_session=${await seal({ k: 's', sub: 'a', iat: NOW, gen: 1 }, ENV.AUTH_COOKIE_KEY!)}`, ENV, NOW)).toBeNull()
  })

  it('names its account even when stale, for the Strava hand-over rule', async () => {
    expect(await sessionSub(await header('a', NOW - SESSION_MAX_AGE - 10), ENV)).toBe('a')
    expect(await sessionSub('kr_session=junk', ENV)).toBeNull()
  })
})

describe('the gate', () => {
  it('answers a missing, unreadable or stale cookie without the database', async () => {
    const gate = (h: Record<string, string>, env = ENV) => requireSession(req(h), env, noDb, NOW)
    const none = await gate({})
    expect(none.ok).toBe(false)
    if (none.ok) return
    expect(none.response.status).toBe(401)
    expect(await none.response.json()).toEqual({ error: 'Sign in on this phone first: Settings, Account.', account: 'required' })
    expect(none.response.headers.getSetCookie()).toEqual([])
    const junk = await gate({ cookie: 'kr_session=junk' })
    expect(junk.ok || junk.response.headers.getSetCookie()).toEqual(['kr_session=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0'])
    const stale = await gate({ cookie: `kr_session=${await sealSession('a', ENV, NOW)}` }, { ...ENV, AUTH_KEY_GENERATION: '2' })
    expect(stale.ok || stale.response.status).toBe(401)
    // Readable but stale: left in place, so a redeem by another account still sees whose context this was.
    expect(stale.ok || stale.response.headers.getSetCookie()).toEqual([])
  })

  it('in broken mode answers 503 setup, without the database', async () => {
    const g = await requireSession(req({}), { ...ENV, AUTH_CODE_PEPPER: undefined }, noDb, NOW)
    expect(g.ok || g.response.status).toBe(503)
    expect(g.ok || (await g.response.json())).toEqual({ error: 'Accounts are half set up on this deployment.', account: 'setup' })
  })

  it('lets a live account through, writes last seen hourly, and refuses a revoked or unknown one the same way', async () => {
    await mintAccount(db, { id: 'a', name: 'Alex', role: 'tester', hash: 'a'.repeat(64), at: NOW - 100 })
    const h = { cookie: `kr_session=${await sealSession('a', ENV, NOW)}` }
    const g = await requireSession(req(h), ENV, getDb, NOW)
    expect(g.ok && g.account).toEqual({ id: 'a', name: 'Alex', role: 'tester' })
    expect((await accountById(db, 'a'))?.last_seen).toBe(NOW)
    const statements = db.statements
    await requireSession(req(h), ENV, getDb, NOW + 60)
    expect(db.statements - statements).toBe(1)
    await revokeAccount(db, 'a', NOW + 100)
    const revoked = await requireSession(req(h), ENV, getDb, NOW + 120)
    const unknown = await requireSession(req({ cookie: `kr_session=${await sealSession('b', ENV, NOW)}` }), ENV, getDb, NOW)
    for (const r of [revoked, unknown]) {
      expect(r.ok).toBe(false)
      if (r.ok) continue
      expect(r.response.status).toBe(401)
      expect(await r.response.json()).toEqual({ error: 'Sign in on this phone first: Settings, Account.', account: 'required' })
      expect(r.response.headers.getSetCookie()).toEqual([])
    }
  })

  it('a database that fails is a 503 that names nothing of it', async () => {
    const failing = () => Promise.reject(new Error('connect ECONNREFUSED ep-secret-host.neon.tech postgres://user:pw@ep-secret-host'))
    const g = await requireSession(req({ cookie: `kr_session=${await sealSession('a', ENV, NOW)}` }), ENV, failing, NOW)
    expect(g.ok || g.response.status).toBe(503)
    const text = g.ok ? '' : await g.response.text()
    expect(text).toBe(JSON.stringify({ error: 'Accounts can’t be checked right now. Try again in a minute.', account: 'unavailable' }))
    expect(await checkSession(req({ cookie: `kr_session=${await sealSession('a', ENV, NOW)}` }), ENV, failing, NOW)).toEqual({ kind: 'unavailable' })
  })
})
