import { useEffect, useState } from 'react'
import { navigate } from '../app/router.ts'
import { PROGRAM } from '../app/session.ts'
import { STRAVA_CONNECT_URL, handDraft, stravaActivities, stravaDisconnect, stravaStatus, type StravaStatus } from '../app/strava.ts'
import { useToday } from '../app/today.ts'
import { Button } from '../components/Button.tsx'
import { Screen } from '../components/Screen.tsx'
import { useHistory, useSettings } from '../db/hooks.ts'
import { scheduledSession } from '../rules/calendar.ts'
import { candidates, importedStravaIds, stravaActivityUrl, syncAfter, type Candidate } from '../rules/stravaImport.ts'
import { runTypeFor } from '../rules/weekPlan.ts'
import { dateChoices } from './RunLogger.helpers.ts'
import { accountNeededWords, candidateWords, disconnectWords, resultLine, stravaPanel } from './Strava.helpers.ts'

const LABEL = 'font-mono text-small uppercase tracking-[0.22em] text-on-dark-muted'

/**
 * Import from Strava (`#/strava`, Nov 6; PROGRAM-QUESTIONS 142): connect once, then Check Strava lists
 * the activities from the days a run can be logged for, newest first, without ones already logged. A
 * run, elliptical or rowing session opens the run logger filled in, where max pain is still Shawn's to
 * rate before Save; a strength activity points at that day's preview. Nothing is saved from here.
 */
export function Strava({ result }: { result?: string | undefined }) {
  const today = useToday()
  const settings = useSettings()
  const history = useHistory()
  const [status, setStatus] = useState<StravaStatus | null>(null)
  const [list, setList] = useState<Candidate[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [left, setLeft] = useState<string | null>(null)

  // Again on each `result`: the consent page lands back here, and the status changed on the way.
  useEffect(() => {
    void stravaStatus().then(setStatus)
  }, [result])

  if (settings === undefined || history === undefined || status === null) {
    return (
      <Screen title="Import from Strava" lead="Checking the connection…">
        {null}
      </Screen>
    )
  }
  if (settings === null) {
    return (
      <Screen title="Import from Strava" lead="No settings yet.">
        <p className="text-body text-on-dark-dim">Open the app from Today once so it can set itself up, then come back.</p>
      </Screen>
    )
  }

  const dates = dateChoices(today, settings.startDate)
  const check = async () => {
    const after = syncAfter(dates)
    if (after === null) return
    setBusy(true)
    setProblem(null)
    try {
      const activities = await stravaActivities(after)
      setList(
        candidates(activities, importedStravaIds(history.runs), {
          dates,
          scheduledRun: (date) => {
            const session = scheduledSession(date, settings.startDate, PROGRAM.weeklyTemplate, history.sessionMoves).session
            return session ? runTypeFor(session) : null
          },
        }),
      )
    } catch (e: unknown) {
      setProblem(`Strava could not be read: ${e instanceof Error ? e.message : String(e)}.`)
    } finally {
      setBusy(false)
    }
  }
  const disconnect = async () => {
    setBusy(true)
    setProblem(null)
    try {
      setLeft(disconnectWords(await stravaDisconnect()))
      setStatus({ configured: true, connected: false })
      setList(null)
    } catch (e: unknown) {
      setProblem(`Could not disconnect: ${e instanceof Error ? e.message : String(e)}.`)
    } finally {
      setBusy(false)
    }
  }
  const came = resultLine(result, status)
  const panel = stravaPanel(status)

  return (
    <Screen title="Import from Strava" lead="Bring in runs, elliptical and rowing sessions you recorded on Strava.">
      {came ? <p className="text-body text-on-dark">{came}</p> : null}
      {left ? <p className="text-body text-on-dark">{left}</p> : null}
      {status.account ? (
        <div className="flex flex-col gap-3">
          <p className="text-body text-on-dark-dim">{accountNeededWords(status.account)}</p>
          <Button wide onClick={() => navigate({ name: 'settings' })}>
            Open Settings
          </Button>
        </div>
      ) : panel === 'not-set-up' ? (
        <p className="text-body text-on-dark-dim">Strava isn’t set up on this deployment yet. It needs a Strava API app and three settings in Vercel (docs/integrations.md).</p>
      ) : panel === 'connect' ? (
        <div className="flex flex-col gap-3">
          <p className="text-body text-on-dark-dim">Connecting lets this app read your activities when you tap Check Strava, and nothing else. It never posts to Strava, and nothing syncs in the background.</p>
          <a href={STRAVA_CONNECT_URL} className="tap flex w-full items-center justify-center rounded-sm bg-paper px-6 py-3 font-sans text-body font-medium text-on-light">
            Connect with Strava
          </a>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Button variant="primary" wide disabled={busy} onClick={() => void check()}>
            {busy ? 'Reading Strava…' : `Check Strava for the last ${dates.length} days`}
          </Button>
          {list !== null && list.length === 0 ? <p className="text-body text-on-dark-dim">Nothing new: every activity in those days is already logged.</p> : null}
          {list !== null && list.length > 0 ? (
            <ol className="flex flex-col">
              {list.map((c) => {
                const words = candidateWords(c)
                return (
                  <li key={c.activityId} className="flex flex-col gap-2 border-t border-on-dark-faint py-3">
                    <span className="text-body font-medium text-on-dark wrap-anywhere">{words.title}</span>
                    <span className="text-small text-on-dark-dim wrap-anywhere">{words.detail}</span>
                    <div className="flex flex-wrap items-center gap-3">
                      {c.kind === 'run' ? (
                        <Button
                          onClick={() => {
                            handDraft(c.draft)
                            navigate({ name: 'run' })
                          }}
                        >
                          Log it
                        </Button>
                      ) : null}
                      {c.kind === 'lift' ? <Button onClick={() => navigate({ name: 'preview', date: c.date })}>Open that day</Button> : null}
                      <a href={stravaActivityUrl(c.activityId)} target="_blank" rel="noreferrer" className="tap inline-flex items-center text-small text-on-dark-dim underline underline-offset-4">
                        View on Strava
                      </a>
                    </div>
                  </li>
                )
              })}
            </ol>
          ) : null}
          <Button variant="quiet" disabled={busy} onClick={() => void disconnect()}>
            Disconnect Strava
          </Button>
        </div>
      )}
      {problem ? (
        <p role="alert" className="text-body text-on-dark">
          {problem}
        </p>
      ) : null}
      <p className={LABEL}>Powered by Strava</p>
    </Screen>
  )
}
