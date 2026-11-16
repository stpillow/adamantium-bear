import { useEffect, useId, useRef, useState } from 'react'
import { useEngineMode } from '../app/mode.ts'
import { navigate, replaceRoute } from '../app/router.ts'
import { PROGRAM, availableAt } from '../app/session.ts'
import { useToday } from '../app/today.ts'
import { Button } from '../components/Button.tsx'
import { Choice, Note, Section } from '../components/FormParts.tsx'
import { Screen } from '../components/Screen.tsx'
import { useActiveLocation, useDownPeriods, useLocations, useProgramOverrides, useSettings } from '../db/hooks.ts'
import { addExtra, addLocation, markOff, removeExtra, renameLocation, setActiveLocation, setDumbbellMax, setKit, setPresent } from '../db/repo.ts'
import { usedEquipment, type Available } from '../rules/equipment.ts'
import { extraTooLong } from '../rules/locations.ts'
import { itemOutcome, notHereWrite, typedOutcome, type TypedOutcome } from '../rules/whereYouTrain.ts'
import type { DownPeriod, EquipmentId, IsoDate, Location, ProgramOverride, Settings } from '../schema/index.ts'
import {
  DEFAULT_START,
  KEEP_AS_TYPED,
  START_CHOICES,
  changesView,
  coverageWeek,
  extraTooLongWords,
  keptRows,
  kitAfter,
  markedWords,
  nameCheck,
  nameCountWords,
  outcomeWords,
  removedExtraWords,
  removeExtraAsk,
  startWords,
  startedFromWords,
  templatesAsRun,
  type KeptRow,
} from './LocationEditor.helpers.ts'
import { failedWords } from './Locations.helpers.ts'
import { EquipmentChecklist, KitList, RackPicker } from './location/parts.tsx'

const USED = usedEquipment(PROGRAM.exercises)
const BY_ID = new Map(PROGRAM.exercises.map((e) => [e.id, e]))
const FLASH_MS = 1500
const STILL = 'the screen shows what the phone still has.'

/**
 * A gym just made by New: its editor opens in place of the New form, says it was saved, and waits
 * for the gyms' live query to bring the row instead of reading as "no such gym" for a moment.
 */
let justCreated: { id: string; notice: string } | null = null

/**
 * The location editor (`#/location/:id`, `#/location/new`; design section 5). A new gym takes a
 * name, where its list starts and its dumbbells, then opens here; a stored gym's every change saves
 * at once: name, dumbbells, each checklist item Here or Not here, the bag, typed equipment, with
 * "What this changes" saying what moves there. Decisions come from src/rules; writes go through the repo.
 */
export function LocationEditor({ locationId }: { locationId: string | null }) {
  const locations = useLocations()
  const settings = useSettings()
  const active = useActiveLocation()
  // The Program screen's edits: "What this changes" reads the lists the sessions run.
  const overrides = useProgramOverrides()
  // A down period holds the phase-week bands, so "What this changes" reads the slots Today plans (PROGRAM-QUESTIONS 188).
  const downPeriods = useDownPeriods()

  if (locations === undefined || settings === undefined || active === undefined || overrides === undefined || downPeriods === undefined) return <Opening />
  if (settings === null || active === null) {
    return (
      <Screen title="Location" lead="This phone isn’t set up yet.">
        <Button wide onClick={() => navigate({ name: 'welcome' })}>
          Set up
        </Button>
      </Screen>
    )
  }
  if (locationId === null) return <NewLocation locations={locations} />
  const location = locations.find((l) => l.id === locationId)
  if (!location) {
    if (justCreated?.id === locationId) return <Opening />
    return (
      <Screen title="No such gym" lead="Nothing on this phone has that link.">
        <Button wide onClick={() => navigate({ name: 'locations' })}>
          Where you train
        </Button>
      </Screen>
    )
  }
  return <EditLocation key={location.id} location={location} locations={locations} settings={settings} activeId={active.id} overrides={overrides} downPeriods={downPeriods} />
}

function Opening() {
  return (
    <Screen title="Location" lead="Opening storage…">
      <p className="text-body text-on-dark-dim">The gyms load from the phone.</p>
    </Screen>
  )
}

