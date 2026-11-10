import { stravaDisconnect } from './strava.ts'

/*
 * The PWA's side of accounts (M-U2; PROGRAM-QUESTIONS 220, 225): three calls to its own /api/auth
 * function (never to anyone else, so the CSP's connect-src 'self' holds): the account check at launch,
 * on reconnect and when Settings opens, online only, and Redeem and Sign out on a tap. The last answer
 * is kept in this phone's local storage. Since M-U3 it also sets the engine mode
 * (src/rules/engineMode.ts, read through src/app/mode.ts): a change notifies the listeners
 * (`subscribeAccount`), and the next render runs in the mode it decides. Nothing about using the app
 * offline waits on it. Fetch, storage and the online flag are passed in, so the tests run without a browser.
 */

const BASE = '/api/auth'
const CACHE_KEY = 'knee-rebuild:account'

export type Role = 'admin' | 'tester'

export interface AccountAnswer {
  configured: boolean
  signedIn: boolean
  name?: string
  role?: Role
  problem?: 'setup' | 'unavailable'
}

export interface AccountIo {
  fetch: typeof fetch
  storage: () => Pick<Storage, 'getItem' | 'setItem'> | null
  online: () => boolean
}

const defaultIo: AccountIo = {
  // Wrapped: a bare `fetch` called as a method of this object throws "Illegal invocation".
  fetch: (input, init) => fetch(input, init),
  storage: () => {
    try {
      return window.localStorage
    } catch {
      return null
    }
  },
  online: () => navigator.onLine,
}

/** Reads a server answer defensively: only the fields and values the function sends. */
export function readAnswer(body: unknown): AccountAnswer | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  if (typeof b.configured !== 'boolean') return null
  const answer: AccountAnswer = { configured: b.configured, signedIn: b.signedIn === true }
  if (answer.signedIn) {
    if (typeof b.name !== 'string' || b.name === '' || b.name.length > 40 || (b.role !== 'admin' && b.role !== 'tester')) return null
    answer.name = b.name
    answer.role = b.role
  }
  if (b.problem === 'setup' || b.problem === 'unavailable') answer.problem = b.problem
  return answer
}

/** The kept answer as stored, or null (none, or storage that can't be read); never throws. The engine mode's snapshot: a string compares by value. */
export function keptRaw(io: Pick<AccountIo, 'storage'> = defaultIo): string | null {
  try {
    return io.storage()?.getItem(CACHE_KEY) ?? null
  } catch {
    return null
  }
}

/** The kept answer, read defensively, or null. */
export function keptAccount(io: Pick<AccountIo, 'storage'> = defaultIo): AccountAnswer | null {
  return parseKept(keptRaw(io))
}

/** A stored answer read back: only the fields and values the function sends, else null. */
export function parseKept(raw: string | null): AccountAnswer | null {
  if (raw === null || raw === '') return null
  try {
    return readAnswer(JSON.parse(raw))
  } catch {
    return null
  }
}

function cached(io: AccountIo): AccountAnswer | null {
  return keptAccount(io)
}

const listeners = new Set<() => void>()

/** Called after each change to the kept answer, in this context; returns the unsubscribe. */
export function subscribeAccount(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Whether an answer may replace the kept one. A `configured:false` never replaces a kept
 * `configured:true` (M-U3 review A): a deployment that lost its accounts variables, or a preview
 * without them, must not hand the engine to a tester's phone. The recovery is to clear the site's data.
 */
export function replacesKept(kept: AccountAnswer | null, answer: AccountAnswer): boolean {
  return !(kept?.configured === true && !answer.configured)
}

function remember(io: AccountIo, answer: AccountAnswer): void {
  try {
    if (!replacesKept(cached(io), answer)) return
    const storage = io.storage()
    if (!storage) return
    storage.setItem(CACHE_KEY, JSON.stringify(answer))
  } catch {
    // Private browsing or storage full: the next check asks the server again.
    return
  }
  for (const listener of listeners) listener()
}

/** The body as JSON when the function answered (no function, in a static preview, answers HTML). */
async function jsonOf(res: Response): Promise<unknown> {
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) return undefined
  return res.json().catch(() => undefined)
}

export interface AccountState {
  answer: AccountAnswer | null
  from: 'server' | 'cache'
  online: boolean
}

/**
 * The account as the server says, or as it last said. Offline it never fetches. Only an answer from
 * the function replaces the kept one: a failed fetch (an iPhone app can think it is online with no
 * network) or a page with no function (HTML) falls back to what was kept, so it never reads a phone
 * that is signed in as signed out.
 */
