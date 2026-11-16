import type { FirstRunDraft } from './Welcome.helpers.ts'

/*
 * What first run holds that isn't stored (M-U1): the answers as typed, kept while the steps change
 * routes (each step is a hash, so the back gesture steps back), and lost on a reload, as any unsaved
 * form is. Let go once the answers are saved, after Reset all data (a reset phone must ask the side
 * again: it has no default) and after an import from the first screen. Also the one-shot sentences
 * a screen leaves for the next one: Reset's for first run, and a first-screen import's for Today.
 */

let draft: FirstRunDraft | null = null

export function firstRunDraft(): FirstRunDraft | null {
  return draft
}

export function keepFirstRunDraft(next: FirstRunDraft): void {
  draft = next
}

export function forgetFirstRunDraft(): void {
  draft = null
}

type NoticeFor = 'welcome' | 'today'
const notices = new Map<NoticeFor, string>()

/** Leaves a sentence for the next mount of a screen, said once. */
export function leaveNotice(where: NoticeFor, text: string | null): void {
  if (text === null) notices.delete(where)
  else notices.set(where, text)
}

/** The sentence left for this screen, once; null when none was. */
export function takeNotice(where: NoticeFor): string | null {
  const text = notices.get(where) ?? null
  notices.delete(where)
  return text
}
