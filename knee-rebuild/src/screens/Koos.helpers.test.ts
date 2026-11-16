import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { SWAP_KEY_PREFIX } from '../db/repo.ts'
import { KOOS_SUBSCALES, KOOS_SUBSCALE_ITEMS, koosSubscaleScore } from '../rules/koos.ts'
import { KoosEntry } from '../schema/index.ts'
import {
  KOOS_DRAFT_PREFIX,
  KOOS_FORM_SECTIONS,
  KOOS_LEAD,
  KOOS_QUESTIONS,
  buildKoosEntry,
  cleanKoosDraft,
  clearKoosDraft,
  dropOtherKoosDrafts,
  koosAnsweredCount,
  koosEntryRows,
  koosFormBlocker,
  koosReplaceLine,
  koosSaveSummary,
  readKoosDraft,
  withKoosAnswer,
  writeKoosDraft,
  type DraftStore,
} from './Koos.helpers.ts'

/** A plain in-memory Storage slice. */
function fakeStore(seed: Record<string, string> = {}): DraftStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed))
  return {
    map,
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

describe('the transcribed form (official English KOOS LK1.0)', () => {
  it('carries all 42 questions, once each, matching the scoring map’s fields, grouped as the form groups them', () => {
    expect(KOOS_QUESTIONS).toHaveLength(42)
    expect(new Set(KOOS_QUESTIONS.map((q) => q.field)).size).toBe(42)
    const scoringFields = KOOS_SUBSCALES.flatMap((s) => KOOS_SUBSCALE_ITEMS[s])
    expect([...new Set(KOOS_QUESTIONS.map((q) => q.field))].sort()).toEqual([...scoringFields].sort())
    // Every section's questions feed the subscale the section names; the stiffness block feeds Symptoms.
    for (const section of KOOS_FORM_SECTIONS) {
      for (const question of section.questions) {
        expect(KOOS_SUBSCALE_ITEMS[section.subscale], `${question.label} in ${section.name || section.instruction}`).toContain(question.field)
      }
    }
    expect(KOOS_FORM_SECTIONS.find((s) => s.name === 'Stiffness')?.subscale).toBe('symptoms')
  })

  it('pins the published anchor directions: S4/S5 run Always→Never, P1 and Q1 carry frequency anchors, each option still scoring 0 to 4 left to right', () => {
    const by = Object.fromEntries(KOOS_QUESTIONS.map((q) => [q.label, q]))
    expect(by.S1?.options).toEqual(['Never', 'Rarely', 'Sometimes', 'Often', 'Always'])
    expect(by.S2?.text).toBe('Do you feel grinding, hear clicking or any other type of noise when your knee moves?')
    expect(by.S4?.options).toEqual(['Always', 'Often', 'Sometimes', 'Rarely', 'Never'])
    expect(by.S5?.options).toEqual(['Always', 'Often', 'Sometimes', 'Rarely', 'Never'])
    expect(by.P1?.options).toEqual(['Never', 'Monthly', 'Weekly', 'Daily', 'Always'])
    expect(by.P2?.options).toEqual(['None', 'Mild', 'Moderate', 'Severe', 'Extreme'])
    expect(by.A12?.text).toBe('Lying in bed (turning over, maintaining knee position)')
    expect(by.A16?.text).toBe('Heavy domestic duties (moving heavy boxes, scrubbing floors, etc)')
    expect(by.A17?.text).toBe('Light domestic duties (cooking, dusting, etc)')
    expect(by.Q1?.options).toEqual(['Never', 'Monthly', 'Weekly', 'Daily', 'Constantly'])
    expect(by.Q2?.options).toEqual(['Not at all', 'Mildly', 'Moderately', 'Severely', 'Totally'])
    expect(by.Q3?.options).toEqual(['Not at all', 'Mildly', 'Moderately', 'Severely', 'Extremely'])
    expect(KOOS_LEAD).toContain('last week')
  })
})

describe('answers, the blocker and the Save summary', () => {
  it('tapping an option answers it; tapping the ticked option again clears it back to skipped', () => {
    let answers = withKoosAnswer({}, 'p1', 2)
    expect(answers).toEqual({ p1: 2 })
    answers = withKoosAnswer(answers, 'p1', 3)
    expect(answers).toEqual({ p1: 3 })
    answers = withKoosAnswer(answers, 'p1', 3)
    expect(answers).toEqual({})
    expect(koosAnsweredCount({ p1: 0, q4: 4 })).toBe(2)
  })

  it('Save waits only on an empty form, in words: skips are allowed, the missing-data rule absorbs them', () => {
    expect(koosFormBlocker({})).toBe('Answer at least one question to save')
    expect(koosFormBlocker({ sp3: 2 })).toBeNull()
  })

  it('says per subscale which will score and which has too few answers, before anything is saved', () => {
    const answers = { p1: 1, p2: 1, p3: 1, p4: 1, p5: 1, sp1: 2, sp2: 2, q1: 0, q2: 0 }
    expect(koosSaveSummary(answers)).toEqual([
      'Pain will score (5 of 9 answered).',
      'Symptoms won’t score (0 of 7 answered — it needs 4).',
      'Daily living won’t score (0 of 17 answered — it needs 9).',
      'Sport and recreation won’t score (2 of 5 answered — it needs 3).',
      'Quality of life will score (2 of 4 answered).',
    ])
  })

  it('builds today’s entry from the answered boxes alone, and the entry parses and scores as the rules read it', () => {
    const entry = buildKoosEntry({ p1: 1, p2: 1, p3: 2, p4: 2, p5: 4, q1: 2, q2: 2 }, '2026-11-08')
    expect(entry).toEqual({ date: '2026-11-08', p1: 1, p2: 1, p3: 2, p4: 2, p5: 4, q1: 2, q2: 2 })
    expect(KoosEntry.safeParse(entry).success).toBe(true)
    expect(koosSubscaleScore(entry, 'pain')).toBe(50)
    expect(koosSubscaleScore(entry, 'qol')).toBe(50)
    expect(koosSubscaleScore(entry, 'sport')).toBeNull()
  })

  it('says when saving replaces today’s entry, and lists stored entries newest first with how much was answered', () => {
    const nov = buildKoosEntry({ p1: 1 }, '2026-11-08')
    expect(koosReplaceLine([nov], '2026-11-08')).toBe('Today already has an entry. Saving replaces it.')
    expect(koosReplaceLine([nov], '2026-11-09')).toBeNull()
    const oct = buildKoosEntry({ p1: 1, p2: 2, q1: 1 }, '2026-10-11')
    expect(koosEntryRows([oct, nov])).toEqual([
      { date: '2026-11-08', words: 'Sunday Nov 8 — 1 of 42 answered; scores on Progress' },
      { date: '2026-10-11', words: 'Sunday Oct 11 — 3 of 42 answered; scores on Progress' },
    ])
  })
})

describe('the resumable draft (PROGRAM-QUESTIONS 158)', () => {
  it('lives under the runner’s swap prefix, so Reset all data and an import clear it with forgetSwaps', () => {
    expect(KOOS_DRAFT_PREFIX.startsWith(SWAP_KEY_PREFIX)).toBe(true)
  })

  it('round-trips the answers per date, written on every answer and gone once the form empties', () => {
    const store = fakeStore()
    writeKoosDraft(store, '2026-11-08', { p1: 2, sy4: 1 })
    expect(readKoosDraft(store, '2026-11-08')).toEqual({ p1: 2, sy4: 1 })
    expect(readKoosDraft(store, '2026-11-09')).toEqual({})
    writeKoosDraft(store, '2026-11-08', {})
    expect(store.map.size).toBe(0)
  })

  it('reads a stored draft defensively: unknown fields and out-of-range values are dropped, never guessed', () => {
    expect(cleanKoosDraft({ p1: 2, nope: 3, sy1: 9, sy2: 1.5, a1: 0 })).toEqual({ p1: 2, a1: 0 })
    expect(cleanKoosDraft(null)).toEqual({})
    expect(cleanKoosDraft([1, 2])).toEqual({})
    const store = fakeStore({ [`${KOOS_DRAFT_PREFIX}2026-11-08`]: 'not json' })
    expect(readKoosDraft(store, '2026-11-08')).toEqual({})
  })

  it('a stale draft for a past date is dropped on open; today’s stays; Save clears today’s', () => {
    const store = fakeStore({
      [`${KOOS_DRAFT_PREFIX}2026-10-11`]: '{"p1":1}',
      [`${KOOS_DRAFT_PREFIX}2026-11-08`]: '{"p1":2}',
      'other-app:key': 'kept',
    })
    dropOtherKoosDrafts(store, '2026-11-08')
    expect([...store.map.keys()].sort()).toEqual([`${KOOS_DRAFT_PREFIX}2026-11-08`, 'other-app:key'])
    clearKoosDraft(store, '2026-11-08')
    expect([...store.map.keys()]).toEqual(['other-app:key'])
  })
})
