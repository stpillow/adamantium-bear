import { describe, expect, it } from 'vitest'
import { accountStatus, readAnswer, redeemCode, signOut, signOutSteps, type AccountIo } from './account.ts'

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>
const jsonRes = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const html = () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } })

/** A phone: its storage, whether it thinks it's online, and the app's own function answering by URL. */
function phone(routes: Record<string, Route>, opts: { online?: boolean; stored?: Record<string, string>; storageThrows?: boolean } = {}) {
  const store = new Map(Object.entries(opts.stored ?? {}))
  const calls: { url: string; init?: RequestInit }[] = []
  const io: AccountIo = {
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      const route = routes[url]
      if (!route) throw new TypeError('Load failed')
      return route(url, init)
    }) as typeof fetch,
    storage: () =>
      opts.storageThrows
        ? {
            getItem: () => {
              throw new Error('SecurityError')
            },
            setItem: () => {
              throw new Error('QuotaExceededError')
            },
          }
        : { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    online: () => opts.online ?? true,
  }
  return { io, calls, store }
}
const ME = '/api/auth?action=me'
const SIGNED_IN = { configured: true, signedIn: true, name: 'Alex', role: 'tester' }
const KEPT = { 'knee-rebuild:account': JSON.stringify(SIGNED_IN) }

describe('readAnswer', () => {
  it('reads only what the function sends', () => {
    expect(readAnswer(SIGNED_IN)).toEqual(SIGNED_IN)
    expect(readAnswer({ configured: false })).toEqual({ configured: false, signedIn: false })
    expect(readAnswer({ configured: true, signedIn: false, problem: 'setup' })).toEqual({ configured: true, signedIn: false, problem: 'setup' })
    expect(readAnswer({ configured: true, signedIn: true, name: 'A', role: 'owner' })).toBeNull()
    expect(readAnswer({ configured: true, signedIn: true, role: 'tester' })).toBeNull()
    expect(readAnswer('x')).toBeNull()
    expect(readAnswer({ error: 'x' })).toBeNull()
  })
  it('takes a name of 40 characters at most, the database’s own limit', () => {
    expect(readAnswer({ ...SIGNED_IN, name: 'n'.repeat(40) })).toEqual({ ...SIGNED_IN, name: 'n'.repeat(40) })
    expect(readAnswer({ ...SIGNED_IN, name: 'n'.repeat(41) })).toBeNull()
  })
})