/** New: name, where the list starts (Planet Fitness's, preselected, or empty) and the rack; Add makes it and opens its editor. */
function NewLocation({ locations }: { locations: Location[] }) {
  const today = useToday()
  const nameId = useId()
  const [name, setName] = useState('')
  const [startedFrom, setStartedFrom] = useState<Location['startedFrom']>(DEFAULT_START)
  const [rack, setRack] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const check = nameCheck(name, locations, null)

  const create = async () => {
    if (!check.ok) {
      setProblem(check.message)
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      const created = await addLocation({ name: check.name, startedFrom, dumbbellMaxLb: rack, createdOn: today }, PROGRAM)
      justCreated = { id: created.id, notice: `${created.name} is saved. Mark what it has; each change saves at once.` }
      replaceRoute({ name: 'location', locationId: created.id })
    } catch (e: unknown) {
      setProblem(failedWords('The new gym', e, 'nothing was added.'))
      setBusy(false)
    }
  }

  return (
    <Screen title="New location" lead="Name it, pick where its list starts and its dumbbells; then mark what it has.">
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <Section label="Name" saved={false} problem={null}>
          <label htmlFor={nameId} className="text-body text-on-dark-dim">
            What you will call it on Today
          </label>
          <input
            id={nameId}
            type="text"
            autoComplete="off"
            enterKeyHint="done"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              // A refusal speaks to the name as it was; typing again starts it over.
              setProblem(null)
            }}
            className="tap w-full rounded-sm bg-ink px-3 text-body text-on-dark"
          />
          <Note>{nameCountWords(name)}</Note>
        </Section>

        <Section label="Start" saved={false} problem={null}>
          <div role="radiogroup" aria-label="Where its list starts" className="flex flex-col gap-2">
            {START_CHOICES.map((choice) => (
              <Choice key={choice.value} label={choice.label} selected={startedFrom === choice.value} onSelect={() => setStartedFrom(choice.value)} />
            ))}
          </div>
          <Note>{startWords(startedFrom)}</Note>
        </Section>

        <Section label="Dumbbells" saved={false} problem={null}>
          <RackPicker value={rack} onChange={setRack} />
        </Section>

        {problem ? (
          <p role="alert" className="text-body text-on-dark wrap-anywhere">
            {problem}
          </p>
        ) : null}
        <Button type="submit" variant="primary" wide className="wrap-anywhere" disabled={busy}>
          {busy ? 'Saving…' : check.ok ? `Add ${check.name}` : 'Add this gym'}
        </Button>
        <Button variant="quiet" wide onClick={() => navigate({ name: 'locations' })}>
          Back to Where you train
        </Button>
      </form>
    </Screen>
  )
}

type Field = 'name' | 'rack' | 'kit' | 'typed' | 'kept' | 'use' | `group:${string}`
type Problem = { field: Field; text: string } | null

