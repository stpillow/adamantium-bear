import { describe, expect, it } from 'vitest'
import { activityDate, candidates, classify, hrFromStrava, rpeFromExertion, importedStravaIds, stravaActivityUrl, stravaIdFromUrl, syncAfter, type ClassifyContext, type StravaActivity } from './stravaImport.ts'

const DATES = ['2026-11-04', '2026-11-05', '2026-11-06']
const ctx: ClassifyContext = { dates: DATES, scheduledRun: (d) => (d === '2026-11-05' ? 'mbr' : null) }
const act = (over: Partial<StravaActivity> = {}): StravaActivity => ({ id: 1234567890, name: 'Morning Run', sport_type: 'Run', distance: 5000, moving_time: 1633, start_date_local: '2026-11-05T06:30:00Z', ...over })

describe('Strava links', () => {
  it('reads the activity id out of a link the logger stored, and nothing else', () => {
    expect(stravaActivityUrl(42)).toBe('https://www.strava.com/activities/42')
    expect(stravaIdFromUrl('https://www.strava.com/activities/42')).toBe('42')
    expect(stravaIdFromUrl('https://strava.com/activities/42/overview')).toBe('42')
    expect(stravaIdFromUrl('https://www.strava.com/athletes/42')).toBeNull()
    expect(stravaIdFromUrl('http://www.strava.com/activities/42')).toBeNull()
    expect(stravaIdFromUrl(undefined)).toBeNull()
    expect(importedStravaIds([{ stravaUrl: 'https://www.strava.com/activities/7' }, {}, { stravaUrl: 'nope' }])).toEqual(new Set(['7']))
  })
})

describe('the day', () => {
  it('is the athlete’s own clock: a run at 11:30 pm stays on its day despite the Z', () => {
    expect(activityDate({ start_date_local: '2026-11-05T23:30:00Z' })).toBe('2026-11-05')
  })
})

describe('effort', () => {
  it('reads Strava’s exertion as a whole RPE from 1 to 10, rounded and kept inside the scale, and none as none', () => {
    expect([1, 3, 3.4, 3.5, 6, 10].map(rpeFromExertion)).toEqual([1, 3, 3, 4, 6, 10])
    expect(rpeFromExertion(11)).toBe(10)
    expect(rpeFromExertion(0.4)).toBe(1)
    expect(rpeFromExertion(null)).toBeNull()
    expect(rpeFromExertion(undefined)).toBeNull()
    expect(rpeFromExertion(0)).toBeNull()
    expect(rpeFromExertion(-2)).toBeNull()
    expect(rpeFromExertion(Number.NaN)).toBeNull()
  })
})

