# Adversarial review plan

Every milestone PR gets attacked before it merges. The attacker's goal is simple: make the app lie to the knee (a wrong prescription, a lost log, a stale build) or leak what's on the phone. The reviewer is not the author's friend.

## Standing passes, in order

1. **Threat model refresh.** Local-first, one writer per account; invite-gated accounts; one server database of names, roles and code hashes (M-U2): the assets are the logs on the phone, the prescriptions computed from them, and the accounts (codes, sessions, the gate). The threats are data loss (storage eviction, failed migration, bad import), wrong decisions (rule edge cases, timezone and week math, missing data read as good), a stale or broken shell (service worker and cache), and content injection through the two places untrusted text enters: imported JSON and free-text notes. Anything new in the PR gets added here first.
2. **Security pass.** Run `/security-review` on the branch diff. Checklist: imported JSON validated with strict schemas before it touches Dexie; links rendered from user input (Strava URL) restricted to `https:`; no `dangerouslySetInnerHTML`; CSP and the other response headers in `vercel.json` stay in force; `npm audit` clean or every advisory explained; no runtime external calls from the page (the app's own `/api/strava` and `/api/auth` excepted); nothing secret ever enters the bundle (Strava's client secret and cookie key, `DATABASE_URL`, `AUTH_COOKIE_KEY`, `AUTH_CODE_PEPPER` and `AUTH_BOOTSTRAP_CODE` live only in Vercel environment variables, read by the two functions; `npm run build`'s bundle check and `src/app/serverSide.guard.test.ts` hold it). Accounts (M-U2): every `/api` route but redeem and me behind the session gate, failing closed when half set; same-origin and JSON checks on every state-changing route; the redeem rate limit; the same error words for an unknown, revoked or mistyped code; no `console` and no error's own text in `api/`; every SQL statement parameterised and in `api/_accounts.ts`.
3. **Correctness pass.** Run `/code-review` at medium on the branch diff, then walk the rules by hand at their boundaries: pain exactly 3 and exactly 5, a climb of exactly 2, the 36-hour morning-check window at both ends, a workout with no sets, a unilateral slot with a stopped set on the injured side, symmetry with a zero on either side, deload rounding at 2 and 4 sets, the week number on a Sunday night and a Monday morning in the user's time zone (New York by default, and one zone east of UTC), and the first week after the start date.
4. **Failure-point walk.** The list below, re-read against the diff. Each item is either covered, a test to add, or a logged risk with an owner.
5. **Tests before fixes.** Every real finding gets a failing test first, then the fix, in the same PR.
6. **Exit.** The PR merges when the findings are fixed or logged with a reason, `npm run check` and `npm run build` are green, and the preview is Ready. A PR that touches `api/` also needs the preview's `/api/strava?action=status` and `/api/auth?action=me` to answer JSON, not a 500: Vercel compiles each function on its own, and an import it can't resolve fails every request (M-U2).

## Likely failure points, standing list

| Area | What breaks | How we know / what guards it |
|---|---|---|
| iOS storage | Safari can evict IndexedDB for a site it considers unused; a reinstall wipes it | `navigator.storage.persist()` at first run (M3), an export reminder on the Week screen, export to Files (M6). Logged risk until then. |
| Service worker | A deploy lands mid-session; a stale precache serves old code against new data; the update prompt never shows | `registerType: 'prompt'`, the Reload button, `cleanupOutdatedCaches`; M6 QA on cellular with the screen locked. |
| Dexie migrations | A new version changes an index or drops a table and loses rows | Every version additive; a migration test with a seeded old database (M3). Never edit a shipped version. |
| Seed validation | A hand edit to `data/program.json` breaks the schema and the app throws at import | Strict schemas, `src/schema/program.test.ts`, and a readable error state instead of a blank screen. |
| Date math | Week boundaries drift across DST (Nov 1, 2026 is the fall-back, the day before week 1) or when the phone's timezone differs | Calendar math on YYYY-MM-DD strings in the user's time zone (a setting, New York by default; M-U1), never on millisecond deltas; tests pinned to the DST weekend in New York, Los Angeles and London and a day line east of UTC. |
| Unknown reads as clean | A missing morning check, an unfinished workout, or an unlogged side is treated as a good signal | Rule 3's 36-hour rule; prescriptions default to hold when inputs are missing; tests for each missing input. |
| Rest timer | iOS suspends JavaScript timers when the screen locks | Timer computed from a stored start timestamp on each render, not from `setInterval` ticks. |
| Double taps | A set logged twice in a 60-second rest window | Idempotent writes keyed on (workout, slot, side, set number). |
| Export and import | A large or malformed file, a file from a newer schema version | Strict parse before any write, version field in the export, import is all-or-nothing in one transaction. |
| Red-flag state | A ticked flag never shows the stop screen, or clears without a note | Rule 9 tests; clearing requires a note. |
| Bundle | The seed and fonts grow the precache past what a weak signal tolerates | Build output size tracked in each PR; fonts are latin subsets only. |

## Findings, M1 (Oct 31, 2026)

Correctness pass: `/code-review` at medium over `knee-rebuild/`, ten findings, then a hand walk of the rules. Nineteen items in all across both passes: 14 fixed, 5 accepted or logged with a reason.

| # | Finding | Verdict | Status |
|---|---|---|---|
| 1 | Week-banded slots were keyed to the calendar week, but phases advance on gate confirmation; a late gate would drop Phase 2's snap-downs and skip Phase 3 plyo rungs, and the schema capped bands at week 12 | Real, the most important one | Fixed: `phaseWeeks` counts from phase entry, open-ended tops; fixture tests; PROGRAM-QUESTIONS 46 |
| 2 | `deloadSets` floored at 2 unconditionally, so a one-set slot got two sets in a deload week, and the test locked the bug in | Real | Fixed: capped at the slot's own sets; test rewritten |
| 3 | `pairWithSlot` was one-way and inconsistent; A5/A6/A7 is a three-way group a single pointer can't express | Real | Fixed: `groupId` on every member; test requires two or more members per group |
| 4 | `MileageWeek.starts` seeded Monday dates that go stale when `startDate` is edited | Real | Fixed: dates removed from the seed; derived from Settings in M4 |
| 5 | `DELOAD_WEEKS` and `mileagePlan.isDown` are two statements of one fact with nothing tying them together | Real, low risk | Fixed: a test asserts they agree; the rule keeps its own constant because PROMPT rule 6 states it |
| 6 | The script's Phase 4 message was unreachable behind the week-range check | Real, cosmetic | Fixed: weeks past 12 reach the Phase 4 message |
| 7 | The script hardcoded "10 lb steps", "2 in. risers" and the bike line instead of reading the seed | Real, drift risk | Fixed: reads `increment`, `heightIncrementIn` and the warm-up intro |
| 8 | `tsconfig.node.json` lacked `noUncheckedIndexedAccess`, so scripts compiled looser than the app | Real | Fixed; the one undefined case it exposed is handled |
| 9 | Rules tests imported the live seed, coupling rule tests to content edits | Real | Fixed: inline fixtures in `src/rules/*.test.ts`; seed checks stay in `src/schema/program.test.ts` |
| 10 | `SetLog` accepted a set with neither reps nor seconds; `IsoDate` accepted 2026-13-45 | Real | Fixed: refinements plus `src/schema/log.test.ts`; Strava links restricted to https while there |
| 11 | (own) Zod's default of stripping unknown keys let a mis-named seed field vanish silently; it happened during transcription | Real | Fixed: every schema is `strictObject`; the test suite caught the next occurrence |
| 12 | (own) No content security policy; a bad import or note would have had free rein if a render path ever slipped | Hardening | Fixed: CSP with no inline scripts, nosniff, no-referrer, permissions policy in `vercel.json` |
| 13 | (own) `src/program/program.ts` throws at import if the seed fails validation: a blank screen with no words | Risk, not yet reachable (the shell doesn't import the seed until M3) | Logged: M3 wires a readable error state before the seed is imported by the app |
| 14 | (own) The `time` progression rule is named in PROMPT rule 4 with no semantics | Open question | PROGRAM-QUESTIONS 45 |

### Security pass, M1

Method: `/security-review` over the branch diff (a read-only reviewer tracing every untrusted flow to every sink), plus `npm audit`, a grep for runtime network calls and dangerous DOM sinks, and a check of the built `index.html` for inline scripts.

Verdict: no finding above the bar. What was checked, so the absence is evidence: every file in `src/`, `scripts/` and the two configs for `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, `location`, `window.open`, `.href`, `postMessage`, `fetch`, `localStorage` (zero matches; all rendering is JSX text); the Strava URL schema probed live with `javascript:`, `data:`, `vbscript:`, `http:` and scheme-relative URLs (all rejected); the seed import path (bundled at build, never fetched, Map lookups); the CLI (`parseArgs` strict, no filesystem or shell access); the CSP against the real build (no inline script, the service worker loads Workbox same-origin, fonts are vendored); the lockfile additions (zod, tsx, esbuild, all from the npm registry); the diff and the seed for secrets or PII (none; the seed carries the program plus the injured side and start date, by design). `npm audit`: 0 vulnerabilities.

Low observations, below the bar:

| # | Observation | Status |
|---|---|---|
| 15 | `Settings.redFlag` and `MorningCheck.appliesTo` were plain objects while every sibling is strict | Fixed; test added |
| 16 | `stravaUrl` was https-only but not host-restricted | Fixed: `strava.com` or `www.strava.com` only; test added |
| 17 | `script-src 'self'` will block Vercel's preview toolbar (it loads from vercel.live) on preview deploys | Accepted: the toolbar is noise on a phone test. Allow-list `vercel.live` for previews only if it is ever wanted |
| 18 | `style-src 'unsafe-inline'` | Accepted: React and Tailwind set style attributes; with no inline script allowed, CSS injection has no meaningful impact here |
| 19 | Seed validation throwing at import blanks the app | Same as finding 13; M3 adds the readable error state |

## Findings, M2 (Oct 31, 2026)

Correctness pass: eight review angles over `src/rules/`, then the boundary walk from the standing list. Security pass: a read-only reviewer traced every untrusted field (red-flag ids, stop reasons, dates, numbers, template ids, move days) through the engine; no sink exists (the engine returns text and numbers, the guard test forbids DOM, storage, network and clock), `Map`/`Set` keys and enum-constrained object keys rule out prototype pollution; nothing above the bar. It recommends re-running when M3 and M6 add the first rendering and parsing sinks.

| # | Finding | Verdict | Status |
|---|---|---|---|
| 20 | A morning check dated the same day as a session attached to it, so a Thursday-morning check (about Wednesday's run) read Thursday evening's lift before it happened | Real | Fixed: only the morning after applies, or an explicit link; test flipped |
| 21 | Sets from an abandoned session (the sharp-pain stop being the obvious case) fed neither readings nor the next prescription | Real | Fixed: abandoned sessions count; test added |
| 22 | `backOff` carried an unused `side` parameter | Cleanup | Fixed |
| 23 | Two readings of one exercise count as consecutive whatever the calendar gap between them | Accepted: "twice in a row" is about that slot's sessions, and a slot can skip a week on a move or a swap | Logged |
| 24 | The per-exercise pain storage convention lived only in a comment | Convention | Fixed: stated in CLAUDE.md's glossary |

## Findings, M3 (Nov 1, 2026)

Method: a five-angle adversarial review run as a workflow (data integrity; rule fidelity and placement; the gym experience against the brief and the runner design; security and robustness; dates, phases and edge cases). Each reviewer reported up to eight findings with a concrete scenario; each finding then went to three skeptics told to refute it (by code reading, against the spec, and by reproduction). A finding survived on two confirmations of three. 32 reported, 31 survived, most reproduced with a script; many were the same defect seen from two angles. The locations design panel found one more (a slot already on its first substitution was "moved" to itself).

| # | Finding | Fix |
|---|---|---|
| 25 | A back-off or the dumbbell cap took the slot's first substitution even when the slot was already on it | `nextSubstitution`: the one after the current exercise; tests |
| 26 | After a mid-exercise swap, the old exercise's load, height and stage prefilled the new one, slipping past "Pick a load first" | Prefill moved to `src/rules/prefill.ts`; only sets of the same exercise carry; tests |
| 27 | Per-exercise pain was keyed by slot, so after a swap one exercise's pain rewrote the other's sets (hold turned clean, reproduced) | Pain keyed by slot and exercise; a rating rewrites only that exercise's sets |
| 28 | The healthy side's reps took last session's per-set repeat ahead of the injured side's budget in hold, deload and red-flag weeks (rule 5) | Budget first; tests |
| 29 | Unrated pain in the default per-exercise mode read hold silently; two skipped ratings backed loads off 25% | Done waits for a pain rating ("Rate pain first") with a line saying why; the bar line says "pain not rated". A stop doesn't need a rating |
| 30 | Stop skipped the load check and labelled the count as the target | Stop waits for a load on a first-time exercise; the count reads "Reps done before stopping" while the panel is open |
| 31 | End, then Start again created a second workout planned from the abandoned one; the next morning's check covered only one | Start reopens today's abandoned workout (one workout per lift day); planning reads only sessions before the day; a morning check links one session only when exactly one happened |
| 32 | A stop on the injured side left the healthy side looking like a first-ever session next time | `lastSetsBySide`: each side's own most recent sets; test |
| 33 | An accidental Start, then End or Finish, kept an empty session that read hold and capped next week's miles | A session with nothing logged is discarded |
| 34 | A swap to a substitution of another kind kept the slot's unit, targets, step height and range stop | `effectiveSlot`: unit, targets and rule follow the exercise done (PROGRAM-QUESTIONS 57); tests |
| 35 | Finish, End and slot-row taps changed the screen far above the thumb | The card or panel scrolls into view |
| 36 | No side toggle on two-sided slots, against the brief and the design | Side buttons with a mark, landing on that side's open set (`openStepForSide`, tested) |
| 37 | readingSentence stated a consequence that contradicted the engine (two holds back off; a second clean progresses) | It now describes the reading; the summary shows the reading's actual reasons |
| 38 | The card dropped "each side" and "each way"; the bar said "load 8" with no unit | Both fixed |
| 39 | "Remove this set" was one tap, next to Back | Two taps, on its own row |
| 40 | A malformed escape in the URL blanked the app | `parseHash` lands on Today; test |
| 41 | Reset left this workout's swaps in local storage; ids repeat after a reset | `resetAll` clears them |
| 42 | The seed threw at import, so the readable seed-error screen could never show | `seed.ts` validates without throwing; `main.tsx` shows the error or loads the app |
| 43 | The Morning check's "Next time" used the stored week + 1, wrong after a start-date edit | From the calendar |
| 44 | Switching to per-exercise pain mid-session could flatten a per-set climb | A rating overwrites only unrated or uniform sets (`painRewriteAllowed`, tested) |
| 45 | A first time in a deload week gave two conflicting load instructions | The engine prescribes the lightest load (PROGRAM-QUESTIONS 58) |
| 46 | (refuted, kept as hardening) A stored swap id the seed lacks would crash the runner | `planSession` only honours the slot's own exercise or its substitutions |

Not fixed, logged: the Stop panel's count starts at the prefilled target rather than blank (relabelled instead); the engine never moves a slot back from a back-off substitution (PROGRAM-QUESTIONS 55, before Phase 2).

Verified in a browser drive after the fixes: the full Session A loop, a mid-exercise swap asking for a load again, End then Resume reopening the same session, and a malformed link landing on Today, with no console errors.

## Findings, M4 (Nov 2, 2026)

Method: the same five-angle workflow as M3 (data integrity; rule fidelity and placement; the run logger, Week and Today against the M4 brief; security and robustness; dates and edge cases), up to six findings per angle, three skeptics per finding (code reading, the spec, reproduction), two confirmations to survive. A usage limit stopped the first run; it resumed from cache. 22 reported, 20 survived, most reproduced with a script; they collapse to 11 defects. A fix workflow then ran a rules fixer, two screen fixers on disjoint files and an independent verifier, who confirmed all 20 against code and tests and re-ran the browser drive (15 checks, no console errors).

| # | Finding | Fix |
|---|---|---|
| 47 | A run logged later for a day whose next-morning check was linked to that day's lift read hold for good and capped next week, with false words on two screens | A stored link adds its session and no longer hides the rest of the day before (`morningCheckApplies`; PROGRAM-QUESTIONS 52 updated) |
| 48 | A lift day with only a run logged read "✓ Done" while Today still offered the lift | `sessionDone`: Done only when what was logged is that day's session |
| 49 | After a hold morning the suggestion still told him to carry a tempo, strides or a faster effort | Reasons come from the final flags |
| 50 | With no morning check yet, the suggestion treated the morning as clean | Miles stand; strides, the tempo and any faster effort wait on a clean check (PROGRAM-QUESTIONS 60) |
| 51 | A capped run rounded up past the week's ceiling and printed float noise ("3.9000000000000004") | Floor to the quarter mile; round what is left |
| 52 | Today judged the cap by matching the reason string and wrote its own run prescription text | `capped` drives the words; `RunSuggestion.headline`; a cap at or above the plan is no cap |
| 53 | Typing into a prefilled Stepper on iPhone appended: 4.5 over a suggested 3 saved 34.5 miles | Focus starts an empty field with the value as placeholder; an empty field keeps the value; miles capped at 30 |
| 54 | A swap could save at 0 minutes, its only measure | "Set the minutes first" |
| 55 | The logger planned whatever type was picked, so a run on a lift day got the long-run share and a tempo | Only the day's scheduled run gets a suggestion |
| 56 | The logger's date followed the live clock across midnight and the week's turn, even after a pick | Pinned when the logger opens; a date that drops out blocks Save in words |
| 57 | A Sunday run couldn't be dated Sunday on Monday, so its hold capped the wrong week | On a Monday, yesterday is a choice (PROGRAM-QUESTIONS 62) |
| 58 | A new start date slid session moves onto other dates, including logged days | `rebaseMoves` in the same write as the date; dropped moves said in words; the phase-entered week rebased too; the date saves only on a tap (PROGRAM-QUESTIONS 61) |
| 59 | (verifier) Past week 12 the headline said "easy, by feel" above the engine's own tempo line | "distance by feel" when a hard effort is on |
| 60 | (verifier) A lift logged on a run day lost its summary link once Done meant the day's own session | The summary link follows any finished or abandoned lift |

Not fixed, logged: a run with Time left untouched saves 0 minutes (runs measure miles; low); the run logger's swap heading is still its own words rather than the rule's headline (cosmetic; the decision is the rule's).

## Findings, M4b (Nov 2, 2026)

Method: the same five-angle workflow (data integrity; rule fidelity and placement against Shawn's answers; the runner, Today and Where you train against the brief and design sections 4 and 5; security and robustness of typed text, routes and storage; edge cases across gyms, phases and the home gym), three skeptics per finding, two confirmations to survive. 20 reported, 19 survived. A rules fixer, then a screens fixer (who also took six loose ends the builders left), then an independent verifier who confirmed all 19 and re-ran the brief's browser drive: 93 of 93 checks at 390 and 375 px, with Planet Fitness's rows and week-2 cards identical to a fresh install's.

| # | Finding | Fix |
|---|---|---|
| 61 | One session at an away gym pinned a slot to an exercise the home gym lacks, so Planet Fitness read "Nothing here" | The slot runs the first exercise between the one it moved from and the history's pick that this gym has (PROGRAM-QUESTIONS 89) |
| 62 | A stair session in another slot brought B6 back before its own back-off was served (question 84) | The slot counts as moved only once this slot has run the easier version (PROGRAM-QUESTIONS 88) |
| 63 | A rack-capped hold after a back-off re-prescribed the load that backed off | The capped session stays the baseline (PROGRAM-QUESTIONS 90) |
| 64 | At a gym with no dumbbells, bodyweight-capable exercises asked for a dumbbell load that couldn't be logged | Bodyweight first sessions at rack 0 (PROGRAM-QUESTIONS 91) |
| 65 | Do it anyway or a Swap pick on dumbbell work at a gym with no dumbbells gave a set that could never be logged, with no undo | The card asks for the rack's weight or takes the pick back |
| 66 | Swap's "Here" on the exercise the plan runs did nothing when the rack held it off the card | Said in words; the pick follows the plan |
| 67 | A moved, swapped or backed-off slot showed cues written for the exercise it left | "Cues written for Leg press, both legs" whenever the exercise differs |
| 68 | A unilateral slot moved to a two-legged exercise never said "one leg at a time" | Said on the card |
| 69 | Today's moves came from a different rule than the plan, so Today and the runner disagreed | One rule (`gymChanges.ts`) for both |
| 70 | The runner's Change left Today on the old gym | Change sets the active gym too |
| 71 | A back-dated run swap stored today's active gym | The swap takes its own day's gym (re-fixed by the verifier when a tap carried across days) |
| 72 | A typed rack weight wasn't snapped to 5 lb | Snapped |
| 73 | Two gym names with no letters or digits counted as the same name; a name that shows nothing was accepted | Refused in its own sentence |
| 74 | Typed equipment had no length limit and no way to remove it | 80 characters, said in words; two-tap Remove |
| 75 | The name counter counted UTF-16 units, the schema code points | Code points both |
| 76 | The dumbbellMax guard missed destructuring in parameters | Broadened |
| 77 | (loose end) A rack-capped card said the cap twice; a rack-moved card said the move twice | Said once, by the engine's note |
| 78 | (loose end) Today's heading counted Nothing-here slots as moves; Finish listed a partly logged slot as not logged | "change"; "Not finished" |
| 79 | (verifier) Vitest's module cache let the guards pass with a new untested rule module | `fsModuleCache: false`; a test pins it |

Not fixed, logged: names that differ only by spacing count as different (question 92); the swap-gym note's wording after a tap. Not driven in a browser: Phase 2 and 3 card lines (covered by a live-seed helper test); WebKit (only Chromium is installed).

## Findings, M5 (Nov 2, 2026)

Method: the same five-angle workflow (gate and phase writes; rule fidelity in gates, symmetry and progress series; the Gates and Progress screens against the M5 brief and its chart rules; robustness of numeric entry and chart values; edge cases across phase advances, gyms and dates), three skeptics per finding, two confirmations to survive. A usage limit stopped the first run; it resumed from cache. 28 reported, 23 survived, then a rules fixer, a screens fixer and an independent verifier who confirmed all 23, fixed one regression, and drove Gates and Progress on the build with M4b at 390 and 375 px (68 of 68, plus the earlier drives adapted).

| # | Finding | Fix |
|---|---|---|
| 80 | Confirming a gate after the week's last lift made a finished week phase week 1, so every week band, plyo step and tempo came a week early | `phaseEntryWeek`: the phase is entered the week its first new-phase session can run |
| 81 | After a load test saved, the form went back to the session prefill with Save live, so a second tap wrote the prefill over the test (and, once the screen was left and reopened, the same) | The form reopens on the last saved test with Save waiting (PROGRAM-QUESTIONS 118) |
| 82 | The load prefill took rack-capped or bodyweight sessions at another gym, opening at a symmetry no test lifted | Only uncapped, loaded sessions prefill |
| 83 | The symmetry chart read 100% for rack-capped sessions, a 0 lb side against a load, a bodyweight side against a load, or different step heights | Those sessions are left out and the screen says which and why (PROGRAM-QUESTIONS 111, 112) |
| 84 | meetsSymmetry compared the rounded percent, so 89.96% passed a 90% line | Words and verdict use the same tenths rounded down (PROGRAM-QUESTIONS 110) |
| 85 | Advancing on a lift day hid that day's session (Today offered Start again); an open old-phase session would be planned on the new phase's bands | Advance waits while a session is open; Today keeps the day's own session |
| 86 | Gates said a reading "read hold" the morning after a session while Progress said there was none | One wording for a session awaiting its check |
| 87 | Gate 1's prefill exercise is never logged in Phase 1, yet the line said "yet" | Says the phase doesn't run it |
| 88 | The same-day tie-break for the latest gate test lived in a screen helper | `inWriteOrder` in the gate rule |
| 89 | Load-test fields showed 0 while the form said nothing was entered; a 0 lb prefill showed a percent but refused to save | Not entered reads as words; the two agree |
| 90 | Chart labels struck through by gridlines and lines; gate-line labels collided above 100% | Labels placed clear of marks and each other |
| 91 | A scroll starting on a chart changed its selected date; focusing the miles chart jumped to week 12 | Scrolls don't select; focus starts on this week |
| 92 | After "Yes, advance" focus fell to the page; hop-trial controls didn't name the side | Focus lands on the new phase's line; every control names its side |
| 93 | (after the review) The morning check's "Next Session C" after an advance planned the old phase's template | `nextTemplateFor`: the current phase's version of the letter |

Not fixed, logged: a session from an earlier phase still counts its phase weeks from the current phase's entered week (closed off by refusing an advance while a session is open; the full fix stores the phase week on the workout); Today's phase line above a session done in the old phase on the day of an advance (cosmetic).

## Findings, M6 (Nov 2, 2026)

Method: a loose-ends pass over the builders' leftovers first, then the same five-angle workflow (backup data integrity and Dexie versions; override and backup rule fidelity; the Program and Settings screens against the M6 brief; the import file and the Markdown renderer as untrusted input; edge cases across imports, phases and updates), three skeptics per finding, two confirmations to survive. 19 reported, 17 survived (three were one defect seen from three angles). A rules fixer, a screens fixer, then an independent verifier who confirmed all 17, fixed two regressions, and re-ran the round trip: 107 of 107 checks at 390 and 375 px, `npm run e2e` 16 of 16.

| # | Finding | Fix |
|---|---|---|
| 94 | An import over a phone with an active red flag cleared it without a note, and the confirm never said so | The flag stays on through an import unless the file's own clear carries a note; the confirm names it |
| 95 | Writing `lastExportedAt` into the strict Settings row broke every older build's settings read after the first export | The stamp lives in its own row; older builds keep reading settings (PROGRAM-QUESTIONS 132) |
| 96 | The whole-knee back-off skipped lower-body work an edited upper-body, core or carry slot ran | Lower body is read from the exercise run, not the slot |
| 97 | Catalog adds of another kind gave a step-up no step height, or an RDL in yards | `effectiveSlot` covers every kind; Add offers only exercises the slot can count or step |
| 98 | The editor said a back-off steps to "the first one"; the engine takes the next one here | Wording matches the engine |
| 99 | Remove's "Put it back" sat a screen above the tap and died with the editor; Done editing threw the slot off the top; a typed new cue was dropped by the view toggle or leaving | Put it back stands where the row was and outlives the editor; the slot stays in view; drafts wait in words and are let go only by Reset or an import |
| 100 | Import accepted a start date that isn't a Monday | Refused in words |
| 101 | An import refusal quoted Zod's message whole, widening Settings to 162,280 px | Refusals say what is wrong in words and wrap |
| 102 | An `exportedAt` in the future turned off the storage-eviction reminder until that date | A future stamp reads as never exported; the export line says the year when it differs |
| 103 | Tapping a Settings control during "Replacing…" wrote the old settings over the imported ones | Settings are locked while the import writes |
| 104 | Removing the exercise a slot was swapped to mid-session let a Nothing-here slot skip its hold | The swap falls back to the plan |
| 105 | `npm audit`'s 10 build-time advisories weren't explained | Explained in `docs/pwa-audit.md`; none ships in the bundle |
| 106 | (verifier) Gates promised a prefill no session could produce when an edit put a single-leg test exercise on a both-legs slot | Says so and asks for the test's loads (PROGRAM-QUESTIONS 134) |
| 107 | (verifier) Reset all data and an import kept the Program editor's unsaved drafts | Both let them go |

Rollback: after the first export M6 can be rolled back to M5 (the export stamp has its own row); an older build still opens a newer database: Dexie 4.4.7 retries a VersionError without a version and opens it with the older schema (checked Nov 6; PROGRAM-QUESTIONS 149). What stops an older build is its strict parse on write, and its refusal of a newer backup file, so builds are still treated as forward-only from M4b; the export file is the way back to any state.

Not fixed, logged: the import confirm doesn't name changes to the active gym, rest timer, pain logging or kit; a single-leg exercise swapped onto a both-legs slot logs once as both (PROGRAM-QUESTIONS 134, for Shawn); the per-screen error boundary is proven by a render test, since no forced bad row reaches it.

