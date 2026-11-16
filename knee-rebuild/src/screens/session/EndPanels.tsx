import { useState } from 'react'
import { Button } from '../../components/Button.tsx'
import { PAIN_SCALE, RPE_1_10, ScalePicker } from '../../components/ScalePicker.tsx'
import { Stepper } from '../../components/Stepper.tsx'
import { DURATION_MAX, DURATION_MIN } from '../../schema/index.ts'
import type { EngineMode } from '../../rules/engineMode.ts'
import { SESSION_RPE_ANCHORS, discardWords, endWords, minutesNote, minutesOpening, sessionRpeNote, type SessionTiming } from './EndPanels.helpers.ts'

/** A write the panel asked for that failed, in a sentence: the panel replaces the card, so it says it. */
function NotSaved({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-body text-on-dark wrap-anywhere">
      {error}
    </p>
  ) : null
}

/**
 * The session's minutes (metrics phase 1): a stepper always shown, preset from the sets' times (or an
 * estimate for a late entry, labelled one), so leaving it costs no tap. What it holds is stored.
 */
export function MinutesField({ value, onChange, note }: { value: number; onChange: (minutes: number) => void; note: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Stepper label="Minutes" unit="min" step={5} min={DURATION_MIN} max={DURATION_MAX} value={value} onChange={onChange} />
      <p className="text-small text-on-dark-dim">{note}</p>
    </div>
  )
}

/** How hard the whole session was, 1 to 10, optional: stored only when tapped; the line says what stands in until then. */
export function SessionRpeField({ value, onChange, sets }: { value: number | null; onChange: (rpe: number) => void; sets: SessionTiming['sets'] }) {
  return (
    <div className="flex flex-col gap-2">
      <ScalePicker label="Whole session (RPE)" value={value} options={RPE_1_10} onChange={onChange} />
      <p className="text-small text-on-dark-dim">
        {sessionRpeNote(value, sets)} {SESSION_RPE_ANCHORS}
      </p>
    </div>
  )
}

/** Finish, inline: what the gym changed (`notHere`, in words), what wasn't logged, max pain during the session, the session's RPE and minutes, then the write. */
export function FinishPanel({
  mode,
  notHere,
  notLogged,
  loggedCount,
  loggedMax,
  timing,
  late,
  busy,
  error,
  onFinish,
  onBack,
}: {
  mode: EngineMode
  notHere: string | null
  /** `notLoggedWords`' sentence: what is still open, or that every required set is logged. */
  notLogged: string
  loggedCount: number
  loggedMax: number | null
  /** What the minutes stepper's preset and the RPE line are read from. */
  timing: SessionTiming
  late: boolean
  busy: boolean
  error: string | null
  /** Max pain, the session's RPE only if tapped, and the minutes; all null for a discard. */
  onFinish: (maxPain: number | null, sessionRpe: number | null, minutes: number | null) => void
  onBack: () => void
}) {
  const [maxPain, setMaxPain] = useState<number | null>(loggedMax)
  const [sessionRpe, setSessionRpe] = useState<number | null>(null)
  const [preset] = useState(() => minutesOpening(timing))
  const [minutes, setMinutes] = useState(preset.minutes)
  if (loggedCount === 0) {
    return (
      <section aria-label="Finish session" className="flex flex-col gap-4 rounded-md bg-navy-lift p-4">
        <h2 className="font-sans text-h3 font-semibold text-on-dark">Nothing is logged yet</h2>
        <p className="text-body text-on-dark-dim">{discardWords(mode)}</p>
        <Button wide disabled={busy} onClick={() => onFinish(null, null, null)}>
          Discard this session
        </Button>
        <NotSaved error={error} />
        <Button variant="quiet" onClick={onBack}>
          Back
        </Button>
      </section>
    )
  }
  return (
    <section aria-label="Finish session" className="flex flex-col gap-4 rounded-md bg-navy-lift p-4">
      <h2 className="font-sans text-h3 font-semibold text-on-dark">Finish the session</h2>
      {notHere ? <p className="text-body text-on-dark-dim wrap-anywhere">{notHere}</p> : null}
      <p className="text-body text-on-dark-dim">{notLogged}</p>
      <ScalePicker label="Max pain during the session" value={maxPain} options={PAIN_SCALE} onChange={setMaxPain} />
      <SessionRpeField value={sessionRpe} onChange={setSessionRpe} sets={timing.sets} />
      <MinutesField value={minutes} onChange={setMinutes} note={minutesNote(preset, late)} />
      <Button variant="primary" wide disabled={busy} onClick={() => onFinish(maxPain, sessionRpe, minutes)}>
        Finish session
      </Button>
      <NotSaved error={error} />
      <Button variant="quiet" onClick={onBack}>
        Back
      </Button>
    </section>
  )
}

/** End without finishing, inline: says what is kept, asks the minutes it ran (the same stepper as Finish), then marks the workout abandoned. */
export function EndPanel({
  mode,
  loggedCount,
  timing,
  late,
  busy,
  error,
  onEnd,
  onBack,
}: {
  mode: EngineMode
  loggedCount: number
  timing: SessionTiming
  late: boolean
  busy: boolean
  error: string | null
  /** The minutes, or null for a discard. */
  onEnd: (minutes: number | null) => void
  onBack: () => void
}) {
  const [preset] = useState(() => minutesOpening(timing))
  const [minutes, setMinutes] = useState(preset.minutes)
  return (
    <section aria-label="End without finishing" className="flex flex-col gap-4 rounded-md bg-navy-lift p-4">
      <h2 className="font-sans text-h3 font-semibold text-on-dark">End without finishing</h2>
      <p className="text-body text-on-dark-dim">
        {endWords(mode, loggedCount)}
      </p>
      {loggedCount > 0 ? <MinutesField value={minutes} onChange={setMinutes} note={minutesNote(preset, late)} /> : null}
      <Button wide disabled={busy} onClick={() => onEnd(loggedCount === 0 ? null : minutes)}>
        {loggedCount === 0 ? 'Discard this session' : 'End session'}
      </Button>
      <NotSaved error={error} />
      <Button variant="quiet" onClick={onBack}>
        Back
      </Button>
    </section>
  )
}
