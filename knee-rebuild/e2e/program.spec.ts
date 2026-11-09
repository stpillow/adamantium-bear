import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'

/*
 * The Program screen's editor on the built app, held the way Shawn holds the phone. What the unit
 * tests can't reach: what a typed new cue does when the view or the screen changes before Add cue.
 */

/** Tuesday of week 1: Phase 1, as a fresh phone starts. */
const TUESDAY_WEEK_1 = '2026-11-03T09:00:00-05:00'
const LEG_PRESS = 'Leg press, both legs'

let errors: string[] = []

test.beforeEach(async ({ page }) => {
  errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  await page.clock.install({ time: new Date(TUESDAY_WEEK_1) })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  await page.goto('/#/program')
  await expect(page.getByRole('heading', { name: 'Program', level: 1 })).toBeVisible()
  await expect(page.getByText('Opening storage…')).toHaveCount(0)
})

test.afterEach(() => {
  expect(errors).toEqual([])
})

/** Phase 1 A's first slot, the leg press: its list item. */
function legPressSlot(page: Page): Locator {
  return page.getByRole('region', { name: 'Session A' }).getByRole('listitem').filter({ has: page.getByRole('heading', { name: LEG_PRESS, level: 3 }) })
}

const editButton = (page: Page) => page.getByRole('button', { name: `Edit cues and substitutions for ${LEG_PRESS}, slot 1` })
const doneButton = (page: Page) => page.getByRole('button', { name: `Done editing ${LEG_PRESS}, slot 1` })
const newCueField = (page: Page) => legPressSlot(page).getByLabel('A new cue, in your words')

test('a new cue typed but not added survives the program.md view and another tab, as its line says', async ({ page }) => {
  const cue = 'Knees track over the second toe'
  await editButton(page).click()
  await newCueField(page).fill(cue)

  // To program.md and back with the editor open: the editor and its field are as they were.
  await page.getByRole('radio', { name: /program\.md/ }).click()
  await expect(page.getByRole('heading', { name: LEG_PRESS, level: 3 })).toHaveCount(0)
  await page.getByRole('radio', { name: /This phase/ }).click()
  await expect(newCueField(page)).toHaveValue(cue)

  // Closed, the slot says the cue waits; it still does after the reference view and after another tab.
  await doneButton(page).click()
  const waits = legPressSlot(page).getByText(`Your new cue wasn’t added yet: “${cue}”.`, { exact: false })
  await expect(waits).toBeVisible()
  await page.getByRole('radio', { name: /program\.md/ }).click()
  await page.getByRole('radio', { name: /This phase/ }).click()
  await expect(waits).toBeVisible()
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Today' }).click()
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  // Back the way the tabs go, More then Program: the same page, no reload.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'More' }).click()
  await page.getByRole('button', { name: 'Program', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Program', level: 1 })).toBeVisible()
  await expect(waits).toBeVisible()

  // It waits in the field, as the line says, and Add cue adds it.
  await editButton(page).click()
  await expect(newCueField(page)).toHaveValue(cue)
  await legPressSlot(page).getByRole('button', { name: 'Add cue' }).click()
  await expect(newCueField(page)).toHaveValue('')
  await doneButton(page).click()
  await expect(legPressSlot(page).getByRole('listitem').filter({ hasText: cue })).toHaveCount(1)
  await expect(waits).toHaveCount(0)
})

/** No CSS scroll anchoring, as on an iPhone before iOS 27: only what the app does keeps a tap's place. */
async function withoutScrollAnchoring(page: Page): Promise<void> {
  await page.addStyleTag({ content: 'html, body, * { overflow-anchor: none !important; }' })
}

/** Where an element sits on screen now: its top, in CSS px from the top of the viewport. */
async function topOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('not on the page')
  return box.y
}

/** Puts an element's center at `y` px from the top of the viewport, where a thumb taps. */
async function scrollTo(page: Page, locator: Locator, y: number): Promise<void> {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (!box) throw new Error('not on the page')
  await page.mouse.wheel(0, box.y + box.height / 2 - y)
  await expect(async () => expect(Math.abs((await topOf(locator)) + box.height / 2 - y)).toBeLessThan(4)).toPass()
}

test('Remove says so with Put it back where the tap was, and the undo outlives Done editing and the program.md view', async ({ page }) => {
  await withoutScrollAnchoring(page)
  const slot = legPressSlot(page)
  const cue = 'Drive through the whole foot; heels stay down'
  await editButton(page).click()
  await newCueField(page).fill(cue)
  await slot.getByRole('button', { name: 'Add cue' }).click()
  await expect(slot.getByRole('textbox', { name: 'Cue 2' })).toHaveValue(cue)

  // A substitution: the thumb at y 560 on the second one's Remove.
  const remove = slot.getByRole('button', { name: 'Remove Smith machine box squat' })
  await scrollTo(page, remove, 560)
  await remove.click()
  const putBack = slot.getByRole('button', { name: 'Put it back' })
  await expect(slot.getByText('Removed Smith machine box squat from the substitutions.')).toBeInViewport()
  await expect(putBack).toBeInViewport()
  expect(Math.abs((await topOf(putBack)) - 560)).toBeLessThan(160)

  // Closed, the slot still offers it, and it goes back where it stood: second on the list.
  await doneButton(page).click()
  await expect(slot.getByText('Removed Smith machine box squat from the substitutions.')).toBeVisible()
  await page.getByRole('radio', { name: /program\.md/ }).click()
  await page.getByRole('radio', { name: /This phase/ }).click()
  await putBack.click()
  await expect(putBack).toHaveCount(0)
  await expect(slot.getByRole('list').last().getByRole('listitem')).toHaveText(['45° leg press', 'Smith machine box squat', 'Goblet squat to a bench'])

  // His own cue: removed, the editor closed and the screen left, it can still come back.
  await editButton(page).click()
  const removeCue = slot.getByRole('button', { name: 'Remove cue 2' })
  await scrollTo(page, removeCue, 560)
  await removeCue.click()
  await expect(slot.getByText(`Removed the cue “${cue}”.`)).toBeInViewport()
  await expect(putBack).toBeInViewport()
  await doneButton(page).click()
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'More' }).click()
  await page.getByRole('button', { name: 'Program', exact: true }).click()
  await expect(slot.getByText(`Removed the cue “${cue}”.`)).toBeVisible()
  await putBack.click()
  await expect(slot.getByRole('listitem').filter({ hasText: cue })).toHaveCount(1)
})

