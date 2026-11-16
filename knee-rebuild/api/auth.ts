/*
 * Invite-code accounts (M-U2; Shawn's Nov 8 decisions; docs/accounts.md; PROGRAM-QUESTIONS 213 to
 * 222). A code typed into Settings, Account signs this browsing context in to an account (a name and
 * a role) held in Neon Postgres. No open sign-up, no passwords, no vendor, no redirects: every answer
 * is JSON to a same-origin fetch. A code binds to a tester, not a context: the installed iPhone app has
 * its own cookie jar, so the same code typed there signs it in as the same account. Self-contained
 * like api/strava.ts: no imports from src/; shared server code lives in the underscore files beside it.
 *
 *   GET  /api/auth?action=me         { configured, signedIn, name?, role?, problem? }
 *   POST /api/auth?action=redeem     { code }: signs this context in
 *   POST /api/auth?action=sign-out   signs this context out (and forgets the Strava cookie)
 *
 * Environment (Vercel, Production): DATABASE_URL (from the Neon integration), AUTH_COOKIE_KEY and
 * AUTH_CODE_PEPPER (32 or more characters each), AUTH_KEY_GENERATION (optional, 1), and for the first
 * admin only AUTH_BOOTSTRAP_CODE and AUTH_BOOTSTRAP_NAME. Without DATABASE_URL and AUTH_COOKIE_KEY
 * accounts are off and everything behaves as before them.
 */
import { findByCodeHash, forgetAttempt, insertBootstrapAdmin, liveDb, PEPPER_CHECK_KEY, attemptCounts, pruneAttempts, recordAttempt, touchLastSeen, writeMeta, type Db, type Role } from './_accounts.js'
import { checksumOk, hashCode, normaliseCode, pepperCheck, sameDigest } from './_code.js'
import {
  SESSION_REISSUE_AFTER,
  WORDS,
  accountsMode,
  checkSession,
  clearSessionCookie,
  clearStravaCookie,
  clientKey,
  isJson,
  json,
  readBody,
  requireSession,
  sameOrigin,
  sessionCookie,
  sessionSub,
  type AuthEnv,
} from './_session.js'

/** Redeem attempts allowed in 15 minutes, per client and from everyone (PROGRAM-QUESTIONS 217). */
export const PER_CLIENT_LIMIT = 10
export const GLOBAL_LIMIT = 200
const BODY_LIMIT = 1024

const NO_CODE = { error: 'That code didn’t work. Check it and try again.' }
const TOO_MANY = { error: 'Too many tries. Wait 15 minutes, then try again.' }
const UNAVAILABLE = { error: WORDS.unavailable, problem: 'unavailable' }

/** The whole function, with its environment, clock and database passed in so tests can drive it. */
export async function handle(
  request: Request,
  env: AuthEnv,
  now: () => number = () => Math.floor(Date.now() / 1000),
  getDb: () => Promise<Db> = () => liveDb(env.DATABASE_URL ?? ''),
): Promise<Response> {
  const action = new URL(request.url).searchParams.get('action')
  switch (action) {
    case 'me':
      return me(request, env, now(), getDb)
    case 'redeem':
      return redeem(request, env, now(), getDb)
    case 'sign-out':
      return signOut(request, env, now(), getDb)
    default:
      return json({ error: 'Unknown action.' }, 404)
  }
}

async function me(request: Request, env: AuthEnv, now: number, getDb: () => Promise<Db>): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405)
  const mode = accountsMode(env)
  if (mode === 'off') return json({ configured: false })
  if (mode === 'broken') return json({ configured: true, signedIn: false, problem: 'setup' })
  const check = await checkSession(request, env, getDb, now)
  switch (check.kind) {
    case 'unavailable':
      return json(UNAVAILABLE, 503)
    case 'none':
      return json({ configured: true, signedIn: false }, 200, {}, check.clear ? [clearSessionCookie()] : [])
    case 'ok': {
      const renew = now - check.session.iat > SESSION_REISSUE_AFTER ? [await sessionCookie(check.account.id, env, now)] : []
      return json({ configured: true, signedIn: true, name: check.account.name, role: check.account.role }, 200, {}, renew)
    }
  }
}

/** The submitted code, or null for a body that isn't `{ "code": "<64 characters or fewer>" }`. */
function codeFrom(body: string | null): string | null {
  if (body === null) return null
  try {
    const parsed = JSON.parse(body) as unknown
    const code = typeof parsed === 'object' && parsed !== null ? (parsed as { code?: unknown }).code : undefined
    return typeof code === 'string' && code.length <= 64 ? code : null
  } catch {
    return null
  }
}

