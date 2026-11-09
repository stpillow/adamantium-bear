import { useEffect, useRef, useState, type RefObject } from 'react'
import { navigate } from '../app/router.ts'
import { PROGRAM } from '../app/session.ts'
import { useToday } from '../app/today.ts'
import { Button } from '../components/Button.tsx'
import { Screen } from '../components/Screen.tsx'
import { Stepper } from '../components/Stepper.tsx'
import { Tap } from '../components/Tap.tsx'
import { useAclRsiEntries, useHistory, useLocations, useSettings } from '../db/hooks.ts'
import { addGateTest, saveSettings, type History } from '../db/repo.ts'
import { advancePhase } from '../rules/progress.ts'
import type { AclRsiEntry, GateItem, IsoDate, Location, Settings } from '../schema/index.ts'
import { gateEvidenceLines, rationaleView } from './Evidence.helpers.ts'
import {
  advanceErrorSentence,
  advancedWords,
  bestWords,
  buildTest,
  clearWords,
  enterStart,
  enterWords,
  focusAfterConfirm,
  formBest,
  formBlocker,
  gatesView,
  manualTest,
  newGateTestId,
  setValue,
  symmetryLine,
  testErrorSentence,
  tickErrorSentence,
  trialName,
  trialsIntro,
  withoutKey,
  type ConfirmClose,
  type GatesView,
  type ItemView,
  type SymmetryEntry,
  type SymmetryForm,
  type Trial,
} from './Gates.helpers.ts'
import { GateCitation } from './program/Evidence.tsx'

const TITLE = 'Gates'
const LABEL = 'font-mono text-small font-normal uppercase tracking-[0.22em] text-on-dark-muted'
const HEADING = 'font-sans text-h3 font-medium text-on-dark'
const SECTION = 'flex flex-col gap-3'

type GateBody = Extract<GatesView, { kind: 'gate' }>
type Side = 'injured' | 'other'
type Pending = { kind: 'tick'; itemId: string; value: boolean } | { kind: 'test'; itemId: string } | { kind: 'advance' }

/**
 * The gate out of the current phase: each item evaluated live from what is logged, manual items as
 * toggles, symmetry tests entered inline, and an Advance phase button that waits for every item and
 * for Shawn's yes. Every verdict comes from src/rules through gatesView; this file renders and writes.
 */
export function Gates() {
  const today = useToday()
  const settings = useSettings()
  const history = useHistory()
  const locations = useLocations()
  // The ACL-RSI entries ride into the gate rule through gatesView, never through History (Batch A).
  const aclRsiEntries = useAclRsiEntries()

  if (settings === undefined || history === undefined || locations === undefined || aclRsiEntries === undefined) {
    return (
      <Screen title={TITLE} lead="Opening storage…">
        <p className="text-body text-on-dark-dim">Reading the sessions, runs, morning checks and tests logged on this phone.</p>
      </Screen>
    )
  }
  if (settings === null) {
    return (
      <Screen title={TITLE} lead="No settings yet.">
        <p className="text-body text-on-dark-dim">The current phase and the injured side live in Settings.</p>
        <Button wide onClick={() => navigate({ name: 'settings' })}>
          Settings
        </Button>
      </Screen>
    )
  }
  return <GateScreen today={today} settings={settings} history={history} locations={locations} aclRsiEntries={aclRsiEntries} />
}

