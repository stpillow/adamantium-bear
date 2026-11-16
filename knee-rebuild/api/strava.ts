/*
 * The Strava import's server piece (Shawn's Nov 6 ask; PROMPT section 2 as amended, PROGRAM-QUESTIONS
 * 142; api/auth.ts is the other function, since M-U2): Strava's OAuth needs a client secret, which can never ship in the PWA, so this Vercel
 * function holds it and is the only thing that talks to Strava. It keeps nothing: the tokens live in
 * one encrypted, HttpOnly cookie on the phone, scoped to /api, so they never reach IndexedDB, a backup
 * file, or the page's JavaScript. The PWA calls it only when Shawn taps; nothing syncs in the
 * background. Self-contained on purpose (no imports from src/; only the underscore files beside it), so
 * Vercel builds it on its own.
 *
 *   GET  /api/strava?action=status       { configured, connected }
 *   GET  /api/strava?action=connect      302 to Strava's consent page
 *   GET  /api/strava?action=callback     Strava sends him back here; stores the tokens, 302 to /#/strava
 *   GET  /api/strava?action=activities&after=<epoch s>   his activities since then, trimmed
 *   POST /api/strava?action=disconnect   revokes access at Strava and clears the cookie
 *
 * Environment (Vercel project settings, Production and Preview): STRAVA_CLIENT_ID,
 * STRAVA_CLIENT_SECRET, STRAVA_COOKIE_KEY (32 or more random characters).
 *
 * Accounts (M-U2, PROGRAM-QUESTIONS 218): when DATABASE_URL and AUTH_COOKIE_KEY are set, every action
 * but the callback needs a signed-in session (api/_session.ts's gate); Strava's return to the callback
 * is a cross-site navigation that never carries the Strict session cookie, so connect seals the
 * account into the state cookie and the callback checks that account instead. Without them, this
 * behaves exactly as it did before accounts. The sealing and cookie helpers moved to api/_session.ts.
 */
import { accountById, liveDb, type Db } from './_accounts.js'
import { accountsMode, cookie, generation, json, readCookie, redirect, requireSession, sameOrigin, seal, toBase64Url, unseal, type AuthEnv } from './_session.js'

export { cookie, readCookie, seal, unseal } from './_session.js'

/** Strava's hosts, in one place: the API is announced to move to api-v3.strava.com in 2027. */
export const STRAVA_OAUTH = 'https://www.strava.com/oauth'
export const STRAVA_API = 'https://www.strava.com/api/v3'
export const SCOPE = 'activity:read_all'
const AUTH_COOKIE = 'kr_strava'
const STATE_COOKIE = 'kr_strava_state'
const AUTH_MAX_AGE = 180 * 24 * 3600
const MAX_PAGES = 3
const PER_PAGE = 100

export interface Env {
  STRAVA_CLIENT_ID?: string
  STRAVA_CLIENT_SECRET?: string
  STRAVA_COOKIE_KEY?: string
}

export interface Tokens {
  access_token: string
  refresh_token: string
  /** Epoch seconds. */
  expires_at: number
}

/** Strava's settings and the accounts' (api/_session.ts), as the function reads them. */
export type FunctionEnv = Env & AuthEnv

export function configured<E extends Env>(env: E): env is E & Required<Env> {
  return Boolean(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET && env.STRAVA_COOKIE_KEY && env.STRAVA_COOKIE_KEY.length >= 32)
}

// ---------------------------------------------------------------------------------------------
// Strava

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', approval_prompt: 'auto', scope: SCOPE, state })
  return `${STRAVA_OAUTH}/authorize?${q.toString()}`
}

/** The scope Strava says was granted covers reading his activities (he can untick it on the consent page). */
export function scopeGranted(scope: string | null): boolean {
  const granted = new Set((scope ?? '').split(','))
  return granted.has('activity:read_all') || granted.has('activity:read')
}

/** What the PWA needs of an activity, and nothing more: the summary's average and max heart rate come through (metrics phase 2); maps, GPS and heart-rate streams still don't. */
export function trim(a: Record<string, unknown>): Record<string, unknown> {
  const keep = ['id', 'name', 'sport_type', 'type', 'distance', 'moving_time', 'elapsed_time', 'start_date_local', 'perceived_exertion', 'workout_type', 'average_heartrate', 'max_heartrate']
  return Object.fromEntries(keep.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]))
}

