/*
 * Where the app lives (M-D1, Nov 20, 2026; docs/domain-and-ios-plan.md section 2). Production moved
 * from Vercel's name for it to knee.shawnpillow.com. A phone's log belongs to the address that wrote
 * it (IndexedDB, local storage, cookies and the home-screen install are all per origin), so nothing
 * on the old address follows by itself: the phone carries its log across with Export JSON there and
 * the import on the new address's first screen. This decides when the old address says so.
 * Pure: the shell passes `location.hostname` in.
 */

/** The app's address from M-D1 on. */
export const HOME_HOST = 'knee.shawnpillow.com'
export const HOME_URL = `https://${HOME_HOST}`

/**
 * Addresses the app has moved off. Only production's own name, the one Shawn's home-screen app was
 * installed from: previews keep their per-branch hosts and their own test data, and Vercel's longer
 * production aliases were never installed from (PROGRAM-QUESTIONS 238).
 */
export const RETIRED_HOSTS: readonly string[] = ['knee-rebuild.vercel.app']

/** The new address when this host is one the app moved off, else null. Case and a trailing dot don't matter; anything else must match exactly. */
export function movedTo(hostname: string): string | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  return RETIRED_HOSTS.includes(host) ? HOME_HOST : null
}