async function redeem(request: Request, env: AuthEnv, now: number, getDb: () => Promise<Db>): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  const mode = accountsMode(env)
  if (mode === 'off') return json({ configured: false, error: WORDS.off }, 503)
  if (mode === 'broken') return json({ configured: true, error: WORDS.setup, problem: 'setup' }, 503)
  if (!sameOrigin(request)) return json({ error: WORDS.crossOrigin }, 403)
  if (!isJson(request)) return json({ error: 'Send JSON.' }, 415)
  const submitted = codeFrom(await readBody(request, BODY_LIMIT))
  if (submitted === null) return json({ error: 'Send a code.' }, 400)
  const pepper = env.AUTH_CODE_PEPPER ?? ''

  let account: { id: string; name: string; role: Role } | null = null
  try {
    const db = await getDb()
    await writeMeta(db, PEPPER_CHECK_KEY, await pepperCheck(pepper))
    // Recorded first, then counted, this attempt included (PROGRAM-QUESTIONS 217): each statement commits on its own, so
    // every attempt that got past was in the table before its count, and concurrent redeems can only over-count, never
    // slip past together. A refused attempt takes its row back, so a client at its limit adds no rows and one client
    // alone can't hold the global count up; a row whose take-back fails only over-counts.
    await pruneAttempts(db, now)
    const key = await clientKey(pepper, request)
    const attempt = await recordAttempt(db, key, now)
    const counts = await attemptCounts(db, key, now)
    if (counts.mine > PER_CLIENT_LIMIT || counts.everyone > GLOBAL_LIMIT) {
      await forgetAttempt(db, attempt).catch(() => undefined)
      return json(TOO_MANY, 429, { 'Retry-After': '900' })
    }

    const norm = normaliseCode(submitted)
    if (norm === null || !checksumOk(norm)) return json(NO_CODE, 401)
    const hash = await hashCode(pepper, norm)
    const row = await findByCodeHash(db, hash)
    if (row) {
      if (row.revoked || !sameDigest(row.code_hash, hash)) return json(NO_CODE, 401)
      account = { id: row.id, name: row.display_name, role: row.role }
    } else {
      account = await bootstrap(db, env, pepper, hash, now)
      if (!account) return json(NO_CODE, 401)
    }
    await touchLastSeen(db, account.id, now)
  } catch {
    return json(UNAVAILABLE, 503)
  }

  // A different account taking over this context must not inherit the last one's Strava connection (api/strava.ts also
  // binds the tokens to their account). `me` and the gate leave a readable stale or revoked session in place for this.
  const prior = await sessionSub(request.headers.get('cookie'), env)
  const cookies = [await sessionCookie(account.id, env, now)]
  if (prior !== null && prior !== account.id) cookies.push(clearStravaCookie())
  return json({ configured: true, signedIn: true, name: account.name, role: account.role }, 200, {}, cookies)
}

/**
 * The first admin (PROGRAM-QUESTIONS 215): AUTH_BOOTSTRAP_CODE redeems as creating the admin account,
 * only while no admin exists. The code becomes the admin's own, so the second context (the installed
 * app) signs in through the ordinary lookup; a concurrent first redeem is found by looking again.
 */
async function bootstrap(db: Db, env: AuthEnv, pepper: string, hash: string, now: number): Promise<{ id: string; name: string; role: Role } | null> {
  const norm = normaliseCode(env.AUTH_BOOTSTRAP_CODE ?? '')
  if (norm === null || !checksumOk(norm) || !sameDigest(await hashCode(pepper, norm), hash)) return null
  const name = env.AUTH_BOOTSTRAP_NAME?.trim().slice(0, 40) || 'Admin'
  const made = await insertBootstrapAdmin(db, { id: crypto.randomUUID(), name, hash, at: now })
  if (made) return { id: made.id, name: made.display_name, role: made.role }
  const again = await findByCodeHash(db, hash)
  return again && !again.revoked && sameDigest(again.code_hash, hash) ? { id: again.id, name: again.display_name, role: again.role } : null
}

/** Signs this context out whatever the gate says: clearing a cookie in the caller's own jar needs no database (PROGRAM-QUESTIONS 216). */
async function signOut(request: Request, env: AuthEnv, now: number, getDb: () => Promise<Db>): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  if (!sameOrigin(request)) return json({ error: WORDS.crossOrigin }, 403)
  if (!isJson(request)) return json({ error: 'Send JSON.' }, 415)
  const clears = [clearSessionCookie(), clearStravaCookie()]
  const mode = accountsMode(env)
  if (mode === 'off') return json({ configured: false }, 200, {}, clears)
  const gate = await requireSession(request, env, getDb, now)
  if (gate.ok) return json({ configured: true, signedIn: false }, 200, {}, clears)
  const headers = new Headers(gate.response.headers)
  headers.delete('set-cookie')
  for (const c of clears) headers.append('Set-Cookie', c)
  return new Response(gate.response.body, { status: gate.response.status, headers })
}

export default {
  fetch(request: Request): Promise<Response> {
    return handle(request, process.env as AuthEnv).catch(() => json({ error: 'Something went wrong on the server.' }, 500))
  },
}
