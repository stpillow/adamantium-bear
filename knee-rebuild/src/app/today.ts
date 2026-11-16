import { useEffect, useState } from 'react'
import { todayIn } from '../rules/calendar.ts'
import type { IsoDate } from '../schema/index.ts'
import { useTimeZone } from './timeZone.ts'

/**
 * Today's date in a time zone, refreshed each minute and whenever the app comes back to the front.
 * A new zone counts at once, in the same render (the date is held with the zone it was counted in),
 * so no frame shows the old zone's date after a change.
 */
export function useTodayIn(zone: string): IsoDate {
  const [state, setState] = useState<{ zone: string; today: IsoDate }>(() => ({ zone, today: todayIn(new Date(), zone) }))
  const current = state.zone === zone ? state : { zone, today: todayIn(new Date(), zone) }
  if (current !== state) setState(current)
  useEffect(() => {
    const refresh = () => setState((s) => {
      const today = todayIn(new Date(), zone)
      return s.zone === zone && s.today === today ? s : { zone, today }
    })
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [zone])
  return current.today
}

/** Today's date in the user's time zone (a setting since M-U1, America/New_York by default): every screen inside the shell's TimeZoneContext. */
export function useToday(): IsoDate {
  return useTodayIn(useTimeZone())
}
