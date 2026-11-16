import { type DraftStore } from './Koos.helpers.ts'
import type { EngineMode } from '../rules/engineMode.ts'
import { ACL_RSI_ITEM_FIELDS, aclRsiReplacesToday, aclRsiScore, aclRsiSeries } from '../rules/aclRsi.ts'
import type { AclRsiEntry, IsoDate } from '../schema/index.ts'
import { shortDateWords } from './Today.helpers.ts'

/**
 * Pure helpers for the ACL-RSI questionnaire screen (Batch A; PROGRAM-QUESTIONS 156): the 12
 * published items with their anchors, the answers being tapped, why Save waits (all 12 answers —
 * the published scale has no missing-data rule), the entry a save writes, and the stored entries
 * in words. Scoring is src/rules/aclRsi.ts's alone; this file composes words. The item stems and
 * anchor directions are TRANSCRIBED from the published scale (Webster, Feller & Lambros 2008,
 * via the authors' 2018 short-form paper and its reproductions): roughly half the items are
 * negatively phrased and the published form anchors them itself so a higher answer always reads
 * readier — nothing is reverse-scored in code, and the anchors must never be "simplified" to
 * 0 = not at all / 10 = extremely, which would corrupt a gate-deciding score.
 */

export type AclRsiField = (typeof ACL_RSI_ITEM_FIELDS)[number]

export interface AclRsiItemWords {
  field: AclRsiField
  /** The published stem, verbatim. */
  text: string
  /** The anchor under 0, as published. */
  low: string
  /** The anchor under 10, as published: always the readier end. */
  high: string
}

/** The 12 items in the published order, each with its own published anchors. */
export const ACL_RSI_ITEMS: readonly AclRsiItemWords[] = [
  { field: 'i1', text: 'Are you confident that you can perform at your previous level of sport participation?', low: 'Not at all confident', high: 'Fully confident' },
  { field: 'i2', text: 'Do you think you are likely to re-injure your knee by participating in your sport?', low: 'Extremely likely', high: 'Not likely at all' },
  { field: 'i3', text: 'Are you nervous about playing your sport?', low: 'Extremely nervous', high: 'Not nervous at all' },
  { field: 'i4', text: 'Are you confident that your knee will not give way by playing your sport?', low: 'Not at all confident', high: 'Fully confident' },
  { field: 'i5', text: 'Are you confident that you could play your sport without concern for your knee?', low: 'Not at all confident', high: 'Fully confident' },
  { field: 'i6', text: 'Do you find it frustrating to have to consider your knee with respect to your sport?', low: 'Extremely frustrating', high: 'Not at all frustrating' },
  { field: 'i7', text: 'Are you fearful of re-injuring your knee by playing your sport?', low: 'Extremely fearful', high: 'No fear at all' },
  { field: 'i8', text: 'Are you confident about your knee holding up under pressure?', low: 'Not at all confident', high: 'Fully confident' },
  { field: 'i9', text: 'Are you afraid of accidentally injuring your knee by playing your sport?', low: 'Extremely afraid', high: 'Not at all afraid' },
  { field: 'i10', text: 'Do thoughts of having to go through surgery and rehabilitation again prevent you from playing your sport?', low: 'All of the time', high: 'None of the time' },
  { field: 'i11', text: 'Are you confident about your ability to perform well at your sport?', low: 'Not at all confident', high: 'Fully confident' },
  { field: 'i12', text: 'Do you feel relaxed about playing your sport?', low: 'Not at all relaxed', high: 'Fully relaxed' },
]

/** What the top of the form says. */
export const ACL_RSI_LEAD =
  'Twelve questions about how ready the knee feels for sport, each answered 0 to 10 on the anchors under it — the anchors flip on some questions, so 10 always reads readier. Gate 3 reads the latest entry against its 76 line.'

/** The lead for the mode: in tester mode no gate reads the entries (M-U3), so the lead doesn't say one does. */
export function aclRsiLead(mode: EngineMode): string {
  return mode === 'tester'
    ? 'Twelve questions about how ready the knee feels for sport, each answered 0 to 10 on the anchors under it — the anchors flip on some questions, so 10 is always the readier answer.'
    : ACL_RSI_LEAD
}

/** The line after a save, in the mode's words. */
export function aclRsiSavedLine(mode: EngineMode): string {
  return mode === 'tester' ? 'Saved.' : 'Saved. The Gates screen reads the latest entry against its 76 line.'
}

/** "0 = Extremely likely · 10 = Not likely at all": the anchors under one question, never color. */
export function anchorWords(item: Pick<AclRsiItemWords, 'low' | 'high'>): string {
  return `0 = ${item.low} · 10 = ${item.high}`
}

/** The answers being tapped: null is unanswered. */
export type AclRsiAnswers = Readonly<Record<AclRsiField, number | null>>

/** A fresh form: every item unanswered. */
export function emptyAclRsiAnswers(): AclRsiAnswers {
  return Object.fromEntries(ACL_RSI_ITEM_FIELDS.map((f) => [f, null])) as Record<AclRsiField, number | null>
}

