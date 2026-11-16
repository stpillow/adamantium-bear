import { useEffect, useState } from 'react'

/** First run's steps (M-U1), in order, after its first screen (`#/welcome`): one hash each, so the back gesture steps back. */
export const FIRST_RUN_STEPS = ['side', 'start', 'gym', 'equipment', 'time', 'ready'] as const
export type FirstRunStep = (typeof FIRST_RUN_STEPS)[number]

function isFirstRunStep(text: string | undefined): text is FirstRunStep {
  return (FIRST_RUN_STEPS as readonly string[]).includes(text ?? '')
}

export type Route =
  | { name: 'today' }
  | { name: 'session'; workoutId: string }
  /** The morning check: this morning's, or (Batch D) one for a past morning, `#/morning/2026-11-18`, dated the morning it describes. */
  | { name: 'morning'; date?: string }
  | { name: 'run' }
  | { name: 'week' }
  | { name: 'progress' }
  | { name: 'gates' }
  | { name: 'program' }
  | { name: 'settings' }
  | { name: 'more' }
  /** Where you train (M4b): every gym, from More. */
  | { name: 'locations' }
  /** The location editor for a stored gym. */
  | { name: 'location'; locationId: string }
  /** The location editor for a gym not made yet: from Where you train's New and Today's "New location" (`#/location/new`). */
  | { name: 'new-location' }
  /** For the next program update: what the gyms have that the program doesn't use, from More. */
  | { name: 'next-update' }
  /** A read-only look at one day's session before it comes round (`#/preview/2026-11-05`). */
  | { name: 'preview'; date: string }
  /** Strava import (Nov 6): connect, then pick activities to log. The function's redirect lands here with `?result=`. */
  | { name: 'strava'; result?: string }
  /** The KOOS questionnaire (Batch A): from Today's due line, Progress's section and the Gates offer. */
  | { name: 'koos' }
  /** The ACL-RSI questionnaire (Batch A): from gate 3's item row. */
  | { name: 'acl-rsi' }
  /** First run (M-U1): `#/welcome`, then `#/welcome/side` … `#/welcome/ready`. Shown only on a phone with no settings row. */
  | { name: 'welcome'; step?: FirstRunStep }

/** The editor's id segment that means a gym not made yet. Stored gyms are `planet-fitness` and `loc-N` (src/rules/locations.ts), never this. */
const NEW = 'new'

/** A path segment as written, or null for a malformed escape (a link cut off when copied). */
function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

/** Hash routes, so the home-screen app keeps a working back gesture without a server rewrite. */
/** A YYYY-MM-DD string naming a day that exists (no Feb 30). */
function isCalendarDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const day = new Date(Date.UTC(y, mo - 1, d))
  return day.getUTCFullYear() === y && day.getUTCMonth() === mo - 1 && day.getUTCDate() === d
}

export function parseHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?')
  const parts = path.split('/').filter(Boolean)
  const [head, arg] = parts
  switch (head) {
    case 'session': {
      // A malformed escape lands on Today instead of a blank app.
      const workoutId = arg ? decoded(arg) : null
      return workoutId ? { name: 'session', workoutId } : { name: 'today' }
    }
    case 'preview': {
      // Only a real calendar date opens a preview; anything else lands on Week, where the days are.
      return arg && isCalendarDate(arg) ? { name: 'preview', date: arg } : { name: 'week' }
    }
    case 'location': {
      if (arg === NEW) return { name: 'new-location' }
      const locationId = arg ? decoded(arg) : null
      return locationId ? { name: 'location', locationId } : { name: 'locations' }
    }
    case 'morning':
      // Only a real calendar date opens a past morning's check; anything else is this morning's.
      return arg && isCalendarDate(arg) ? { name: 'morning', date: arg } : { name: 'morning' }
    case 'run':
    case 'week':
    case 'progress':
    case 'gates':
    case 'program':
    case 'settings':
    case 'more':
    case 'locations':
    case 'next-update':
    case 'koos':
    case 'acl-rsi':
      return { name: head }
    case 'welcome':
      return isFirstRunStep(arg) ? { name: 'welcome', step: arg } : { name: 'welcome' }
    case 'strava': {
      const result = new URLSearchParams(query).get('result')
      return result ? { name: 'strava', result } : { name: 'strava' }
    }
    default:
      return { name: 'today' }
  }
}

export function routeHash(route: Route): string {
  switch (route.name) {
    case 'session':
      return `#/session/${encodeURIComponent(route.workoutId)}`
    case 'location':
      return `#/location/${encodeURIComponent(route.locationId)}`
    case 'new-location':
      return `#/location/${NEW}`
    case 'preview':
      return `#/preview/${route.date}`
    case 'morning':
      return route.date ? `#/morning/${route.date}` : '#/morning'
    case 'welcome':
      return route.step ? `#/welcome/${route.step}` : '#/welcome'
    default:
      return `#/${route.name}`
  }
}

export function navigate(route: Route): void {
  window.location.hash = routeHash(route)
}

/**
 * Goes to a route in place of the current history entry: once a new gym is made, the back gesture
 * from its editor returns to where New was tapped, not to an empty New form.
 */
export function replaceRoute(route: Route): void {
  window.location.replace(routeHash(route))
}

/** `history.state` on an entry `navigateFrom` pushed: the hash of the entry under it. */
type Below = { below: string }

/** The `history.state` `navigateFrom` leaves on the entry it pushes from `from`. */
export function stateFrom(from: Route): Below {
  return { below: routeHash(from) }
}

/** Whether going back to `to` is a step back through history: the entry under this one, as `navigateFrom` recorded it, is `to`. */
export function backPops(state: unknown, to: Route): boolean {
  return typeof state === 'object' && state !== null && (state as Partial<Below>).below === routeHash(to)
}

/**
 * Goes to a route as a new history entry, recording the route it was left from, so a Back button on
 * the new screen (`backTo`) can step back through history instead of stacking a second copy of `from`.
 */
export function navigateFrom(route: Route, from: Route): void {
  navigate(route)
  try {
    window.history.replaceState(stateFrom(from), '')
  } catch {
    // Without the record, Back replaces in place: the screen is still right.
  }
}

/**
 * A screen's own Back to `to`: a step back through history when the entry under this one is `to`
 * (it was reached from there by `navigateFrom`), so the next back gesture leaves `to` too; in place
 * of this entry otherwise (a link, a redirect, a route reached from somewhere else).
 */
export function backTo(to: Route): void {
  if (backPops(window.history.state, to)) window.history.back()
  else replaceRoute(to)
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
