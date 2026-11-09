import type { Route } from '../app/router.ts'

export type TabName = 'today' | 'week' | 'progress' | 'gates' | 'more'

/**
 * The tab each screen sits under, so the bar underlines where he is. A record over every route
 * name: a new route without a tab fails to compile instead of leaving the bar with nothing underlined.
 */
const TAB_OF: Record<Route['name'], TabName> = {
  today: 'today',
  session: 'today',
  week: 'week',
  progress: 'progress',
  gates: 'gates',
  more: 'more',
  morning: 'more',
  run: 'more',
  program: 'more',
  settings: 'more',
  locations: 'more',
  location: 'more',
  'new-location': 'more',
  'next-update': 'more',
  strava: 'more',
  preview: 'week',
  /** The KOOS form: its scores live on Progress (Batch A), wherever the tap came from. */
  koos: 'progress',
  /** The ACL-RSI form: reached from gate 3's item row (Batch A). */
  'acl-rsi': 'gates',
  /** First run (M-U1): the tab bar is hidden while it shows; Today is where it ends. */
  welcome: 'today',
}

export function activeTab(route: Route): TabName {
  return TAB_OF[route.name]
}
