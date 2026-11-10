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

### Metrics, phase 3 · VO2 max (docs/metrics-and-photos-plan.md)
Done when a dated whole-number reading can be typed on Progress (one per day, a same-day save replaces), the latest value and the trend show in words, and no rule can read a reading.

- [x] VO2 max section on Progress: the latest typed reading with its date in words, a NumberField entry with an explicit Save right in the section (out of bounds refused in words, never clamped; the replace line when today already has one), and the worded trend newest first with a per-row Delete (PROGRAM-QUESTIONS 153 to 155)
- [x] `vo2Readings` table keyed by date (Dexie v8 additive, no upgrade callback) and backup schema 8 with a 7→8 step; every pinned version test moved, the summary counts and lostOnImport cover the readings
- [x] v7-build rollback re-proved in `src/db/db.v7.test.ts`: a version 7 declaration opens the version 8 database with its own schema, the settings and heart-rate rows untouched, a stale reading resurfacing under v8
- [x] The guard: only the Progress helpers import `src/rules/vo2.ts`, no rule module mentions the readings (`rules/backup.ts` the pinned carrier exemption), and the readings never ride in History (`src/rules/vo2.guard.test.ts`)
- [ ] Adversarial review

### Batch A · KOOS, ACL-RSI, the 6-meter timed hop (docs/feature-research-and-evidence-plan.md candidates 1, 2, 8)
Done when the KOOS can be filled monthly and at a gate attempt with its five subscales trending on Progress only, gate 3 requires the latest ACL-RSI at 76+ beside the kept trust toggle, and the hop battery is four tests with the timed hop's inverted math.

- [x] KOOS form (42 items transcribed from koos.nu, five worded boxes per question, skips absorbed by the published half-rule, resumable localStorage draft under the swaps prefix), scores on Progress only — subscale trends in words with dates — never on Gates; the 28-day due line on Today and Progress; the Gates screen's standing offer routes to the form with no score (PROGRAM-QUESTIONS 156 to 161)
- [x] ACL-RSI form (12 published items, anchors flipped on the negative stems so 10 reads readier, all 12 required), `g3-acl-rsi` a required auto item at the strict published ≥ 76 from the latest entry, evaluator `acl-rsi` with its own `minScore` field; the manual trust toggle stays its own item
- [x] 6-meter timed hop as gate 3's fourth hop: best = fastest trial, symmetry inverted (other ÷ injured) on the same floor-rounded tenths, 0 s refused in words, 0.1 s decimal entry; an optional "how it looked" note on every hop test (`GateTest.notes` surfaced)
- [x] `koosEntries` and `aclRsiEntries` (Dexie v9 additive, backup schema 9 with an 8→9 step, every pinned test moved, rollback re-proved in `src/db/db.v8.test.ts`); guards: KOOS importable by no rule module with gates.ts barred by name, ACL-RSI readable by gates.ts alone
- [x] Adversarial review: three lenses (gate correctness, scoring and storage, screens and test honesty), two skeptics per finding; one finding raised and wrongly refuted (the ACL-RSI form lost its answers on navigation), caught again in the browser check and fixed test-first with the KOOS draft pattern. Checked at 390 px with the phase patched to 3: the gate-3 ACL-RSI item reads "76 or better" and fails in words with no entry, the 6-meter timed hop names its inverted symmetry, and an answer now survives a trip to Today

### Batch B · EWMA warning + compliance and adherence (feature-plan candidates 4-partial, 5)
Done when the acute:chronic warning reads EWMA week-rates with the same bands and words, the session Summary says its prescribed sets in words, and Progress lists each week's sessions done of those scheduled — with no storage change at all.

