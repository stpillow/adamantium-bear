import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { onboardAsShawn } from './firstRun.ts'

/*
 * Settings' import, on the built app: a file exported from this phone, changed the way an older
 * phone's would differ (another phase, the other knee, another rest timer), read back in. These pin
 * what the unit tests can't: what the confirm says before Yes, and that nothing else on the form can
 * write while the import does.
 */

/** Tuesday of week 1, as the smoke test starts. */
const TUESDAY_WEEK_1 = '2026-11-03T09:00:00-05:00'

let errors: string[] = []

test.beforeEach(async ({ page }) => {
  errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  await page.clock.install({ time: new Date(TUESDAY_WEEK_1) })
})

test.afterEach(() => {
  expect(errors).toEqual([])
})

/** This phone's own file, read the way Shawn saves it: Export JSON, then the download link. */
async function exported(page: Page): Promise<Record<string, unknown> & { settings: Record<string, unknown> }> {
  await page.getByRole('button', { name: 'Export JSON' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: /^Save knee-rebuild-/ }).click()
  return JSON.parse(await readFile(await (await download).path(), 'utf8')) as Record<string, unknown> & { settings: Record<string, unknown> }
}

const restField = (page: Page) => page.getByRole('textbox', { name: 'Rest between sets (s)' })

async function openSettings(page: Page): Promise<void> {
  await page.goto('/')
  await onboardAsShawn(page)
  await page.goto('/#/settings')
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  await expect(page.getByText('Opening storage…')).toHaveCount(0)
}

test('the import confirm says what the file changes, and a tap on the form while it writes saves nothing over it', async ({ page }) => {
  await openSettings(page)
  const backup = await exported(page)
  // The old phone: Phase 2 since week 1, the left knee, 2 minutes of rest. This phone: Phase 1, the right knee, the default rest.
  const restBefore = await restField(page).inputValue()
  backup.settings = { ...backup.settings, currentPhase: 2, phaseEnteredWeek: 1, injuredSide: 'left', restTimerSeconds: 120 }
  expect(restBefore).not.toBe('120')

  await page.locator('input[type="file"]').setInputFiles({ name: 'old-phone.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await expect(page.getByText('Replace everything on this phone with this file?')).toBeVisible()
  await expect(page.getByText('It would change the injured side from the right knee to the left knee.')).toBeVisible()
  await expect(page.getByText('It would change the phase from Phase 1 (Foundation) to Phase 2 (Single-leg strength and balance).')).toBeVisible()

  // Yes, and in the same moment the rest timer's +, as a thumb still on the form above would: before the
  // screen has drawn "Replacing…". That tap's save would write this phone's old settings over the file's.
  await page.evaluate(async () => {
    const yes = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Yes, replace everything')
    const up = () => document.querySelector<HTMLButtonElement>('button[aria-label="Rest between sets up"]')?.click()
    if (!yes) throw new Error('no Yes')
    yes.click()
    up()
    // And again once the screen has drawn, while the import still writes.
    await new Promise((resolve) => setTimeout(resolve, 0))
    up()
  })
  await expect(page.getByText(/^Imported old-phone\.json\./)).toBeVisible()
  await expect(page.getByText('Not saved: the import was replacing everything on this phone. Tap it again once it’s done.')).toBeVisible()

  // The file's settings, on the form and in storage.
  const settled = async () => {
    await expect(page.getByText('Phase 2: Single-leg strength and balance')).toBeVisible()
    await expect(page.getByRole('radio', { name: /Left knee/ })).toHaveAttribute('aria-checked', 'true')
    await expect(restField(page)).toHaveValue('120')
  }
  await settled()
  await page.reload()
  await expect(page.getByText('Opening storage…')).toHaveCount(0)
  await settled()

  // Once it's done the form saves again, on top of the file's settings.
  await page.getByRole('button', { name: 'Rest between sets up' }).click()
  await expect(restField(page)).toHaveValue('135')
  await page.reload()
  await expect(restField(page)).toHaveValue('135')
  await expect(page.getByText('Phase 2: Single-leg strength and balance')).toBeVisible()
})

test('a refused import quoting a long unbroken key wraps inside the phone’s width', async ({ page }) => {
  await openSettings(page)
  const backup = await exported(page)
  // A key the app doesn't keep, wide and unbroken: the refusal quotes it, cut to 40 characters.
  backup.settings = { ...backup.settings, ['W'.repeat(60)]: 1 }
  await page.locator('input[type="file"]').setInputFiles({ name: 'odd.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  const refusal = page.getByRole('region', { name: 'Import' }).getByRole('alert')
  await expect(refusal).toContainText('WWWWWWWWWW')
  expect(await refusal.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('an unreadable stored zone on a phone in New York is cleared by keeping New York, with no date change on the way', async ({ page }) => {
  await openSettings(page)
  // A row this build can't parse (one a later build wrote, say), put there straight into IndexedDB.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('knee-rebuild')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('timeZoneSettings', 'readwrite')
          tx.objectStore('timeZoneSettings').put({ id: 'time-zone', zone: 'America/New_York', later: true })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
  )
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  const unreadable = page.getByText('The stored time zone isn’t one this phone knows, so dates are counted in New York time until you pick one.')
  await expect(unreadable).toBeVisible()
  // The phone is in New York too, so no "Use" for its own zone; the picker already shows New York.
  await expect(page.getByRole('button', { name: /^Use .* time$/ })).toHaveCount(1)
  await page.getByRole('button', { name: 'Use New York time', exact: true }).click()
  await expect(page.getByText('Saved: dates stay in New York time.')).toBeVisible()
  await expect(unreadable).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Use New York time', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('Dates are counted in New York time (America/New_York). Today there is Tuesday Nov 3.')).toBeVisible()
  await expect(unreadable).toHaveCount(0)
})