export async function accountStatus(io: AccountIo = defaultIo): Promise<AccountState> {
  const online = io.online()
  if (!online) return { answer: cached(io), from: 'cache', online }
  try {
    const res = await io.fetch(`${BASE}?action=me`, { credentials: 'same-origin' })
    const raw = await jsonOf(res)
    const answer = readAnswer(raw)
    if (answer === null) {
      const kept = cached(io)
      // The function answered but couldn't check accounts: what was kept, else say so.
      if (kept === null && typeof raw === 'object' && raw !== null && (raw as { problem?: unknown }).problem === 'unavailable') {
        return { answer: { configured: true, signedIn: false, problem: 'unavailable' }, from: 'server', online }
      }
      return { answer: kept, from: 'cache', online }
    }
    if (res.ok && !answer.problem) remember(io, answer)
    return { answer, from: 'server', online }
  } catch {
    return { answer: cached(io), from: 'cache', online }
  }
}

export type RedeemResult = { ok: true; answer: AccountAnswer } | { ok: false; status: number | 'network'; problem?: 'setup' | 'unavailable' }

const post = (io: AccountIo, action: string, body: unknown) =>
  io.fetch(`${BASE}?action=${action}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** Sends a typed code; on success this context is signed in and the answer is kept. */
export async function redeemCode(code: string, io: AccountIo = defaultIo): Promise<RedeemResult> {
  let res: Response
  try {
    res = await post(io, 'redeem', { code })
  } catch {
    return { ok: false, status: 'network' }
  }
  const raw = await jsonOf(res)
  const answer = readAnswer(raw)
  if (res.ok && answer?.signedIn) {
    remember(io, answer)
    return { ok: true, answer }
  }
  const named = typeof raw === 'object' && raw !== null ? (raw as { problem?: unknown }).problem : undefined
  const problem = named === 'setup' || named === 'unavailable' ? named : undefined
  return problem ? { ok: false, status: res.status, problem } : { ok: false, status: res.status }
}

/**
 * The calls Sign out makes, in order (PROGRAM-QUESTIONS 216): a connected Strava is revoked at Strava
 * first, while still signed in, so the athlete slot it holds is freed; then this context signs out.
 */
export function signOutSteps(stravaConnected: boolean): ('strava-disconnect' | 'sign-out')[] {
  return stravaConnected ? ['strava-disconnect', 'sign-out'] : ['sign-out']
}

export type SignOutResult = { ok: true; strava: 'revoked' | 'not-confirmed' | 'none' } | { ok: false }

/**
 * Whether this context's Strava is connected, as Sign out needs it: 'unknown' whenever the function's
 * answer doesn't say (a refused gate, a database blip, a server error, no function, a dropped fetch),
 * because sign-out clears the Strava cookie either way, and the words must then send the tester to
 * Strava's own settings rather than say nothing.
 */
export async function stravaConnection(fetcher: typeof fetch): Promise<'connected' | 'not-connected' | 'unknown'> {
  try {
    const res = await fetcher('/api/strava?action=status', { credentials: 'same-origin' })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return 'unknown'
    const body = (await res.json().catch(() => null)) as { configured?: unknown; connected?: unknown } | null
    if (body === null || typeof body.configured !== 'boolean' || typeof body.connected !== 'boolean') return 'unknown'
    return body.configured && body.connected ? 'connected' : 'not-connected'
  } catch {
    return 'unknown'
  }
}

export async function signOut(io: AccountIo = defaultIo): Promise<SignOutResult> {
  const connection = await stravaConnection(io.fetch)
  let strava: 'revoked' | 'not-confirmed' | 'none' = connection === 'unknown' ? 'not-confirmed' : 'none'
  for (const step of signOutSteps(connection === 'connected')) {
    if (step === 'strava-disconnect') {
      strava = await stravaDisconnect(io.fetch)
        .then((revoked) => (revoked ? ('revoked' as const) : ('not-confirmed' as const)))
        .catch(() => 'not-confirmed' as const)
      continue
    }
    try {
      const res = await post(io, 'sign-out', {})
      // Any answer from the function cleared this context's cookies (it clears them whatever its gate says).
      if (!(res.headers.get('content-type') ?? '').includes('application/json')) return { ok: false }
    } catch {
      return { ok: false }
    }
  }
  remember(io, { configured: true, signedIn: false })
  return { ok: true, strava }
}
