# Knee Rebuild: Plan

The status page. Ticked when done, not when started. Questions about the program live in [PROGRAM-QUESTIONS.md](PROGRAM-QUESTIONS.md); the questions for Shawn before M1 are at the bottom.

**Now:** M6 (hardening) in review: the Program screen, export, import and reset, the smoke test and the PWA audit are in, and the builders' leftovers are fixed (the gym editor and Gates read the edited lists, PROGRAM-QUESTIONS 127; an error boundary around every screen). Shawn's phone checks wait for him.
**Last updated:** Nov 2, 2026

## Milestones

### M0 · Scaffold
Done when the app installs to an iPhone home screen and loads in airplane mode after one visit.

- [x] Repo layout: `knee-rebuild/` with `PROMPT.md`, `docs/program.md`, `PLAN.md`, `PROGRAM-QUESTIONS.md`
- [x] Vite 8 + React 19 + TypeScript strict + Tailwind 4, with the spdc tokens and only those colors as utilities
- [x] vite-plugin-pwa: offline-first service worker, manifest, icons, iOS home-screen meta
- [x] Dexie with an empty schema (`src/db/db.ts`)
- [x] Vitest wired, one smoke test
- [x] `CLAUDE.md` for the app (stack, commands, layout, glossary, the two non-negotiable rules)
- [x] Vercel project with a preview deploy on every push, builds skipped when `knee-rebuild/` is untouched
- [x] Shawn: add to the home screen, reload in airplane mode, say go (merged Oct 31; "it loaded on my phone", Nov 1)

### M1 · Seed data
Done when the schema validates, the script output matches program.md on a spot check of all three phases, and PROGRAM-QUESTIONS.md lists anything ambiguous.

- [x] Zod schemas for every section 3 entity in `src/schema/`, plus the model additions from PROGRAM-QUESTIONS (week range, optional, `stage` rule, repUnit, rpeTargetEnd)
- [x] Exercise catalog: id, name, pattern, equipment, loadType, increment, unilateral
- [x] `data/program.json`: phases 1–4, gates 1–3, the nine templates, every slot's cues and ordered substitutions
- [x] Mileage plan for 12 weeks, the red-flag list, the warm-up and pre-run checklists
- [x] `npm run program -- --week 5 --session B` prints a session, deload-aware
- [x] Spot-check A, B and C once per phase against program.md
- [x] Refresh PROGRAM-QUESTIONS.md with anything new
- [x] Adversarial review before merge: security and correctness passes on the diff, findings fixed or logged (see `docs/review-plan.md`)

### M2 · Rules engine
Done when tests are green and no rule lives outside `src/rules/`.

- [x] `calendar`: week and day from startDate in America/New_York, the scheduled session per date, move-session (deload weeks landed in M1)
- [x] `reading`: session reading, morning reading, combined reading, the 36-hour unknown-is-hold rule
- [x] `prescription`: next prescription per exercise and side for every progression rule; back-off; the dumbbell cap (deload sets and week-banded slots landed in M1)
- [x] `unilateral`: injured-first rep budget, symmetry percent
- [x] `mileage`: weekly target, the hold cap, the long-run split, swaps
- [x] `gates`: auto and manual items, hop-test best of three, pass logic, confirm-to-advance
- [x] `redFlags`: red-flag state and clearing with a note
- [x] Vitest for every rule, plus the six worked examples as named tests
- [x] A guard test that keeps `src/rules/` pure (no React, Dexie, DOM or clock) and fully tested
- [x] `history`: joins workouts, sets and morning checks into per-exercise reading timelines, workout and run readings
- [x] Adversarial review before merge: 5 findings, 4 fixed, 1 accepted (see `docs/review-plan.md`)

### M3 · The daily loop
Done when Shawn can run Session A on his phone end to end, do a morning check, and watch the next Session A's prescriptions change according to the reading.

