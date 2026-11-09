import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { onboardAsShawn } from './firstRun.ts'
import { serveDist, type StaticServer } from './staticServer.ts'

/*
 * The PWA audit's manual checklist (docs/m6-brief.md section 4, results in docs/pwa-audit.md), the
 * part Lighthouse 12 no longer checks, as tests: the installable manifest, the service worker
 * controlling the page, every tab rendering offline after a reload with the fonts from the cache,
 * and the update prompt after a deploy. dist/ is the build `npm run e2e` just made (the config's
 * web server builds it); these tests serve it themselves so they can stop the server and change sw.js.
 */

const DIST = fileURLToPath(new URL('../dist', import.meta.url))
const VERCEL_JSON = fileURLToPath(new URL('../vercel.json', import.meta.url))

/**
 * A fixed day, so the screens don't depend on the day the suite runs: Tuesday of week 2, Session A's
 * day, after week 1 began on Monday Nov 2 (the runner check below starts Session A on it).
 */
const TUESDAY_WEEK_2 = '2026-11-10T09:00:00-05:00'

/** Every route the app has, with the title its screen shows; the Session runner's has its own check below. */
const SCREENS: { hash: string; title: string }[] = [
  { hash: '#/today', title: 'Today' },
  { hash: '#/week', title: 'Week' },
  { hash: '#/progress', title: 'Progress' },
  { hash: '#/gates', title: 'Gates' },
  { hash: '#/more', title: 'More' },
  { hash: '#/morning', title: 'Morning check' },
  { hash: '#/run', title: 'Log a run' },
  { hash: '#/locations', title: 'Where you train' },
  { hash: '#/location/new', title: 'New location' },
  { hash: '#/location/planet-fitness', title: 'Planet Fitness' },
  { hash: '#/next-update', title: 'For the next program update' },
  { hash: '#/program', title: 'Program' },
  { hash: '#/settings', title: 'Settings' },
  // First run, once the phone is set up: a stale link lands on Today (M-U1).
  { hash: '#/welcome', title: 'Today' },
  { hash: '#/welcome/side', title: 'Today' },
]

const TABS = ['Today', 'Week', 'Progress', 'Gates', 'More'] as const

let server: StaticServer | null = null
/** What the browser complained of: a script error, a console error, a request the content security policy refused. */
let complaints: string[] = []

test.beforeEach(async ({ page }) => {
  complaints = []
  await page.clock.install({ time: new Date(TUESDAY_WEEK_2) })
  page.on('pageerror', (e) => complaints.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') complaints.push(`console: ${m.text()}`)
  })
})

test.afterEach(async () => {
  await server?.close().catch(() => undefined)
  server = null
  // Every check runs under vercel.json's headers: nothing the app does may trip its policy or throw.
  expect(complaints).toEqual([])
})

async function rendered(page: Page, title: string): Promise<void> {
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
  // Rendered means the screen read storage, not the frame waiting on it.
  await expect(page.getByText('Opening storage…')).toHaveCount(0)
}

/** First visit (set up through first run, as Shawn), then a reload: the worker installed (precache done) is controlling the page. */
async function controlled(page: Page, url: string): Promise<string> {
  await page.goto(`${url}/`)
  await onboardAsShawn(page)
  await rendered(page, 'Today')
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    const worker = registration.active
    if (worker && worker.state !== 'activated') await new Promise((resolve) => worker.addEventListener('statechange', resolve))
  })
  await page.reload()
  await rendered(page, 'Today')
  return page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? '')
}