/** From any tab to a screen on More, the way Shawn goes: More, then the screen's button. No reload. */
async function viaMore(page: Page, name: 'Settings' | 'Program'): Promise<void> {
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'More' }).click()
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
}

/** A substitution removed and a new cue typed but not added: what the slot holds that isn't stored. */
async function leaveDrafts(page: Page): Promise<void> {
  const slot = legPressSlot(page)
  await editButton(page).click()
  await slot.getByRole('button', { name: 'Remove Smith machine box squat' }).click()
  await expect(slot.getByText('Removed Smith machine box squat from the substitutions.')).toBeVisible()
  await newCueField(page).fill('Typed before everything was replaced')
  await doneButton(page).click()
  await expect(slot.getByText('Your new cue wasn’t added yet', { exact: false })).toBeVisible()
}

async function expectNoDrafts(page: Page): Promise<void> {
  const slot = legPressSlot(page)
  await expect(slot.getByRole('list').last().getByRole('listitem')).toHaveText(['45° leg press', 'Smith machine box squat', 'Goblet squat to a bench'])
  await expect(slot.getByText('Removed Smith machine box squat from the substitutions.')).toHaveCount(0)
  await expect(slot.getByRole('button', { name: 'Put it back' })).toHaveCount(0)
  await expect(slot.getByText('Your new cue wasn’t added yet', { exact: false })).toHaveCount(0)
  await editButton(page).click()
  await expect(newCueField(page)).toHaveValue('')
}

