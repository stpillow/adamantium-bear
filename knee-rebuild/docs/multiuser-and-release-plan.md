# Multi-user accounts, admin controls and releases: the alpha plan

Decided with Shawn on Nov 8, 2026, from a four-sweep research study (auth, data architecture, release mechanics, obligations) and its critic pass. M-U1 (first-run setup and the time zone setting), M-U2 (invite-code accounts, Nov 9; docs/accounts.md) and M-U3 (tester mode, Nov 10) are built; the rest is not. The study's full option tables live in the workflow record; this document records what was chosen and why, the corrections the critic forced, and the build spec. Where the study recommended differently than Shawn chose, the deviation is recorded, not hidden.

A standing gate above everything else: **no tester install ships before Shawn has put section 5's questions in front of a qualified professional.** The research is input to that conversation, not a substitute for it.

## 1. Shawn's decisions

| Question | Decision |
|---|---|
| What testers run | A software test, not the program: full logging (sessions, runs, RPE, HR, training load), Shawn's program visible as read-only content — and **the prescription engine off for testers**: the app never computes loads or clean/hold/back-off readings from a tester's pain signals. That is the study's strongest mitigation, adopted: it removes the condition-treatment function rather than disclaiming it. |
| Where tester data lives | **Server-synced accounts.** A deliberate choice to cross the custodianship line the study flagged, with the privacy work priced in (below) — not a drift. |
| Admin scope | **Operational only**: invites, revocation, tester list, last-active and app/schema version (derived server-side from sync requests, not from an in-app telemetry call), error counts. No browsing tester logs; a per-tester opt-in shares data for debugging. |
| Release flow | **Manual promotion.** Feature PRs land on `dev` (created Nov 8 at `e97000b`); `main` is the release and moves only on Shawn's "ship it", as a release PR from `dev`. Rollback is re-promoting the prior release. This deviates from the study's two-project stable/beta recommendation: one project, less machinery, and Shawn's phone rides the same releases as testers'. |
| Cohort | Up to 10 testers in the next few weeks — inside Strava's self-serve athlete cap. US-only this round, no minors, signed waiver per tester. |

## 2. Architecture

**Auth: invite codes plus a same-origin signed session, no vendor.** A tester types an invite code into a form inside the app; `api/auth.ts` (the `api/strava.ts` pattern: self-contained, secrets in Vercel env vars) redeems it against the accounts database and sets a long-lived AES-GCM-signed HttpOnly Secure cookie. No redirect flows of any kind — the installed iOS app has its own cookie jar separate from Safari (the documented Strava-connect failure mode), and a same-origin form POST is the construction that avoids it. Corrections the critic forced, adopted:

- **A code binds to a tester, never to a browsing context.** The install flow guarantees two contexts (Safari to add to the home screen, then the installed app), so first-redemption-wins would lock every tester out of their own install. Redeeming again as the same tester signs that context in.
- **The app shell stays public.** The build is static; nothing checks a cookie before `index.html`, and adding middleware in front of the SPA is new scope deliberately not taken. The gate is where the data is: every `/api/*` route (sync, Strava, auth itself) requires the session. An unauthenticated visitor gets an empty shell and a code prompt, which is the correct amount of protection for an app whose value is the data.
- Codes carry real entropy; the redeem endpoint is rate-limited; a key-generation env var revokes every session at once, the accounts table revokes one.
- Passkeys (WebAuthn) are the later upgrade, pending one on-device test in an installed PWA (**unverified** this round).

Vendor auth was compared and declined for the alpha: every free tier is ample (figures **unverified**), but hosted SDKs add external runtime calls (CSP and CLAUDE.md amendments), network token refresh against an airplane-mode app, and redirect flows against the cookie jar. Clerk remains the fallback if admin ergonomics ever outweigh those.

**Sync: Neon Postgres behind the same Dexie interface** — PROMPT section 2's own named v2 path. Each tester's log is single-writer, so per-row last-write-wins is sufficient; no CRDTs. The phone stays the primary copy and the app stays offline-first: sync is a catch-up exchange over `/api/sync` when online, never a gate on using the app. Schema versioning rides the existing Dexie/backup version machinery; the server stores rows per (tester, table, key) with updated-at stamps rather than mirroring the relational shape.

**Admin** is a small screen behind Shawn's own account role: invites, tester list with last-sync time and app/schema version, revocation, and the opt-in debug-share viewer. Nothing else.

**Per-tester onboarding** replaces the Shawn-specific seed assumptions: injured side and start date already live in Settings; the wizard adds them at first run along with dumbbell max and gym, and the timezone (every `America/New_York` site, listed in PROGRAM-QUESTIONS 211) moves to a setting — each a PROMPT section 2 amendment, listed in section 6. Built in M-U1.

## 3. Tester mode, precisely

A per-account role, enforced in the rules layer, not hidden in the UI:

