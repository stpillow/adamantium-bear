import type { Day, IsoDate } from '../schema/index.ts'
import { dayOf } from './calendar.ts'

/*
 * Dates in words (moved from src/screens/Today.helpers.ts in Batch E, so a rule's own sentence, such
 * as a down period's "progression paused until Friday Nov 20", can name a day without importing a
 * screen). Today.helpers re-exports the three, so no screen changed its import.
 */

const WEEKDAY: Record<Day, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function monthAndDay(date: IsoDate): { month: string; day: number } {
  const [, m, d] = date.split('-').map(Number)
  const month = m === undefined ? undefined : MONTH[m - 1]
  if (month === undefined || d === undefined || Number.isNaN(d)) throw new RangeError(`not a YYYY-MM-DD date: ${date}`)
  return { month, day: d }
}

/** "Tuesday, November 3": the screen's lead line. */
export function dateWords(date: IsoDate): string {
  const { month, day } = monthAndDay(date)
  return `${WEEKDAY[dayOf(date)]}, ${month} ${day}`
}

/** "Nov 10": the form a mark-off's date takes. */
export function monthDayWords(date: IsoDate): string {
  const { month, day } = monthAndDay(date)
  return `${month.slice(0, 3)} ${day}`
}

/** "Monday Nov 2": the form the start line uses. */
export function shortDateWords(date: IsoDate): string {
  const { month, day } = monthAndDay(date)
  return `${WEEKDAY[dayOf(date)]} ${month.slice(0, 3)} ${day}`
}
