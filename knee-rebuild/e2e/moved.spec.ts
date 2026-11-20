import { expect, test, type Page } from './fixtures.ts'
import { onboardAsShawn } from './firstRun.ts'

/*
 * The old address (M-D1; PROGRAM-QUESTIONS 238, 239). The built app is served as if from
 * https://knee-rebuild.vercel.app: every request to that host is answered from the local preview
 * (the page's own `location.hostname` is what the notice reads), the account check falls through
 * to fixtures.ts's answer, and no other `/api` call leaves this machine. The service worker is
 * blocked: this spec is about the page, not the shell's cache (e2e/pwa.spec.ts has that).
 */

const OLD = 'https://knee-rebuild.vercel.app'
const TUESDAY_WEEK_1 = '2026-11-03T09:00:00-05:00'

test.use({ serviceWorkers: 'block' })

let errors: string[] = []

test.beforeEach(async ({ page, context, baseURL }) => {
  errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  await page.clock.install({ time: new Date(TUESDAY_WEEK_1) })
  // Registered after the fixture's own route, so it runs first; the account check falls back to it.
  await context.route(`${OLD}/**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/auth' && url.searchParams.get('action') === 'me') return route.fallback()
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, body: '' })
    return route.fulfill({ response: await route.fetch({ url: `${baseURL}${url.pathname}${url.search}` }) })
  })
})

test.afterEach(() => {
  expect(errors).toEqual([])
})

const notice = (page: Page) => page.getByRole('complementary', { name: 'New address' })

test('a fresh phone on the old address is sent to set up on the new one, with nothing to export', async ({ page }) => {
  await page.goto(`${OLD}/`)
  await expect(page.getByRole('heading', { name: 'Set up Knee Rebuild', level: 1 })).toBeVisible()
  await expect(notice(page)).toContainText('Knee Rebuild has moved to knee.shawnpillow.com. Set it up there instead')
  await expect(notice(page).getByRole('button', { name: 'Export JSON' })).toHaveCount(0)
  await expect(notice(page).getByRole('link', { name: 'Open knee.shawnpillow.com' })).toHaveAttribute('href', 'https://knee.shawnpillow.com')
})

test('a set-up phone on the old address gets the steps and the way to Export, and nothing above a session', async ({ page }) => {
  await page.goto(`${OLD}/`)
  await onboardAsShawn(page)

  await expect(notice(page)).toContainText('Your log stays at this address until you carry it across.')
  await notice(page).getByText('How to move').click()
  await expect(notice(page).getByRole('listitem')).toHaveText([
    'Export JSON here and save the file to Files.',
    'Open knee.shawnpillow.com in Safari, then Share, Add to Home Screen.',
    'Open the new icon and import the file on its first screen.',
    'From then on, log only in the new app. Delete this icon once the new one has logged a session.',
  ])

  // Export JSON opens Settings at its Export section, as Today's export line does.
  await notice(page).getByRole('button', { name: 'Export JSON' }).click()
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  await expect(page.getByRole('main').getByRole('button', { name: 'Export JSON' })).toBeVisible()

  // A session in progress never gets the notice above it.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Today' }).click()
  await page.getByRole('button', { name: 'Start Session A' }).click()
  await expect(page.getByRole('heading', { name: 'Session A', level: 1 })).toBeVisible()
  await expect(notice(page)).toHaveCount(0)
})

test('the new address, and every other host, shows no notice', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Set up Knee Rebuild', level: 1 })).toBeVisible()
  await expect(notice(page)).toHaveCount(0)
  await onboardAsShawn(page)
  await expect(notice(page)).toHaveCount(0)
})
