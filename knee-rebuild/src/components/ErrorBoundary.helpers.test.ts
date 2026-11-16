import { describe, expect, it } from 'vitest'
import { SCREEN_NAMES, crashWords, storageFailedWords } from './ErrorBoundary.helpers.ts'

describe('crashWords: what a screen that threw says instead of a blank app', () => {
  it('names the screen, says in words that what was saved is kept, and points to Today or Reload', () => {
    expect(crashWords('week')).toEqual({
      title: 'Week stopped',
      sentence: 'Something on the Week screen went wrong, so it stopped rather than show you something wrong. Everything already saved stays on this phone.',
      next: 'Go to Today, or reload the app.',
    })
    expect(crashWords('session').sentence).toContain('the Session runner screen')
  })

  it('says the same of the whole app when no screen can be named', () => {
    expect(crashWords(null)).toEqual({
      title: 'The app stopped',
      sentence: 'Something in the app went wrong, so it stopped rather than show you something wrong. Everything already saved stays on this phone.',
      next: 'Go to Today, or reload the app.',
    })
  })

  it('names every route by the words its screen or button uses, each once', () => {
    expect(SCREEN_NAMES).toEqual({
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
    })
    const names = Object.values(SCREEN_NAMES)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('storageFailedWords: what the app says when storage can’t be opened at launch', () => {
  it('names the phone’s refusal, the private-browsing case, and Reload as the way on', () => {
    expect(storageFailedWords('settings row is not readable', false)).toEqual({
      title: 'Storage could not be opened',
      sentence: 'The app keeps everything on this phone, and the phone refused: settings row is not readable. Private browsing blocks it on iOS; open the app from the home screen icon instead.',
      next: 'Reload tries again. Everything already saved stays on this phone.',
    })
  })

  it('points to the new version when one is waiting: a build that can’t read storage is replaced by Reload now, without force-quitting', () => {
    expect(storageFailedWords('x', true).next).toBe('A new version is ready, and it may read storage where this one can’t. Reload now brings it in; everything already saved stays on this phone.')
  })
})
