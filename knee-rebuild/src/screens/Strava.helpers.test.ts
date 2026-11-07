import { describe, expect, it } from 'vitest'
import { joinTime } from './RunLogger.helpers.ts'
import { candidateWords, disconnectWords, needsWords, resultWords } from './Strava.helpers.ts'

describe('resultWords', () => {
  it('says what came back from the consent page', () => {
    expect(resultWords(undefined)).toBeNull()
    expect(resultWords('connected')).toBe('Connected to Strava.')
    expect(resultWords('scope')).toMatch(/left unticked/)
    expect(resultWords('state')).toMatch(/Connect again/)
    expect(resultWords('token')).toMatch(/Try again/)
  })
})

describe('needsWords', () => {
  it('says what Save waits on, and what was filled in by default to check', () => {
    expect(needsWords(['max pain'])).toBe('Max pain to rate before it saves.')
    expect(needsWords(['max pain', 'effort'])).toBe('Max pain and effort to rate before it saves.')
    expect(needsWords(['max pain'], ['type'])).toBe('Max pain to rate before it saves. Check it: the run type is a guess.')
    expect(needsWords([])).toBe('Nothing to fill in.')
  })
})

describe('disconnectWords', () => {
  it('says whether Strava confirmed the disconnect, and where to finish it by hand', () => {
    expect(disconnectWords(true)).toMatch(/can no longer read/)
    expect(disconnectWords(false)).toMatch(/My Apps/)
  })
})

describe('candidateWords', () => {
  it('names a run by day and name, with its miles and time', () => {
    const words = candidateWords({ kind: 'run', activityId: '1', draft: { date: '2026-11-05', type: 'easy', miles: 3.11, minutes: joinTime(27, 13), rpe: null, avgHr: null, maxHr: null, stravaUrl: 'https://www.strava.com/activities/1', notes: 'Morning Run' }, needs: ['max pain', 'effort'], guessed: [] })
    expect(words).toEqual({ title: 'Thursday Nov 5 · Morning Run', detail: 'Run: easy, 3.11 miles, 27:13. Max pain and effort to rate before it saves.' })
  })
  it('gives a swap its time only, and a strength or left-out activity its reason', () => {
    expect(candidateWords({ kind: 'run', activityId: '1', draft: { date: '2026-11-05', type: 'rower-swap', miles: 0, minutes: 30, rpe: 3, avgHr: null, maxHr: null, stravaUrl: '', notes: '' }, needs: ['max pain'], guessed: [] }).detail).toBe('Rower swap, 30 minutes. Max pain to rate before it saves.')
    expect(candidateWords({ kind: 'lift', activityId: '2', date: '2026-11-05', name: 'Lift' }).detail).toMatch(/preview/)
    expect(candidateWords({ kind: 'skip', activityId: '3', date: '2026-11-05', name: 'Commute', reason: 'Ride isn’t a run.' }).detail).toBe('Left out. Ride isn’t a run.')
  })
})
