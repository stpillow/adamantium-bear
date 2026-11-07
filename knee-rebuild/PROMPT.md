# Knee Rebuild App: Claude Code Build Prompt

Oct 31, 2026 · @Shawn

Export this doc as Markdown and save it as PROMPT.md in a new repo, next to a Markdown export of the program doc saved as docs/program.md. Open Claude Code in that folder and say: read PROMPT.md and docs/program.md, then follow section 7. Everything from the first heading down is the prompt.

## 1. Context

You are building a personal, single-user training app for Shawn. He is 13 weeks out from a multi-ligament knee sprain and starting a 12-week return-to-sport program: three full-body lifts a week at Planet Fitness, three runs, and criteria-gated phases. The app replaces the notebook: it says what to do today, logs what happened, reads the knee's response, and decides what the next session looks like.

It runs on an iPhone at the gym, often with weak signal, one-handed, inside 60-second rest windows. Every logging interaction has to be doable in under 10 seconds without reading.

Two files are the source of truth, both in this repo:

- docs/program.md: the training program (phases, sessions, exercises, cues, gates, mileage plan, substitutions). Transcribe it into seed data once, carefully; don't parse it at runtime and don't improve the training content. Questions about the program go on a list for Shawn, not into the code.
- PROMPT.md: this file, which owns app behavior. Where the two disagree on training content, program.md wins; on app behavior, this file wins.

## 2. Decisions already made

These are set. Shawn flips the first two before handing this over if he disagrees; the rest change only when a milestone proves them wrong.

| Decision | Choice | Alternative, if flipped |
|---|---|---|
| Platform | Installable PWA, mobile-first, added to the iPhone home screen; works offline after first load | Native SwiftUI app; everything below still applies except the stack row |
| Data | Local-first on the device: IndexedDB via Dexie, with JSON export and import for backup. No accounts. One server piece only: the Strava import function (`api/strava.ts`, Nov 6), which holds Strava's client secret and stores nothing; the log never leaves the phone | Cross-device sync via Vercel Postgres in v2, not v1 |
| Stack | Vite + React 19 + TypeScript (strict) + Tailwind, vite-plugin-pwa, Zod for schemas, Vitest for the rules engine, Playwright for one smoke test | Next.js only if a server becomes necessary |
| Deployment | Vercel, static build, preview deploy on every PR, production on the Vercel URL; a custom subdomain later if Shawn wants one | None |
| Logic placement | A pure TypeScript rules module (src/rules/) holding every decision the app makes, fully unit-tested; React components render and collect input only | None |
| Design | Text-first, 44 px minimum tap targets, numeric keypads and steppers, no modals that trap. Shawn is colorblind: no meaning carried by color alone; every state gets a word or a shape. If the spdc-design skill is installed, apply it; otherwise a neutral system-font UI | None |
| Units and time | Pounds, miles, seconds; dates in America/New_York; weeks start Monday | None |
| Program start | Monday Nov 2, 2026 is week 1, day 1; the 12-week plan and the deloads in weeks 4, 8 and 12 hang off that date; editable in Settings | None |

## 3. Domain model

Model it the way the program is written: a program has phases, a phase has three session templates, a template has ordered slots, and a slot points at an exercise and carries its prescription. Logs hang off slots so progression can be computed per exercise and per side.

