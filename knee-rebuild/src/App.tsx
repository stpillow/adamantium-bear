import { useEffect, useState } from 'react'
import type { Settings as SettingsRecord } from './schema/index.ts'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { accountStatus } from './app/account.ts'
import { EngineModeContext, useEngineMode, useEngineModeSource } from './app/mode.ts'
import { replaceRoute, routeHash, useRoute } from './app/router.ts'
import { TimeZoneContext } from './app/timeZone.ts'
import { useToday } from './app/today.ts'
import { Button } from './components/Button.tsx'
import { storageFailedWords } from './components/ErrorBoundary.helpers.ts'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { TabBar } from './components/TabBar.tsx'
import { useActiveLocation, useMorningChecksOn, useOnboardingState, usePreAccountsLog, useSettings, useTimeZoneSetting } from './db/hooks.ts'
import { foldSettings, getTimeZoneSetting, launch, requestPersistentStorage } from './db/repo.ts'
import { program } from './program/program.ts'
import { todayIn } from './rules/calendar.ts'
import { needsFirstRun } from './rules/onboarding.ts'
import { AclRsi } from './screens/AclRsi.tsx'
import { Gates } from './screens/Gates.tsx'
import { Koos } from './screens/Koos.tsx'
import { LocationEditor } from './screens/LocationEditor.tsx'
import { Locations } from './screens/Locations.tsx'
import { MorningCheck } from './screens/MorningCheck.tsx'
import { withTodaysFlags } from './screens/MorningCheck.helpers.ts'
import { More } from './screens/More.tsx'
import { NextUpdate } from './screens/NextUpdate.tsx'
import { Strava } from './screens/Strava.tsx'
import { Program } from './screens/Program.tsx'
import { Preview } from './screens/Preview.tsx'
import { Progress } from './screens/Progress.tsx'
import { RunLogger } from './screens/RunLogger.tsx'
import { SessionRunner } from './screens/SessionRunner.tsx'
import { Settings } from './screens/Settings.tsx'
import { Today } from './screens/Today.tsx'
import { Week } from './screens/Week.tsx'
import { Welcome } from './screens/Welcome.tsx'

/**
 * The app: the service worker's update prompt, then everything else inside a boundary of its own.
 * The prompt sits outside it, so when storage can't be read at launch (a stored row this build
 * doesn't know, after a rollback; PROGRAM-QUESTIONS 132) and the app shell throws or can't open
 * storage, the next version is still offered, and Reload now brings it in without force-quitting.
 */
export function App() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  return (
    <>
      {needRefresh ? (
        <div role="status" className="mx-auto flex max-w-[36rem] items-center justify-between gap-4 px-4 pt-4 text-small text-on-dark">
          <span>A new version is ready. It will not reload on its own.</span>
          <Button variant="primary" onClick={() => void updateServiceWorker(true)}>
            Reload now
          </Button>
        </div>
      ) : null}
      <ErrorBoundary screen={null}>
        <Shell updateReady={needRefresh} />
      </ErrorBoundary>
    </>
  )
}

/**
 * Storage opened, then: first run on a phone with no settings row (M-U1), or the screen for the
 * route and the tab bar, every date counted in the stored time zone; or why storage couldn't be
 * opened. Nothing shows until both whether the phone is set up and its zone have loaded, so first
 * run never flashes on a set-up phone and no frame counts in the wrong zone.
 */