function GateScreen({ today, settings, history, locations, aclRsiEntries }: { today: IsoDate; settings: Settings; history: History; locations: readonly Location[]; aclRsiEntries: readonly AclRsiEntry[] }) {
  /** Symmetry forms being typed, by gate item id; an item with no draft shows its opening form. */
  const [drafts, setDrafts] = useState<Record<string, SymmetryForm>>({})
  /** The write in flight, so only the control that made it says "Saving…". */
  const [pending, setPending] = useState<Pending | null>(null)
  /** A refused write, one sentence, by gate item id or "advance". */
  const [errors, setErrors] = useState<Record<string, string>>({})
  /** The last saved test's line, by gate item id, until its form is touched again. */
  const [saved, setSaved] = useState<Record<string, string>>({})
  /** The optional one-line "how it looked" note being typed, by gate item id (hop tests only): words, never a measurement. */
  const [notes, setNotes] = useState<Record<string, string>>({})
  /**
   * The form each item last saved, by gate item id. A saved form stays on screen as its draft, never
   * back to the session prefill, and Save waits until a value changes (formBlocker), so a double tap
   * can't write the prefill as a newer test that wins.
   */
  const [lastSaved, setLastSaved] = useState<Record<string, SymmetryForm>>({})
  const [confirming, setConfirming] = useState(false)
  const [advanced, setAdvanced] = useState<string | null>(null)
  /** How the confirm last closed, read when it does (focusAfterConfirm). */
  const closedBy = useRef<ConfirmClose>('checklist')
  /** The line saying what changed: always mounted, empty until an advance, so its words are announced when they arrive. */
  const advancedLine = useRef<HTMLParagraphElement>(null)

  // Yes, advance sits at the foot of a long page and the new gate's checklist replaces everything
  // above it: bring the top into view, where the new gate's title and the line saying what changed
  // are, and put focus on that line, not on the next gate's disabled Advance button.
  useEffect(() => {
    if (advanced === null) return
    window.scrollTo({ top: 0 })
    if (focusAfterConfirm('advanced') === 'advanced-line') advancedLine.current?.focus()
  }, [advanced])

  // Kept at the same place in both bodies below, so the region stays mounted from gate 3 into Phase 4.
  const advancedStatus = (
    <p ref={advancedLine} role="status" tabIndex={-1} className={advanced ? 'text-body text-on-dark' : 'sr-only'}>
      {advanced ?? ''}
    </p>
  )

  const view = gatesView({ today, settings, history, program: PROGRAM, locations, aclRsiEntries })
  const takenIds = history.gateTests.map((t) => t.id)
  const setError = (key: string, text: string | null) => setErrors((all) => (text === null ? withoutKey(all, key) : { ...all, [key]: text }))

  if (view.kind === 'no-gate') {
    return (
      <Screen title={TITLE} lead={view.line}>
        {advancedStatus}
        <p className="text-body text-on-dark-dim">No gate leads out of Phase {settings.currentPhase} yet, so there is nothing to check here.</p>
        <Button wide onClick={() => navigate({ name: 'today' })}>
          Today
        </Button>
      </Screen>
    )
  }

  const { gate } = view

  async function tick(item: GateItem, value: boolean) {
    if (pending) return
    // new Date() only stamps the id, so two ticks on one day keep the order they were made in.
    const test = manualTest({ gate, item, pass: value, today, id: newGateTestId(new Date().toISOString(), item.id, takenIds) })
    setPending({ kind: 'tick', itemId: item.id, value })
    setError(item.id, null)
    // The checklist changed under an open confirm: close it, so a yes is always given to the gate as it now reads.
    setConfirming(false)
    try {
      await addGateTest(test)
    } catch (e: unknown) {
      setError(item.id, tickErrorSentence(e))
    } finally {
      setPending(null)
    }
  }

  // With nothing typed a form shows its opening: the last saved test when that is newer than the
  // prefill's session, and then Save waits like right after a save (PROGRAM-QUESTIONS 118).
  const formFor = (itemId: string, entry: SymmetryEntry): SymmetryForm => drafts[itemId] ?? entry.opening
  const savedFor = (itemId: string, entry: SymmetryEntry): SymmetryForm | null => lastSaved[itemId] ?? (entry.openingSaved ? entry.opening : null)

  function edit(itemId: string, entry: SymmetryEntry, side: Side, index: number, value: Trial) {
    setDrafts((all) => ({ ...all, [itemId]: setValue(all[itemId] ?? entry.opening, side, index, value) }))
    setSaved((all) => withoutKey(all, itemId))
  }

  async function saveTest(item: GateItem, entry: SymmetryEntry) {
    if (pending) return
    const form = formFor(item.id, entry)
    const draft = buildTest({ gate, item, form, today, id: newGateTestId(new Date().toISOString(), entry.key ?? item.id, takenIds), lastSaved: savedFor(item.id, entry), note: notes[item.id] ?? '' })
    if (!draft.ok) return
    setPending({ kind: 'test', itemId: item.id })
    setError(item.id, null)
    setConfirming(false)
    try {
      await addGateTest(draft.test)
      // The fields keep what was saved, and Save waits on them, until a value changes; the note went with the test.
      setDrafts((all) => ({ ...all, [item.id]: form }))
      setLastSaved((all) => ({ ...all, [item.id]: form }))
      setNotes((all) => withoutKey(all, item.id))
      setSaved((all) => ({ ...all, [item.id]: `Saved. ${symmetryLine(formBest(form, entry.timed), entry.threshold, entry.trials === null, entry.timed)}` }))
    } catch (e: unknown) {
      setError(item.id, testErrorSentence(e))
    } finally {
      setPending(null)
    }
  }

  async function advance(body: GateBody) {
    if (pending || !body.advance.enabled) return
    setPending({ kind: 'advance' })
    setError('advance', null)
    try {
      // advancePhase refuses a gate that doesn't pass or doesn't lead to the next phase; the refusal is shown in words.
      // The week is phaseEntryWeek's, through the view: next week once this week's lifts have begun (PROGRAM-QUESTIONS 113).
      const next = advancePhase(settings, body.gate, body.result.passes, body.entryWeek)
      await saveSettings(next)
      closedBy.current = 'advanced'
      setConfirming(false)
      setDrafts({})
      setLastSaved({})
      setSaved({})
      setAdvanced(advancedWords(next, PROGRAM.phases))
    } catch (e: unknown) {
      setError('advance', advanceErrorSentence(e))
    } finally {
      setPending(null)
    }
  }

  return (
    <Screen title={TITLE} lead={gate.title}>
      {advancedStatus}
      <p role="status" aria-live="polite" className="text-lead text-on-dark">
        {view.countLine}
      </p>

      {view.stop ? (
        <section aria-label="Red flag" className="flex flex-col gap-2 rounded-sm border border-on-dark-faint p-4">
          <p className="text-body font-medium text-on-dark">{view.stop.headline}</p>
          <ul className="flex list-disc flex-col gap-1 pl-6">
            {view.stop.items.map((item) => (
              <li key={item} className="text-small text-on-dark-dim">
                {item}
              </li>
            ))}
          </ul>
          <p className="text-small text-on-dark-dim">The gate is checked as usual, but the phase can’t advance until the red-flag state is cleared in Settings, with a note.</p>
        </section>
      ) : null}

      <section aria-label="Checklist" className={SECTION}>
        <h2 className={HEADING}>Checklist</h2>
        <ol className="flex flex-col">
          {view.items.map((row) => (
            <ItemRow
              key={row.item.id}
              row={row}
              pending={pending}
              error={errors[row.item.id] ?? null}
              saved={saved[row.item.id] ?? null}
              form={row.kind === 'symmetry' ? formFor(row.item.id, row.entry) : null}
              lastSaved={row.kind === 'symmetry' ? savedFor(row.item.id, row.entry) : null}
              note={notes[row.item.id] ?? ''}
              onNote={(text) => setNotes((all) => ({ ...all, [row.item.id]: text }))}
              onTick={(value) => void tick(row.item, value)}
              onEdit={(side, index, value) => {
                if (row.kind === 'symmetry') edit(row.item.id, row.entry, side, index, value)
              }}
              onSave={() => {
                if (row.kind === 'symmetry') void saveTest(row.item, row.entry)
              }}
            />
          ))}
        </ol>
        {/* Batch F: the attribution once any item has a "Why this test", and the note when some don't (PROGRAM-QUESTIONS 197). */}
        {gateEvidenceLines(view.items.map((r) => r.item.id)).map((line) => (
          <p key={line} className="text-small text-on-dark-muted">
            {line}
          </p>
        ))}
      </section>

      {/* The KOOS offer (Batch A): plain routing words, never a score — scores live on Progress alone (PROGRAM-QUESTIONS 158). */}
      <section aria-label="KOOS check" className={SECTION}>
        <h2 className={HEADING}>KOOS check</h2>
        <p className="text-small text-on-dark-muted">{view.koosOffer}</p>
        <Button wide onClick={() => navigate({ name: 'koos' })}>
          Open the KOOS questionnaire
        </Button>
      </section>

      {/* A red flag on a check logged late (Batch D): a note beside Advance, which only a check for today locks (PROGRAM-QUESTIONS 175). */}
      {view.lateFlags.length > 0 ? (
        <section aria-label="Red flag on a past morning" className="flex flex-col gap-2 rounded-sm border border-on-dark-faint p-4">
          <h2 className="text-body font-medium text-on-dark">Red flag on a past morning</h2>
          {view.lateFlags.map((note) => (
            <p key={note} className="text-small text-on-dark-dim">
              {note}
            </p>
          ))}
          <Button onClick={() => navigate({ name: 'morning' })}>This morning’s check</Button>
        </section>
      ) : null}

      <AdvanceBlock
        body={view}
        confirming={confirming && view.advance.enabled}
        saving={pending?.kind === 'advance'}
        busy={pending !== null}
        error={errors.advance ?? null}
        onAsk={() => {
          setError('advance', null)
          setConfirming(true)
        }}
        closedBy={closedBy}
        onCancel={() => {
          closedBy.current = 'not-yet'
          setConfirming(false)
        }}
        onYes={() => void advance(view)}
      />
    </Screen>
  )
}

