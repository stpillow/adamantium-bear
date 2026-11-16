import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PEPPER_CHECK_KEY, accountById, findByCodeHash, listAccounts, mintAccount, readMeta, recordAttempt, revokeAccount, type Db, type MakeSql, liveDb, forgetLiveDb } from './_accounts.ts'
import { checkSymbol, formatCode, hashCode, pepperCheck } from './_code.ts'
import { PER_CLIENT_LIMIT, handle } from './auth.ts'
import { seal, sealSession, unseal, type AuthEnv } from './_session.ts'
import { testDb, type TestDb } from './_testDb.ts'

const NOW = 1_800_000_000
const ORIGIN = 'https://knee-rebuild.vercel.app'
const ENV: AuthEnv = { DATABASE_URL: 'postgres://user:dbsecret@ep-hidden.neon.tech/db', AUTH_COOKIE_KEY: 'c'.repeat(40), AUTH_CODE_PEPPER: 'p'.repeat(40) }
const code = (body: string) => body + checkSymbol(body)
const TESTER = code('7K3MQ9X2T4HB8RD')
const OTHER = code('1A2B3C4D5E6F7G8')
const BOOT = code('BQ7TZ2M9KXR4HNP')
const IP = '203.0.113.9'

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
})

type Opts = { method?: string; cookie?: string; headers?: Record<string, string>; body?: string; ip?: string }
function request(action: string, o: Opts = {}): Request {
  const headers: Record<string, string> = { 'x-real-ip': o.ip ?? IP, ...o.headers }
  if (o.cookie) headers.cookie = o.cookie
  return new Request(`${ORIGIN}/api/auth?action=${action}`, { method: o.method ?? 'GET', headers, body: o.body })
}
const post = (action: string, body: unknown, o: Opts = {}) =>
  request(action, { method: 'POST', body: JSON.stringify(body), ...o, headers: { origin: ORIGIN, 'content-type': 'application/json', ...o.headers } })
const call = (r: Request, env = ENV, at = NOW, d: () => Promise<Db> = getDb) => handle(r, env, () => at, d)
const redeem = (c: string, o: Opts = {}, env = ENV, at = NOW) => call(post('redeem', { code: c }, o), env, at)
const sessionOf = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith('kr_session='))
const jar = (res: Response) => sessionOf(res)?.split(';')[0] ?? ''

async function addTester(id = 't1', c = TESTER, name = 'Alex') {
  await mintAccount(db, { id, name, role: 'tester', hash: await hashCode(ENV.AUTH_CODE_PEPPER!, c), at: NOW - 1000 })
}

