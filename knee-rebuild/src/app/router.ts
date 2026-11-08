import { useEffect, useState } from 'react'

export type Route =
  | { name: 'today' }
  | { name: 'session'; workoutId: string }
  | { name: 'morning' }
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

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
