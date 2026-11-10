import { isLateEntry } from './retro.ts'
import type { IsoDate, SetLog, Workout } from '../schema/index.ts'

/*
 * Tester mode (M-U3; Shawn's Nov 8 decision, PROGRAM-QUESTIONS 223 and 224): whether this phone runs
 * the prescription engine ('full') or only shows the program as written and logs ('tester'). Testers
 * test the software, not the program: the app never computes a load, a reading, a gate verdict or a
 * red-flag takeover from a tester's logs. This is the one decision; every view helper and the
 * session planner take its answer and, in tester mode, never call the engine at all
 * (src/rules/engineMode.guard.test.ts). Derived each render, never stored.
 *
 * The input is the account answer the phone last kept (`knee-rebuild:account`, written by
 * src/app/account.ts from the app's own account check), shaped here because a rule imports nothing from
 * src/app, plus one fact about the phone's own log. Failing safe without stranding Shawn:
 *
 * 1. No kept answer (never fetched, unreadable, storage blocked), or one that carries a problem:
 *    full only when the phone holds writes from before accounts existed (`preAccountsLog`), else
 *    tester until one successful check. Shawn's phone, updated and offline at the gym, keeps the
 *    engine; a stranger whose first check failed never gets it.
 * 2. Accounts not configured on this deployment: full.
 * 3. Accounts configured and signed out: tester (a stranger or a signed-out tester).
 * 4. Signed in as admin: full.
 * 5. Anything else, a tester or a role this build doesn't know: tester.
 *
 * A product mitigation, not a security boundary: local storage is editable, and the next online
 * check overwrites what was edited.
 */

/** The phone's kept account answer, as this rule reads it. */
export interface KeptAccount {
  configured: boolean
  signedIn: boolean
  role?: 'admin' | 'tester'
  problem?: string
}

export type EngineMode = 'full' | 'tester'
export type ModeReason = 'accounts-off' | 'admin' | 'tester' | 'signed-out' | 'pre-accounts' | 'unconfirmed'
export interface EngineModeState {
  mode: EngineMode
  reason: ModeReason
}

/**
 * Write stamps dated before this day can only come from Shawn's own phone from before accounts, or a
 * backup of it: no tester install ships before M-U3 (the standing gate in section 5 of
 * docs/multiuser-and-release-plan.md). Compared on the UTC date, the stamp's first ten characters.
 */
export const PRE_ACCOUNTS_BEFORE: IsoDate = '2026-11-10'

/** The mode for a kept answer (null: none kept) and whether the phone holds pre-accounts writes. */
export function engineMode(kept: KeptAccount | null, preAccounts: boolean): EngineModeState {
  if (kept === null || kept.problem !== undefined) return preAccounts ? { mode: 'full', reason: 'pre-accounts' } : { mode: 'tester', reason: 'unconfirmed' }
  if (!kept.configured) return { mode: 'full', reason: 'accounts-off' }
  if (!kept.signedIn) return { mode: 'tester', reason: 'signed-out' }
  if (kept.role === 'admin') return { mode: 'full', reason: 'admin' }
  return { mode: 'tester', reason: 'tester' }
}

const before = (stamp: string | undefined): boolean => typeof stamp === 'string' && stamp.length >= 10 && stamp.slice(0, 10) < PRE_ACCOUNTS_BEFORE

/**
 * Whether the log holds a real write from before accounts existed: a set's `loggedAt` (stamped when
 * the set was logged, kept on an edit), or a live session's `startedAt`. A late entry's `startedAt`
 * is a marker made from the day it is for, which can be backdated, so it never counts; morning
 * checks, runs and settings carry no write stamp and never count.
 */
export function preAccountsLog(input: { setLogs: readonly Pick<SetLog, 'loggedAt'>[]; workouts: readonly Pick<Workout, 'date' | 'startedAt'>[] }): boolean {
  return input.setLogs.some((s) => before(s.loggedAt)) || input.workouts.some((w) => !isLateEntry(w) && before(w.startedAt))
}
