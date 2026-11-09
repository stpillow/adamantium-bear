import { createContext, useContext } from 'react'
import { DEFAULT_TIME_ZONE, isKnownTimeZone } from '../schema/index.ts'

/*
 * The phone's own time zone, and the user's (M-U1, PROGRAM-QUESTIONS 203, 204). This is the only
 * module that reads the phone's zone (src/app/timeZone.guard.test.ts): first run proposes it and
 * Settings offers it; nothing counts a date in it unless the user chose it. Every date is counted in the stored zone, passed down by
 * `TimeZoneContext` once it has loaded.
 */

/** The zone the phone's clock is set to, by its IANA name; New York when the phone doesn't say or names one this build can't use. */
export function deviceTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof zone === 'string' && isKnownTimeZone(zone) ? canonicalZone(zone) : DEFAULT_TIME_ZONE
  } catch {
    return DEFAULT_TIME_ZONE
  }
}

/** Every zone this phone's time zone data lists, for the picker; empty where the browser can't say (the picker then offers the stored and the phone's own). */
export function supportedTimeZones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: 'timeZone') => string[] }
    return typeof intl.supportedValuesOf === 'function' ? intl.supportedValuesOf('timeZone') : []
  } catch {
    return []
  }
}

/**
 * A zone's name as this phone's time zone data spells it ("america/new_york" is "America/New_York";
 * an old alias may become its current name), so one zone is never two choices or a change of
 * zone. A zone the phone doesn't know comes back as given.
 */
export function canonicalZone(zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone
  } catch {
    return zone
  }
}

/** The zone every screen counts dates in: the stored one, once loaded (the shell renders nothing that dates before then). */
export const TimeZoneContext = createContext<string>(DEFAULT_TIME_ZONE)

export function useTimeZone(): string {
  return useContext(TimeZoneContext)
}