test('Reset all data and an import let go of what the editor held for the lists they replaced: no Put it back, no waiting cue', async ({ page }) => {
  // Reset all data: "There is no undo", so nothing the old lists held is offered back.
  await leaveDrafts(page)
  await viaMore(page, 'Settings')
  await page.getByRole('button', { name: 'Reset all data' }).click()
  await page.getByRole('button', { name: 'Yes, erase everything' }).click()
  await expect(page.getByText('Everything on this phone was erased. Settings are back to their defaults.')).toBeVisible()
  await viaMore(page, 'Program')
  await expectNoDrafts(page)
  await doneButton(page).click()

  // An import replaces every list with the file's: a removal from the old ones is no longer there to put back.
  await viaMore(page, 'Settings')
  await page.getByRole('button', { name: 'Export JSON' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: /^Save knee-rebuild-/ }).click()
  const file = await readFile(await (await download).path())
  await viaMore(page, 'Program')
  await leaveDrafts(page)
  await viaMore(page, 'Settings')
  await page.locator('input[type="file"]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: file })
  await page.getByRole('button', { name: 'Yes, replace everything' }).click()
  await expect(page.getByText(/^Imported backup\.json\./)).toBeVisible()
  await viaMore(page, 'Program')
  await expectNoDrafts(page)
})

/** Done editing at y 560, after a refused reword and a new cue left in its field. */
async function closeWithWordsBelow(page: Page): Promise<void> {
  const slot = legPressSlot(page)
  await editButton(page).click()
  await slot.getByRole('textbox', { name: 'Cue 1' }).fill('x'.repeat(230))
  await newCueField(page).fill('Knee over the second toe')
  await expect(slot.getByText('A cue runs to 200 characters', { exact: false }).first()).toBeVisible()
  const done = doneButton(page)
  await scrollTo(page, done, 560)
  const before = await topOf(done)
  await done.click()
  // The same button, now Edit, stays under the thumb, with what it says under it on screen.
  const edit = editButton(page)
  await expect(edit).toBeVisible()
  expect(Math.abs((await topOf(edit)) - before)).toBeLessThan(4)
  await expect(slot.getByText('Cue 1 is kept as it was until it fits.', { exact: false })).toBeInViewport()
  await expect(slot.getByText('Your new cue wasn’t added yet', { exact: false })).toBeInViewport()
}

test('Done editing keeps the slot under the thumb without scroll anchoring, so what it says under it is on screen', async ({ page }) => {
  await withoutScrollAnchoring(page)
  await closeWithWordsBelow(page)
})

test('Done editing keeps the slot under the thumb with scroll anchoring too', async ({ page }) => {
  await closeWithWordsBelow(page)
})

for (const anchoring of [false, true]) {
  test(`another slot’s Edit, under an open editor, opens that slot where it was tapped${anchoring ? ', with scroll anchoring' : ''}`, async ({ page }) => {
    if (!anchoring) await withoutScrollAnchoring(page)
    await opensWhereTapped(page)
  })
}

async function opensWhereTapped(page: Page): Promise<void> {
  await editButton(page).click()
  const pulldown = page.getByRole('button', { name: /^Edit cues and substitutions for Lat pulldown/ })
  await scrollTo(page, pulldown, 560)
  const heading = page.getByRole('region', { name: 'Session A' }).getByRole('heading', { name: 'Lat pulldown', level: 3 })
  const before = await topOf(heading)
  await pulldown.click()
  await expect(page.getByRole('button', { name: /^Done editing Lat pulldown/ })).toBeVisible()
  expect(Math.abs((await topOf(heading)) - before)).toBeLessThan(4)
  await expect(heading).toBeInViewport()
}

test('the Evidence view lists studies as words, links them out as plain navigations, and the page never leaves its origin', async ({ page }) => {
  // Every request the page makes, from a reload on: none may go to another host (Batch F: zero literature calls).
  const origin = new URL(page.url()).origin
  const elsewhere: string[] = []
  page.on('request', (r) => {
    if (!r.url().startsWith('data:') && new URL(r.url()).origin !== origin) elsewhere.push(r.url())
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Program', level: 1 })).toBeVisible()

  await page.getByRole('radio', { name: /Evidence/ }).click()
  await expect(page.getByText('Published studies behind this phase', { exact: false })).toBeVisible()
  const phase = page.getByRole('region', { name: 'Phase 1 · Foundation' })
  await expect(phase.getByRole('heading', { name: 'Phase 1 · Foundation', level: 3 })).toBeVisible()
  await expect(phase.getByText('5 studies', { exact: true })).toBeVisible()

  // Rules the app runs on, opened: the pain-monitoring studies, each grade a word beside its population.
  const rules = page.getByRole('region', { name: 'Rules the app runs on' })
  const show = rules.getByRole('button', { name: /^Show \d+ studies$/ })
  await expect(show).toHaveAttribute('aria-expanded', 'false')
  await show.click()
  await expect(rules.getByRole('button', { name: 'Hide studies' })).toHaveAttribute('aria-expanded', 'true')
  const silbernagel = rules.getByRole('listitem').filter({ hasText: 'Continued sports activity, using a pain-monitoring model' })
  await expect(silbernagel.getByText('Randomized trial · Low certainty (GRADE)')).toBeVisible()
  await expect(silbernagel.getByText(/^Studied: adults with Achilles tendinopathy/)).toBeVisible()
  await expect(page.getByText('Citations found through Europe PMC and PubMed (US National Library of Medicine).')).toBeVisible()

  // The DOI link: a plain anchor to doi.org that opens the browser, at least 44 px tall.
  const doi = silbernagel.getByRole('link', { name: 'DOI: Silbernagel et al., 2007, opens in the browser' })
  await expect(doi).toHaveAttribute('href', 'https://doi.org/10.1177/0363546506298279')
  await expect(doi).toHaveAttribute('target', '_blank')
  await expect(doi).toHaveAttribute('rel', 'noopener noreferrer')
  expect((await doi.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

  // Every pattern now has a study (PROGRAM-QUESTIONS 202): Push, empty in the first build, shows its count and a button.
  const push = page.getByRole('region', { name: 'Push' })
  await expect(push.getByText('3 studies', { exact: true })).toBeVisible()
  await expect(push.getByRole('button', { name: 'Show 3 studies' })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByText('No study listed yet', { exact: true })).toHaveCount(0)

  // Gates: "Why this test" on the clean-weeks item, then the attribution and the no-study note.
  await page.goto('/#/gates')
  await expect(page.getByRole('heading', { name: 'Gates', level: 1 })).toBeVisible()
  const cleanWeeks = page.getByRole('listitem').filter({ hasText: 'two consecutive clean weeks' })
  const why = cleanWeeks.getByRole('button', { name: 'Why this test' })
  await expect(why).toHaveAttribute('aria-expanded', 'false')
  await why.click()
  await expect(cleanWeeks.getByRole('button', { name: 'Hide why' })).toHaveAttribute('aria-expanded', 'true')
  await expect(cleanWeeks.getByText(/^Loading through pain that stays within set limits/)).toBeVisible()
  await expect(cleanWeeks.getByText('Sprague et al., 2021, Randomized trial: Low certainty (GRADE).')).toBeVisible()
  await expect(page.getByText('Citations found through Europe PMC and PubMed (US National Library of Medicine).')).toBeVisible()
  // Every Gate 1 item now has a study, so the no-study note is gone; the stance item's citations put who was studied beside each grade.
  await expect(page.getByText('Items without “Why this test” have no study listed yet; their lines come from program.md.')).toHaveCount(0)
  const stance = page.getByRole('listitem').filter({ hasText: '30 s of single-leg stance' }).first()
  await stance.getByRole('button', { name: 'Why this test' }).click()
  await expect(stance.getByText(/the 30 s line is the program’s own\.$/)).toBeVisible()
  const negahban = stance.getByRole('listitem').filter({ hasText: 'Negahban et al., 2014, Systematic review: Very low certainty (GRADE).' })
  await expect(negahban.getByText(/^Studied: people with an ACL injury not treated surgically/)).toBeVisible()
  await expect(negahban.getByText(/\(abstract only\)/)).toBeVisible()

  expect(elsewhere).toEqual([])
})
