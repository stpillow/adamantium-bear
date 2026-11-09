import { useEffect, useId, useState } from 'react'
import { backTo, navigate, navigateFrom, replaceRoute } from '../app/router.ts'
import { PROGRAM } from '../app/session.ts'
import { canonicalZone, deviceTimeZone, supportedTimeZones } from '../app/timeZone.ts'
import { useTodayIn } from '../app/today.ts'
import { Button } from '../components/Button.tsx'
import { Choice, Note, Section } from '../components/FormParts.tsx'
import { Screen } from '../components/Screen.tsx'
import { replaceAll } from '../db/backup.ts'
import { useLocations } from '../db/hooks.ts'
import { onboard, requestPersistentStorage } from '../db/repo.ts'
import { comingMonday, todayIn } from '../rules/calendar.ts'
import { withPresent } from '../rules/locations.ts'
import type { Backup } from '../rules/backup.ts'
import { PLANET_FITNESS_LOCATION_ID, type Location } from '../schema/index.ts'
import { forgetFirstRunDraft, firstRunDraft, keepFirstRunDraft, leaveNotice, takeNotice } from './firstRun.ts'
import { START_CHOICES, kitAfter, nameCheck, nameCountWords, startWords } from './LocationEditor.helpers.ts'
import { EquipmentChecklist, KitList, RackPicker } from './location/parts.tsx'
import { SIDES, checkStartDate, errorWords, sideWords, weekLine, zoneOptions, zoneWords } from './Settings.helpers.ts'
import { ImportSection, StartDatePicker } from './settings/parts.tsx'
import {
  FIRST_RUN_STEPS,
  IMPORT_NOTE,
  comingMondayWords,
  firstRunProblems,
  newFirstRunDraft,
  nextStep,
  readyLines,
  startFailedWords,
  stepProblem,
  stepToShow,
  stepWords,
  withListStart,
  withZone,
  zoneStepLines,
  type FirstRunDraft,
  type FirstRunStep,
} from './Welcome.helpers.ts'

/**
 * First run (M-U1, `#/welcome`; PROGRAM-QUESTIONS 207, 208): shown only on a phone with no settings
 * row. Its first screen imports a backup (which skips the rest) or starts six short steps: injured
 * side, start date, home gym, what it has and the bag, time zone, then a summary with Start the
 * program. A screen, not a modal: each step is a hash, so the back gesture steps back. Every step
 * but the side takes the default it shows; none can be left empty. Dates here count in the zone the
 * draft proposes (the phone's own until changed), since nothing is stored yet.
 */
export function Welcome({ step, storedZone }: { step: FirstRunStep | undefined; storedZone: string | null }) {
  const [device] = useState(deviceTimeZone)
  const [draft, setDraftState] = useState<FirstRunDraft>(() => {
    const zone = storedZone ?? device
    return firstRunDraft() ?? newFirstRunDraft(todayIn(new Date(), zone), zone, PROGRAM)
  })
  const today = useTodayIn(draft.zone)
  const locations = useLocations()
  const setDraft = (next: FirstRunDraft) => {
    keepFirstRunDraft(next)
    setDraftState(next)
  }

  if (locations === undefined) {
    return (
      <Screen title="Set up Knee Rebuild" lead="Opening storage…">
        <p className="text-body text-on-dark-dim">Reading what is on this phone.</p>
      </Screen>
    )
  }
  if (step === undefined) return <FirstScreen today={today} zone={draft.zone} />
  return <Step asked={step} draft={draft} setDraft={setDraft} today={today} device={device} locations={locations} />
}

/** The first screen: Set up this phone, or a backup from another phone, which brings everything and skips the questions. */
function FirstScreen({ today, zone }: { today: string; zone: string }) {
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    // Reset all data leaves its sentence here, where the app goes once everything is erased.
    const text = takeNotice('welcome')
    if (text !== null) setNotice(text)
  }, [])

  async function importFile(backup: Backup, done: string): Promise<void> {
    // Today opens as soon as the settings land, before this resolves: its sentence waits there.
    leaveNotice('today', done)
    try {
      await replaceAll(backup, PROGRAM, today)
    } catch (e) {
      leaveNotice('today', null)
      throw e
    }
    forgetFirstRunDraft()
    void requestPersistentStorage()
  }

  return (
    <Screen title="Set up Knee Rebuild" lead="A few answers, then Today. Nothing leaves this phone.">
      {notice ? (
        <p role="status" className="text-body text-on-dark">
          {notice}
        </p>
      ) : null}
      <Button variant="primary" wide onClick={() => navigateFrom({ name: 'welcome', step: 'side' }, { name: 'welcome' })}>
        Set up this phone
      </Button>
      <Note>{IMPORT_NOTE}</Note>
      <ImportSection today={today} timeZone={zone} held={null} onReplace={importFile} firstRun />
    </Screen>
  )
}

