import type { StravaStatus } from '../app/strava.ts'
import type { Candidate } from '../rules/stravaImport.ts'
import { milesWords, timeWords } from './RunLogger.helpers.ts'
import { runLabel, shortDateWords } from './Today.helpers.ts'

/** Why Strava waits on an account (M-U2), in words. */
const ACCOUNT_NEEDED = {
  required: 'Strava needs an account on this app first. Enter your invite code in Settings, under Account, then come back.',
  setup: 'Accounts are half set up on this deployment, so Strava is closed for now.',
  unavailable: 'The account check didn’t answer. Try again in a minute.',
} as const

export function accountNeededWords(account: NonNullable<StravaStatus['account']>): string {
  return ACCOUNT_NEEDED[account]
}

/** Which of the screen's four panels shows: an account first, then not set up, connect, or connected. */
export function stravaPanel(status: StravaStatus): 'account' | 'not-set-up' | 'connect' | 'connected' {
  if (status.account) return 'account'
  if (!status.configured) return 'not-set-up'
  return status.connected ? 'connected' : 'connect'
}

/** What came back from Strava's consent page, in words (the function's `?result=`). */
export function resultWords(result: string | undefined): string | null {
  switch (result) {
    case undefined:
      return null
    case 'connected':
      return 'Connected to Strava.'
    case 'denied':
      return 'Strava was not connected: the consent page was declined.'
    case 'scope':
      return 'Strava was not connected: reading your activities was left unticked, and the import needs it. Connect again and leave it ticked.'
    case 'state':
      return 'Strava was not connected: the sign-in came back without the check this app sent. Connect again from this screen.'
    case 'account':
      return ACCOUNT_NEEDED.required
    case 'account-setup':
      return ACCOUNT_NEEDED.setup
    case 'unavailable':
      return ACCOUNT_NEEDED.unavailable
    default:
      return 'Strava was not connected: it would not hand over access. Try again in a minute.'
  }
}

/**
 * The line the screen prints for `?result=`: resultWords, except when the account panel below already
 * says the same sentence (a connect refused for an account, then a status still asking for one), so
 * it is said once.
 */
export function resultLine(result: string | undefined, status: StravaStatus): string | null {
  const came = resultWords(result)
  return came !== null && status.account && came === accountNeededWords(status.account) ? null : came
}

/** What Save waits on (max pain, and the effort when Strava had none), and what was filled in by default for him to check. */
export function needsWords(needs: readonly string[], guessed: readonly 'type'[] = []): string {
  const waits = needs.length === 0 ? 'Nothing to fill in.' : `${needs.join(' and ').replace(/^./, (c) => c.toUpperCase())} to rate before it saves.`
  const checks = guessed.map(() => 'the run type is a guess')
  return checks.length === 0 ? waits : `${waits} Check it: ${checks.join(' and ')}.`
}

/** After Disconnect: whether Strava confirmed it, and where to remove the app by hand when it didn't. */
export function disconnectWords(revoked: boolean): string {
  return revoked
    ? 'Disconnected: this app can no longer read your Strava.'
    : 'Disconnected here, but Strava did not confirm it. To be sure, remove the app under Strava, Settings, My Apps.'
}

/** One line for an activity: its day, its name, and what it would log as. */
export function candidateWords(c: Candidate): { title: string; detail: string } {
  switch (c.kind) {
    case 'run': {
      const d = c.draft
      const what = d.miles > 0 ? `${runLabel(d.type)}, ${milesWords(d.miles)}, ${timeWords(d.minutes)}` : `${runLabel(d.type)}, ${timeWords(d.minutes)}`
      return { title: `${shortDateWords(d.date)} · ${d.notes || 'Strava activity'}`, detail: `${what}. ${needsWords(c.needs, c.guessed)}` }
    }
    case 'lift':
      return { title: `${shortDateWords(c.date)} · ${c.name}`, detail: 'A strength session: log it from that day’s preview, with its sets.' }
    case 'skip':
      return { title: `${shortDateWords(c.date)} · ${c.name}`, detail: `Left out. ${c.reason}` }
  }
}
