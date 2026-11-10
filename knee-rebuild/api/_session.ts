/*
 * What the two functions share (M-U2): sealed cookies, JSON answers, the accounts switch, the session
 * cookie and the /api gate. Shared server code: the underscore keeps Vercel from deploying it as a
 * function. Imports inside api/ end in `.js`. Nothing here logs, and no answer ever carries a secret
 * or an error's own message (a database error can name its host).
 *
 * The sealing (AES-GCM, key = SHA-256 of the secret) moved here unchanged from api/strava.ts; an
 * optional context separates what each key seals, and with none the key is exactly the old one, so a
 * phone's existing Strava cookie still opens.
 */
import { accountById, touchLastSeen, type Db, type Role } from './_accounts.js'
import { hmacHex } from './_code.js'

// ---------------------------------------------------------------------------------------------
// Encoding, sealing, cookies, answers

export function toBase64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

async function keyFrom(secret: string, context?: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(context ? `${context}\0${secret}` : secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function seal(value: unknown, secret: string, context?: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(JSON.stringify(value))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(secret, context), data))
  return `${toBase64Url(iv)}.${toBase64Url(sealed)}`
}

/** The sealed value, or null for anything tampered with, sealed under another key or context, or not sealed at all. */
export async function unseal<T>(text: string | undefined, secret: string, context?: string): Promise<T | null> {
  if (!text) return null
  const [iv, body] = text.split('.')
  if (!iv || !body) return null
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv) }, await keyFrom(secret, context), fromBase64Url(body))
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

export function cookie(name: string, value: string, maxAge: number, sameSite: 'Lax' | 'Strict' = 'Lax'): string {
  return `${name}=${value}; Path=/api; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${maxAge}`
}

/** A JSON answer, never cached, with any number of cookies. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}, cookies: readonly string[] = []): Response {
  const h = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
  for (const c of cookies) h.append('Set-Cookie', c)
  return new Response(JSON.stringify(body), { status, headers: h })
}

export function redirect(to: string, cookies: readonly string[] = []): Response {
  const headers = new Headers({ Location: to, 'Cache-Control': 'no-store' })
  for (const c of cookies) headers.append('Set-Cookie', c)
  return new Response(null, { status: 302, headers })
}

// ---------------------------------------------------------------------------------------------
// The switch

export interface AuthEnv {
  DATABASE_URL?: string
  AUTH_COOKIE_KEY?: string
  AUTH_CODE_PEPPER?: string
  AUTH_KEY_GENERATION?: string
  AUTH_BOOTSTRAP_CODE?: string
  AUTH_BOOTSTRAP_NAME?: string
}

export type AccountsMode = 'off' | 'on' | 'broken'

/** The key generation: unset means 1; anything but a positive whole number is no generation at all. */
export function generation(env: AuthEnv): number | null {
  const raw = env.AUTH_KEY_GENERATION || '1'
  return /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null
}

const tidy = (v: string) => v === v.trim()

/**
 * Off unless DATABASE_URL and AUTH_COOKIE_KEY are both set (today's behaviour, exactly); on when every
 * secret is long enough, untrimmed and the generation reads; otherwise broken, and every gated route
 * says so in a 503 rather than opening or quietly locking anyone out (PROGRAM-QUESTIONS 219).
 */
export function accountsMode(env: AuthEnv): AccountsMode {
  if (!env.DATABASE_URL || !env.AUTH_COOKIE_KEY) return 'off'
  const pepper = env.AUTH_CODE_PEPPER ?? ''
  if (env.AUTH_COOKIE_KEY.length < 32 || pepper.length < 32) return 'broken'
  if (!tidy(env.AUTH_COOKIE_KEY) || !tidy(pepper) || !tidy(env.DATABASE_URL)) return 'broken'
  if (generation(env) === null) return 'broken'
  return 'on'
}

// ---------------------------------------------------------------------------------------------
// Requests

