import { useState } from 'react'
import { navigate } from '../app/router.ts'
import { PROGRAM, planSession, rampsInOrder, type SlotPlan } from '../app/session.ts'
import { useToday } from '../app/today.ts'
import { Button } from '../components/Button.tsx'
import { Screen } from '../components/Screen.tsx'
import { useActiveLocation, useHistory, useLocations, useSettings } from '../db/hooks.ts'
import { putWorkout } from '../db/repo.ts'
import { exerciseById } from '../program/program.ts'
import { gymToOffer, lastLoggedGym, liftGym } from '../rules/gymDay.ts'
import { lateLift } from '../rules/retro.ts'
import type { IsoDate, Location } from '../schema/index.ts'
import { previewSlots, previewView, type PreviewSlot, type PreviewView } from './Preview.helpers.ts'
import { shortDateWords } from './Today.helpers.ts'

const TITLE = 'Session preview'
const LABEL = 'font-mono text-small uppercase tracking-[0.22em] text-on-dark-muted'
const HEADING = 'font-sans text-h3 font-medium text-on-dark'
const nameOf = (exerciseId: string) => exerciseById(exerciseId).name

/**
 * A read-only look at one day's session before it comes round: every exercise with the sets, reps
 * and load the engine would prescribe from what's logged so far, at the gym it would run at, with
 * its cues. Today's Start stays on Today; a past lift day can be logged after the fact from here
 * (`lateLift`, PROGRAM-QUESTIONS 141). Every number comes from planSession.
 */
export function Preview({ date }: { date: IsoDate }) {
  const today = useToday()
  const settings = useSettings()
  const history = useHistory()
  const active = useActiveLocation()
  const locations = useLocations()

  if (settings === undefined || history === undefined || active === undefined || locations === undefined) {
    return (
      <Screen title={TITLE} lead="Opening storage…">
        <p className="text-body text-on-dark-dim">Reading what is logged on this phone.</p>
      </Screen>
    )
  }
  if (settings === null || active === null) {
    return (
      <Screen title={TITLE} lead="No settings yet.">
        <p className="text-body text-on-dark-dim">The start date sets the weeks; it lives in Settings.</p>
        <Button wide onClick={() => navigate({ name: 'settings' })}>
          Settings
        </Button>
      </Screen>
    )
  }

  const view = previewView({ date, today, settings, history, program: PROGRAM })
  const body = view.body
  let slots: PreviewSlot[] | null = null
  let gymName = active.name
  let planError: string | null = null
  if (body.kind === 'lift' && body.template) {
    const workout = body.logged ? (history.workouts.find((w) => w.id === body.logged?.workoutId) ?? null) : null
    const gym = liftGym(workout, active, locations)
    gymName = gym.name
    try {
      const plans: SlotPlan[] = planSession({ template: body.template, week: body.week, settings, history, gym: { location: gym, kit: settings.kit }, before: date })
      // Warm-up sets as the session order shows them (display only, PROGRAM-QUESTIONS 165); a past day logged after the fact shows none.
      slots = previewSlots(plans, { injuredSide: settings.injuredSide, gymName: gym.name, items: PROGRAM.equipment, nameOf, ramps: rampsInOrder(plans, date < today) })
    } catch (e: unknown) {
      planError = `This session could not be planned (${e instanceof Error ? e.message : String(e)}).`
    }
  }

  return (
    <Screen title={TITLE} lead={view.dateWords}>
      <DayNav view={view} />
      <section aria-label="Which day" className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <span className={LABEL}>
            {view.relation}
            {view.week !== null ? ` · Week ${view.week}` : ''}
          </span>
          {view.deload ? (
            <span className="rounded-sm border border-on-dark-faint px-2 py-1 font-mono text-label uppercase tracking-[0.22em] text-on-dark">Deload week</span>
          ) : null}
        </div>
        {view.phaseLine ? <p className="text-body text-on-dark-dim">{view.phaseLine}</p> : null}
      </section>

      {body.kind === 'before-start' ? (
        <p className="text-body text-on-dark">{body.line}</p>
      ) : body.kind === 'off' || body.kind === 'run' ? (
        <section aria-label="The day" className="flex flex-col gap-2">
          <h2 className={HEADING}>{body.label}</h2>
          {body.note ? <p className="text-body text-on-dark-dim">{body.note}</p> : null}
          <p className="text-small text-on-dark-muted">
            {body.kind === 'run' ? 'The miles are suggested on the day, from the week so far and that morning’s check.' : 'No lift today.'}
          </p>
        </section>
      ) : (
        <section aria-label="The session" className="flex flex-col gap-3">
          <h2 className={HEADING}>
            {body.label} <span className="text-on-dark-dim">at {gymName}</span>
          </h2>
          {body.logged ? <LoggedLine status={body.logged.status} workoutId={body.logged.workoutId} /> : null}
          {body.missingWords ? <p className="text-body text-on-dark-dim">{body.missingWords}</p> : null}
          {planError ? (
            <p role="alert" className="text-body text-on-dark">
              {planError}
            </p>
          ) : null}
          {slots ? (
            <>
              <p className="text-small text-on-dark-muted">{view.caveat}</p>
              <ol className="flex flex-col">
                {slots.map((slot) => (
                  <SlotItem key={slot.slotId} slot={slot} />
                ))}
              </ol>
            </>
          ) : null}
          {date === today && !body.logged && body.template ? (
            <Button variant="primary" wide onClick={() => navigate({ name: 'today' })}>
              Go to Today to start
            </Button>
          ) : null}
          {date < today && !body.logged && body.template ? (
            <LogLate
              date={date}
              today={today}
              letter={body.template.letter}
              gym={gymToOffer(lastLoggedGym(history.workouts, new Set(history.setLogs.map((s) => s.workoutId)), locations), active)}
              settings={settings}
              workouts={history.workouts}
            />
          ) : null}
        </section>
      )}

      <Button variant="quiet" onClick={() => navigate({ name: 'week' })}>
        Back to the week
      </Button>
    </Screen>
  )
}

