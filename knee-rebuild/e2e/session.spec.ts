import { expect, test, type Locator, type Page } from '@playwright/test'
import { onboardAsShawn } from './firstRun.ts'

/*
 * The smoke test (docs/m6-brief.md section 3): the built app, served by `vite preview`, run the way
 * Shawn runs week 1. Session A on Tuesday of week 1 start to finish (the loads picked, a pain rating
 * per exercise, one swap, Finish), the morning check the next day, then Session A on Tuesday of
 * week 2 with the loads the week 1 reading decided. The clock is Playwright's: the app reads the
 * date only through `new Date()`, so moving the browser's clock moves the program's calendar.
 *
 * Rule 4 moves a load up only after two clean readings in a row, so one week of Session A can't
 * raise one. What week 2 shows instead is each kind of decision one session can make: a clean
 * exercise carries the load picked in week 1 ("Clean once"), which only reads clean because the
 * morning check came in (without one, unknown reads hold); and the exercise rated 6 backs off to
 * 0.75 of its load, rounded down to the 5 lb step.
 */

const TUESDAY_WEEK_1 = '2026-11-03T09:00:00-05:00'
const WEDNESDAY_WEEK_1 = '2026-11-04T07:30:00-05:00'
const TUESDAY_WEEK_2 = '2026-11-10T09:00:00-05:00'

/** What each exercise gets in week 1: the load picked the first time (lb), and its one pain rating. */
const WEEK_1: Record<string, { load?: number; pain: number }> = {
  'Leg press, both legs': { load: 90, pain: 2 },
  // Over 5: rule 1 reads back-off, so week 2 cuts the load to 0.75 of it, rounded down to the 5 lb step.
  'Seated leg curl': { load: 60, pain: 6 },
  // The swap: Session A's dumbbell bench press runs as the chest press machine this once.
  'Chest press machine': { load: 50, pain: 1 },
  'Lat pulldown': { load: 70, pain: 1 },
  'Hip abductor machine': { load: 70, pain: 2 },
  'Standing calf raise on the leg press or Smith': { load: 90, pain: 1 },
  'Single-leg balance': { pain: 1 },
  'Dead bug': { pain: 0 },
}

const SWAP = { from: 'Dumbbell bench press', to: 'Chest press machine' }

function nowCard(page: Page): Locator {
  return page.getByRole('region', { name: 'Now' })
}

function doneBar(page: Page) {
  const bar = page.locator('[aria-label="Done bar"]')
  return { line: bar.locator('p').last(), button: bar.getByRole('button').last() }
}

/** The bar's two waits on a tap: a load to pick and a pain to rate. Its button is disabled for them, and for the moment a write takes. */
const WAITS = new Set(['Pick a load first', 'Rate pain first'])

/** The bar's label once no write is in flight: enabled, or disabled only because it waits on a tap. */
async function settled(button: Locator): Promise<string> {
  let label = ''
  await expect(async () => {
    label = (await button.textContent())?.trim() ?? ''
    expect(WAITS.has(label) || (await button.isEnabled())).toBe(true)
  }).toPass({ timeout: 10_000 })
  return label
}

/** Moves the browser's clock and opens the app afresh on Today, the way the home-screen icon does, so `useToday()` reads the new day. */
async function openOn(page: Page, when: string): Promise<void> {
  await page.clock.setSystemTime(new Date(when))
  await page.goto('/')
}