| Entity | Key fields | Notes |
|---|---|---|
| Program | startDate, injuredSide (left or right), phases[] | One per install |
| Phase | number (1–4), name, weekStart, weekEnd, gateCriteria[] | Phase 4 is a placeholder with criteria only |
| SessionTemplate | phase, letter (A, B, C), slots[] | Nine templates across phases 1–3 |
| Slot | order, exerciseId, sets, repsMin, repsMax or seconds, rpeTarget, unilateral, pairWithSlot, cues, progressionRule, substitutionIds[] in order | progressionRule is one of double-progression, height-then-load, range-then-load, time, fixed |
| Exercise | id, name, pattern (squat, hinge, single-leg, hamstring, hip, calf, balance, plyo, push, pull, core, carry), equipment, loadType (dumbbell-each, stack, smith-plates, bodyweight, step-height, band, time), increment, unilateral | increment is the smallest step: 5 lb per dumbbell, one stack plate, 10 lb on the Smith, 2 in. of step height |
| Workout | date, templateId, phase, week, isDeload, startedAt, finishedAt, maxPainDuring, sessionRpe (1–10, optional), durationMinutes (optional), notes, status | One per lift day |
| SetLog | workoutId, slotId, setNumber, side (left, right, both), load, reps or seconds, rpe, painDuring (0–10), stopped | side is required on unilateral slots; the injured side is logged first |
| MorningCheck | date, appliesTo (workoutId or runId), stiffnessUnder30Min, worseThanYesterday, visibleSwelling, warmth, painChangePoints, redFlags[], notes | Four taps plus an optional note |
| Run | date, type (mbr, easy, long, elliptical-swap, rower-swap), miles, minutes, rpe (1–10; optional on older runs), effort (easy, moderate, hard, written from rpe: 1–3, 4–6, 7–10), avgHr and maxHr (optional whole bpm, 30–250, from a watch via Strava or typed; absent is no heart rate, never 0), maxPain, strides, tempo, stravaUrl | Swaps count as the week's session but add no miles |
| MileagePlan | week (1–12), targetMiles, isDown | Seeded from program.md |
| GateTest | date, gate (1–3), item, valueInjured, valueOther, pass, manual | Hop tests store three trials per side and keep the best |
| Reading (computed, never stored) | subject (workout, run or exercise), result (clean, hold, back-off), reasons[] | Derived from SetLogs and the matching MorningCheck |
| Settings | injuredSide, startDate, dumbbellMax (75 or 60), restTimerSeconds, painPerSet (bool) | Also holds the export and import controls. Shawn's max and resting heart rate are stored beside the settings row, not in it (their own one-row table), so older builds still read the row |

## 4. Rules engine

Everything below lives in src/rules/ as pure functions with Vitest cases, including one test per worked example at the end. The UI never decides anything; it asks the engine.

1. Session reading, per exercise. Take the painDuring values for that exercise (per set if enabled, otherwise the one value per exercise). Max of 3 or under and not climbing: clean. 4–5, or climbing: hold. Over 5, or a set marked stopped for sharp joint-line pain: back-off. Climbing means pain rose by 2 or more points across consecutive sets.
2. Morning reading. stiffnessUnder30Min true and nothing else flagged: clean. worseThanYesterday true with no swelling, no warmth and painChangePoints under 2: hold. visibleSwelling, warmth, or painChangePoints of 2 or more: back-off. Any redFlags entry: red-flag state (rule 9).
3. Combined reading. For each exercise in the last workout, the combined reading is the worse of its session reading and the workout's morning reading. A workout with no morning check within 36 hours reads as hold for every exercise, not clean: unknown isn't clean.
4. Next prescription, per exercise and side. Inputs: the last two combined readings, the last set logs, the slot's prescription. Clean twice in a row and every set hit repsMax at RPE 8 or under: load plus one increment, reps reset to repsMin. Clean twice but short of repsMax: same load, target repsMax. Clean once: same load, same target. Hold: repeat the last session's loads and reps exactly. Back-off: load times 0.75 rounded down to the increment, or the previous substitution when loadType is bodyweight or step-height. height-then-load raises step height one increment before any load is added; range-then-load (leg extension) moves the range stop 90° to 45° to 30° before load. Deload weeks skip progression entirely.
5. Unilateral budget. The injured side is logged first. The healthy side's target reps for each set equal the injured side's completed reps for that set; its load may match or exceed. Symmetry is the injured value divided by the other side's value, shown as a percent.
6. Deload. Weeks 4, 8 and 12 counted from startDate: sets times two-thirds rounded down, minimum 2; loads unchanged; isDeload true on the Workout. Progression resumes the week after, from the loads in use before the deload.
7. Mileage. Each week's target comes from MileagePlan. If any run or workout in the current week reads hold or back-off, next week's target is capped at this week's actual miles. The long run's suggested distance is 40% of the week's target rounded to the nearest half mile; the other two runs split the remainder. Swap runs count as sessions and add no miles.
8. Gates. Each gate is a checklist. Auto-evaluated items: two consecutive clean weeks (14 days with no hold or back-off on any subject), symmetry thresholds from GateTest entries (80% for gate 1, 90% for gates 2 and 3), 20 single-leg calf raises each side, no swelling flagged for 14 days. Manual items: step-down video pass, ortho or PT sign-off, "would trust it at full speed". A gate passes when every item passes; the phase advances only when the user confirms, never automatically.
9. Red flags. Any redFlags entry on a morning check puts the app in a red-flag state: the Today screen shows "Stop. Call the ortho or PT." with the flagged items, and progression suggestions are suspended until the user clears the state from Settings with a note. The list of flags is the Red flags section of program.md.
10. Week and day. week = floor((date − startDate) / 7 days) + 1 in America/New_York. The scheduled session for a date comes from the weekly template (Mon run MBR, Tue A, Wed run easy, Thu B, Fri run long, Sat C, Sun off); the user can move a session to another day in the same week.

