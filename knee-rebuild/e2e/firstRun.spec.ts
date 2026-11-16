import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from './fixtures.ts'
import { onboardAsShawn } from './firstRun.ts'

/*
 * First run (M-U1) on the built app. What the unit tests can't reach: that a phone set up before
 * first run existed (a version 11 database, Shawn's) opens straight on Today and never sees
 * `#/welcome`; a first run in another time zone; an import from the first screen; that the steps
 * can't be skipped; and that Reset all data comes back to them with nothing picked.
 */

const TUESDAY_WEEK_1 = '2026-11-03T09:00:00-05:00'

let errors: string[] = []

test.beforeEach(async ({ page }) => {
  errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
})

test.afterEach(() => {
  expect(errors).toEqual([])
})

/** Records every hash the page shows, across reloads, so a test can say one never appeared. */
async function recordHashes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log = () => {
      const all = JSON.parse(sessionStorage.getItem('hashes') ?? '[]') as string[]
      all.push(location.hash)
      sessionStorage.setItem('hashes', JSON.stringify(all))
    }
    log()
    addEventListener('hashchange', log)
  })
}
const hashes = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('hashes') ?? '[]') as string[])

/** Every row of the named stores, read straight from IndexedDB. */
async function rawStores(page: Page, names: string[]): Promise<Record<string, unknown[]>> {
  return page.evaluate(
    (stores) =>
      new Promise<Record<string, unknown[]>>((resolve, reject) => {
        const open = indexedDB.open('knee-rebuild')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const present = stores.filter((s) => db.objectStoreNames.contains(s))
          const out: Record<string, unknown[]> = Object.fromEntries(stores.map((s) => [s, ['(no such store)']]))
          if (present.length === 0) {
            db.close()
            resolve(out)
            return
          }
          const tx = db.transaction(present, 'readonly')
          for (const name of present) {
            const all = tx.objectStore(name).getAll()
            all.onsuccess = () => {
              out[name] = all.result
            }
          }
          tx.oncomplete = () => {
            db.close()
            resolve(out)
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    names,
  )
}

test('a version 11 phone (Shawn’s, set up before first run existed) opens on Today, never on first run, and nothing is written', async ({ page }) => {
  const program = JSON.parse(await readFile(new URL('../data/program.json', import.meta.url), 'utf8')) as { planetFitness: string[]; equipmentListVersion: number }
  const settings = {
    id: 'settings', injuredSide: 'right', startDate: '2026-11-02', dumbbellMax: 80, restTimerSeconds: 60, painPerSet: false, currentPhase: 1, phaseEnteredWeek: 1,
    redFlag: { active: false, items: [] }, activeLocationId: 'planet-fitness', kit: ['ankle-strap', 'mini-band'],
  }
  const home = {
    id: 'planet-fitness', name: 'Planet Fitness', present: [...new Set([...program.planetFitness, 'seated-leg-press', 'leg-press-45', 'rower'])], dumbbellMaxLb: 80,
    startedFrom: 'planet-fitness', listVersion: program.equipmentListVersion, extras: [], markedOff: [], createdOn: '2026-11-02', archived: false,
  }

  await page.clock.install({ time: new Date(TUESDAY_WEEK_1) })
  await recordHashes(page)
  // The app's origin, without the app: a static file, so nothing opens the database first.
  await page.goto('/manifest.webmanifest')
  // Version 11 exactly as Dexie stores it (its version × 10), with v11's stores, keys and indexes, and Shawn's seeded rows.
  await page.evaluate(
    ({ settingsRow, homeRow }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('knee-rebuild', 110)
        open.onupgradeneeded = () => {
          const db = open.result
          const store = (name: string, key: string, indexes: (string | [string, string[]])[] = []) => {
            const s = db.createObjectStore(name, { keyPath: key })
            for (const index of indexes) {
              if (typeof index === 'string') s.createIndex(index, index)
              else s.createIndex(index[0], index[1])
            }
          }
          store('settings', 'id')
          store('workouts', 'id', ['date', 'status', 'templateId'])
          store('setLogs', 'id', ['workoutId', 'exerciseId', ['[workoutId+slotId]', ['workoutId', 'slotId']]])
          store('morningChecks', 'id', ['date'])
          store('runs', 'id', ['date'])
          store('gateTests', 'id', ['date', ['[gate+item]', ['gate', 'item']]])
          store('sessionMoves', 'id', ['week'])
          store('locations', 'id')
          store('programOverrides', 'slotId')
          store('addedSlots', 'id', ['templateId'])
          store('hrSettings', 'id')
          store('vo2Readings', 'date')
          store('koosEntries', 'date')
          store('aclRsiEntries', 'date')
          store('downPeriods', 'id', ['start'])
        }
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(['settings', 'locations'], 'readwrite')
          tx.objectStore('settings').put(settingsRow)
          tx.objectStore('locations').put(homeRow)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    { settingsRow: settings, homeRow: home },
  )

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  await expect(page.getByText('Phase 1 · Week 1')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start Session A' })).toBeVisible()
  expect((await hashes(page)).filter((h) => h.startsWith('#/welcome'))).toEqual([])

  // Opened at version 12 with nothing written: no zone row (New York), the settings and home gym rows as they were.
  const stored = await rawStores(page, ['settings', 'locations', 'timeZoneSettings'])
  expect(stored).toEqual({ settings: [settings], locations: [home], timeZoneSettings: [] })

  await page.goto('/#/settings')
  await expect(page.getByText('Dates are counted in New York time (America/New_York). Today there is Tuesday Nov 3.')).toBeVisible()
  expect((await hashes(page)).filter((h) => h.startsWith('#/welcome'))).toEqual([])
})

test.describe('a first run in Los Angeles', () => {
  test.use({ timezoneId: 'America/Los_Angeles' })

  test('proposes the phone’s zone and its coming Monday, plans in it, and Settings moves it with words', async ({ page }) => {
    // 11:30 pm Monday Nov 2 in Los Angeles; already 2:30 am Tuesday Nov 3 in New York.
    await page.clock.install({ time: new Date('2026-11-03T07:30:00Z') })
    await page.goto('/')
    await page.getByRole('button', { name: 'Set up this phone' }).click()
    await page.getByRole('radio', { name: /^Left knee/ }).click()
    await page.getByRole('button', { name: 'Next: start date' }).click()
    // The coming Monday where the phone is: today, Monday Nov 2.
    await expect(page.getByLabel('Week 1 starts on a Monday')).toHaveValue('2026-11-02')
    await expect(page.getByText('Today, Monday Nov 2, is in week 1.')).toBeVisible()
    await page.getByRole('button', { name: 'Next: home gym' }).click()
    await expect(page.getByLabel('What you will call it on Today')).toHaveValue('Home gym')
    await page.getByRole('button', { name: 'Next: what it has' }).click()
    await page.getByRole('button', { name: 'Next: time zone' }).click()
    await expect(page.getByRole('combobox', { name: 'Time zone' }).locator('option:checked')).toHaveText('Los Angeles time (America/Los_Angeles)')
    await expect(page.getByText('This phone is set to Los Angeles time (America/Los_Angeles). Today there is Monday Nov 2.')).toBeVisible()
    await page.getByRole('button', { name: 'Next: check it' }).click()
    await expect(page.getByText('Injured: the left knee.')).toBeVisible()
    await expect(page.getByText('Home gym: Home gym, 30 items, no dumbbells.')).toBeVisible()
    await expect(page.getByText('Dates in Los Angeles time (America/Los_Angeles).')).toBeVisible()
    await page.getByRole('button', { name: 'Start the program' }).click()

    // Monday in Los Angeles: the MBR run, not Tuesday's Session A.
    await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
    await expect(page.getByText('Phase 1 · Week 1')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Log the run' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start Session A' })).toHaveCount(0)

    // Settings: New York, with the words before Yes; then Today is Tuesday's Session A.
    await page.goto('/#/settings')
    await page.getByRole('combobox', { name: 'Time zone' }).selectOption('America/New_York')
    const confirm = page.getByRole('group', { name: 'Change the time zone?' })
    await expect(confirm.getByText('Right now that moves today from Monday Nov 2 to Tuesday Nov 3.')).toBeVisible()
    await expect(confirm.getByText(/^Nothing logged moves/)).toBeVisible()
    await confirm.getByRole('button', { name: 'Yes, use New York time' }).click()
    await expect(page.getByText('Dates are now counted in New York time.')).toBeVisible()
    await expect(page.getByText('Dates are counted in New York time (America/New_York). Today there is Tuesday Nov 3.')).toBeVisible()
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Today' }).click()
    await expect(page.getByRole('button', { name: 'Start Session A' })).toBeVisible()
  })
})

test('an import from the first screen skips the questions and opens on Today with the file’s dates', async ({ page }) => {
  await page.clock.install({ time: new Date(TUESDAY_WEEK_1) })
  await recordHashes(page)
  await page.goto('/')
  await onboardAsShawn(page)
  await page.goto('/#/settings')
  await page.getByRole('button', { name: 'Export JSON' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: /^Save knee-rebuild-/ }).click()
  const file = await readFile(await (await download).path())

  // Reset: a phone with nothing on it, on the first screen.
  await page.getByRole('button', { name: 'Reset all data' }).click()
  await page.getByRole('button', { name: 'Yes, erase everything' }).click()
  await expect(page.getByRole('heading', { name: 'Set up Knee Rebuild', level: 1 })).toBeVisible()
  await page.evaluate(() => sessionStorage.setItem('hashes', '[]'))

  await page.locator('input[type="file"]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: file })
  await expect(page.getByText('Dates will be counted in New York time, as the file’s were; Settings can change that.')).toBeVisible()
  await expect(page.getByText(/^This phone now:/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Yes, replace everything' }).click()
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  await expect(page.getByText(/^Imported backup\.json\./)).toBeVisible()
  await expect(page.getByText('Phase 1 · Week 1')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start Session A' })).toBeVisible()
  expect((await hashes(page)).filter((h) => h.startsWith('#/welcome/'))).toEqual([])
})

test('the steps can’t be skipped: the side has no default, a link further on opens the first unanswered step, and each says which of six it is', async ({ page }) => {
  await page.clock.install({ time: new Date(TUESDAY_WEEK_1) })
  await page.goto('/#/welcome/ready')
  await expect(page.getByRole('heading', { name: 'Injured side', level: 1 })).toBeVisible()
  await expect(page.getByText('Step 1 of 6 · The side the program rehabs.')).toBeVisible()
  await page.getByRole('button', { name: 'Next: start date' }).click()
  await expect(page.getByRole('alert')).toHaveText('Pick the injured knee to go on. There’s no default: a guess would load the wrong leg.')
  await expect(page.getByRole('heading', { name: 'Injured side', level: 1 })).toBeVisible()

  await page.getByRole('radio', { name: /^Right knee/ }).click()
  await expect(page.getByRole('radio', { name: /^Right knee/ })).toHaveAttribute('aria-checked', 'true')
  const steps: [string, string][] = [
    ['Next: start date', 'Step 2 of 6'],
    ['Next: home gym', 'Step 3 of 6'],
    ['Next: what it has', 'Step 4 of 6'],
    ['Next: time zone', 'Step 5 of 6'],
    ['Next: check it', 'Step 6 of 6'],
  ]
  for (const [button, lead] of steps) {
    await page.getByRole('button', { name: button }).click()
    await expect(page.getByText(new RegExp(`^${lead} · `))).toBeVisible()
  }
  // An emptied gym name stops Next on its own step, in words.
  await page.getByRole('button', { name: 'Change' }).nth(2).click()
  await page.getByLabel('What you will call it on Today').fill('   ')
  await page.getByRole('button', { name: 'Next: what it has' }).click()
  await expect(page.getByRole('alert')).toHaveText('A gym needs a name: type the one you will look for on Today.')
  await expect(page.getByRole('heading', { name: 'Home gym', level: 1 })).toBeVisible()
})

test('a step’s own Back steps back through history, so the back gesture after it leaves that step too', async ({ page }) => {
  await page.clock.install({ time: new Date(TUESDAY_WEEK_1) })
  await page.goto('/')
  await page.getByRole('button', { name: 'Set up this phone' }).click()
  await page.getByRole('radio', { name: /^Right knee/ }).click()
  for (const button of ['Next: start date', 'Next: home gym', 'Next: what it has', 'Next: time zone', 'Next: check it']) {
    await page.getByRole('button', { name: button }).click()
  }
  await expect(page.getByRole('heading', { name: 'Ready', level: 1 })).toBeVisible()
  const length = await page.evaluate(() => history.length)

  // Back on Ready: Time zone, and history doesn't keep a second Time zone entry over Ready's.
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page).toHaveURL(/#\/welcome\/time$/)
  await expect(page.getByRole('heading', { name: 'Time zone', level: 1 })).toBeVisible()
  // The back gesture then goes on to What it has, not to Time zone again.
  await page.goBack()
  await expect(page).toHaveURL(/#\/welcome\/equipment$/)
  await expect(page.getByRole('heading', { name: 'What it has', level: 1 })).toBeVisible()
  // Forward still reaches the step Back left.
  await page.goForward()
  await expect(page).toHaveURL(/#\/welcome\/time$/)
  expect(await page.evaluate(() => history.length)).toBe(length)

  // On the first step, Back leaves one first screen, and the gesture after it leaves first run's screens.
  for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Injured side', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page).toHaveURL(/#\/welcome$/)
  await expect(page.getByRole('heading', { name: 'Set up Knee Rebuild', level: 1 })).toBeVisible()
  await page.goBack()
  await expect(page).not.toHaveURL(/#\/welcome/)
})

test('Back on a step opened by a link replaces it in place', async ({ page }) => {
  await page.clock.install({ time: new Date(TUESDAY_WEEK_1) })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Set up Knee Rebuild', level: 1 })).toBeVisible()
  await page.goto('/#/welcome/side')
  await expect(page.getByRole('heading', { name: 'Injured side', level: 1 })).toBeVisible()
  const length = await page.evaluate(() => history.length)
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page).toHaveURL(/#\/welcome$/)
  expect(await page.evaluate(() => history.length)).toBe(length)
})

test('Reset all data comes back to first run, and the side it asks has nothing picked', async ({ page }) => {
  await page.clock.install({ time: new Date(TUESDAY_WEEK_1) })
  await page.goto('/')
  await onboardAsShawn(page)
  await page.goto('/#/settings')
  await expect(page.getByText('Then the app asks the setup questions again.', { exact: false })).toHaveCount(0)
  await page.getByRole('button', { name: 'Reset all data' }).click()
  await expect(page.getByText(/Then the app asks the setup questions again\.$/)).toBeVisible()
  await page.getByRole('button', { name: 'Yes, erase everything' }).click()
  await expect(page.getByRole('heading', { name: 'Set up Knee Rebuild', level: 1 })).toBeVisible()
  await expect(page.getByText('Everything on this phone was erased. The setup questions come next.')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Set up this phone' }).click()
  await expect(page.getByRole('radio', { name: /^Right knee/ })).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('radio', { name: /^Left knee/ })).toHaveAttribute('aria-checked', 'false')
})
