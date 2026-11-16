import { useEffect, useMemo, useState } from 'react'
import { navigate } from '../app/router.ts'
import { useToday } from '../app/today.ts'
import { Button } from '../components/Button.tsx'
import { Screen } from '../components/Screen.tsx'
import { useKoosEntries } from '../db/hooks.ts'
import { deleteKoosEntry, saveKoosEntry } from '../db/repo.ts'
import type { IsoDate, KoosEntry } from '../schema/index.ts'
import {
  KOOS_FORM_SECTIONS,
  KOOS_LEAD,
  buildKoosEntry,
  clearKoosDraft,
  dropOtherKoosDrafts,
  koosFormBlocker,
  koosEntryRows,
  koosReplaceLine,
  koosSaveSummary,
  readKoosDraft,
  withKoosAnswer,
  writeKoosDraft,
  type KoosAnswers,
  type KoosQuestion,
} from './Koos.helpers.ts'

const TITLE = 'KOOS'
const SECTION = 'flex flex-col gap-3'

/**
 * The KOOS questionnaire (Batch A): 42 items transcribed from the official English KOOS
 * (koos.nu), one question per row, each answered by ticking one of five worded boxes —
 * the words differ per question (S4/S5 run Always→Never, P1 and Q1 carry frequencies), so
 * the boxes carry the published words, never bare numbers. Skips are allowed; the Save
 * summary says which subscales will score. The form is long, so every answer writes a
 * resumable localStorage draft (cleared on Save, and by Reset all data or an import through
 * the swaps prefix). Scores show on PROGRESS ONLY, never on Gates; scoring lives in
 * src/rules/koos.ts. This file renders and writes.
 */
export function Koos() {
  const today = useToday()
  const entries = useKoosEntries()

  if (entries === undefined) {
    return (
      <Screen title={TITLE} lead="Opening storage…">
        <p className="text-body text-on-dark-dim">Reading the stored questionnaire entries from the phone.</p>
      </Screen>
    )
  }
  return <KoosBody today={today} entries={entries} />
}

function KoosBody({ today, entries }: { today: IsoDate; entries: readonly KoosEntry[] }) {
  const [answers, setAnswers] = useState<KoosAnswers>(() => {
    dropOtherKoosDrafts(window.localStorage, today)
    return readKoosDraft(window.localStorage, today)
  })
  const [saving, setSaving] = useState(false)
  const [savedLine, setSavedLine] = useState<string | null>(null)
  const blocker = koosFormBlocker(answers)
  const replaces = koosReplaceLine(entries, today)
  const summary = useMemo(() => koosSaveSummary(answers), [answers])
  const rows = koosEntryRows(entries)

  // A phone interruption loses nothing: every answer is on disk before the next tap.
  useEffect(() => {
    writeKoosDraft(window.localStorage, today, answers)
  }, [answers, today])

  const save = async () => {
    if (blocker !== null || saving) return
    setSaving(true)
    try {
      await saveKoosEntry(buildKoosEntry(answers, today))
      clearKoosDraft(window.localStorage, today)
      setAnswers({})
      setSavedLine('Saved. The subscale trends are on Progress.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Screen title={TITLE} lead={KOOS_LEAD}>
      {KOOS_FORM_SECTIONS.map((section, index) => (
        <section key={index} aria-label={section.name || section.subscale} className={SECTION}>
          {section.name ? (
            <h2 className="font-mono text-small font-normal uppercase tracking-[0.22em] text-on-dark-muted">{section.name}</h2>
          ) : null}
          {section.instruction ? <p className="text-small text-on-dark-dim">{section.instruction}</p> : null}
          <ol className="flex flex-col">
            {section.questions.map((question) => (
              <KoosRow
                key={question.field}
                question={question}
                value={answers[question.field] ?? null}
                onPick={(value) => {
                  setAnswers((all) => withKoosAnswer(all, question.field, value))
                  setSavedLine(null)
                }}
              />
            ))}
          </ol>
        </section>
      ))}

      <section aria-label="Save" className={SECTION}>
        <ul className="flex flex-col gap-1">
          {summary.map((line) => (
            <li key={line} className="text-small text-on-dark-dim">
              {line}
            </li>
          ))}
        </ul>
        {replaces ? <p className="text-small text-on-dark-dim">{replaces}</p> : null}
        <Button variant="primary" wide disabled={blocker !== null || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : (blocker ?? 'Save the questionnaire')}
        </Button>
        {savedLine ? (
          <p role="status" className="text-body text-on-dark">
            {savedLine}
          </p>
        ) : null}
        <Button wide onClick={() => navigate({ name: 'progress' })}>
          Back to Progress
        </Button>
      </section>

      {rows.length > 0 ? (
        <section aria-label="Entries" className={SECTION}>
          <h2 className="font-mono text-small font-normal uppercase tracking-[0.22em] text-on-dark-muted">Entries</h2>
          <ul className="flex flex-col">
            {rows.map((row) => (
              <li key={row.date} className="flex items-center justify-between gap-3 border-t border-on-dark-faint py-1 first:border-t-0">
                <span className="text-small text-on-dark-dim">{row.words}</span>
                <Button variant="quiet" className="shrink-0 px-0!" onClick={() => void deleteKoosEntry(row.date)}>
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

/**
 * One question: the stem, then the five worded boxes left to right in the published order
 * (scored 0 to 4 in that order by the helpers; the words differ per question and are never
 * replaced with numbers). The ticked box is inverted AND carries aria-pressed, so nothing
 * rides on color; tapping it again clears the answer back to skipped.
 */
function KoosRow({ question, value, onPick }: { question: KoosQuestion; value: number | null; onPick: (value: number) => void }) {
  return (
    <li className="flex flex-col gap-2 border-t border-on-dark-faint py-4">
      <p className="text-body text-on-dark">
        {question.label}. {question.text}
      </p>
      <p className="text-small text-on-dark-dim">{value === null ? 'Not answered (skipping is allowed)' : question.options[value]}</p>
      <div role="group" aria-label={question.text} className="flex flex-wrap gap-2">
        {question.options.map((word, score) => {
          const on = value === score
          return (
            <button
              key={word}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(score)}
              className={`tap touch-manipulation rounded-sm border px-3 text-small ${on ? 'border-paper bg-paper text-on-light' : 'border-on-dark-faint bg-transparent text-on-dark'}`}
            >
              {word}
            </button>
          )
        })}
      </div>
    </li>
  )
}
