import { useState, type ReactNode } from 'react'
import { Button } from '../../components/Button.tsx'
import { PAIN_SCALE, RPE_SCALE, ScalePicker } from '../../components/ScalePicker.tsx'
import { Stepper } from '../../components/Stepper.tsx'
import { exerciseById } from '../../program/program.ts'
import { effectiveSlot } from '../../rules/effectiveSlot.ts'
import type { EngineMode } from '../../rules/engineMode.ts'
import type { SlotRoute } from '../../rules/equipment.ts'
import type { Draft } from '../../rules/prefill.ts'
import type { Step } from '../../rules/runOrder.ts'
import type { SetLog, SetSide, Side, Slot, StopReason } from '../../schema/index.ts'
import {
  STOP_REASONS,
  countLabel,
  countStep,
  countWords,
  cuesWrittenFor,
  loadBlocked,
  loadLabel,
  loadMax,
  loadStep,
  loadWords,
  rangeStopOptions,
  setWords,
  showsLoad,
  sideLine,
  sideWords,
  type CardModel,
  type SwapChoice,
} from '../SessionRunner.helpers.ts'
import { DoneBar } from './DoneBar.tsx'
import { GymNotes, type GymAction, type RackAsk } from './GymNotes.tsx'

export interface ActiveCardProps {
  mode: EngineMode
  /** The slot as planned (the Program edits laid over), and what the gym does to it. */
  slot: Slot
  route: SlotRoute
  /** What the card shows and how its set opens (`cardModel`): the engine's prescription, or program.md's written cell. */
  model: CardModel
  /** The open step to log in this slot, or null when the slot is only being looked at. */
  step: Step | null
  /** A logged set being corrected, or null. */
  editing: SetLog | null
  slotSets: SetLog[]
  /** Sets for each side, for "set 2 of 3". */
  setsBySide: Record<string, number>
  /** Sides of a two-sided slot and whether each still has an open set, for the side toggle. */
  sides: { side: SetSide; open: boolean }[]
  injuredSide: Side
  painPerSet: boolean
  /** The gym's heaviest dumbbell, in lb (0 means none): the load field stops there for dumbbell work. */
  rackLb: number
  /** Pain for the exercise on the card when pain is logged once per exercise. */
  exercisePain: number | null
  onExercisePain: (value: number) => void
  swapped: boolean
  /** Swap's list (`swapChoices`): the slot's own exercise, then its substitutions, each here or not. */
  choices: SwapChoice[]
  /** What "Back to" returns a swapped slot to: the exercise the plan runs without the swap. */
  backToName: string
  /** What the gym does to the slot, in words, and the marks and choices it offers (design section 4). */
  gym: { lines: string[]; actions: GymAction[]; rack: RackAsk | null }
  /** Nothing on the slot's list is here and Shawn hasn't picked Do it anyway: no set to log, only the gym's offers and Swap. */
  held: boolean
  busy: boolean
  error: string | null
  timer: ReactNode
  /** What the bar offers when this slot has nothing open. */
  idleBar: { line: string; label: string; onPress: () => void }
  onLog: (draft: Draft, stop?: StopReason) => void
  onSave: (set: SetLog, draft: Draft) => void
  onRemove: (set: SetLog) => void
  onEdit: (set: SetLog | null) => void
  onSwap: (exerciseId: string | null) => void
  onPickSide: (side: SetSide) => void
}

const sideOrder = (side: string, injured: Side) => (side === 'both' || side === injured ? 0 : 1)

/**
 * The Now card and the Done bar for one step. Keyed by step (and exercise) by its parent, so a new
 * step remounts it with a fresh prefill: the draft never leaks from one set into the next.
 */