function EditLocation({
  location,
  locations,
  settings,
  activeId,
  overrides,
  downPeriods,
}: {
  location: Location
  locations: Location[]
  settings: Settings
  activeId: string
  overrides: readonly ProgramOverride[]
  downPeriods: readonly DownPeriod[]
}) {
  const { mode } = useEngineMode()
  const today = useToday()
  const [savedField, flashSaved] = useFlash()
  const [problem, setProblem] = useState<Problem>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (justCreated?.id === location.id) {
      setNotice(justCreated.notice)
      justCreated = null
    }
  }, [location.id])

  /** Writes, then says Saved by the section; a rejected write is one sentence there, and the stored row stays on screen. */
  async function run(field: Field, write: () => Promise<unknown>): Promise<boolean> {
    setProblem(null)
    try {
      await write()
      flashSaved(field)
      return true
    } catch (e: unknown) {
      setProblem({ field, text: failedWords('That', e, STILL) })
      return false
    }
  }

  const problemFor = (field: Field) => (problem?.field === field ? problem.text : null)
  const available = availableAt({ location, kit: settings.kit })
  const isActive = location.id === activeId
  const changes = changesView({
    templates: templatesAsRun(settings, overrides),
    phase: settings.currentPhase,
    phaseWeek: coverageWeek(settings, today, downPeriods, mode),
    phaseEnteredWeek: settings.phaseEnteredWeek,
    byId: BY_ID,
    available,
    items: PROGRAM.equipment,
    gymName: location.name,
  })
  const kept = keptRows(location, PROGRAM.equipment, PROGRAM.exercises)

  const mark = (group: string, itemId: EquipmentId, here: boolean) =>
    void run(`group:${group}`, async () => {
      if (here) await setPresent(location.id, itemId, true)
      else if (notHereWrite(location, itemId, PROGRAM.equipment, PROGRAM.planetFitness) === 'mark-off') await markOff(location.id, itemId, today)
      else await setPresent(location.id, itemId, false)
    })

  const lead = [startedFromWords(location.startedFrom), isActive ? 'Active: Today plans here.' : null, 'Each change saves on its own.'].filter(Boolean).join(' ')

  return (
    <Screen title={location.name} lead={lead}>
      {notice ? (
        <p role="status" className="text-body text-on-dark wrap-anywhere">
          {notice}
        </p>
      ) : null}
      {location.archived ? <p className="text-body text-on-dark">Archived: it has left the lists, and its sessions still point at it.</p> : null}
      {!isActive && !location.archived ? (
        <div className="flex flex-col gap-2">
          <Button wide className="wrap-anywhere" onClick={() => void run('use', () => setActiveLocation(location.id))}>
            Use {location.name} here
          </Button>
          {problemFor('use') ? (
            <p role="alert" className="text-body text-on-dark">
              {problemFor('use')}
            </p>
          ) : null}
        </div>
      ) : null}

      <NameSection location={location} locations={locations} saved={savedField === 'name'} problem={problemFor('name')} onSave={(name) => void run('name', () => renameLocation(location.id, name))} />

      <Section label="Dumbbells" saved={savedField === 'rack'} problem={problemFor('rack')}>
        <RackDraft stored={location.dumbbellMaxLb} onSave={(lb) => run('rack', () => setDumbbellMax(location.id, lb))} />
      </Section>

      <EquipmentChecklist
        location={location}
        kit={settings.kit}
        onToggle={mark}
        saved={(group) => savedField === `group:${group}`}
        problem={(group) => problemFor(`group:${group}`)}
      />

      <Section label="In your bag (every gym)" saved={savedField === 'kit'} problem={problemFor('kit')}>
        <KitDraft stored={settings.kit} onSave={(kit) => run('kit', () => setKit(kit))} />
        <Note>Carried to every gym, so a change here counts at all of them.</Note>
      </Section>

      <TypedSection
        location={location}
        available={available}
        today={today}
        saved={savedField === 'typed'}
        problem={problemFor('typed')}
        write={(w) => run('typed', w)}
      />

      <Section label="What this changes" saved={false} problem={null}>
        <p className="text-body text-on-dark wrap-anywhere">{changes.heading}</p>
        {changes.sessions.map((session) => (
          <div key={session.label} className="flex flex-col gap-1">
            <h3 className="font-mono text-small uppercase tracking-[0.22em] text-on-dark-muted">{session.label}</h3>
            <ul className="flex flex-col gap-1 text-body text-on-dark-dim">
              {session.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ))}
      </Section>

      <Section label="Kept for the next program update" saved={savedField === 'kept'} problem={problemFor('kept')}>
        {kept.length > 0 ? <KeptList rows={kept} onRemove={(extraId) => run('kept', () => removeExtra(location.id, extraId))} /> : <p className="text-body text-on-dark-dim">Nothing yet. What you type that no exercise uses is kept here.</p>}
        <Button variant="quiet" onClick={() => navigate({ name: 'next-update' })}>
          For the next program update
        </Button>
      </Section>

      <Button variant="quiet" wide onClick={() => navigate({ name: 'locations' })}>
        Back to Where you train
      </Button>
    </Screen>
  )
}

/** The name, saved when the field is left or Done is tapped; a name the rules refuse is said in words and nothing is written. */
function NameSection({
  location,
  locations,
  saved,
  problem,
  onSave,
}: {
  location: Location
  locations: Location[]
  saved: boolean
  problem: string | null
  onSave: (name: string) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState(location.name)
  const [refusal, setRefusal] = useState<string | null>(null)
  const editing = useRef(false)

  // A rename from elsewhere shows unless the field is being typed in.
  useEffect(() => {
    if (!editing.current) setDraft(location.name)
  }, [location.name])

  const commit = () => {
    editing.current = false
    const check = nameCheck(draft, locations, location.id)
    if (!check.ok) {
      setRefusal(check.message)
      return
    }
    setRefusal(null)
    setDraft(check.name)
    if (check.name !== location.name) onSave(check.name)
  }

  return (
    <Section label="Name" saved={saved} problem={problem}>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          commit()
        }}
      >
        <label htmlFor={id} className="text-body text-on-dark-dim">
          What you call it on Today
        </label>
        <input
          id={id}
          type="text"
          autoComplete="off"
          enterKeyHint="done"
          value={draft}
          onFocus={() => {
            editing.current = true
          }}
          onChange={(e) => {
            setDraft(e.target.value)
            // A refusal speaks to the name as it was; typing again starts it over.
            setRefusal(null)
          }}
          onBlur={commit}
          className="tap w-full rounded-sm bg-ink px-3 text-body text-on-dark"
        />
        <Note>{nameCountWords(draft)}</Note>
        {refusal ? (
          <p role="alert" className="text-body text-on-dark wrap-anywhere">
            {refusal}
          </p>
        ) : null}
      </form>
    </Section>
  )
}