describe('me', () => {
  it('off: not configured, without the database', async () => {
    const res = await call(request('me'), {}, NOW, noDb)
    expect(await res.json()).toEqual({ configured: false })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
  it('broken: configured, signed out, the problem named', async () => {
    expect(await (await call(request('me'), { ...ENV, AUTH_CODE_PEPPER: 'short' }, NOW, noDb)).json()).toEqual({ configured: true, signedIn: false, problem: 'setup' })
  })
  it('on, with no cookie: signed out, without the database', async () => {
    const res = await call(request('me'), ENV, NOW, noDb)
    expect(await res.json()).toEqual({ configured: true, signedIn: false })
    expect(res.headers.getSetCookie()).toEqual([])
  })
  it('on, signed in: the name and role', async () => {
    await addTester()
    const res = await call(request('me', { cookie: `kr_session=${await sealSession('t1', ENV, NOW)}` }))
    expect(await res.json()).toEqual({ configured: true, signedIn: true, name: 'Alex', role: 'tester' })
    expect(res.headers.getSetCookie()).toEqual([])
  })
  it('takes GET only', async () => {
    expect((await call(request('me', { method: 'POST' }))).status).toBe(405)
  })
  it('re-issues a session older than 30 days, so a phone in use stays signed in', async () => {
    await addTester()
    const res = await call(request('me', { cookie: `kr_session=${await sealSession('t1', ENV, NOW - 31 * 86400)}` }))
    const renewed = sessionOf(res)
    expect(renewed).toBeDefined()
    expect(await unseal(renewed!.split(';')[0]!.slice('kr_session='.length), ENV.AUTH_COOKIE_KEY!, 'kr-session-v1')).toEqual({ k: 's', sub: 't1', iat: NOW, gen: 1 })
    const young = await call(request('me', { cookie: `kr_session=${await sealSession('t1', ENV, NOW - 29 * 86400)}` }))
    expect(young.headers.getSetCookie()).toEqual([])
  })
  it('a generation bump reads signed out, and leaves the readable cookie for redeem to see whose it was', async () => {
    await addTester()
    const res = await call(request('me', { cookie: `kr_session=${await sealSession('t1', ENV, NOW)}` }), { ...ENV, AUTH_KEY_GENERATION: '2' }, NOW, noDb)
    expect(await res.json()).toEqual({ configured: true, signedIn: false })
    expect(res.headers.getSetCookie()).toEqual([])
  })
  it('an unreadable cookie reads signed out and is cleared', async () => {
    const res = await call(request('me', { cookie: 'kr_session=junk' }), ENV, NOW, noDb)
    expect(await res.json()).toEqual({ configured: true, signedIn: false })
    expect(res.headers.getSetCookie()).toEqual(['kr_session=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0'])
  })
  it('a database that fails is a 503 that names nothing of it', async () => {
    const failing = () => Promise.reject(new Error(`could not reach ${ENV.DATABASE_URL}`))
    const res = await call(request('me', { cookie: `kr_session=${await sealSession('t1', ENV, NOW)}` }), ENV, NOW, failing)
    expect(res.status).toBe(503)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: 'Accounts can’t be checked right now. Try again in a minute.', problem: 'unavailable' })
    expect(text).not.toMatch(/neon|postgres|dbsecret/)
  })
})