test('the manifest is installable: name, standalone, theme color, icons 192, 512 and maskable at their stated sizes, no installability errors', async ({ page }) => {
  server = await serveDist(DIST, VERCEL_JSON)
  await page.goto(`${server.url}/`)
  // A fresh phone opens on first run, under vercel.json's policy with nothing to complain of (afterEach); then Today.
  await rendered(page, 'Set up Knee Rebuild')
  await onboardAsShawn(page)
  await rendered(page, 'Today')

  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBe('/manifest.webmanifest')
  const response = await page.request.get(`${server.url}${href}`)
  expect(response.ok()).toBe(true)
  const manifest = (await response.json()) as {
    id?: string
    name: string
    short_name: string
    start_url: string
    scope: string
    display: string
    theme_color: string
    background_color: string
    icons: { src: string; sizes: string; type: string; purpose?: string }[]
  }
  expect(manifest).toMatchObject({ name: 'Knee Rebuild', short_name: 'Knee', start_url: '/', scope: '/', display: 'standalone', theme_color: '#001A57', background_color: '#001A57' })
  expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe(manifest.theme_color)

  // Chromium's own verdict on the manifest and the page: nothing stands between it and an install.
  const cdp = await page.context().newCDPSession(page)
  const parsed = await cdp.send('Page.getAppManifest')
  expect(parsed.errors).toEqual([])
  expect((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([])
  // The app's identity is stated, not left to start_url: '/', which resolves to the id Chromium took
  // from start_url before the manifest named one, so the installed app keeps its identity, and keeps
  // it again if start_url ever moves.
  expect(manifest.id).toBe('/')
  expect(parsed.manifest.id).toBe(`${server.url}/`)

  const purposes = (sizes: string) => manifest.icons.filter((i) => i.sizes === sizes).map((i) => i.purpose ?? 'any')
  expect(purposes('192x192')).toContain('any')
  expect(purposes('512x512')).toContain('any')
  expect(purposes('512x512')).toContain('maskable')

  // Each icon, and iOS's apple-touch-icon, decodes at the size it claims.
  const icons = [...manifest.icons.map((i) => ({ src: `/${i.src}`, sizes: i.sizes })), { src: '/apple-touch-icon.png', sizes: '180x180' }]
  for (const icon of icons) {
    const size = await page.evaluate(
      (src) =>
        new Promise<string>((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(`${img.naturalWidth}x${img.naturalHeight}`)
          img.onerror = () => reject(new Error(`${src} did not load`))
          img.src = src
        }),
      icon.src,
    )
    expect(size, icon.src).toBe(icon.sizes)
  }
})

test('the precache lists each file once: the page, its scripts and styles, every font, icon and the manifest', async ({ page }) => {
  server = await serveDist(DIST, VERCEL_JSON)
  const sw = await (await page.request.get(`${server.url}/sw.js`)).text()
  const urls = [...sw.matchAll(/\{url:"([^"]+)"/g)].map((m) => m[1] ?? '')
  expect(urls.length).toBeGreaterThan(0)
  expect(urls.filter((u, i) => urls.indexOf(u) !== i), 'listed twice').toEqual([])
  for (const file of ['index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'apple-touch-icon.png', 'favicon-32.png']) expect(urls, file).toContain(file)
  for (const kind of [/^assets\/index-.+\.js$/, /^assets\/App-.+\.js$/, /^assets\/index-.+\.css$/, /^assets\/fraunces-.+\.woff2$/, /^assets\/ibm-plex-sans-.+\.woff2$/, /^assets\/ibm-plex-mono-.+\.woff2$/])
    expect(urls.some((u) => kind.test(u)), String(kind)).toBe(true)
})

test('the service worker controls the page, and every screen renders offline after a reload, fonts included', async ({ page, context }) => {
  server = await serveDist(DIST, VERCEL_JSON)
  const url = server.url
  expect(await controlled(page, url)).toBe(`${url}/sw.js`)

  // Offline for real: the server is gone, and the browser is told so too.
  await server.close()
  server = null
  await context.setOffline(true)
  const failed: string[] = []
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText ?? ''}`))

  for (const screen of SCREENS) {
    await page.goto(`${url}/${screen.hash}`)
    await page.reload()
    await rendered(page, screen.title)
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null), screen.hash).toBe(true)
  }

  // The tab bar, still offline: each tab opens its screen.
  await page.goto(`${url}/#/today`)
  await page.reload()
  for (const tab of TABS) {
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: tab }).click()
    await rendered(page, tab)
  }

  // program.md as reference, offline: its charts are bundled assets, so they come out of the precache too.
  await page.goto(`${url}/#/program`)
  await rendered(page, 'Program')
  await page.getByRole('radio', { name: /program\.md/ }).click()
  const images = page.locator('main img')
  await expect(images.first()).toBeVisible()
  // Every chart decoded: a broken one is complete with no width, and the poll runs out.
  await expect.poll(() => images.evaluateAll((all) => all.every((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true)

  // The Evidence view, offline: the citations are bundled, so the studies list with no network (Batch F).
  await page.getByRole('radio', { name: /Evidence/ }).click()
  const phaseOne = page.getByRole('region', { name: 'Phase 1 · Foundation' })
  await phaseOne.getByRole('button', { name: 'Show 5 studies' }).click()
  await expect(phaseOne.getByRole('heading', { name: /^Shedding light on the non-operative treatment/, level: 4 })).toBeVisible()

  // The three vendored families came out of the cache: titles, body and labels in their own faces.
  const faces = await page.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, ''))
  })
  for (const family of ['Fraunces Variable', 'IBM Plex Sans', 'IBM Plex Mono']) expect(faces, family).toContain(family)
  expect(failed).toEqual([])
})

test('offline at the gym, the Session runner starts Session A, logs a set, and reopens on it after a reload with the set kept', async ({ page, context }) => {
  server = await serveDist(DIST, VERCEL_JSON)
  const url = server.url
  expect(await controlled(page, url)).toBe(`${url}/sw.js`)

  // No signal on the gym floor: the server is gone and the browser is told so.
  await server.close()
  server = null
  await context.setOffline(true)
  const failed: string[] = []
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText ?? ''}`))

  await page.getByRole('button', { name: 'Start Session A' }).click()
  await expect(page.getByRole('heading', { name: 'Session A', level: 1 })).toBeVisible()
  const session = new URL(page.url()).hash
  expect(session).toMatch(/^#\/session\/.+/)

  const card = page.getByRole('region', { name: 'Now' })
  const bar = page.locator('[aria-label="Done bar"]')
  const line = bar.locator('p').last()
  const done = bar.getByRole('button').last()
  await expect(card.getByRole('heading', { level: 2 })).toHaveText('Leg press, both legs')
  await card.getByRole('textbox', { name: 'Weight (lb)' }).fill('90')
  await card.getByRole('group', { name: 'Pain this exercise' }).getByRole('button', { name: '2', exact: true }).click()
  await expect(done).toHaveText(/^Done: set 1 of 3/)
  await done.click()
  await expect(line).toContainText('set 2 of 3')

  // The screen locked long enough for iOS to drop the page: it reopens from the cache, on the same
  // session, with the logged set read back out of storage and set 2 next.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Session A', level: 1 })).toBeVisible()
  expect(new URL(page.url()).hash).toBe(session)
  await expect(card.getByRole('heading', { level: 2 })).toHaveText('Leg press, both legs')
  await expect(line).toContainText('set 2 of 3')
  await expect(line).toContainText('90 lb')
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)
  expect(failed).toEqual([])
})

test('a deploy shows the update prompt, never reloads on its own, and Reload now brings the new worker in', async ({ page }) => {
  server = await serveDist(DIST, VERCEL_JSON)
  const url = server.url
  expect(await controlled(page, url)).toBe(`${url}/sw.js`)
  const prompt = page.getByRole('status').filter({ hasText: 'A new version is ready.' })
  await expect(prompt).toHaveCount(0)

  // The deploy: sw.js changes byte for byte, as it does whenever any precached file changes.
  server.setServiceWorkerSuffix('\n// the next deploy\n')
  await page.reload()
  await rendered(page, 'Today')
  // A mark on this page: it survives as long as the page is not reloaded.
  await page.evaluate(() => {
    ;(window as unknown as { keptPage?: boolean }).keptPage = true
  })

  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText('It will not reload on its own.')
  const waiting = () => page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => (r?.waiting ?? null) !== null))
  expect(await waiting()).toBe(true)
  // Mid-set, the prompt waits: a few seconds on, the same page is still here and the new worker still waits.
  await page.waitForTimeout(3_000)
  expect(await page.evaluate(() => (window as unknown as { keptPage?: boolean }).keptPage)).toBe(true)
  expect(await waiting()).toBe(true)
  await expect(prompt).toBeVisible()

  // Reload now: the waiting worker takes over and the page reloads, once, because he asked.
  const reloaded = page.waitForEvent('load')
  await prompt.getByRole('button', { name: 'Reload now' }).click()
  await reloaded
  await rendered(page, 'Today')
  expect(await page.evaluate(() => (window as unknown as { keptPage?: boolean }).keptPage ?? false)).toBe(false)
  await expect(prompt).toHaveCount(0)
  // Nothing waits any more: the new worker is the one in charge.
  expect(await waiting()).toBe(false)
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? '')).toBe(`${url}/sw.js`)
})