/**
 * "Log this session" on a past lift day (Nov 6): the session is made for that day (`lateLift`: its
 * week and deload from the date, stamped late) at the gym the last lift ran at, and the runner opens
 * on it to enter the sets as they went. Outside the window it says why instead.
 */
function LogLate({
  date,
  today,
  letter,
  gym,
  settings,
  workouts,
}: {
  date: IsoDate
  today: IsoDate
  letter: 'A' | 'B' | 'C'
  gym: Location
  settings: { startDate: IsoDate; currentPhase: number; phaseEnteredWeek: number }
  workouts: Parameters<typeof lateLift>[0]['workouts']
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const made = lateLift({ date, today, startDate: settings.startDate, currentPhase: settings.currentPhase, phaseEnteredWeek: settings.phaseEnteredWeek, letter, templates: PROGRAM.templates, workouts, locationId: gym.id })
  if (!made.ok) return <p className="text-body text-on-dark-dim">{made.reason}</p>
  const log = async () => {
    setBusy(true)
    setError(null)
    try {
      await putWorkout(made.workout)
      navigate({ name: 'session', workoutId: made.workout.id })
    } catch (e: unknown) {
      setError(`Could not start the late entry: ${e instanceof Error ? e.message : String(e)}.`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <Button variant="primary" wide disabled={busy} onClick={() => void log()}>
        {busy ? 'Saving…' : `Log this session after the fact at ${gym.name}`}
      </Button>
      <p className="text-small text-on-dark-muted">You can change the gym before the first set. A session logged late is read like any other: with no morning check the day after, it reads hold.</p>
      {error ? (
        <p role="alert" className="text-body text-on-dark">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** A day back and a day on, named in words; nothing past the program's range. */
function DayNav({ view }: { view: PreviewView }) {
  return (
    <nav aria-label="Days" className="flex items-center justify-between gap-3">
      {view.prev ? (
        <Button onClick={() => navigate({ name: 'preview', date: view.prev ?? view.date })} aria-label={`Previous day, ${shortDateWords(view.prev)}`}>
          <span aria-hidden="true">←</span> {shortDateWords(view.prev)}
        </Button>
      ) : (
        <span className="text-small text-on-dark-muted">No earlier day</span>
      )}
      {view.next ? (
        <Button onClick={() => navigate({ name: 'preview', date: view.next ?? view.date })} aria-label={`Next day, ${shortDateWords(view.next)}`}>
          {shortDateWords(view.next)} <span aria-hidden="true">→</span>
        </Button>
      ) : (
        <span className="text-small text-on-dark-muted">No later day</span>
      )}
    </nav>
  )
}

function LoggedLine({ status, workoutId }: { status: string; workoutId: string }) {
  const words = status === 'in-progress' ? 'This session is in progress.' : status === 'finished' ? '✓ This session is done.' : 'This session was left early.'
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body text-on-dark">{words}</p>
      <Button onClick={() => navigate({ name: 'session', workoutId })}>{status === 'in-progress' ? 'Open the session' : 'Open the summary'}</Button>
    </div>
  )
}

function SlotItem({ slot }: { slot: PreviewSlot }) {
  return (
    <li className="flex flex-col gap-1 border-t border-on-dark-faint py-3">
      <span className={LABEL}>
        {slot.label}
        {slot.groupWith ? ` · ${slot.groupWith}` : ''}
        {slot.optional ? ' · optional' : ''}
      </span>
      <span className="text-body font-medium text-on-dark wrap-anywhere">{slot.name}</span>
      {slot.lines.map((line) => (
        <span key={line} className="font-mono text-small text-on-dark">
          {line}
        </span>
      ))}
      {slot.ramp ? <span className="text-small text-on-dark wrap-anywhere">{slot.ramp}</span> : null}
      {slot.gymLines.map((line) => (
        <span key={line} className="text-small text-on-dark wrap-anywhere">
          {line}
        </span>
      ))}
      {slot.notes.map((note) => (
        <span key={note} className="text-small text-on-dark-dim">
          {note}
        </span>
      ))}
      {slot.cues.length > 0 ? (
        <details className="text-small text-on-dark-dim">
          <summary className="tap flex cursor-pointer items-center text-on-dark-muted">{slot.cuesFor ?? 'Cues'}</summary>
          <ul className="flex list-disc flex-col gap-1 pl-6">
            {slot.cues.map((cue) => (
              <li key={cue}>{cue}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  )
}
