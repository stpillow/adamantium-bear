import { useEffect, useId, useRef, useState } from 'react'
import { navigate } from '../app/router.ts'
import { PROGRAM } from '../app/session.ts'
import { canonicalZone, deviceTimeZone, supportedTimeZones, useTimeZone } from '../app/timeZone.ts'
import { useToday } from '../app/today.ts'
import { Button } from '../components/Button.tsx'
import { Choice, Note, Section } from '../components/FormParts.tsx'
import { Screen } from '../components/Screen.tsx'
import { Stepper } from '../components/Stepper.tsx'
import { Tap } from '../components/Tap.tsx'
import { exportBackup, markExported, replaceAll } from '../db/backup.ts'
import { useHrSettings, useSettings, useTimeZoneSetting } from '../db/hooks.ts'
import { getSettings, resetAll, saveHrSettings, saveSettings, saveSettingsAndMoves, saveTimeZone } from '../db/repo.ts'
import { backupFileName, backupText, summarize, type Backup, type BackupSummary } from '../rules/backup.ts'
import { timeZoneChange } from '../rules/calendar.ts'
import type { HrSettings, IsoDate, IsoDateTime, Settings as SettingsRecord } from '../schema/index.ts'
import { forgetFirstRunDraft, leaveNotice } from './firstRun.ts'
import { forgetSlotDrafts } from './program/drafts.ts'
import { ImportSection, LINK_BUTTON, StartDatePicker } from './settings/parts.tsx'
import {
  DUMBBELLS_LINE,
  HR_MAX_MAX,
  HR_MAX_MIN,
  HR_MAX_OPEN,
  HR_RESTING_MAX,
  HR_RESTING_MIN,
  HR_RESTING_OPEN,
  HR_SECTION_NOTE,
  HR_STEP,
  hrClearButtonWords,
  hrSavePatch,
  hrSetButtonWords,
  hrUnsetWords,
  PHASE_NOTE,
  RESET_CONFIRM,
  REST_MAX,
  REST_MIN,
  REST_STEP,
  SIDES,
  clearedSettings,
  errorWords,
  heldWords,
  holdsLine,
  lastExportWords,
  painWords,
  phaseWords,
  redFlagView,
  resetWords,
  restTimerWords,
  shareFailure,
  shareRoute,
  sideWords,
  checkStartDate,
  deloadWeeksLine,
  startDateChange,
  timeZoneChangeWords,
  timeZoneSectionWords,
  weekLine,
  zoneOptions,
  zoneWords,
  cityOf,
  type FormHold,
  type HrPatch,
} from './Settings.helpers.ts'

const TITLE = 'Settings'
const FLASH_MS = 1500

/** Which part of the screen a save, a Saved word or a problem belongs to. */
type Field = 'injuredSide' | 'startDate' | 'timeZone' | 'restTimerSeconds' | 'painPerSet' | 'heartRate' | 'redFlag' | 'export'
type Problem = { field: Field; text: string } | null
type ResetStep = 'idle' | 'confirm' | 'erasing'
/** What a reset came to (`resetWords`), said in the Reset section where Yes was tapped. */
type ResetResult = ReturnType<typeof resetWords>

/**
 * Set by Today's "No export in 9 days · Export": the next Settings mount opens at its Export
 * section, so the tap lands by Export JSON rather than at the injured side, seven sections up.
 */
let openAtExport = false

/** Opens Settings at its Export section (Today's export line). */
export function openSettingsAtExport(): void {
  openAtExport = true
  navigate({ name: 'settings' })
}

/**
 * The knobs the engine reads: injured side, start date, rest timer, pain logging,
 * plus the red-flag state and a reset. Every change saves at once through the repo and says so.
 * Nothing here decides anything about the knee; Monday-ness and the red-flag rule come from src/rules.
 */
export function Settings() {
  const stored = useSettings()
  if (stored === undefined) {
    return (
      <Screen title={TITLE} lead="Opening storage…">
        <p className="text-body text-on-dark-dim">The settings load from the phone.</p>
      </Screen>
    )
  }
  if (stored === null) {
    return (
      <Screen title={TITLE} lead="This phone isn’t set up yet.">
        <Button wide onClick={() => navigate({ name: 'welcome' })}>
          Set up
        </Button>
      </Screen>
    )
  }
  return <SettingsForm stored={stored} />
}