test('Session A at week 1, the morning check, and Session A at week 2', async ({ page }) => {
  // A script error or a console error (a write Dexie refused, a failed load) fails the run, as in e2e/pwa.spec.ts.
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })

  await page.clock.install({ time: new Date(TUESDAY_WEEK_1) })
  await page.goto('/')
  await onboardAsShawn(page)

  // Today, Tuesday of week 1: Session A, one Start button.
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  await expect(page.getByText('Phase 1 · Week 1')).toBeVisible()
  await page.getByRole('button', { name: 'Start Session A' }).click()
  await expect(page.getByRole('heading', { name: 'Session A', level: 1 })).toBeVisible()

  const card = nowCard(page)
  const bar = doneBar(page)
  const logged: string[] = []
  let swapped = false

  // Every step the run order offers, until the bar offers Finish: the loop never decides the order.
  for (let guard = 0; guard < 80; guard++) {
    const label = await settled(bar.button)
    if (label === 'Finish session') break
    const name = (await card.getByRole('heading', { level: 2 }).textContent())?.trim() ?? ''

    if (name === SWAP.from && !swapped) {
      await card.getByRole('button', { name: 'Swap', exact: true }).click()
      await card.getByRole('button', { name: new RegExp(`^${SWAP.to}`) }).click()
      await expect(card.getByRole('heading', { level: 2 })).toHaveText(SWAP.to)
      swapped = true
      continue
    }
    const plan = WEEK_1[name]
    if (!plan) throw new Error(`Session A offered ${name}, which the smoke test has no plan for`)

    if (label === 'Rate pain first') {
      await card.getByRole('group', { name: 'Pain this exercise' }).getByRole('button', { name: String(plan.pain), exact: true }).click()
      await expect(bar.button).not.toHaveText('Rate pain first')
      continue
    }
    if (label === 'Pick a load first') {
      if (plan.load === undefined) throw new Error(`${name} asked for a load the plan doesn't have`)
      await card.getByRole('textbox', { name: 'Weight (lb)' }).fill(String(plan.load))
      await expect(bar.button).not.toHaveText('Pick a load first')
      continue
    }
    expect(label).toMatch(/^Done: set \d+ of \d+/)
    const line = (await bar.line.textContent()) ?? ''
    if (plan.load !== undefined) expect(line).toContain(`${plan.load} lb`)
    expect(line).toContain(`pain ${plan.pain}`)
    await bar.button.click()
    // The write lands and the card moves to the next step: the bar's line changes.
    await expect(bar.line).not.toHaveText(line)
    logged.push(`${name}: ${label}`)
  }

  expect(swapped).toBe(true)
  // Week 1's sets: 3 each for slots 1 to 4 and 6 to 8, 2 for the abductor; the optional elliptical left out.
  expect(logged).toHaveLength(23)
  for (const name of Object.keys(WEEK_1)) expect(logged.some((l) => l.startsWith(`${name}:`)), name).toBe(true)

  // Finish: max pain during the session, then the summary with each exercise's reading in words.
  await bar.button.click()
  const finish = page.getByRole('region', { name: 'Finish session' })
  await finish.getByRole('group', { name: 'Max pain during the session' }).getByRole('button', { name: '6', exact: true }).click()
  await finish.getByRole('button', { name: 'Finish session' }).click()
  const summary = page.getByRole('region', { name: 'Summary' })
  await expect(summary.getByText('Finished · max pain 6.')).toBeVisible()
  const row = (name: string) => summary.getByRole('listitem').filter({ hasText: name })
  await expect(row('Leg press, both legs')).toContainText('90 lb × 10, 10, 10')
  await expect(row('Leg press, both legs')).toContainText('Clean')
  await expect(row('Seated leg curl')).toContainText('60 lb × 12, 12, 12')
  await expect(row('Seated leg curl')).toContainText('Back off')
  await expect(row('Chest press machine')).toContainText('50 lb × 8, 8, 8')

  // Wednesday morning: Today names yesterday's Session A; the check for it reads clean.
  await openOn(page, WEDNESDAY_WEEK_1)
  await expect(page.getByText('Wednesday, November 4')).toBeVisible()
  const yesterday = page.getByRole('region', { name: 'Yesterday' })
  await expect(yesterday).toContainText('Session A')
  await yesterday.getByRole('button', { name: 'Morning check' }).click()
  await expect(page.getByRole('heading', { name: 'Morning check', level: 1 })).toBeVisible()
  await page.getByRole('switch', { name: /Stiffness gone within 30 minutes/ }).click()
  await page.getByRole('button', { name: 'Save check' }).click()
  await expect(page.getByText("Saved. For yesterday's Session A, Tuesday Nov 3.")).toBeVisible()
  await expect(page.getByRole('region', { name: 'Reading' })).toContainText('Clean')
  const next = page.getByRole('region', { name: 'Next time' })
  await expect(next).toContainText('Next Session A, week 2')
  await expect(next.getByRole('listitem').filter({ hasText: 'Leg press, both legs' })).toContainText('Clean once: same load, same target')
  await expect(next.getByRole('listitem').filter({ hasText: 'Seated leg curl' })).toContainText('rounded down to 45 lb')

  // Tuesday of week 2: Session A opens on the loads the week 1 reading decided, nothing left to pick.
  await openOn(page, TUESDAY_WEEK_2)
  await expect(page.getByText('Phase 1 · Week 2')).toBeVisible()
  await page.getByRole('button', { name: 'Start Session A' }).click()
  await expect(page.getByText('Phase 1 · Week 2 · Tuesday Nov 10')).toBeVisible()

  // Leg press read clean, and clean only because the morning check came in: the 90 lb picked in week 1, carried.
  await expect(card.getByRole('heading', { level: 2 })).toHaveText('Leg press, both legs')
  await expect(card.getByText('Clean once: same load, same target; clean again to progress.')).toBeVisible()
  await expect(card.getByRole('textbox', { name: 'Weight (lb)' })).toHaveValue('90')
  await expect(card.getByText('First time on this exercise')).toHaveCount(0)

  // The leg curl rated 6 backs off: 60 lb × 0.75 is 45, already on the 5 lb step.
  await page.getByRole('button', { name: /^Slot 2: Seated leg curl/ }).click()
  await expect(card.getByRole('heading', { level: 2 })).toHaveText('Seated leg curl')
  await expect(card.getByText('Back off: load × 0.75, rounded down to 45 lb.')).toBeVisible()
  await expect(card.getByRole('textbox', { name: 'Weight (lb)' })).toHaveValue('45')

  // The swap was for that session only: slot 3 is the dumbbell bench press again.
  await expect(page.getByRole('button', { name: /^Slot 3: Dumbbell bench press/ })).toBeVisible()

  expect(errors).toEqual([])
})
