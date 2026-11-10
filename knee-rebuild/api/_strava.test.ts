import { describe, expect, it } from 'vitest'
import { authorizeUrl, configured, cookie, fresh, handle, readCookie, scopeGranted, seal, trim, unseal, type Env, type Tokens } from './strava.ts'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import { mintAccount, revokeAccount, type Db } from './_accounts.ts'
import { sealSession } from './_session.ts'
import { checkSymbol, hashCode } from './_code.ts'
import { handle as authHandle } from './auth.ts'
import type { FunctionEnv } from './strava.ts'
import { testDb, type TestDb } from './_testDb.ts'

const ENV: Required<Env> = { STRAVA_CLIENT_ID: '123', STRAVA_CLIENT_SECRET: 'shh', STRAVA_COOKIE_KEY: 'k'.repeat(40) }
const NOW = 1_800_000_000
const tokens = (over: Partial<Tokens> = {}): Tokens => ({ access_token: 'a1', refresh_token: 'r1', expires_at: NOW + 3600, ...over })
const req = (path: string, init: RequestInit & { cookies?: string } = {}) =>
  new Request(`https://knee-rebuild.vercel.app${path}`, { ...init, headers: init.cookies ? { cookie: init.cookies } : {} })

/** A stand-in for Strava: records each call, answers from the routes given. */
function fakeStrava(routes: Record<string, () => Response>) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const route = Object.keys(routes).find((r) => url.startsWith(r))
    return route ? routes[route]!() : new Response('no route', { status: 500 })
  }) as typeof fetch
  return { fetcher, calls }
}
const tokenResponse = (t: Tokens) => () => new Response(JSON.stringify({ ...t, athlete: { id: 9 } }), { status: 200 })

describe('configuration', () => {
  it('needs the client id, the secret and a cookie key of 32 or more characters', () => {
    expect(configured(ENV)).toBe(true)
    expect(configured({ ...ENV, STRAVA_COOKIE_KEY: 'short' })).toBe(false)
    expect(configured({ STRAVA_CLIENT_ID: '1' })).toBe(false)
  })
  it('says so on status, and refuses everything else', async () => {
    expect(await (await handle(req('/api/strava?action=status'), {})).json()).toEqual({ configured: false, connected: false })
    expect((await handle(req('/api/strava?action=activities&after=0'), {})).status).toBe(503)
  })
})

describe('the sealed cookie', () => {
  it('round-trips, and reads as nothing when tampered with or sealed under another key', async () => {
    const sealed = await seal(tokens(), ENV.STRAVA_COOKIE_KEY)
    expect(sealed).not.toContain('r1')
    expect(await unseal(sealed, ENV.STRAVA_COOKIE_KEY)).toEqual(tokens())
    expect(await unseal(sealed, 'x'.repeat(40))).toBeNull()
    expect(await unseal(`${sealed.slice(0, -2)}AA`, ENV.STRAVA_COOKIE_KEY)).toBeNull()
    expect(await unseal('garbage', ENV.STRAVA_COOKIE_KEY)).toBeNull()
    expect(await unseal(undefined, ENV.STRAVA_COOKIE_KEY)).toBeNull()
  })
  it('is HttpOnly, Secure, SameSite=Lax and scoped to /api', () => {
    expect(cookie('kr_strava', 'v', 60)).toBe('kr_strava=v; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=60')
    expect(readCookie('a=1; kr_strava=x.y=; b=2', 'kr_strava')).toBe('x.y=')
    expect(readCookie(null, 'kr_strava')).toBeUndefined()
  })
})

