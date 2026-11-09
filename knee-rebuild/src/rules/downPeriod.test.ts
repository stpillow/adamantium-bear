import { describe, expect, it } from 'vitest'
import { DownPeriod } from '../schema/index.ts'
import {
  DOWN_PERIOD_DEFAULT_DAYS,
  DOWN_PERIOD_MAX_DAYS,
  DOWN_PERIOD_MIN_DAYS,
  activeDownPeriod,
  bandHeldNote,
  bandWeek,
  coveringPeriod,
  declareProblem,
  downPeriodWords,
  endProblem,
  endedEarly,
  extendProblem,
  extended,
  isPaused,
  lastPausedDay,
  latestEnd,
  newDownPeriod,
  pauseOn,
  pausedNote,
  plannedDays,
  resumeProblem,
  resumed,
  standingPeriod,
  weekHeld,
} from './downPeriod.ts'

const START = '2026-11-02'
const AT = '2026-11-14T08:00:00-05:00'
/** P1: declared Sat Nov 14 for 7 days, to Fri Nov 20 (the design's worked examples). */
const P1 = DownPeriod.parse(newDownPeriod({ today: '2026-11-14', days: 7, declaredAt: AT }))

describe('a declared period', () => {
  it('starts today and runs its days, start included', () => {
    expect(P1).toEqual({ id: 'dp-2026-11-14', start: '2026-11-14', plannedEnd: '2026-11-20', declaredAt: AT })
    expect(plannedDays(P1)).toBe(7)
    expect(latestEnd(P1)).toBe('2026-11-27')
    expect(newDownPeriod({ today: '2026-11-14', days: 3, declaredAt: AT, note: '  Flu ' })).toMatchObject({ plannedEnd: '2026-11-16', note: 'Flu' })
    expect('note' in newDownPeriod({ today: '2026-11-14', days: 3, declaredAt: AT, note: '   ' })).toBe(false)
    expect([DOWN_PERIOD_MIN_DAYS, DOWN_PERIOD_DEFAULT_DAYS, DOWN_PERIOD_MAX_DAYS]).toEqual([3, 7, 14])
  })

  it('pauses from its start through its planned end, inclusive, and not the day after', () => {
    expect(isPaused('2026-11-13', [P1])).toBe(false)
    expect(isPaused('2026-11-14', [P1])).toBe(true)
    expect(isPaused('2026-11-20', [P1])).toBe(true)
    expect(isPaused('2026-11-21', [P1])).toBe(false)
    expect(isPaused('2026-11-16', [])).toBe(false)
  })

  it('ended early, pauses through the day it was ended and no further', () => {
    const ended = endedEarly(P1, '2026-11-17')
    expect(lastPausedDay(ended)).toBe('2026-11-17')
    expect(isPaused('2026-11-17', [ended])).toBe(true)
    expect(isPaused('2026-11-18', [ended])).toBe(false)
  })

  it('says which day of how many, and until when (the last paused day, not the planned end)', () => {
    expect(pauseOn('2026-11-16', [P1])).toEqual({ start: '2026-11-14', until: '2026-11-20', untilWords: 'Friday Nov 20', day: 3, of: 7 })
    expect(pauseOn('2026-11-17', [endedEarly(P1, '2026-11-17')])).toEqual({ start: '2026-11-14', until: '2026-11-17', untilWords: 'Tuesday Nov 17', day: 4, of: 7 })
    expect(pauseOn('2026-11-21', [P1])).toBeNull()
    expect(pausedNote({ untilWords: 'Friday Nov 20' })).toBe('Down period: progression paused until Friday Nov 20.')
  })

  it('reads overlapping rows as the one that runs latest', () => {
    const later = DownPeriod.parse({ id: 'dp-2026-11-16', start: '2026-11-16', plannedEnd: '2026-11-25', declaredAt: AT })
    expect(coveringPeriod('2026-11-17', [P1, later])?.id).toBe('dp-2026-11-16')
    expect(coveringPeriod('2026-11-17', [later, P1])?.id).toBe('dp-2026-11-16')
    expect(coveringPeriod('2026-11-15', [P1, later])?.id).toBe('dp-2026-11-14')
    expect(activeDownPeriod('2026-11-17', [P1, later])?.id).toBe('dp-2026-11-16')
  })

  it('in words, as history', () => {
    expect(downPeriodWords(P1)).toBe('Saturday Nov 14 to Friday Nov 20 (7 days)')
    expect(downPeriodWords(endedEarly(P1, '2026-11-17'))).toBe('Saturday Nov 14 to Friday Nov 20, ended early on Tuesday Nov 17 (4 of 7 days)')
  })
})

