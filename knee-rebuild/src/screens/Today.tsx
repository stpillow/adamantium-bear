import { useEffect, useId, useMemo, useState } from 'react'
import { navigate } from '../app/router.ts'
import { PROGRAM, availableAt, planSession, sessionExtensions, warmUpFor, windowFit } from '../app/session.ts'
import { useTimeZone } from '../app/timeZone.ts'
import { useToday } from '../app/today.ts'
import { takeNotice } from './firstRun.ts'
import { Button } from '../components/Button.tsx'
import { ReadingWord, readingSentence } from '../components/ReadingWord.tsx'
import { Stepper } from '../components/Stepper.tsx'
import { TimeWindow } from '../components/TimeWindow.tsx'
import { isExtraSlotId } from '../rules/extensions.ts'
import { Screen } from '../components/Screen.tsx'
import { useActiveLocation, useHistory, useKoosEntries, useLocations, useSettings } from '../db/hooks.ts'
import { clearMarkOff, declareDownPeriod, endDownPeriod, extendDownPeriod, putWorkout, reopenWorkout, resumeDownPeriod, setActiveLocation, writeWindow, type History } from '../db/repo.ts'
import { addDays, nextLiftDate, scheduledSession, todayIn } from '../rules/calendar.ts'
import { gymToOffer, lastLoggedGym, liftGym } from '../rules/gymDay.ts'
import { listedLocations } from '../rules/locations.ts'
import type { EquipmentId, IsoDate, Location, Settings } from '../schema/index.ts'
import { nextLiftWords } from './Preview.helpers.ts'
import { openSettingsAtExport } from './Settings.tsx'
import { windowWords } from './Window.helpers.ts'
import {
  NEW_LOCATION_HASH,
  atGymWords,
  declareWords,
  downPeriodErrorWords,
  earlierPhaseWords,
  extendWords,
  pastMidnightWords,
  pauseReplanWords,
  exportLine,
  koosLine,
  gymRows,
  liftChanges,
  markOffLines,
  movesHeading,
  newWorkout,
  newWorkoutId,
  openWorkoutWords,
  runLabel,
  runSuggestionAtGym,
  runWeekWords,
  startWords,
  todayView,
  type DownPeriodView,
  type OpenWorkout,
  type TodayBody,
  type TodayView,
  type YesterdayLine,
} from './Today.helpers.ts'

const LABEL = 'font-mono text-small uppercase tracking-[0.22em] text-on-dark-muted'
const SECTION = 'flex flex-col gap-4'
const HEADING = 'font-sans text-h3 font-medium text-on-dark'
const BY_ID = new Map(PROGRAM.exercises.map((e) => [e.id, e]))
/**
 * Words, a dot, then the control that acts on them ("At Planet Fitness · Change", "… since Nov 10 ·
 * It's back"), kept on one row: long words wrap inside their own box (a gym name runs to 60
 * characters, a single word included), so the control never drops to a line of its own at 375 px.
 */
const CONTROL_ROW = 'flex items-center gap-x-2'

type Lift = Extract<TodayBody, { kind: 'lift' }>

/**
 * The one thing he needs this morning: what today is, what it holds, how yesterday read, and a
 * Start button. Every verdict on screen comes from src/rules through todayView; this file renders.
 */