describe('Strava pieces', () => {
  it('asks for read access to all his activities', () => {
    const u = new URL(authorizeUrl('123', 'https://x/api/strava?action=callback', 'st'))
    expect(u.origin + u.pathname).toBe('https://www.strava.com/oauth/authorize')
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: '123', redirect_uri: 'https://x/api/strava?action=callback', response_type: 'code', approval_prompt: 'auto', scope: 'activity:read_all', state: 'st' })
  })
  it('accepts either activity scope, and nothing without one', () => {
    expect(scopeGranted('read,activity:read_all')).toBe(true)
    expect(scopeGranted('read,activity:read')).toBe(true)
    expect(scopeGranted('read')).toBe(false)
    expect(scopeGranted(null)).toBe(false)
  })
  it('passes on only what the import reads: the summary heart-rate averages now survive; maps, athletes and streams still don’t (metrics phase 2)', () => {
    expect(trim({ id: 1, name: 'R', sport_type: 'Run', distance: 1, moving_time: 2, start_date_local: 's', map: { polyline: 'xyz' }, average_heartrate: 150.4, max_heartrate: 171, athlete: { id: 9 } })).toEqual({
      id: 1,
      name: 'R',
      sport_type: 'Run',
      distance: 1,
      moving_time: 2,
      start_date_local: 's',
      average_heartrate: 150.4,
      max_heartrate: 171,
    })
  })
  it('refreshes a token that expires within a minute, keeping the rotated refresh token', async () => {
    const { fetcher, calls } = fakeStrava({ 'https://www.strava.com/oauth/token': tokenResponse(tokens({ access_token: 'a2', refresh_token: 'r2', expires_at: NOW + 21600 })) })
    expect(await fresh(ENV, tokens(), NOW, fetcher)).toEqual({ tokens: tokens(), refreshed: false })
    const out = await fresh(ENV, tokens({ expires_at: NOW + 30 }), NOW, fetcher)
    expect(out).toEqual({ tokens: { access_token: 'a2', refresh_token: 'r2', expires_at: NOW + 21600 }, refreshed: true })
    expect(String(calls[0]?.init?.body)).toContain('grant_type=refresh_token')
    expect(String(calls[0]?.init?.body)).toContain('client_secret=shh')
  })
})