function SettingsForm({ stored }: { stored: SettingsRecord }) {
  const today = useToday()
  const timeZone = useTimeZone()
  const zoneSetting = useTimeZoneSetting()
  const [draft, setDraft] = useState(stored)
  const draftRef = useRef(stored)
  const storedRef = useRef(stored)
  // The heart-rate numbers (metrics phase 2): a row of their own, so they never ride through save()/saveSettings
  // and the settings row is never rewritten for them (PROGRAM-QUESTIONS 132, 150). Same draft/echo dance as the row.
  const hrStored = useHrSettings()
  const [hrDraft, setHrDraft] = useState<HrSettings | null>(null)
  const hrRef = useRef<HrSettings | null>(null)
  const pending = useRef(0)
  const mounted = useRef(false)
  const [savedField, flashSaved] = useFlash()
  const [problem, setProblem] = useState<Problem>(null)
  const [resetStep, setResetStep] = useState<ResetStep>('idle')
  const [resetResult, setResetResult] = useState<ResetResult | null>(null)
  // What the last start-date change did to the stored session moves, when it dropped any.
  const [movesNotice, setMovesNotice] = useState<string | null>(null)
  // Where the red-flag section sits is settled once per visit: clearing it, the Saved word that follows, and a
  // rejected clear (which keeps the typed note) all happen in place instead of jumping down the screen.
  const [flagFirst] = useState(() => stored.redFlag.active)
  // While an import or a reset writes, the rest of the form waits: a save then would write the row this
  // screen holds, the old one, and queue it behind the import's transaction, over what it wrote. The ref
  // answers a tap in the same frame; the state disables the controls and says so in each section.
  const holdRef = useRef<FormHold | null>(null)
  const [hold, setHoldState] = useState<FormHold | null>(null)
  const setHold = (next: FormHold | null) => {
    holdRef.current = next
    setHoldState(next)
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // The stored row is the truth whenever no write of ours is in flight; a write's own echo arrives after it resolves.
  useEffect(() => {
    storedRef.current = stored
    if (pending.current === 0) {
      draftRef.current = stored
      setDraft(stored)
    }
  }, [stored])

  // The heart-rate row, same rule: the store is the truth whenever no write of ours is in flight.
  useEffect(() => {
    if (pending.current === 0) {
      hrRef.current = hrStored ?? null
      setHrDraft(hrStored ?? null)
    }
  }, [hrStored])

  function adopt(next: SettingsRecord) {
    draftRef.current = next
    setDraft(next)
  }

  /** Shows the change at once, writes it, and says Saved; a rejected write falls back to what the phone holds. */
  async function save(patch: Partial<SettingsRecord>, field: Field, write: (next: SettingsRecord) => Promise<void> = saveSettings): Promise<void> {
    // The export's stamp alone is written read-modify-write (markExported), so it never needs to wait.
    if (holdRef.current !== null && field !== 'export') {
      setProblem({ field, text: heldWords(holdRef.current).refusal })
      return
    }
    const next = { ...draftRef.current, ...patch }
    adopt(next)
    setProblem(null)
    pending.current += 1
    try {
      await write(next)
      flashSaved(field)
    } catch (e) {
      adopt(storedRef.current)
      setProblem({ field, text: `That did not save (${errorWords(e)}); the screen shows what the phone still has.` })
    } finally {
      pending.current -= 1
    }
  }

  /**
   * Saves one touched heart-rate number into the row of its own (metrics phase 2), never through
   * save()/saveSettings: the settings row is never rewritten for it. A null in the patch clears
   * that number, back to "not set". It waits on an import or a reset like every other section,
   * with the same refusal in words.
   */
  /**
   * Saves the time zone (M-U1) into its row of its own, never through save()/saveSettings: the
   * settings row is never rewritten for it (PROGRAM-QUESTIONS 132, 203). It waits on an import or a
   * reset like every other section. Resolves true once saved.
   */
  async function saveZone(zone: string): Promise<boolean> {
    if (holdRef.current !== null) {
      setProblem({ field: 'timeZone', text: heldWords(holdRef.current).refusal })
      return false
    }
    setProblem(null)
    try {
      await saveTimeZone(canonicalZone(zone))
      flashSaved('timeZone')
      return true
    } catch (e) {
      setProblem({ field: 'timeZone', text: `That did not save (${errorWords(e)}); dates are still counted as before.` })
      return false
    }
  }

  async function saveHr(patch: HrPatch): Promise<void> {
    if (holdRef.current !== null) {
      setProblem({ field: 'heartRate', text: heldWords(holdRef.current).refusal })
      return
    }
    const next = hrSavePatch(hrRef.current, patch)
    hrRef.current = next
    setHrDraft(next)
    setProblem(null)
    pending.current += 1
    try {
      await saveHrSettings(next)
      flashSaved('heartRate')
    } catch (e) {
      hrRef.current = hrStored ?? null
      setHrDraft(hrStored ?? null)
      setProblem({ field: 'heartRate', text: `That did not save (${errorWords(e)}); the screen shows what the phone still has.` })
    } finally {
      pending.current -= 1
    }
  }

  /**
   * A new start date carries the stored session moves with it, in the same transaction: each is
   * rebased onto the dates it was made for, and any now before week 1 is dropped and said so.
   */
  async function saveStartDate(date: IsoDate): Promise<void> {
    setMovesNotice(null)
    await save({ startDate: date }, 'startDate', async (next) => {
      const change = await saveSettingsAndMoves(next, (stored, moves) => startDateChange(stored.startDate, next.startDate, moves, stored.phaseEnteredWeek))
      setMovesNotice(change.notice)
    })
  }

  /**
   * Records an export once the file has left the phone: shown at once, written through the repo's
   * read-modify-write so nothing else on the row is touched, and said Saved like any change.
   */
  async function recordExport(exportedAt: IsoDateTime): Promise<void> {
    await save({ lastExportedAt: exportedAt }, 'export', () => markExported(exportedAt))
  }

  /** The rule's refusal in words, or null once the cleared state is on its way to storage. */
  function clearFlag(note: string): string | null {
    const result = clearedSettings(draftRef.current, note, today)
    if (!result.ok) return result.refusal
    void save({ redFlag: result.settings.redFlag }, 'redFlag')
    return null
  }

  async function eraseEverything(): Promise<void> {
    setHold('reset')
    try {
      await erase()
    } finally {
      setHold(null)
    }
  }

  /**
   * Erases everything (M-U1: nothing is seeded in its place). Once erased the shell finds a phone
   * with nothing stored and goes to first run, which says what happened; so its sentence is left for
   * it before the write, and taken back if nothing was erased.
   */
  async function erase(): Promise<void> {
    setResetStep('erasing')
    setProblem(null)
    setResetResult(null)
    pending.current += 1
    leaveNotice('welcome', resetWords({ kind: 'erased' }).text)
    try {
      await resetAll()
      // The Program screen's unsaved drafts were for lists that are gone: no Put it back after "There is no undo".
      forgetSlotDrafts()
      // First run's answers, if any were typed before, go too: a reset phone asks the side again.
      forgetFirstRunDraft()
    } catch (e) {
      leaveNotice('welcome', null)
      setResetStep('confirm')
      setResetResult(resetWords({ kind: 'not-erased', error: e }))
    } finally {
      pending.current -= 1
    }
  }

  /**
   * Replaces everything with the file (src/db/backup.ts `replaceAll`) while the rest of the form
   * waits, then puts the stored row on the form before the live query's echo arrives, so no tap in
   * between writes the old row back. A failure is the Import section's to say.
   */
  async function importFile(backup: Backup): Promise<void> {
    const before = storedRef.current
    setHold('import')
    pending.current += 1
    try {
      await replaceAll(backup, PROGRAM, today)
      // The Program screen's unsaved drafts were for the lists the file replaced.
      forgetSlotDrafts()
      // Read once more for the row as written (the red flag it kept, the export stamp). Should that read
      // fail, the live query's echo is the row: adopted here if it came already, else when it comes.
      const row = await getSettings().catch(() => undefined)
      const next = row ?? (storedRef.current !== before ? storedRef.current : undefined)
      if (next && mounted.current) adopt(next)
    } finally {
      pending.current -= 1
      setHold(null)
    }
  }

  const problemFor = (field: Field) => (problem?.field === field ? problem.text : null)
  const held = hold ? heldWords(hold).note : null
  const phase = phaseWords(draft, PROGRAM.phases)
  const redFlag = <RedFlagSection state={draft.redFlag} saved={savedField === 'redFlag'} problem={problemFor('redFlag')} held={held} onClear={clearFlag} />

  return (
    <Screen title={TITLE} lead="Each change saves on its own; a Saved word confirms it.">
      {flagFirst ? redFlag : null}

      <Section label="Injured side" saved={savedField === 'injuredSide'} problem={problemFor('injuredSide')} held={held}>
        <div role="radiogroup" aria-label="Injured side" className="flex flex-col gap-2">
          {SIDES.map((side) => (
            <Choice
              key={side}
              label={sideWords(side)}
              selected={draft.injuredSide === side}
              selectedWord="Injured"
              disabled={hold !== null}
              onSelect={() => {
                if (draft.injuredSide !== side) void save({ injuredSide: side }, 'injuredSide')
              }}
            />
          ))}
        </div>
        <Note>Unilateral slots log this side first; its reps set the healthy side’s budget.</Note>
      </Section>

      <StartDateSection
        key={draft.startDate}
        startDate={draft.startDate}
        today={today}
        saved={savedField === 'startDate'}
        problem={problemFor('startDate')}
        movesNotice={movesNotice}
        held={held}
        onSave={(date) => void saveStartDate(date)}
      />

      <TimeZoneSection setting={zoneSetting} zone={timeZone} today={today} saved={savedField === 'timeZone'} problem={problemFor('timeZone')} held={held} onSave={saveZone} />

      {/* Each gym's rack is its own from M4b; Settings' dumbbell max is frozen (the home gym was first written from it). */}
      <Section label="Dumbbells" saved={false} problem={null}>
        <p className="text-body text-on-dark-dim">{DUMBBELLS_LINE}</p>
        <Button wide onClick={() => navigate({ name: 'locations' })}>
          Where you train
        </Button>
      </Section>

      <Section label="Rest timer" saved={savedField === 'restTimerSeconds'} problem={problemFor('restTimerSeconds')} held={held}>
        <Stepper
          label="Rest between sets"
          unit="s"
          value={draft.restTimerSeconds}
          step={REST_STEP}
          min={REST_MIN}
          max={REST_MAX}
          disabled={hold !== null}
          onChange={(v) => void save({ restTimerSeconds: v }, 'restTimerSeconds')}
        />
        <Note>{restTimerWords(draft.restTimerSeconds)} of rest, counted from the moment a set is marked done.</Note>
      </Section>

      <Section label="Pain logging" saved={savedField === 'painPerSet'} problem={problemFor('painPerSet')} held={held}>
        <Tap label="Pain per set" value={draft.painPerSet} disabled={hold !== null} onChange={(v) => void save({ painPerSet: v }, 'painPerSet')} yes="Per set" no="Per exercise" />
        <Note>{painWords(draft.painPerSet)}</Note>
      </Section>

      <Section label="Heart rate" saved={savedField === 'heartRate'} problem={problemFor('heartRate')} held={held}>
        <HrNumber
          label="Max heart rate"
          value={hrDraft?.maxHr}
          min={HR_MAX_MIN}
          max={HR_MAX_MAX}
          opensOn={HR_MAX_OPEN}
          disabled={hold !== null}
          onChange={(maxHr) => void saveHr({ maxHr })}
          onClear={() => void saveHr({ maxHr: null })}
        />
        <HrNumber
          label="Resting heart rate"
          value={hrDraft?.restingHr}
          min={HR_RESTING_MIN}
          max={HR_RESTING_MAX}
          opensOn={HR_RESTING_OPEN}
          disabled={hold !== null}
          onChange={(restingHr) => void saveHr({ restingHr })}
          onClear={() => void saveHr({ restingHr: null })}
        />
        <Note>{HR_SECTION_NOTE}</Note>
      </Section>

      <Section label="Phase" saved={false} problem={null}>
        <p className="text-body text-on-dark">{phase.title}</p>
        <p className="text-body text-on-dark-dim">{phase.entered}</p>
        <Note>{PHASE_NOTE}</Note>
        <Button wide onClick={() => navigate({ name: 'gates' })}>
          Gates
        </Button>
      </Section>

      {flagFirst ? null : redFlag}

      <ExportSection today={today} timeZone={timeZone} lastExportedAt={draft.lastExportedAt} saved={savedField === 'export'} problem={problemFor('export')} onExported={recordExport} />

      <ImportSection today={today} timeZone={timeZone} held={hold === 'reset' ? held : null} onReplace={(backup) => importFile(backup)} />

      <ResetSection
        step={resetStep}
        result={resetResult}
        held={hold === 'import' ? held : null}
        onArm={() => {
          setResetResult(null)
          setResetStep('confirm')
        }}
        onDisarm={() => {
          setResetResult(null)
          setResetStep('idle')
        }}
        onErase={() => void eraseEverything()}
      />
    </Screen>
  )
}

/** Which field just saved, for the Saved word that shows for a moment. */
function useFlash(): [Field | null, (field: Field) => void] {
  const [field, setField] = useState<Field | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )
  const flash = (next: Field) => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    setField(next)
    timer.current = window.setTimeout(() => setField(null), FLASH_MS)
  }
  return [field, flash]
}