describe('accountStatus', () => {
  it('asks the function, keeps its answer, and says it came from the server', async () => {
    const { io, calls, store } = phone({ [ME]: () => jsonRes(200, SIGNED_IN) })
    expect(await accountStatus(io)).toEqual({ answer: SIGNED_IN, from: 'server', online: true })
    expect(calls).toEqual([{ url: ME, init: { credentials: 'same-origin' } }])
    expect(JSON.parse(store.get('knee-rebuild:account') ?? 'null')).toEqual(SIGNED_IN)
  })

  it('offline: the kept answer, with no call made', async () => {
    const { io, calls } = phone({}, { online: false, stored: KEPT })
    expect(await accountStatus(io)).toEqual({ answer: SIGNED_IN, from: 'cache', online: false })
    expect(calls).toEqual([])
    expect(await accountStatus(phone({}, { online: false }).io)).toEqual({ answer: null, from: 'cache', online: false })
  })

  it('no function (a static preview answers HTML): what was kept, or nothing, never signed out', async () => {
    expect(await accountStatus(phone({ [ME]: html }).io)).toEqual({ answer: null, from: 'cache', online: true })
    const kept = phone({ [ME]: html }, { stored: KEPT })
    expect(await accountStatus(kept.io)).toEqual({ answer: SIGNED_IN, from: 'cache', online: true })
  })

  it('a failed fetch while the phone thinks it is online keeps the signed-in answer', async () => {
    const { io, store } = phone({}, { stored: KEPT })
    expect(await accountStatus(io)).toEqual({ answer: SIGNED_IN, from: 'cache', online: true })
    expect(JSON.parse(store.get('knee-rebuild:account') ?? 'null')).toEqual(SIGNED_IN)
  })

  it('passes a problem through without keeping it', async () => {
    const { io, store } = phone({ [ME]: () => jsonRes(503, { error: 'x', problem: 'unavailable' }) }, { stored: KEPT })
    // A 503 carries no `configured`, so it reads as no answer: the kept one shows.
    expect((await accountStatus(io)).answer).toEqual(SIGNED_IN)
    const setup = phone({ [ME]: () => jsonRes(200, { configured: true, signedIn: false, problem: 'setup' }) }, { stored: KEPT })
    expect((await accountStatus(setup.io)).answer).toEqual({ configured: true, signedIn: false, problem: 'setup' })
    expect(JSON.parse(setup.store.get('knee-rebuild:account') ?? 'null')).toEqual(SIGNED_IN)
    expect(store.size).toBe(1)
    const nothingKept = phone({ [ME]: () => jsonRes(503, { error: 'x', problem: 'unavailable' }) })
    expect(await accountStatus(nothingKept.io)).toEqual({ answer: { configured: true, signedIn: false, problem: 'unavailable' }, from: 'server', online: true })
    expect(nothingKept.store.size).toBe(0)
  })

  it('tolerates storage that throws', async () => {
    expect(await accountStatus(phone({ [ME]: () => jsonRes(200, SIGNED_IN) }, { storageThrows: true }).io)).toEqual({ answer: SIGNED_IN, from: 'server', online: true })
    expect(await accountStatus(phone({}, { online: false, storageThrows: true }).io)).toEqual({ answer: null, from: 'cache', online: false })
  })
})