/** Same origin: the Origin header is this request's own, or, with none, the browser says same-origin. `Origin: null` is refused. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (origin !== null) return origin === new URL(request.url).origin
  return request.headers.get('sec-fetch-site') === 'same-origin'
}

/** `application/json`, with or without parameters; a cross-site page can't send it without a preflight. */
export function isJson(request: Request): boolean {
  return (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() === 'application/json'
}

/** The body as text, or null when it is longer than `limit` bytes (checked before and while reading) or isn't UTF-8. */
export async function readBody(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > limit) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) {
    all.set(c, offset)
    offset += c.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(all)
  } catch {
    return null
  }
}

/** An IPv6 address's /64 network (one host can walk its /64 for free), or null when it doesn't read as IPv6. */
export function ipv6Prefix(ip: string): string | null {
  const bare = ip.replace(/^\[|\]$/g, '').split('%')[0] ?? ''
  if (!bare.includes(':')) return null
  const halves = bare.split('::')
  if (halves.length > 2) return null
  const part = (s: string | undefined) => (s ? s.split(':') : [])
  const head = part(halves[0])
  const tail = part(halves[1])
  // An embedded IPv4 tail counts as two groups.
  const groups = (xs: string[]) => xs.reduce((n, x) => n + (x.includes('.') ? 2 : 1), 0)
  const fill = halves.length === 2 ? 8 - groups(head) - groups(tail) : 0
  if (fill < 0) return null
  const all = [...head, ...Array<string>(fill).fill('0'), ...tail]
  const first = all.slice(0, 4)
  if (first.length < 4 || first.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null
  return `${first.map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`
}

/** The rate limit's key for a client: a keyed hash of its address (IPv6 by /64); the raw address is never stored. */
export function clientKey(pepper: string, request: Request): Promise<string> {
  const ip = (request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown').trim()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1]
  const subject = mapped ?? ipv6Prefix(ip) ?? ip
  return hmacHex(pepper, `client:${subject}`)
}

// ---------------------------------------------------------------------------------------------
// The session cookie

export const SESSION_COOKIE = 'kr_session'
/** 400 days, Chrome's cap on a cookie's life. */
export const SESSION_MAX_AGE = 34_560_000
/** `me` and redeem re-issue a session older than this, so a phone in use stays signed in. */
export const SESSION_REISSUE_AFTER = 30 * 86_400
const SESSION_CONTEXT = 'kr-session-v1'
export const STRAVA_COOKIE = 'kr_strava'

export interface SessionPayload {
  k: 's'
  sub: string
  /** Epoch seconds. */
  iat: number
  gen: number
}

/** The sealed value of a fresh session (a test can set `iat`). */
export async function sealSession(sub: string, env: AuthEnv, iat: number): Promise<string> {
  const payload: SessionPayload = { k: 's', sub, iat, gen: generation(env) ?? 0 }
  return seal(payload, env.AUTH_COOKIE_KEY ?? '', SESSION_CONTEXT)
}

export async function sessionCookie(sub: string, env: AuthEnv, now: number): Promise<string> {
  return cookie(SESSION_COOKIE, await sealSession(sub, env, now), SESSION_MAX_AGE, 'Strict')
}

export const clearSessionCookie = (): string => cookie(SESSION_COOKIE, '', 0, 'Strict')
export const clearStravaCookie = (): string => cookie(STRAVA_COOKIE, '', 0)

const isWhole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)

/** The session payload as sealed, whatever its age or generation; null for anything that isn't one. */
async function unsealSession(header: string | null, env: AuthEnv): Promise<SessionPayload | null> {
  const p = await unseal<Partial<SessionPayload>>(readCookie(header, SESSION_COOKIE), env.AUTH_COOKIE_KEY ?? '', SESSION_CONTEXT)
  if (!p || typeof p !== 'object' || p.k !== 's' || typeof p.sub !== 'string' || p.sub === '' || !isWhole(p.iat) || !isWhole(p.gen)) return null
  return p as SessionPayload
}

/** Whether this deployment still honours a session: its generation, not from the future, under 400 days old. */
function honoured(p: SessionPayload, env: AuthEnv, now: number): boolean {
  return p.gen === generation(env) && p.iat <= now + 300 && now - p.iat <= SESSION_MAX_AGE
}

/** A session this deployment still honours. No database. */
export async function readSession(header: string | null, env: AuthEnv, now: number): Promise<SessionPayload | null> {
  const p = await unsealSession(header, env)
  return p && honoured(p, env, now) ? p : null
}

/** The account a sealed session on this request names, honoured or not: a redeem by another account forgets the Strava connection. */
export async function sessionSub(header: string | null, env: AuthEnv): Promise<string | null> {
  return (await unsealSession(header, env))?.sub ?? null
}

/** Whether the request carries a non-empty session cookie (so a refusal also clears it). */
export function sessionSent(header: string | null): boolean {
  return Boolean(readCookie(header, SESSION_COOKIE))
}

// ---------------------------------------------------------------------------------------------
// The gate

export const WORDS = {
  required: 'Sign in on this phone first: Settings, Account.',
  setup: 'Accounts are half set up on this deployment.',
  unavailable: 'Accounts can’t be checked right now. Try again in a minute.',
  crossOrigin: 'This only works from inside the app.',
  off: 'Accounts aren’t set up on this deployment.',
} as const

export interface SignedIn {
  id: string
  name: string
  role: Role
}

export type SessionCheck =
  | { kind: 'ok'; account: SignedIn; session: SessionPayload }
  | { kind: 'none'; clear: boolean }
  | { kind: 'unavailable' }

/**
 * Who this request is signed in as. A missing, unreadable or stale-generation cookie is answered
 * without the database (scanners never wake it); otherwise the account is read on every request, so
 * revoking it takes effect at once, and its last-seen time is written at most hourly. Only an
 * unreadable cookie is cleared: one that reads but is stale, or names a revoked or unknown account,
 * stays, so a redeem by another account on this context still sees whose it was and forgets that
 * account's Strava cookie (`sessionSub`; Settings always asks `me` before a redeem).
 */
export async function checkSession(request: Request, env: AuthEnv, getDb: () => Promise<Db>, now: number): Promise<SessionCheck> {
  const header = request.headers.get('cookie')
  const sealed = await unsealSession(header, env)
  if (!sealed) return { kind: 'none', clear: sessionSent(header) }
  if (!honoured(sealed, env, now)) return { kind: 'none', clear: false }
  const session = sealed
  try {
    const db = await getDb()
    const row = await accountById(db, session.sub)
    if (!row || row.revoked) return { kind: 'none', clear: false }
    if (row.last_seen === null || now - row.last_seen >= 3600) await touchLastSeen(db, row.id, now)
    return { kind: 'ok', account: { id: row.id, name: row.display_name, role: row.role }, session }
  } catch {
    return { kind: 'unavailable' }
  }
}

export type Gate = { ok: true; account: SignedIn; session: SessionPayload } | { ok: false; reason: 'required' | 'setup' | 'unavailable'; cookies: string[]; response: Response }

/** The /api gate (PROGRAM-QUESTIONS 218): only for a deployment whose accounts are on or broken. */
export async function requireSession(request: Request, env: AuthEnv, getDb: () => Promise<Db>, now: number): Promise<Gate> {
  if (accountsMode(env) !== 'on') return { ok: false, reason: 'setup', cookies: [], response: json({ error: WORDS.setup, account: 'setup' }, 503) }
  const check = await checkSession(request, env, getDb, now)
  switch (check.kind) {
    case 'ok':
      return { ok: true, account: check.account, session: check.session }
    case 'unavailable':
      return { ok: false, reason: 'unavailable', cookies: [], response: json({ error: WORDS.unavailable, account: 'unavailable' }, 503) }
    case 'none': {
      const cookies = check.clear ? [clearSessionCookie()] : []
      return { ok: false, reason: 'required', cookies, response: json({ error: WORDS.required, account: 'required' }, 401, {}, cookies) }
    }
  }
}