export function Today() {
  const today = useToday()
  const timeZone = useTimeZone()
  const settings = useSettings()
  const history = useHistory()
  const activeLocation = useActiveLocation()
  const locations = useLocations()
  // The KOOS entries feed only the quiet due line (Batch A); undefined while loading keeps the line off rather than wrong.
  const koosEntries = useKoosEntries()

  if (settings === undefined || history === undefined || activeLocation === undefined || locations === undefined || (settings !== null && activeLocation === null)) {
    return (
      <Screen title="Today" lead="Opening storage…">
        <p className="text-body text-on-dark-dim">Reading what is logged on this phone.</p>
      </Screen>
    )
  }
  if (settings === null || activeLocation === null) {
    return (
      <Screen title="Today" lead="This phone isn’t set up yet.">
        <p className="text-body text-on-dark-dim">The injured side, the start date and the home gym are set up first.</p>
        <Button wide onClick={() => navigate({ name: 'welcome' })}>
          Set up
        </Button>
      </Screen>
    )
  }

  const view = todayView({ today, settings, history, program: PROGRAM })
  if (view.body.kind === 'stop') {
    return (
      <Screen title="Today" lead={view.dateWords}>
        <StopBlock headline={view.body.headline} items={view.body.items} />
        <LateFlagsBlock notes={view.lateFlags} offerCheck={false} />
      </Screen>
    )
  }

  return (
    <Screen title="Today" lead={view.dateWords}>
      <ArrivedNotice />
      <GymBlock active={activeLocation} locations={locations} />
      <PhaseLine view={view} />
      {view.downPeriod ? <DownPeriodBlock view={view.downPeriod} today={today} openToday={view.body.kind === 'lift' && view.body.workout?.status === 'in-progress' ? view.body.label : null} /> : null}
      {view.body.kind === 'before-start' ? (
        <BeforeStartBlock line={view.body.line} />
      ) : view.body.kind === 'lift' ? (
        <LiftBlock body={view.body} settings={settings} history={history} active={activeLocation} locations={locations} today={today} />
      ) : view.body.kind === 'run' ? (
        <RunBlock body={view.body} gym={activeLocation} kit={settings.kit} />
      ) : (
        <OffBlock label={view.body.label} />
      )}
      {view.body.kind === 'run' || view.body.kind === 'off' || view.body.kind === 'before-start' ? <NextLiftLink today={today} settings={settings} history={history} /> : null}
      <LateFlagsBlock notes={view.lateFlags} offerCheck />
      <OpenWorkoutsBlock open={view.open} active={activeLocation} locations={locations} />
      <YesterdayBlock lines={view.yesterday} />
      <KoosLine line={koosLine(koosEntries, today)} />
      <ExportLine line={exportLine(settings.lastExportedAt, today, history, timeZone)} />
    </Screen>
  )
}

/** What a first-run import did (M-U1), said once on the Today it opened onto; nothing otherwise. */
function ArrivedNotice() {
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    const text = takeNotice('today')
    if (text !== null) setNotice(text)
  }, [])
  return notice ? (
    <p role="status" className="text-body text-on-dark wrap-anywhere">
      {notice}
    </p>
  ) : null
}

/**
 * A red flag ticked on a check logged late, for a past morning (Batch D, PROGRAM-QUESTIONS 175): a
 * note in words, never the stop. Under the stop it adds no way out; otherwise it points to this
 * morning's check, the one that can take over.
 */
function LateFlagsBlock({ notes, offerCheck }: { notes: string[]; offerCheck: boolean }) {
  if (notes.length === 0) return null
  return (
    <section aria-label="Red flag on a past morning" className={SECTION}>
      <h2 className={LABEL}>Red flag on a past morning</h2>
      {notes.map((note) => (
        <p key={note} className="text-body text-on-dark">
          {note}
        </p>
      ))}
      {offerCheck ? (
        <Button wide onClick={() => navigate({ name: 'morning' })}>
          This morning’s check
        </Button>
      ) : null}
    </section>
  )
}

/** Rule 9: the stop message takes the whole screen; nothing else is offered until it is cleared. */
function StopBlock({ headline, items }: { headline: string; items: string[] }) {
  return (
    <section aria-label="Red flag" className={SECTION}>
      <h2 className={HEADING}>{headline}</h2>
      <ul className="flex list-disc flex-col gap-2 pl-6">
        {items.map((item) => (
          <li key={item} className="text-body text-on-dark-dim">
            {item}
          </li>
        ))}
      </ul>
      <p className="text-body text-on-dark">Progression is suspended until this is cleared in Settings, with a note.</p>
      <Button wide onClick={() => navigate({ name: 'settings' })}>
        Settings
      </Button>
    </section>
  )
}

