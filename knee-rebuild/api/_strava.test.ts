import { describe, expect, it } from 'vitest'
import { authorizeUrl, configured, cookie, fresh, handle, readCookie, scopeGranted, seal, trim, unseal, type Env, type Tokens } from './strava.ts'

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