- [x] The warning moves to EWMA over the daily training load through yesterday (λ = 2/(N+1): 0.25 acute, 2/29 chronic, bias-corrected), printed as week-rates; bands, "just over/under", the 35-day quiet start and the skew words kept, 'none' keeping the windows' meaning so a return from a layoff never reads High; the weekly chart's sums untouched, both guard tests unedited (PROGRAM-QUESTIONS 162)
- [x] Sets-based compliance on the Summary ("All 9 prescribed sets of the 3 exercises run."), deload-aware on the stored flag, extras never prescribed, the slots that logged nothing out of the count with a note saying so; the deviation from "not done counts against" and the back-off trade-off left for Shawn (PROGRAM-QUESTIONS 163)
- [x] Weekly adherence on Progress under the clean-days count ("Week 5 · Lifts 2 of 3 · Runs 3 of 3"), swaps, moves, deloads and ended-early lifts read as the Week screen reads them, no streak mechanics (PROGRAM-QUESTIONS 164)
- [x] Adversarial review: two lenses, two skeptics per finding. Confirmed and fixed test-first: the skew lines could state the wrong direction under EWMA (a session 5 to 7 days back carries nearly equal acute and chronic weight, so its direction depends on the ratio shown); direction now comes from each day's weight ratio against the reading, with "can read higher or lower" when days fall on both sides (PROGRAM-QUESTIONS 162(d)). Refuted: lifts counted as scheduled when none can start; back-off days misstating the shortfall (only the easier-version step cuts sets). Summary and Progress checked at 390 px on the Session A smoke run

### Batch C · warm-up sets, the warm-up inside the time, added exercises and gates, the accessory catalog (Shawn's Nov 8 decisions 5, 13, 14, 15, 16)
Done when "Add an exercise" and extra time offer the 20 accessory and core movements in every phase with their own cues and substitutions; an added exercise's sets count for a gate exactly when it is the same exercise; the time window counts the warm-up door to door and says when it is too short; the runner and Preview show warm-up sets above set 1 that nothing logs or reads; with no storage change.

- [x] Accessory and core catalog in program.md and the seed (20 entries, a seed test checks the table cell by cell), addable in every phase, grouped by pattern in the picker, after program.md's 13 pulls and pushes in the extra-time order; the cable crunch standing and the knee raise on the dip handles rather than kneeling or hanging (PROGRAM-QUESTIONS 169 to 173)
- [x] Added and extra-time exercises and the gates: exact exercise only, the prefill and Progress's symmetry line pair the sides within one slot, the Gates lists include added slots; calf raises needed tests only (168)
- [x] Warm-up minutes off the top of the time, both ways, words when it's too short: the bike's 5 (now in the seed) and the circuit for the phase, the circuit only with no bike; every figure says "warm-up included"; P1-A at 45 now keeps 1–4 (166)
- [x] Warm-up sets in the runner and Preview, display only, counted in the time: 8 at 50%, then 5 at 75% of the day's load, rounded down, on eleven big loaded lifts (back extension and hip thrust left out); a guard test keeps them out of every rule, log and store (165, 167)
- [x] Mid-session gym change keeps the lock: no change (decision 16; `gymLocked` untouched)
- [x] Adversarial review: three lenses (rules, content and knee safety, screens and tests), two skeptics per finding. Confirmed and fixed test-first: core accessories swapped to the side plank, Pallof press or dead bug lost "each side"; swaps and adds now carry the substitute's side words (169(h)). Eight findings refuted. Warm-up line (90 lb: 45 × 8, then 65 × 5), Preview, the door-to-door window and the grouped picker checked at 390 px on the Session A smoke run

### Batch D · a morning check for a past day, morning-check tags (Shawn's Nov 8 decisions 10, 12)
Done when a session logged late can take its next morning's check, dated that morning, within the same 14 days, from the session Summary, the run logger's saved screen and Week's past days, never written over and never the red-flag stop (its flags a note on Today, Gates, the Week row and its result); when six optional tags sit on the morning check and Progress counts the readings after each in plain words from 5 mornings, read by no rule; and Dexie v10, backup schema 10 and the v9 rollback test hold the storage.