describe('redeemCode', () => {
  const REDEEM = '/api/auth?action=redeem'
  it('posts the code as JSON to its own origin and keeps the answer', async () => {
    const { io, calls, store } = phone({ [REDEEM]: () => jsonRes(200, SIGNED_IN) })
    expect(await redeemCode('7K3M-Q9X2-T4HB-8RD7', io)).toEqual({ ok: true, answer: SIGNED_IN })
    expect(calls[0]?.init).toEqual({ method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{"code":"7K3M-Q9X2-T4HB-8RD7"}' })
    expect(store.has('knee-rebuild:account')).toBe(true)
  })
  it('passes refusals through: 401, 429, a half-set deployment, an unreachable database, no network', async () => {
    const r = (res: () => Response) => redeemCode('x', phone({ [REDEEM]: res }).io)
    expect(await r(() => jsonRes(401, { error: 'x' }))).toEqual({ ok: false, status: 401 })
    expect(await r(() => jsonRes(429, { error: 'x' }))).toEqual({ ok: false, status: 429 })
    expect(await r(() => jsonRes(503, { configured: true, error: 'x', problem: 'setup' }))).toEqual({ ok: false, status: 503, problem: 'setup' })
    expect(await r(() => jsonRes(503, { error: 'x', problem: 'unavailable' }))).toEqual({ ok: false, status: 503, problem: 'unavailable' })
    expect(await r(html)).toEqual({ ok: false, status: 200 })
    expect(await redeemCode('x', phone({}).io)).toEqual({ ok: false, status: 'network' })
  })
  it('an answer that reads signed in but isn’t a 2xx signs nothing in and keeps nothing', async () => {
    const { io, store } = phone({ [REDEEM]: () => jsonRes(500, SIGNED_IN) })
    expect(await redeemCode('7K3M-Q9X2-T4HB-8RD7', io)).toEqual({ ok: false, status: 500 })
    expect(store.has('knee-rebuild:account')).toBe(false)
  })
})

describe('signing out', () => {
  const STATUS = '/api/strava?action=status'
  const DISCONNECT = '/api/strava?action=disconnect'
  const SIGN_OUT = '/api/auth?action=sign-out'

  it('revokes a connected Strava first, then signs out', () => {
    expect(signOutSteps(true)).toEqual(['strava-disconnect', 'sign-out'])
    expect(signOutSteps(false)).toEqual(['sign-out'])
  })

  it('in that order, and keeps the signed-out answer', async () => {
    const { io, calls, store } = phone(
      {
        [STATUS]: () => jsonRes(200, { configured: true, connected: true }),
        [DISCONNECT]: () => jsonRes(200, { connected: false, revoked: true }),
        [SIGN_OUT]: () => jsonRes(200, { configured: true, signedIn: false }),
      },
      { stored: KEPT },
    )
    expect(await signOut(io)).toEqual({ ok: true, strava: 'revoked' })
    expect(calls.map((c) => c.url)).toEqual([STATUS, DISCONNECT, SIGN_OUT])
    expect(calls[2]?.init?.method).toBe('POST')
    expect(JSON.parse(store.get('knee-rebuild:account') ?? 'null')).toEqual({ configured: true, signedIn: false })
  })

  it('with no Strava connection, only signs out; a refused gate still signed this context out', async () => {
    const { io, calls } = phone({ [STATUS]: () => jsonRes(200, { configured: true, connected: false }), [SIGN_OUT]: () => jsonRes(401, { error: 'x', account: 'required' }) })
    expect(await signOut(io)).toEqual({ ok: true, strava: 'none' })
    expect(calls.map((c) => c.url)).toEqual([STATUS, SIGN_OUT])
  })

  it('a Strava revoke that fails still signs out, and says Strava didn’t confirm', async () => {
    const { io } = phone({ [STATUS]: () => jsonRes(200, { configured: true, connected: true }), [DISCONNECT]: () => jsonRes(502, { error: 'x' }), [SIGN_OUT]: () => jsonRes(200, {}) })
    expect(await signOut(io)).toEqual({ ok: true, strava: 'not-confirmed' })
  })

  it('when Strava’s connection can’t be read, signs out but never says Strava is fine', async () => {
    const unread: [string, Route][] = [
      ['database blip', () => jsonRes(503, { error: 'x', account: 'unavailable' })],
      ['half set', () => jsonRes(503, { error: 'x', account: 'setup' })],
      ['refused gate', () => jsonRes(401, { error: 'x', account: 'required' })],
      ['server error', () => jsonRes(500, { error: 'x' })],
      ['not JSON', html],
      ['unreadable JSON', () => jsonRes(200, { configured: 'yes' })],
      ['dropped fetch', () => {
        throw new TypeError('Load failed')
      }],
    ]
    for (const [label, route] of unread) {
      const { io, calls } = phone({ [STATUS]: route, [SIGN_OUT]: () => jsonRes(200, { configured: true, signedIn: false }) })
      expect(await signOut(io), label).toEqual({ ok: true, strava: 'not-confirmed' })
      expect(calls.map((c) => c.url), label).toEqual([STATUS, SIGN_OUT])
    }
  })

  it('Strava not set up on this deployment: nothing to disconnect', async () => {
    const { io } = phone({ [STATUS]: () => jsonRes(200, { configured: false, connected: false }), [SIGN_OUT]: () => jsonRes(200, { configured: true, signedIn: false }) })
    expect(await signOut(io)).toEqual({ ok: true, strava: 'none' })
  })

  it('a sign-out answered by something that isn’t the function (HTML) is not a sign-out: the cookie was never cleared', async () => {
    const { io, store } = phone({ [STATUS]: () => jsonRes(200, { configured: true, connected: false }), [SIGN_OUT]: html }, { stored: KEPT })
    expect(await signOut(io)).toEqual({ ok: false })
    expect(JSON.parse(store.get('knee-rebuild:account') ?? 'null')).toEqual(SIGNED_IN)
  })

  it('no network: not signed out, and the kept answer stays', async () => {
    const { io, store } = phone({}, { stored: KEPT })
    expect(await signOut(io)).toEqual({ ok: false })
    expect(JSON.parse(store.get('knee-rebuild:account') ?? 'null')).toEqual(SIGNED_IN)
  })
})