async function tokenRequest(env: Required<Env>, body: Record<string, string>, fetcher: typeof fetch): Promise<Tokens> {
  const res = await fetcher(`${STRAVA_OAUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, ...body }).toString(),
  })
  if (!res.ok) throw new Error(`Strava token request failed (${res.status})`)
  const json = (await res.json()) as Partial<Tokens>
  if (!json.access_token || !json.refresh_token || typeof json.expires_at !== 'number') throw new Error('Strava sent an unreadable token')
  return { access_token: json.access_token, refresh_token: json.refresh_token, expires_at: json.expires_at }
}

/** The tokens, refreshed when they expire within a minute (Strava rotates the refresh token, so the new one is kept). */
export async function fresh(env: Required<Env>, tokens: Tokens, nowSeconds: number, fetcher: typeof fetch): Promise<{ tokens: Tokens; refreshed: boolean }> {
  if (tokens.expires_at - 60 > nowSeconds) return { tokens, refreshed: false }
  return { tokens: await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token }, fetcher), refreshed: true }
}

/**
 * What the token cookie holds. With accounts on, the tokens are bound to the account that connected
 * them, `{ k: 'strava', sub, tokens }`, so a context that changes hands (a revoked or stale session,
 * then another account's code) never shows or uses the last account's Strava. A cookie sealed before
 * accounts holds the bare tokens: with accounts off it reads as ever, and with them on the first
 * account to use it adopts it (Shawn's phone, which had the only connection before accounts).
 */
interface Held {
  tokens: Tokens
  /** The account the tokens belong to; undefined for a cookie sealed before accounts. */
  sub?: string
}

const isTokens = (t: unknown): t is Tokens =>
  typeof t === 'object' && t !== null && typeof (t as Tokens).access_token === 'string' && typeof (t as Tokens).refresh_token === 'string' && typeof (t as Tokens).expires_at === 'number'

function heldFrom(value: unknown): Held | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as { k?: unknown; sub?: unknown; tokens?: unknown }
  if (v.k === 'strava') return typeof v.sub === 'string' && v.sub !== '' && isTokens(v.tokens) ? { tokens: v.tokens, sub: v.sub } : null
  if ('k' in v) return null
  return isTokens(value) ? { tokens: value } : null
}

/** The token cookie's value: bound to an account, or bare when there is none (accounts off). */
function sealTokens(tokens: Tokens, sub: string | undefined, key: string): Promise<string> {
  return sub === undefined ? seal(tokens, key) : seal({ k: 'strava', sub, tokens }, key)
}

/** The response with one more cookie, unless it already sets that cookie. */
function withCookie(res: Response, name: string, value: string | null): Response {
  if (value === null || res.headers.getSetCookie().some((c) => c.startsWith(`${name}=`))) return res
  const headers = new Headers(res.headers)
  headers.append('Set-Cookie', value)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

/** What connect seals into the state cookie when accounts are on: the state, the account, when, and under which key generation. */
interface StateSeal {
  k: 'strava-state'
  state: string
  sub: string
  iat: number
  gen: number
}
const STATE_CONTEXT = 'kr-strava-state'
const STATE_MAX_AGE = 600

/** The whole function, with its environment, clock and fetch passed in so tests can drive it. */
export async function handle(
  request: Request,
  env: FunctionEnv,
  now: () => number = () => Math.floor(Date.now() / 1000),
  fetcher: typeof fetch = fetch,
  getDb: () => Promise<Db> = () => liveDb(env.DATABASE_URL ?? ''),
): Promise<Response> {
  const url = new URL(request.url)
  const action = url.searchParams.get('action')
  // The /api gate (M-U2). Off is today's behaviour, untouched; broken fails closed.
  const mode = accountsMode(env)
  let sub: string | null = null
  if (mode !== 'off' && action !== 'callback') {
    const gate = await requireSession(request, env, getDb, now())
    if (!gate.ok) {
      if (action !== 'connect') return gate.response
      const result = gate.reason === 'required' ? 'account' : gate.reason === 'setup' ? 'account-setup' : 'unavailable'
      return redirect(`/#/strava?result=${result}`, gate.cookies)
    }
    sub = gate.account.id
  }
  if (mode === 'on' && action === 'disconnect' && !sameOrigin(request)) return json({ error: 'This only works from inside the app.' }, 403)
  if (!configured(env)) return action === 'status' ? json({ configured: false, connected: false }) : json({ error: 'Strava is not set up on this deployment.' }, 503)
  const held = heldFrom(await unseal<unknown>(readCookie(request.headers.get('cookie'), AUTH_COOKIE), env.STRAVA_COOKIE_KEY))
  // Whose the tokens are: with accounts on, the signed-in account's only; another account's are forgotten here, never used.
  let auth: Tokens | null = null
  let owner: string | undefined = undefined
  let fixUp: string | null = null
  if (held) {
    if (sub === null) {
      auth = held.tokens
      owner = held.sub
    } else if (held.sub === sub) {
      auth = held.tokens
      owner = sub
    } else if (held.sub === undefined) {
      auth = held.tokens
      owner = sub
      fixUp = cookie(AUTH_COOKIE, await sealTokens(held.tokens, sub, env.STRAVA_COOKIE_KEY), AUTH_MAX_AGE)
    } else {
      fixUp = cookie(AUTH_COOKIE, '', 0)
    }
  }
  const answer = async (): Promise<Response> => {
    switch (action) {
      case 'status':
        return json({ configured: true, connected: auth !== null })

      case 'connect': {
        const state = toBase64Url(crypto.getRandomValues(new Uint8Array(16)))
        const value = sub === null ? state : await seal({ k: 'strava-state', state, sub, iat: now(), gen: generation(env) ?? 0 } satisfies StateSeal, env.AUTH_COOKIE_KEY ?? '', STATE_CONTEXT)
        return redirect(authorizeUrl(env.STRAVA_CLIENT_ID, `${url.origin}/api/strava?action=callback`, state), [cookie(STATE_COOKIE, value, STATE_MAX_AGE)])
      }

      case 'callback': {
        const back = (result: string) => redirect(`/#/strava?result=${result}`, [cookie(STATE_COOKIE, '', 0)])
        if (mode === 'broken') return back('account-setup')
        // With accounts on, the tokens are bound to the account the state names.
        let bound: string | undefined = undefined
        if (mode === 'on') {
          // The account rides in the sealed state: the Strict session cookie isn't sent on Strava's cross-site return.
          const sealed = await unseal<Partial<StateSeal>>(readCookie(request.headers.get('cookie'), STATE_COOKIE), env.AUTH_COOKIE_KEY ?? '', STATE_CONTEXT)
          if (!sealed || sealed.k !== 'strava-state' || typeof sealed.state !== 'string' || typeof sealed.sub !== 'string' || typeof sealed.iat !== 'number') return back('state')
          if (url.searchParams.get('state') !== sealed.state || now() - sealed.iat > STATE_MAX_AGE || sealed.iat > now() + 300) return back('state')
          if (sealed.gen !== generation(env)) return back('account')
          try {
            const account = await accountById(await getDb(), sealed.sub)
            if (!account || account.revoked) return back('account')
          } catch {
            return back('unavailable')
          }
          bound = sealed.sub
        } else {
          const expected = readCookie(request.headers.get('cookie'), STATE_COOKIE)
          if (!expected || url.searchParams.get('state') !== expected) return back('state')
        }
        if (url.searchParams.get('error')) return back('denied')
        if (!scopeGranted(url.searchParams.get('scope'))) return back('scope')
        const code = url.searchParams.get('code')
        if (!code) return back('denied')
        try {
          const tokens = await tokenRequest(env, { code, grant_type: 'authorization_code' }, fetcher)
          return redirect('/#/strava?result=connected', [cookie(STATE_COOKIE, '', 0), cookie(AUTH_COOKIE, await sealTokens(tokens, bound, env.STRAVA_COOKIE_KEY), AUTH_MAX_AGE)])
        } catch {
          return back('token')
        }
      }

      case 'activities': {
        if (!auth) return json({ error: 'Not connected to Strava.' }, 401)
        const after = Number(url.searchParams.get('after'))
        if (!Number.isInteger(after) || after < 0) return json({ error: 'after must be epoch seconds.' }, 400)
        let current: { tokens: Tokens; refreshed: boolean }
        try {
          current = await fresh(env, auth, now(), fetcher)
        } catch {
          return json({ error: 'Strava would not renew access; connect again.' }, 401, { 'Set-Cookie': cookie(AUTH_COOKIE, '', 0) })
        }
        // A renewal rotates the refresh token and kills the old one, so the new tokens go back in the cookie on every answer from here, failures included.
        const headers: Record<string, string> = current.refreshed ? { 'Set-Cookie': cookie(AUTH_COOKIE, await sealTokens(current.tokens, owner, env.STRAVA_COOKIE_KEY), AUTH_MAX_AGE) } : {}
        const activities: Record<string, unknown>[] = []
        try {
          for (let page = 1; page <= MAX_PAGES; page++) {
            const res = await fetcher(`${STRAVA_API}/athlete/activities?after=${after}&per_page=${PER_PAGE}&page=${page}`, { headers: { Authorization: `Bearer ${current.tokens.access_token}` } })
            if (res.status === 429) return json({ error: 'Strava’s rate limit is reached; try again in 15 minutes.' }, 429, headers)
            if (!res.ok) return json({ error: `Strava answered ${res.status}.` }, 502, headers)
            const batch = (await res.json()) as Record<string, unknown>[]
            if (!Array.isArray(batch)) return json({ error: 'Strava sent an unreadable list.' }, 502, headers)
            activities.push(...batch.map(trim))
            if (batch.length < PER_PAGE) break
          }
        } catch {
          return json({ error: 'Strava could not be reached, or sent something unreadable.' }, 502, headers)
        }
        return json({ activities }, 200, headers)
      }

      case 'disconnect': {
        if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
        // The cookie goes either way; `revoked` says whether Strava took the revoke, which needs a live token, so an expired one is renewed first.
        // oauth/deauthorize is announced to give way to oauth/revoke in 2027.
        let revoked = false
        if (auth) {
          try {
            const { tokens: live } = await fresh(env, auth, now(), fetcher)
            const res = await fetcher(`${STRAVA_OAUTH}/deauthorize`, { method: 'POST', headers: { Authorization: `Bearer ${live.access_token}` } })
            revoked = res.ok
          } catch {
            revoked = false
          }
        }
        return json({ connected: false, revoked }, 200, { 'Set-Cookie': cookie(AUTH_COOKIE, '', 0) })
      }

      default:
        return json({ error: 'Unknown action.' }, 404)
    }
  }
  return withCookie(await answer(), AUTH_COOKIE, fixUp)
}

export default {
  fetch(request: Request): Promise<Response> {
    return handle(request, process.env as FunctionEnv).catch(() => json({ error: 'Something went wrong on the server.' }, 500))
  },
}