/**
 * One heart-rate number (metrics phase 2): unset says so in words with a button that names the
 * number the stepper will start on — only that tap stores it, so the app never invents a value —
 * and once set, a stepper on the schema's bounds that saves each change, with a clear below it
 * that removes the number again, so "not set" stays reachable (the section's note offers unset
 * as the way to no HR load, and an exploratory tap must not store 180 bpm for good).
 */
function HrNumber({
  label,
  value,
  min,
  max,
  opensOn,
  disabled,
  onChange,
  onClear,
}: {
  label: string
  /** Undefined is "not set": no HR load is computed from it, and no number is shown that nobody chose. */
  value: number | undefined
  min: number
  max: number
  opensOn: number
  disabled: boolean
  onChange: (value: number) => void
  /** Removes the stored number: the control goes back to its "not set" words. */
  onClear: () => void
}) {
  if (value === undefined) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-body text-on-dark-dim">{hrUnsetWords(label)}</p>
        <Button wide disabled={disabled} onClick={() => onChange(opensOn)}>
          {hrSetButtonWords(label, opensOn)}
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <Stepper label={label} unit="bpm" value={value} step={HR_STEP} min={min} max={max} disabled={disabled} onChange={onChange} />
      <Button variant="quiet" className="self-start" disabled={disabled} onClick={onClear}>
        {hrClearButtonWords(label)}
      </Button>
    </div>
  )
}