describe('classify', () => {
  it('makes a run a draft for the run logger: miles to the hundredth, time to the second, the day’s planned run, and always asks max pain', () => {
    const c = classify(act(), ctx)
    expect(c).toEqual({
      kind: 'run',
      activityId: '1234567890',
      draft: { date: '2026-11-05', type: 'mbr', miles: 3.11, minutes: 1633 / 60, rpe: null, avgHr: null, maxHr: null, stravaUrl: 'https://www.strava.com/activities/1234567890', notes: 'Morning Run' },
      needs: ['max pain', 'effort'],
      guessed: [],
    })
  })

  it('takes Strava’s exertion as the effort when there is one; without it, effort waits for Shawn and is never guessed', () => {
    expect(classify(act({ perceived_exertion: 6.6 }), ctx)).toMatchObject({ draft: { rpe: 7 }, needs: ['max pain'], guessed: [] })
    expect(classify(act({ perceived_exertion: null }), ctx)).toMatchObject({ draft: { rpe: null }, needs: ['max pain', 'effort'], guessed: [] })
  })

  it('takes Strava’s long-run mark, and on a day with no run planned guesses easy and asks the type', () => {
    expect(classify(act({ workout_type: 2, start_date_local: '2026-11-06T07:00:00Z' }), ctx)).toMatchObject({ draft: { type: 'long' }, needs: ['max pain', 'effort'], guessed: [] })
    expect(classify(act({ start_date_local: '2026-11-06T07:00:00Z', perceived_exertion: 5 }), ctx)).toMatchObject({ draft: { type: 'easy', rpe: 5 }, needs: ['max pain'], guessed: ['type'] })
  })

  it('makes elliptical and rowing the swaps, at no miles', () => {
    expect(classify(act({ sport_type: 'Elliptical', distance: 4000 }), ctx)).toMatchObject({ kind: 'run', draft: { type: 'elliptical-swap', miles: 0 } })
    expect(classify(act({ sport_type: 'Rowing' }), ctx)).toMatchObject({ kind: 'run', draft: { type: 'rower-swap', miles: 0 } })
    expect(classify(act({ sport_type: 'VirtualRow' }), ctx)).toMatchObject({ kind: 'run', draft: { type: 'rower-swap', miles: 0 } })
  })

  it('carries the watch’s heart rate into the draft, rounded to whole bpm, on runs and swaps alike (metrics phase 2)', () => {
    expect(classify(act({ average_heartrate: 154.6, max_heartrate: 171.2 }), ctx)).toMatchObject({ draft: { avgHr: 155, maxHr: 171 } })
    expect(classify(act({ sport_type: 'Elliptical', average_heartrate: 130, max_heartrate: 150 }), ctx)).toMatchObject({ draft: { type: 'elliptical-swap', avgHr: 130, maxHr: 150 } })
    expect(classify(act({ sport_type: 'Rowing', average_heartrate: 128.4 }), ctx)).toMatchObject({ draft: { type: 'rower-swap', avgHr: 128, maxHr: null } })
  })

  it('heart rate never waits on Shawn and never blocks: absent reads as null, and needs and guessed are untouched by it', () => {
    expect(classify(act({ average_heartrate: null, max_heartrate: null }), ctx)).toMatchObject({ draft: { avgHr: null, maxHr: null }, needs: ['max pain', 'effort'], guessed: [] })
    expect(classify(act({ average_heartrate: 150, max_heartrate: 171 }), ctx)).toMatchObject({ needs: ['max pain', 'effort'], guessed: [] })
  })

  it('drops an out-of-range number to null, never clamps it, and keeps the other of the pair: when max alone is garbage, the average survives', () => {
    expect(hrFromStrava(12, 150)).toEqual({ avgHr: null, maxHr: 150 })
    expect(hrFromStrava(150, 260)).toEqual({ avgHr: 150, maxHr: null })
    expect(hrFromStrava(260.4, 150)).toEqual({ avgHr: null, maxHr: 150 })
    expect(hrFromStrava(29, 251)).toEqual({ avgHr: null, maxHr: null })
    expect(hrFromStrava(Number.NaN, 150)).toEqual({ avgHr: null, maxHr: 150 })
    expect(hrFromStrava(undefined, undefined)).toEqual({ avgHr: null, maxHr: null })
    // 29.5 rounds to 30, the floor; 250.4 rounds to 250, the ceiling: rounding happens before the bounds.
    expect(hrFromStrava(29.5, 250.4)).toEqual({ avgHr: 30, maxHr: 250 })
  })

  it('drops BOTH numbers when the rounded average is above the max: a garbage watch pair is never saved as typed', () => {
    expect(hrFromStrava(171, 150)).toEqual({ avgHr: null, maxHr: null })
    expect(hrFromStrava(150.6, 150)).toEqual({ avgHr: null, maxHr: null })
    expect(hrFromStrava(150.4, 150)).toEqual({ avgHr: 150, maxHr: 150 })
    expect(classify(act({ average_heartrate: 171, max_heartrate: 150 }), ctx)).toMatchObject({ draft: { avgHr: null, maxHr: null } })
  })

  it('reads the older type field when sport_type is absent, and treadmill and trail runs as runs', () => {
    const { sport_type: _s, ...old } = act()
    void _s
    expect(classify({ ...old, type: 'Run' }, ctx).kind).toBe('run')
    expect(classify(act({ sport_type: 'TrailRun' }), ctx).kind).toBe('run')
    expect(classify(act({ sport_type: 'VirtualRun' }), ctx).kind).toBe('run')
  })

  it('points a strength activity at logging the session after the fact', () => {
    expect(classify(act({ sport_type: 'WeightTraining', name: 'Lift' }), ctx)).toEqual({ kind: 'lift', activityId: '1234567890', date: '2026-11-05', name: 'Lift' })
  })

  it('leaves out what the program doesn’t log, and a run older than the days that can be logged, with the reason', () => {
    expect(classify(act({ sport_type: 'Ride', name: 'Commute' }), ctx)).toMatchObject({ kind: 'skip', reason: 'Ride isn’t a run, swap or lift the program logs.' })
    expect(classify(act({ start_date_local: '2026-10-01T07:00:00Z' }), ctx)).toMatchObject({ kind: 'skip', reason: 'It is older than the days a run can be logged for.' })
  })
})

describe('candidates', () => {
  it('offers newest first and never one already logged', () => {
    const list = [act({ id: 1, start_date_local: '2026-11-04T07:00:00Z' }), act({ id: 2, start_date_local: '2026-11-06T07:00:00Z' }), act({ id: 3 })]
    expect(candidates(list, new Set(['3']), ctx).map((c) => c.activityId)).toEqual(['2', '1'])
  })
})

describe('syncAfter', () => {
  it('asks from a day before the earliest loggable day, so a time zone never cuts one off', () => {
    expect(syncAfter(DATES)).toBe(Date.parse('2026-11-03T00:00:00Z') / 1000)
    expect(syncAfter([])).toBeNull()
  })
})
