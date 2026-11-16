import type { Day, DaySession, IsoDate, SessionMove, WeeklyTemplate } from '../schema/index.ts'

/** Deload weeks, counted from startDate (PROMPT rule 6). Phase 4's schedule isn't written yet. */
export const DELOAD_WEEKS: readonly number[] = [4, 8, 12]

export function isDeloadWeek(week: number): boolean {
  return DELOAD_WEEKS.includes(week)
}

/** Weeks start Monday (PROMPT section 2). */
export const DAYS: readonly Day[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const MS_PER_DAY = 86_400_000

/**
 * Calendar arithmetic on YYYY-MM-DD strings, done on whole UTC days, so a daylight-saving change in
 * any time zone (New York's fell on Nov 1, 2026, the day before week 1) can never shift a week
 * boundary: only `todayIn` touches a zone, and it returns a date.
 */
function dayNumber(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number)
  if (y === undefined || m === undefined || d === undefined || Number.isNaN(y + m + d)) {
    throw new RangeError(`not a YYYY-MM-DD date: ${date}`)
  }
  // setUTCFullYear, not Date.UTC, which reads years 0 to 99 as 1900 to 1999.
  const day = new Date(0)
  day.setUTCFullYear(y, m - 1, d)
  return day.getTime() / MS_PER_DAY
}

function fromDayNumber(n: number): IsoDate {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10)
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return dayNumber(to) - dayNumber(from)
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(dayNumber(date) + days)
}

/** Program week of a date (PROMPT rule 10): week 1 starts on startDate; 0 or less before the program. */
export function weekOf(date: IsoDate, startDate: IsoDate): number {
  return Math.floor(daysBetween(startDate, date) / 7) + 1
}

export function dayOf(date: IsoDate): Day {
  const utcDay = new Date(dayNumber(date) * MS_PER_DAY).getUTCDay() // 0 = Sunday
  return DAYS[(utcDay + 6) % 7] ?? 'mon'
}

export function isMonday(date: IsoDate): boolean {
  return dayOf(date) === 'mon'
}

/** The date of a day in a program week. */
export function dateOf(startDate: IsoDate, week: number, day: Day): IsoDate {
  return addDays(startDate, (week - 1) * 7 + DAYS.indexOf(day))
}

/**
 * Today's calendar date in a time zone, from a clock instant. The only place the engine touches a
 * time zone, and it takes the zone every time (the user's setting since M-U1, America/New_York by
 * default, PROGRAM-QUESTIONS 203): there is no default here, so no caller can fall back to one
 * silently. Throws on a zone the phone doesn't know; the setting is checked before it gets here.
 */
export function todayIn(now: Date, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (type: string) => parts.find((p) => p.type === type)?.value
  const y = part('year')
  const m = part('month')
  const d = part('day')
  if (!y || !m || !d) throw new Error(`could not format a date for ${timeZone}`)
  // Intl writes year 1 as "1"; a date here is always YYYY-MM-DD.
  return `${y.padStart(4, '0')}-${m}-${d}`
}

/** The Monday a program would start on, from today: today when today is a Monday, else the next one (first run's default, PROGRAM-QUESTIONS 208). */
export function comingMonday(today: IsoDate): IsoDate {
  return addDays(today, (7 - DAYS.indexOf(dayOf(today))) % 7)
}

export interface TimeZoneChange {
  /** Today in the zone the dates are counted in now. */
  todayFrom: IsoDate
  /** Today in the zone they would be counted in. */
  todayTo: IsoDate
  /** Days from the one to the other: 0 most of the day; ±1 near midnight; ±2 when the offsets differ by more than 24 hours. */
  shift: number
}

/**
 * What changing the time zone does at one instant (PROGRAM-QUESTIONS 205): today's date in each
 * zone and the days between them. Nothing stored moves: logs keep the dates they were saved on, and
 * weeks start on the same Mondays; only which date is today can change, near midnight.
 */
export function timeZoneChange(now: Date, from: string, to: string): TimeZoneChange {
  const todayFrom = todayIn(now, from)
  const todayTo = todayIn(now, to)
  return { todayFrom, todayTo, shift: daysBetween(todayFrom, todayTo) }
}

/** The seven days of a program week with the template's sessions, after any moves. A move swaps two days. */
export function weekSchedule(template: WeeklyTemplate, week: number, moves: readonly SessionMove[]): Record<Day, DaySession> {
  const schedule: Record<Day, DaySession> = { ...template }
  for (const move of moves) {
    if (move.week !== week || move.dayA === move.dayB) continue
    const a = schedule[move.dayA]
    schedule[move.dayA] = schedule[move.dayB]
    schedule[move.dayB] = a
  }
  return schedule
}

export interface ScheduledDay {
  date: IsoDate
  week: number
  day: Day
  /** Null before the program starts. */
  session: DaySession | null
}

/** What a date holds: its program week, weekday, and the session scheduled there after moves. */
export function scheduledSession(
  date: IsoDate,
  startDate: IsoDate,
  template: WeeklyTemplate,
  moves: readonly SessionMove[],
): ScheduledDay {
  const week = weekOf(date, startDate)
  const day = dayOf(date)
  if (week < 1) return { date, week, day, session: null }
  return { date, week, day, session: weekSchedule(template, week, moves)[day] }
}

/**
 * The first date on or after `from` whose scheduled session (after moves) is a lift, within
 * `horizonDays`; null before the program starts within that window or when none falls in it.
 */
export function nextLiftDate(
  from: IsoDate,
  startDate: IsoDate,
  template: WeeklyTemplate,
  moves: readonly SessionMove[],
  horizonDays = 14,
): IsoDate | null {
  for (let i = 0; i < horizonDays; i++) {
    const date = addDays(from, i)
    const { session } = scheduledSession(date, startDate, template, moves)
    if (session !== null && session.startsWith('lift:')) return date
  }
  return null
}

/**
 * The date a session falls on in a program week, after moves (the first day it is scheduled on);
 * null when the week doesn't schedule it or is before the program. The Morning check's "next time"
 * plans the next session of yesterday's letter on this day (Batch E: a down period pauses by the day planned).
 */
export function sessionDateInWeek(startDate: IsoDate, week: number, template: WeeklyTemplate, moves: readonly SessionMove[], session: DaySession): IsoDate | null {
  if (week < 1) return null
  const schedule = weekSchedule(template, week, moves)
  const day = DAYS.find((d) => schedule[d] === session)
  return day === undefined ? null : dateOf(startDate, week, day)
}
