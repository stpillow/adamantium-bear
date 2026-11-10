import { describe, expect, it } from 'vitest'
import type { MorningCheck } from '../schema/index.ts'
import { NO_RED_FLAG, afterMorningCheck, clearRedFlag, foldTodaysChecks, lateFlagNote, lateFlagNotes, progressionSuspended, stopMessage } from './redFlags.ts'

const check = (redFlags: string[], date = '2026-11-04'): MorningCheck => ({
  id: 'm1', date, appliesTo: null, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags,
})
const catalog = [{ id: 'locking', text: 'Locking or catching: a mechanical block to straightening or bending' }, { id: 'numbness', text: 'Numbness or tingling below the knee' }]

describe('red-flag state (rule 9)', () => {
  it("folds today's flagged check into the state when it wasn't applied (saved in tester mode), and nothing else", () => {
    const today = '2026-11-04'
    const flagged = check(['locking'], today)
    expect(foldTodaysChecks(NO_RED_FLAG, [flagged], today)).toEqual({ active: true, since: today, items: ['locking'] })
    // Already applied: the same object, so nothing is written again.
    const on = afterMorningCheck(NO_RED_FLAG, flagged)
    expect(foldTodaysChecks(on, [flagged], today)).toBe(on)
    // Cleared today, with a note: the clear stands.
    const off = clearRedFlag(on, 'PT saw it this morning', today)
    expect(foldTodaysChecks(off, [flagged], today)).toBe(off)
    // Cleared on an earlier day: today's flag turns it back on.
    const earlier = { active: false, items: [], clearedOn: '2026-11-03', clearNote: 'fine' }
    expect(foldTodaysChecks(earlier, [flagged], today)).toEqual({ active: true, since: today, items: ['locking'] })
    // Another day's check, a check logged late, or a check with nothing ticked: unchanged.
    expect(foldTodaysChecks(NO_RED_FLAG, [check(['locking'], '2026-11-03')], today)).toBe(NO_RED_FLAG)
    expect(foldTodaysChecks(NO_RED_FLAG, [{ ...check(['locking'], '2026-11-03'), loggedOn: today }], today)).toBe(NO_RED_FLAG)
    expect(foldTodaysChecks(NO_RED_FLAG, [check([], today)], today)).toBe(NO_RED_FLAG)
    // New items on an active state are added.
    expect(foldTodaysChecks(on, [check(['locking', 'numbness'], today)], today)).toEqual({ active: true, since: today, items: ['locking', 'numbness'] })
  })

  it('any ticked flag turns the state on and suspends progression', () => {
    const state = afterMorningCheck(NO_RED_FLAG, check(['locking']))
    expect(state).toEqual({ active: true, since: '2026-11-04', items: ['locking'] })
    expect(progressionSuspended(state)).toBe(true)
    expect(stopMessage(state, catalog)).toEqual({ headline: 'Stop. Call the ortho or PT.', items: [catalog[0]?.text] })
  })
  it('a clean check does not clear it; later flags accumulate', () => {
    const on = afterMorningCheck(NO_RED_FLAG, check(['locking']))
    expect(afterMorningCheck(on, check([], '2026-11-05'))).toEqual(on)
    expect(afterMorningCheck(on, check(['numbness'], '2026-11-06'))).toEqual({ active: true, since: '2026-11-04', items: ['locking', 'numbness'] })
  })
  it('clearing needs a note and records it', () => {
    const on = afterMorningCheck(NO_RED_FLAG, check(['locking']))
    expect(() => clearRedFlag(on, '   ', '2026-11-07')).toThrow()
    const off = clearRedFlag(on, 'PT saw it Nov 6: no mechanical block, cleared to train', '2026-11-07')
    expect(off).toEqual({ active: false, items: [], clearedOn: '2026-11-07', clearNote: 'PT saw it Nov 6: no mechanical block, cleared to train' })
    expect(progressionSuspended(off)).toBe(false)
    expect(stopMessage(off, catalog)).toBeNull()
  })
})

describe('a red flag on a check logged late is a note, never the stop (Batch D, decision 12; PROGRAM-QUESTIONS 175)', () => {
  const late = (redFlags: string[], date = '2026-11-18', loggedOn = '2026-11-20'): MorningCheck => ({ ...check(redFlags, date), id: `mc-${date}`, loggedOn })
  it('leaves the state as it was, the same object, and suspends nothing', () => {
    const state = afterMorningCheck(NO_RED_FLAG, late(['locking']))
    expect(state).toBe(NO_RED_FLAG)
    expect(progressionSuspended(state)).toBe(false)
    expect(stopMessage(state, catalog)).toBeNull()
    // An active state stays exactly as it was: a late flag neither adds to it nor clears it.
    const on = afterMorningCheck(NO_RED_FLAG, check(['numbness']))
    expect(afterMorningCheck(on, late(['locking']))).toBe(on)
  })
  it('a check saved the morning it describes still takes over', () => {
    expect(afterMorningCheck(NO_RED_FLAG, check(['locking'], '2026-11-20'))).toEqual({ active: true, since: '2026-11-20', items: ['locking'] })
  })
  it('notes each late flagged check in the program’s words; none for a late check with no flag or an on-time one', () => {
    expect(lateFlagNote(late(['locking']), catalog)).toEqual({ date: '2026-11-18', savedOn: '2026-11-20', items: [catalog[0]?.text] })
    expect(lateFlagNote(late([]), catalog)).toBeNull()
    expect(lateFlagNote(check(['locking']), catalog)).toBeNull()
    expect(lateFlagNote(late(['mystery']), catalog)?.items).toEqual(['mystery'])
  })
  it('lists the notes whose morning is within the last 14 days, oldest first', () => {
    const checks = [late(['numbness'], '2026-11-18', '2026-11-20'), late(['locking'], '2026-11-10', '2026-11-12'), late([], '2026-11-11', '2026-11-12'), check(['locking'], '2026-11-19')]
    expect(lateFlagNotes(checks, '2026-11-20', catalog).map((n) => n.date)).toEqual(['2026-11-10', '2026-11-18'])
    // Nov 18 shows through Dec 2 (today - 14) and is gone on Dec 3.
    expect(lateFlagNotes(checks, '2026-12-02', catalog).map((n) => n.date)).toEqual(['2026-11-18'])
    expect(lateFlagNotes(checks, '2026-12-03', catalog)).toEqual([])
  })
})