/** The start date: the shared picker (a Monday only, the nearest Mondays a tap away), saved only on an explicit tap. */
function StartDateSection({
  startDate,
  today,
  saved,
  problem,
  movesNotice,
  held,
  onSave,
}: {
  startDate: IsoDate
  today: IsoDate
  saved: boolean
  problem: string | null
  /** How many session moves the last change dropped, in words; null when it dropped none. */
  movesNotice: string | null
  /** Why the section waits, while an import or a reset writes; null otherwise. */
  held: string | null
  onSave: (date: IsoDate) => void
}) {
  const [input, setInput] = useState<string>(startDate)
  // A picker can pass through several Mondays on the way; each save rebases the stored moves, so
  // the date is saved only on an explicit tap.
  const check = checkMonday(input)
  const pending = check !== null && check !== startDate ? check : null
  return (
    <Section label="Start date" saved={saved} problem={problem} held={held}>
      <StartDatePicker value={input} onChange={setInput} disabled={held !== null} />
      <Note>
        {weekLine(today, startDate)} {deloadWeeksLine()}
      </Note>
      {pending ? (
        <Button variant="primary" wide disabled={held !== null} onClick={() => onSave(pending)}>
          Save start date
        </Button>
      ) : null}
      <Note>Sessions already moved keep their dates when this changes.</Note>
      {movesNotice ? (
        <p role="status" className="text-body text-on-dark">
          {movesNotice}
        </p>
      ) : null}
    </Section>
  )
}

