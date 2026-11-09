import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { routeHash, useRoute } from './app/router.ts'
import { useToday } from './app/today.ts'
import { Button } from './components/Button.tsx'
import { storageFailedWords } from './components/ErrorBoundary.helpers.ts'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { TabBar } from './components/TabBar.tsx'
import { useActiveLocation, useSettings } from './db/hooks.ts'
import { defaultSettings, ensureLocations, ensureSettings, requestPersistentStorage } from './db/repo.ts'
import { program } from './program/program.ts'
import { AclRsi } from './screens/AclRsi.tsx'
import { Gates } from './screens/Gates.tsx'
import { Koos } from './screens/Koos.tsx'
import { LocationEditor } from './screens/LocationEditor.tsx'
import { Locations } from './screens/Locations.tsx'
import { MorningCheck } from './screens/MorningCheck.tsx'
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

/** Storage opened and seeded, then the screen for the route and the tab bar; or why storage couldn't be opened. */
function Shell({ updateReady }: { updateReady: boolean }) {
  const route = useRoute()
  const settings = useSettings()
  const activeLocation = useActiveLocation()
  const today = useToday()
  const [seedError, setSeedError] = useState<string | null>(null)

  useEffect(() => {
    // Settings first: the home gym is written from the dumbbell max they hold (design section 2).
    ensureSettings(defaultSettings(program))
      .then(() => ensureLocations(program, today))
      .then(() => requestPersistentStorage())
      .catch((e: unknown) => setSeedError(e instanceof Error ? e.message : String(e)))
    // Once, at launch: the day the home gym is first written is the day the app opened.
  }, [])

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
  // Every screen plans at a gym: wait for the home gym too, which ensureLocations writes right after the settings.
  if (settings === undefined || settings === null || activeLocation === undefined || activeLocation === null) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[36rem] flex-col gap-4 px-4 py-12">
        <h1 className="font-display text-h2 text-on-dark">Knee Rebuild</h1>
        <p className="text-body text-on-dark-dim">Opening storage…</p>
      </main>
    )
  }

  return (
    <>
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
    </>
  )
}
