import type { Route } from '../app/router.ts'

/**
 * Each route's screen by the words its title or its button on More uses. A record over every route
 * name: a new route without a name fails to compile instead of a fallback that names nothing.
 */
export const SCREEN_NAMES: Readonly<Record<Route['name'], string>> = {
  today: 'Today',
  session: 'Session runner',
  morning: 'Morning check',
  run: 'Log a run',
  week: 'Week',
  progress: 'Progress',
  gates: 'Gates',
  program: 'Program',
  settings: 'Settings',
  more: 'More',
  locations: 'Where you train',
  location: 'Location editor',
  'new-location': 'New location',
  'next-update': 'For the next program update',
  preview: 'Session preview',
  strava: 'Import from Strava',
  koos: 'KOOS',
  'acl-rsi': 'ACL-RSI',
  welcome: 'Set up Knee Rebuild',
}

export interface CrashWords {
  title: string
  sentence: string
  /** The way out, over the Today and Reload buttons. */
  next: string
}

/**
 * What shows when a screen throws while it renders (a row it can't read, a bug), instead of a blank
 * app: the screen by name and a sentence in words. Never the error's message or its stack: those
 * are for the console, and say nothing Shawn can act on. A render that throws writes nothing, so
 * what was saved before it is still on the phone. `null` is the app itself, outside any screen.
 */
export function crashWords(screen: Route['name'] | null): CrashWords {
  const where = screen === null ? 'in the app' : `on the ${SCREEN_NAMES[screen]} screen`
  return {
    title: `${screen === null ? 'The app' : SCREEN_NAMES[screen]} stopped`,
    sentence: `Something ${where} went wrong, so it stopped rather than show you something wrong. Everything already saved stays on this phone.`,
    next: 'Go to Today, or reload the app.',
  }
}

/**
 * What the app says when storage can't be opened at launch (the phone refused it, or a build reads
 * a stored row it doesn't know: a rollback past a version, PROGRAM-QUESTIONS 132), with the way on:
 * Reload, or, once the service worker has a new version waiting, Reload now to bring it in, so a
 * build that can't read storage is replaced from the screen itself, not by force-quitting the app.
 */
export function storageFailedWords(reason: string, updateReady: boolean): CrashWords {
  return {
    title: 'Storage could not be opened',
    sentence: `The app keeps everything on this phone, and the phone refused: ${reason}. Private browsing blocks it on iOS; open the app from the home screen icon instead.`,
    next: updateReady
      ? 'A new version is ready, and it may read storage where this one can’t. Reload now brings it in; everything already saved stays on this phone.'
      : 'Reload tries again. Everything already saved stays on this phone.',
  }
}