- [x] Late check: a stored `loggedOn` marks it, the window is keyed on the session day (`lateCheckFor`, finished or ended lifts and runs only), three entry points (Summary, run logger, Week; Today's Yesterday region and Progress/Gates left out), `addLateMorningCheck` refuses by date and never overwrites, no editing; the offer is fixed when the form opens and asked again at Save (174)
- [x] Late red flags a note, not a stop: `afterMorningCheck` returns the state itself for a late check; the note keeps the program's "call the ortho or PT" on Today (14 days), beside Gates' Advance, on the Week row and in the result (175)
- [x] Reach pinned equal to on-time: the same check with and without `loggedOn` reads identically through readings, `kneeMorning`, the mileage cap and clean days; the gates take the conservative branch until Shawn answers (a clean late check passes no auto-item, a late complaint still fails one); the result names every reading and lift plan it changed (`lateCheckReach`) (176)
- [x] Six tags on the form: slept badly, sat or drove for hours, on my feet most of the day, wore the brace, an anti-inflammatory, new shoes; one-tap switches with a mark and words, none by default (177)
- [x] Counts on Progress with the guard: each check paired with the worst reading it completes (`checkFor`, the check the reading used), shown from 5 mornings, the mornings without it beside under the same minimum, no causal words; `morningTags.guard.test.ts` holds tags out of every reading, plan, gate and load, `lateCheck.guard.test.ts` holds `loggedOn` to four files (178)
- [x] Dexie v10 (fields only), backup schema 10 with a 9→10 step, `db.v9.test.ts` rollback, export and import carry both fields (179)
- [x] Adversarial review: three lenses (knee safety and rules, storage, screens and tests), two skeptics per finding; none survived, and Claude rechecked the rejections by hand. Two were real and are fixed test-first: a clean late check cleared the clean-weeks gate item through the readings (the gates now read sessions with on-time checks only, 176(f)); and a red flag beside slow stiffness or a worse morning read hold, not back off (now back off in every branch, 180). The run logger's day note no longer promises an offer for yesterday. Week's late offer, the form with its tags, the late red-flag note (no takeover) and Today checked at 390 px

### Batch E · a down period (Shawn's Nov 8 decision 6, feature-plan section 4 item 4)
Done when Shawn can declare a "not feeling 100%" stretch of 3 to 14 days from Today, starting today, and while it lasts no load, rep target, height, range, stage, easier-version return, phase-week band or week's run target steps up, while hold, back off, deloads and the red flag work exactly as outside one and every reading stays real; when it can be made longer to 14 days, ended in one tap and kept going if ended by mistake, shows on Today, Week, Progress and the Preview in words, holds Advance; and Dexie v11, backup schema 11 and the v10 rollback test hold the storage.

- [x] The rule and its guard: `src/rules/downPeriod.ts` (pause, bands, declare, extend, end, resume), the `paused` basis in the clean-twice branch only, the rule in program.md's loading rules and the seed (3 and 14 pinned); `downPeriod.guard.test.ts` holds readings identical and every prescription, placement and target equal or lower (181, 184, 185)
- [x] Mileage: the week whose Monday a period covers holds at last week's target, rule 7's caps first, and the weeks after climb back one plan step a week (183)
- [x] Placement and bands: the way back from the easier version waits (a chosen Swap still wins), and the phase-week bands, the extra-time pool, the Summary's set count and the tempo stay at the band the period began in, then resume from it a week at a time (never skipping a band), and the Program screen and "What this changes" read the same held week (182, 188)
- [x] Gates: Advance disabled while a period covers today, the day it ended included; auto items untouched (186)
- [x] Today (badge, declare, extend, one-tap end, keep it going, the open-lift line), Week (held target, covered days, the periods), Progress (the periods under the weekly counts), Preview (a line), the run logger and the Morning check's next session read the day planned (185, 187)
- [x] Storage: Dexie v11 additive `downPeriods`, backup schema 11 with a 10→11 step, an import never lifts a standing period, `db.v10.test.ts` rollback; `crossTraining` to v12 (189; v13 since M-U1 took v12, 203)
- [x] Docs: PROGRAM-QUESTIONS 181 to 189 (179 amended), PROMPT sections 3 to 5, program.md and the seed, the feature plan
- [x] Adversarial review: three lenses (knee safety and rules, storage, screens and tests), two skeptics per finding. Confirmed and fixed test-first: a long period skipped a plyo band on its return (the bands now resume where they stopped, 188), and the Program screen and "What this changes" showed the calendar's band. Claude rechecked the rejections by hand and fixed one more: the run suggestion dropped the tempo with no word of why (190(a)); the ahead-dated period is recorded, not built (190(b)). Today's declare, active, extend and end states checked at 390 px

### Batch F · the evidence layer, gate rationales, the monthly digest (Shawn's Nov 8 decisions 8, 9; feature-plan candidate 3, section 3 (a) and (c))
Done when the Program screen's Evidence view and Gates' "Why this test" show curated, verified citations as words, and nothing the app decides changes.

- [x] Schema and the GRADE rule: `src/schema/evidence.ts` (not in the barrel), the four GRADE words, the source's own rating or a start by design, indirectness and imprecision, the stored grade checked against the rule, one Thomeé 1997 exception for Shawn to confirm (191 to 193)
- [x] `data/evidence.json` from verified records only: 96 entries (six duplicates merged by PMID), 158 saved searches, 18 gate rationales, 23 seen papers; `npm run evidence -- --verify` against Europe PMC: 96 verified, 0 changes, 3 errata to read (198, 199)
- [x] The truncated hand-off completed: 42 more entries (balance, plyo, cardio, push, pull, core, carry, hops, ACL-RSI, trust, warm-up), every record re-fetched by PMID, 85 searches; 17 verified KOOS and training-load papers have no seeded topic and wait in `seen` for Shawn's call; the abstract-only and population-beside-grade display tests (202)
- [x] The Program screen's Evidence view: the phase, "Rules the app runs on", the phase's patterns, collapsed, each grade a word beside its population, links that open the browser (196)
- [x] Gates' "Why this test" on all 18 items (11 in the first build, 7 with the completion), the attribution under the checklist, the no-study line kept for any item without one (197)
- [x] The guard (`src/rules/evidence.guard.test.ts`): rules and engine inputs never read it, CSP pinned, no literature host in the app, no `fetch` in the evidence modules, no `api/evidence`, the digest never imported, writes nothing, reads no environment (194, 195)
- [x] `scripts/evidence.ts` (the digest, dev-only) and `docs/evidence-digest.md`; its pure half tested on recorded, trimmed fixtures (198)
- [x] Docs: PROGRAM-QUESTIONS 191 to 202, PROMPT, the feature plan, CLAUDE.md
- [x] Adversarial review: two rounds. Round 1 (citations, scope and safety, screens and tests, two skeptics per finding) confirmed six, fixed from the fetched records: two grades, one misread takeaway, 32 semicolon-joined takeaways, the population note. The first hand-off was truncated, so 61 verified papers and 85 searches were integrated in a completion run (202) and re-audited by three citation auditors: eight more fixed. Claude rechecked the rejections and fixed three wordings: the ACL-RSI rationale now says the 76 comes from the 6-item short form while the app scores the 12-item form, the timed-hop rationale credits the composite screen, and Chmielewski 2016 reads groups combined. Gates' Why this test checked at 390 px

### M-U1 · first-run setup, the time zone setting, the seed sweep (Shawn's Nov 8 multi-user decisions; docs/multiuser-and-release-plan.md section 7 item 1, amendment 3)
Done when a phone with nothing stored asks six short questions (or takes a backup) before Today, every date is counted in a stored per-user time zone (New York by default), nothing outside training content assumes Shawn, and Shawn's phone opens straight to Today with the same dates and plans.

- [x] Rules: `todayIn` takes the zone (no default), `comingMonday`, `timeZoneChange`; the export day, its days and the nudge take the zone; day lines in Los Angeles, London, Tokyo, Sydney and Kiritimati (203, 205)
- [x] `src/rules/onboarding.ts`: when a phone counts as set up; a phone with data but no settings row asks the questions too, keeping every row (207)
- [x] Storage: Dexie v12 additive `timeZoneSettings`, backup schema 12 with an 11→12 step, `timeZoneOnImport` (a file's zone this phone doesn't know still imports), `db.v11.test.ts` rollback; `crossTraining` to v13 (203, 204, 206)
- [x] First run at `#/welcome`: import, side, start, home gym, what it has and the bag, time zone, ready; `onboard` in one transaction; the location editor's and Settings' pieces shared, not copied (`src/components/FormParts.tsx`, `src/screens/location/parts.tsx`, `src/screens/settings/parts.tsx`) (208, 209)
- [x] Settings: Time zone with its inline confirm; Reset all data returns to first run (205, 210)
- [x] The sweep: every Shawn-specific default an answer or a neutral default; `seed.guard.test.ts`; rules never read the phone's zone, and only `src/app/timeZone.ts` does (211, 212)
- [x] Shawn's phone unchanged: `db.v11.test.ts` (set up, New York, same rows, same plan) and `e2e/firstRun.spec.ts` (a version 11 phone opens on Today, never `#/welcome`, nothing written)
- [x] e2e: every spec sets up through first run as Shawn (`e2e/firstRun.ts`); a Los Angeles first run; an import from the first screen skips the questions; Reset comes back with nothing picked
- [x] Docs: PROMPT sections 2, 3 and 5, CLAUDE.md, PROGRAM-QUESTIONS 203 to 212 (122, 141, 179, 185, 189 amended), the multi-user plan, the review plan
- [x] Adversarial review: three lenses (time and dates across five zones, Shawn's install and storage, the wizard and screens), two skeptics per finding; four confirmed and fixed test-first (the unreadable-zone alert couldn't be cleared by keeping New York, Back on a wizard step, two confirm wordings). Claude traced the reported e2e flake to a race already on dev: once a stopped app's settings row reads again the live query recovers before the test can tap Reload, so the test now accepts either route and still requires the app to open. The fresh-install wizard checked at 390 px

### M-U2 · accounts (docs/multiuser-and-release-plan.md section 7 item 2, amendments 1, 2, 4)
Done when an invite code typed into Settings signs a phone's app in to an account (a name and a role), every `/api` route but redeem and me needs that session once accounts are on, and with accounts off the app and Strava behave exactly as before. Not done here: sync (M-U4), tester mode (M-U3), the admin screen (M-U5).

- [x] Server: Neon Postgres behind a one-method query adapter (`api/_accounts.ts`, every SQL statement, parameterised); PGlite in-process runs every statement in the tests; idempotent migrations (accounts, auth_attempts, meta, the one-admin index), applied once per cold start and by `npm run accounts -- migrate` (213, 214, 221)
- [x] `api/auth.ts`: me, redeem, sign-out; 75-bit codes with a check symbol, stored as HMAC with a pepper, compared in constant time; a code binds to a tester, so Safari and the home-screen app sign in as one account; per-client and global rate limits counted before recording, IPv6 by /64; the same words for any refused code; same-origin and JSON on every POST; a 400-day sealed Strict session cookie, re-issued after 30 days from me and redeem; `AUTH_KEY_GENERATION` and `revoked_at` revocation (213 to 217)
- [x] The bootstrap: `AUTH_BOOTSTRAP_CODE` creates the admin only while none exists; the script's `bootstrap` as the terminal fallback (215)
- [x] The `/api` gate in `api/strava.ts`: off, on and broken (fails closed); Strava's callback authorised by the sealed state (account, time, generation); disconnect same-origin; anonymous requests never wake the database; each function answers a thrown error with a plain 500 (218, 219)
- [x] Client: Settings, Account (`src/app/account.ts`, `Account.helpers.ts`, `settings/account.tsx`), hidden without accounts, the kept answer offline; Import from Strava says an account is needed first; Sign out revokes a connected Strava first (216, 220, 222)
- [x] `npm run accounts -- code|migrate|mint|list|revoke|recode|bootstrap|unblock`, with the local pepper checked against the deployment's
- [x] The proof nothing server-side ships: `src/app/serverSide.guard.test.ts` and `scripts/bundleCheck.ts`, chained into `npm run build`
- [x] Docs: PROMPT sections 2, 7 and 8, CLAUDE.md, docs/accounts.md (Shawn's setup, in order), docs/integrations.md, the review plan, the multi-user plan, PROGRAM-QUESTIONS 213 to 222
- [x] Adversarial review: three lenses (security, behaviour and rollout, app and tests), two skeptics per finding; four confirmed and fixed test-first (the Strava cookie now names its account; a sign-out whose Strava check fails says so; a stale or revoked session cookie stays until redeem so a different account can't inherit Strava; the signed-in note). Claude rechecked the seven rejections and fixed six in a follow-up with an independent mutation re-check: the redeem limiter records before it counts and holds under 60 concurrent requests; one shared invite-code fixture table; tests for six decisions that survived mutation (among them a 41-character bootstrap name); sign-out says Strava disconnects on every phone; setup step 0 accepts the update in both contexts; no repeated Strava sentence. The global-cap exhaustion stays the accepted risk in 217. Bundle check and a dist grep show no server code or secret in the client

**Definition of done for v1:** Shawn runs week 1 of the program entirely from the app, on his phone, with morning check-ins deciding the loads for week 2.

## Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-11-09 | M-U2 built: invite codes (75 bits plus a check symbol, stored as HMAC), a 400-day sealed Strict session cookie, AUTH_KEY_GENERATION and revoked_at revocation, the /api gate on when DATABASE_URL and AUTH_COOKIE_KEY are set (fail closed when half set), the bootstrap env code, `npm run accounts`; off by default, so production behaves as today | Shawn's Nov 8 decisions; PROGRAM-QUESTIONS 213 to 222 |
| 2026-11-09 | M-U1 built: the time zone is a per-user setting (IANA name, America/New_York by default) in its own one-row `timeZoneSettings` table (Dexie v12 additive, backup schema 12 with an 11→12 step), never on the settings row; a phone with no settings row gets first-run setup at `#/welcome` (injured side with no default, a Monday start defaulting to the coming one, home gym with rack, equipment and bag, time zone from the phone) or imports a backup from its first screen; Reset all data returns to it; nothing Shawn-specific is seeded; phase 6's `crossTraining` moves to Dexie v13 | Shawn's Nov 8 multi-user decisions (docs/multiuser-and-release-plan.md section 7, amendment 3). A settings row means set up, so Shawn's phone opens on Today with identical dates; a v11 rollback counts in New York (accepted, PROGRAM-QUESTIONS 203); the readings marked confirm in 204 and 207 to 210 |
| 2026-11-09 | Batch F built as decided (8: the gates' own 80%/90% lines only, already on Progress, no external cohort numbers; 9: the curated evidence layer, the four GRADE words beside the population, per phase, per pattern and the app's rules, plus gate rationales where a citation exists; the digest as a script; on-tap search (b) and PEDro not built). Only verified records entered `data/evidence.json`; the research hand-off was cut off, so balance, hop, ACL-RSI, load-monitoring and upper-body entries waited, and were completed the same day (PROGRAM-QUESTIONS 202) | Settled with Shawn Nov 8; PROGRAM-QUESTIONS 191 on, with the Thomeé exception and the relevance notes marked confirm |
| 2026-11-09 | Batch E built as decided (6, the milder variant): a declared down period of 3 to 14 days from Today pauses progression while the readings stay real. Clean twice repeats (`paused`) and the slot's way back from its easier version waits; hold, back off, deloads and the red flag are untouched; the week whose Monday a period covers holds its run target at last week's and the weeks after climb back one plan step a week; the phase-week bands hold at the one the period began in and resume from it a week at a time; Advance waits. A program.md loading rule and the seed's 3 and 14. Dexie v11 additive (`downPeriods`), backup schema 11 with a 10→11 step, an import never lifts a standing period; phase 6's `crossTraining` moves to Dexie v12 (v13 since M-U1 took v12, Nov 9) (supersedes the Batch D row's v11 earmark) | Settled with Shawn Nov 8; the readings in PROGRAM-QUESTIONS 181 to 189, with the easier-version Swap, the Monday rule and the climb back, the end-day and back-to-back rules, and what stays unpaused (the faster Friday, strides, first sessions) marked confirm |
| 2026-11-09 | Batch D built as decided (10, 12): a past morning's check within the 14-day window, marked by a stored `loggedOn`, never overwriting, its red flags a note; six fixed tags paired with the reading the check completes, shown from 5 mornings; Dexie v10 fields only, backup schema 10 with a version-bump step; phase 6's `crossTraining` moves to Dexie v11 (v12 since Batch E took v11; v13 since M-U1 took v12) (supersedes the Batch A (Nov 8) row's v10 earmark). PROMPT section 8's non-goal narrows to "no nutrition tracking, no general wellness scores". Until Shawn answers, the gates read late evidence conservatively | Settled with Shawn Nov 8; PROGRAM-QUESTIONS 174 to 179, with the gate-item, no-edit, NSAID-wording and sixth-tag questions marked confirm |
| 2026-11-09 | Batch C built as decided with Shawn (decisions 5, 13, 14, 15; 16 is no change). Part 1: the 20-movement accessory and core catalog lives in program.md and the seed (an optional `accessory` field on the catalog entry), exempt from the phase hold; an added or extra-time slot's sets count for a gate item exactly when it is the same exercise, the load-test prefill pairing sides within one slot. Part 2: the time window is door to door (the warm-up's minutes off the top, both ways, `bikeMinutes` in the seed), and warm-up sets (8 at 50%, 5 at 75%, rounded down) show above set 1 of eleven big loaded lifts and in the Preview, display only, their time counted in the window; the ramp is a new training-content rule in program.md's warm-up section and the seed. **No storage change**: no Dexie bump, no backup change, no new local-storage key; an added slot still stores only its exercise, and a ramp is never stored | Settled with Shawn Nov 8; readings in PROGRAM-QUESTIONS 165 to 173, with the ramp's reps and eligibility, the rehab exercises the door-to-door count leaves out at 45 minutes, the kneeling cues, the nominal extra-time reach and whether decision 13 meant to lift the phase hold for a gate's own exercise marked confirm |
| 2026-11-08 | Batch B built as decided with Shawn (feature-plan candidates 4-partial and 5): the acute:chronic warning reads EWMA week-rates (the seam accepted: the 1.5 line fires at marginally different moments); the Summary counts prescribed sets in words; Progress counts each week's sessions done of those scheduled, with no streak. **No storage change**: no Dexie bump, no backup change, everything computed from what is stored. The CTL/ATL/TSB chart half of candidate 4 stays open | Settled with Shawn Nov 8; readings in PROGRAM-QUESTIONS 162 to 164, including the compliance denominator the logs can support (163) |
| 2026-11-08 | Batch A built as decided with Shawn (feature-plan candidates 1, 2, 8): KOOS monthly and at gate attempts with scores on Progress only; ACL-RSI a required gate-3 auto item at the strict published ≥ 76, the trust toggle kept separate; the 6-meter timed hop joins gate 3's battery with best = fastest and symmetry = other ÷ injured. `koosEntries` and `aclRsiEntries` take Dexie v9 and backup schema 9, so phase 6's `crossTraining` moves on to Dexie v10 (v11 since Batch D took v10, Nov 9; v12 since Batch E took v11; v13 since M-U1 took v12) (supersedes the Nov 7 row's earmark) | Settled with Shawn Nov 8; the readings and the inverted-ratio and 0-seconds decisions in PROGRAM-QUESTIONS 156 to 161 |
| 2026-11-07 | Metrics phase 3 built as decided: VO2 max readings typed from the watch, one per day keyed by date in `vo2Readings` (Dexie v8 additive, backup schema 8 with a 7→8 step), entered and shown on Progress, informing and changing nothing; future schema work — phase 6's `crossTraining` — moves to Dexie v9 | Settled with Shawn (docs/metrics-and-photos-plan.md): typed from what his watch shows, nothing estimated ever; the trend is the readings alone (PROGRAM-QUESTIONS 153 to 155) |
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