/**
 * "At Planet Fitness · Change" under the date. Change opens an inline list (no modal): each gym a
 * list offers, "✓ Active" on the active one, a tap on another makes it active, and "New location"
 * at the end opens the editor. The active gym's mark-offs follow, each with "It's back".
 */
function GymBlock({ active, locations }: { active: Location; locations: Location[] }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rows = gymRows(locations, active.id)
  const marks = markOffLines(active, PROGRAM.equipment)

  const use = async (id: string) => {
    if (id === active.id) {
      setOpen(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await setActiveLocation(id)
      setOpen(false)
    } catch (e: unknown) {
      setError(`Could not switch gyms (${e instanceof Error ? e.message : String(e)}). Today still plans at ${active.name}.`)
    } finally {
      setBusy(false)
    }
  }

  const back = async (itemId: EquipmentId) => {
    setBusy(true)
    setError(null)
    try {
      await clearMarkOff(active.id, itemId)
    } catch (e: unknown) {
      setError(`Could not clear the mark (${e instanceof Error ? e.message : String(e)}). It still counts as not here.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Where you train" className="flex flex-col gap-3">
      <div className={CONTROL_ROW}>
        <span className="min-w-0 text-body text-on-dark wrap-anywhere">{atGymWords(active)}</span>
        <span aria-hidden="true" className="shrink-0 text-body text-on-dark-muted">
          ·
        </span>
        <Button variant="quiet" className="shrink-0" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Change'}
        </Button>
      </div>
      {open ? (
        <ul aria-label="Gyms" className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                aria-pressed={row.active}
                disabled={busy}
                onClick={() => void use(row.id)}
                className={`tap flex w-full items-center justify-between gap-4 rounded-sm border px-4 py-3 text-left text-body disabled:opacity-50 ${
                  row.active ? 'border-paper bg-navy-lift text-on-dark' : 'border-on-dark-faint bg-transparent text-on-dark-dim'
                }`}
              >
                <span className="min-w-0 wrap-anywhere">{row.name}</span>
                <span className="shrink-0 whitespace-nowrap font-mono text-small uppercase tracking-[0.22em]">{row.mark}</span>
              </button>
            </li>
          ))}
          <li>
            <a href={NEW_LOCATION_HASH} className="tap flex w-full items-center justify-between gap-4 rounded-sm border border-on-dark-faint px-4 py-3 text-body text-on-dark">
              <span>New location</span>
              <span aria-hidden="true" className="font-mono text-small">
                +
              </span>
            </a>
          </li>
        </ul>
      ) : null}
      {marks.map((m) => (
        <div key={m.itemId} className={CONTROL_ROW}>
          <span className="min-w-0 text-body text-on-dark-dim wrap-anywhere">{m.words}</span>
          <span aria-hidden="true" className="shrink-0 text-body text-on-dark-muted">
            ·
          </span>
          <Button variant="quiet" className="shrink-0" disabled={busy} onClick={() => void back(m.itemId)}>
            It’s back
          </Button>
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-body text-on-dark">
          {error}
        </p>
      ) : null}
    </section>
  )
}

function PhaseLine({ view }: { view: TodayView }) {
  return (
    <section aria-label="Phase and week" className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-3">
        <span className={LABEL}>
          Phase {view.phaseNumber}
          {view.week !== null ? ` · Week ${view.week}` : ''}
        </span>
        {view.deload ? (
          <span className="rounded-sm border border-on-dark-faint px-2 py-1 font-mono text-label uppercase tracking-[0.22em] text-on-dark">Deload week</span>
        ) : null}
        {view.downPeriod?.kind === 'active' || view.downPeriod?.kind === 'ended-today' ? (
          <span className="rounded-sm border border-on-dark-faint px-2 py-1 font-mono text-label uppercase tracking-[0.22em] text-on-dark">Down period</span>
        ) : null}
      </div>
      <p className="text-body text-on-dark-dim">{view.phaseName}</p>
      {!view.phaseHasSessions ? (
        <p className="text-body text-on-dark-dim">Phase {view.phaseNumber}’s sessions are not written yet; its gate criteria are all the app carries.</p>
      ) : null}
    </section>
  )
}

/**
 * A down period (Batch E, PROGRAM-QUESTIONS 185): declared, made longer, ended or kept going here,
 * the one place, since a period always starts today and its status lives here. Each form opens
 * inline (no modal); each write asks the rule again in the repo, and a refusal is one sentence with
 * the form left open. The date is read again at the tap, so a form left open past midnight never
 * starts a period yesterday.
 */
function DownPeriodBlock({ view, today, openToday }: { view: DownPeriodView; today: IsoDate; openToday: string | null }) {
  const timeZone = useTimeZone()
  const noteId = useId()
  const [open, setOpen] = useState<'declare' | 'extend' | null>(null)
  const [days, setDays] = useState(view.kind === 'offer' ? view.defaultDays : 7)
  const [longer, setLonger] = useState(view.kind === 'active' && view.extend ? view.extend.days + 1 : 0)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function act(write: (now: IsoDate) => Promise<unknown>, after: string | null): Promise<void> {
    const now = todayIn(new Date(), timeZone)
    if (now !== today) {
      setProblem(pastMidnightWords(now))
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      await write(now)
      setOpen(null)
      setNote('')
      setDone(after)
    } catch (e) {
      setProblem(downPeriodErrorWords(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Down period" className="flex flex-col gap-3">
      {view.kind === 'offer' ? (
        <>
          <p className="text-body text-on-dark-dim">Not feeling 100%? Ill or run down, not the knee.</p>
          {open !== 'declare' ? (
            <Button wide onClick={() => { setOpen('declare'); setProblem(null); setDone(null) }}>
              Pause progression
            </Button>
          ) : (
            <div className="flex flex-col gap-3 rounded-sm border border-on-dark-faint p-3">
              <Stepper label="Days" value={days} min={view.minDays} max={view.maxDays} onChange={setDays} />
              <p className="text-body text-on-dark-dim">{declareWords(today, days).line}</p>
              <label htmlFor={noteId} className="text-body text-on-dark-dim">
                Note <span className="text-on-dark-muted">(optional)</span>
              </label>
              <input id={noteId} type="text" autoComplete="off" enterKeyHint="done" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} className="tap w-full rounded-sm bg-ink px-3 text-body text-on-dark" />
              <Button
                variant="primary"
                wide
                disabled={busy}
                onClick={() => void act((now) => declareDownPeriod({ today: now, days, declaredAt: new Date().toISOString(), ...(note.trim() ? { note } : {}) }), pauseReplanWords(openToday))}
              >
                {declareWords(today, days).button}
              </Button>
              <Button variant="quiet" wide disabled={busy} onClick={() => { setOpen(null); setProblem(null) }}>
                Not now
              </Button>
            </div>
          )}
        </>
      ) : view.kind === 'ahead' ? (
        <p className="text-body text-on-dark-dim">{view.line}</p>
      ) : (
        <>
          <p className="text-body text-on-dark">{view.line}</p>
          {view.note ? <p className="text-body text-on-dark-dim wrap-anywhere">Note: {view.note}</p> : null}
          {view.kind === 'ended-today' ? (
            <Button wide disabled={busy} onClick={() => void act((now) => resumeDownPeriod(view.id, now), null)}>
              Keep it going
            </Button>
          ) : (
            <>
              {view.lastDay ? <p className="text-body text-on-dark-dim">{view.lastDay}</p> : null}
              {view.canEnd ? (
                <Button wide disabled={busy} onClick={() => void act((now) => endDownPeriod(view.id, now), null)}>
                  End it today
                </Button>
              ) : null}
              {view.atCap ? <p className="text-body text-on-dark-dim">{view.atCap}</p> : null}
              {view.extend && open !== 'extend' ? (
                <Button variant="quiet" wide onClick={() => { setLonger(view.extend ? view.extend.days + 1 : longer); setOpen('extend'); setProblem(null) }}>
                  Make it longer
                </Button>
              ) : null}
              {view.extend && open === 'extend' ? (
                <div className="flex flex-col gap-3 rounded-sm border border-on-dark-faint p-3">
                  <Stepper label="Days in all" value={longer} min={view.extend.days + 1} max={view.extend.maxDays} onChange={setLonger} />
                  <ExtendButton start={view.start} days={longer} busy={busy} onExtend={(end) => void act((now) => extendDownPeriod(view.id, end, now), null)} />
                  <Button variant="quiet" wide disabled={busy} onClick={() => { setOpen(null); setProblem(null) }}>
                    Not now
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
      {problem ? (
        <p role="alert" className="text-body text-on-dark">
          {problem}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="text-body text-on-dark-dim">
          {done}
        </p>
      ) : null}
    </section>
  )
}

function ExtendButton({ start, days, busy, onExtend }: { start: IsoDate; days: number; busy: boolean; onExtend: (end: IsoDate) => void }) {
  const { end, button } = extendWords(start, days)
  return (
    <Button variant="primary" wide disabled={busy} onClick={() => onExtend(end)}>
      {button}
    </Button>
  )
}

function BeforeStartBlock({ line }: { line: string }) {
  return (
    <section aria-label="Scheduled session" className={SECTION}>
      <h2 className={HEADING}>{line}</h2>
      <p className="text-body text-on-dark-dim">Nothing is scheduled before then.</p>
      <Button variant="primary" wide disabled>
        Start
      </Button>
    </section>
  )
}

function LiftBlock({
  body,
  settings,
  history,
  active,
  locations,
  today,
}: {
  body: Lift
  settings: Settings
  history: History
  active: Location
  locations: Location[]
  today: IsoDate
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The minutes Shawn says he has; null is the full session. Remembered for the session at Start. */
  const [minutes, setMinutes] = useState<number | null>(null)
  const { template, workout, label, letter } = body
  /** The gym picked on the "Where are you training?" prompt; null keeps the one offered. */
  const [pickedId, setPickedId] = useState<string | null>(null)
  const loggedIds = useMemo(() => new Set(history.setLogs.map((s) => s.workoutId)), [history.setLogs])
  const listed = listedLocations(locations)
  // A session already started stays at its own gym. One still to start is offered at the gym the last
  // logged lift ran at (Nov 6), else the active gym, and Shawn can pick another here before Start.
  const offered = gymToOffer(lastLoggedGym(history.workouts, loggedIds, locations), active)
  const gym = workout === null ? (listed.find((l) => l.id === pickedId) ?? offered) : liftGym(workout, active, locations)

  const start = async () => {
    if (!template) return
    if (workout?.status === 'in-progress') {
      navigate({ name: 'session', workoutId: workout.id })
      return
    }
    if (workout?.status === 'abandoned') {
      // One workout per lift day: an attempt ended early today is reopened, its sets kept, never duplicated.
      setBusy(true)
      setError(null)
      try {
        await reopenWorkout(workout.id)
        writeWindow(workout.id, minutes)
        navigate({ name: 'session', workoutId: workout.id })
      } catch (e: unknown) {
        setError(`Could not reopen today’s session: ${e instanceof Error ? e.message : String(e)}.`)
      } finally {
        setBusy(false)
      }
      return
    }
    setBusy(true)
    setError(null)
    const id = newWorkoutId(today, template.id, history.workouts.map((w) => w.id))
    try {
      await putWorkout(
        newWorkout({
          id,
          date: today,
          templateId: template.id,
          phase: settings.currentPhase,
          week: body.week,
          isDeload: body.isDeload,
          startedAt: new Date().toISOString(),
          locationId: gym.id,
        }),
      )
      // Where he trains is where he is: the runs, the morning check and Today follow the gym he started at.
      if (gym.id !== active.id) await setActiveLocation(gym.id)
      writeWindow(id, minutes)
      navigate({ name: 'session', workoutId: id })
    } catch (e: unknown) {
      setError(`Could not save today’s session: ${e instanceof Error ? e.message : String(e)}.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Scheduled session" className={SECTION}>
      <h2 className={HEADING}>
        Session <span className="text-green-bright">{letter}</span>
      </h2>
      {!template ? (
        <>
          <p className="text-body text-on-dark-dim">
            No {label} is written for phase {settings.currentPhase}, so there is nothing to start.
          </p>
          <Button variant="primary" wide disabled>
            Start
          </Button>
        </>
      ) : workout?.status === 'finished' ? (
        <FinishedBlock body={body} />
      ) : workout?.status === 'abandoned' && body.earlierPhase !== null ? (
        // Ended early before the phase advanced: the day's lift is this one, so there is no second lift to start (PROGRAM-QUESTIONS 117).
        <p className="text-body text-on-dark-dim">{earlierPhaseWords(label, body.earlierPhase, PROGRAM.phases, settings.currentPhase)}</p>
      ) : (
        <>
          {workout?.status === 'in-progress' ? (
            <p className="text-body text-on-dark-dim">{label} is in progress. Pick up where you left off.</p>
          ) : workout?.status === 'abandoned' ? (
            <p className="text-body text-on-dark-dim">{label} was left early today; what was logged is kept. Resume to carry on in the same session.</p>
          ) : null}
          <MovesBlock template={template} week={workout?.week ?? body.week} before={workout?.date ?? today} label={label} gym={gym} settings={settings} history={history} />
          {workout === null ? (
            <Button variant="quiet" onClick={() => navigate({ name: 'preview', date: today })}>
              See the session first
            </Button>
          ) : null}
          {workout === null && listed.length > 1 ? <WhereBlock gyms={listed} chosen={gym.id} onPick={setPickedId} /> : null}
          {workout?.status !== 'in-progress' ? (
            <FitBlock template={template} week={workout?.week ?? body.week} before={workout?.date ?? today} gym={gym} settings={settings} history={history} minutes={minutes} onChange={setMinutes} />
          ) : null}
          <Button variant="primary" wide className="wrap-anywhere" disabled={busy} onClick={() => void start()}>
            {busy ? 'Saving…' : startWords(label, workout, gym, active)}
          </Button>
          {error ? (
            <p role="alert" className="text-body text-on-dark">
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}

/**
 * What changes at the session's gym, in words: read off the plan the runner runs there (the same
 * history, gym and date), so a slot its history moved, or the rack moves or caps, says so here too.
 */
function MovesBlock({
  template,
  week,
  before,
  label,
  gym,
  settings,
  history,
}: {
  template: NonNullable<Lift['template']>
  week: number
  before: IsoDate
  label: string
  gym: Location
  settings: Settings
  history: History
}) {
  const plans = planSession({ template, week, settings, history, gym: { location: gym, kit: settings.kit }, before })
  const moves = liftChanges({ plans, byId: BY_ID, items: PROGRAM.equipment, rackLb: gym.dumbbellMaxLb })
  return (
    <div className="flex flex-col gap-2">
      <p className={`wrap-anywhere ${moves.length === 0 ? 'text-small text-on-dark-muted' : 'text-body text-on-dark'}`}>{movesHeading(gym.name, label, moves.length)}</p>
      {moves.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-6">
          {moves.map((move, i) => (
            <li key={`${i}:${move}`} className="text-body text-on-dark-dim">
              {move}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** "Where are you training?" before Start: every listed gym, the chosen one marked with a word and a tick. */
function WhereBlock({ gyms, chosen, onPick }: { gyms: readonly Location[]; chosen: string; onPick: (id: string) => void }) {
  return (
    <section aria-label="Where you are training" className="flex flex-col gap-2">
      <h3 className="font-mono text-small font-normal uppercase tracking-[0.22em] text-on-dark-muted">Where are you training?</h3>
      <div role="radiogroup" aria-label="Where you are training" className="flex flex-col gap-2">
        {gyms.map((g) => {
          const selected = g.id === chosen
          return (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onPick(g.id)}
              className={`tap flex w-full items-center gap-2 rounded-sm border px-3 py-3 text-left text-body ${selected ? 'border-paper bg-navy-lift text-on-dark' : 'border-on-dark-faint bg-transparent text-on-dark-dim'}`}
            >
              <span className="shrink-0 font-mono text-small uppercase tracking-[0.22em]">{selected ? '✓' : '○'}</span>
              <span className="min-w-0 wrap-anywhere">{g.name}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** "Time you have" before Start: the plan's estimate and what fits (`windowFit`), in words. */
function FitBlock({
  template,
  week,
  before,
  gym,
  settings,
  history,
  minutes,
  onChange,
}: {
  template: NonNullable<Lift['template']>
  week: number
  before: IsoDate
  gym: Location
  settings: Settings
  history: History
  minutes: number | null
  onChange: (minutes: number | null) => void
}) {
  const extend = useMemo(() => sessionExtensions(template, history, settings, week, before), [template, history, settings, week, before])
  const plans = useMemo(() => planSession({ template, week, settings, history, gym: { location: gym, kit: settings.kit }, before, extend }), [template, week, settings, history, gym, before, extend])
  // Door to door (PROGRAM-QUESTIONS 166): the warm-up at this gym off the top, and the warm-up sets the runner will show counted.
  const warm = warmUpFor(template.phase, { location: gym, kit: settings.kit })
  const fit = windowFit(plans, settings.restTimerSeconds, minutes, { warmUpMinutes: warm.total, ramps: true })
  const nameOf = (slotId: string) => plans.find((p) => p.slot.id === slotId)?.exercise.name ?? slotId
  return <TimeWindow minutes={minutes} onChange={onChange} lines={windowWords(fit, minutes, plans.filter((p) => !isExtraSlotId(p.slot.id)).length, nameOf, warm)} />
}

function FinishedBlock({ body }: { body: Lift }) {
  return (
    <>
      <p className="text-body text-on-dark">{body.label} is done for today.</p>
      {body.reading ? (
        <div className="flex flex-col gap-1">
          <ReadingWord result={body.reading.result} />
          <p className="text-small text-on-dark-dim">{readingSentence(body.reading.result)}</p>
        </div>
      ) : null}
      {!body.checkDone ? <p className="text-small text-on-dark-muted">Tomorrow’s morning check completes this reading.</p> : null}
      <Button wide onClick={() => navigate({ name: 'morning' })}>
        Morning check
      </Button>
    </>
  )
}

function RunBlock({ body, gym, kit }: { body: Extract<TodayBody, { kind: 'run' }>; gym: Location; kit: readonly EquipmentId[] }) {
  // A swap is done at the active gym: a hold morning names the first machine there, and with neither, nothing is suggested (Shawn's Nov 1 answer 7).
  const s = body.suggestion ? runSuggestionAtGym(body.suggestion, { available: availableAt({ location: gym, kit }), gymName: gym.name, morning: body.morning }) : null
  return (
    <section aria-label="Scheduled session" className={SECTION}>
      <h2 className={HEADING}>{body.label}</h2>
      {body.note ? <p className="text-body text-on-dark-dim">{body.note}</p> : null}
      {body.loggedToday.length > 0 ? (
        <p className="text-body text-on-dark">
          ✓ Logged today: {body.loggedToday.map((r) => `${runLabel(r.type)}${r.miles > 0 ? `, ${r.miles} mi` : ''}`).join('; ')}.
        </p>
      ) : s ? (
        <div className="flex flex-col gap-1">
          <p className="text-body text-on-dark wrap-anywhere">{s.headline}</p>
          {s.reasons.map((r) => (
            <p key={r} className="text-small text-on-dark-dim">
              {r}
            </p>
          ))}
        </div>
      ) : null}
      <p className="text-small text-on-dark-dim">{runWeekWords(body)}</p>
      <Button variant={body.loggedToday.length > 0 ? 'secondary' : 'primary'} wide onClick={() => navigate({ name: 'run' })}>
        {body.loggedToday.length > 0 ? 'Log another run' : 'Log the run'}
      </Button>
    </section>
  )
}

function OffBlock({ label }: { label: string }) {
  return (
    <section aria-label="Scheduled session" className={SECTION}>
      <h2 className={HEADING}>{label}</h2>
      <p className="text-body text-on-dark-dim">Nothing to log today.</p>
    </section>
  )
}

/**
 * A session started and never closed cannot be read, whatever day it carries; say so, naming its gym
 * when that is not the active one, and offer the way back in.
 */
function OpenWorkoutsBlock({ open, active, locations }: { open: OpenWorkout[]; active: Location; locations: Location[] }) {
  if (open.length === 0) return null
  return (
    <section aria-label="Unfinished sessions" className="flex flex-col gap-3">
      {open.map((w) => (
        <div key={w.workoutId} className="flex items-center justify-between gap-4">
          <p className="min-w-0 text-body text-on-dark-dim wrap-anywhere">{openWorkoutWords(w, active, locations)}</p>
          <Button className="shrink-0" onClick={() => navigate({ name: 'session', workoutId: w.workoutId })}>
            Open
          </Button>
        </div>
      ))}
    </section>
  )
}

function YesterdayBlock({ lines }: { lines: YesterdayLine[] }) {
  const checkPending = lines.some((line) => !line.checkDone)
  return (
    <section aria-label="Yesterday" className="flex flex-col gap-3 border-t border-on-dark-faint pt-4">
      <span className={LABEL}>Yesterday</span>
      {lines.length === 0 ? (
        <p className="text-body text-on-dark-dim">No session yesterday.</p>
      ) : (
        lines.map((line, i) => (
          <div key={`${line.label}:${i}`} className="flex items-center justify-between gap-4">
            <span className="text-body text-on-dark">{line.label}</span>
            <ReadingWord result={line.result} />
          </div>
        ))
      )}
      {checkPending ? (
        <>
          <p className="text-small text-on-dark-muted">The morning check for it is not done yet.</p>
          <Button variant="quiet" onClick={() => navigate({ name: 'morning' })}>
            Morning check
          </Button>
        </>
      ) : null}
    </section>
  )
}

/** One quiet line once a KOOS check is 28+ days overdue (Batch A), with the way to the form; it carries no score — scores show on Progress only. */
function KoosLine({ line }: { line: string | null }) {
  if (line === null) return null
  return (
    <section aria-label="KOOS check" className={CONTROL_ROW}>
      <span className="min-w-0 text-small text-on-dark-muted">{line}</span>
      <span aria-hidden="true" className="shrink-0 text-small text-on-dark-muted">
        ·
      </span>
      <Button variant="quiet" className="shrink-0" onClick={() => navigate({ name: 'koos' })}>
        Open the form
      </Button>
    </section>
  )
}

/** One quiet line once the last export is over a week old (iOS can evict the app's storage), with the way to Settings' Export section. */
function ExportLine({ line }: { line: string | null }) {
  if (line === null) return null
  return (
    <section aria-label="Backup" className={CONTROL_ROW}>
      <span className="min-w-0 text-small text-on-dark-muted">{line}</span>
      <span aria-hidden="true" className="shrink-0 text-small text-on-dark-muted">
        ·
      </span>
      <Button variant="quiet" className="shrink-0" onClick={openSettingsAtExport}>
        Export
      </Button>
    </section>
  )
}

/** On a day with no lift, a way to look ahead: the next lift, by name and date, opens its preview. */
function NextLiftLink({ today, settings, history }: { today: IsoDate; settings: Settings; history: History }) {
  const date = nextLiftDate(addDays(today, 1), settings.startDate, PROGRAM.weeklyTemplate, history.sessionMoves)
  if (!date) return null
  const { session } = scheduledSession(date, settings.startDate, PROGRAM.weeklyTemplate, history.sessionMoves)
  if (!session) return null
  return (
    <Button variant="quiet" onClick={() => navigate({ name: 'preview', date })}>
      {nextLiftWords(date, session, PROGRAM.weeklyTemplateRows)}
    </Button>
  )
}

