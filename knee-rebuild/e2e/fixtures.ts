import { test as base } from '@playwright/test'

/*
 * Every spec's app check (M-U3, PROGRAM-QUESTIONS 234). The app now asks its own /api/auth for the
 * account at launch, and the engine mode follows the answer it keeps (src/rules/engineMode.ts). With
 * no answer, a fresh phone shows the program as written (tester mode) until one check succeeds, and
 * `vite preview` has no functions (it answers HTML). So every spec gets an answer by default, the one
 * a deployment without accounts gives: `{ configured: false }`, which runs the full engine, as
 * Shawn's phone does while accounts are off. A spec overrides it with `test.use({ me: … })`, or with
 * its own `page.route`, which wins over this one. Routed on the context, so a request the service
 * worker makes is answered too (Chromium routes those through the context).
 */

export const ACCOUNTS_OFF = { configured: false }

export const test = base.extend<{ me: unknown }>({
  me: [ACCOUNTS_OFF, { option: true }],
  context: async ({ context, me }, use) => {
    await context.route(
      (url) => url.pathname === '/api/auth' && url.searchParams.get('action') === 'me',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(me) }),
    )
    await use(context)
  },
})

export { expect, type Locator, type Page, type Route } from '@playwright/test'
