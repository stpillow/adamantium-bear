# Knee Rebuild

Single-writer-per-account PWA (invite-gated accounts; each phone the only writer and the primary copy of its own log) that runs Shawn's 12-week knee return-to-sport program on his iPhone: says what to do today, logs what happened, reads the knee's response, decides the next session. Read these before changing anything:

- `PROMPT.md`: owns app behavior (model, rules, screens, build plan, working agreements).
- `docs/program.md`: owns training content. Its training content is transcribed into the seed data (`data/program.json`) once and never parsed at runtime, never "improved" in code. The Program screen renders program.md for reading only (`src/rules/markdown.ts` reads it into headings, paragraphs, lists and tables); nothing the engine decides comes from it.
- Where they disagree: program.md wins on training content, PROMPT.md wins on app behavior.
- `PLAN.md`: the status page. Tick tasks when they finish, not when they start. Keep it truthful and short.
- `PROGRAM-QUESTIONS.md`: every ambiguity in the program, with the reading taken (the one more conservative for the knee). Add to it; don't resolve it in code.

## Two rules that are not negotiable

1. **Logic only in `src/rules/`.** Every decision the app makes (readings, prescriptions, the unilateral budget, deloads, mileage, gates, red flags, week and day) is a pure function there with a Vitest case. Components render and collect input; they ask the engine. Nothing in `src/rules/` imports React, Dexie, or the DOM. A rule change without a test change is a bug. Tests come before UI for anything in PROMPT section 4.
2. **No color-only meaning in the UI.** Shawn is colorblind. Every state gets a word or a shape; color is a second channel, never the only one. Clean, hold and back-off are words on screen.

## Stack

Vite 8 · React 19 · TypeScript 7 (strict, `noUncheckedIndexedAccess`) · Tailwind 4 (spdc tokens in `src/index.css`) · vite-plugin-pwa (offline-first service worker, update on prompt) · Dexie (IndexedDB, local-first; the log stays on the phone) · Zod (schemas, from M1) · Vitest · Playwright (one smoke test, M6) · oxlint.

Dependencies: only what PROMPT section 2 names plus small, well-maintained utilities. No analytics, no telemetry, no external calls at runtime, except the app's own `/api/strava` function on Shawn's tap (Nov 6) and the app's own `/api/auth` on the same own-origin terms (M-U2). Fonts are vendored through fontsource for that reason. The Neon driver (`@neondatabase/serverless`) is server-only and PGlite (`@electric-sql/pglite`) is dev and test only; `src/app/serverSide.guard.test.ts` and the build's bundle check (`scripts/bundleCheck.ts`) prove neither ships.

Server: two Vercel functions, `api/strava.ts` and `api/auth.ts`, self-contained (no imports from `src/`), sharing underscore files Vercel doesn't deploy as functions: `api/_session.ts` (sealing, cookies, the accounts switch, the session and the `/api` gate), `api/_accounts.ts` (every SQL statement, Neon behind a tiny query adapter) and `api/_code.ts` (invite codes). Imports inside `api/` end in `.js`. Typechecked through tsconfig.node.json; tested by `api/_strava.test.ts`, `_auth`, `_session`, `_accounts` and `_code`, the database ones on PGlite in-process. Strava's function keeps no data (its tokens live in one encrypted HttpOnly cookie); the accounts database holds names, roles, code hashes and last-seen times only. Secrets are Vercel environment variables, never in the bundle: `STRAVA_*`, `DATABASE_URL`, `AUTH_COOKIE_KEY`, `AUTH_CODE_PEPPER`, `AUTH_KEY_GENERATION`, `AUTH_BOOTSTRAP_CODE`. Accounts are off until `DATABASE_URL` and `AUTH_COOKIE_KEY` are both set. See docs/integrations.md and docs/accounts.md.

## Commands

```bash
npm run dev          # Vite dev server
npm run typecheck    # tsc -b
npm run lint         # oxlint
npm run test         # vitest run (rules engine)
npm run check        # typecheck + lint + test
npm run build        # tsc -b && vite build → dist/ (includes sw.js and manifest), then the bundle check (no server code ships)
npm run preview      # serve dist/ locally; test the service worker here, not in dev
npm run e2e          # Playwright on a fresh build: the Session A smoke test and the PWA checklist (docs/pwa-audit.md); needs Chromium, not in check
npm run program -- --week 5 --session B   # prints a session from the seed data, deload-aware
npm run evidence     # monthly digest: re-runs saved searches, verifies entries; prints only (docs/evidence-digest.md)
npm run accounts -- <code|migrate|mint|list|revoke|recode|bootstrap|unblock>   # dev-time account admin against Neon, reads .env.accounts (docs/accounts.md)
```

Deploy: Vercel project `knee-rebuild` (SPDC team), root directory `knee-rebuild/`, framework Vite. Every push gets a preview deploy; `main` is production. Builds are skipped when this folder didn't change.

## Folder layout