Worked examples to encode as tests:

- Leg press, Phase 1: sets of 12, 12, 12 at RPE 7 with pain 2, 2, 2; morning clean; previous session also clean and at repsMax. Next: plus one plate, 3 × 10.
- Step-up: 3 × 10 with 20 lb, clean twice at 6 in. Next: 8 in. at 20 lb (height before load).
- Bulgarian split squat, injured side completes 8, 8, 7. Healthy side targets 8, 8, 7.
- Week 4, a 3 × 10 slot. Prescribed: 2 × 10 at the same load.
- Week 2's Friday run reads hold. Week 3 target becomes week 2's actual miles, not 12.
- Hop test: injured best 56 in., other side 62 in. Symmetry 90.3%, passes gate 3's 90% line.

## 5. Screens, v1

Nine screens behind a bottom tab bar (Today, Week, Progress, Gates, More). Each screen leads with the one thing he needs in that moment. The Session runner is the product: it gets the most design time and the only Playwright test.

| Screen | Must do |
|---|---|
| Today | Show the scheduled session (A, B, C, a run, or off), phase and week, a deload badge when it applies, yesterday's reading in words, and one button: Start. Red-flag state replaces all of it with the stop message |
| Session runner | List the slots in order with cues visible. Per set: load, reps or seconds, RPE and pain as steppers prefilled from the engine's prescription; a side toggle on unilateral slots that starts on the injured side and shows the healthy side's rep budget; paired slots grouped as a superset; a rest timer that starts when a set is marked done; a Swap button listing the slot's substitutions in order; a Stop this exercise control that records the reason. Finish asks for max pain during the session, the whole session's RPE (optional, stored only if tapped) and its minutes (a stepper preset from the sets' times, or an estimate for a late entry), and shows a summary |
| Morning check | Four taps (stiffness under 30 min, worse than yesterday, visible swelling, warmth), a pain-change stepper, a red-flag checklist, an optional note. On save, show the reading and what changes in the next session, one sentence each |
| Run logger | Type, miles, minutes, effort as RPE 1–10 (unrated until tapped; Save waits for it, as for max pain), optional average and max heart rate (never blocks Save; filled from a Strava activity when it has them), max pain, strides and tempo toggles, optional Strava link. Shows the week's miles against target as you log |
| Week | Seven-day strip with each day's session and its reading in words, the deload badge, miles logged against target, and a move-session action |
| Progress | Per-exercise load over time (one chart at a time, picked from a list), symmetry per unilateral exercise as a percent over time, weekly miles actual against plan across the 12 weeks, weekly training load (RPE × minutes) with the warning in words and the week's HR load (TRIMP) in words beside it (the warning reads the RPE load alone), and a count of consecutive clean days |
| Gates | The current gate's checklist with auto items evaluated live and manual items as toggles, a hop-test entry form (three trials per side, best kept, symmetry shown), and an Advance phase button that enables only when every item passes |
| Program | Read-only view of the current phase's sessions, an editor for cues and substitutions, and program.md rendered as reference |
| Settings | Injured side, start date, dumbbell max, rest timer length, pain per set or per exercise, max and resting heart rate (optional; unset means no HR load), export JSON, import JSON, clear red-flag state, reset all data |

## 6. Build plan

Seven milestones, each a PR with a preview deploy and a three-line demo note. Stop for review at the end of each; don't start the next until Shawn says go.

1. M0, Scaffold. Repo, Vite + React + TypeScript strict + Tailwind, vite-plugin-pwa with an offline-first service worker, Dexie with an empty schema, CLAUDE.md, Vercel project with preview deploys. Done when the app installs to an iPhone home screen and loads in airplane mode after one visit.
2. M1, Seed data. Zod schemas for section 3; data/program.json transcribed by hand from docs/program.md: all nine session templates, every slot's cues and substitutions, the three gates, the 12-week mileage plan, the red-flag list, and the exercise catalog with increments. A npm run program -- --week 5 --session B script prints a session. Done when the schema validates, the script output matches program.md on a spot check of all three phases, and PROGRAM-QUESTIONS.md lists anything ambiguous.
3. M2, Rules engine. src/rules/ with every rule in section 4 and Vitest coverage including the worked examples. Done when tests are green and no rule lives outside the module.
4. M3, The daily loop. Today, Session runner, Morning check, and the Settings basics. Done when Shawn can run Session A on his phone end to end, do a morning check, and watch the next Session A's prescriptions change according to the reading.
5. M4, Running. Run logger, Week screen, miles against plan, the hold cap. Done when three logged runs show against the week's target and a hold reading caps the following week.
6. M5, Gates and progress. Gates screen with live evaluation, hop-test entry, Progress charts. Done when gate 1 evaluates from logged data alone and the hop-test symmetry matches the worked example.
7. M6, Hardening. Program editor, export and import, offline QA on a real phone at the gym, a Lighthouse PWA audit, the Playwright smoke test for the Session runner. Done when export, wipe, import restores everything, and a full Session B gets logged on cellular with the screen locked between sets.

Definition of done for v1: Shawn runs week 1 of the program entirely from the app, on his phone, with morning check-ins deciding the loads for week 2.

## 7. Working agreements

How to operate, from the first message on:

1. Read docs/program.md and this file in full. Then write PLAN.md: the seven milestones expanded into tasks with checkboxes, a Decisions log, and the PROGRAM-QUESTIONS list. No code before PLAN.md exists.
2. Ask the questions in section 9 in your first reply, all at once, with your proposed default beside each. If Shawn answers "defaults", proceed with them and record that in the Decisions log.
3. Keep CLAUDE.md current: stack, commands (dev, test, build, deploy), folder layout, the domain glossary (slot, reading, clean, hold, back-off, gate, deload, symmetry), and the two rules that are not negotiable: logic only in src/rules, and no color-only meaning in the UI.
4. One commit per task, one PR per milestone, conventional commit messages, the preview URL in the PR description, and a three-line demo note: what to tap, what to expect, what's not done.
5. Tests before UI for anything in section 4. A rule change without a test change is a bug.
6. When program.md is ambiguous, take the reading that is more conservative for the knee, note it in PROGRAM-QUESTIONS.md, and keep going. Never change training content to make the data model simpler; change the model.
7. Dependencies: only what section 2 names plus small, well-maintained utilities. No analytics, no telemetry, no external calls at runtime, except the app's own `/api/strava` when Shawn taps Connect or Check Strava (Nov 6); the page itself still talks only to its own origin.
8. If you hit a wall (an iOS PWA limitation, a Dexie quirk, a rule that can't be computed from the logged data), say so in the PR with two options and a recommendation. Don't quietly simplify the behavior.
9. Tick PLAN.md as tasks finish; it's the status page Shawn reads, so keep it truthful and short.

## 8. Non-goals for v1

Out of scope, so don't build toward them or leave hooks for them:

- Apple Health or Whoop sync, and background Strava sync (Strava import on tap came forward to v1 on Nov 6: `api/strava.ts`, PROGRAM-QUESTIONS 142; the other platforms' barriers are in docs/integrations.md)
- Accounts, multi-user, or cross-device sync (v2 candidate: Vercel Postgres behind the same Dexie interface)
- Push notifications; iOS PWAs make them unreliable, and a home-screen icon is the reminder
- Nutrition, sleep, or any tracking beyond the knee signals and the training itself
- AI coaching, chat, or generated advice inside the app; the program is the coach
- Phase 4 content; the app carries Phase 4's gate criteria only, and its sessions arrive as a later program.md update

## 9. Questions to ask Shawn before M1

Ask these in your first reply, each with its default. "Defaults" as an answer means take every default.

1. Which knee is injured? No default; the app can't start without it.
2. Start date: Monday Nov 2, 2026 as week 1? Default: yes.
3. Your club: dumbbells to 75 or 60 lb, a seated or 45° leg press, and is there a rower? Defaults: 75, seated, yes.
4. Pain logging once per exercise, or per set? Default: per exercise, with per set available in Settings.
5. Is Monday's MBR run fixed on Mondays? Default: yes; it anchors the weekly template.
6. Custom domain, or the Vercel URL for now? Default: Vercel URL.
7. Is the spdc-design skill installed here, and should the app use it? Default: use it if present, neutral UI if not. Consult https://impeccable.style when in doubt
8. Rest timer defaults of 90 seconds for lower-body slots and 60 for everything else? Default: yes.
