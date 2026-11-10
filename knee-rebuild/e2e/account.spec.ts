import { expect, test, type Page, type Route } from '@playwright/test'
import { onboardAsShawn } from './firstRun.ts'

/*
 * Settings, Account (M-U2), on the built app. `vite preview` has no functions, so /api/auth and
 * /api/strava are answered here the way api/auth.ts and api/strava.ts answer: these pin what the unit
 * tests can't, that the section shows, posts the typed code as JSON to its own origin, and says the
 * result in words. With no function at all (the preview's HTML), the section stays hidden: that is
 * every other spec, and Shawn's phone while accounts are off.
 */

const TUESDAY_WEEK_1 = '2026-11-03T09:00:00-05:00'
let errors: string[] = []

test.beforeEach(async ({ page }) => {
  errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    // Chromium logs every 4xx a fetch receives; a refused code is an answer the screen reads, not a fault.
    if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 401/.test(m.text())) errors.push(`console: ${m.text()}`)
  })
  await page.clock.install({ time: new Date(TUESDAY_WEEK_1) })
})

test.afterEach(() => {
  expect(errors).toEqual([])
})

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
const isApi = (path: string, action: string) => (url: URL) => url.pathname === path && url.searchParams.get('action') === action

async function openSettings(page: Page): Promise<void> {
  await page.goto('/')
  await onboardAsShawn(page)
  await page.goto('/#/settings')
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  await expect(page.getByText('Opening storage…')).toHaveCount(0)
}

test('with no accounts function the Account section stays hidden', async ({ page }) => {
  await openSettings(page)
  await expect(page.getByRole('region', { name: 'Export' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Account' })).toHaveCount(0)
})

test('signed out: a typed code is checked, redeemed as JSON, and the name and role show; Sign out signs out', async ({ page }) => {
  let signedIn = false
  const posts: { action: string; body: string | null; type: string | undefined }[] = []
  await page.route(isApi('/api/auth', 'me'), (route) => json(route, signedIn ? { configured: true, signedIn: true, name: 'Alex', role: 'tester' } : { configured: true, signedIn: false }))
  await page.route(isApi('/api/auth', 'redeem'), (route) => {
    posts.push({ action: 'redeem', body: route.request().postData(), type: route.request().headers()['content-type'] })
    signedIn = true
    return json(route, { configured: true, signedIn: true, name: 'Alex', role: 'tester' })
  })
  await page.route(isApi('/api/auth', 'sign-out'), (route) => {
    posts.push({ action: 'sign-out', body: route.request().postData(), type: route.request().headers()['content-type'] })
    signedIn = false
    return json(route, { configured: true, signedIn: false })
  })
  await page.route(isApi('/api/strava', 'status'), (route) => json(route, { configured: true, connected: false }))

  await openSettings(page)
  const account = page.getByRole('region', { name: 'Account' })
  await expect(account.getByText('Have an invite code?')).toBeVisible()
  const field = account.getByRole('textbox', { name: 'Invite code' })

  // Checked on the phone first: the wrong length is said in words, and nothing is sent.
  await field.fill('7K3M-Q9X2')
  await account.getByRole('button', { name: 'Redeem' }).click()
  await expect(account.getByRole('alert')).toHaveText('A code is 16 letters and numbers; that was 8.')
  expect(posts).toEqual([])

  await field.fill('7k3m-q9x2-t4hb-8rd7')
  await account.getByRole('button', { name: 'Redeem' }).click()
  await expect(account.getByText('Signed in as Alex, a tester.')).toBeVisible()
  expect(posts).toEqual([{ action: 'redeem', body: '{"code":"7k3m-q9x2-t4hb-8rd7"}', type: 'application/json' }])

  // Again on the next visit: the server says so.
  await page.reload()
  await expect(page.getByRole('region', { name: 'Account' }).getByText('Signed in as Alex, a tester.')).toBeVisible()

  await page.getByRole('region', { name: 'Account' }).getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('region', { name: 'Account' }).getByText('Signed out on this phone.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Account' }).getByText('Have an invite code?')).toBeVisible()
  expect(posts.map((p) => p.action)).toEqual(['redeem', 'sign-out'])
})

test('a refused code is said in words, and the field keeps it', async ({ page }) => {
  await page.route(isApi('/api/auth', 'me'), (route) => json(route, { configured: true, signedIn: false }))
  await page.route(isApi('/api/auth', 'redeem'), (route) => json(route, { error: 'That code didn’t work. Check it and try again.' }, 401))
  await openSettings(page)
  const account = page.getByRole('region', { name: 'Account' })
  await account.getByRole('textbox', { name: 'Invite code' }).fill('ZZZZ-ZZZZ-ZZZZ-ZZZF')
  await account.getByRole('button', { name: 'Redeem' }).click()
  await expect(account.getByRole('alert')).toHaveText('That code didn’t work. Check each character and try again.')
  await expect(account.getByRole('textbox', { name: 'Invite code' })).toHaveValue('ZZZZ-ZZZZ-ZZZZ-ZZZF')
})

test('Import from Strava says an account is needed first, and opens Settings', async ({ page }) => {
  await page.route(isApi('/api/strava', 'status'), (route) => json(route, { error: 'Sign in on this phone first: Settings, Account.', account: 'required' }, 401))
  await page.route(isApi('/api/auth', 'me'), (route) => json(route, { configured: true, signedIn: false }))
  await openSettings(page)
  await page.goto('/#/strava')
  await expect(page.getByText('Strava needs an account on this app first. Enter your invite code in Settings, under Account, then come back.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Connect with Strava' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Open Settings' }).click()
  await expect(page.getByRole('region', { name: 'Account' }).getByText('Have an invite code?')).toBeVisible()
})
