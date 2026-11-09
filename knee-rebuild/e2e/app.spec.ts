import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { onboardAsShawn } from './firstRun.ts'
import { serveDist, type StaticServer } from './staticServer.ts'

/*
 * The app shell on the built app, served the way a static host serves it (e2e/staticServer.ts) so a
 * deploy can be staged: what it shows when storage can't be read at launch, as after a rollback to
 * a build that doesn't know a stored row (PROGRAM-QUESTIONS 132), and that the next version is still
 * offered there, so a build that can't read storage is replaced without force-quitting the app.
 */

const DIST = fileURLToPath(new URL('../dist', import.meta.url))
const VERCEL_JSON = fileURLToPath(new URL('../vercel.json', import.meta.url))
const TUESDAY_WEEK_1 = '2026-11-03T09:00:00-05:00'

let server: StaticServer | null = null

test.afterEach(async () => {
  await server?.close().catch(() => undefined)
  server = null
})

/** Changes the stored settings row in place, straight in IndexedDB, the way another build would have left it. */
async function patchSettingsRow(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (fields) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('knee-rebuild')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('settings', 'readwrite')
          const store = tx.objectStore('settings')
          const get = store.get('settings')
          get.onsuccess = () => store.put({ ...get.result, ...fields })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    patch,
  )
}

/** What the app shows when it can't go on: the shell stopped, or storage couldn't be opened; either has its own words and a Reload. */
const stopped = (page: Page) => page.getByRole('heading', { level: 1, name: /^(The app stopped|Storage could not be opened)$/ })

test('storage this build can’t read stops the app in words, with Reload, and a deploy’s update prompt still shows over it', async ({ page }) => {
  await page.clock.install({ time: new Date(TUESDAY_WEEK_1) })
  server = await serveDist(DIST, VERCEL_JSON)
  await page.goto(`${server.url}/`)
  await onboardAsShawn(page)
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    const worker = registration.active
    if (worker && worker.state !== 'activated') await new Promise((resolve) => worker.addEventListener('statechange', resolve))
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()

  // A row this build can't read: the app stops in words, with Reload.
  await patchSettingsRow(page, { restTimerSeconds: 'a minute' })
  await page.reload()
  await expect(stopped(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible()

  // A deploy (the build that reads it, on the phone): its prompt shows over the stopped app, and Reload now brings it in.
  server.setServiceWorkerSuffix('\n// the build that reads it\n')
  await page.reload()
  await expect(stopped(page)).toBeVisible()
  const prompt = page.getByRole('status').filter({ hasText: 'A new version is ready.' })
  await expect(prompt).toBeVisible()
  const reloaded = page.waitForEvent('load')
  await prompt.getByRole('button', { name: 'Reload now' }).click()
  await reloaded
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => (r?.waiting ?? null) !== null))).toBe(false)

  // Once the row reads again, the app opens: on its own, since the settings query is live, or through
  // Reload if the stopped screen is still up. Either way it must open; waiting on a Reload that the live
  // recovery already took away was a race.
  await patchSettingsRow(page, { restTimerSeconds: 60 })
  const today = page.getByRole('heading', { name: 'Today', level: 1 })
  const reload = page.getByRole('button', { name: 'Reload', exact: true })
  await expect(today.or(reload)).toBeVisible()
  if (!(await today.isVisible())) await reload.click({ timeout: 5_000 }).catch(() => undefined)
  await expect(today).toBeVisible()
})