- Tester accounts: logging, history, Week/Progress trends, training load, HR load, VO2, the program as read-only content, export/import of their own data.
- Off for testers: engine prescriptions (slots show the program's written prescription text, never computed loads), clean/hold/back-off readings on their data, gate evaluation, red-flag takeover (flags they tick surface as their own note), and the morning check's "what changes next" line.
- Shawn's account: everything, unchanged.
- The guard for it is a rules-layer test in the trainingLoad.guard shape: no prescription or reading path reachable under the tester role.
- The mode is derived from the kept account answer (PROGRAM-QUESTIONS 224); `src/rules/engineMode.guard.test.ts` is the guard, and `src/screens/fullMode.snapshot.test.ts` pins Shawn's full mode byte for byte.

## 4. Releases and stability

- **Flow:** feature PRs → `dev` (auto-merged on green as always); release PR `dev` → `main` only on Shawn's word; production and every installed PWA update only at releases. The PWA updates on prompt, never mid-session.
- **Dexie channel rule:** Shawn's phone follows releases like testers' phones. Anything that bumps the Dexie/backup version reaches phones only through a release, and the release notes say so; the proven one-version rollback tests (db.v4 through db.v7, and onward) are the safety net, and an export before updating stays the advertised habit.
- **CI gate:** a GitHub Actions workflow running `npm run check` on PRs to `dev` and `main`, and the e2e suite on PRs touching `knee-rebuild/` (free-minute figures **unverified**; the local gate remains the backstop).
- **Strava and channels:** the callback domain points at production; Strava import is a stable-channel feature, capped at the 10-athlete self-serve tier, with the review path beyond assumed blocked.

## 5. Obligations (inputs to a professional conversation, not legal advice)

- **Medical-device line:** FDA's Jan 2026 general-wellness and CDS guidances exclude condition-treatment claims from the wellness carve-out, and patient-facing treatment recommendations from the CDS carve-out. Computing rehab loads from pain signals is that function. **Tester mode removes it for testers**; Shawn's own use of his own tool is not distribution.
- **"Free/friends-only" is an enforcement-risk argument, not a compliance argument** (inference, so marked). EU MDR Rule 11 is mooted the cheap way: no EU testers this round.
- **Privacy, now live because sync was chosen:** HIPAA does not apply (no covered entity), but the FTC Health Breach Notification Rule reaches non-HIPAA health apps, and Washington's My Health My Data Act treats knee-pain logs as consumer health data (coverage of a free personal project **unbriefed**). The priced-in work: encryption in transit and at rest, deletion on request (account delete wipes server rows), a plain-language privacy note shown before a tester's first sync, operational-only admin as designed, breach duty acknowledged. Tester mode also means the synced rows for testers are training logs, not treatment decisions.
- **Waivers:** signed, per tester, real against ordinary negligence only; no minors. The negligent-undertaking flag — voluntarily guiding someone's rehab can create a duty of care — is specifically for the professional conversation.
- **Platform terms:** Strava data walled off from every AI call (theirs and Shawn's alike) and shown only to its own athlete — sync storage must keep Strava-derived rows per-tester-visible only, which operational-only admin already does. Photo import stays off tester builds until the Anthropic key/retention posture is decided (API retention up to ~30 days default; health uses treated as high-risk; **exact clause texts unverified**).

## 6. Amendments this work requires (the Nov 6 Strava amendment is the process)

1. PROMPT section 2: "no accounts" → invite-gated accounts with per-device-primary, server-synced storage; section 8's non-goal rewritten accordingly — done in M-U2 (Nov 9) for the accounts; the sync wording waits for M-U4.
2. PROMPT section 7 / CLAUDE.md: runtime calls allowed to the app's own `/api/auth` and `/api/sync` alongside `/api/strava`, on the same own-origin-only terms — done for `/api/auth` in M-U2 (Nov 9); `/api/sync` waits for M-U4.
3. PROMPT section 2 "Units and time": timezone becomes a per-user setting — done in M-U1 (Nov 9).
4. CLAUDE.md "single-user PWA" framing → single-writer-per-account; the two non-negotiable rules unchanged — done in M-U2 (Nov 9).
5. docs/integrations.md: note the per-tester Strava visibility rule under sync. (The study's claimed higher rate-limit figures stay out until read on Strava's own page — **unverified**.)

## 7. Build order (each its own PR to `dev`, after the current batch queue)

1. **M-U1 Onboarding and de-hardcoding** — the wizard, timezone setting, seed-assumption sweep. Gating for everything; useful even solo. — built (Nov 9; PLAN.md's M-U1 block, PROGRAM-QUESTIONS 203 to 212).
2. **M-U2 Accounts** — Neon, `api/auth.ts`, invite codes, roles, session cookie; the app works logged-out exactly as today until a code is entered. — built (Nov 9; PLAN.md's M-U2 block, PROGRAM-QUESTIONS 213 to 222, docs/accounts.md). "Logged-out as today" holds while accounts are off; once on, Strava needs a session.
3. **M-U3 Tester mode** — the role enforcement and its guard tests. — built (Nov 10; PLAN.md's M-U3 block, PROGRAM-QUESTIONS 223 to 235). Release precondition added: previews protected, or the `AUTH_*` variables on Preview too, before any tester installs (235).
4. **M-U4 Sync** — `/api/sync`, catch-up exchange, deletion on request, the privacy note.
5. **M-U5 Admin screen** — invites, tester list, revocation, opt-in debug share.
6. **M-U6 Release hardening** — GitHub Actions gate, release-notes convention, the waiver/privacy-note copy for Shawn's review.

First-build verification list (claims this planning round could not confirm): WebAuthn in an installed iOS PWA; whether a Vercel-protected deployment 401s the service worker; Neon free-tier limits; GitHub Actions free minutes; Strava's current athlete-cap and AI-clause texts; Anthropic usage-policy clause text.
