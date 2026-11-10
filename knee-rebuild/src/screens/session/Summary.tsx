import { useState } from 'react'
import { navigate } from '../../app/router.ts'
import { Button } from '../../components/Button.tsx'
import { ReadingWord, readingSentence } from '../../components/ReadingWord.tsx'
import { updateWorkout } from '../../db/repo.ts'
import { sessionCompliance } from '../../rules/compliance.ts'
import type { EngineMode } from '../../rules/engineMode.ts'
import { isLateEntry } from '../../rules/retro.ts'
import type { SessionTemplate, SetLog, Side, Workout } from '../../schema/index.ts'
import { durationWords, type SummaryCheckAction } from '../SessionRunner.helpers.ts'
import { MinutesField, SessionRpeField } from './EndPanels.tsx'
import { minutesNote, minutesOpening, needsEffortOrMinutes, sessionEffortLine, type SessionTiming } from './EndPanels.helpers.ts'
import { complianceLine, complianceNote, summaryBlocks } from './Summary.helpers.ts'

/**
 * Add effort and minutes (metrics phase 1): for a finished or ended session missing its RPE or its
 * minutes, the same RPE picker and minutes stepper as Finish, written through `updateWorkout`. The
 * RPE is stored only if tapped; a stored one opens selected, and stored minutes open as they are.
 */
function AddEffort({ workout, timing, onDone }: { workout: Workout; timing: SessionTiming; onDone: () => void }) {
  const [sessionRpe, setSessionRpe] = useState<number | null>(workout.sessionRpe ?? null)
  const [preset] = useState(() => minutesOpening(timing))
  const [minutes, setMinutes] = useState(workout.durationMinutes ?? preset.minutes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save() {
    setBusy(true)
    setError(null)
    try {
      await updateWorkout(workout.id, { ...(sessionRpe !== null ? { sessionRpe } : {}), durationMinutes: minutes })
      onDone()
    } catch (e) {
      setError(`Not saved: ${e instanceof Error ? e.message : String(e)}. Tap again.`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Add effort and minutes" className="flex flex-col gap-4 rounded-md bg-navy-lift p-4">
      <SessionRpeField value={sessionRpe} onChange={setSessionRpe} sets={timing.sets} />
      <MinutesField
        value={minutes}
        onChange={setMinutes}
        note={workout.durationMinutes !== undefined ? `${workout.durationMinutes} min as stored.` : minutesNote(preset, isLateEntry(workout))}
      />
      <Button variant="primary" wide disabled={busy} onClick={() => void save()}>
        Save effort and minutes
      </Button>
      {error ? (
        <p role="alert" className="text-body text-on-dark wrap-anywhere">
          {error}
        </p>
      ) : null}
      <Button variant="quiet" onClick={onDone}>
        Back
      </Button>
    </section>
  )
}

/**
 * After Finish or End: what was logged, the prescribed-sets count in words (Batch B), the session's
 * RPE, minutes and training load, each exercise's session reading in words, and the way back.
 * `phaseWeek` is the week of its phase the session fell in, or null when it can't be said.
 */
export function Summary({
  mode,
  workout,
  template,
  sets,
  injuredSide,
  timing,
  phaseWeek,
  checkLine,
}: {
  mode: EngineMode
  workout: Workout
  template: SessionTemplate
  sets: readonly SetLog[]
  injuredSide: Side
  timing: SessionTiming
  phaseWeek: number | null
  /** The morning check that completes these readings, in words, with the way to it (summaryCheckLine; Batch D). */
  checkLine: { text: string; action: SummaryCheckAction }
}) {
  const [adding, setAdding] = useState(false)
  // Each exercise's logged sets, and in full mode its session reading (`summaryBlocks`); tester mode reads nothing (M-U3).
  const blocks = summaryBlocks(mode, template, sets, injuredSide)
  const compliance = sessionCompliance({ slots: template.slots, workout, sets, phaseWeek })
  const counted = complianceLine(compliance, mode)
  const countNote = complianceNote(compliance)
  const duration = durationWords(workout.startedAt, workout.finishedAt)
  const lead =
    workout.status === 'abandoned'
      ? `Ended early${duration ? ` · ${duration}` : ''}. The sets logged before the end count.`
      : `Finished${duration ? ` · ${duration}` : ''}${workout.maxPainDuring !== undefined ? ` · max pain ${workout.maxPainDuring}` : ''}.`
  return (
    <section aria-label="Summary" className="flex flex-col gap-6">
      <p className="text-lead text-on-dark">{lead}</p>
      {counted ? (
        <div className="flex flex-col gap-1">
          <p className="text-body text-on-dark">{counted}</p>
          {countNote ? <p className="text-small text-on-dark-muted">{countNote}</p> : null}
        </div>
      ) : null}
      <p className="text-body text-on-dark-dim">{sessionEffortLine(workout, sets)}</p>
      {adding ? (
        <AddEffort workout={workout} timing={timing} onDone={() => setAdding(false)} />
      ) : needsEffortOrMinutes(workout) ? (
        <Button className="self-start" onClick={() => setAdding(true)}>
          Add effort and minutes
        </Button>
      ) : null}
      {blocks.length === 0 ? <p className="text-body text-on-dark-dim">Nothing was logged.</p> : null}
      <ul className="flex flex-col gap-4">
        {blocks.map((block) => (
          <li key={block.key} className="flex flex-col gap-1 border-b border-on-dark-faint pb-4">
            <p className="text-body text-on-dark">
              <span className="font-mono text-small text-on-dark-muted">{block.label}</span> {block.name}
            </p>
            {block.lines.map((line) => (
              <p key={line} className="text-small text-on-dark-dim">
                {line}
              </p>
            ))}
            {block.stopped ? <p className="text-small text-on-dark">{block.stopped}</p> : null}
            {block.reading ? (
              <>
                <ReadingWord result={block.reading.result} />
                <p className="text-small text-on-dark-dim">Because: {block.reading.because ?? readingSentence(block.reading.result)}.</p>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-body text-on-dark-dim">{checkLine.text}</p>
      {checkLine.action ? (
        <Button wide onClick={() => navigate(checkLine.action?.kind === 'late' ? { name: 'morning', date: checkLine.action.morning } : { name: 'morning' })}>
          {checkLine.action.label}
        </Button>
      ) : null}
      <Button variant="primary" wide onClick={() => navigate({ name: 'today' })}>
        Back to Today
      </Button>
    </section>
  )
}