export function ActiveCard(props: ActiveCardProps) {
  const { model, step, editing, slotSets, injuredSide } = props
  const planSlot = props.slot
  const { exercise, slot, repUnit } = model
  // The model's opening values, read once: a new step remounts the card (its key), so the draft never leaks into the next set.
  const [draft, setDraft] = useState<Draft | null>(() => model.draft)
  const [panel, setPanel] = useState<'swap' | 'stop' | null>(null)
  const [change, setChange] = useState<'height' | 'range' | 'stage' | null>(null)
  const [showCues, setShowCues] = useState(slotSets.length === 0)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  const doneRows = [...slotSets].sort((a, b) => a.setNumber - b.setNumber || sideOrder(a.side, injuredSide) - sideOrder(b.side, injuredSide))
  const activeSide = editing?.side ?? step?.side
  const totalForSide = activeSide ? (props.setsBySide[activeSide] ?? model.sets) : model.sets
  const setNumber = editing?.setNumber ?? step?.setNumber
  const { needsRpe, showRpe } = model
  const hasLoad = showsLoad(exercise)
  const blockedOnLoad = !editing && draft !== null && loadBlocked(props.mode, model, draft)
  const pain = props.painPerSet ? (draft?.pain ?? null) : props.exercisePain
  const blockedOnPain = !editing && step !== null && pain === null
  const sideNote = sideLine(planSlot.unilateral, exercise.unilateral)
  const cuesFor = cuesWrittenFor(planSlot.exerciseId, exercise.id, (id) => exerciseById(id).name)
  const budgetLine = model.budgetLine

  const sideText = activeSide ? sideWords(activeSide, injuredSide) : ''
  const draftLine = draft
    ? [
        exercise.name,
        setNumber ? `set ${setNumber} of ${totalForSide}` : '',
        sideText,
        hasLoad ? loadWords(draft.load, exercise) : '',
        countWords(draft.count, repUnit, slot),
        draft.rpe !== null ? `RPE ${draft.rpe}` : '',
        pain !== null ? `pain ${pain}` : 'pain not rated',
      ]
        .filter(Boolean)
        .join(' · ')
    : props.idleBar.line

  let barLabel = props.idleBar.label
  let barPress = props.idleBar.onPress
  let barDisabled = false
  if (editing && draft) {
    barLabel = `Save set ${editing.setNumber}`
    barPress = () => props.onSave(editing, draft)
  } else if (step && draft) {
    const sideWord = sideText ? `, ${sideText.split(' · ')[0]?.toLowerCase()}` : ''
    barLabel = blockedOnLoad ? model.loadBar : blockedOnPain ? 'Rate pain first' : `Done: set ${step.setNumber} of ${totalForSide}${sideWord}`
    barDisabled = blockedOnLoad || blockedOnPain
    barPress = () => props.onLog(draft)
  }

  const painPicker = (
    <>
      <ScalePicker
        label={props.painPerSet ? 'Pain, this set' : 'Pain, this exercise'}
        value={pain}
        options={PAIN_SCALE}
        onChange={(v) => (props.painPerSet ? set({ pain: v }) : props.onExercisePain(v))}
        ariaLabel={props.painPerSet ? 'Pain this set' : 'Pain this exercise'}
      />
      {pain === null && step && !editing ? <p className="text-small text-on-dark">{model.painLine}</p> : null}
    </>
  )

  return (
    <>
      <section aria-label="Now" className="flex flex-col gap-4 rounded-md bg-navy-lift p-4">
        <header className="flex flex-col gap-1">
          <p className="font-mono text-label uppercase tracking-[0.22em] text-on-dark-muted">{planSlot.groupId ? `Superset · slot ${planSlot.label}` : `Slot ${planSlot.label}`}</p>
          <h2 className="font-sans text-h3 font-semibold text-on-dark">{exercise.name}</h2>
          <p className="text-body text-on-dark-dim">{model.header.text}</p>
          {model.header.writtenFor ? <p className="text-small text-on-dark">{model.header.writtenFor}</p> : null}
          {model.header.deload ? <p className="text-small text-on-dark">{model.header.deload}</p> : null}
          {model.header.loadNote ? <p className="text-small text-on-dark-dim">{model.header.loadNote}</p> : null}
          {model.header.note ? <p className="text-small text-on-dark-dim">{model.header.note}</p> : null}
          {model.header.moved ? <p className="text-small text-on-dark">{model.header.moved}</p> : null}
          <GymNotes lines={props.gym.lines} actions={props.gym.actions} rack={props.gym.rack} busy={props.busy} />
          {sideNote ? <p className="text-small text-on-dark-dim">{sideNote}</p> : null}
          {exercise.sideMeaning ? <p className="text-small text-on-dark-dim">{exercise.sideMeaning}</p> : null}
        </header>

        {planSlot.cues.length > 0 ? (
          showCues ? (
            <div className="flex flex-col gap-1">
              {cuesFor ? <p className="font-mono text-label uppercase tracking-[0.22em] text-on-dark-muted">{cuesFor}</p> : null}
              <ul className="flex flex-col gap-1">
                {planSlot.cues.map((cue) => (
                  <li key={cue} className="text-small text-on-dark">
                    {cue}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Button variant="quiet" onClick={() => setShowCues(true)}>
              Show cues
            </Button>
          )
        ) : null}

        {!props.painPerSet && !props.held ? painPicker : null}

        {doneRows.length > 0 ? (
          <ul aria-label="Logged sets" className="flex flex-col">
            {doneRows.map((s) => {
              const side = sideWords(s.side, injuredSide)
              const isEditing = editing?.id === s.id
              const own = exerciseById(s.exerciseId)
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-pressed={isEditing}
                    onClick={() => props.onEdit(isEditing ? null : s)}
                    className={`tap w-full border-b border-on-dark-faint py-2 text-left text-small ${isEditing ? 'text-on-dark underline underline-offset-4' : 'text-on-dark-dim'}`}
                  >
                    <span aria-hidden="true">{s.stopped ? '– ' : '✓ '}</span>
                    Set {s.setNumber}
                    {side ? ` · ${side}` : ''}
                    {own.id !== exercise.id ? ` · ${own.name}` : ''} · {setWords(s, effectiveSlot(planSlot, own).repUnit, own)}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}

        {props.sides.length > 1 && !editing ? (
          <div role="group" aria-label="Side" className="flex gap-2">
            {props.sides.map(({ side, open }) => {
              const on = activeSide === side
              return (
                <Button key={side} variant={on ? 'primary' : 'secondary'} aria-pressed={on} disabled={!open && !on} onClick={() => props.onPickSide(side)}>
                  {on ? '✓ ' : ''}
                  {sideWords(side, injuredSide)}
                  {!open ? ' · done' : ''}
                </Button>
              )
            })}
          </div>
        ) : null}

        {model.ramp && !editing && step?.setNumber === 1 && slotSets.length === 0 ? <p className="text-small text-on-dark wrap-anywhere">{model.ramp}</p> : null}

        {draft && (step || editing) ? (
          <div aria-label={editing ? `Editing set ${editing.setNumber}` : 'Next set'} className="flex flex-col gap-4">
            <p className="font-mono text-label uppercase tracking-[0.22em] text-on-dark">
              {editing ? `Editing set ${editing.setNumber}` : `Set ${step?.setNumber} of ${totalForSide}`}
              {sideText ? ` · ${sideText}` : ''}
            </p>
            {planSlot.injuredOnly ? <p className="text-small text-on-dark-dim">{injuredSide === 'left' ? 'Left' : 'Right'} (injured) only.</p> : null}
            {budgetLine ? <p className="text-small text-on-dark">{budgetLine}</p> : null}

            {draft.heightIn !== undefined ? (
              <div className="flex flex-col gap-2">
                <p className="flex items-center justify-between gap-3 text-body text-on-dark">
                  Step: {draft.heightIn} in.
                  <Button variant="quiet" onClick={() => setChange(change === 'height' ? null : 'height')}>{change === 'height' ? 'Done' : 'Change'}</Button>
                </p>
                {change === 'height' ? (
                  <Stepper label="Step height" unit="in" value={draft.heightIn} step={exercise.heightIncrementIn ?? 2} min={2} max={slot.heightMaxIn ?? 24} onChange={(v) => set({ heightIn: v })} />
                ) : null}
              </div>
            ) : null}

            {draft.rangeStopDeg !== undefined ? (
              <div className="flex flex-col gap-2">
                <p className="flex items-center justify-between gap-3 text-body text-on-dark">
                  Range: 90° to {draft.rangeStopDeg}°
                  <Button variant="quiet" onClick={() => setChange(change === 'range' ? null : 'range')}>{change === 'range' ? 'Done' : 'Change'}</Button>
                </p>
                {change === 'range' ? (
                  <div className="flex gap-2">
                    {rangeStopOptions(slot.rangeStopDeg).map((deg) => (
                      <Button key={deg} variant={draft.rangeStopDeg === deg ? 'primary' : 'secondary'} aria-pressed={draft.rangeStopDeg === deg} onClick={() => set({ rangeStopDeg: deg })}>
                        {draft.rangeStopDeg === deg ? '✓ ' : ''}to {deg}°
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {draft.stage !== undefined && exercise.stages ? (
              <div className="flex flex-col gap-2">
                <p className="flex items-center justify-between gap-3 text-body text-on-dark">
                  Stage: {exercise.stages[draft.stage] ?? 'first'}
                  <Button variant="quiet" onClick={() => setChange(change === 'stage' ? null : 'stage')}>{change === 'stage' ? 'Done' : 'Change'}</Button>
                </p>
                {change === 'stage' ? (
                  <div className="flex flex-col gap-2">
                    {exercise.stages.map((name, i) => (
                      <Button key={name} wide variant={draft.stage === i ? 'primary' : 'secondary'} aria-pressed={draft.stage === i} onClick={() => set({ stage: i })}>
                        {draft.stage === i ? '✓ ' : ''}
                        {name}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {hasLoad ? (
              <Stepper label={loadLabel(exercise)} value={draft.load} step={loadStep(exercise)} min={0} max={loadMax(exercise, props.rackLb)} onChange={(v) => set({ load: v })} />
            ) : null}
            {blockedOnLoad ? <p className="text-small text-on-dark">{model.loadLine}</p> : null}

            <Stepper
              label={panel === 'stop' ? `${countLabel(repUnit)} done before stopping` : countLabel(repUnit)}
              value={draft.count}
              step={countStep(repUnit)}
              min={0}
              max={600}
              onChange={(v) => set({ count: v })}
            />

            {showRpe ? (
              <>
                <ScalePicker label="RPE" value={draft.rpe} options={RPE_SCALE} onChange={(v) => set({ rpe: v })} />
                {draft.rpe === null && needsRpe ? <p className="text-small text-on-dark">RPE not rated: the load can&apos;t step up until it is.</p> : null}
              </>
            ) : null}

            {props.painPerSet ? painPicker : null}

            {editing ? (
              <div className="flex flex-col gap-3">
                <Button variant="quiet" onClick={() => props.onEdit(null)}>
                  Back without saving
                </Button>
                <div className="border-t border-on-dark-faint pt-3">
                  {confirmRemove ? (
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => props.onRemove(editing)} disabled={props.busy}>
                        Yes, remove set {editing.setNumber}
                      </Button>
                      <Button variant="quiet" onClick={() => setConfirmRemove(false)}>
                        Keep it
                      </Button>
                    </div>
                  ) : (
                    <Button variant="quiet" onClick={() => setConfirmRemove(true)}>
                      Remove this set
                    </Button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {!editing && ((step && draft) || props.held) ? (
          panel === 'stop' && step && draft ? (
            <div aria-label="Stop this exercise" className="flex flex-col gap-2">
              <p className="text-body text-on-dark">Why stop? The set logs with the count above, then this exercise is done for today, both sides.</p>
              {blockedOnLoad ? <p className="text-small text-on-dark">Enter the load you used above first.</p> : null}
              {STOP_REASONS.map((r) => (
                <Button key={r.value} wide onClick={() => props.onLog(draft, r.value)} disabled={props.busy || blockedOnLoad}>
                  {r.label}
                </Button>
              ))}
              <Button variant="quiet" onClick={() => setPanel(null)}>
                Back
              </Button>
            </div>
          ) : panel === 'swap' ? (
            <div aria-label="Swap" className="flex flex-col gap-2">
              <p className="text-body text-on-dark">Swap for this session. The slot&apos;s job stays the same.</p>
              {props.choices.map(({ exercise: choice, words }) => (
                <Button
                  key={choice.id}
                  wide
                  className="flex flex-col items-start gap-1 text-left"
                  onClick={() => {
                    props.onSwap(choice.id)
                    setPanel(null)
                  }}
                  aria-pressed={exercise.id === choice.id}
                >
                  <span>
                    {exercise.id === choice.id ? '✓ ' : ''}
                    {choice.name}
                  </span>
                  <span className="text-small text-on-dark-dim">{words}</span>
                </Button>
              ))}
              {props.swapped ? (
                <Button
                  wide
                  onClick={() => {
                    props.onSwap(null)
                    setPanel(null)
                  }}
                >
                  Back to {props.backToName}
                </Button>
              ) : null}
              <Button variant="quiet" onClick={() => setPanel(null)}>
                Back
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {props.choices.length > 1 ? (
                <Button variant="quiet" onClick={() => setPanel('swap')}>
                  Swap
                </Button>
              ) : null}
              {step && draft ? (
                <Button variant="quiet" onClick={() => setPanel('stop')}>
                  Stop this exercise
                </Button>
              ) : null}
            </div>
          )
        ) : null}

        {props.error ? (
          <p role="alert" className="text-body text-on-dark">
            {props.error}
          </p>
        ) : null}
      </section>
      <DoneBar timer={props.timer} line={draftLine} label={barLabel} disabled={props.busy || barDisabled} onPress={barPress} />
    </>
  )
}
