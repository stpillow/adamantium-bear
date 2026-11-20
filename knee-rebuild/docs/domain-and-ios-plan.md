# A custom domain and an iOS app: the plan, and what in the code stands in the way

Written Nov 20, 2026, from a review of `dev` at `c4508db` (the same tree as `main`'s Nov 16 release), a check of production, and the vendors' own pages where they could be read. Decisions waiting on Shawn are in section 6. Claims this round could not confirm are marked **unverified**, as in the other plans.

**Status, Nov 20:**
- Shawn chose **knee.shawnpillow.com**.
- M-D1's code and docs are built: the moved notice and PROGRAM-QUESTIONS 238 to 240.
- Its Vercel and DNS steps, the check on the new address and the release are not done yet (PLAN.md's M-D1 block).
- Nothing for iOS is built.

## 1. The short answer

- **The custom domain is small, cheap, and best done now.** The code is already host-agnostic. The one real cost is that the phone's log is tied to the origin, so Shawn's log moves to the new domain by Export and Import. Production checked on Nov 20: `/api/auth?action=me` answers `{"configured":false}` and `/api/strava?action=status` answers `{"configured":false,"connected":false}`. So accounts are off, Strava isn't set up, and no tester has installed. Each of those, done first, adds a step to the move: another context to sign in again, a Strava callback domain to change, and a tester to reinstall.
- **The iOS app is a separate project, and the domain comes first.** The PWA on the home screen is already an iPhone app in practice. A store app means a Capacitor shell around the same build, handed to Shawn and up to 10 testers through TestFlight.
  - **Not a public App Store listing** while the prescription engine ships in the binary (section 4).
  - It **needs the custom domain**. Every native build compiles in its API host, its universal-link domain, Strava's callback domain and its privacy-policy URL. Moving any of them later means a new build on every tester's phone, and for the PWA another data move. `knee-rebuild.vercel.app` is Vercel's name, not Shawn's.
  - It **needs the server to accept a client that isn't its own origin.** This is the largest blocker in the code: every server call and the whole session design assume same-origin today (section 5).

## 2. The custom domain

### What doesn't change

The code never names its host:

- Strava's `redirect_uri` is built from the request (`api/strava.ts:198`, `${url.origin}/api/strava?action=callback`).
- The callback sends the phone back with a relative `/#/strava`.
- The cookies are host-only with no `Domain` attribute (`api/_session.ts:63`).
- `sameOrigin()` compares against the request's own origin (`api/_session.ts:119`).
- The CSP is all `'self'`, and the manifest's `id`, `start_url` and `scope` are `/`.

`knee-rebuild.vercel.app` appears only as a test fixture (`api/_auth.test.ts`, `_session.test.ts`, `_strava.test.ts`) and in the docs (`docs/accounts.md`, `docs/integrations.md`).

### What does change: the origin

The origin is the wall around everything the phone keeps:

- IndexedDB, which holds the log;
- local storage: the kept account answer, the runner's in-session swaps and time window, and the KOOS and ACL-RSI drafts;
- the session and Strava cookies;
- the service worker;
- the home-screen install itself.

A new domain is a new, empty app on the phone. It's a house move: the post office forwards mail (a redirect), but nobody carries the furniture (the log) unless you pack it. The export is that box. `src/db/backup.ts` carries every Dexie table, and a guard fails the build if a new table isn't carried. Only in-session scratch in local storage stays behind, so move between sessions, not mid-session.

### Steps, in order

1. **Pick the name.** **Chosen Nov 20: `knee.shawnpillow.com`.** A subdomain needs one CNAME, no apex records, and leaves the apex free.
   - shawnpillow.com's DNS is served by WordPress.com (`ns1` to `ns3.wordpress.com`).
   - The apex and `www` point at Squarespace.
   - A `*` wildcard sends every other subdomain, `knee` included, to the apex. An explicit `knee` record overrides the wildcard for that name only.
   - No CAA record limits who may issue a certificate. All read from public DNS on Nov 20.
2. **Vercel.** Open the `knee-rebuild` project (the one deploying from adamantium-bear's `main`), then Settings, Domains, and add `knee.shawnpillow.com` for Production. Then:
   - **DNS at WordPress.com:** in shawnpillow.com's DNS records, add a CNAME with host `knee`, pointing at the target Vercel shows. The certificate issues on its own once the record resolves.
   - **Ownership check:** if Vercel asks for a TXT record to prove the domain (it does when the domain is already in use in another Vercel account), add that too.
   - The Vercel connector in Claude's sessions can't see this project, so these clicks are Shawn's.
   - **Don't set a redirect on `knee-rebuild.vercel.app` yet** (step 7).
3. **Check the new host before touching the phone:**
   - `https://<domain>/api/auth?action=me` should answer `{"configured":false}`.
   - `/api/strava?action=status` should answer JSON.
   - `/manifest.webmanifest` should be served.
   - Look at the response headers for HSTS. If the domain is an apex, think before `includeSubDomains`.
4. **Move Shawn's log, once per context that holds it** (the home-screen app is the primary):
   - In the old app: Settings, Export, Share the file, then Files.
   - Open the new domain in Safari, Add to Home Screen, and open the new icon.
   - First-run setup offers "import a backup" on its first screen. Pick the file.
   - Check that Today, Week, Progress and Gates read as they did.
   - Keep the old icon until the new one has logged one full session, then delete it.
   - **Never log in both.** Each phone is the single writer of its log, and two copies have no merge.
5. **Strava, when the API app is made** (not yet done for production): set the Authorization Callback Domain to the new domain from day one. This replaces step 2 of `docs/integrations.md`'s Strava setup.
6. **Accounts after the move.** Run `docs/accounts.md`'s switch-on against the new domain, not before it. Before it, step 7 there (sign in in Safari and in the home-screen app) happens twice.
7. **Retire the old host in two stages:**
   - **First, a moved notice.** A banner on `knee-rebuild.vercel.app` names the new address beside a one-tap Export (a small code change, M-D1 below). A static app can't move a phone's data for it.
   - **Later, the redirect, once Shawn's phone and every tester's are across.** A redirect wipes nothing: the old install's service worker keeps serving the cached shell over the old log. But that install's update check and `/api` calls stop working.
   - Previews keep their own `*.vercel.app` hosts either way.

### Cost

A domain registration if one is bought for this (about $10 to $20 a year for a common TLD, **unverified**). Vercel includes custom domains on every plan. No new services.

## 3. iOS: the routes

| Route | What it is | Cost | How it reaches a phone | Verdict |
|---|---|---|---|---|
| A. The PWA on the custom domain | Today's app, Add to Home Screen | $0 | A link | Already works; keep it either way |
| B. Capacitor shell, bundled build | The same React build inside the app's own WebView; native plugins where the web falls short. Capacitor 8 supports iOS 15 and later and needs Xcode 26 | Apple Developer Program, $99 a year; a Mac with Xcode for the first build | **TestFlight internal:** up to 100 people who hold an App Store Connect role, no review. **External:** up to 10,000 by email or a public link; the first build goes through Beta App Review. Builds stay installable 90 days | **Recommended** if a store app is the goal |
| C. Capacitor pointed at the website (`server.url`) | A thin wrapper that loads the live site | Same as B | Same as B | No. Capacitor's own docs say `server.url` is "not intended for use in production". Guideline 4.2 wants an app to "elevate it beyond a repackaged website". It keeps the cookie problem too |
| D. Native SwiftUI | PROMPT section 2's named alternative | A rewrite | Same as B | No. It throws away `src/rules/` and its tests, or means porting them |
| E. A public App Store listing | B, through full App Review | B plus review | The store | Not this round (section 4) |

**What B buys over A:**

- **One context instead of two.** Safari and the home-screen app keep separate cookies and storage today, so the invite code is typed twice and Strava's connect can land in the wrong one (`docs/integrations.md`). In a shell there is one jar.
- **Apple Health.** `docs/integrations.md` rules HealthKit out because it "needs a native iOS app". B is that app: workouts, heart rate and VO2 max could be read on the phone. It brings guideline 5.1.3's health-data rules and a HealthKit entitlement.
- **A rest-timer alert with the screen locked.** The timer is wall-clock and correct when you come back (`src/components/RestTimer.tsx`), but silent. A local notification fixes that.
- **Tester distribution through Apple.** Install, update and remove happen in TestFlight, not "open this link in Safari".

**What B costs:**

- $99 a year and a Mac, or a hosted macOS build (Xcode Cloud, or a macOS GitHub Actions runner).
- Every release becomes a build Apple processes, not a push to `main`.
- TestFlight builds expire after 90 days, so a quiet stretch still needs a rebuild.
- Rollback is uploading the old build again, not re-promoting a deploy. That puts more weight on the Dexie one-version rollback tests.
- Two clients have to stay in step with one server.

## 4. Obligations that change with a store app (inputs, not legal advice)

`docs/multiuser-and-release-plan.md` section 5's standing gate covers this too: nothing goes to a tester before the professional conversation.

- **Medical function (guideline 1.4.1, page dated Oct 16, 2026).**
  - "Medical apps that could provide inaccurate data or information, or that could be used for diagnosing or treating patients may be reviewed with greater scrutiny."
  - "Apps should remind users to check with a doctor in addition to using the app and before making medical decisions."
  - An app that has regulatory clearance submits a link to it.
  - The binary would carry the prescription engine even though only the admin account runs it. That is the FDA line in section 5 again, now with a reviewer reading it.
  - TestFlight to up to 10 testers in tester mode keeps to the existing plan. A public listing is a question for the professional, not for this plan.
- **Account deletion (5.1.1(v)).** "If your app supports account creation, you must also offer account deletion within the app."
  - Codes are minted by the admin, not by the person. But redeeming one is where the account starts on that phone, and a reviewer may read that as creation.
  - Today there is Sign out, and revocation is the admin's CLI (`docs/accounts.md`).
  - M-U4 already plans deletion on request; it moves ahead of the first external TestFlight build, the cheap way to settle the question.
- **A way in for the reviewer (2.1(a)).** "Include demo account info (and turn on your back-end service!) if your app includes a login." The review notes carry a working tester code for a reviewer account in tester mode, which is also what a reviewer should see. Production's accounts must be on when the build is submitted.
- **Privacy, as paperwork.** App Store Connect wants a privacy-policy URL and the App Privacy answers. The plain-language note section 5 already calls for becomes a static page on the new domain. A file in `public/` is served before `vercel.json`'s SPA rewrite, so it isn't swallowed.
- **Export compliance.** The app uses only HTTPS, and the sealing runs on the server, so the binary should be exempt (**unverified**; answered in App Store Connect).
- **Strava.** The data rules don't change with the container: shown only to its own athlete, never in an AI call. The 10-athlete cap is the same cap as the 10-tester cohort.

## 5. Blockers in the code (review of `dev`, Nov 20)

**Blocker** stops route B from working, **Major** works badly or risks review, **Minor** is a tidy-up or a test.

### Custom domain

None blocking. Five checks for the first deploy on the new host:

- Redeem's `sameOrigin()` against a custom-domain alias. This is `docs/accounts.md`'s open item, "`new URL(request.url).origin` equals the browser's `Origin` on Vercel, aliases included", and a custom domain is exactly that case.
- The HSTS header.
- That the service worker installs.
- That Strava's consent round trip returns to the new host.
- That `docs/accounts.md` and `docs/integrations.md` name the new host.

### iOS (route B)

| # | Severity | Where | What breaks | Fix |
|---|---|---|---|---|
| 1 | **Blocker** | `src/app/account.ts:13`, `src/app/strava.ts:9`, `api/_session.ts:63` and `:119`, both functions | **The server only answers its own origin.** Inside the shell the page's origin is the app's own scheme, `capacitor://localhost` by default. Four things break: relative `/api/...` calls hit the bundle, not Vercel. `sameOrigin()` refuses Redeem, Sign out and Disconnect from any other `Origin` (403, "This only works from inside the app"). Neither function sends CORS headers. And the session is a `SameSite=Strict` cookie on `Path=/api`, a third-party cookie to the shell. Capacitor's cookie page: "As of iOS 14, you cannot use 3rd party cookies by default." | **(a), recommended: a bearer session for the native client.** Redeem, asked by the shell, returns the same AES-GCM seal the cookie holds. The shell keeps it in the Keychain and sends `Authorization: Bearer`. The gate takes cookie or bearer. CORS allows exactly the app's origin, and `sameOrigin()` becomes "own origin, or the app's origin carrying a bearer". **(b): CapacitorHttp and CapacitorCookies**, with the domain in `WKAppBoundDomains`, which Capacitor offers for "better support for cookies". Less code, but forum reports of doubled cookies and SameSite trouble, and the maintainers steer apps away from cookies. Either way, the API host becomes a build-time constant that is empty for the web build, so the PWA stays byte for byte (`src/screens/fullMode.snapshot.test.ts`, `scripts/bundleCheck.ts`). Security-sensitive: tests in `_session` and `_auth`, and the adversarial pass |
| 2 | **Blocker** | `src/screens/Strava.tsx:108`, `api/strava.ts:195-236` | **Strava's connect is a full-page redirect flow.** Connect is an `<a href>` to `/api/strava?action=connect`, which redirects to Strava. Strava redirects back to the callback, which sets the token cookie and redirects to `/#/strava`. In the shell the first link opens the bundle, and the cookie would land in a browser jar, not the app's | **Strava's documented iOS flow:** open `https://www.strava.com/oauth/mobile/authorize` in an `ASWebAuthenticationSession`, or `strava://oauth/mobile/authorize` when the Strava app is installed (version 75 or later; `strava` goes in `LSApplicationQueriesSchemes`). Strava returns to the app on its own scheme. Strava's sample `redirect_uri` is `YourApp://www.yourapp.com/...`, whose host sits in the callback domain. The app hands the code and state to a new `exchange` action on the function, which swaps it with the secret that never leaves the server, and answers the token seal as in item 1. Forum threads from 2018 report custom schemes refused, so the fallback keeps today's HTTPS callback, which ends on a universal link with a one-time handoff code (`apple-app-site-association` on the domain). That is the "one-time code the app redeems" `docs/integrations.md` already lists as the fix for the PWA's Safari/app split |
| 3 | **Blocker** | `src/App.tsx:3`, `:48`, `:118`; `vite.config.ts` | **The service worker and its update prompt assume a web origin.** A bundled app updates through TestFlight, and the WebView runs service workers only for app-bound domains | A native build mode that leaves vite-plugin-pwa out and renders no "A new version is ready". Reload now stays as the escape hatch when storage can't be read. Release notes say which build needs which server |
| 4 | Major | `src/screens/Settings.tsx:883-966` | **Export**, the only backup and the migration path, goes through `navigator.share({ files })` or a blob `<a download>`. Neither is known to work in the iOS WebView (**unverified**) | Capacitor's Filesystem and Share plugins behind the existing `shareRoute` seam. Import (`<input type="file">`) should open the document picker: test it |
| 5 | Major | none yet | **No in-app account deletion** (section 4, 5.1.1(v)) | "Delete my account": the server row goes, Strava is revoked, and the option to reset this phone is offered. M-U4's deletion, moved ahead |
| 6 | Major | `src/rules/engineMode.ts:50` | **A fresh install reads tester until the admin code is redeemed** (rule 3). That is correct, and it applies to the new domain as well as the shell | Not a code change, a step: redeem in the new context, then import. Shawn's file brings sets from before Nov 10, so even offline, before a check, it runs in full (rule 1) |
| 7 | Minor | `src/screens/Strava.tsx:138`, `src/screens/program/Evidence.tsx:151` | `target="_blank"` links (View on Strava, DOI, PubMed) | Open them in Safari or an in-app Safari view through the Browser plugin; test |
| 8 | Minor | `src/screens/NextUpdate.tsx:34` | `navigator.clipboard` inside the shell's scheme | Test; the Clipboard plugin if refused |
| 9 | Minor | `public/` | The largest icon is 512 px. The store needs a 1024 px icon with no transparency, plus a launch screen (Duke navy, `#001A57`) and screenshots | Redraw the mark at 1024 from source; spdc-design applies |
| 10 | Minor | `index.html`, `vercel.json` | The CSP is a Vercel header, which doesn't reach a bundled app | A meta CSP in the native build, with `connect-src` naming the domain. CLAUDE.md's "own origin only" rule gets the amendment "the app's own API on its own domain", the Nov 6 Strava amendment's process |
| 11 | Minor | none | iOS builds need macOS and Xcode. This cloud container is Linux | First build on Shawn's Mac; then Xcode Cloud or a macOS runner for TestFlight uploads, with signing secrets kept out of the repo |
| 12 | Minor | `src/components/RestTimer.tsx` | Silent when the screen is locked (correct on return) | A local notification in the shell; an upgrade, not a fix |
| 13 | Minor | repo and project hygiene | Presales-Operations still holds a `knee-rebuild/` copy last changed Nov 2. Production runs adamantium-bear's (its `/api/auth` exists only there). The Vercel connector in this session lists no projects for the SPDC team, so the domain steps are dashboard steps | Retire or label the stale copy so a domain can't be attached to the wrong project; grant the connector the project if Claude should do the Vercel side |

Already right, and worth keeping:

- **Safe areas.** `index.css:95`, `TabBar.tsx`, `DoneBar.tsx`.
- **Hash routing.** It works under any scheme.
- **Vendored fonts.** No network is needed.
- **The rules layer.** `src/rules/` imports nothing from the browser, so route B reuses the engine and every one of its tests unchanged.
- **The server.** It never names its host.

## 6. Decisions for Shawn

1. **The name.** **Answered Nov 20: knee.shawnpillow.com.**
2. **Who the native app is for.**
   - Shawn only (internal TestFlight).
   - Shawn and up to 10 testers (external TestFlight, after Beta App Review). **Recommended, and after the professional conversation.**
   - Public. Not recommended this round.
3. **Apple Developer enrollment.**
   - An individual enrollment is quick and shows Shawn's legal name as the seller.
   - An organization enrollment (SPDC) needs a D-U-N-S number and takes longer (**unverified** timing).
4. **The native session: bearer (recommended) or the native cookie jar.**
5. **When `knee-rebuild.vercel.app` gets its redirect.**

## 7. Build order

Each item is its own PR to `dev`, after Shawn's go.

1. **M-D1 Custom domain.** Code and docs built Nov 20; the rest is in PLAN.md's M-D1 block.
   - **Shawn:** the domain, DNS, and Vercel's Domains page.
   - **Claude:**
     - the docs sweep (`docs/accounts.md`, `docs/integrations.md`, PROMPT section 2's Deployment row, PLAN.md decision 6);
     - the moved notice on the old host (a pure host rule with a test, and words, not color);
     - the first-deploy checks in section 5.
   - **Then:** the log moves (section 2 step 4), Strava's API app is made with the new callback domain, and accounts switch on.
2. **M-N1 A second client for the server.** The API host constant, bearer sessions, a CORS allowlist and the `sameOrigin()` rework. The web build stays byte for byte. Tests and the adversarial pass.
3. **M-N2 Strava from the app.** The mobile authorize flow and the function's `exchange` action, or, if Strava refuses the scheme, the handoff code, the universal link and `apple-app-site-association`. The handoff version also fixes the PWA's Safari/app split, so it is worth doing even if B stops here. `apple-app-site-association` goes at `/.well-known/` in `public/`, with no extension. Vercel serves files before `vercel.json`'s rewrite, but the content type needs a `headers` rule.
4. **M-N3 The Capacitor shell.**
   - The native build mode: no service worker, the meta CSP.
   - Export through Filesystem and Share; the Browser plugin for links.
   - Icons, launch screen, portrait, status bar.
   - The first build on a Mac, then internal TestFlight on Shawn's phone.
5. **M-N4 Store paperwork.** Account deletion, the privacy page, the App Privacy answers, the reviewer code and Beta App Review, then external TestFlight to testers. The standing gate applies.
6. **Later, if wanted.** Apple Health reads; the rest-timer notification.

M-D1 is days, and most of it is Shawn's clicks. M-N1 to M-N3 are each about a milestone the size of M-U2. M-N4 is mostly writing and Apple's queue.

## 8. To check on the first build (unverified this round)

- **The custom domain:** `sameOrigin()` across a Vercel alias, the HSTS header on the new host, and the service-worker install.
- **The WebView's cookies:** whether it refuses the third-party session cookie (the reason for 1(a)), and whether it runs `navigator.share` with files and blob downloads.
- **Strava:** whether it accepts the custom-scheme `redirect_uri` its iOS sample shows (2018 threads say no), and whether the callback domain admits subdomains. Its page says only "Must be within the callback domain specified by the application".
- **Apple:** whether App Review counts an invite redeem as account creation (5.1.1(v)), and how long an organization enrollment takes.
- **The cost of a domain.**

## Sources read

Read Nov 20, 2026:

- **Apple:** [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) (last updated Oct 16, 2026; 1.4.1, 2.1(a), 4.2, 5.1.1(v), 5.1.3), [TestFlight](https://developer.apple.com/testflight/), [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).
- **Strava:** [authentication](https://developers.strava.com/docs/authentication/).
- **Capacitor 8:** [config](https://capacitorjs.com/docs/config), [cookies](https://capacitorjs.com/docs/apis/cookies), [HTTP](https://capacitorjs.com/docs/apis/http), [deep links](https://capacitorjs.com/docs/guides/deep-links), [iOS](https://capacitorjs.com/docs/ios).
- **Forum-grade, not official:** Ionic forum threads on cookie auth in Capacitor iOS; Strava API group threads on custom-scheme redirects.
