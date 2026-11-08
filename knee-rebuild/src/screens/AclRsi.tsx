import { useState } from 'react'
import { navigate } from '../app/router.ts'
import { useToday } from '../app/today.ts'
import { Button } from '../components/Button.tsx'
import { ScalePicker } from '../components/ScalePicker.tsx'
import { Screen } from '../components/Screen.tsx'
import { useAclRsiEntries } from '../db/hooks.ts'
import { deleteAclRsiEntry, saveAclRsiEntry } from '../db/repo.ts'
import type { AclRsiEntry, IsoDate } from '../schema/index.ts'
import {
  ACL_RSI_ITEMS,
  clearAclRsiDraft,
  dropOtherAclRsiDrafts,
  readAclRsiDraft,
  writeAclRsiDraft,
  ACL_RSI_LEAD,
  aclRsiBlocker,
  aclRsiReplaceLine,
  aclRsiRows,
  anchorWords,
  buildAclRsiEntry,
  emptyAclRsiAnswers,
  withAclRsiAnswer,
  type AclRsiAnswers,
} from './AclRsi.helpers.ts'

const TITLE = 'ACL-RSI'
const SECTION = 'flex flex-col gap-3'
const SCALE_0_10: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

/**
 * The ACL-RSI questionnaire (Batch A): the 12 published items, one per row, each 0 to 10 on the
 * published anchors — the anchors flip on the negatively phrased items so 10 always reads
 * readier, and nothing is reverse-scored in code. Save waits in words until all 12 are answered
 * (the published scale has no missing-data rule); a same-day save replaces, said on screen; each
 * stored entry has a quiet per-row Delete with no confirm (re-enterable, the VO2 precedent).
 * Scoring and the gate verdict live in src/rules; this file renders and writes.
 */
export function AclRsi() {
  const today = useToday()
  const entries = useAclRsiEntries()

  if (entries === undefined) {
    return (
      <Screen title={TITLE} lead="Opening storage…">
        <p className="text-body text-on-dark-dim">Reading the stored questionnaire entries from the phone.</p>
      </Screen>
    )
  }
  return <AclRsiBody today={today} entries={entries} />
}

function AclRsiBody({ today, entries }: { today: IsoDate; entries: readonly AclRsiEntry[] }) {
  // The form opens on today's draft, so a trip to Today or a phone interruption loses nothing (the KOOS pattern).
  const [answers, setAnswers] = useState<AclRsiAnswers>(() => {
    dropOtherAclRsiDrafts(window.localStorage, today)
    return readAclRsiDraft(window.localStorage, today)
  })
  const [saving, setSaving] = useState(false)
  const [savedLine, setSavedLine] = useState<string | null>(null)
  const blocker = aclRsiBlocker(answers)
  const replaces = aclRsiReplaceLine(entries, today)
  const rows = aclRsiRows(entries)

  const save = async () => {
    const entry = buildAclRsiEntry(answers, today)
    if (!entry || saving) return
    setSaving(true)
    try {
      await saveAclRsiEntry(entry)
      clearAclRsiDraft(window.localStorage, today)
      setAnswers(emptyAclRsiAnswers())
      setSavedLine('Saved. The Gates screen reads the latest entry against its 76 line.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Screen title={TITLE} lead={ACL_RSI_LEAD}>
      <ol className="flex flex-col">
        {ACL_RSI_ITEMS.map((item, index) => (
          <li key={item.field} className="flex flex-col gap-2 border-t border-on-dark-faint py-4">
            <p className="text-body text-on-dark">
              {index + 1}. {item.text}
            </p>
            <p className="text-small text-on-dark-muted">{anchorWords(item)}</p>
            <ScalePicker
              label={`Question ${index + 1}`}
              ariaLabel={item.text}
              unsetWord="not answered"
              value={answers[item.field]}
              options={SCALE_0_10}
              onChange={(value) => {
                setAnswers((all) => {
                  const next = withAclRsiAnswer(all, item.field, value)
                  writeAclRsiDraft(window.localStorage, today, next)
                  return next
                })
                setSavedLine(null)
              }}
            />
          </li>
        ))}
      </ol>

      <section aria-label="Save" className={SECTION}>
        {replaces ? <p className="text-small text-on-dark-dim">{replaces}</p> : null}
        <Button variant="primary" wide disabled={blocker !== null || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : (blocker ?? 'Save the questionnaire')}
        </Button>
        {savedLine ? (
          <p role="status" className="text-body text-on-dark">
            {savedLine}
          </p>
        ) : null}
        <Button wide onClick={() => navigate({ name: 'gates' })}>
          Back to Gates
        </Button>
      </section>

      {rows.length > 0 ? (
        <section aria-label="Entries" className={SECTION}>
          <h2 className="font-mono text-small font-normal uppercase tracking-[0.22em] text-on-dark-muted">Entries</h2>
          <ul className="flex flex-col">
            {rows.map((row) => (
              <li key={row.date} className="flex items-center justify-between gap-3 border-t border-on-dark-faint py-1 first:border-t-0">
                <span className="text-small text-on-dark-dim">{row.words}</span>
                <Button variant="quiet" className="shrink-0 px-0!" onClick={() => void deleteAclRsiEntry(row.date)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Screen>
  )
}
