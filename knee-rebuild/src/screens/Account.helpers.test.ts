import { describe, expect, it } from 'vitest'
import { SIGNED_IN_NOTE, SIGN_OUT_NOTE, accountView, codeProblem, redeemWords, roleWords, signOutWords } from './Account.helpers.ts'
import { CODE_FIXTURES } from '../../api/_codeFixtures.ts'

/** The one fixture table, shared with api/_code.test.ts (PROGRAM-QUESTIONS 213); test data only, never imported by app code. */
describe('codeProblem', () => {
  it('agrees with the server’s reading on every row: sends what it would read, says why for the rest', () => {
    for (const f of CODE_FIXTURES) {
      expect(codeProblem(f.input), f.input).toBe(f.client)
      expect(codeProblem(f.input) === null, f.input).toBe(f.norm !== null)
    }
  })
})

describe('roleWords', () => {
  it('says the role in words', () => {
    expect(roleWords('admin')).toBe('the admin')
    expect(roleWords('tester')).toBe('a tester')
  })
})

describe('accountView', () => {
  const alex = { configured: true, signedIn: true, name: 'Alex', role: 'tester' as const }
  it('is hidden when accounts aren’t set up here, or nothing is known', () => {
    expect(accountView({ answer: null, from: 'cache', online: true })).toEqual({ kind: 'hidden' })
    expect(accountView({ answer: null, from: 'cache', online: false })).toEqual({ kind: 'hidden' })
    expect(accountView({ answer: { configured: false, signedIn: false }, from: 'server', online: true })).toEqual({ kind: 'hidden' })
  })
  it('signed in: the name and role in words; a kept answer says when it is from', () => {
    expect(accountView({ answer: alex, from: 'server', online: true })).toEqual({ kind: 'signed-in', line: 'Signed in as Alex, a tester.', note: SIGNED_IN_NOTE, canSignOut: true })
    expect(accountView({ answer: { ...alex, name: 'Shawn', role: 'admin' }, from: 'cache', online: false })).toEqual({
      kind: 'signed-in',
      line: 'Signed in as Shawn, the admin.',
      note: `${SIGNED_IN_NOTE} As of the last time this phone was online.`,
      canSignOut: false,
    })
  })
  it('says truly what the account holds: the name, the role, and when the app last checked in', () => {
    expect(SIGNED_IN_NOTE).toBe('Your log still stays on this phone; the account holds your name, your role and when this app last checked in.')
    expect(SIGNED_IN_NOTE).not.toMatch(/only/)
  })
  it('signed out: the code field, which needs a connection', () => {
    expect(accountView({ answer: { configured: true, signedIn: false }, from: 'server', online: true })).toEqual({ kind: 'signed-out', canRedeem: true, note: null })
    expect(accountView({ answer: { configured: true, signedIn: false }, from: 'cache', online: false })).toEqual({ kind: 'signed-out', canRedeem: false, note: 'Redeeming a code needs a connection.' })
  })
  it('says when accounts are half set up or can’t be checked', () => {
    expect(accountView({ answer: { configured: true, signedIn: false, problem: 'setup' }, from: 'server', online: true })).toEqual({
      kind: 'note',
      line: 'Accounts are half set up on this deployment, so codes can’t be redeemed yet.',
    })
    expect(accountView({ answer: { configured: true, signedIn: false, problem: 'unavailable' }, from: 'server', online: true })).toEqual({ kind: 'note', line: 'The account check didn’t answer. Try again in a minute.' })
  })
})

describe('redeemWords', () => {
  it('says why a code didn’t sign in, in words', () => {
    expect(redeemWords({ ok: true, answer: { configured: true, signedIn: true, name: 'A', role: 'tester' } })).toBeNull()
    expect(redeemWords({ ok: false, status: 401 })).toBe('That code didn’t work. Check each character and try again.')
    expect(redeemWords({ ok: false, status: 429 })).toBe('Too many tries. Wait 15 minutes, then try again.')
    expect(redeemWords({ ok: false, status: 503, problem: 'setup' })).toBe('Accounts are half set up on this deployment, so codes can’t be redeemed yet.')
    expect(redeemWords({ ok: false, status: 503, problem: 'unavailable' })).toBe('The account check didn’t answer. Try again in a minute.')
    expect(redeemWords({ ok: false, status: 'network' })).toBe('Couldn’t reach the app’s server. Check the connection and try again.')
    expect(redeemWords({ ok: false, status: 503 })).toBe('The server answered 503. Try again in a minute.')
  })
})

describe('signOutWords', () => {
  it('says what Sign out did, Strava included', () => {
    expect(signOutWords({ ok: true, strava: 'none' })).toBe('Signed out on this phone.')
    expect(signOutWords({ ok: true, strava: 'revoked' })).toBe(
      'Signed out on this phone, and Strava was disconnected for every phone and browser this account uses: connect it again in each one that needs it.',
    )
    expect(signOutWords({ ok: true, strava: 'not-confirmed' })).toContain('Strava, Settings, My Apps')
    expect(signOutWords({ ok: false })).toContain('still signed in')
  })
})

describe('SIGN_OUT_NOTE', () => {
  it('says Strava is disconnected everywhere, not just here: Strava’s revoke takes every token this app holds for the athlete', () => {
    expect(SIGN_OUT_NOTE).toBe(
      'Signing out disconnects Strava at Strava, for every phone and browser this account uses: Safari and the home-screen app both lose it, and each connects again after signing back in. Your log is untouched, and Reset all data doesn’t sign you out.',
    )
    expect(SIGN_OUT_NOTE).not.toMatch(/in this app/)
  })
})
