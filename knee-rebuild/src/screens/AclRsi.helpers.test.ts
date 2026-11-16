import { describe, expect, it } from 'vitest'
import { ACL_RSI_ITEM_FIELDS } from '../rules/aclRsi.ts'
import type { AclRsiEntry } from '../schema/index.ts'
import {
  ACL_RSI_ITEMS,
  ACL_RSI_LEAD,
  aclRsiBlocker,
  aclRsiReplaceLine,
  aclRsiRows,
  aclRsiUnanswered,
  anchorWords,
  buildAclRsiEntry,
  emptyAclRsiAnswers,
  withAclRsiAnswer,
  ACL_RSI_DRAFT_PREFIX,
  cleanAclRsiDraft,
  clearAclRsiDraft,
  dropOtherAclRsiDrafts,
  readAclRsiDraft,
  writeAclRsiDraft,
} from './AclRsi.helpers.ts'
import { SWAP_KEY_PREFIX } from '../db/repo.ts'

const entry = (date: string, value: number): AclRsiEntry => ({ date, ...(Object.fromEntries(ACL_RSI_ITEM_FIELDS.map((f) => [f, value])) as Omit<AclRsiEntry, 'date'>) })

describe('the published items (Webster, Feller & Lambros 2008)', () => {
  it('carries 12 items in the published order, one per schema field', () => {
    expect(ACL_RSI_ITEMS).toHaveLength(12)
    expect(ACL_RSI_ITEMS.map((i) => i.field)).toEqual([...ACL_RSI_ITEM_FIELDS])
  })

  it('anchors the negatively phrased items as published, so 10 always reads readier and nothing is reverse-scored in code', () => {
    const by = Object.fromEntries(ACL_RSI_ITEMS.map((i) => [i.field, i]))
    // The six negatively phrased stems: the published form itself puts the ready end at 10.
    expect(by.i2).toMatchObject({ low: 'Extremely likely', high: 'Not likely at all' })
    expect(by.i3).toMatchObject({ low: 'Extremely nervous', high: 'Not nervous at all' })
    expect(by.i6).toMatchObject({ low: 'Extremely frustrating', high: 'Not at all frustrating' })
    expect(by.i7).toMatchObject({ low: 'Extremely fearful', high: 'No fear at all' })
    expect(by.i9).toMatchObject({ low: 'Extremely afraid', high: 'Not at all afraid' })
    expect(by.i10).toMatchObject({ low: 'All of the time', high: 'None of the time' })
    // The five confidence stems and the relaxed stem anchor the usual way up.
    for (const field of ['i1', 'i4', 'i5', 'i8', 'i11'] as const) expect(by[field], field).toMatchObject({ low: 'Not at all confident', high: 'Fully confident' })
    expect(by.i12).toMatchObject({ low: 'Not at all relaxed', high: 'Fully relaxed' })
    // No item anchors 0 = not at all / 10 = extremely: that naive pattern would corrupt the score.
    for (const item of ACL_RSI_ITEMS) expect(item.high, item.field).not.toMatch(/^Extremely/)
    expect(anchorWords(by.i2!)).toBe('0 = Extremely likely · 10 = Not likely at all')
    expect(ACL_RSI_LEAD).toContain('10 always reads readier')
  })
})

