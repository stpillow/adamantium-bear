/*
 * The one server piece the app has (Shawn's Nov 6 ask; PROMPT section 2 as amended, PROGRAM-QUESTIONS
 * 142): Strava's OAuth needs a client secret, which can never ship in the PWA, so this Vercel
 * function holds it and is the only thing that talks to Strava. It keeps nothing: the tokens live in
 * one encrypted, HttpOnly cookie on the phone, scoped to /api, so they never reach IndexedDB, a backup
 * file, or the page's JavaScript. The PWA calls it only when Shawn taps; nothing syncs in the
 * background. Self-contained on purpose (no imports from src/), so Vercel builds it on its own.
 *
 *   GET  /api/strava?action=status       { configured, connected }
 *   GET  /api/strava?action=connect      302 to Strava's consent page
 *   GET  /api/strava?action=callback     Strava sends him back here; stores the tokens, 302 to /#/strava
 *   GET  /api/strava?action=activities&after=<epoch s>   his activities since then, trimmed
 *   POST /api/strava?action=disconnect   revokes access at Strava and clears the cookie
 *
 * Environment (Vercel project settings, Production and Preview): STRAVA_CLIENT_ID,
 * STRAVA_CLIENT_SECRET, STRAVA_COOKIE_KEY (32 or more random characters).
 */

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

export function configured(env: Env): env is Required<Env> {
  return Boolean(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET && env.STRAVA_COOKIE_KEY && env.STRAVA_COOKIE_KEY.length >= 32)
}

// ---------------------------------------------------------------------------------------------
// Cookies and encryption (AES-GCM, key from STRAVA_COOKIE_KEY through SHA-256)

function toBase64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

async function keyFrom(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function seal(value: unknown, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(JSON.stringify(value))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(secret), data))
  return `${toBase64Url(iv)}.${toBase64Url(sealed)}`
}

/** The sealed value, or null for anything tampered with, sealed under another key, or not sealed at all. */
export async function unseal<T>(text: string | undefined, secret: string): Promise<T | null> {
  if (!text) return null
  const [iv, body] = text.split('.')
  if (!iv || !body) return null
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv) }, await keyFrom(secret), fromBase64Url(body))
    return JSON.parse(new TextDecoder().decode(plain)) as T
  } catch {
    return null
  }
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return undefined
}

export function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
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

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } })

const redirect = (to: string, cookies: string[] = []) => {
  const headers = new Headers({ Location: to, 'Cache-Control': 'no-store' })
  for (const c of cookies) headers.append('Set-Cookie', c)
  return new Response(null, { status: 302, headers })
}

/** The whole function, with its environment, clock and fetch passed in so tests can drive it. */
export async function handle(request: Request, env: Env, now: () => number = () => Math.floor(Date.now() / 1000), fetcher: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url)
  const action = url.searchParams.get('action')
  if (!configured(env)) return action === 'status' ? json({ configured: false, connected: false }) : json({ error: 'Strava is not set up on this deployment.' }, 503)
  const auth = await unseal<Tokens>(readCookie(request.headers.get('cookie'), AUTH_COOKIE), env.STRAVA_COOKIE_KEY)

  switch (action) {
    case 'status':
      return json({ configured: true, connected: auth !== null })

    case 'connect': {
      const state = toBase64Url(crypto.getRandomValues(new Uint8Array(16)))
      return redirect(authorizeUrl(env.STRAVA_CLIENT_ID, `${url.origin}/api/strava?action=callback`, state), [cookie(STATE_COOKIE, state, 600)])
    }

    case 'callback': {
      const back = (result: string) => redirect(`/#/strava?result=${result}`, [cookie(STATE_COOKIE, '', 0)])
      const expected = readCookie(request.headers.get('cookie'), STATE_COOKIE)
      if (!expected || url.searchParams.get('state') !== expected) return back('state')
      if (url.searchParams.get('error')) return back('denied')
      if (!scopeGranted(url.searchParams.get('scope'))) return back('scope')
      const code = url.searchParams.get('code')
      if (!code) return back('denied')
      try {
        const tokens = await tokenRequest(env, { code, grant_type: 'authorization_code' }, fetcher)
        return redirect('/#/strava?result=connected', [cookie(STATE_COOKIE, '', 0), cookie(AUTH_COOKIE, await seal(tokens, env.STRAVA_COOKIE_KEY), AUTH_MAX_AGE)])
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
      const headers: Record<string, string> = current.refreshed ? { 'Set-Cookie': cookie(AUTH_COOKIE, await seal(current.tokens, env.STRAVA_COOKIE_KEY), AUTH_MAX_AGE) } : {}
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

export default {
  fetch(request: Request): Promise<Response> {
    return handle(request, process.env as Env)
  },
}