describe('redeem', () => {
  it('signs a context in with a Strict session cookie, and the database never holds the code', async () => {
    await addTester()
    const res = await redeem(formatCode(TESTER))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ configured: true, signedIn: true, name: 'Alex', role: 'tester' })
    expect(sessionOf(res)).toMatch(/^kr_session=[\w-]+\.[\w-]+; Path=\/api; HttpOnly; Secure; SameSite=Strict; Max-Age=34560000$/)
    expect(res.headers.get('location')).toBeNull()
    const [row] = await listAccounts(db)
    expect(JSON.stringify(await db.query('SELECT * FROM accounts'))).not.toContain(TESTER)
    expect(row?.last_seen).toBe(NOW)
    expect(await readMeta(db, PEPPER_CHECK_KEY)).toBe(await pepperCheck(ENV.AUTH_CODE_PEPPER!))
  })

  it('binds to the tester, not the context: the same code in two cookie jars is the same account', async () => {
    await addTester()
    const safari = await redeem(TESTER.toLowerCase())
    const homeScreen = await redeem(formatCode(TESTER), { ip: '198.51.100.4' })
    const a = await unseal<{ sub: string }>(jar(safari).slice('kr_session='.length), ENV.AUTH_COOKIE_KEY!, 'kr-session-v1')
    const b = await unseal<{ sub: string }>(jar(homeScreen).slice('kr_session='.length), ENV.AUTH_COOKIE_KEY!, 'kr-session-v1')
    expect(a?.sub).toBe('t1')
    expect(b?.sub).toBe('t1')
    expect(jar(safari)).not.toBe(jar(homeScreen))
    for (const c of [jar(safari), jar(homeScreen)]) expect(await (await call(request('me', { cookie: c }))).json()).toEqual({ configured: true, signedIn: true, name: 'Alex', role: 'tester' })
  })

  it('a revoked account’s code redeems nothing, and its live session reads signed out', async () => {
    await addTester()
    const live = jar(await redeem(TESTER))
    await revokeAccount(db, 't1', NOW + 1)
    expect((await redeem(TESTER, {}, ENV, NOW + 2)).status).toBe(401)
    const res = await call(request('me', { cookie: live }), ENV, NOW + 3)
    expect(await res.json()).toEqual({ configured: true, signedIn: false })
    expect(res.headers.getSetCookie()).toEqual([])
  })

  it('says the same words whether a code is unknown, revoked, mistyped or a closed bootstrap code', async () => {
    await addTester()
    await addTester('t2', OTHER, 'Sam')
    await revokeAccount(db, 't2', NOW)
    await mintAccount(db, { id: 'adm', name: 'Shawn', role: 'admin', hash: '0'.repeat(64), at: NOW })
    const env = { ...ENV, AUTH_BOOTSTRAP_CODE: BOOT }
    const typo = TESTER.slice(0, 3) + (TESTER[3] === 'A' ? 'B' : 'A') + TESTER.slice(4)
    const bodies = []
    for (const c of [code('ZZZZZZZZZZZZZZZ'), OTHER, typo, BOOT, 'not a code']) {
      const res = await redeem(c, {}, env)
      expect(res.status, c).toBe(401)
      expect(res.headers.getSetCookie(), c).toEqual([])
      bodies.push(await res.json())
    }
    for (const b of bodies) expect(b).toEqual({ error: 'That code didn’t work. Check it and try again.' })
  })

  it('refuses another origin, a missing origin from another site, and a body that isn’t JSON, before the database', async () => {
    const bad = async (o: Opts, status: number) => {
      const res = await call(post('redeem', { code: TESTER }, o), ENV, NOW, noDb)
      expect(res.status, JSON.stringify(o)).toBe(status)
      return res
    }
    expect(await (await bad({ headers: { origin: 'https://evil.example' } }, 403)).json()).toEqual({ error: 'This only works from inside the app.' })
    await bad({ headers: { origin: 'null' } }, 403)
    const noOrigin = new Request(`${ORIGIN}/api/auth?action=redeem`, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }, body: JSON.stringify({ code: TESTER }) })
    expect((await call(noOrigin, ENV, NOW, noDb)).status).toBe(403)
    await bad({ headers: { 'content-type': 'text/plain' } }, 415)
    await bad({ headers: { 'content-type': 'application/json-x' } }, 415)
    for (const body of ['not json', JSON.stringify({ code: 7 }), JSON.stringify({ code: 'x'.repeat(65) }), JSON.stringify({}), 'x'.repeat(1025)]) {
      expect((await call(request('redeem', { method: 'POST', body, headers: { origin: ORIGIN, 'content-type': 'application/json' } }), ENV, NOW, noDb)).status, body.slice(0, 20)).toBe(400)
    }
    expect((await call(request('redeem'), ENV, NOW, noDb)).status).toBe(405)
  })

  it('takes a same-origin request with no Origin header but Sec-Fetch-Site, and JSON with a charset', async () => {
    await addTester()
    const r = new Request(`${ORIGIN}/api/auth?action=redeem`, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json; charset=utf-8', 'x-real-ip': IP }, body: JSON.stringify({ code: TESTER }) })
    expect((await call(r)).status).toBe(200)
  })

  it('answers when accounts are off or half set, without the database', async () => {
    const off = await call(post('redeem', { code: TESTER }), {}, NOW, noDb)
    expect(off.status).toBe(503)
    expect(await off.json()).toEqual({ configured: false, error: 'Accounts aren’t set up on this deployment.' })
    const broken = await call(post('redeem', { code: TESTER }), { ...ENV, AUTH_KEY_GENERATION: 'x' }, NOW, noDb)
    expect(broken.status).toBe(503)
    expect(((await broken.json()) as { problem: string }).problem).toBe('setup')
  })

  it('limits each client to 10 tries in 15 minutes, counting successes, and leaves another client alone', async () => {
    // The count now includes the attempt being made, so the test is mine > 10 where it was mine >= 10 before recording:
    // the same 10th try passes and the same 11th is refused.
    await addTester()
    for (let i = 0; i < 9; i++) expect((await redeem(code('ZZZZZZZZZZZZZZZ'))).status).toBe(401)
    expect((await redeem(TESTER)).status).toBe(200)
    const eleventh = await redeem(TESTER)
    expect(eleventh.status).toBe(429)
    expect(eleventh.headers.get('retry-after')).toBe('900')
    expect(await eleventh.json()).toEqual({ error: 'Too many tries. Wait 15 minutes, then try again.' })
    expect((await redeem(TESTER, { ip: '198.51.100.4' })).status).toBe(200)
    // A client at its limit adds no rows: 11 from the first client, 1 from the second.
    expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM auth_attempts'))[0]?.n).toBe(11)
    for (let i = 0; i < 20; i++) expect((await redeem(TESTER)).status).toBe(429)
    expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM auth_attempts'))[0]?.n).toBe(11)
    expect((await redeem(TESTER, {}, ENV, NOW + 15 * 60 + 1)).status).toBe(200)
  })

  it('holds under concurrency: 60 redeems at once from one client, each statement slowed, get at most 10 past the limiter', async () => {
    await addTester()
    // Every statement waits a little first, so 60 redeems interleave statement by statement, as on Neon.
    const slow: Db = { query: async (text, params) => (await new Promise((r) => setTimeout(r, 2)), db.query(text, params)) }
    const results = await Promise.all(
      Array.from({ length: 60 }, (_, i) => handle(post('redeem', { code: i % 2 ? TESTER : code('ZZZZZZZZZZZZZZZ') }), ENV, () => NOW, () => Promise.resolve(slow))),
    )
    const past = results.filter((r) => r.status !== 429).length
    expect(past).toBeLessThanOrEqual(PER_CLIENT_LIMIT)
    expect(results.every((r) => [200, 401, 429].includes(r.status))).toBe(true)
    // A refused try takes its row back, so what is left is exactly the tries that got past.
    expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM auth_attempts'))[0]?.n).toBe(past)
    // So the client is not locked out beyond its limit: below it, the next try in the window still gets through.
    if (past < PER_CLIENT_LIMIT) expect((await redeem(TESTER)).status).toBe(200)
  })

  it('keys an IPv6 client by its /64', async () => {
    await addTester()
    for (let i = 0; i < 10; i++) await redeem(code('ZZZZZZZZZZZZZZZ'), { ip: `2001:db8:1:2::${i + 1}` })
    expect((await redeem(TESTER, { ip: '2001:db8:1:2:abcd::99' })).status).toBe(429)
    expect((await redeem(TESTER, { ip: '2001:db8:1:3::1' })).status).toBe(200)
  })

  it('stops everyone at 200 tries in 15 minutes', async () => {
    // As above, everyone > 200 counting this attempt: the 200th try passes and the 201st is refused, as before.
    await addTester()
    for (let i = 0; i < 199; i++) await recordAttempt(db, `someone-${i % 20}`, NOW - 60)
    expect((await redeem(TESTER)).status).toBe(200)
    expect((await redeem(TESTER, { ip: '198.51.100.4' })).status).toBe(429)
    expect((await redeem(TESTER, { ip: '198.51.100.4' }, ENV, NOW + 15 * 60)).status).toBe(200)
  })

  it('a database that fails is a 503 that names nothing of it, and a broken driver never escapes as a 500', async () => {
    forgetLiveDb()
    const make: MakeSql = () => {
      throw new Error(`bad url ${ENV.DATABASE_URL}`)
    }
    const res = await call(post('redeem', { code: TESTER }), ENV, NOW, () => liveDb(ENV.DATABASE_URL!, make))
    expect(res.status).toBe(503)
    const text = await res.text()
    expect(text).not.toMatch(/neon|postgres|dbsecret|ep-hidden/)
    expect(JSON.parse(text)).toEqual({ error: 'Accounts can’t be checked right now. Try again in a minute.', problem: 'unavailable' })
    forgetLiveDb()
  })

  it('a different account taking over a context forgets the Strava cookie; the same account or a first sign-in keeps it', async () => {
    await addTester()
    await addTester('t2', OTHER, 'Sam')
    const strava = 'kr_strava=sealed.tokens'
    const first = await redeem(TESTER, { cookie: strava })
    expect(first.headers.getSetCookie().some((c) => c.startsWith('kr_strava='))).toBe(false)
    const again = await redeem(TESTER, { cookie: `${jar(first)}; ${strava}` })
    expect(again.headers.getSetCookie().some((c) => c.startsWith('kr_strava='))).toBe(false)
    const takeover = await redeem(OTHER, { cookie: `${jar(first)}; ${strava}` })
    expect(takeover.headers.getSetCookie()).toContain('kr_strava=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0')
  })

  it('the app’s real order: me drops a revoked or stale session, then a different account redeems, and the Strava cookie still goes', async () => {
    await addTester()
    await addTester('t2', OTHER, 'Sam')
    const strava = 'kr_strava=sealed.tokens'
    /** What the context holds after an answer: its session cookie unless the answer cleared it. */
    const after = (res: Response, held: string) => (res.headers.getSetCookie().some((c) => c.startsWith('kr_session=;')) ? '' : held)
    const clearsStrava = (res: Response) => res.headers.getSetCookie().includes('kr_strava=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0')

    const alex = jar(await redeem(TESTER))
    await revokeAccount(db, 't1', NOW + 1)
    const held = after(await call(request('me', { cookie: `${alex}; ${strava}` }), ENV, NOW + 2), alex)
    expect(clearsStrava(await redeem(OTHER, { cookie: [held, strava].filter(Boolean).join('; ') }, ENV, NOW + 3))).toBe(true)

    await db.reset()
    await addTester()
    await addTester('t2', OTHER, 'Sam')
    const bumped = { ...ENV, AUTH_KEY_GENERATION: '2' }
    const alex2 = jar(await redeem(TESTER))
    const held2 = after(await call(request('me', { cookie: `${alex2}; ${strava}` }), bumped, NOW + 2), alex2)
    expect(clearsStrava(await redeem(OTHER, { cookie: [held2, strava].filter(Boolean).join('; ') }, bumped, NOW + 3))).toBe(true)
  })
})

