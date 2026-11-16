import { expect, test, type Locator, type Page } from './fixtures.ts'
import { onboardAsShawn } from './firstRun.ts'

/*
 * Tester mode on the built app (M-U3; PROGRAM-QUESTIONS 223 to 233). The app's own /api/auth is
 * answered as a signed-in tester (e2e/fixtures.ts, `me`), so the phone runs the program as written:
 * Today says so; Session A's card shows program.md's cell and waits for a typed load with nothing
 * prefilled; the Summary, Week and Progress carry no reading; the morning check with a red flag
 * ticked gives the tester's own note and no stop; Gates lists the criteria with no verdict and no
 * Advance. Then the same phone signed in as the admin: the engine is back, this morning's flag puts
 * it in the red-flag state, and the same Session A reads back off.
 */

const TESTER = { configured: true, signedIn: true, name: 'Alex', role: 'tester' }
const ADMIN = { configured: true, signedIn: true, name: 'Shawn', role: 'admin' }
const TUESDAY_WEEK_1 = '2026-11-03T09:00:00-05:00'
const WEDNESDAY_WEEK_1 = '2026-11-04T07:30:00-05:00'
const SESSION_A = '2026-11-03-p1-a'

/** The engine's words: none may show on a tester's screen (program.md's own text aside, which these screens don't print). */
const READING_WORDS = /\bclean\b|\bhold\b|\bback[ -]off\b|ortho or PT|progression|suspended|Stop\.|prescri|engine|budget|warm-up set|suggest|paus/i
const MODE_LINE = 'Tester account: this app shows the program as written and works out nothing from your logs.'

test.use({ me: TESTER })

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

function main(page: Page): Locator {
  return page.getByRole('main')
}

/** A screen's own text, without the tab bar, for the reading-words check. */
async function screenText(page: Page): Promise<string> {
  return (await main(page).innerText()).replace(/\s+/g, ' ')
}

async function openOn(page: Page, when: string, hash = '/'): Promise<void> {
  await page.clock.setSystemTime(new Date(when))
  await page.goto(hash)
}