/** The form with one answer changed, the rest untouched. */
export function withAclRsiAnswer(answers: AclRsiAnswers, field: AclRsiField, value: number): AclRsiAnswers {
  return { ...answers, [field]: value }
}

/** How many of the 12 are still unanswered. */
export function aclRsiUnanswered(answers: AclRsiAnswers): number {
  return ACL_RSI_ITEM_FIELDS.filter((f) => answers[f] === null).length
}

/**
 * Why Save waits, in words, or null when all 12 are answered: the published scale has no
 * missing-data rule, so a part-answered form never scores.
 */
export function aclRsiBlocker(answers: AclRsiAnswers): string | null {
  const left = aclRsiUnanswered(answers)
  if (left === 0) return null
  return left === 12 ? 'Answer all 12 questions to save' : `Answer all 12 questions to save — ${left} to go`
}

/** The entry a save writes, or null while any item is unanswered. */
export function buildAclRsiEntry(answers: AclRsiAnswers, today: IsoDate): AclRsiEntry | null {
  if (aclRsiBlocker(answers) !== null) return null
  return { date: today, ...(Object.fromEntries(ACL_RSI_ITEM_FIELDS.map((f) => [f, answers[f]])) as Omit<AclRsiEntry, 'date'>) }
}

/** The same-day replace line (the 154 pattern): "Today already has an entry (78.3). Saving replaces it."; null with none today. */
export function aclRsiReplaceLine(entries: readonly AclRsiEntry[], today: IsoDate): string | null {
  const stored = aclRsiReplacesToday(entries, today)
  return stored ? `Today already has an entry (${aclRsiScore(stored)}). Saving replaces it.` : null
}

/** The stored entries in words, newest first: "76.6 — Friday Nov 20", the date riding along for the row's Delete. */
export function aclRsiRows(entries: readonly AclRsiEntry[]): { date: IsoDate; words: string }[] {
  return aclRsiSeries(entries)
    .map((e) => ({ date: e.date, words: `${aclRsiScore(e)} — ${dateInWords(e.date)}` }))
    .reverse()
}

function dateInWords(date: string): string {
  try {
    return shortDateWords(date)
  } catch {
    return date
  }
}

// ---------------------------------------------------------------------------------------------
// The resumable draft, the KOOS form's pattern (PROGRAM-QUESTIONS 158): localStorage, keyed per
// date, written on every answer, cleared on Save. Found lost in the batch-A browser check: an
// answer tapped, a trip to Today, and the form came back empty — twelve gate-deciding answers
// should survive a phone interruption. Under SWAP_KEY_PREFIX so Reset and an import clear it.
// ---------------------------------------------------------------------------------------------

/** Must extend src/db/repo.ts's SWAP_KEY_PREFIX ('knee-rebuild:swaps:'), which forgetSwaps clears; a test pins the two together. */
export const ACL_RSI_DRAFT_PREFIX = 'knee-rebuild:swaps:acl-rsi-draft:'

/** A stored draft read back as answers: only known fields, each a whole 0 to 10; anything else is dropped, never guessed. */
export function cleanAclRsiDraft(raw: unknown): AclRsiAnswers {
  const answers = { ...emptyAclRsiAnswers() }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return answers
  for (const field of ACL_RSI_ITEM_FIELDS) {
    const value = (raw as Record<string, unknown>)[field]
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10) answers[field] = value
  }
  return answers
}

/** Today's draft, or an empty form; a failed read is an empty form, never an error. */
export function readAclRsiDraft(store: DraftStore, today: IsoDate): AclRsiAnswers {
  try {
    const raw = store.getItem(`${ACL_RSI_DRAFT_PREFIX}${today}`)
    return raw === null ? emptyAclRsiAnswers() : cleanAclRsiDraft(JSON.parse(raw))
  } catch {
    return emptyAclRsiAnswers()
  }
}

/** Writes the draft on every answer; a form with nothing answered removes it. */
export function writeAclRsiDraft(store: DraftStore, today: IsoDate, answers: AclRsiAnswers): void {
  try {
    const key = `${ACL_RSI_DRAFT_PREFIX}${today}`
    if (aclRsiUnanswered(answers) === ACL_RSI_ITEM_FIELDS.length) store.removeItem(key)
    else store.setItem(key, JSON.stringify(answers))
  } catch {
    // Private browsing: the form still works, it just won't survive a reload.
  }
}

/** Drops every draft that isn't today's, called on open; Save clears today's too. */
export function dropOtherAclRsiDrafts(store: DraftStore, today: IsoDate): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (key?.startsWith(ACL_RSI_DRAFT_PREFIX) && key !== `${ACL_RSI_DRAFT_PREFIX}${today}`) keys.push(key)
    }
    for (const key of keys) store.removeItem(key)
  } catch {
    // Private browsing: nothing was stored.
  }
}

/** Takes today's draft out, after a save. */
export function clearAclRsiDraft(store: DraftStore, today: IsoDate): void {
  try {
    store.removeItem(`${ACL_RSI_DRAFT_PREFIX}${today}`)
  } catch {
    // Private browsing: nothing was stored.
  }
}
