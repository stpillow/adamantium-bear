import { describe, expect, it } from 'vitest'
import { PRE_ACCOUNTS_BEFORE, engineMode, preAccountsLog } from './engineMode.ts'
import { lateStartedAt } from './retro.ts'

describe('engineMode: every kept account state (PROGRAM-QUESTIONS 224)', () => {
  it('accounts off on this deployment: full, whatever the log', () => {
    expect(engineMode({ configured: false, signedIn: false }, false)).toEqual({ mode: 'full', reason: 'accounts-off' })
    expect(engineMode({ configured: false, signedIn: false }, true)).toEqual({ mode: 'full', reason: 'accounts-off' })
  })
  it('signed in as the admin: full', () => {
    expect(engineMode({ configured: true, signedIn: true, role: 'admin' }, false)).toEqual({ mode: 'full', reason: 'admin' })
  })
  it('signed in as a tester: tester, even on a phone with pre-accounts writes', () => {
    expect(engineMode({ configured: true, signedIn: true, role: 'tester' }, false)).toEqual({ mode: 'tester', reason: 'tester' })
    expect(engineMode({ configured: true, signedIn: true, role: 'tester' }, true)).toEqual({ mode: 'tester', reason: 'tester' })
  })
  it('accounts on and signed out (what sign-out keeps): tester', () => {
    expect(engineMode({ configured: true, signedIn: false }, false)).toEqual({ mode: 'tester', reason: 'signed-out' })
    expect(engineMode({ configured: true, signedIn: false }, true)).toEqual({ mode: 'tester', reason: 'signed-out' })
  })
  it('nothing kept: full only with pre-accounts writes, else tester until one successful check', () => {
    expect(engineMode(null, true)).toEqual({ mode: 'full', reason: 'pre-accounts' })
    expect(engineMode(null, false)).toEqual({ mode: 'tester', reason: 'unconfirmed' })
  })
  it('a kept answer carrying a problem counts as no answer', () => {
    expect(engineMode({ configured: true, signedIn: false, problem: 'unavailable' }, false)).toEqual({ mode: 'tester', reason: 'unconfirmed' })
    expect(engineMode({ configured: false, signedIn: false, problem: 'setup' }, true)).toEqual({ mode: 'full', reason: 'pre-accounts' })
    expect(engineMode({ configured: false, signedIn: false, problem: 'setup' }, false)).toEqual({ mode: 'tester', reason: 'unconfirmed' })
  })
  it('a role this build doesn’t know reads as a tester', () => {
    expect(engineMode({ configured: true, signedIn: true, role: 'owner' as never }, true)).toEqual({ mode: 'tester', reason: 'tester' })
    expect(engineMode({ configured: true, signedIn: true }, true)).toEqual({ mode: 'tester', reason: 'tester' })
  })
})

describe('preAccountsLog: real write stamps before Nov 10, 2026', () => {
  const none = { setLogs: [], workouts: [] }
  it('the cutoff is Nov 10, 2026, on the UTC date', () => {
    expect(PRE_ACCOUNTS_BEFORE).toBe('2026-11-10')
    expect(preAccountsLog({ ...none, setLogs: [{ loggedAt: '2026-11-09T23:59:59.999Z' }] })).toBe(true)
    expect(preAccountsLog({ ...none, setLogs: [{ loggedAt: '2026-11-10T00:00:00.000Z' }] })).toBe(false)
  })
  it('an empty log, or sets with no stamp, are not pre-accounts', () => {
    expect(preAccountsLog(none)).toBe(false)
    expect(preAccountsLog({ ...none, setLogs: [{}, { loggedAt: undefined }] })).toBe(false)
    expect(preAccountsLog({ ...none, workouts: [{ date: '2026-11-03' }] })).toBe(false)
  })
  it('a live session started before the cutoff counts', () => {
    expect(preAccountsLog({ ...none, workouts: [{ date: '2026-11-03', startedAt: '2026-11-03T22:00:00.000Z' }] })).toBe(true)
    expect(preAccountsLog({ ...none, workouts: [{ date: '2026-11-12', startedAt: '2026-11-12T22:00:00.000Z' }] })).toBe(false)
  })
  it('a late entry’s marker never counts: it is made from the day it is for, and can be backdated', () => {
    expect(preAccountsLog({ ...none, workouts: [{ date: '2026-11-03', startedAt: lateStartedAt('2026-11-03') }] })).toBe(false)
  })
  it('an imported old set counts: the known hole, pinned so it is deliberate (PROGRAM-QUESTIONS 224)', () => {
    expect(preAccountsLog({ setLogs: [{ loggedAt: '2026-11-03T22:15:00.000Z' }], workouts: [{ date: '2026-11-03', startedAt: lateStartedAt('2026-11-03') }] })).toBe(true)
  })
  it('a stamp too short to carry a date is ignored', () => {
    expect(preAccountsLog({ ...none, setLogs: [{ loggedAt: '2026' }] })).toBe(false)
  })
})