describe('the bootstrap code', () => {
  const env = { ...ENV, AUTH_BOOTSTRAP_CODE: formatCode(BOOT), AUTH_BOOTSTRAP_NAME: '  Shawn  ' }

  it('creates the admin only while none exists, and then works as the admin’s own code in a second context', async () => {
    const res = await redeem(BOOT, {}, env)
    expect(await res.json()).toEqual({ configured: true, signedIn: true, name: 'Shawn', role: 'admin' })
    const second = await redeem(BOOT.toLowerCase(), { ip: '198.51.100.4' }, { ...ENV })
    expect(await second.json()).toEqual({ configured: true, signedIn: true, name: 'Shawn', role: 'admin' })
    expect((await listAccounts(db)).map((a) => [a.display_name, a.role])).toEqual([['Shawn', 'admin']])
    expect((await findByCodeHash(db, await hashCode(ENV.AUTH_CODE_PEPPER!, BOOT)))?.role).toBe('admin')
  })

  it('is idempotent: the same code twice, or at once, makes one admin', async () => {
    await Promise.all([redeem(BOOT, {}, env), redeem(BOOT, { ip: '198.51.100.4' }, env)])
    await redeem(BOOT, {}, env)
    expect((await listAccounts(db)).length).toBe(1)
  })

  it('cuts a name over 40 characters to 40, so a long AUTH_BOOTSTRAP_NAME still makes the admin', async () => {
    const long = 'S'.repeat(41)
    const res = await redeem(BOOT, {}, { ...ENV, AUTH_BOOTSTRAP_CODE: BOOT, AUTH_BOOTSTRAP_NAME: long })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ configured: true, signedIn: true, name: 'S'.repeat(40), role: 'admin' })
  })

  it('names the admin Admin when no name is set', async () => {
    expect(await (await redeem(BOOT, {}, { ...ENV, AUTH_BOOTSTRAP_CODE: BOOT })).json()).toEqual({ configured: true, signedIn: true, name: 'Admin', role: 'admin' })
  })

  it('once an admin exists, another bootstrap code is refused', async () => {
    await redeem(BOOT, {}, env)
    const res = await redeem(OTHER, {}, { ...env, AUTH_BOOTSTRAP_CODE: OTHER })
    expect(res.status).toBe(401)
    expect((await listAccounts(db)).length).toBe(1)
  })

  it('an unset or malformed bootstrap code creates nothing', async () => {
    expect((await redeem(BOOT, {}, ENV)).status).toBe(401)
    expect((await redeem(BOOT, {}, { ...ENV, AUTH_BOOTSTRAP_CODE: 'nonsense' })).status).toBe(401)
    expect(await listAccounts(db)).toEqual([])
  })
})