/**
 * The stored rack with a draft in front of it: two quick taps on + count twice instead of both
 * starting from the value the phone hasn't echoed back yet. The stored value wins once no write is in flight.
 */
function RackDraft({ stored, onSave }: { stored: number; onSave: (lb: number) => Promise<boolean> }) {
  const [value, setValue] = useState(stored)
  const pending = useRef(0)
  useEffect(() => {
    if (pending.current === 0) setValue(stored)
  }, [stored])
  const change = async (lb: number) => {
    setValue(lb)
    pending.current += 1
    const ok = await onSave(lb)
    pending.current -= 1
    if (!ok && pending.current === 0) setValue(stored)
  }
  return <RackPicker value={value} onChange={(lb) => void change(lb)} />
}

/** The bag, with a draft in front of the stored kit so a second tap builds on the first. */
function KitDraft({ stored, onSave }: { stored: readonly EquipmentId[]; onSave: (kit: EquipmentId[]) => Promise<boolean> }) {
  const [kit, setKitDraft] = useState<readonly EquipmentId[]>(stored)
  const latest = useRef<readonly EquipmentId[]>(stored)
  const pending = useRef(0)
  useEffect(() => {
    if (pending.current === 0) {
      latest.current = stored
      setKitDraft(stored)
    }
  }, [stored])
  const change = async (id: EquipmentId, inBag: boolean) => {
    const next = kitAfter(latest.current, id, inBag, PROGRAM.equipment)
    latest.current = next
    setKitDraft(next)
    pending.current += 1
    const ok = await onSave(next)
    pending.current -= 1
    if (!ok && pending.current === 0) {
      latest.current = stored
      setKitDraft(stored)
    }
  }
  return <KitList kit={kit} onChange={(id, inBag) => void change(id, inBag)} />
}

type Typed = { typed: string; outcome: TypedOutcome; words: string }

/**
 * "Something else here?": typed text through `typedOutcome`. A known item asks before it is marked;
 * near misses are a button each plus "Neither: keep as typed"; text no exercise uses is kept at once.
 */