```
knee-rebuild/
  PROMPT.md  PLAN.md  PROGRAM-QUESTIONS.md  CLAUDE.md
  docs/program.md          the program (source of truth for training content), images in docs/media/
  data/program.json        seed data transcribed by hand from docs/program.md; validated by src/schema/program.test.ts
  data/evidence.json       hand-curated citations (Batch F), validated by src/schema/evidence.test.ts; evidence.notes.json holds the curator's notes, read by scripts only
  scripts/program.ts       prints a session (npm run program)
  scripts/evidence.ts      the monthly evidence digest, dev-only (npm run evidence, docs/evidence-digest.md)
  scripts/accounts.ts      dev-time account admin (npm run accounts, docs/accounts.md); scripts/bundleCheck.ts runs after every build
  api/                     the two Vercel functions (strava.ts, auth.ts) and their shared _session, _accounts, _code; tests beside them
  public/                  icons, static assets
  src/
    main.tsx  App.tsx  index.css (tokens live here)
    rules/                 the engine: calendar, reading, unilateral, prescription, mileage, gates, redFlags, history; pure functions + tests, nothing else decides anything
    schema/                Zod schemas for the domain model (enums, program, logs)
    program/               the validated seed and lookups (exerciseById, templateFor, nominalPhaseForWeek)
    evidence/              the validated citation list and its lookups, read only by the Evidence helpers; never by src/rules
    db/                    Dexie database and versions
    screens/               Today, Session runner, Morning check, Run logger, Week, Progress, Gates, Program, Settings (M3+)
    components/            shared UI (steppers, tab bar, timers)
  vite.config.ts           Vite, Tailwind, PWA manifest and workbox, Vitest
  vercel.json              SPA rewrite
```

## Glossary

- **Slot**: one ordered line in a session template: an exercise plus its prescription (sets, reps or seconds, RPE target, cues, progression rule, ordered substitutions). Logs hang off slots.
- **Prescription**: what the engine says to do for a slot today: load, sets, reps, per side when unilateral.
- **Reading**: the knee's verdict on a subject (an exercise, a workout, a run), computed, never stored: clean, hold, or back-off, with reasons.
- **Clean**: pain 3 or under and not climbing during the session; next morning back to baseline with stiffness gone inside 30 minutes. Clean twice in a row earns progression.
- **Hold**: pain 4–5 or climbing 2+ points set to set, or a morning that is worse than the day before without swelling. Repeat the last session exactly. Unknown is hold, never clean.
- **Back-off**: pain over 5, a set stopped for sharp joint-line pain, or swelling, warmth, or pain up 2+ points the next morning. Load × 0.75 rounded down to the increment, or the previous substitution.
- **Gate**: the checklist between phases. Auto items evaluate from logged data; manual items are toggles. The phase advances only when every item passes and Shawn confirms.
- **Deload**: weeks 4, 8 and 12 from the start date. Sets × 2/3 rounded down (minimum 2), loads unchanged, no progression; the mileage plan's down weeks fall on the same weeks.
- **Symmetry**: injured side divided by the other side, as a percent — except on a timed test (the 6-meter timed hop), where lower is better, so it is the other side divided by the injured side. Gate 1 wants 80%, gates 2 and 3 want 90%.
- **Injured side first**: on unilateral slots the injured leg is logged first and sets the rep budget for the healthy leg.
- **Red-flag state**: any ticked red flag on a morning check for today. Today shows "Stop. Call the ortho or PT." and progression is suspended until cleared from Settings with a note. A flag on a check logged late, for a past morning, shows as a note and suspends nothing.
- **Swap**: replacing a slot's exercise with the next substitution in its ordered list; the slot's job stays the same.
- **Effective reading**: what the last two combined readings add up to for one exercise: clean twice, clean once, hold, or back-off (two holds in a row read back-off).
- **Pain per exercise**: when `Settings.painPerSet` is false, the runner stores the exercise's one pain value on every set it logs; the engine reads pain per set either way.
- **Today**: screens compute the date once with `todayIn(new Date(), zone)` in the user's time zone (a setting, America/New_York by default; M-U1) and pass it to the engine; nothing in `src/rules/` reads the clock or the phone's time zone.

## Design

spdc-design is installed and applied: Duke navy ground, Fraunces display (SOFT 0, WONK 0, upright), IBM Plex Sans body, IBM Plex Mono for short labels only, the 4px spacing scale, radii 0/2/4, one green accent word per surface. Tailwind's default palette, fonts, sizes and radii are cleared in `src/index.css`, so an off-system value won't compile into a utility.

Gym rules on top of that: text-first; 44 px minimum tap targets (`tap` utility); numeric keypads (`inputmode="decimal"`) and steppers, not free text (the invite code in Settings, Account is the one exception: a one-time entry, not logging; PROGRAM-QUESTIONS 220); no modals that trap; every logging interaction under 10 seconds without reading. Units: pounds, miles, seconds. Dates in the user's time zone (a setting, New York by default); weeks start Monday.

## Working agreements, short form

One commit per task, one PR per milestone, conventional commit messages. Claude merges a milestone PR once CI and the preview are green, after an adversarial review pass (`docs/review-plan.md`), then stops for Shawn's go on the next milestone. Each PR carries the preview URL and a three-line demo note: what to tap, what to expect, what's not done. Stop at the end of each milestone for Shawn's go. If something can't be done as specified (an iOS PWA limit, a Dexie quirk, a rule the logs can't support), say so in the PR with two options and a recommendation; don't quietly simplify.