function Step({
  asked,
  draft,
  setDraft,
  today,
  device,
  locations,
}: {
  asked: FirstRunStep
  draft: FirstRunDraft
  setDraft: (next: FirstRunDraft) => void
  today: string
  device: string
  locations: readonly Location[]
}) {
  const shown = stepToShow(asked, draft, locations)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // A link to a step further on than the answers reach opens the first one not answered yet.
  useEffect(() => {
    if (shown !== asked) replaceRoute({ name: 'welcome', step: shown })
  }, [shown, asked])
  // A problem speaks to the step it was shown on.
  useEffect(() => {
    setProblem(null)
  }, [shown])

  const words = stepWords(shown)
  const index = FIRST_RUN_STEPS.indexOf(shown)
  // A step reached with Next steps back through history, so the back gesture after it doesn't land on
  // the same step again; one reached by a link, a redirect or Change replaces itself in place.
  const back = () => backTo(index === 0 ? { name: 'welcome' } : { name: 'welcome', step: FIRST_RUN_STEPS[index - 1] ?? 'side' })
  const change = (next: FirstRunDraft) => {
    setProblem(null)
    setDraft(next)
  }
  const storedHome = locations.find((l) => l.id === PLANET_FITNESS_LOCATION_ID) ?? null

  const next = () => {
    const why = stepProblem(draft, shown, locations)
    if (why !== null) {
      setProblem(why)
      return
    }
    setDraft({ ...draft, seen: draft.seen.includes(shown) ? draft.seen : [...draft.seen, shown] })
    const following = nextStep(shown)
    if (following) navigateFrom({ name: 'welcome', step: following }, { name: 'welcome', step: shown })
  }

  const start = async () => {
    const [first] = firstRunProblems(draft, locations)
    if (first) {
      navigate({ name: 'welcome', step: first.step })
      return
    }
    const date = checkStartDate(draft.startDate)
    const name = nameCheck(draft.gymName, locations, PLANET_FITNESS_LOCATION_ID)
    if (!date.ok || !name.ok || draft.injuredSide === null) return
    setBusy(true)
    setProblem(null)
    try {
      await onboard({ injuredSide: draft.injuredSide, startDate: date.date, home: { ...draft.home, name: name.name }, kit: draft.kit, timeZone: canonicalZone(draft.zone) })
      forgetFirstRunDraft()
      void requestPersistentStorage()
      // In place of this step: the back gesture from Today doesn't walk back through the answers.
      replaceRoute({ name: 'today' })
    } catch (e) {
      setProblem(startFailedWords(errorWords(e)))
      setBusy(false)
    }
  }

  return (
    <Screen title={words.title} lead={words.lead}>
      {shown === 'side' ? <SideStep draft={draft} change={change} /> : null}
      {shown === 'start' ? <StartStep draft={draft} change={change} today={today} /> : null}
      {shown === 'gym' ? <GymStep draft={draft} change={change} storedHome={storedHome} /> : null}
      {shown === 'equipment' ? <EquipmentStep draft={draft} change={change} /> : null}
      {shown === 'time' ? <TimeStep draft={draft} change={change} today={today} device={device} /> : null}
      {shown === 'ready'
        ? readyLines(draft, today, PROGRAM.equipment, storedHome).map((line) => (
            <div key={line.step} className="flex items-start justify-between gap-3 border-t border-on-dark-faint pt-3">
              <p className="min-w-0 text-body text-on-dark wrap-anywhere">{line.text}</p>
              <Button variant="quiet" className="shrink-0" onClick={() => navigate({ name: 'welcome', step: line.step })}>
                Change
              </Button>
            </div>
          ))
        : null}
      {problem ? (
        <p role="alert" className="text-body text-on-dark wrap-anywhere">
          {problem}
        </p>
      ) : null}
      {shown === 'ready' ? (
        <Button variant="primary" wide disabled={busy} onClick={() => void start()}>
          {busy ? 'Saving…' : words.next}
        </Button>
      ) : (
        <Button variant="primary" wide onClick={next}>
          {words.next}
        </Button>
      )}
      <Button variant="quiet" wide disabled={busy} onClick={back}>
        Back
      </Button>
    </Screen>
  )
}

type StepProps = { draft: FirstRunDraft; change: (next: FirstRunDraft) => void }

function SideStep({ draft, change }: StepProps) {
  return (
    <Section label="Injured side" saved={false} problem={null}>
      <div role="radiogroup" aria-label="Injured side" className="flex flex-col gap-2">
        {SIDES.map((side) => (
          <Choice key={side} label={sideWords(side)} selected={draft.injuredSide === side} selectedWord="Injured" onSelect={() => change({ ...draft, injuredSide: side })} />
        ))}
      </div>
      <Note>Unilateral slots log this side first; its reps set the healthy side’s budget. Settings can change it later.</Note>
    </Section>
  )
}