function ItemRow({
  row,
  pending,
  error,
  saved,
  form,
  lastSaved,
  note,
  onNote,
  onTick,
  onEdit,
  onSave,
}: {
  row: ItemView
  pending: Pending | null
  error: string | null
  saved: string | null
  form: SymmetryForm | null
  lastSaved: SymmetryForm | null
  note: string
  onNote: (text: string) => void
  onTick: (value: boolean) => void
  onEdit: (side: Side, index: number, value: Trial) => void
  onSave: () => void
}) {
  const ticking = pending?.kind === 'tick' && pending.itemId === row.item.id ? pending : null
  return (
    <li className="flex flex-col gap-3 border-t border-on-dark-faint py-4">
      <span className={`inline-flex items-center gap-2 font-mono text-small uppercase tracking-[0.22em] ${row.pass ? 'text-on-dark' : 'text-on-dark-muted'}`}>
        <span aria-hidden="true">{row.mark}</span>
        {row.word}
      </span>
      {row.kind === 'manual' ? (
        // The item text is long, so the Tap's state word ("○ Not yet") wrapped onto two or three lines at
        // phone width; keep it on one line and let the item text wrap instead.
        <div className="[&_button>span+span]:whitespace-nowrap">
          <Tap label={row.item.text} value={ticking ? ticking.value : row.pass} onChange={onTick} yes="Done" no="Not yet" />
        </div>
      ) : (
        <p className="text-body text-on-dark">{row.item.text}</p>
      )}
      <p className="text-small text-on-dark-dim">{row.detail}</p>
      <WhyThisTest itemId={row.item.id} />
      {ticking ? <p className="text-small text-on-dark-muted">Saving…</p> : null}
      {error ? (
        <p role="alert" className="text-body text-on-dark">
          {error}
        </p>
      ) : null}
      {row.kind === 'acl-rsi' ? (
        // The questionnaire is a tap away; the row itself carries only the latest score and date, in its detail words.
        <Button onClick={() => navigate({ name: 'acl-rsi' })}>Open the ACL-RSI questionnaire</Button>
      ) : null}
      {row.kind === 'symmetry' && form ? (
        <SymmetryBlock
          entry={row.entry}
          form={form}
          lastSaved={lastSaved}
          saving={pending?.kind === 'test' && pending.itemId === row.item.id}
          busy={pending !== null}
          saved={saved}
          note={note}
          onNote={onNote}
          onEdit={onEdit}
          onSave={onSave}
        />
      ) : null}
    </li>
  )
}

