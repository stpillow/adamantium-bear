import { describe, expect, it } from 'vitest'
import type { SessionTemplate } from '../schema/index.ts'
import { RETRO_DAYS, isLateEntry, lateLift, lateStartedAt, retroDates, type LateLiftInput } from './retro.ts'

const START = '2026-11-02' // a Monday: week 1

const template = (id: string, phase: number, letter: 'A' | 'B' | 'C'): SessionTemplate => ({
  id,
  phase,
  letter,
  slots: [{ id: `${id}-1`, order: 1, label: '1', exerciseId: 'leg-press', sets: 3, repsMin: 8, repsMax: 10, repUnit: 'reps', unilateral: false, injuredOnly: false, prescriptionText: '3 × 8–10', cues: [], progressionRule: 'fixed', substitutionIds: [], optional: false }],
})
const TEMPLATES = [template('p1-a', 1, 'A'), template('p1-b', 1, 'B'), template('p2-a', 2, 'A')]

describe('retroDates', () => {
  it('is the days before today back to the program start, oldest first', () => {
    expect(retroDates('2026-11-02', START)).toEqual([])
    expect(retroDates('2026-11-05', START)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04'])
  })

  it('goes back at most RETRO_DAYS', () => {
    const days = retroDates('2026-12-10', START)
    expect(days).toHaveLength(RETRO_DAYS)
    expect(days[0]).toBe('2026-11-26')
    expect(days.at(-1)).toBe('2026-12-09')
  })

  it('never reaches before the given program week’s Monday', () => {
    // Week 4 starts Monday Nov 23.
    expect(retroDates('2026-11-25', START, 4)).toEqual(['2026-11-23', '2026-11-24'])
    expect(retroDates('2026-11-23', START, 4)).toEqual([])
  })
})

describe('the late-entry stamp', () => {
  it('is a fixed 17:00 UTC marker on the day, compared as a string, never read as a time or a date (PROGRAM-QUESTIONS 212), and tells a late session from one started live', () => {
    expect(lateStartedAt('2026-11-04')).toBe('2026-11-04T17:00:00.000Z')
    expect(isLateEntry({ date: '2026-11-04', startedAt: '2026-11-04T17:00:00.000Z' })).toBe(true)
    expect(isLateEntry({ date: '2026-11-04', startedAt: '2026-11-04T12:31:09.120Z' })).toBe(false)
    expect(isLateEntry({ date: '2026-11-04' })).toBe(false)
  })
})

describe('lateLift', () => {
  const base: LateLiftInput = { date: '2026-11-04', today: '2026-11-06', startDate: START, currentPhase: 1, phaseEnteredWeek: 1, letter: 'A', templates: TEMPLATES, workouts: [], locationId: 'loc-1' }

  it('makes the session for the day, with its week and deload from the date, stamped late, at the gym given', () => {
    const made = lateLift(base)
    expect(made).toEqual({
      ok: true,
      workout: { id: '2026-11-04-p1-a', date: '2026-11-04', templateId: 'p1-a', phase: 1, week: 1, isDeload: false, startedAt: '2026-11-04T17:00:00.000Z', status: 'in-progress', locationId: 'loc-1' },
    })
  })

  it('stamps a deload week from the date', () => {
    const made = lateLift({ ...base, date: '2026-11-24', today: '2026-11-26' })
    expect(made.ok && made.workout).toMatchObject({ week: 4, isDeload: true })
  })

  it('refuses today, a day outside the window or before this phase, a day with no lift, and a phase with no such session', () => {
    expect(lateLift({ ...base, date: '2026-11-06' })).toEqual({ ok: false, reason: 'Today’s session starts from Today.' })
    expect(lateLift({ ...base, date: '2026-10-30' }).ok).toBe(false)
    expect(lateLift({ ...base, today: '2026-11-25', date: '2026-11-04' })).toMatchObject({ ok: false, reason: expect.stringMatching(/last 14 days/) })
    expect(lateLift({ ...base, phaseEnteredWeek: 2 })).toMatchObject({ ok: false, reason: expect.stringMatching(/this phase/) })
    expect(lateLift({ ...base, letter: null })).toEqual({ ok: false, reason: 'No lift is scheduled that day.' })
    expect(lateLift({ ...base, letter: 'C' })).toEqual({ ok: false, reason: 'No Session C is written for phase 1.' })
  })

  it('refuses a day whose session of that letter is already started, finished or left early, but not one only planned', () => {
    for (const status of ['in-progress', 'finished', 'abandoned'] as const) {
      expect(lateLift({ ...base, workouts: [{ id: '2026-11-04-p1-a', date: '2026-11-04', templateId: 'p1-a', status }] })).toEqual({ ok: false, reason: 'Session A is already logged for that day.' })
    }
    const planned = lateLift({ ...base, workouts: [{ id: '2026-11-04-p1-a', date: '2026-11-04', templateId: 'p1-a', status: 'planned' }] })
    expect(planned.ok && planned.workout.id).toBe('2026-11-04-p1-a-2')
    // Another letter that day is no bar.
    expect(lateLift({ ...base, workouts: [{ id: 'x', date: '2026-11-04', templateId: 'p1-b', status: 'finished' }] }).ok).toBe(true)
  })
})