function StartStep({ draft, change, today }: StepProps & { today: string }) {
  const check = checkStartDate(draft.startDate)
  const monday = comingMonday(today)
  return (
    <Section label="Start date" saved={false} problem={null}>
      <StartDatePicker value={draft.startDate} onChange={(value) => change({ ...draft, startDate: value, startTouched: true })} />
      {draft.startDate !== monday ? (
        <Button wide onClick={() => change({ ...draft, startDate: monday, startTouched: false })}>
          {comingMondayWords(today)}
        </Button>
      ) : null}
      {check.ok ? <Note>{weekLine(today, check.date)}</Note> : null}
      <Note>Every week, deload and gate counts from this Monday; Settings can change it later.</Note>
    </Section>
  )
}

function GymStep({ draft, change, storedHome }: StepProps & { storedHome: Location | null }) {
  const nameId = useId()
  const [asking, setAsking] = useState<Location['startedFrom'] | null>(null)
  const pick = (startedFrom: Location['startedFrom']) => {
    if (startedFrom === draft.home.startedFrom) return
    if (draft.equipmentTouched) setAsking(startedFrom)
    else change(withListStart(draft, startedFrom, PROGRAM))
  }
  return (
    <>
      {storedHome ? <Note>This phone already has a home gym, {storedHome.name}. It is kept as it is; these answers aren’t used for it.</Note> : null}
      <Section label="Name" saved={false} problem={null}>
        <label htmlFor={nameId} className="text-body text-on-dark-dim">
          What you will call it on Today
        </label>
        <input
          id={nameId}
          type="text"
          autoComplete="off"
          enterKeyHint="done"
          value={draft.gymName}
          onChange={(e) => change({ ...draft, gymName: e.target.value })}
          className="tap w-full rounded-sm bg-ink px-3 text-body text-on-dark"
        />
        <Note>{nameCountWords(draft.gymName)}</Note>
      </Section>
      <Section label="Start" saved={false} problem={null}>
        <div role="radiogroup" aria-label="Where its list starts" className="flex flex-col gap-2">
          {START_CHOICES.map((choice) => (
            <Choice key={choice.value} label={choice.label} selected={draft.home.startedFrom === choice.value} onSelect={() => pick(choice.value)} />
          ))}
        </div>
        <Note>{startWords(draft.home.startedFrom)}</Note>
        {asking ? (
          <div role="group" aria-label="Start over?" className="flex flex-col gap-2">
            <p className="text-body text-on-dark">Starting over clears the marks you made on the next step.</p>
            <Button
              wide
              onClick={() => {
                change(withListStart(draft, asking, PROGRAM))
                setAsking(null)
              }}
            >
              Yes, start over
            </Button>
            <Button variant="quiet" wide onClick={() => setAsking(null)}>
              Keep my marks
            </Button>
          </div>
        ) : null}
      </Section>
      <Section label="Dumbbells" saved={false} problem={null}>
        <RackPicker value={draft.home.dumbbellMaxLb} onChange={(lb) => change({ ...draft, home: { ...draft.home, dumbbellMaxLb: lb } })} />
      </Section>
    </>
  )
}

function EquipmentStep({ draft, change }: StepProps) {
  return (
    <>
      <EquipmentChecklist location={draft.home} kit={draft.kit} onToggle={(_group, itemId, here) => change({ ...draft, home: withPresent(draft.home, itemId, here), equipmentTouched: true })} />
      <Section label="What you bring" saved={false} problem={null}>
        <KitList kit={draft.kit} onChange={(id, inBag) => change({ ...draft, kit: kitAfter(draft.kit, id, inBag, PROGRAM.equipment) })} />
        <Note>Carried to every gym, so it counts at all of them; Where you train can change it later.</Note>
      </Section>
    </>
  )
}

function TimeStep({ draft, change, today, device }: StepProps & { today: string; device: string }) {
  const [supported] = useState(supportedTimeZones)
  return (
    <Section label="Time zone" saved={false} problem={null}>
      {zoneStepLines(device, draft.zone, today).map((line) => (
        <p key={line} className="text-body text-on-dark">
          {line}
        </p>
      ))}
      <select
        aria-label="Time zone"
        value={draft.zone}
        onChange={(e) => change(withZone(draft, e.target.value, todayIn(new Date(), e.target.value)))}
        className="tap w-full rounded-sm bg-ink px-3 text-body text-on-dark"
      >
        {zoneOptions(supported, draft.zone, device).map((group) => (
          <optgroup key={group.region} label={group.region}>
            {group.zones.map((z) => (
              <option key={z} value={z}>
                {zoneWords(z)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <Note>Settings can change it later; a trip of a few days needn’t.</Note>
    </Section>
  )
}
