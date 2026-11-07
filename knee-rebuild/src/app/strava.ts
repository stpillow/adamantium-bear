import type { RunDraft, StravaActivity } from '../rules/stravaImport.ts'

/*
 * The PWA's side of the Strava import: three calls to its own /api/strava function (never to Strava,
 * so the CSP's connect-src 'self' holds), made only when Shawn taps, and the hand-off of one activity
 * to the run logger. What an activity becomes is src/rules/stravaImport.ts's call.
 */

const BASE = '/api/strava'
const DRAFT_KEY = 'knee-rebuild:strava-draft'

export interface StravaStatus {
  configured: boolean
  connected: boolean
}

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `the import answered ${res.status}`)
  return body
}

/** Whether this deployment has Strava set up, and whether this phone is connected. Offline, or with no function deployed, it reads as not set up. */
export async function stravaStatus(): Promise<StravaStatus> {
  try {
    const res = await fetch(`${BASE}?action=status`, { credentials: 'same-origin' })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return { configured: false, connected: false }
    return await readJson<StravaStatus>(res)
  } catch {
    return { configured: false, connected: false }
  }
}

/** The page that starts Strava's consent: a full navigation, so the function can redirect. */
export const STRAVA_CONNECT_URL = `${BASE}?action=connect`

export async function stravaActivities(after: number): Promise<StravaActivity[]> {
  const res = await fetch(`${BASE}?action=activities&after=${after}`, { credentials: 'same-origin' })
  return (await readJson<{ activities: StravaActivity[] }>(res)).activities
}

/** Disconnects; true when Strava confirmed the revoke, false when only this phone's cookie went. */
export async function stravaDisconnect(): Promise<boolean> {
  const body = await readJson<{ revoked?: boolean }>(await fetch(`${BASE}?action=disconnect`, { method: 'POST', credentials: 'same-origin' }))
  return body.revoked === true
}

/**
 * Hands one activity to the run logger: kept for this visit only, and taken once. takeDraft doesn't
 * validate, so a draft kept by a pre-phase-2 tab can lack the heart-rate keys (as an older one can
 * lack `rpe`): `formFromDraft` defaults each missing key to null, the rpe/effort precedent
 * (src/screens/RunLogger.helpers.ts).
 */
export function handDraft(draft: RunDraft): void {
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // Private browsing: the logger opens empty; the Strava screen still lists the activity.
  }
}

export function takeDraft(): RunDraft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY)
    window.sessionStorage.removeItem(DRAFT_KEY)
    return raw ? (JSON.parse(raw) as RunDraft) : null
  } catch {
    return null
  }
}