describe('sign-out', () => {
  const clears = ['kr_session=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0', 'kr_strava=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0']

  it('signs a live session out and forgets the Strava cookie', async () => {
    await addTester()
    const c = jar(await redeem(TESTER))
    const res = await call(post('sign-out', {}, { cookie: c }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ configured: true, signedIn: false })
    expect(res.headers.getSetCookie()).toEqual(clears)
  })

  it('clears both cookies whatever the gate says: no session, a revoked one, a failed database, accounts half set or off', async () => {
    await addTester()
    const c = jar(await redeem(TESTER))
    await revokeAccount(db, 't1', NOW + 1)
    const failing = () => Promise.reject(new Error('down'))
    for (const [label, res, status] of [
      ['none', await call(post('sign-out', {})), 401],
      ['revoked', await call(post('sign-out', {}, { cookie: c })), 401],
      ['unavailable', await call(post('sign-out', {}, { cookie: `kr_session=${await sealSession('t1', ENV, NOW)}` }), ENV, NOW, failing), 503],
      ['broken', await call(post('sign-out', {}), { ...ENV, AUTH_CODE_PEPPER: undefined }, NOW, noDb), 503],
      ['off', await call(post('sign-out', {}), {}, NOW, noDb), 200],
    ] as const) {
      expect(res.status, label).toBe(status)
      expect(res.headers.getSetCookie(), label).toEqual(clears)
    }
  })

  it('takes a same-origin JSON POST only', async () => {
    expect((await call(request('sign-out'))).status).toBe(405)
    expect((await call(post('sign-out', {}, { headers: { origin: 'https://evil.example' } }))).status).toBe(403)
    expect((await call(post('sign-out', {}, { headers: { 'content-type': 'text/plain' } }))).status).toBe(415)
  })
})