/**
 * "Why this test" (Batch F): where a curated study speaks to the item, a sentence in our words and the
 * citations behind it, collapsed until asked for. Display only: it reads nothing the gate decides
 * from and changes no verdict; its open state lives here and nowhere else.
 */
function WhyThisTest({ itemId }: { itemId: string }) {
  const [open, setOpen] = useState(false)
  const view = rationaleView(itemId)
  if (view === null) return null
  const id = `why-${itemId}`
  return (
    <div className="flex flex-col gap-2">
      <Button variant="quiet" className="self-start px-0!" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide why' : 'Why this test'}
      </Button>
      {/* Always in the page, so aria-controls names an element that exists, open or not. */}
      <div id={id}>
        {open ? (
          <div className="flex flex-col gap-3">
            <p className="text-small text-on-dark-dim">{view.why}</p>
            <ul className="flex flex-col">
              {view.citations.map((c) => (
                <GateCitation key={c.id} citation={c} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** The inline entry form: trials or one value per side, the best kept (the fastest on a timed hop), the symmetry live against the line, the optional note, and the tests so far. */
function SymmetryBlock({
  entry,
  form,
  lastSaved,
  saving,
  busy,
  saved,
  note,
  onNote,
  onEdit,
  onSave,
}: {
  entry: SymmetryEntry
  form: SymmetryForm
  lastSaved: SymmetryForm | null
  saving: boolean
  busy: boolean
  saved: string | null
  note: string
  onNote: (text: string) => void
  onEdit: (side: Side, index: number, value: Trial) => void
  onSave: () => void
}) {
  const best = formBest(form, entry.timed)
  const blocker = entry.key === null ? 'This item has no test key in the program data' : formBlocker(form, entry.trials, lastSaved, entry.timed)
  return (
    <div className="flex flex-col gap-4 border-l-2 border-on-dark-faint pl-3">
      <p className="text-small text-on-dark-muted">{entry.trials !== null ? trialsIntro(entry) : entry.prefillLine}</p>
      <SideFields label={entry.sides.injured} side="injured" values={form.injured} best={best.injured} entry={entry} onEdit={onEdit} />
      <SideFields label={entry.sides.other} side="other" values={form.other} best={best.other} entry={entry} onEdit={onEdit} />
      <p role="status" aria-live="polite" className="text-body text-on-dark">
        {symmetryLine(best, entry.threshold, entry.trials === null, entry.timed)}
      </p>
      {entry.trials !== null ? <NoteField itemKey={entry.key ?? 'test'} note={note} onNote={onNote} /> : null}
      <Button wide disabled={blocker !== null || busy} onClick={onSave}>
        {saving ? 'Saving…' : (blocker ?? 'Save this test')}
      </Button>
      {saved ? (
        <p role="status" className="text-body text-on-dark">
          {saved}
        </p>
      ) : null}
      <EarlierTests entry={entry} />
    </div>
  )
}

/** The optional one-line "how it looked" note on a hop test: quality is noted in words, never pretended to be measured. */
function NoteField({ itemKey, note, onNote }: { itemKey: string; note: string; onNote: (text: string) => void }) {
  const id = `hop-note-${itemKey}`
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small text-on-dark-dim">
        How it looked (optional, one line): saved with the test, in words
      </label>
      <input id={id} type="text" autoComplete="off" enterKeyHint="done" value={note} onChange={(e) => onNote(e.target.value)} className="tap w-full rounded-sm bg-ink px-3 text-body text-on-dark" />
    </div>
  )
}

function SideFields({
  label,
  side,
  values,
  best,
  entry,
  onEdit,
}: {
  label: string
  side: Side
  values: Trial[]
  best: number | null
  entry: SymmetryEntry
  onEdit: (side: Side, index: number, value: Trial) => void
}) {
  if (entry.trials === null) {
    // Not entered is words, as on a hop trial, never a 0 the form then refuses (a load test needs a load on each side).
    return <TrialField label={label} name={label} unit={entry.unit} step={entry.step} start={enterStart(entry)} max={entry.max} value={values[0] ?? null} onChange={(v) => onEdit(side, 0, v)} />
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={`${LABEL} pb-2`}>{label}</legend>
      {values.map((value, i) => (
        <TrialField key={i} label={`Trial ${i + 1}`} context={label} name={trialName(label, i)} unit={entry.unit} step={entry.step} start={enterStart(entry)} max={entry.max} value={value} onChange={(v) => onEdit(side, i, v)} />
      ))}
      <p className="text-body text-on-dark-dim">{bestWords(best, entry.unit, entry.timed)}</p>
    </fieldset>
  )
}

/**
 * One hop trial, or one side's load. The Stepper can only hold a number, and 0 is a trial (a hop he
 * couldn't do), so a value starts as the words "Not entered" with an Enter button that puts it at
 * `start` (0 for a trial, the exercise's first step for a load); Clear takes it back.
 */
function TrialField({
  label,
  context,
  name,
  unit,
  step,
  start,
  max,
  value,
  onChange,
}: {
  label: string
  /** The side a hop trial belongs to, read before the field's label; a load field's label is its side already. */
  context?: string
  /** The full name every control carries: "Right · injured, trial 1" (trialName), or a load field's side. */
  name: string
  unit: string
  step: number
  start: number
  max: number
  value: Trial
  onChange: (value: Trial) => void
}) {
  // Enter and Clear each remove the button just tapped, so focus moves on to what replaced it (the
  // new field, or Enter again) instead of falling to the page and losing a VoiceOver user's place.
  const box = useRef<HTMLDivElement>(null)
  const moveFocus = useRef<'input' | 'button' | null>(null)
  useEffect(() => {
    const target = moveFocus.current
    if (!target) return
    moveFocus.current = null
    box.current?.querySelector<HTMLElement>(target)?.focus()
  }, [value === null])
  const enter = () => {
    moveFocus.current = 'input'
    onChange(start)
  }
  const clear = () => {
    moveFocus.current = 'button'
    onChange(null)
  }
  return (
    <div ref={box}>
      {value === null ? (
        <EmptyTrial label={label} name={name} unit={unit} start={start} onEnter={enter} />
      ) : (
        <FilledTrial label={label} context={context} name={name} unit={unit} step={step} max={max} value={value} onChange={onChange} onClear={clear} />
      )}
    </div>
  )
}

function EmptyTrial({ label, name, unit, start, onEnter }: { label: string; name: string; unit: string; start: number; onEnter: () => void }) {
  {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-body text-on-dark-dim">
          {label}
          <span className="text-on-dark-muted"> ({unit})</span>
        </span>
        <div className="flex items-center gap-3">
          <span className="text-small text-on-dark-muted">Not entered</span>
          <Button aria-label={enterWords(name, start, unit)} onClick={onEnter}>
            Enter
          </Button>
        </div>
      </div>
    )
  }
}

function FilledTrial({
  label,
  context,
  name,
  unit,
  step,
  max,
  value,
  onChange,
  onClear,
}: {
  label: string
  context: string | undefined
  name: string
  unit: string
  step: number
  max: number
  value: number
  onChange: (value: Trial) => void
  onClear: () => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <Stepper label={label} {...(context ? { context } : {})} unit={unit} decimal step={step} min={0} max={max} value={value} onChange={onChange} />
      <Button variant="quiet" className="self-end" aria-label={clearWords(name)} onClick={onClear}>
        Clear
      </Button>
    </div>
  )
}

function EarlierTests({ entry }: { entry: SymmetryEntry }) {
  if (entry.earlier.length === 0) return <p className="text-small text-on-dark-muted">No tests saved for this item yet.</p>
  return (
    <div className="flex flex-col gap-1">
      <h3 className={LABEL}>Earlier tests</h3>
      <ul className="flex flex-col">
        {entry.earlier.map((t) => (
          <li key={t.id} className="flex flex-col border-t border-on-dark-faint py-2 first:border-t-0">
            <span className="text-small text-on-dark">
              {t.when} · {t.percent}
            </span>
            <span className="text-small text-on-dark-dim">
              {t.values} · {t.word}
            </span>
            {t.note ? <span className="text-small text-on-dark-muted">“{t.note}”</span> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function AdvanceBlock({
  body,
  confirming,
  saving,
  busy,
  error,
  closedBy,
  onAsk,
  onCancel,
  onYes,
}: {
  body: GateBody
  confirming: boolean
  saving: boolean
  busy: boolean
  error: string | null
  closedBy: RefObject<ConfirmClose>
  onAsk: () => void
  onCancel: () => void
  onYes: () => void
}) {
  // The confirm replaces the button just tapped: focus goes to its question, and when it closes
  // through Not yet, back to Advance phase (focusAfterConfirm), so a VoiceOver user is never left
  // on nothing. Yes moves focus to the line saying what changed (GateScreen).
  const box = useRef<HTMLElement>(null)
  const opened = useRef(false)
  useEffect(() => {
    if (confirming) {
      opened.current = true
      box.current?.querySelector<HTMLElement>('[data-confirm-question]')?.focus()
    } else if (opened.current) {
      opened.current = false
      if (focusAfterConfirm(closedBy.current) === 'advance-button') box.current?.querySelector<HTMLElement>('button')?.focus()
      closedBy.current = 'checklist'
    }
  }, [confirming, closedBy])
  return (
    <section ref={box} aria-label="Advance phase" className={SECTION}>
      <h2 className={HEADING}>Advance phase</h2>
      <p className="text-small text-on-dark-muted">The phase never advances on its own: every item has to pass, then you say yes.</p>
      {confirming ? (
        <div className="flex flex-col gap-3 rounded-sm border border-paper p-4">
          <p data-confirm-question tabIndex={-1} className="text-body text-on-dark">
            {body.question}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" disabled={busy} onClick={onYes}>
              {saving ? 'Saving…' : 'Yes, advance'}
            </Button>
            <Button variant="quiet" disabled={saving} onClick={onCancel}>
              Not yet
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="primary" wide disabled={!body.advance.enabled || busy} onClick={onAsk}>
          <span className="block">Advance phase</span>
          {body.advance.enabled ? null : <span className="block text-small">{body.advance.why}</span>}
        </Button>
      )}
      {error ? (
        <p role="alert" className="text-body text-on-dark">
          {error}
        </p>
      ) : null}
    </section>
  )
}