test('a tester gets the program as written: no load, reading, verdict or stop anywhere; the admin gets the engine back', async ({ page }) => {
  await page.goto('/')
  await onboardAsShawn(page)

  // Today: the mode line under the date, Session A to start, nothing read.
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  await expect(page.getByText(MODE_LINE)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Down period' })).toHaveCount(0)
  expect(await screenText(page)).not.toMatch(READING_WORDS)

  // Session A: program.md's cell, a load typed with nothing prefilled, the pain rated.
  await page.getByRole('button', { name: 'Start Session A' }).click()
  await expect(page.getByRole('heading', { name: 'Session A', level: 1 })).toBeVisible()
  const card = page.getByRole('region', { name: 'Now' })
  const bar = page.locator('[aria-label="Done bar"]')
  const barButton = bar.getByRole('button').last()
  await expect(card.getByRole('heading', { level: 2 })).toHaveText('Leg press, both legs')
  await expect(card.getByText('3 × 10–12, RPE 6→7', { exact: true })).toBeVisible()
  await expect(card.getByRole('textbox', { name: 'Weight (lb)' })).toHaveValue('0')
  await expect(barButton).toHaveText('Type the load first')
  await expect(card.getByText('Type the load you’re using; the app proposes none.')).toBeVisible()
  expect(await card.innerText()).not.toMatch(READING_WORDS)

  await card.getByRole('textbox', { name: 'Weight (lb)' }).fill('100')
  await expect(barButton).toHaveText('Rate pain first')
  await card.getByRole('group', { name: 'Pain this exercise' }).getByRole('button', { name: '7', exact: true }).click()
  await expect(barButton).toHaveText(/^Done: set 1 of 3/)
  await barButton.click()
  // The next set carries the tester's own load and count, never one worked out.
  await expect(barButton).toHaveText(/^Done: set 2 of 3/)
  await expect(bar.locator('p').last()).toContainText('100 lb')
  await expect(card.getByRole('textbox', { name: 'Weight (lb)' })).toHaveValue('100')
  await barButton.click()
  await expect(barButton).toHaveText(/^Done: set 3 of 3/)

  // Finish: the Summary counts written sets and reads nothing.
  await page.getByRole('button', { name: 'Finish session' }).last().click()
  const finish = page.getByRole('region', { name: 'Finish session' })
  expect(await finish.innerText()).not.toMatch(READING_WORDS)
  await finish.getByRole('group', { name: 'Max pain during the session' }).getByRole('button', { name: '7', exact: true }).click()
  await finish.getByRole('button', { name: 'Finish session' }).click()
  const summary = page.getByRole('region', { name: 'Summary' })
  await expect(summary.getByText('Finished · max pain 7.')).toBeVisible()
  await expect(summary).toContainText('written sets')
  await expect(summary.getByRole('listitem').filter({ hasText: 'Leg press, both legs' })).toContainText('100 lb × 10, 10')
  expect(await summary.innerText()).not.toMatch(READING_WORDS)

  // Wednesday: the morning check with Locking ticked is the tester's own note; no reading, no stop, nothing suspended.
  await openOn(page, WEDNESDAY_WEEK_1, '/#/morning')
  await expect(page.getByRole('heading', { name: 'Morning check', level: 1 })).toBeVisible()
  await expect(page.getByText('Tick any that describe this morning. This app gives no medical advice and decides nothing from these; what you tick is kept as your own note.')).toBeVisible()
  await page.getByRole('switch', { name: /Stiffness gone within 30 minutes/ }).click()
  await page.getByRole('switch', { name: /^Locking or catching/ }).click()
  expect(await screenText(page)).not.toMatch(/ortho or PT|reads back off/i)
  await page.getByRole('button', { name: 'Save check' }).click()
  const note = page.getByRole('region', { name: 'Your note' })
  await expect(note).toContainText('You ticked on this morning’s check: Locking or catching: a mechanical block to straightening or bending. This app gives no medical advice and changes nothing because of it. If it worries you, contact a clinician.')
  await expect(page.getByRole('region', { name: 'What you logged' })).toContainText('Stiffness gone within 30 minutes: yes')
  await expect(page.getByRole('region', { name: 'Reading' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Red flag' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Next time' })).toHaveCount(0)

  // Today after it: the run as written, the own note, no stop and no suggestion.
  await page.goto('/')
  await expect(page.getByText(MODE_LINE)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Your note' })).toContainText('You ticked on this morning’s check: Locking or catching')
  await expect(page.getByRole('heading', { name: 'Stop. Call the ortho or PT.' })).toHaveCount(0)
  await expect(page.getByText(/^Suggested:/)).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Yesterday' })).toContainText('Session A: logged.')

  // Week, Progress, the run logger, Preview and Settings: nothing read anywhere.
  await page.goto('/#/week')
  await expect(page.getByRole('heading', { name: 'Week', level: 1 })).toBeVisible()
  await expect(page.getByText('Target from the plan')).toBeVisible()
  expect(await screenText(page)).not.toMatch(READING_WORDS)

  await page.goto('/#/progress')
  await expect(page.getByRole('heading', { name: 'Sessions done by week', level: 2 })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Consecutive clean days' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Morning tags' })).toHaveCount(0)

  await page.goto('/#/run')
  await expect(page.getByRole('region', { name: 'As written' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Suggested' })).toHaveCount(0)
  expect((await screenText(page)).replace('Elliptical instead if the knee reads Hold', '')).not.toMatch(READING_WORDS)

  await page.goto('/#/preview/2026-11-05')
  await expect(page.getByText('As program.md writes it. Logging changes none of it.')).toBeVisible()
  await expect(page.getByText(/^Warm-up sets?:/)).toHaveCount(0)

  await page.goto('/#/location/planet-fitness')
  await expect(page.getByText('The heaviest dumbbell is 80 lb; the load field stops there.')).toBeVisible()
  await expect(page.getByText(/won’t count as clean|Hold-day/)).toHaveCount(0)

  await page.goto('/#/settings')
  await expect(page.getByRole('region', { name: 'Account' })).toContainText(MODE_LINE)
  await expect(page.getByRole('region', { name: 'Red flag' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Injured side' })).toContainText('Unilateral slots log this side first.')
  await expect(page.getByRole('region', { name: 'Phase' })).toContainText('Read-only. On a tester account the phase stays where it is; the Gates screen shows its criteria as written.')
  expect(await screenText(page)).not.toMatch(READING_WORDS)
  expect(await screenText(page)).not.toMatch(/advances the phase/)

  // Gates: the criteria as written, no verdict, no hop-test entry, no Advance.
  await page.goto('/#/gates')
  await expect(page.getByRole('heading', { name: 'Criteria, as written', level: 2 })).toBeVisible()
  await expect(page.getByText('The program’s criteria for leaving Phase 1, as written. This app doesn’t check them on a tester account, and the phase stays where it is.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Advance/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Enter/ })).toHaveCount(0)
  await expect(page.getByText(/items? pass/)).toHaveCount(0)

  // The same phone signed in as the admin: the engine is back on the next screen, and Session A reads back off.
  await page.route(
    (url) => url.pathname === '/api/auth' && url.searchParams.get('action') === 'me',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ADMIN) }),
  )
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  await expect(page.getByText(MODE_LINE)).toHaveCount(0)
  // This morning's check, saved in tester mode with Locking ticked, now puts the phone in the red-flag state (PROGRAM-QUESTIONS 236).
  await expect(page.getByRole('heading', { name: 'Stop. Call the ortho or PT.' })).toBeVisible()
  await page.goto('/#/settings')
  await expect(page.getByRole('region', { name: 'Red flag' })).toContainText('Locking or catching')
  await page.goto(`/#/session/${SESSION_A}`)
  const full = page.getByRole('region', { name: 'Summary' })
  await expect(full.getByRole('listitem').filter({ hasText: 'Leg press, both legs' })).toContainText('Back off')
  await expect(full).toContainText('prescribed sets')
})

test('first run tells a tester nothing of a budget for the healthy side', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Set up Knee Rebuild', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Set up this phone' }).click()
  await expect(page.getByRole('heading', { name: 'Injured side', level: 1 })).toBeVisible()
  await expect(page.getByText('Unilateral slots log this side first. Settings can change it later.')).toBeVisible()
  expect(await screenText(page)).not.toMatch(READING_WORDS)
})