function TypedSection({
  location,
  available,
  today,
  saved,
  problem,
  write,
}: {
  location: Location
  available: Available
  today: IsoDate
  saved: boolean
  problem: string | null
  write: (w: () => Promise<unknown>) => Promise<boolean>
}) {
  const id = useId()
  const [text, setText] = useState('')
  const [result, setResult] = useState<Typed | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** Writes, then says what it came to; the field empties only if it still holds what was submitted, so text typed meanwhile stays. */
  const settle = async (w: () => Promise<unknown>, words: string, submitted: string) => {
    setBusy(true)
    const ok = await write(w)
    setBusy(false)
    if (ok) {
      setDone(words)
      setResult((r) => (r === null || r.typed === submitted ? null : r))
      setText((t) => (t === submitted ? '' : t))
    }
  }

  const add = () => {
    setDone(null)
    // Past 80 characters (a mistaken paste): said in words, and nothing is written.
    if (extraTooLong(text)) {
      setResult(null)
      setRefusal(extraTooLongWords(text))
      return
    }
    setRefusal(null)
    const outcome = typedOutcome(text, PROGRAM.equipment, USED, available)
    const words = outcomeWords(outcome, text, PROGRAM.equipment)
    if (outcome.kind === 'keep') return void settle(() => addExtra(location.id, text, today), words, text)
    if (outcome.kind === 'unused') return void settle(() => setPresent(location.id, outcome.id, true), words, text)
    setResult({ typed: text, outcome, words })
  }

  const pick = (itemId: EquipmentId, typed: string) => {
    const outcome = itemOutcome(itemId, PROGRAM.equipment, USED, available)
    if (outcome.kind === 'mark') return void settle(() => setPresent(location.id, itemId, true), markedWords(itemId, PROGRAM.equipment), typed)
    if (outcome.kind === 'unused') return void settle(() => setPresent(location.id, itemId, true), outcomeWords(outcome, typed, PROGRAM.equipment), typed)
    setResult({ typed, outcome, words: outcomeWords(outcome, typed, PROGRAM.equipment) })
  }

  const nameOf = (itemId: EquipmentId) => PROGRAM.equipment.find((i) => i.id === itemId)?.name ?? itemId
  const outcome = result?.outcome ?? null

  return (
    <Section label="Something else here?" saved={saved} problem={problem}>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <label htmlFor={id} className="text-body text-on-dark-dim">
          Equipment the list above doesn’t show
        </label>
        <input
          id={id}
          type="text"
          autoComplete="off"
          enterKeyHint="done"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setResult(null)
            setDone(null)
            setRefusal(null)
          }}
          className="tap w-full rounded-sm bg-ink px-3 text-body text-on-dark"
        />
        <Button type="submit" wide disabled={busy}>
          Add
        </Button>
      </form>
      {refusal ? (
        <p role="alert" className="text-body text-on-dark wrap-anywhere">
          {refusal}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="text-body text-on-dark wrap-anywhere">
          {done}
        </p>
      ) : null}
      {result ? (
        <div className="flex flex-col gap-2">
          <p role="status" className="text-body text-on-dark wrap-anywhere">
            {result.words}
          </p>
          {outcome?.kind === 'mark' ? (
            <Button
              variant="primary"
              wide
              disabled={busy}
              onClick={() => void settle(() => setPresent(location.id, outcome.id, true), markedWords(outcome.id, PROGRAM.equipment), result.typed)}
            >
              Mark {nameOf(outcome.id)} here
            </Button>
          ) : null}
          {outcome?.kind === 'choose' ? (
            <>
              {outcome.ids.map((itemId) => (
                <Button key={itemId} wide disabled={busy} onClick={() => pick(itemId, result.typed)}>
                  {nameOf(itemId)}
                </Button>
              ))}
              <Button
                variant="quiet"
                wide
                disabled={busy}
                onClick={() => void settle(() => addExtra(location.id, result.typed, today), outcomeWords({ kind: 'keep' }, result.typed, PROGRAM.equipment), result.typed)}
              >
                {KEEP_AS_TYPED}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </Section>
  )
}

/**
 * The gym's next-update lines, each typed one with a Remove that asks once, inline, as Archive does
 * (a typo or a mistaken paste comes off the list); a list item comes off by marking it Not here.
 */
function KeptList({ rows, onRemove }: { rows: readonly KeptRow[]; onRemove: (extraId: string) => Promise<boolean> }) {
  const [armed, setArmed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [removed, setRemoved] = useState<string | null>(null)
  const remove = async (extraId: string, typed: string) => {
    setBusy(true)
    const ok = await onRemove(extraId)
    setBusy(false)
    if (ok) {
      setArmed(null)
      setRemoved(removedExtraWords(typed))
    }
  }
  return (
    <div className="flex flex-col gap-2">
      {removed ? (
        <p role="status" className="text-body text-on-dark wrap-anywhere">
          {removed}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2 text-body text-on-dark-dim">
        {rows.map(({ key, text, extraId, typed }) => (
          <li key={key} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 wrap-anywhere">{text}</span>
              {extraId !== null && armed !== extraId ? (
                <Button
                  variant="quiet"
                  className="shrink-0"
                  disabled={busy}
                  onClick={() => {
                    setRemoved(null)
                    setArmed(extraId)
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </div>
            {extraId !== null && typed !== null && armed === extraId ? (
              <div className="flex flex-col gap-2">
                <p className="text-body text-on-dark wrap-anywhere">{removeExtraAsk(typed)}</p>
                <Button wide disabled={busy} onClick={() => void remove(extraId, typed)}>
                  Yes, remove it
                </Button>
                <Button variant="quiet" wide disabled={busy} onClick={() => setArmed(null)}>
                  Keep it
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Which section just saved, for the Saved word that shows for a moment. */
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
