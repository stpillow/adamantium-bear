# Performance metrics and photo import: the plan

Decided with Shawn on Nov 6, 2026, one question at a time. Each phase lands as its own PR and is merged once green. Phases 1 and 2 are built (Nov 6 and 7); the rest is not.

## Decisions

| Question | Answer |
|---|---|
| Run effort | RPE 1–10 on runs, the scale the lift sets already use. Older runs' words read as easy 3, moderate 5, hard 8. |
| What metrics may do | Trends on Progress, plus warnings in words. They change no prescription unless a rule is later written into the program. |
| Heart rate source | A watch with HR, synced to Strava: average and max HR come from the Strava import, typed or photo entry as the fallback. |
| HR-based load | Yes, alongside RPE load. Shawn enters max and resting HR in Settings. |
| VO2 max | Typed in from the watch whenever it changes; the app keeps the history and the trend. |
| Photo reader | Claude vision through a second Vercel function; the photo is sent once and not stored. |
| What a photo can log | Runs, elliptical and rowing first; then strength sessions from a notebook or whiteboard; then cycling and other cross-training. |
| Cross-training | Counts toward load only: a pain rating and a morning-check reading like any session, never run miles or the mileage cap. |
| Strava screenshots | Allowed: his own data. |
| Keeping the photo | Only the confirmed numbers are kept. |
| Other users | Just Shawn for now. |

## Metrics, defined

- **Session load (sRPE):** RPE × minutes. A lift's RPE is the session's (asked at Finish, defaulting to the average of its sets); a run's is the run's.
- **HR load (TRIMP, Banister):** minutes × HRr × 0.64·e^(1.92·HRr), with HRr = (avg HR − resting) / (max − resting). Only when the session has an average HR and Settings have both numbers.
- **Weekly load and the warning:** the last 7 days' load against the average week of the 28 days before (acute:chronic). Above 1.5 shows "This week's load is 1.6× your recent average" in words; below 0.8 notes a drop. A warning only. As built, the 7 days end yesterday and the words say so (PROGRAM-QUESTIONS 148).
- **VO2 max:** dated readings as typed; the trend is the readings, nothing estimated.

## Phases

| Phase | Builds | Data change |
|---|---|---|
| 1 · **built** | RPE 1–10 on the run logger; session RPE and minutes at a lift's Finish (minutes on End too); training load per session; weekly training load and the warning on Progress; `src/rules/trainingLoad.ts` ("load" already means weight lifted on Progress). As built: PROGRAM-QUESTIONS 143 to 149 | Run gains optional `rpe`; Workout gains optional `sessionRpe` and `durationMinutes` (Dexie v6 with no store change, backup schema 6 with a 5→6 step) |
| 2 · **built** | Average and max HR on runs, from the Strava import (the function stops dropping them), typed, or later a photo; max and resting HR in Settings; HR load beside RPE load. As built: PROGRAM-QUESTIONS 150 to 152 | Run gains optional `avgHr`, `maxHr`; the two Settings numbers live in a one-row `hrSettings` table (Dexie v7, backup schema 7 with a 6→7 step), so older builds still read the settings row untouched — amended from “their own row of the settings table”, PROGRAM-QUESTIONS 150 |
| 3 | VO2 max readings typed in; trend on Progress | New `vo2Readings` table (Dexie v8: phase 2 shipped v7 without it) |
| 4 | Photo → run, elliptical or rowing: `api/photo.ts` sends the image to Claude with a strict JSON schema; the run logger opens filled in; pain still rated by hand | None (fills the existing form). Needs `ANTHROPIC_API_KEY` in Vercel, a monthly spend cap on the key, and a per-day request cap in the function |
| 5 | Photo → strength session: sets, reps and loads matched to that day's slots by the catalog's names; each set confirmed in the runner's after-the-fact mode | None beyond phase 1 |
| 6 | Cycling and cross-training: a new activity (type, minutes, RPE, HR, pain) that counts toward load and readings, never miles; photo and Strava (Ride, Swim, Hike…) map onto it | New `crossTraining` table; the morning check can read one; PROGRAM-QUESTIONS entry for how it reads |

## Barriers to flag now

- **Anthropic API key and cost.** About a cent or two per photo; the key lives only in Vercel. A spend cap on the key and a daily cap in the function keep a runaway loop cheap.
- **Strava's AI terms vs Strava data.** Strava-imported numbers (HR included) must never be sent to Claude. Photo reading only ever sees the photo Shawn takes; his decision is that a screenshot of his own Strava screen is his to read.
- **The function's photo route is public**, like the Strava one. It needs the same protection: a signed, HttpOnly cookie set when the app is opened from the home-screen install, or a short shared code in Settings, so strangers can't spend the key.
- **Schema v6** makes backups from this version unreadable to older builds (the existing forward-only rule). Each phase's fields are optional, so older rows still read.
- **Load from late entries.** A session logged after the fact adds to load like any other; the warning reads the dates, not when it was entered.