- [x] Dexie schema v2 (settings, workouts, setLogs, morningChecks, runs, gateTests, sessionMoves) and seed on first run
- [x] App shell: bottom tab bar (Today, Week, Progress, Gates, More), 44 px targets, every state carries a word or shape
- [x] Today: scheduled session, phase and week, deload badge, yesterday's reading in words, one Start button; red-flag takeover
- [x] Session runner: slots with cues, steppers prefilled from the engine, side toggle with the rep budget, supersets, rest timer, Swap, Stop this exercise, Finish with max pain and a summary
- [x] Morning check: four taps, pain-change stepper, red-flag checklist, note; save shows the reading and what changes next
- [x] Settings basics: injured side, start date, dumbbell max, rest timer, pain per set or per exercise
- [x] Adversarial review: 32 findings, 31 survived three skeptics, all addressed (`docs/review-plan.md`)
- [ ] Shawn runs Session A end to end on the phone; the next Session A reflects the reading (verified in a browser drive; Tuesday Nov 3 is the real one)

### M4 · Running
Done when three logged runs show against the week's target and a hold reading caps the following week.

- [x] Run logger: type, miles, minutes, effort, max pain, strides and tempo toggles, Strava link; week miles against target as you type
- [x] Week screen: seven-day strip with readings in words, deload badge, miles against target, move-session
- [x] Move limits in `src/rules/moves.ts`: logged days and finished weeks stay put; Undo only on the latest move (PROGRAM-QUESTIONS 59)
- [x] The hold cap applied to next week's target
- [x] Three logged runs show against the target; a hold reading caps the following week (browser drive, Nov 9 to 16: 10.5 of 11 miles, Friday's pain 4 reads hold, week 3 capped at 10.5)
- [x] Adversarial review: 22 findings, 20 survived three skeptics (11 defects), all fixed and re-verified in a browser drive (`docs/review-plan.md` 47 to 60)

### M4b · Where you train (added Nov 1 at Shawn's request)
Done when Shawn can type a gym's name, mark what it has or lacks, add equipment it has that isn't on the list, switch to it on Today, and get a Session A that uses only what's there, with each change said in words.

- [x] Design: `docs/locations-equipment-design.md` (11 open questions sent to Shawn; building on the defaults)
- [x] Equipment requirements per catalog exercise, transcribed from program.md's equipment and substitution tables
- [x] Locations: typed name, equipment present or missing, typed extras, dumbbell max per location; Dexie v3 with `dumbbellMax` migrated into a "Planet Fitness" location
- [x] Rule in `src/rules/` (tested): the first available of the slot's exercise and its substitutions, in the program's order, at the active location
- [x] Engine and runner: prescriptions for the available exercise, with "Not at <gym>: using <exercise>" in words; Swap still overrides
- [x] Screens: add and edit locations, add typed equipment, switch the active location from Today
- [x] Typed equipment no exercise uses is kept and listed for the next program.md update; the app never invents an exercise for it
- [x] Run swaps (elliptical, rower) respect what the location has
- [x] Adversarial review: 20 findings, 19 survived three skeptics, all fixed and re-verified (`docs/review-plan.md` 61 to 79; PROGRAM-QUESTIONS 88 to 107); the brief's browser drive passed 93 of 93 checks at 390 and 375 px
- [ ] Shawn: a session at a second gym on the phone

### M5 · Gates and progress
Done when gate 1 evaluates from logged data alone and the hop-test symmetry matches the worked example.

- [x] Gates screen: live auto items, manual toggles, Advance phase enabled only when every item passes, with a confirm step
- [x] Hop-test entry: three trials per side, best kept, symmetry shown (one trial a side saves, 0 is a trial: PROGRAM-QUESTIONS 108)
- [x] Progress: load over time per exercise (one chart at a time), symmetry over time, weekly miles against plan, consecutive clean days
- [x] Gate 1 evaluates from logged data alone; the hop-test symmetry matches the worked example (56 against 62 reads 90.3% and passes gate 3; named tests in `Gates.helpers.test.ts`)
- [x] Adversarial review: surviving findings fixed with tests (PROGRAM-QUESTIONS 110 to 118) and re-checked in the built app at 390 and 375 px

### M6 · Hardening
Done when export, wipe, import restores everything, and a full Session B gets logged on cellular with the screen locked between sets.

- [x] Program screen: read-only phase view, cue and substitution editor, program.md rendered as reference (edits are Dexie v4 overrides laid over program.md's slots; the runner, the gym editor and Gates read them)
- [x] Export JSON, import JSON, reset all data, clear the red-flag state with a note (strict checks before anything is touched, one transaction; PROGRAM-QUESTIONS 121 to 126)
- [x] Playwright smoke test for the Session runner (`e2e/session.spec.ts`, `npm run e2e`)
- [x] Lighthouse PWA audit (Lighthouse 11: PWA 100, accessibility 100 on every screen, performance 86; the manual checklist in `e2e/pwa.spec.ts`; `docs/pwa-audit.md`)
- [ ] Shawn: offline QA at the gym, a full Session B on cellular with the screen locked between sets
- [x] Export, wipe, import restores everything (the round-trip test in `src/db/backup.test.ts`: two exports the same bytes apart from `exportedAt`)
- [x] Added exercises on A, B and C (Program screen, Dexie v5, backup schema 5) and "Time you have" on Today and in the runner: the app leaves out whole exercises until the session fits, or with more time adds the phase's other sessions' exercises and then upper-body work (PROGRAM-QUESTIONS 136 to 138; `src/rules/addedSlots.ts`, `src/rules/fitWindow.ts`). Not yet reviewed adversarially
- [ ] Adversarial review: the surviving findings fixed with tests first (PROGRAM-QUESTIONS 128 to 133; the screen ones also in `e2e/program.spec.ts`, `e2e/settings.spec.ts` and `e2e/app.spec.ts`, run by `npm run e2e`; npm audit's build-time advisories explained in `docs/pwa-audit.md` finding 10), re-check to come

### Metrics, phase 1 · RPE and training load (docs/metrics-and-photos-plan.md)
Done when a run is rated 1–10, a lift's Finish asks its RPE and minutes, and Progress shows weekly training load with its warning in words.

- [x] Run RPE 1–10 on the run logger, unrated until tapped; session RPE (optional) and minutes on Finish, minutes on End, Add effort and minutes on the Summary; training load and the 7-days-through-yesterday warning on Progress (`src/rules/trainingLoad.ts`, Dexie v6, backup schema 6; PROGRAM-QUESTIONS 143 to 149)
- [x] Adversarial review: three lenses (rules and data, screens, test honesty), two skeptics per finding; six candidates, none survived. `npm run e2e` 16 of 16. Checked in a browser at 390 px: Save waits on effort, a 28-minute RPE 4 run reads 112 on Progress

### Metrics, phase 2 · heart rate (docs/metrics-and-photos-plan.md)
Done when a run can carry its average and max heart rate (typed or from Strava), Settings hold Shawn's max and resting HR, and Progress shows the week's HR load (TRIMP) in words beside the training load.

- [x] Optional average and max HR on the run logger (never blocks Save; absent is "no heart rate", never 0) and from the Strava import (the function stops dropping the summary averages; out-of-range or inverted pairs dropped, never clamped)
- [x] Heart rate section in Settings: max and resting HR steppers over a one-row `hrSettings` table outside the settings row, each touch saving only the touched number (PROGRAM-QUESTIONS 150)
- [x] HR load (Banister TRIMP) in `src/rules/trainingLoad.ts` beside the sRPE load, under the same guard; shown on the run logger's saved words and as Progress's weekly line in words; the acute:chronic warning reads the sRPE load alone (PROGRAM-QUESTIONS 151, 152)
- [x] Dexie v7 (additive, no upgrade callback) and backup schema 7 with a 6→7 step; v6-build rollback re-proved (`src/db/db.v6.test.ts`)
- [x] Adversarial review: three lenses (rules and storage, screens, test honesty), two skeptics per finding; three low findings confirmed (HR week-line miscount for a run with heart rate but no time, twice found; no way back to "not set") and fixed test-first. Checked in a browser at 390 px: Set/Clear on both numbers, a 40-minute run at avg 150 saves "HR load 72", Progress carries the HR line

**Definition of done for v1:** Shawn runs week 1 of the program entirely from the app, on his phone, with morning check-ins deciding the loads for week 2.

## Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-11-07 | Metrics phase 2: the heart-rate settings live in their own one-row `hrSettings` table, outside the Settings schema (Dexie v7 additive, backup schema 7); phase 3's `vo2Readings` moves to Dexie v8 | The settings row stays byte-identical for older builds (PROGRAM-QUESTIONS 132), and the backup's `checkCovered` throws until a new table is carried, which a second settings-table row would have slipped past (PROGRAM-QUESTIONS 150; amends the plan doc's "their own row of the settings table") |
| 2026-11-06 | Metrics phase 1 adds fields only (Dexie v6 with no store change, backup schema 6); a session's minutes are a stored field (`durationMinutes`), and phase 3's `vo2Readings` takes Dexie v7 | Shawn delegated the open questions (PROGRAM-QUESTIONS 143 to 149). Older builds still open the database (149) |
| 2026-11-06 | Strava import on tap, through one Vercel function (`api/strava.ts`) that holds the client secret and keeps nothing; logging after the fact up to 14 days back | Shawn's Nov 6 ask. Amends PROMPT sections 2, 7 and 8, CLAUDE.md and the review plan's security pass. Max pain is never imported: an activity opens the run logger filled in. Barriers and setup in docs/integrations.md |
| 2026-11-02 | A read-only session preview (`#/preview/:date`): any day's session with the sets, reps and loads the engine would prescribe from what's logged so far, at the gym it would run at; from Week's lift days and Today | Shawn: "I want to be able to see the workouts before I get to them." It plans with the same `planSession` call the runner opens with, so its numbers are Start's if nothing is logged in between |
| 2026-10-31 | The app lives in `knee-rebuild/` inside Presales-Operations, not in its own repo | This session can only push to this repo. `git subtree split --prefix=knee-rebuild` moves it out later with history intact. Shawn to confirm or ask for the split. |
| 2026-10-31 | Vercel project `knee-rebuild` in the SPDC team, root directory `knee-rebuild`, framework Vite, builds skipped when the folder didn't change | Preview on every push, production from `main`, and pushes to the skills library don't burn builds |
| 2026-10-31 | The project's first deployment was assigned to production (knee-rebuild.vercel.app) because none existed; later pushes on the M0 branch deploy as previews | Vercel's first-deploy behavior, not a misconfiguration. `main` takes over production once M0 merges. Nothing to do. |
| 2026-10-31 | Vercel Authentication turned off on the `knee-rebuild` project | The team default protects every deployment behind a Vercel login, which would bounce a home-screen PWA to vercel.com and break the airplane-mode test. The app keeps no server data and PROMPT section 2 says no accounts, no auth. Shawn can turn it back on in the Vercel dashboard if he wants the URL gated. |
| 2026-10-31 | spdc-design applied (the skill is installed here) | PROMPT section 2 says use it if present. Tokens live in `src/index.css`; Tailwind's default palette, radii, fonts and sizes are cleared so only the spdc scales exist as utilities. Colorblind rule still governs: no meaning by color alone. |
| 2026-10-31 | Fonts vendored through fontsource (OFL) and precached | The PWA has to render offline with no runtime fetches; Google Fonts would be an external call |
| 2026-10-31 | `package-lock.json` committed for the app | Reproducible Vercel builds. The root `.gitignore` excludes lockfiles; `knee-rebuild/.gitignore` re-includes this one |
| 2026-10-31 | Service worker updates on prompt, not auto-reload | A deploy landing mid-set must never reload the page; the app shows "Update ready" and waits |
| 2026-10-31 | TypeScript 7 and oxlint, as create-vite ships them | typescript-eslint doesn't support TS 7 yet; oxlint is zero-config and small |
| 2026-10-31 | Model additions rather than content changes: week-banded slots, optional slots, a `stage` progression rule, `distanceYards`, `rpeTargetEnd` | Working agreement 6 |
| 2026-10-31 | Two consecutive hold readings on one exercise escalate to back-off | program.md's "two off sessions in a row" row; the conservative reading. Built in M2 unless Shawn overrules (PROGRAM-QUESTIONS 4) |
| 2026-11-01 | New milestone M4b, Where you train: typed gym locations and user-added equipment | Shawn's request on Nov 1. Sequenced after M4 unless he says otherwise. The app can only route to exercises the program already names; typed equipment with no matching exercise waits for a program.md update (PROMPT section 1). |
| 2026-11-01 | Shawn answered every open and confirm item in PROGRAM-QUESTIONS (1 to 59) and the 11 M4b questions in one sitting | Recorded line by line in PROGRAM-QUESTIONS and in `docs/locations-equipment-design.md` section 9. Everything was kept except the four below |
| 2026-11-01 | Mileage only climbs: deload weeks 4, 8 and 12 hold flat at the week before (10, 11, 12, 12, 13, 14, 15, 15, 16, 17, 18, 18) | Shawn's call, overriding program.md's down weeks after the trade-off was put to him; lifting deloads unchanged (PROGRAM-QUESTIONS 1) |
| 2026-11-01 | Selectorized machines log pounds in 5 lb steps, not plate numbers; loads carry across gyms | Shawn: "I'll always give weight, not plate count" and "pounds are pounds." Replaces the M1 plate-number model; the per-gym load history in the M4b design is dropped |
| 2026-11-01 | A faster effort is suggested every Friday from Phase 2, never in a deload week, never on top of Phase 3's tempo | Shawn's answer to PROGRAM-QUESTIONS 29 |
| 2026-11-01 | Order: M4b, then M5, then M6 | Shawn's answer |
| 2026-11-01 | A session move can't touch a day with anything logged or a finished week; Undo takes back only the week's latest move | A move swaps days, so moving a done Session A would have Today offer it twice; earlier moves can't be undone out of order without changing what later ones did (PROGRAM-QUESTIONS 59) |
| 2026-11-01 | The Stepper keeps typed text while the field has focus | Typing 2.5 miles read as 25: the half-typed "2." parsed to 2 and the next keystroke appended to it |
| 2026-11-01 | The Session runner hides the tab bar; a quiet "Today" link is the way out | A sweaty mis-tap on a tab mid-rest left the session; the space goes to the card |
| 2026-11-01 | Done waits for a pain rating once per exercise ("Rate pain first"); a stop doesn't | M3 review: unrated pain read hold silently and two skipped ratings backed loads off. The rating is the one tap per exercise the design already asked for |
| 2026-11-01 | Rest starts after the last step of a round: both sides of a set, every member of a superset round | Runner design panel; in `src/rules/runOrder.ts` |
| 2026-11-01 | One workout per lift day: Start reopens an attempt ended early; a session with nothing logged is discarded | M3 review: a second attempt planned from the first and split the morning check |
| 2026-10-31 | Claude merges milestone PRs once CI and the preview are green, then stops for Shawn's go on the next milestone | Shawn's ask after merging M0: "in the future, I want you to just handle merges" |
| 2026-10-31 | Every milestone PR gets an adversarial review pass (security and correctness) before merge; the standing plan is `docs/review-plan.md` | Shawn's ask on M1 |
| 2026-10-31 | Model additions in M1, none of them content changes: `loadUnit` (stacks log the plate number), `dumbbell-single` and `plates` load types, `quad` and `cardio` patterns, `repUnit`, `perSideLabel` (the program's own "each leg" / "each side"), `prescriptionText` kept verbatim per slot, `loadBeforeHeightLb`, `rangeStopDeg`, `heightIn`/`heightMaxIn` | Working agreement 6: change the model, not the content |
| 2026-10-31 | `data/program.json` was produced once by a throwaway generator so carried-over slots were copied rather than retyped; the JSON is the committed source and edits go there | One source of truth |
| 2026-10-31 | Week-banded slots count from the week the phase was entered, not the calendar week (`phaseWeeks`, open-ended tops allowed) | M1 review finding: phases advance on gate confirmation, so calendar bands would drop snap-downs and plyo rungs when a gate runs late (PROGRAM-QUESTIONS 46) |
| 2026-10-31 | Supersets are a shared `groupId` on every member slot, replacing the one-way `pairWithSlot` | A5/A6/A7 is a three-way group; a single pointer couldn't say so, and one-way links drifted |
| 2026-10-31 | The mileage plan carries no dates; week dates derive from `Settings.startDate` | startDate is editable, so seeded Mondays would go stale |
| 2026-10-31 | `vercel.json` sets a CSP (`default-src 'self'`, no inline scripts), nosniff, no-referrer and a permissions policy | Belt and braces against injected notes or a bad import; nothing in the app needs anything else |
| 2026-10-31 | `SetLog.stopReason` is an enum; a stop for sharp joint-line pain reads back-off, any other stop reads hold | Rule 1 names only the joint-line case; unknown is not clean (PROGRAM-QUESTIONS 48) |
| 2026-10-31 | Back-off on bodyweight work moves to the slot's first substitution; with none written it drops a set | PROGRAM-QUESTIONS 49 |
| 2026-10-31 | The `time` rule climbs to the top of its range, then waits for the next phase's version; back-off drops 5 s | PROGRAM-QUESTIONS 45 |
| 2026-10-31 | Runs have readings (max pain on rule 1's thresholds, combined with the morning check) | Rule 7 and rule 8 both speak of runs reading hold or clean (PROGRAM-QUESTIONS 53) |
| 2026-10-31 | The engine never reads the clock; screens pass `today` in, computed once by `todayIn(new Date())` | Testability, and one place to get the time zone right |
| 2026-10-31 | Section 9 answers from Shawn: right knee; week 1 starts Monday Nov 2, 2026; dumbbells to 80 lb; both a seated and a 45° leg press; pain logged once per exercise (per set stays available in Settings); MBR is always Monday; Vercel URL for now; rest timer 60 s for every slot. Rower yes and spdc-design on, both confirmed in a follow-up | Answered in chat on Oct 31 |
| 2026-10-31 | `dumbbellMax` is a number with presets 60, 75 and 80, not the 75-or-60 pair in PROMPT section 3 | His rack goes to 80 |
| 2026-10-31 | Leg press: the seated machine is the default (program.md's setup cue is written for it); the 45° press is its first substitution | Both exist at his club |
| 2026-10-31 | Rest timer: one default of 60 s for every slot; the 90 s lower-body split from section 9 is dropped | His call |

## Program questions

The full list with the reading taken for each is in [PROGRAM-QUESTIONS.md](PROGRAM-QUESTIONS.md). The ones that want an answer from Shawn, by number there:

- 1 · Mileage plan read from the chart: 10, 11, 12, 9, 13, 14, 15, 11, 16, 17, 18, 14
- 2 · Step-up: load climbs to 20 lb first, then height rises 2 in. at a time, then load again
- 3 · Leg extension: range to the phase's stop first, then load
- 4 · Two holds in a row on one exercise read as back-off
- 5 · Stiffness past 30 minutes reads hold, not clean
- 6 · Morning back-off: next run defaults to elliptical, lower-body slots back off; does "Phase 1 loads" override ×0.75?
- 8 · A new slot in a deload week starts at its lightest version
- 9 · Loads past the dumbbell cap turn into the next substitution
- 11 · Phase 2's "new" B6 and C6 replace the seated calf raise and the back extension
- 13, 14, 15, 16 · Phase 3 placements: Nordics take the leg curl slot; lateral lunge goes after the hip thrust; the dumbbell calf raise is A6's progression; the high step-up stays 3 × 8
- 20 · Warm-up shown as a checklist, not logged
- 23 to 26, 28 · Gate items not covered by PROMPT rule 8 and how each is evaluated
- 29 · Which Fridays get the faster effort from Phase 2

## Questions for Shawn before M1 (PROMPT section 9)

Answered Oct 31, 2026. Recorded in the Decisions log.

1. Which knee is injured? **Right.**
2. Start date Monday Nov 2, 2026 as week 1? **Yes.**
3. Dumbbells; leg press; rower? **Dumbbells to 80 lb; both seated and 45° leg press; rower yes (confirmed).**
4. Pain once per exercise or per set? **Once per exercise; per set available in Settings.**
5. Monday MBR fixed on Mondays? **Yes, always.**
6. Custom domain or Vercel URL? **Vercel URL for now.**
7. spdc-design? **Yes, use it (confirmed); already wired into the scaffold.**
8. Rest timer? **60 s for every slot.**