describe('which run weeks hold', () => {
  it('a week holds when its Monday is inside a period', () => {
    // P1 covers Mon Nov 16 (week 3), not Mon Nov 9 (week 2) or Mon Nov 23 (week 4).
    expect([1, 2, 3, 4].map((w) => weekHeld(START, w, [P1]))).toEqual([false, false, true, false])
    // Ended early on Tue Nov 17: week 3's Monday was covered, so it still holds.
    expect(weekHeld(START, 3, [endedEarly(P1, '2026-11-17')])).toBe(true)
    // Declared Wed Nov 11 for 7 days (to Tue Nov 17): week 2's step up already happened.
    const p4 = newDownPeriod({ today: '2026-11-11', days: 7, declaredAt: AT })
    expect([2, 3, 4].map((w) => weekHeld(START, w, [p4]))).toEqual([false, true, false])
    // Ended on its Sunday, the next Monday is free.
    const sat = newDownPeriod({ today: '2026-11-14', days: 3, declaredAt: AT })
    expect(weekHeld(START, 3, [endedEarly(sat, '2026-11-15')])).toBe(false)
  })
})

describe('the phase-week bands', () => {
  const base = { startDate: START, phaseEnteredWeek: 1 }
  it('stay at the band the period began in', () => {
    // P1 began in week 2; on Mon Nov 16 (week 3) the calendar's phase week is 3, the band stays at 2.
    expect(bandWeek({ ...base, date: '2026-11-16', phaseWeek: 3, periods: [P1] })).toBe(2)
    expect(bandWeek({ ...base, date: '2026-11-14', phaseWeek: 2, periods: [P1] })).toBe(2)
    expect(bandWeek({ ...base, date: '2026-11-16', phaseWeek: 3, periods: [] })).toBe(3)
  })
  it('resume where they stopped: one phase week on for each Monday since the last paused day, never the calendar’s jump', () => {
    // P1 held week 3's Monday, so the step to band week 3 waits for the next Monday: Sat Nov 21 is still 2, Mon Nov 23 is 3.
    expect(bandWeek({ ...base, date: '2026-11-21', phaseWeek: 3, periods: [P1] })).toBe(2)
    expect(bandWeek({ ...base, date: '2026-11-23', phaseWeek: 4, periods: [P1] })).toBe(3)
    expect(bandWeek({ ...base, date: '2026-11-30', phaseWeek: 5, periods: [P1] })).toBe(4)
    // A period that covers no Monday delays nothing.
    const midweek = newDownPeriod({ today: '2026-11-17', days: 3, declaredAt: AT })
    expect(bandWeek({ ...base, date: '2026-11-20', phaseWeek: 3, periods: [midweek] })).toBe(3)
    expect(bandWeek({ ...base, date: '2026-11-23', phaseWeek: 4, periods: [midweek] })).toBe(4)
  })
  it('a 14-day period over phase weeks 3 and 4 resumes at band week 4, not the calendar’s 5', () => {
    // Mon Nov 16 (phase week 3) to Sun Nov 29 (phase week 4); Tue Dec 1 is phase week 5 on the calendar.
    const long = newDownPeriod({ today: '2026-11-16', days: 14, declaredAt: AT })
    expect(bandWeek({ ...base, date: '2026-11-29', phaseWeek: 4, periods: [long] })).toBe(3)
    expect(bandWeek({ ...base, date: '2026-12-01', phaseWeek: 5, periods: [long] })).toBe(4)
    expect(bandWeek({ ...base, date: '2026-12-08', phaseWeek: 6, periods: [long] })).toBe(5)
    // From the Sunday of phase week 2: held at 2, then 3 and 4 before 5.
    const fromSunday = newDownPeriod({ today: '2026-11-15', days: 14, declaredAt: AT })
    expect([['2026-12-01', 5], ['2026-12-08', 6], ['2026-12-15', 7]].map(([date, w]) => bandWeek({ ...base, date: date as string, phaseWeek: w as number, periods: [fromSunday] }))).toEqual([3, 4, 5])
  })
  it('back-to-back and overlapping rows hold as one stretch, from the first one’s band', () => {
    const second = newDownPeriod({ today: '2026-11-21', days: 7, declaredAt: AT })
    // P1 then a second from Sat Nov 21 to Fri Nov 27: Mon Nov 23 stays at P1's band 2.
    expect(bandWeek({ ...base, date: '2026-11-23', phaseWeek: 4, periods: [P1, second] })).toBe(2)
    expect(bandWeek({ ...base, date: '2026-11-30', phaseWeek: 5, periods: [second, P1] })).toBe(3)
    const overlap = DownPeriod.parse({ id: 'dp-2026-11-16', start: '2026-11-16', plannedEnd: '2026-11-25', declaredAt: AT })
    expect(bandWeek({ ...base, date: '2026-11-24', phaseWeek: 4, periods: [P1, overlap] })).toBe(2)
  })
  it('two periods apart: the second holds where the first left the bands', () => {
    // P1 (band 2, held through week 3's Monday) leaves the bands a week behind, then Mon Dec 7 for 7 days: band 5 on Dec 7 (the calendar's 6), held through Sun Dec 13.
    const later = newDownPeriod({ today: '2026-12-07', days: 7, declaredAt: AT })
    expect(bandWeek({ ...base, date: '2026-12-07', phaseWeek: 6, periods: [P1, later] })).toBe(5)
    expect(bandWeek({ ...base, date: '2026-12-13', phaseWeek: 6, periods: [P1, later] })).toBe(5)
    expect(bandWeek({ ...base, date: '2026-12-14', phaseWeek: 7, periods: [P1, later] })).toBe(6)
    // A period stored ahead of the date changes nothing yet.
    expect(bandWeek({ ...base, date: '2026-11-13', phaseWeek: 2, periods: [later] })).toBe(2)
  })
  it('count from the week the phase was entered, never below week 1 or above the calendar’s', () => {
    expect(bandWeek({ startDate: START, phaseEnteredWeek: 3, date: '2026-11-17', phaseWeek: 1, periods: [P1] })).toBe(1)
    expect(bandWeek({ startDate: START, phaseEnteredWeek: 2, date: '2026-11-16', phaseWeek: 2, periods: [P1] })).toBe(1)
    expect(bandWeek({ ...base, date: '2026-11-15', phaseWeek: 1, periods: [P1] })).toBe(1)
  })
})

