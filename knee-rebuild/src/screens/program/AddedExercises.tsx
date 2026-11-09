import { useMemo, useState } from 'react'
import { PROGRAM } from '../../app/session.ts'
import { Button } from '../../components/Button.tsx'
import { Stepper } from '../../components/Stepper.tsx'
import { removeAddedSlot, saveAddedSlot } from '../../db/repo.ts'
import { addableByPattern, addedDefaults, addedFor, addedPrescriptionText, addedRepUnit, addedSlotId, addedSlotProblem, phaseExerciseIds } from '../../rules/addedSlots.ts'
import { ADDED_SETS_MAX, ADDED_SLOTS_MAX, type AddedSlot, type IsoDate } from '../../schema/index.ts'
import { failedWords } from '../Locations.helpers.ts'
import { patternWords } from '../Program.helpers.ts'
import { HEADING, LABEL, Note, Problem, RowButton } from './parts.tsx'

const CATALOG = new Map(PROGRAM.exercises.map((e) => [e.id, e]))

/**
 * Exercises Shawn adds to a session, under the session's own slots: the list of what he added with
 * Remove on each, and a form (pick an exercise, sets, rep range) with Add. Each one runs after the
 * session's own slots as an ordinary slot; program.md's slots are not touched (src/rules/addedSlots.ts).
 */
export function AddedExercises({ templateId, heading, added, today }: { templateId: string; heading: string; added: readonly AddedSlot[]; today: IsoDate }) {
  const mine = useMemo(() => addedFor(templateId, added, CATALOG, phaseExerciseIds(PROGRAM.templates, PROGRAM.templates.find((t) => t.id === templateId)?.phase ?? 1)), [templateId, added])
  const [open, setOpen] = useState(false)
  const [exerciseId, setExerciseId] = useState('')
  const [sets, setSets] = useState(3)
  const [repsMin, setRepsMin] = useState(8)
  const [repsMax, setRepsMax] = useState(12)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const phase = PROGRAM.templates.find((t) => t.id === templateId)?.phase ?? 1
  const addable = useMemo(() => addableByPattern(PROGRAM.exercises, PROGRAM.templates, phase), [phase])
  const inPhase = useMemo(() => phaseExerciseIds(PROGRAM.templates, phase), [phase])
  const exercise = CATALOG.get(exerciseId)
  const unit = exercise ? addedRepUnit(exercise) : 'reps'

  const pick = (id: string) => {
    setExerciseId(id)
    setProblem(null)
    const chosen = CATALOG.get(id)
    if (!chosen) return
    const d = addedDefaults(chosen)
    setSets(d.sets)
    setRepsMin(d.repsMin)
    setRepsMax(d.repsMax)
  }
  const changeMin = (n: number) => {
    setRepsMin(n)
    if (n > repsMax) setRepsMax(n)
  }
  const changeMax = (n: number) => {
    setRepsMax(n)
    if (n < repsMin) setRepsMin(n)
  }

  const add = async () => {
    const row: AddedSlot = { id: addedSlotId(Date.now().toString(36)), templateId, exerciseId, sets, repsMin, repsMax, addedOn: today }
    const found = addedSlotProblem(row, exercise, mine.length, inPhase)
    if (found) {
      setProblem(found)
      return
    }
    setBusy(true)
    setProblem(null)
    try {
      await saveAddedSlot(row, PROGRAM)
      setOpen(false)
      setExerciseId('')
    } catch (e: unknown) {
      setProblem(failedWords('Add the exercise', e, 'the session shows what the phone still has.'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (row: AddedSlot, name: string) => {
    setProblem(null)
    try {
      await removeAddedSlot(row.id)
    } catch (e: unknown) {
      setProblem(failedWords(`Remove ${name}`, e, 'the session shows what the phone still has.'))
    }
  }

  return (
    <section aria-label={`${heading}, exercises you added`} className="flex flex-col gap-3 border-t border-on-dark-faint pt-4">
      <h3 className={HEADING}>Added to {heading}</h3>
      {mine.length === 0 ? (
        <Note>Nothing added. An added exercise runs after the session’s own, and drops first when you are short on time.</Note>
      ) : (
        <ol className="flex flex-col gap-3">
          {mine.map((row, i) => {
            const e = CATALOG.get(row.exerciseId)
            const name = e?.name ?? row.exerciseId
            return (
              <li key={row.id} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className={LABEL}>+{i + 1}</p>
                  <p className="text-body text-on-dark wrap-anywhere">{name}</p>
                  <p className="text-small text-on-dark-dim wrap-anywhere">{e ? addedPrescriptionText(row, e) : `${row.sets} sets`}</p>
                </div>
                <RowButton aria-label={`Remove ${name}, added exercise ${i + 1}`} onClick={() => void remove(row, name)}>
                  Remove
                </RowButton>
              </li>
            )
          })}
        </ol>
      )}

      {open ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-body text-on-dark-dim">Exercise</span>
            <select value={exerciseId} onChange={(e) => pick(e.target.value)} className="tap w-full rounded-sm bg-ink px-3 text-body text-on-dark">
              <option value="">Pick an exercise…</option>
              {addable.map((g) => (
                <optgroup key={g.pattern} label={patternWords(g.pattern)}>
                  {g.exercises.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {exercise ? (
            <>
              <Stepper label="Sets" value={sets} onChange={setSets} min={1} max={ADDED_SETS_MAX} />
              <Stepper label={unit === 'seconds' ? 'From' : 'Reps from'} value={repsMin} onChange={changeMin} min={1} max={unit === 'seconds' ? 300 : 100} step={unit === 'seconds' ? 5 : 1} unit={unit === 'seconds' ? 's' : undefined} />
              <Stepper label={unit === 'seconds' ? 'To' : 'Reps to'} value={repsMax} onChange={changeMax} min={1} max={unit === 'seconds' ? 300 : 100} step={unit === 'seconds' ? 5 : 1} unit={unit === 'seconds' ? 's' : undefined} />
              <Note>
                {addedPrescriptionText({ sets, repsMin, repsMax }, exercise)}. {exercise.unilateral ? 'Injured side first. ' : ''}You choose the load the first time; after that the app prescribes it from what you log, like any other exercise.
              </Note>
            </>
          ) : null}
          <div className="flex gap-2">
            <Button variant="primary" disabled={!exercise || busy} onClick={() => void add()}>
              Add to {heading}
            </Button>
            <Button variant="quiet" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button wide disabled={mine.length >= ADDED_SLOTS_MAX} onClick={() => setOpen(true)}>
          {mine.length >= ADDED_SLOTS_MAX ? `${ADDED_SLOTS_MAX} added, the most a session takes` : 'Add an exercise'}
        </Button>
      )}
      {problem ? <Problem>{problem}</Problem> : null}
    </section>
  )
}