describe('the flow', () => {
  it('connect sends him to Strava with a state it also sets as a short cookie', async () => {
    const res = await handle(req('/api/strava?action=connect'), ENV)
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location') ?? '')
    expect(location.searchParams.get('redirect_uri')).toBe('https://knee-rebuild.vercel.app/api/strava?action=callback')
    expect(res.headers.get('set-cookie')).toContain(`kr_strava_state=${location.searchParams.get('state')}`)
  })

  it('callback refuses a state it didn’t send, a denial, and a missing scope, without calling Strava', async () => {
    const { fetcher, calls } = fakeStrava({})
    const back = async (q: string, c = 'kr_strava_state=s1') => (await handle(req(`/api/strava?action=callback&${q}`, { cookies: c }), ENV, () => NOW, fetcher)).headers.get('location')
    expect(await back('state=s2&code=c&scope=activity:read_all')).toBe('/#/strava?result=state')
    expect(await back('state=s1&code=c&scope=activity:read_all', '')).toBe('/#/strava?result=state')
    expect(await back('state=s1&error=access_denied')).toBe('/#/strava?result=denied')
    expect(await back('state=s1&code=c&scope=read')).toBe('/#/strava?result=scope')
    expect(calls).toHaveLength(0)
  })

  it('callback trades the code for tokens and keeps them sealed in the cookie', async () => {
    const { fetcher } = fakeStrava({ 'https://www.strava.com/oauth/token': tokenResponse(tokens()) })
    const res = await handle(req('/api/strava?action=callback&state=s1&code=c&scope=read,activity:read_all', { cookies: 'kr_strava_state=s1' }), ENV, () => NOW, fetcher)
    expect(res.headers.get('location')).toBe('/#/strava?result=connected')
    const set = res.headers.getSetCookie().find((c) => c.startsWith('kr_strava='))
    expect(set).toBeDefined()
    expect(set).not.toContain('r1')
    const value = set!.split(';')[0]!.slice('kr_strava='.length)
    expect(await unseal(value, ENV.STRAVA_COOKIE_KEY)).toEqual(tokens())
  })

  it('activities needs the cookie, a whole-number after, and returns trimmed pages', async () => {
    const sealed = await seal(tokens(), ENV.STRAVA_COOKIE_KEY)
    const page = Array.from({ length: 3 }, (_, i) => ({ id: i, sport_type: 'Run', distance: 1, moving_time: 1, start_date_local: 's', map: {} }))
    const { fetcher, calls } = fakeStrava({ 'https://www.strava.com/api/v3/athlete/activities': () => new Response(JSON.stringify(page)) })
    expect((await handle(req('/api/strava?action=activities&after=0'), ENV, () => NOW, fetcher)).status).toBe(401)
    expect((await handle(req('/api/strava?action=activities&after=x', { cookies: `kr_strava=${sealed}` }), ENV, () => NOW, fetcher)).status).toBe(400)
    const res = await handle(req('/api/strava?action=activities&after=100', { cookies: `kr_strava=${sealed}` }), ENV, () => NOW, fetcher)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { activities: unknown[] }).activities).toEqual(page.map(({ map: _m, ...a }) => a))
    expect(calls.at(-1)?.url).toBe('https://www.strava.com/api/v3/athlete/activities?after=100&per_page=100&page=1')
    const sent = calls.at(-1)?.init?.headers as Record<string, string> | undefined
    expect(sent?.Authorization).toBe('Bearer a1')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('activities says so when Strava rate-limits, and asks to connect again when a refresh fails', async () => {
    const sealed = await seal(tokens(), ENV.STRAVA_COOKIE_KEY)
    const limited = fakeStrava({ 'https://www.strava.com/api/v3/athlete/activities': () => new Response('', { status: 429 }) })
    expect((await handle(req('/api/strava?action=activities&after=0', { cookies: `kr_strava=${sealed}` }), ENV, () => NOW, limited.fetcher)).status).toBe(429)
    const expired = await seal(tokens({ expires_at: NOW - 10 }), ENV.STRAVA_COOKIE_KEY)
    const refused = fakeStrava({ 'https://www.strava.com/oauth/token': () => new Response('', { status: 400 }) })
    const res = await handle(req('/api/strava?action=activities&after=0', { cookies: `kr_strava=${expired}` }), ENV, () => NOW, refused.fetcher)
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('keeps a renewed token in the cookie even when the page that follows fails (Strava rotates the refresh token)', async () => {
    const expired = await seal(tokens({ expires_at: NOW - 10 }), ENV.STRAVA_COOKIE_KEY)
    const renewed = tokens({ access_token: 'a2', refresh_token: 'r2', expires_at: NOW + 21600 })
    const keeps = async (fetcher: typeof fetch, status: number) => {
      const res = await handle(req('/api/strava?action=activities&after=0', { cookies: `kr_strava=${expired}` }), ENV, () => NOW, fetcher)
      expect(res.status).toBe(status)
      const set = res.headers.getSetCookie().find((c) => c.startsWith('kr_strava='))
      expect(set, `status ${status}`).toBeDefined()
      expect(await unseal(set!.split(';')[0]!.slice('kr_strava='.length), ENV.STRAVA_COOKIE_KEY)).toEqual(renewed)
    }
    const page = 'https://www.strava.com/api/v3/athlete/activities'
    await keeps(fakeStrava({ 'https://www.strava.com/oauth/token': tokenResponse(renewed), [page]: () => new Response('', { status: 429 }) }).fetcher, 429)
    await keeps(fakeStrava({ 'https://www.strava.com/oauth/token': tokenResponse(renewed), [page]: () => new Response('', { status: 503 }) }).fetcher, 502)
    await keeps(fakeStrava({ 'https://www.strava.com/oauth/token': tokenResponse(renewed), [page]: () => new Response('not json', { status: 200 }) }).fetcher, 502)
  })

  it('disconnect renews an expired token before revoking, and says when Strava did not take the revoke', async () => {
    const expired = await seal(tokens({ expires_at: NOW - 10 }), ENV.STRAVA_COOKIE_KEY)
    const renewed = tokens({ access_token: 'a2', refresh_token: 'r2', expires_at: NOW + 21600 })
    const ok = fakeStrava({ 'https://www.strava.com/oauth/token': tokenResponse(renewed), 'https://www.strava.com/oauth/deauthorize': () => new Response('{}') })
    const res = await handle(req('/api/strava?action=disconnect', { method: 'POST', cookies: `kr_strava=${expired}` }), ENV, () => NOW, ok.fetcher)
    expect(await res.json()).toEqual({ connected: false, revoked: true })
    const revoke = ok.calls.find((c) => c.url.endsWith('/oauth/deauthorize'))
    expect((revoke?.init?.headers as Record<string, string> | undefined)?.Authorization).toBe('Bearer a2')
    const refused = fakeStrava({ 'https://www.strava.com/oauth/deauthorize': () => new Response('', { status: 401 }) })
    const fresh = await seal(tokens(), ENV.STRAVA_COOKIE_KEY)
    const res2 = await handle(req('/api/strava?action=disconnect', { method: 'POST', cookies: `kr_strava=${fresh}` }), ENV, () => NOW, refused.fetcher)
    expect(await res2.json()).toEqual({ connected: false, revoked: false })
    expect(res2.headers.get('set-cookie')).toContain('kr_strava=; ')
  })

  it('disconnect takes POST only, tells Strava, and clears the cookie', async () => {
    const sealed = await seal(tokens(), ENV.STRAVA_COOKIE_KEY)
    const { fetcher, calls } = fakeStrava({ 'https://www.strava.com/oauth/deauthorize': () => new Response('{}') })
    expect((await handle(req('/api/strava?action=disconnect', { cookies: `kr_strava=${sealed}` }), ENV, () => NOW, fetcher)).status).toBe(405)
    const res = await handle(req('/api/strava?action=disconnect', { method: 'POST', cookies: `kr_strava=${sealed}` }), ENV, () => NOW, fetcher)
    expect(await res.json()).toEqual({ connected: false, revoked: true })
    expect(res.headers.get('set-cookie')).toContain('kr_strava=; ')
    expect(calls).toHaveLength(1)
  })
})

describe('with accounts (M-U2)', () => {
  const ACC: FunctionEnv = { ...ENV, DATABASE_URL: 'postgres://unused', AUTH_COOKIE_KEY: 'c'.repeat(40), AUTH_CODE_PEPPER: 'p'.repeat(40) }
  const ORIGIN = 'https://knee-rebuild.vercel.app'
  let db: TestDb
  const getDb = () => Promise.resolve<Db>(db)
  const noDb = () => Promise.reject(new Error('the database was asked for'))
  beforeAll(async () => {
    db = await testDb()
  })
  afterAll(async () => {
    await db.close()
  })
  beforeEach(async () => {
    await db.reset()
    await mintAccount(db, { id: 't1', name: 'Alex', role: 'tester', hash: 'a'.repeat(64), at: NOW - 100 })
  })
  /** req() replaces the headers; this one takes them. */
  const reqH = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) => new Request(`${ORIGIN}${path}`, init)
  const signedIn = async (sub = 't1', env: FunctionEnv = ACC) => `kr_session=${await sealSession(sub, env, NOW)}`
  const run = (r: Request, env: FunctionEnv = ACC, fetcher: typeof fetch = fakeStrava({}).fetcher, d: () => Promise<Db> = getDb) => handle(r, env, () => NOW, fetcher, d)

  it('signed out: status, activities and disconnect need an account, and connect goes back to say so', async () => {
    for (const path of ['/api/strava?action=status', '/api/strava?action=activities&after=0']) {
      const res = await run(reqH(path), ACC, fakeStrava({}).fetcher, noDb)
      expect(res.status, path).toBe(401)
      expect(await res.json(), path).toEqual({ error: 'Sign in on this phone first: Settings, Account.', account: 'required' })
    }
    expect((await run(reqH('/api/strava?action=disconnect', { method: 'POST', headers: { origin: ORIGIN } }))).status).toBe(401)
    const connect = await run(reqH('/api/strava?action=connect'))
    expect(connect.status).toBe(302)
    expect(connect.headers.get('location')).toBe('/#/strava?result=account')
  })

  it('a bad session cookie on connect is cleared on the way back', async () => {
    const res = await run(reqH('/api/strava?action=connect', { headers: { cookie: 'kr_session=junk' } }))
    expect(res.headers.get('location')).toBe('/#/strava?result=account')
    expect(res.headers.getSetCookie()).toEqual(['kr_session=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0'])
  })

  it('signed in: status answers as before', async () => {
    const res = await run(reqH('/api/strava?action=status', { headers: { cookie: await signedIn() } }))
    expect(await res.json()).toEqual({ configured: true, connected: false })
  })

  it('a revoked account, or one from before a generation bump, is refused', async () => {
    const c = await signedIn()
    await revokeAccount(db, 't1', NOW)
    const revoked = await run(reqH('/api/strava?action=status', { headers: { cookie: c } }))
    expect(revoked.status).toBe(401)
    // A readable session is left for redeem to see who held this context (the Strava hand-over rule).
    expect(revoked.headers.getSetCookie()).toEqual([])
    const stale = await run(reqH('/api/strava?action=status', { headers: { cookie: await signedIn() } }), { ...ACC, AUTH_KEY_GENERATION: '2' }, fakeStrava({}).fetcher, noDb)
    expect(stale.status).toBe(401)
  })

  it('half set (no pepper): every action fails closed with a 503, the callback included', async () => {
    const broken = { ...ACC, AUTH_CODE_PEPPER: '' }
    const res = await run(reqH('/api/strava?action=status', { headers: { cookie: await signedIn() } }), broken, fakeStrava({}).fetcher, noDb)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Accounts are half set up on this deployment.', account: 'setup' })
    expect((await run(reqH('/api/strava?action=connect'), broken, fakeStrava({}).fetcher, noDb)).headers.get('location')).toBe('/#/strava?result=account-setup')
    const { fetcher, calls } = fakeStrava({ 'https://www.strava.com/oauth/token': tokenResponse(tokens()) })
    const cb = await run(reqH('/api/strava?action=callback&state=s1&code=c&scope=activity:read_all', { headers: { cookie: 'kr_strava_state=s1' } }), broken, fetcher, noDb)
    expect(cb.headers.get('location')).toBe('/#/strava?result=account-setup')
    expect(calls).toHaveLength(0)
  })

  it('a database that fails: a 503 for calls, and connect goes back saying so', async () => {
    const failing = () => Promise.reject(new Error('postgres://u:pw@ep-hidden.neon.tech down'))
    const res = await run(reqH('/api/strava?action=status', { headers: { cookie: await signedIn() } }), ACC, fakeStrava({}).fetcher, failing)
    expect(res.status).toBe(503)
    expect(await res.text()).not.toMatch(/neon|postgres/)
    const connect = await run(reqH('/api/strava?action=connect', { headers: { cookie: await signedIn() } }), ACC, fakeStrava({}).fetcher, failing)
    expect(connect.headers.get('location')).toBe('/#/strava?result=unavailable')
  })

  it('Strava not set up, accounts on: signed out needs an account; signed in hears it isn’t set up', async () => {
    const noStrava = { DATABASE_URL: ACC.DATABASE_URL, AUTH_COOKIE_KEY: ACC.AUTH_COOKIE_KEY, AUTH_CODE_PEPPER: ACC.AUTH_CODE_PEPPER }
    expect((await run(reqH('/api/strava?action=status'), noStrava, fakeStrava({}).fetcher, noDb)).status).toBe(401)
    expect(await (await run(reqH('/api/strava?action=status', { headers: { cookie: await signedIn() } }), noStrava)).json()).toEqual({ configured: false, connected: false })
  })

  it('connect seals the account into the state cookie, and the callback connects on it alone, with no session cookie', async () => {
    const res = await run(reqH('/api/strava?action=connect', { headers: { cookie: await signedIn() } }))
    const state = new URL(res.headers.get('location') ?? '').searchParams.get('state') ?? ''
    const set = res.headers.getSetCookie().find((c) => c.startsWith('kr_strava_state=')) ?? ''
    expect(set).toMatch(/; SameSite=Lax; Max-Age=600$/)
    expect(state.length).toBeGreaterThan(10)
    expect(set).not.toContain(state)
    const sealed = set.split(';')[0] ?? ''
    const { fetcher } = fakeStrava({ 'https://www.strava.com/oauth/token': tokenResponse(tokens()) })
    const cb = await run(reqH(`/api/strava?action=callback&state=${state}&code=c&scope=activity:read_all`, { headers: { cookie: sealed } }), ACC, fetcher)
    expect(cb.headers.get('location')).toBe('/#/strava?result=connected')
    expect(cb.headers.getSetCookie().some((c) => c.startsWith('kr_strava=') && !c.startsWith('kr_strava=;'))).toBe(true)
  })

  it('the callback refuses a plain state, an old one, one from before a generation bump, and a revoked account, without calling Strava', async () => {
    const { fetcher, calls } = fakeStrava({ 'https://www.strava.com/oauth/token': tokenResponse(tokens()) })
    const back = async (cookieHeader: string, state: string, env = ACC, at = NOW) =>
      (await handle(reqH(`/api/strava?action=callback&state=${state}&code=c&scope=activity:read_all`, { headers: { cookie: cookieHeader } }), env, () => at, fetcher, getDb)).headers.get('location')
    expect(await back('kr_strava_state=s1', 's1')).toBe('/#/strava?result=state')
    const res = await run(reqH('/api/strava?action=connect', { headers: { cookie: await signedIn() } }))
    const state = new URL(res.headers.get('location') ?? '').searchParams.get('state') ?? ''
    const sealed = (res.headers.getSetCookie().find((c) => c.startsWith('kr_strava_state=')) ?? '').split(';')[0] ?? ''
    expect(await back(sealed, 'other')).toBe('/#/strava?result=state')
    expect(await back(sealed, state, ACC, NOW + 601)).toBe('/#/strava?result=state')
    expect(await back(sealed, state, { ...ACC, AUTH_KEY_GENERATION: '2' })).toBe('/#/strava?result=account')
    await revokeAccount(db, 't1', NOW)
    expect(await back(sealed, state)).toBe('/#/strava?result=account')
    expect(calls).toHaveLength(0)
  })

  it('the callback refuses a sealed state whose time isn’t a number, or is more than five minutes ahead, without calling Strava', async () => {
    const { fetcher, calls } = fakeStrava({ 'https://www.strava.com/oauth/token': tokenResponse(tokens()) })
    const forged = async (iat: unknown) => `kr_strava_state=${await seal({ k: 'strava-state', state: 's1', sub: 't1', iat, gen: 1 }, ACC.AUTH_COOKIE_KEY!, 'kr-strava-state')}`
    const back = async (cookieHeader: string) => (await run(reqH('/api/strava?action=callback&state=s1&code=c&scope=activity:read_all', { headers: { cookie: cookieHeader } }), ACC, fetcher)).headers.get('location')
    expect(await back(await forged(String(NOW)))).toBe('/#/strava?result=state')
    expect(await back(await forged(NOW + 301))).toBe('/#/strava?result=state')
    expect(calls).toHaveLength(0)
    // The edge itself still connects: five minutes of clock skew are allowed.
    expect(await back(await forged(NOW + 300))).toBe('/#/strava?result=connected')
  })

  it('disconnect takes a same-origin request only', async () => {
    const c = await signedIn()
    const sealedTokens = await seal(tokens(), ENV.STRAVA_COOKIE_KEY)
    const { fetcher } = fakeStrava({ 'https://www.strava.com/oauth/deauthorize': () => new Response('{}') })
    const evil = await run(reqH('/api/strava?action=disconnect', { method: 'POST', headers: { origin: 'https://evil.example', cookie: `${c}; kr_strava=${sealedTokens}` } }), ACC, fetcher)
    expect(evil.status).toBe(403)
    const ok = await run(reqH('/api/strava?action=disconnect', { method: 'POST', headers: { origin: ORIGIN, cookie: `${c}; kr_strava=${sealedTokens}` } }), ACC, fetcher)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ connected: false, revoked: true })
  })

  it('a phone’s existing Strava cookie, sealed before accounts, still opens once signed in, and is bound to that account from then on', async () => {
    const sealedTokens = await seal(tokens(), ENV.STRAVA_COOKIE_KEY)
    const res = await run(reqH('/api/strava?action=status', { headers: { cookie: `${await signedIn()}; kr_strava=${sealedTokens}` } }))
    expect(await res.json()).toEqual({ configured: true, connected: true })
    const rebound = stravaValue(res)
    expect(await unseal(rebound, ENV.STRAVA_COOKIE_KEY)).toEqual({ k: 'strava', sub: 't1', tokens: tokens() })
    await mintAccount(db, { id: 't2', name: 'Sam', role: 'tester', hash: 'b'.repeat(64), at: NOW - 100 })
    const other = await run(reqH('/api/strava?action=status', { headers: { cookie: `${await signedIn('t2')}; kr_strava=${rebound}` } }))
    expect(await other.json()).toEqual({ configured: true, connected: false })
  })

  /** The kr_strava value a response sets ('' for a clear, undefined for none). */
  const stravaValue = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith('kr_strava='))?.split(';')[0]?.slice('kr_strava='.length)

  it('the callback binds the tokens to the account in the state cookie', async () => {
    const res = await run(reqH('/api/strava?action=connect', { headers: { cookie: await signedIn() } }))
    const state = new URL(res.headers.get('location') ?? '').searchParams.get('state') ?? ''
    const sealed = (res.headers.getSetCookie().find((c) => c.startsWith('kr_strava_state=')) ?? '').split(';')[0] ?? ''
    const { fetcher } = fakeStrava({ 'https://www.strava.com/oauth/token': tokenResponse(tokens()) })
    const cb = await run(reqH(`/api/strava?action=callback&state=${state}&code=c&scope=activity:read_all`, { headers: { cookie: sealed } }), ACC, fetcher)
    expect(await unseal(stravaValue(cb), ENV.STRAVA_COOKIE_KEY)).toEqual({ k: 'strava', sub: 't1', tokens: tokens() })
  })

  it('another account’s Strava cookie reads not connected and is cleared: status, activities and disconnect never use its tokens', async () => {
    await mintAccount(db, { id: 't2', name: 'Sam', role: 'tester', hash: 'b'.repeat(64), at: NOW - 100 })
    const alexs = await seal({ k: 'strava', sub: 't1', tokens: tokens() }, ENV.STRAVA_COOKIE_KEY)
    const sam = `${await signedIn('t2')}; kr_strava=${alexs}`
    const { fetcher, calls } = fakeStrava({ 'https://www.strava.com/': () => new Response('[]') })
    const status = await run(reqH('/api/strava?action=status', { headers: { cookie: sam } }), ACC, fetcher)
    expect(await status.json()).toEqual({ configured: true, connected: false })
    expect(stravaValue(status)).toBe('')
    const activities = await run(reqH('/api/strava?action=activities&after=0', { headers: { cookie: sam } }), ACC, fetcher)
    expect(activities.status).toBe(401)
    expect(stravaValue(activities)).toBe('')
    const disconnect = await run(reqH('/api/strava?action=disconnect', { method: 'POST', headers: { origin: ORIGIN, cookie: sam } }), ACC, fetcher)
    expect(await disconnect.json()).toEqual({ connected: false, revoked: false })
    expect(stravaValue(disconnect)).toBe('')
    expect(calls).toHaveLength(0)
    // Its own account still reads it.
    expect(await (await run(reqH('/api/strava?action=status', { headers: { cookie: `${await signedIn('t1')}; kr_strava=${alexs}` } }), ACC, fetcher)).json()).toEqual({ configured: true, connected: true })
  })

  describe('one browsing context, end to end through both functions', () => {
    const TESTER = (body: string) => body + checkSymbol(body)
    const A_CODE = TESTER('7K3MQ9X2T4HB8RD')
    const B_CODE = TESTER('1A2B3C4D5E6F7G8')
    /** A cookie jar: applies each answer's Set-Cookie, sends what it holds. */
    function context() {
      const jar = new Map<string, string>()
      return {
        header: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        take(res: Response) {
          for (const c of res.headers.getSetCookie()) {
            const [pair = '', ...attrs] = c.split(';')
            const [name = '', ...value] = pair.split('=')
            if (attrs.some((a) => a.trim() === 'Max-Age=0')) jar.delete(name)
            else jar.set(name, value.join('='))
          }
          return res
        },
        has: (name: string) => jar.has(name),
      }
    }
    const auth = async (ctx: ReturnType<typeof context>, action: string, body?: unknown, env: FunctionEnv = ACC) => {
      const init: RequestInit =
        body === undefined
          ? { headers: { cookie: ctx.header() } }
          : { method: 'POST', headers: { cookie: ctx.header(), origin: ORIGIN, 'content-type': 'application/json', 'x-real-ip': '203.0.113.9' }, body: JSON.stringify(body) }
      return ctx.take(await authHandle(new Request(`${ORIGIN}/api/auth?action=${action}`, init), env, () => NOW, getDb))
    }
    const strava = async (ctx: ReturnType<typeof context>, path: string, env: FunctionEnv = ACC, fetcher = fakeStrava({ 'https://www.strava.com/api/v3/athlete/activities': () => new Response('[{"id":1}]') }).fetcher) =>
      ctx.take(await run(reqH(path, { headers: { cookie: ctx.header() } }), env, fetcher))

    async function connected(ctx: ReturnType<typeof context>) {
      const connect = await strava(ctx, '/api/strava?action=connect')
      const state = new URL(connect.headers.get('location') ?? '').searchParams.get('state') ?? ''
      const { fetcher } = fakeStrava({ 'https://www.strava.com/oauth/token': tokenResponse(tokens()) })
      await strava(ctx, `/api/strava?action=callback&state=${state}&code=c&scope=activity:read_all`, ACC, fetcher)
      expect(await (await strava(ctx, '/api/strava?action=status')).json()).toEqual({ configured: true, connected: true })
    }

    beforeEach(async () => {
      await db.reset()
      await mintAccount(db, { id: 'a', name: 'Alex', role: 'tester', hash: await hashCode(ACC.AUTH_CODE_PEPPER!, A_CODE), at: NOW - 100 })
      await mintAccount(db, { id: 'b', name: 'Sam', role: 'tester', hash: await hashCode(ACC.AUTH_CODE_PEPPER!, B_CODE), at: NOW - 100 })
    })

    it('A is revoked, Settings asks me, then B redeems: B never sees A’s Strava', async () => {
      const ctx = context()
      expect((await auth(ctx, 'redeem', { code: A_CODE })).status).toBe(200)
      await connected(ctx)
      await revokeAccount(db, 'a', NOW)
      expect(await (await auth(ctx, 'me')).json()).toEqual({ configured: true, signedIn: false })
      expect((await auth(ctx, 'redeem', { code: B_CODE })).status).toBe(200)
      expect(ctx.has('kr_strava')).toBe(false)
      expect(await (await strava(ctx, '/api/strava?action=status')).json()).toEqual({ configured: true, connected: false })
      expect((await strava(ctx, '/api/strava?action=activities&after=0')).status).toBe(401)
    })

    it('a generation bump, then a gated call, then B redeems: B never sees A’s Strava', async () => {
      const ctx = context()
      await auth(ctx, 'redeem', { code: A_CODE })
      await connected(ctx)
      const bumped = { ...ACC, AUTH_KEY_GENERATION: '2' }
      expect((await strava(ctx, '/api/strava?action=status', bumped)).status).toBe(401)
      expect((await auth(ctx, 'redeem', { code: B_CODE }, bumped)).status).toBe(200)
      expect(await (await strava(ctx, '/api/strava?action=status', bumped)).json()).toEqual({ configured: true, connected: false })
    })

    it('a generation bump, then the same account redeems again: its Strava connection stays', async () => {
      const ctx = context()
      await auth(ctx, 'redeem', { code: A_CODE })
      await connected(ctx)
      const bumped = { ...ACC, AUTH_KEY_GENERATION: '2' }
      expect(await (await auth(ctx, 'me', undefined, bumped)).json()).toEqual({ configured: true, signedIn: false })
      await auth(ctx, 'redeem', { code: A_CODE }, bumped)
      expect(await (await strava(ctx, '/api/strava?action=status', bumped)).json()).toEqual({ configured: true, connected: true })
    })
  })
})