describe('declaring', () => {
  it('takes 3 to 14 whole days', () => {
    expect(declareProblem([], '2026-11-14', 3)).toBeNull()
    expect(declareProblem([], '2026-11-14', 14)).toBeNull()
    for (const days of [0, 2, 15, 7.5, Number.NaN]) expect(declareProblem([], '2026-11-14', days)).toBe('A down period runs 3 to 14 days.')
  })
  it('one at a time: refused while one is on, ended today, or stored ahead; allowed the day after one ends', () => {
    expect(declareProblem([P1], '2026-11-16', 7)).toBe('A down period is already on until Friday Nov 20: make it longer instead.')
    expect(declareProblem([P1], '2026-11-20', 7)).toBe('A down period is already on until Friday Nov 20: make it longer instead.')
    expect(declareProblem([P1], '2026-11-21', 7)).toBeNull()
    const ended = endedEarly(P1, '2026-11-17')
    expect(declareProblem([ended], '2026-11-17', 7)).toBe('The down period from Saturday Nov 14 ended today: tap Keep it going to pick it back up, or start a new one from tomorrow.')
    expect(declareProblem([ended], '2026-11-18', 7)).toBeNull()
    const ahead = newDownPeriod({ today: '2026-11-23', days: 5, declaredAt: AT })
    expect(declareProblem([ahead], '2026-11-16', 7)).toBe('A down period from Monday Nov 23 is already stored, so a new one can’t start before it ends.')
    expect(standingPeriod('2026-11-16', [P1, ahead])?.id).toBe('dp-2026-11-23')
    expect(activeDownPeriod('2026-11-16', [ahead])).toBeNull()
  })
})

