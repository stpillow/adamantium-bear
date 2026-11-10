import type { AccountState, RedeemResult, Role, SignOutResult } from '../app/account.ts'

/*
 * What Settings' Account section shows and says (M-U2; PROGRAM-QUESTIONS 220, 222). Pure: the
 * section renders whatever these return. The role is shown in words and decides nothing in this build.
 */

/** The symbols a code is made of (Crockford base32: no I, L, O or U); the same as api/_code.ts's. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** The code as the server will read it: the same normalising as api/_code.ts, pinned to it by the one fixture table both tests import (api/_codeFixtures.ts). */
function normalised(text: string): string {
  return text
    .toUpperCase()
    .replace(/[\s_-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
}

/** What's wrong with a typed code before it is sent, or null. The phone doesn't check the check symbol; the server does. */
export function codeProblem(text: string): string | null {
  const s = normalised(text)
  if (s === '') return 'Type the code first.'
  if ([...s].some((c) => !ALPHABET.includes(c))) return 'A code has only letters and numbers, and never the letter U.'
  if (s.length !== 16) return `A code is 16 letters and numbers; that was ${s.length}.`
  return null
}

export function roleWords(role: Role): string {
  return role === 'admin' ? 'the admin' : 'a tester'
}

export const SIGNED_OUT_LEAD = 'Have an invite code?'
export const SIGNED_OUT_NOTE =
  'An account is for testers and for Strava; everything you log stays on this phone either way. On iPhone the home-screen app and Safari sign in separately, so type the code in each one you use.'
export const SIGNED_IN_NOTE = 'Your log still stays on this phone; the account holds your name, your role and when this app last checked in.'
/** Strava's revoke (oauth/deauthorize) takes every token this app holds for the athlete, so signing out in Safari disconnects the home-screen app too. */
export const SIGN_OUT_NOTE =
  'Signing out disconnects Strava at Strava, for every phone and browser this account uses: Safari and the home-screen app both lose it, and each connects again after signing back in. Your log is untouched, and Reset all data doesn’t sign you out.'
const FROM_CACHE = ' As of the last time this phone was online.'
const SETUP_LINE = 'Accounts are half set up on this deployment, so codes can’t be redeemed yet.'
const UNAVAILABLE_LINE = 'The account check didn’t answer. Try again in a minute.'
const OFFLINE_REDEEM = 'Redeeming a code needs a connection.'

export type AccountView =
  | { kind: 'hidden' }
  | { kind: 'note'; line: string }
  | { kind: 'signed-out'; canRedeem: boolean; note: string | null }
  | { kind: 'signed-in'; line: string; note: string; canSignOut: boolean }

/**
 * What the section shows. Hidden when this deployment has no accounts, or nothing is known yet (so a
 * phone on a deployment without accounts, Shawn's today, sees nothing new). A kept answer says so.
 */
export function accountView(state: AccountState): AccountView {
  const { answer, from, online } = state
  if (answer === null || !answer.configured) return { kind: 'hidden' }
  if (answer.problem === 'setup') return { kind: 'note', line: SETUP_LINE }
  if (answer.problem === 'unavailable') return { kind: 'note', line: UNAVAILABLE_LINE }
  if (answer.signedIn && answer.name && answer.role) {
    return { kind: 'signed-in', line: `Signed in as ${answer.name}, ${roleWords(answer.role)}.`, note: from === 'cache' ? SIGNED_IN_NOTE + FROM_CACHE : SIGNED_IN_NOTE, canSignOut: online }
  }
  return { kind: 'signed-out', canRedeem: online, note: online ? null : OFFLINE_REDEEM }
}

/** Why a Redeem didn't sign in, in words. */
export function redeemWords(result: RedeemResult): string | null {
  if (result.ok) return null
  if (result.status === 'network') return 'Couldn’t reach the app’s server. Check the connection and try again.'
  if (result.problem === 'setup') return SETUP_LINE
  if (result.problem === 'unavailable') return UNAVAILABLE_LINE
  if (result.status === 401) return 'That code didn’t work. Check each character and try again.'
  if (result.status === 429) return 'Too many tries. Wait 15 minutes, then try again.'
  return `The server answered ${result.status}. Try again in a minute.`
}

/** What Sign out came to, in words. */
export function signOutWords(result: SignOutResult): string {
  if (!result.ok) return 'Couldn’t reach the app’s server, so this phone is still signed in. Try again with a connection.'
  switch (result.strava) {
    case 'none':
      return 'Signed out on this phone.'
    case 'revoked':
      return 'Signed out on this phone, and Strava was disconnected for every phone and browser this account uses: connect it again in each one that needs it.'
    case 'not-confirmed':
      return 'Signed out on this phone. Strava didn’t confirm the disconnect: to be sure, remove the app under Strava, Settings, My Apps.'
  }
}
