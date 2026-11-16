import { describe, expect, it } from 'vitest'
import { stravaDisconnect, stravaStatus } from './strava.ts'

/** A stand-in for the app's own function: one answer, and the calls made. */
function answer(status: number, body: unknown, type = 'application/json') {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } })
  }) as typeof fetch
  return { fetcher, calls }
}

describe('stravaStatus', () => {
  it('passes the function’s answer through', async () => {
    expect(await stravaStatus(answer(200, { configured: true, connected: true }).fetcher)).toEqual({ configured: true, connected: true })
  })
  it('reads an account the function asks for: signed out, half set up, or not checkable', async () => {
    expect(await stravaStatus(answer(401, { error: 'x', account: 'required' }).fetcher)).toEqual({ configured: true, connected: false, account: 'required' })
    expect(await stravaStatus(answer(503, { error: 'x', account: 'setup' }).fetcher)).toEqual({ configured: true, connected: false, account: 'setup' })
    expect(await stravaStatus(answer(503, { error: 'x', account: 'unavailable' }).fetcher)).toEqual({ configured: true, connected: false, account: 'unavailable' })
  })
  it('reads anything else as not set up: no function (HTML), another error, an unknown reason, offline', async () => {
    const off = { configured: false, connected: false }
    expect(await stravaStatus(answer(200, '<!doctype html>', 'text/html').fetcher)).toEqual(off)
    expect(await stravaStatus(answer(500, { error: 'x' }).fetcher)).toEqual(off)
    expect(await stravaStatus(answer(401, { account: 'something' }).fetcher)).toEqual(off)
    expect(await stravaStatus((() => Promise.reject(new TypeError('offline'))) as typeof fetch)).toEqual(off)
  })
  it('asks only the app’s own function, with its cookies', async () => {
    const { fetcher, calls } = answer(200, { configured: false, connected: false })
    await stravaStatus(fetcher)
    expect(calls).toEqual([{ url: '/api/strava?action=status', init: { credentials: 'same-origin' } }])
  })
})

describe('stravaDisconnect', () => {
  it('says whether Strava confirmed the revoke', async () => {
    expect(await stravaDisconnect(answer(200, { connected: false, revoked: true }).fetcher)).toBe(true)
    expect(await stravaDisconnect(answer(200, { connected: false, revoked: false }).fetcher)).toBe(false)
    await expect(stravaDisconnect(answer(401, { error: 'Sign in on this phone first: Settings, Account.' }).fetcher)).rejects.toThrow('Sign in on this phone first')
  })
})