describe('extending, ending and keeping it going', () => {
  it('extends the standing period up to 14 days from its start', () => {
    expect(extendProblem([P1], P1.id, '2026-11-22', '2026-11-16')).toBeNull()
    expect(extendProblem([P1], P1.id, '2026-11-27', '2026-11-16')).toBeNull()
    expect(extendProblem([P1], P1.id, '2026-11-28', '2026-11-16')).toBe('A down period runs at most 14 days, to Friday Nov 27 for this one.')
    expect(extendProblem([P1], P1.id, '2026-11-20', '2026-11-16')).toBe('It already runs to Friday Nov 20.')
    expect(extendProblem([P1], 'dp-x', '2026-11-22', '2026-11-16')).toBe('That down period isn’t stored any more.')
    expect(extendProblem([P1], P1.id, '2026-11-22', '2026-11-21')).toBe('That down period ended Friday Nov 20.')
    expect(extendProblem([endedEarly(P1, '2026-11-17')], P1.id, '2026-11-22', '2026-11-17')).toBe('It was ended today: tap Keep it going first.')
    const next = newDownPeriod({ today: '2026-11-23', days: 3, declaredAt: AT })
    expect(extendProblem([P1, next], P1.id, '2026-11-24', '2026-11-16')).toBe('Another down period starts Monday Nov 23, so this one can run to Sunday Nov 22 at most.')
    expect(extended(P1, '2026-11-22')).toEqual({ ...P1, plannedEnd: '2026-11-22' })
  })
  it('ends early in one tap, not on its last planned day, not twice', () => {
    expect(endProblem([P1], P1.id, '2026-11-17')).toBeNull()
    expect(endProblem([P1], P1.id, '2026-11-14')).toBeNull()
    expect(endProblem([P1], P1.id, '2026-11-20')).toBe('Today is its last planned day: it ends tonight on its own.')
    expect(endProblem([endedEarly(P1, '2026-11-17')], P1.id, '2026-11-17')).toBe('It was already ended today.')
    expect(endProblem([P1], P1.id, '2026-11-13')).toBe('That down period starts Saturday Nov 14, not yet.')
    expect(DownPeriod.safeParse(endedEarly(P1, '2026-11-17')).success).toBe(true)
  })
  it('keeps it going only on the day it was ended', () => {
    const ended = endedEarly(P1, '2026-11-17')
    expect(resumeProblem([ended], P1.id, '2026-11-17')).toBeNull()
    expect(resumeProblem([ended], P1.id, '2026-11-18')).toBe('Only a down period ended today can be kept going.')
    expect(resumeProblem([P1], P1.id, '2026-11-17')).toBe('Only a down period ended today can be kept going.')
    expect(resumed(ended)).toEqual(P1)
  })
})

describe('bandHeldNote (why the bands sit behind the calendar)', () => {
  it('says nothing when the band is the calendar\'s', () => {
    expect(bandHeldNote({ date: '2026-11-16', calendarPhaseWeek: 3, band: 3, periods: [P1] })).toBeNull()
  })
  it('inside a period, gives the pause and its last day', () => {
    expect(bandHeldNote({ date: '2026-11-16', calendarPhaseWeek: 3, band: 2, periods: [P1] })).toBe('Down period: progression paused until Friday Nov 20.')
  })
  it('after a period, says how far behind the calendar the bands run', () => {
    expect(bandHeldNote({ date: '2026-11-30', calendarPhaseWeek: 5, band: 4, periods: [P1] })).toBe('After the down period, the phase-week work runs 1 week behind the calendar.')
    expect(bandHeldNote({ date: '2026-11-30', calendarPhaseWeek: 5, band: 3, periods: [P1] })).toBe('After the down period, the phase-week work runs 2 weeks behind the calendar.')
  })
})