/**
 * The time zone (M-U1, PROGRAM-QUESTIONS 203 to 205): what dates are counted in and today there, the
 * phone's own zone a tap away when it differs, and a picker. A different zone asks first, inline (no
 * modal), saying whether today's date moves and that nothing logged does; Yes asks again if the words
 * have changed since they were shown (midnight passed), then saves. An unreadable stored zone gets a
 * button that writes the zone dates are counted in over it, without asking, since no date moves.
 */
function TimeZoneSection({
  setting,
  zone,
  today,
  saved,
  problem,
  held,
  onSave,
}: {
  setting: { zone: string; stored: 'none' | 'ok' | 'unreadable' } | undefined
  zone: string
  today: IsoDate
  saved: boolean
  problem: string | null
  held: string | null
  onSave: (zone: string) => Promise<boolean>
}) {
  const [asked, setAsked] = useState<{ to: string; lines: string[]; again: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [device] = useState(deviceTimeZone)
  const [supported] = useState(supportedTimeZones)
  const words = timeZoneSectionWords(setting ?? { zone, stored: 'none' }, device, today)
  const kept = words.keep
  const linesFor = (to: string) => timeZoneChangeWords(timeZoneChange(new Date(), zone, to), zone, to)

  const ask = (to: string) => {
    setDone(null)
    setAsked(to === zone ? null : { to, lines: linesFor(to), again: false })
  }

  // An unreadable row: keeping the zone dates are already counted in moves nothing, so it saves without asking.
  const keep = async (done: string) => {
    setAsked(null)
    setDone(null)
    setBusy(true)
    const ok = await onSave(zone)
    setBusy(false)
    if (ok) setDone(done)
  }

  const confirm = async (shown: { to: string; lines: string[] }) => {
    const now = linesFor(shown.to)
    if (now.join('\n') !== shown.lines.join('\n')) {
      setAsked({ to: shown.to, lines: now, again: true })
      return
    }
    setBusy(true)
    const ok = await onSave(shown.to)
    setBusy(false)
    if (ok) {
      setAsked(null)
      setDone(`Dates are now counted in ${cityOf(shown.to) === shown.to ? shown.to : `${cityOf(shown.to)} time`}.`)
    }
  }

  return (
    <Section label="Time zone" saved={saved} problem={problem} held={held}>
      <p className="text-body text-on-dark">{words.line}</p>
      {words.unreadable ? (
        <p role="alert" className="text-body text-on-dark">
          {words.unreadable}
        </p>
      ) : null}
      {kept ? (
        <Button wide disabled={held !== null || busy} onClick={() => void keep(kept.done)}>
          {kept.button}
        </Button>
      ) : null}
      {words.device ? (
        <>
          <Note>{words.device.note}</Note>
          <Button wide disabled={held !== null || busy} onClick={() => ask(device)}>
            {words.device.button}
          </Button>
        </>
      ) : null}
      <select
        aria-label="Time zone"
        value={asked?.to ?? zone}
        disabled={held !== null || busy}
        onChange={(e) => ask(e.target.value)}
        className="tap w-full rounded-sm bg-ink px-3 text-body text-on-dark disabled:opacity-50"
      >
        {zoneOptions(supported, zone, device).map((group) => (
          <optgroup key={group.region} label={group.region}>
            {group.zones.map((z) => (
              <option key={z} value={z}>
                {zoneWords(z)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <Note>A trip of a few days needn’t change this; the date only moves near midnight.</Note>
      {asked ? (
        <div role="group" aria-label="Change the time zone?" className="flex flex-col gap-3">
          {asked.again ? <p className="text-body text-on-dark">The clock has moved on since this was shown; here it is again.</p> : null}
          {asked.lines.map((line) => (
            <p key={line} className="text-body text-on-dark wrap-anywhere">
              {line}
            </p>
          ))}
          <Button variant="primary" wide disabled={held !== null || busy} onClick={() => void confirm(asked)}>
            {busy ? 'Saving…' : `Yes, use ${zoneButtonWords(asked.to)}`}
          </Button>
          <Button variant="quiet" wide disabled={busy} onClick={() => setAsked(null)}>
            Keep {zoneButtonWords(zone)}
          </Button>
        </div>
      ) : null}
      {done ? (
        <p role="status" className="text-body text-on-dark">
          {done}
        </p>
      ) : null}
    </Section>
  )
}

/** "Los Angeles time"; "UTC". */
function zoneButtonWords(zone: string): string {
  return zone.includes('/') ? `${cityOf(zone)} time` : zone
}

/** The input's text as a Monday, or null when it isn't one. */
function checkMonday(value: string): IsoDate | null {
  const check = checkStartDate(value)
  return check.ok ? check.date : null
}

/** The red-flag state in words; clearing it takes a note, and the rule's refusal of an empty one is shown as it is. */
function RedFlagSection({
  state,
  saved,
  problem,
  held,
  onClear,
}: {
  state: SettingsRecord['redFlag']
  saved: boolean
  problem: string | null
  /** Why the section waits, while an import or a reset writes; null otherwise. */
  held: string | null
  onClear: (note: string) => string | null
}) {
  const view = redFlagView(state, PROGRAM.redFlags)
  const noteId = useId()
  const [note, setNote] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  return (
    <Section label="Red flag" saved={saved} problem={problem} held={held}>
      {view.active ? (
        <>
          <p className="text-lead font-medium text-on-dark">{view.headline}</p>
          {view.since ? <p className="text-body text-on-dark-dim">{view.since}</p> : null}
          <ul className="flex flex-col gap-1 text-body text-on-dark-dim">
            {view.items.map((item) => (
              <li key={item}>Flagged: {item}.</li>
            ))}
          </ul>
          <p className="text-body text-on-dark-dim">Progression stays suspended until this is cleared with a note: who looked at the knee and what they said.</p>
          <label htmlFor={noteId} className="text-body text-on-dark-dim">
            Note (required)
          </label>
          <textarea id={noteId} rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="tap w-full rounded-sm bg-ink p-3 text-body text-on-dark" />
          {refusal ? (
            <p role="alert" className="text-body text-on-dark">
              {refusal}
            </p>
          ) : null}
          <Button variant="primary" wide disabled={held !== null} onClick={() => setRefusal(onClear(note))}>
            Clear the red flag
          </Button>
        </>
      ) : (
        <>
          <p className="text-body text-on-dark">No red flag is set.</p>
          {view.cleared ? <p className="text-body text-on-dark-dim">{view.cleared}</p> : null}
          <Note>A ticked red flag on a morning check sets it; it is cleared here, with a note.</Note>
        </>
      )}
    </Section>
  )
}

/**
 * Two taps to erase: "Reset all data", then "Yes, erase everything"; a way back out sits beside it.
 * What the reset came to is said here, where Yes was tapped, and brought into view: the top of
 * Settings is a long scroll up, and a mount after the app shell swapped Settings out starts there.
 */
function ResetSection({
  step,
  result,
  held,
  onArm,
  onDisarm,
  onErase,
}: {
  step: ResetStep
  result: ResetResult | null
  /** Why Reset waits, while an import writes; null otherwise. */
  held: string | null
  onArm: () => void
  onDisarm: () => void
  onErase: () => void
}) {
  const said = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Centered, so the tab bar fixed along the bottom never covers it.
    if (result) said.current?.scrollIntoView({ block: 'center' })
  }, [result])
  return (
    <Section label="Reset" saved={false} problem={null} held={held}>
      {step === 'idle' ? (
        <Button wide disabled={held !== null} onClick={onArm}>
          Reset all data
        </Button>
      ) : (
        <>
          <p className="text-body text-on-dark">{RESET_CONFIRM}</p>
          <Button wide disabled={step === 'erasing' || held !== null} onClick={onErase}>
            {step === 'erasing' ? 'Erasing…' : 'Yes, erase everything'}
          </Button>
          <Button variant="quiet" wide disabled={step === 'erasing'} onClick={onDisarm}>
            Keep everything
          </Button>
        </>
      )}
      {/* The status line stays mounted, so the sentence is announced when it arrives; a problem is an alert. */}
      <div ref={said} className="flex flex-col gap-2">
        <p role="status" className={result && !result.problem ? 'text-body text-on-dark' : 'sr-only'}>
          {result && !result.problem ? result.text : ''}
        </p>
        {result?.problem ? (
          <p role="alert" className="text-body text-on-dark">
            {result.text}
          </p>
        ) : null}
      </div>
    </Section>
  )
}

/** A file ready to leave the phone: what it holds, and how it goes (the share sheet, or a link). */
interface ReadyFile {
  file: File
  name: string
  exportedAt: IsoDateTime
  summary: BackupSummary
  /** Rows that wouldn't import back as they are, in words; kept in the file all the same. */
  unreadable: string[]
  route: 'share' | 'download'
  /** The download link's object URL; revoked when the file is replaced or the section goes. */
  url: string | null
}

/**
 * Export (M6 brief, section 2): "Export JSON" reads every table into one file and says what it
 * holds; a second tap hands it to the share sheet (Save to Files, AirDrop) where the phone takes a
 * file, or saves it through a download link. The export is recorded once the file has gone.
 */
function ExportSection({
  today,
  timeZone,
  lastExportedAt,
  saved,
  problem,
  onExported,
}: {
  today: IsoDate
  timeZone: string
  lastExportedAt: IsoDateTime | undefined
  saved: boolean
  problem: string | null
  onExported: (exportedAt: IsoDateTime) => Promise<void>
}) {
  const [ready, setReady] = useState<ReadyFile | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const firstLine = useRef<HTMLParagraphElement>(null)

  // Opened from Today's export line: start at this section, once.
  useEffect(() => {
    if (!openAtExport) return
    openAtExport = false
    firstLine.current?.closest('section')?.scrollIntoView({ block: 'start' })
  }, [])

  useEffect(() => {
    const url = ready?.url
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [ready])

  async function prepare(): Promise<void> {
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const exportedAt = new Date().toISOString()
      const { backup, unreadable } = await exportBackup(exportedAt)
      const name = backupFileName(today)
      const file = new File([backupText(backup)], name, { type: 'application/json' })
      const route = shareRoute(typeof navigator === 'undefined' ? undefined : navigator, file)
      setReady({ file, name, exportedAt, summary: summarize(backup), unreadable, route, url: route === 'download' ? URL.createObjectURL(file) : null })
    } catch (e) {
      setReady(null)
      setError(`Nothing was exported (${errorWords(e)}).`)
    } finally {
      setBusy(false)
    }
  }

  async function share(file: ReadyFile): Promise<void> {
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      // The file alone: with words beside it, some share targets keep the words and drop the file. Its name says what it is.
      await navigator.share({ files: [file.file] })
      setReady(null)
      setNotice(`${file.name} went to the share sheet. Keep it off this phone: in Files on iCloud Drive, or on a Mac.`)
      await onExported(file.exportedAt)
    } catch (e) {
      const failure = shareFailure(e)
      if (failure === 'closed') setNotice('Not exported: the share sheet closed before the file went anywhere. Share the file again when ready.')
      else if (failure === 'needs-tap') setNotice('The phone wants a fresh tap before it shares. Tap Share the file again.')
      else {
        // The sheet itself failed: the same file goes through a download link instead.
        setReady({ ...file, route: 'download', url: URL.createObjectURL(file.file) })
        setError(`The share sheet failed (${errorWords(e)}). Save the file with the link instead.`)
      }
    } finally {
      setBusy(false)
    }
  }

  function downloaded(file: ReadyFile): void {
    setNotice(`${file.name} is saving to Downloads. Keep a copy off this phone: in Files on iCloud Drive, or on a Mac.`)
    setError(null)
    void onExported(file.exportedAt)
  }

  return (
    <Section label="Export" saved={saved} problem={problem}>
      <p ref={firstLine} className="text-body text-on-dark">
        {lastExportWords(lastExportedAt, today, timeZone)}
      </p>
      <Note>One JSON file with everything on this phone. iOS can clear a home-screen app’s storage when it goes unused, so keep a recent file somewhere else.</Note>
      <Button wide disabled={busy} onClick={() => void prepare()}>
        {busy && !ready ? 'Reading…' : ready ? 'Export JSON again' : 'Export JSON'}
      </Button>
      {ready ? (
        <>
          <p className="text-body text-on-dark-dim wrap-anywhere">
            {ready.name}: {holdsLine(ready.summary)}
          </p>
          {ready.unreadable.length > 0 ? (
            <div role="alert" className="flex flex-col gap-1">
              <p className="text-body text-on-dark">
                {ready.unreadable.length === 1 ? 'One row' : `${ready.unreadable.length} rows`} on this phone no longer read as the app stores them. The file keeps them as
                they are, but importing it would be refused until they are fixed:
              </p>
              <ul className="flex list-disc flex-col gap-1 pl-6">
                {ready.unreadable.map((line) => (
                  <li key={line} className="text-small text-on-dark-dim wrap-anywhere">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {ready.route === 'share' ? (
            <Button variant="primary" wide disabled={busy} onClick={() => void share(ready)}>
              {busy ? 'Sharing…' : 'Share the file'}
            </Button>
          ) : ready.url ? (
            <a href={ready.url} download={ready.name} onClick={() => downloaded(ready)} className={LINK_BUTTON}>
              Save {ready.name}
            </a>
          ) : null}
        </>
      ) : null}
      {notice ? (
        <p role="status" className="text-body text-on-dark">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-body text-on-dark">
          {error}
        </p>
      ) : null}
    </Section>
  )
}