describe('the form', () => {
  it('starts with all 12 unanswered and Save waiting in words; the count follows the taps', () => {
    const none = emptyAclRsiAnswers()
    expect(aclRsiUnanswered(none)).toBe(12)
    expect(aclRsiBlocker(none)).toBe('Answer all 12 questions to save')
    const one = withAclRsiAnswer(none, 'i1', 8)
    expect(aclRsiUnanswered(one)).toBe(11)
    expect(aclRsiBlocker(one)).toBe('Answer all 12 questions to save — 11 to go')
    expect(buildAclRsiEntry(one, '2026-11-08')).toBeNull()
  })

  it('builds the entry once all 12 are answered, dated today', () => {
    let answers = emptyAclRsiAnswers()
    for (const field of ACL_RSI_ITEM_FIELDS) answers = withAclRsiAnswer(answers, field, 7)
    expect(aclRsiBlocker(answers)).toBeNull()
    expect(buildAclRsiEntry(answers, '2026-11-08')).toEqual(entry('2026-11-08', 7))
    // 0 is an answer, not a blank.
    const withZero = withAclRsiAnswer(answers, 'i3', 0)
    expect(aclRsiBlocker(withZero)).toBeNull()
    expect(buildAclRsiEntry(withZero, '2026-11-08')?.i3).toBe(0)
  })

  it('says when saving replaces today’s entry, with its score (the 154 pattern)', () => {
    expect(aclRsiReplaceLine([], '2026-11-08')).toBeNull()
    expect(aclRsiReplaceLine([entry('2026-11-07', 8)], '2026-11-08')).toBeNull()
    expect(aclRsiReplaceLine([entry('2026-11-08', 8)], '2026-11-08')).toBe('Today already has an entry (80). Saving replaces it.')
  })

  it('lists the stored entries in words, newest first, the date riding along for Delete', () => {
    const rows = aclRsiRows([entry('2026-11-05', 7), entry('2026-11-20', 8)])
    expect(rows).toEqual([
      { date: '2026-11-20', words: '80 — Friday Nov 20' },
      { date: '2026-11-05', words: '70 — Thursday Nov 5' },
    ])
  })
})

describe('the resumable draft, the KOOS pattern (found lost in the batch-A browser check)', () => {
  const fakeStore = () => {
    const map = new Map<string, string>()
    return {
      get length() {
        return map.size
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    }
  }
  const answered = { ...emptyAclRsiAnswers(), i1: 8, i7: 7 }

  it('lives under the runner prefix Reset and an import clear', () => {
    expect(ACL_RSI_DRAFT_PREFIX.startsWith(SWAP_KEY_PREFIX)).toBe(true)
  })

  it('round-trips the answers so leaving the form loses nothing', () => {
    const store = fakeStore()
    writeAclRsiDraft(store, '2026-12-20', answered)
    expect(readAclRsiDraft(store, '2026-12-20')).toEqual(answered)
  })

  it('reads a stored draft defensively: unknown fields, fractions and out-of-range values are dropped, never guessed', () => {
    expect(cleanAclRsiDraft({ i1: 11, i2: 2.5, i3: -1, mystery: 9, i12: 10 })).toEqual({ ...emptyAclRsiAnswers(), i12: 10 })
    expect(cleanAclRsiDraft('garbage')).toEqual(emptyAclRsiAnswers())
    const store = fakeStore()
    store.setItem(`${ACL_RSI_DRAFT_PREFIX}2026-12-20`, 'not json')
    expect(readAclRsiDraft(store, '2026-12-20')).toEqual(emptyAclRsiAnswers())
  })

  it('a stale draft for a past date is dropped on open; today\u2019s stays; Save clears today\u2019s; an empty form removes the key', () => {
    const store = fakeStore()
    writeAclRsiDraft(store, '2026-12-19', answered)
    writeAclRsiDraft(store, '2026-12-20', answered)
    dropOtherAclRsiDrafts(store, '2026-12-20')
    expect(store.getItem(`${ACL_RSI_DRAFT_PREFIX}2026-12-19`)).toBeNull()
    expect(readAclRsiDraft(store, '2026-12-20')).toEqual(answered)
    clearAclRsiDraft(store, '2026-12-20')
    expect(store.getItem(`${ACL_RSI_DRAFT_PREFIX}2026-12-20`)).toBeNull()
    writeAclRsiDraft(store, '2026-12-20', answered)
    writeAclRsiDraft(store, '2026-12-20', emptyAclRsiAnswers())
    expect(store.getItem(`${ACL_RSI_DRAFT_PREFIX}2026-12-20`)).toBeNull()
  })
})