describe('what the function never says', () => {
  it('no secret, code or address in any body or header but a sealed cookie', async () => {
    const env = { ...ENV, AUTH_BOOTSTRAP_CODE: BOOT, AUTH_BOOTSTRAP_NAME: 'Shawn' }
    await addTester()
    const cookieOf = jar(await redeem(TESTER, {}, env))
    const responses = [
      await call(request('me', { cookie: cookieOf }), env),
      await redeem(TESTER, {}, env),
      await redeem(BOOT, {}, env),
      await redeem(code('ZZZZZZZZZZZZZZZ'), {}, env),
      await call(post('sign-out', {}, { cookie: cookieOf }), env),
      await call(request('nope'), env),
    ]
    for (const res of responses) {
      const text = await res.text()
      const headers = [...res.headers.entries()].filter(([k]) => k !== 'set-cookie').map(([k, v]) => `${k}: ${v}`).join('\n')
      for (const secret of [ENV.AUTH_COOKIE_KEY!, ENV.AUTH_CODE_PEPPER!, ENV.DATABASE_URL!, 'dbsecret', BOOT, TESTER, IP]) {
        expect(text, secret).not.toContain(secret)
        expect(headers, secret).not.toContain(secret)
      }
    }
    expect(await accountById(db, 't1')).not.toBeNull()
  })

  it('a Strava-sealed value under the same key is not a session', async () => {
    await addTester()
    const forged = await seal({ k: 's', sub: 't1', iat: NOW, gen: 1 }, ENV.AUTH_COOKIE_KEY!)
    expect(await (await call(request('me', { cookie: `kr_session=${forged}` }))).json()).toEqual({ configured: true, signedIn: false })
  })

  it('a tampered cookie is refused', async () => {
    await addTester()
    const good = await sealSession('t1', ENV, NOW)
    expect(await (await call(request('me', { cookie: `kr_session=${good.slice(0, -3)}AAA` }))).json()).toEqual({ configured: true, signedIn: false })
  })

  it('an unknown action is a 404', async () => {
    expect((await call(request('nope'))).status).toBe(404)
  })
})
