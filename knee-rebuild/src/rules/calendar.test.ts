import { describe, expect, it } from 'vitest'
import type { WeeklyTemplate } from '../schema/index.ts'
import {
  nextLiftDate,
  sessionDateInWeek,
  addDays,
  dateOf,
  dayOf,
  daysBetween,
  isDeloadWeek,
  isMonday,
  scheduledSession,
  todayIn,
  weekOf,
  weekSchedule,
} from './calendar.ts'

const START = '2026-11-02'
const TEMPLATE: WeeklyTemplate = { mon: 'run:mbr', tue: 'lift:A', wed: 'run:easy', thu: 'lift:B', fri: 'run:long', sat: 'lift:C', sun: 'off' }

describe('isDeloadWeek', () => {
  it('is true for weeks 4, 8 and 12 only', () => {
    const deloads = Array.from({ length: 16 }, (_, i) => i + 1).filter(isDeloadWeek)
    expect(deloads).toEqual([4, 8, 12])
  })
})

describe('weekOf', () => {
  it('week 1 is the seven days from the start date', () => {
    expect(weekOf('2026-11-02', START)).toBe(1)
    expect(weekOf('2026-11-08', START)).toBe(1)
    expect(weekOf('2026-11-09', START)).toBe(2)
  })
  it('is 0 or less before the program and keeps counting past week 12', () => {
    expect(weekOf('2026-11-01', START)).toBe(0)
    expect(weekOf('2026-10-25', START)).toBe(-1)
    expect(weekOf('2027-01-24', START)).toBe(12)
    expect(weekOf('2027-01-25', START)).toBe(13)
  })
  it('is not moved by the DST changes on Nov 1, 2026 and Mar 14, 2027', () => {
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2)
    expect(daysBetween('2027-03-13', '2027-03-15')).toBe(2)
    expect(weekOf('2027-03-14', START)).toBe(19)
  })
})

describe('days', () => {
  it('names weekdays Monday first', () => {
    expect(dayOf('2026-11-02')).toBe('mon')
    expect(dayOf('2026-11-05')).toBe('thu')
    expect(dayOf('2026-11-08')).toBe('sun')
    expect(isMonday(START)).toBe(true)
    expect(isMonday('2026-11-03')).toBe(false)
  })
  it('adds days and finds the date of a week day', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(dateOf(START, 2, 'fri')).toBe('2026-11-13')
    expect(dateOf(START, 12, 'sun')).toBe('2027-01-24')
  })
})

describe('todayIn (America/New_York)', () => {
  it('flips the date at New York midnight, not UTC midnight', () => {
    expect(todayIn(new Date('2026-11-02T04:59:00Z'))).toBe('2026-11-01')
    expect(todayIn(new Date('2026-11-02T05:00:00Z'))).toBe('2026-11-02')
  })
  it('handles the hour DST ends', () => {
    expect(todayIn(new Date('2026-11-01T05:30:00Z'))).toBe('2026-11-01')
    expect(todayIn(new Date('2026-11-01T06:30:00Z'))).toBe('2026-11-01')
  })
  it('writes a year before 1000 in four digits, so it reads back as that year (an imported file’s odd stamp)', () => {
    expect(todayIn(new Date('0001-06-01T12:00:00Z'))).toBe('0001-06-01')
    expect(todayIn(new Date('0999-06-01T12:00:00Z'))).toBe('0999-06-01')
  })
})

describe('day arithmetic in any year', () => {
  it('reads years 0 to 99 as themselves, not as 1900 to 1999', () => {
    expect(daysBetween('0001-01-01', '0001-01-02')).toBe(1)
    expect(daysBetween('0001-01-01', '0002-01-01')).toBe(365)
    expect(daysBetween('0099-12-31', '0100-01-01')).toBe(1)
    expect(daysBetween('1901-01-01', '2026-11-02')).toBe(45_961)
    expect(daysBetween('0001-01-01', '2026-11-02')).toBe(739_921)
    expect(addDays('0001-12-31', 1)).toBe('0002-01-01')
    expect(dayOf('0001-01-01')).toBe('mon')
  })
})

describe('schedule', () => {
  it('follows the weekly template', () => {
    expect(scheduledSession('2026-11-05', START, TEMPLATE, [])).toEqual({ date: '2026-11-05', week: 1, day: 'thu', session: 'lift:B' })
    expect(scheduledSession('2026-11-15', START, TEMPLATE, []).session).toBe('off')
  })
  it('has no session before the program starts', () => {
    expect(scheduledSession('2026-10-31', START, TEMPLATE, []).session).toBeNull()
  })
  it('a move swaps two days of one week only', () => {
    const moves = [{ id: 'mv1', week: 2, dayA: 'thu', dayB: 'fri' }] as const
    const week2 = weekSchedule(TEMPLATE, 2, moves)
    expect(week2.thu).toBe('run:long')
    expect(week2.fri).toBe('lift:B')
    expect(weekSchedule(TEMPLATE, 3, moves)).toEqual(TEMPLATE)
    expect(scheduledSession('2026-11-12', START, TEMPLATE, moves).session).toBe('run:long')
  })
})

describe('nextLiftDate', () => {
  const template: WeeklyTemplate = { mon: 'run:mbr', tue: 'lift:A', wed: 'run:easy', thu: 'lift:B', fri: 'run:long', sat: 'lift:C', sun: 'off' }
  it('finds the next lift on or after a date, after moves', () => {
    expect(nextLiftDate('2026-11-02', '2026-11-02', template, [])).toBe('2026-11-03')
    expect(nextLiftDate('2026-11-03', '2026-11-02', template, [])).toBe('2026-11-03')
    expect(nextLiftDate('2026-11-08', '2026-11-02', template, [])).toBe('2026-11-10')
    expect(nextLiftDate('2026-11-02', '2026-11-02', template, [{ id: 'move-000001', week: 1, dayA: 'tue', dayB: 'wed' }])).toBe('2026-11-04')
  })
  it('skips the days before the program starts, and gives up past the window', () => {
    expect(nextLiftDate('2026-10-30', '2026-11-02', template, [])).toBe('2026-11-03')
    expect(nextLiftDate('2026-10-01', '2026-11-02', template, [], 14)).toBeNull()
  })
})


describe('sessionDateInWeek (Batch E)', () => {
  const TEMPLATE: WeeklyTemplate = { mon: 'run:mbr', tue: 'lift:A', wed: 'run:easy', thu: 'lift:B', fri: 'run:long', sat: 'lift:C', sun: 'off' }
  it('finds the day a session falls on in a week, after moves', () => {
    expect(sessionDateInWeek('2026-11-02', 4, TEMPLATE, [], 'lift:A')).toBe('2026-11-24')
    expect(sessionDateInWeek('2026-11-02', 3, TEMPLATE, [], 'lift:C')).toBe('2026-11-21')
    expect(sessionDateInWeek('2026-11-02', 4, TEMPLATE, [{ id: 'm', week: 4, dayA: 'tue', dayB: 'wed' }], 'lift:A')).toBe('2026-11-25')
    expect(sessionDateInWeek('2026-11-02', 3, TEMPLATE, [{ id: 'm', week: 4, dayA: 'tue', dayB: 'wed' }], 'lift:A')).toBe('2026-11-17')
  })
  it('null before the program, or when the week has no such session', () => {
    expect(sessionDateInWeek('2026-11-02', 0, TEMPLATE, [], 'lift:A')).toBeNull()
    expect(sessionDateInWeek('2026-11-02', 2, { ...TEMPLATE, tue: 'off' }, [], 'lift:A')).toBeNull()
  })
})
