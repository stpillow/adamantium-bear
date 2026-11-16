# Integrations: Strava, other health apps, and what stands in the way

Written Nov 6, 2026, from a research pass over the vendors' developer docs and announcements. Where a primary page could not be fetched from the build session (developers.strava.com, developer.apple.com and several others are blocked there), the claim rests on the vendor's own search excerpts or official example repos and is marked **unverified**.

## What is built

- **Logging after the fact** (no integration needed). A past lift day's preview offers "Log this session after the fact"; runs can be dated up to 14 days back. PROGRAM-QUESTIONS 141.
- **Strava import on tap.** More → Import from Strava. Connect once; Check Strava lists the activities from the days a run can be logged for; a run, elliptical or rowing session opens the run logger filled in, where max pain is still yours to rate; a strength activity points at that day's preview. Nothing saves on its own, nothing syncs in the background, and nothing is ever posted to Strava. PROGRAM-QUESTIONS 142.
  - `api/strava.ts`: the one Vercel function. It holds the client secret, keeps no data, and stores Strava's tokens in one AES-GCM-encrypted, HttpOnly, Secure cookie scoped to `/api`, so they never reach IndexedDB, a backup file, or the page's JavaScript.
  - `src/rules/stravaImport.ts`: what an activity becomes (pure, tested).
  - `vercel.json` keeps `/api/*` out of the SPA rewrite; the service worker's navigate fallback skips `/api/*`; the CSP stays `connect-src 'self'` because the page only ever calls its own origin.
  - **With accounts on (M-U2, docs/accounts.md):** every Strava action needs a signed-in account on that phone (Settings, Account); signed out, the screen says so in words and Connect goes back with "Strava needs an account on this app first". Strava's return to the callback is a cross-site navigation, which never carries the `SameSite=Strict` session cookie, so Connect seals the account (with the state, the time and the key generation) into the short state cookie and the callback checks that account instead. Disconnect also requires a same-origin request. With accounts off, all of this is exactly as before. Strava data is shown only to its own athlete: the token cookie is bound to the account that connected it and reads as not connected (and is cleared) for any other, a different account redeeming on a phone forgets the Strava cookie there, and Sign out revokes Strava before signing out.

## Setting up Strava (Shawn, once)

1. **Strava subscription.** Since June 2026 a Strava subscription is required to own a Standard-tier API app (about $11.99/month or $79.99/year in the US).
2. **Create the API app** at strava.com/settings/api. Authorization Callback Domain: `knee-rebuild.vercel.app`. A preview deployment has its own host, so connect from production, or add the preview host while testing.
3. **Vercel settings** for the `knee-rebuild` project (Settings → Environment Variables, Production and Preview):
   - `STRAVA_CLIENT_ID`: from the API app page
   - `STRAVA_CLIENT_SECRET`: from the API app page
   - `STRAVA_COOKIE_KEY`: 32 or more random characters, e.g. `openssl rand -base64 48`
4. Redeploy, open More → Import from Strava, tap Connect with Strava, and leave "View data about your activities" ticked.

Until step 3 is done the screen says Strava isn't set up and nothing else changes.

## Barriers

### Upstream (vendors and their terms)

| Barrier | Severity | What it means here |
|---|---|---|
| Strava subscription required to own an API app (since June 2026) | Blocker until paid | No subscription, no import. The fallback is file import (below). |
| New Strava apps have an athlete capacity of 1 ("Single Player Mode"); up to 10 by self-service; more than 10 needs a slow, opaque Developer Program review | Major for "any other users" | Fine for you. Friends and family up to 10. Beyond that, apply with branding screenshots and expect weeks. |
| Strava's API policy (Nov 2024, tightened 2026): an athlete's data may be shown only to that athlete, and may not be used in AI applications (press reports and third-party readings of the 2026 text say this includes sending it into an LLM prompt; **the exact clause is unverified**) | Major, downstream of any AI feature | Imported runs stay on your phone. The planned photo-import and AI coaching ideas must never read Strava-imported data; tag the source if they arrive. |
| Strava's rate limits: 100 reads per 15 minutes and 1,000 a day by default | Minor | One Check is 1–3 reads. A backfill of years of history is not something this app does. |
| Strava is moving its API to `api-v3.strava.com` (announced for 2027; dates in the sources conflict) and retiring `oauth/deauthorize` for `oauth/revoke` on June 1, 2027 | Minor, dated | Both hosts are constants at the top of `api/strava.ts`; change them before mid-2027. |
| Strava branding: "Connect with Strava" and "View on Strava" wording, "Powered by Strava" where its data shows | Minor | Done in words; the official button artwork is a nice-to-have before any review for more athletes. |
| Whether Strava's token endpoint answers a browser directly (CORS) is **unverified**; it doesn't matter, because the client secret can never ship in the PWA | Settled | That is why the function exists. |

