import type { IsoDate, MorningCheck, RedFlag, Settings } from '../schema/index.ts'
import { addDays } from './calendar.ts'
import { isLateCheck } from './lateCheck.ts'
import { RETRO_DAYS } from './retro.ts'

export type RedFlagState = Settings['redFlag']

export const NO_RED_FLAG: RedFlagState = { active: false, items: [] }

export const STOP_HEADLINE = 'Stop. Call the ortho or PT.'

/**
 * Rule 9: any ticked red flag on a morning check for today puts the app in the red-flag state. A
 * check logged late, for a past morning (Batch D, Shawn's Nov 8 decision 12), never does: the state
 * comes back unchanged, the same object, whoever calls this. Its flags show as a note instead
 * (lateFlagNotes), and its reading still counts them (morningReading: back off at best).
 */
export function afterMorningCheck(state: RedFlagState, check: MorningCheck): RedFlagState {
  if (isLateCheck(check)) return state
  if (check.redFlags.length === 0) return state
  const items = Array.from(new Set([...(state.active ? state.items : []), ...check.redFlags]))
  return { active: true, since: state.active && state.since ? state.since : check.date, items }
}

/**
 * Rule 9 over today's checks, for a state that may not have seen them: a check saved while the phone
 * ran tester mode writes no state (M-U3), so when the same phone runs full, today's flagged check is
 * folded in here (afterMorningCheck each). A state cleared today, with its note, stays cleared: the
 * clear is the later act (PROGRAM-QUESTIONS 236). The same object when nothing changes, so a caller
 * writes only on a change. Late checks and other days' checks never count.
 */
export function foldTodaysChecks(state: RedFlagState, checks: readonly MorningCheck[], today: IsoDate): RedFlagState {
  if (!state.active && state.clearedOn === today) return state
  let next = state
  for (const check of checks) {
    if (check.date !== today || isLateCheck(check) || check.redFlags.length === 0) continue
    if (next.active && check.redFlags.every((id) => next.items.includes(id))) continue
    next = afterMorningCheck(next, check)
  }
  return next
}

/** Clearing takes a note; an empty note is refused. */
export function clearRedFlag(state: RedFlagState, note: string, date: IsoDate): RedFlagState {
  if (note.trim().length === 0) throw new Error('clearing the red-flag state needs a note')
  if (!state.active) return state
  return { active: false, items: [], clearedOn: date, clearNote: note.trim() }
}

export function progressionSuspended(state: RedFlagState): boolean {
  return state.active
}

/** The Today screen's stop message with the flagged items spelled out. */
export function stopMessage(state: RedFlagState, catalog: readonly RedFlag[]): { headline: string; items: string[] } | null {
  if (!state.active) return null
  const byId = new Map(catalog.map((f) => [f.id, f.text]))
  return { headline: STOP_HEADLINE, items: state.items.map((id) => byId.get(id) ?? id) }
}

/** A red flag ticked on a check logged late: the morning it describes, the day it was saved, and the flags in the program's words. */
export interface LateFlagNote {
  /** The morning the check describes. */
  date: IsoDate
  /** The day it was saved. */
  savedOn: IsoDate
  items: string[]
}

/** The note for one check: null unless it was logged late and has a flag ticked. */
export function lateFlagNote(check: MorningCheck, catalog: readonly RedFlag[]): LateFlagNote | null {
  if (check.loggedOn === undefined || check.redFlags.length === 0) return null
  const byId = new Map(catalog.map((f) => [f.id, f.text]))
  return { date: check.date, savedOn: check.loggedOn, items: check.redFlags.map((id) => byId.get(id) ?? id) }
}

/**
 * The red flags on checks logged late whose morning is within the last RETRO_DAYS of today, oldest
 * morning first: Today and Gates show each as a note in words, never the stop (Batch D, decision 12;
 * PROGRAM-QUESTIONS 175). The Week row of the session day keeps its note for good (lateFlagNote).
 */
export function lateFlagNotes(checks: readonly MorningCheck[], today: IsoDate, catalog: readonly RedFlag[]): LateFlagNote[] {
  const from = addDays(today, -RETRO_DAYS)
  return checks
    .filter((c) => c.date >= from)
    .map((c) => lateFlagNote(c, catalog))
    .filter((n): n is LateFlagNote => n !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
}
