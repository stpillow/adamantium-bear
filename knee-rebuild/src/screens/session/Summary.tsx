import { useState } from 'react'
import { navigate } from '../../app/router.ts'
import { Button } from '../../components/Button.tsx'
import { ReadingWord, readingSentence } from '../../components/ReadingWord.tsx'
import { updateWorkout } from '../../db/repo.ts'
import { exerciseById } from '../../program/program.ts'
import { sessionCompliance } from '../../rules/compliance.ts'
import { sessionReading } from '../../rules/reading.ts'
import { isLateEntry } from '../../rules/retro.ts'
import type { SessionTemplate, SetLog, Side, Workout } from '../../schema/index.ts'
import { durationWords, loadWords, showsLoad, sideWords, stopReasonLabel, type SummaryCheckAction } from '../SessionRunner.helpers.ts'
import { MinutesField, SessionRpeField } from './EndPanels.tsx'
import { minutesNote, minutesOpening, needsEffortOrMinutes, sessionEffortLine, type SessionTiming } from './EndPanels.helpers.ts'
import { complianceLine, complianceNote } from './Summary.helpers.ts'

interface ExerciseBlock {
  exerciseId: string
  label: string
  sets: SetLog[]
}

/** The logged exercises in slot order, one block per exercise (a mid-session swap gives two). */
export function exerciseBlocks(template: SessionTemplate, sets: readonly SetLog[]): ExerciseBlock[] {
  const blocks: ExerciseBlock[] = []
  for (const slot of template.slots) {
    const slotSets = sets.filter((s) => s.slotId === slot.id)
    for (const id of Array.from(new Set(slotSets.map((s) => s.exerciseId)))) {
      blocks.push({ exerciseId: id, label: slot.label, sets: slotSets.filter((s) => s.exerciseId === id) })
    }
  }
  return blocks
}

function sideLines(block: ExerciseBlock, injuredSide: Side): string[] {
  const exercise = exerciseById(block.exerciseId)
  const sides = Array.from(new Set(block.sets.map((s) => s.side))).sort((a, b) => (a === injuredSide || a === 'both' ? -1 : b === injuredSide ? 1 : 0))
  return sides.map((side) => {
    const sideSets = block.sets.filter((s) => s.side === side).sort((a, b) => a.setNumber - b.setNumber)
    const counts = sideSets.map((s) => s.seconds ?? s.reps ?? 0).join(', ')
    const load = showsLoad(exercise) ? `${loadWords(sideSets.at(-1)?.load ?? 0, exercise)} × ` : ''
    const label = sideWords(side, injuredSide)
    return `${label ? `${label}: ` : ''}${load}${counts}`
  })
}

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
  workout,
  template,
  sets,
  injuredSide,
  timing,
  phaseWeek,
  checkLine,
}: {
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
  const blocks = exerciseBlocks(template, sets)
  const compliance = sessionCompliance({ slots: template.slots, workout, sets, phaseWeek })
  const counted = complianceLine(compliance)
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
        {blocks.map((block) => {
          const exercise = exerciseById(block.exerciseId)
          const reading = sessionReading(block.sets, injuredSide)
          const stop = block.sets.find((s) => s.stopped)
          return (
            <li key={`${block.label}-${block.exerciseId}`} className="flex flex-col gap-1 border-b border-on-dark-faint pb-4">
              <p className="text-body text-on-dark">
                <span className="font-mono text-small text-on-dark-muted">{block.label}</span> {exercise.name}
              </p>
              {sideLines(block, injuredSide).map((line) => (
                <p key={line} className="text-small text-on-dark-dim">
                  {line}
                </p>
              ))}
              {stop ? <p className="text-small text-on-dark">Stopped: {stopReasonLabel(stop.stopReason).toLowerCase()}.</p> : null}
              <ReadingWord result={reading.result} />
              <p className="text-small text-on-dark-dim">Because: {reading.reasons.join('; ') || readingSentence(reading.result)}.</p>
            </li>
          )
        })}
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
