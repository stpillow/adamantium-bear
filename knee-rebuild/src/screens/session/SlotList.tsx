import type { Slot } from '../../schema/index.ts'
import { exerciseById } from '../../program/program.ts'
import type { Step } from '../../rules/runOrder.ts'
import { cuesWrittenFor } from '../SessionRunner.helpers.ts'

export interface SlotStatus {
  word: string
  mark: string
}

/** A slot as the list names it, in either mode: the slot as planned and the exercise it runs now. */
export interface ListedSlot {
  slot: Slot
  runsExerciseId: string
}

/** A slot's status in words with a mark: what's done, what's current, what's optional, what nothing here runs (`notHere`). */
export function slotStatus(
  plan: Pick<ListedSlot, 'slot'>,
  steps: readonly Step[],
  done: ReadonlySet<string>,
  stopped: ReadonlySet<string>,
  currentSlotId: string | null,
  notHere: ReadonlySet<string> = new Set(),
): SlotStatus {
  const own = steps.filter((s) => s.slotId === plan.slot.id)
  const doneCount = own.filter((s) => done.has(s.key)).length
  if (stopped.has(plan.slot.id)) return { mark: '–', word: 'Stopped' }
  if (plan.slot.id === currentSlotId) return { mark: '●', word: 'Now' }
  if (own.length > 0 && doneCount >= own.length) return { mark: '✓', word: 'Done' }
  if (doneCount > 0) return { mark: '◐', word: `${doneCount} of ${own.length}` }
  if (notHere.has(plan.slot.id)) return { mark: '×', word: 'Nothing here' }
  if (plan.slot.optional) return { mark: '○', word: 'Optional' }
  return { mark: '', word: '' }
}

/** Every slot in order, its first cue visible, supersets under one line. A tap makes a slot current. */
export function SlotList({
  plans,
  steps,
  done,
  stopped,
  currentSlotId,
  notHere,
  onPick,
}: {
  plans: readonly ListedSlot[]
  steps: readonly Step[]
  done: ReadonlySet<string>
  stopped: ReadonlySet<string>
  currentSlotId: string | null
  /** Slots nothing at this gym runs, until Do it anyway (`notHereSlots`). */
  notHere: ReadonlySet<string>
  onPick: (slotId: string) => void
}) {
  const groupLabels = new Map<string, string>()
  for (const p of plans) {
    if (!p.slot.groupId) continue
    const members = plans.filter((q) => q.slot.groupId === p.slot.groupId).map((q) => q.slot.label)
    groupLabels.set(p.slot.groupId, `Superset ${members.join(' · ')}`)
  }
  const seenGroups = new Set<string>()
  return (
    <section aria-label="Slots" className="flex flex-col gap-2">
      <h2 className="font-sans text-lead font-semibold text-on-dark">This session</h2>
      <ol className="flex flex-col">
        {plans.map((plan) => {
          const status = slotStatus(plan, steps, done, stopped, currentSlotId, notHere)
          const groupId = plan.slot.groupId
          const header = groupId && !seenGroups.has(groupId) ? groupLabels.get(groupId) : undefined
          if (groupId) seenGroups.add(groupId)
          // The row names what the card runs: the plan's exercise, or where the rack or a back-off moved it on.
          const runs = exerciseById(plan.runsExerciseId)
          const firstCue = plan.slot.cues[0]
          // Another exercise runs (moved, swapped, backed off): the cue is program.md's for the slot's own, and says so.
          const writtenFor = cuesWrittenFor(plan.slot.exerciseId, runs.id, (id) => exerciseById(id).name)
          const cue = firstCue && writtenFor ? `${writtenFor}: ${firstCue}` : firstCue
          return (
            <li key={plan.slot.id} className={groupId ? 'border-l border-on-dark-faint pl-3' : ''}>
              {header ? <p className="pt-3 font-mono text-label uppercase tracking-[0.22em] text-on-dark-muted">{header}</p> : null}
              <button
                type="button"
                aria-label={`Slot ${plan.slot.label}: ${runs.name}${status.word ? `, ${status.word}` : ''}`}
                aria-current={plan.slot.id === currentSlotId ? 'step' : undefined}
                onClick={() => onPick(plan.slot.id)}
                className="tap flex w-full flex-col gap-1 border-b border-on-dark-faint py-3 text-left"
              >
                <span className="flex w-full items-baseline justify-between gap-3">
                  <span className="text-body text-on-dark">
                    <span className="font-mono text-small text-on-dark-muted">{plan.slot.label}</span> {runs.name}
                    <span className="text-on-dark-muted"> · {plan.slot.prescriptionText}</span>
                  </span>
                  {status.word ? (
                    <span className="shrink-0 font-mono text-small uppercase tracking-[0.22em] text-on-dark">
                      <span aria-hidden="true">{status.mark}</span> {status.word}
                    </span>
                  ) : null}
                </span>
                {cue ? <span className="text-small text-on-dark-muted">{cue}</span> : null}
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