### Internal (this app's own rules and shape)

| Barrier | Severity | What it means here |
|---|---|---|
| PROMPT section 2 said "no server", section 7 "no external calls at runtime", section 8 made Strava sync a v1 non-goal | Resolved Nov 6 | Amended on your ask; the decision is in PLAN.md's log. |
| Max pain is required on every run and only you know it | By design | No activity saves itself. Every import passes through the run logger's Save. |
| Unknown is hold: a run or session logged late with no morning check the day after reads hold, which can cap a week's miles or read back-off on the next lift | Major, by design | The screens say so. Open question: a morning check for a past day (PROGRAM-QUESTIONS 141). |
| A late entry recomputes readings already shown (finished weeks can change) | Major | Bounded to 14 days, and strength sessions to the current phase. |
| No phase history is stored, so a strength session can't be dated before the current phase began | Minor | Refused with a sentence. Storing each phase advance would lift it. |
| On iPhone, a home-screen app and Safari keep separate storage, cookies included. If Strava's consent page finishes in Safari rather than in the app, the cookie lands in Safari and the app still reads "not connected" | Major, **untested on a real phone** | Test once on your phone. If it bites: connect from Safari and use the import there, or move to a one-time code the app redeems. Accounts (M-U2) redeem per context for the same reason: the invite code is typed in Safari and again in the home-screen app, and both sign in as the same account. |
| Imports and Reset don't touch the Strava cookie (it isn't in IndexedDB) | Minor | Reconnecting is never needed after an import; Disconnect is the way out. |

### Downstream (what this unlocks or constrains next)

| Item | Note |
|---|---|
| Duplicates across sources | An activity whose link is on a run is never offered again. A run you logged by hand without the link can still be offered once; the list shows the day and miles so you can tell. |
| Strength sessions from Strava | Strava doesn't carry sets, reps or loads, so it can only point at "Log this session after the fact". |
| Heart rate, relative effort, VO2 max | Deliberately not imported yet: the function trims every activity to the fields the run logger uses. See the plan for performance metrics. |

## Other health platforms (verdicts as of Nov 2026)

| Platform | Route | Server needed | Works from an iPhone PWA | Verdict |
|---|---|---|---|---|
| Apple Health / HealthKit | No web or REST API; on-device only | — | No (needs a native iOS app) | Use a Shortcut ("Find Health Samples" → JSON), Health Auto Export (paid; can write files to iCloud Drive), or the Health app's export.zip (`workout-routes/*.gpx`). File import is the realistic path. |
| Garmin Connect | Personal API (launched Oct 21, 2026): self-generated key, pull-only, for your own data; the business program reopened the same day (Starter is push-only, no history) | Yes, to hold the key | Through a function, yes | Best wearable candidate for you alone. |
| Google Fit REST | Closed to new developers since May 2024, deprecated in 2026 | — | — | Don't. |
| Fitbit Web API | Turned off Nov 2, 2026 (HTTP 410), replaced by the Google Health API: restricted scopes, OAuth verification and a yearly CASA assessment beyond 100 users; testing-mode refresh tokens expire every 7 days | Yes | Through a function | Personal testing mode only, with re-consent every week. |
| Android Health Connect | On-device only | — | No | Don't. |
| Polar AccessLink | OAuth2, self-serve client | Yes | Through a function | Feasible if you ever wear Polar. |
| Oura v2 | OAuth only (personal tokens deprecated), membership reportedly required | Yes | Through a function | Feasible; recovery data, not workouts. |
| WHOOP v2 | OAuth, up to 10 members without approval | Yes | Through a function | Feasible for personal use. |
| Suunto, COROS | Partner programs for companies with a user base | — | — | Not available to a personal app; use their FIT export. |
| Aggregators (Terra, Spike, Junction, ROOK) | One API for many devices | Their cloud | Apple Health still needs their native SDK | From about $400–500 a month; overkill for one person. |
| GPX / TCX / FIT files | Export from any watch app, open in the PWA | No | Yes (use a plain file picker: iOS greys out `.fit` under a strict `accept`) | The cheapest universal route; Garmin's `@garmin/fitsdk` parses FIT in the browser. Not built yet. |