function Shell({ updateReady }: { updateReady: boolean }) {
  const route = useRoute()
  const state = useOnboardingState()
  const zoneSetting = useTimeZoneSetting()
  const settings = useSettings()
  const activeLocation = useActiveLocation()
  const preAccounts = usePreAccountsLog()
  // The engine mode (M-U3): from the account answer this context last kept, and before any answer, whether the phone holds pre-accounts writes.
  const engine = useEngineModeSource(preAccounts === true)
  const [seedError, setSeedError] = useState<string | null>(null)
  const firstRun = state !== undefined && needsFirstRun(state)

  useEffect(() => {
    // The account check at launch and whenever the phone comes back online (PROGRAM-QUESTIONS 225): own origin only,
    // never offline; its kept answer sets the engine mode on the next render. Nothing waits on it.
    void accountStatus()
    const online = () => void accountStatus()
    window.addEventListener('online', online)
    return () => window.removeEventListener('online', online)
  }, [])

  useEffect(() => {
    // Once, at launch: a set-up phone gets its home gym if it has none yet (one from before gyms), dated
    // the day it opened in its own zone; a phone that isn't set up is left for first run, seeded with nothing.
    getTimeZoneSetting()
      .then((zone) => launch(program, todayIn(new Date(), zone.zone)))
      .then((launched) => (launched === 'onboarded' ? requestPersistentStorage() : false))
      .catch((e: unknown) => setSeedError(e instanceof Error ? e.message : String(e)))
  }, [])

  // First run only on a phone that isn't set up, and never once it is: a stale #/welcome lands on Today.
  useEffect(() => {
    if (state === undefined) return
    if (firstRun && route.name !== 'welcome') replaceRoute({ name: 'welcome' })
    if (!firstRun && route.name === 'welcome') replaceRoute({ name: 'today' })
  }, [state, firstRun, route.name])

  if (seedError) {
    // With a new version waiting, its prompt above is the way on; otherwise Reload tries again.
    const words = storageFailedWords(seedError, updateReady)
    return (
      <main className="mx-auto flex min-h-dvh max-w-[36rem] flex-col gap-4 px-4 py-12">
        <h1 className="font-display text-h2 text-on-dark">{words.title}</h1>
        <p className="text-body text-on-dark-dim wrap-anywhere">{words.sentence}</p>
        <p className="text-body text-on-dark">{words.next}</p>
        {updateReady ? null : (
          <Button wide onClick={() => window.location.reload()}>
            Reload
          </Button>
        )}
      </main>
    )
  }
  const opening = (
    <main className="mx-auto flex min-h-dvh max-w-[36rem] flex-col gap-4 px-4 py-12">
      <h1 className="font-display text-h2 text-on-dark">Knee Rebuild</h1>
      <p className="text-body text-on-dark-dim">Opening storage…</p>
    </main>
  )
  if (state === undefined || zoneSetting === undefined || preAccounts === undefined) return opening
  if (firstRun) {
    if (route.name !== 'welcome') return opening
    return (
      // No tab bar: first run is the only way on from here.
      <EngineModeContext.Provider value={engine}>
        <ErrorBoundary screen="welcome" resetKey={routeHash(route)}>
          <Welcome step={route.step} storedZone={zoneSetting.stored === 'ok' ? zoneSetting.zone : null} />
        </ErrorBoundary>
      </EngineModeContext.Provider>
    )
  }
  // Every screen plans at a gym: wait for the home gym too, which launch writes on a phone from before gyms.
  if (route.name === 'welcome' || settings === undefined || settings === null || activeLocation === undefined || activeLocation === null) return opening

  return (
    <TimeZoneContext.Provider value={zoneSetting.zone}>
      <EngineModeContext.Provider value={engine}>
      <TodaysFlags settings={settings} />
      {/* A throw inside a screen shows its name and a way out, not a blank app; the update prompt and the tab bar stay outside it. */}
      <ErrorBoundary screen={route.name} resetKey={routeHash(route)}>
        {(() => {
          switch (route.name) {
            case 'today':
              return <Today />
            case 'session':
              return <SessionRunner workoutId={route.workoutId} />
            case 'morning':
              return <MorningCheck key={route.date ?? 'today'} {...(route.date ? { date: route.date } : {})} />
            case 'settings':
              return <Settings />
            case 'more':
              return <More />
            case 'locations':
              return <Locations />
            case 'location':
              return <LocationEditor key={route.locationId} locationId={route.locationId} />
            case 'new-location':
              return <LocationEditor key="new" locationId={null} />
            case 'next-update':
              return <NextUpdate />
            case 'run':
              return <RunLogger />
            case 'week':
              return <Week />
            case 'preview':
              return <Preview date={route.date} />
            case 'progress':
              return <Progress />
            case 'gates':
              return <Gates />
            case 'program':
              return <Program />
            case 'strava':
              return <Strava result={route.result} />
            case 'koos':
              return <Koos />
            case 'acl-rsi':
              return <AclRsi />
          }
        })()}
      </ErrorBoundary>
      {route.name === 'session' ? null : <TabBar route={route} />}
      </EngineModeContext.Provider>
    </TimeZoneContext.Provider>
  )
}

/**
 * Keeps the red-flag state true to today's checks while the phone runs full (M-U3; glossary: any
 * ticked red flag on a morning check for today). A check saved while the phone ran tester mode (signed
 * out after accounts went on, a stale cookie, before a tester became admin) wrote no state; once the
 * mode is full, today's flags are folded in and kept (`withTodaysFlags`), so Today's stop, the
 * planner's suspension, Gates and the runner all read it from the stored settings, as they always
 * have. A clear made today, with its note, stands (PROGRAM-QUESTIONS 236). Tester mode writes nothing.
 * A failed write is tried again on the next change of the settings or today's checks.
 */
function TodaysFlags({ settings }: { settings: SettingsRecord }) {
  const { mode } = useEngineMode()
  const today = useToday()
  const checks = useMorningChecksOn(today)
  useEffect(() => {
    if (checks === undefined || withTodaysFlags(mode, settings, checks, today) === settings) return
    foldSettings(today, (stored, todays) => withTodaysFlags(mode, stored, todays, today)).catch(() => undefined)
  }, [mode, settings, checks, today])
  return null
}
