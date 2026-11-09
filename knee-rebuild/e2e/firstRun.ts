import { expect, type Page } from '@playwright/test'

/*
 * First run (M-U1), walked the way Shawn would answer it: every spec sets its phone up through the
 * real first-run screens instead of a seed, so the smoke test covers the path a new phone takes.
 * Shawn's answers write exactly the rows his phone got before first run existed (src/db/onboarding.test.ts).
 */

/** Taps the primary Next on a step and waits for the next step's title. */
async function next(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: /^Next: / }).click()
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
}

/**
 * From a page showing first run's first screen (a fresh phone opened at `/`): right knee, week 1 on
 * `start` (Monday Nov 2 unless said), the home gym named Planet Fitness from its list with the 45°
 * press ticked and an 80 lb rack, program.md's bag, and the zone the browser runs in (New York in
 * playwright.config.ts). Ends on Today.
 */
export async function onboardAsShawn(page: Page, { start = '2026-11-02', zone = 'New York time (America/New_York)' }: { start?: string; zone?: string } = {}): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Set up Knee Rebuild', level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Set up this phone' }).click()

  await expect(page.getByRole('heading', { name: 'Injured side', level: 1 })).toBeVisible()
  await page.getByRole('radio', { name: /^Right knee/ }).click()
  await next(page, 'Start date')

  // The default on a Tuesday is the coming Monday, which would move week 1: Shawn's is Nov 2.
  await page.getByLabel('Week 1 starts on a Monday').fill(start)
  await next(page, 'Home gym')

  await page.getByLabel('What you will call it on Today').fill('Planet Fitness')
  await expect(page.getByRole('radio', { name: /^Start from Planet Fitness’s list/ })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('radiogroup', { name: 'Heaviest dumbbell' }).getByRole('radio', { name: /80 lb$/ }).click()
  await next(page, 'What it has')

  await page.getByRole('switch', { name: /^45° leg press/ }).click()
  await expect(page.getByRole('switch', { name: /^45° leg press/ })).toHaveAttribute('aria-checked', 'true')
  await next(page, 'Time zone')

  await expect(page.getByRole('combobox', { name: 'Time zone' }).locator('option:checked')).toHaveText(zone)
  await next(page, 'Ready')

  await expect(page.getByText('Injured: the right knee.')).toBeVisible()
  await page.getByRole('button', { name: 'Start the program' }).click()
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible()
}
