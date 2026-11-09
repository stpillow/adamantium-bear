import { useState } from 'react'
import { navigate } from '../app/router.ts'
import { PROGRAM } from '../app/session.ts'
import { useToday } from '../app/today.ts'
import { Button } from '../components/Button.tsx'
import { ReadingWord } from '../components/ReadingWord.tsx'
import { Screen } from '../components/Screen.tsx'
import { useHistory, useSettings } from '../db/hooks.ts'
import { addSessionMove, deleteSessionMove } from '../db/repo.ts'
import type { Day } from '../schema/index.ts'
import { WEEKDAY, buildMove, moveErrorSentence, movePrompt, undoErrorSentence, weekView, type DayAction, type DayRow, type MoveLine, type WeekView } from './Week.helpers.ts'

const TITLE = 'Week'
const LABEL = 'font-mono text-small uppercase tracking-[0.22em] text-on-dark-muted'
const HEADING = 'font-sans text-h3 font-medium text-on-dark'
const SECTION = 'flex flex-col gap-3'

/**
 * The program week at a glance: miles against the target, the seven days with what each holds,
 * what happened and how it read, and a way to move a session to another day of the same week.
 * Every verdict comes from src/rules through weekView; this file renders and collects taps.
 */
export function Week() {
  const today = useToday()
  const settings = useSettings()
  const history = useHistory()
  /** Null follows the current week, so the screen opens on it and keeps up when the week turns. */
  const [selected, setSelected] = useState<number | null>(null)
  /** The day whose session is being moved, waiting for the day it goes to. */
  const [moving, setMoving] = useState<Day | null>(null)
  /** The write in flight, so only the control that made it says "Saving…" while the rest wait. */
  const [pending, setPending] = useState<{ kind: 'move'; day: Day } | { kind: 'undo'; id: string } | null>(null)
  /** A refused write, in one sentence, shown beside the control that made it. */
  const [error, setError] = useState<{ where: 'move' | 'undo'; text: string } | null>(null)

  if (settings === undefined || history === undefined) {
    return (
      <Screen title={TITLE} lead="Opening storage…">
        <p className="text-body text-on-dark-dim">Reading this week’s runs, sessions and moves from the phone.</p>
      </Screen>
    )
  }
  if (settings === null) {
    return (
      <Screen title={TITLE} lead="No settings yet.">
        <p className="text-body text-on-dark-dim">The start date sets the weeks; it lives in Settings.</p>
        <Button wide onClick={() => navigate({ name: 'settings' })}>
          Settings
        </Button>
      </Screen>
    )
  }

  const view = weekView({ today, selected, settings, history, program: PROGRAM })
  const movingRow = moving ? (view.days.find((d) => d.day === moving) ?? null) : null
  const moveIds = history.sessionMoves.map((m) => m.id)
  const busy = pending !== null

  const cancelMove = () => {
    setMoving(null)
    setError(null)
  }

  const goTo = (week: number | null) => {
    setSelected(week)
    setMoving(null)
    setError(null)
  }

  async function swapWith(target: Day) {
    if (!moving) return
    // The rows only offer days the engine allows, but a write is checked again: the view may be stale.
    if (!view.days.find((d) => d.day === target)?.swappable || !view.days.find((d) => d.day === moving)?.movable) {
      setMoving(null)
      return
    }
    const move = buildMove(view.week, moving, target, moveIds)
    if (!move) {
      setMoving(null)
      return
    }
    setPending({ kind: 'move', day: target })
    setError(null)
    try {
      await addSessionMove(move)
      setMoving(null)
    } catch (e: unknown) {
      setError({ where: 'move', text: moveErrorSentence(e) })
    } finally {
      setPending(null)
    }
  }

  async function undo(id: string) {
    setPending({ kind: 'undo', id })
    setError(null)
    try {
      await deleteSessionMove(id)
    } catch (e: unknown) {
      setError({ where: 'undo', text: undoErrorSentence(e) })
    } finally {
      setPending(null)
    }
  }

  return (
    <Screen title={TITLE} lead={view.header}>
      <WeekNav view={view} onGo={goTo} />

      {view.stop ? (
        <section aria-label="Red flag" className="flex flex-col gap-2 rounded-sm border border-on-dark-faint p-4">
          <p className="text-body font-medium text-on-dark">{view.stop.headline}</p>
          <p className="text-small text-on-dark-dim">The red-flag state is on: progression is suspended until it is cleared in Settings, with a note.</p>
        </section>
      ) : null}

      <section aria-label="Miles" className={SECTION}>
        <h2 className={HEADING}>Miles</h2>
        <p className="text-lead text-on-dark">{view.miles}</p>
        <p className={view.capped ? 'text-body text-on-dark' : 'text-small text-on-dark-muted'}>{view.target}</p>
        {view.downPeriods.map((line) => (
          <p key={line} className="text-body text-on-dark-dim">
            {line}
          </p>
        ))}
      </section>

      <section aria-label="Days" className={SECTION}>
        <h2 className={HEADING}>Days</h2>
        <div aria-live="polite">
          {movingRow ? (
            <div className="flex flex-col gap-3 rounded-sm border border-paper p-4">
              <p className="text-body text-on-dark">{movePrompt(movingRow.session, movingRow.day)}</p>
              <Button variant="quiet" onClick={cancelMove} disabled={busy}>
                Cancel the move
              </Button>
            </div>
          ) : null}
        </div>
        {error?.where === 'move' ? (
          <p role="alert" className="text-body text-on-dark">
            {error.text}
          </p>
        ) : null}
        {view.moveNote ? <p className="text-small text-on-dark-muted">{view.moveNote}</p> : null}
        <ul className="flex flex-col">
          {view.days.map((row) => (
            <DayItem
              key={row.day}
              row={row}
              moving={moving}
              busy={busy}
              saving={pending?.kind === 'move' && pending.day === row.day}
              onMove={() => {
                setError(null)
                setMoving(row.day)
              }}
              onCancel={cancelMove}
              onSwap={() => void swapWith(row.day)}
            />
          ))}
        </ul>
      </section>

      <MovesBlock
        moves={view.moves}
        note={view.undoNote}
        busy={busy}
        undoing={pending?.kind === 'undo' ? pending.id : null}
        error={error?.where === 'undo' ? error.text : null}
        onUndo={(id) => void undo(id)}
      />
    </Screen>
  )
}

/** Where this week sits, the deload badge, and the buttons a week back and a week on. */
function WeekNav({ view, onGo }: { view: WeekView; onGo: (week: number | null) => void }) {
  return (
    <section aria-label="Which week" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className={LABEL}>{view.relation}</span>
        {view.deload ? (
          <span className="rounded-sm border border-on-dark-faint px-2 py-1 font-mono text-label uppercase tracking-[0.22em] text-on-dark">Deload week</span>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3">
        {view.prev !== null ? (
          <Button onClick={() => onGo(view.prev)} aria-label={`Previous week, week ${view.prev}`}>
            <span aria-hidden="true">←</span> Week {view.prev}
          </Button>
        ) : (
          <span className="text-small text-on-dark-muted">Week 1 is the first</span>
        )}
        {view.next !== null ? (
          <Button onClick={() => onGo(view.next)} aria-label={`Next week, week ${view.next}`}>
            Week {view.next} <span aria-hidden="true">→</span>
          </Button>
        ) : (
          <span className="text-small text-on-dark-muted">No week after this</span>
        )}
      </div>
      {view.week !== view.homeWeek ? (
        <Button variant="quiet" onClick={() => onGo(null)}>
          Back to week {view.homeWeek}
        </Button>
      ) : null}
    </section>
  )
}

function DayItem({
  row,
  moving,
  busy,
  saving,
  onMove,
  onCancel,
  onSwap,
}: {
  row: DayRow
  moving: Day | null
  busy: boolean
  /** This row's swap is the write in flight. */
  saving: boolean
  onMove: () => void
  onCancel: () => void
  onSwap: () => void
}) {
  // While a move waits for its second tap, the rows don't navigate: a tap is meant for the move.
  const action = moving === null ? row.action : null
  const body = (
    <>
      <span className={LABEL}>{row.dateWords}</span>
      <span className="text-body font-medium text-on-dark">{row.sessionWords}</span>
      {row.movedFrom ? <span className="text-small text-on-dark-muted">{row.movedFrom}</span> : null}
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-2 font-mono text-small uppercase tracking-[0.22em] text-on-dark-dim">
          {row.statusMark ? <span aria-hidden="true">{row.statusMark}</span> : null}
          {row.statusWord}
        </span>
        {row.reading ? <ReadingWord result={row.reading} /> : null}
        {row.downPeriod ? <span className="rounded-sm border border-on-dark-faint px-2 font-mono text-label uppercase tracking-[0.22em] text-on-dark-dim">{row.downPeriod}</span> : null}
      </span>
      {row.logged.length > 0 ? <span className="text-small text-on-dark-dim">Logged: {row.logged.join(' · ')}</span> : null}
      {row.checkNote ? <span className="text-small text-on-dark-muted">{row.checkNote}.</span> : null}
      {action ? (
        <span className="font-mono text-label uppercase tracking-[0.22em] text-on-dark">
          {action.label} <span aria-hidden="true">→</span>
        </span>
      ) : null}
    </>
  )

  const open = (a: DayAction) => {
    if (a.kind === 'summary') navigate({ name: 'session', workoutId: a.workoutId })
    else if (a.kind === 'preview') navigate({ name: 'preview', date: a.date })
    else navigate({ name: 'run' })
  }

  // A past day missing its morning check offers it (Batch D): a quiet button under the row, never
  // inside the row's own button; hidden while a move waits, when a tap is meant for the move.
  const late = moving === null ? row.lateCheck : null
  return (
    <li className={`flex flex-col gap-2 border-t border-on-dark-faint py-3 ${row.isToday ? 'border-l-2 border-l-paper pl-3' : ''}`}>
      <div className="flex items-start gap-3">
        {action ? (
          <button type="button" onClick={() => open(action)} className="tap flex flex-1 flex-col items-start gap-1 rounded-sm text-left">
            {body}
          </button>
        ) : (
          <div className="flex flex-1 flex-col gap-1">{body}</div>
        )}
        <MoveControl row={row} moving={moving} busy={busy} saving={saving} onMove={onMove} onCancel={onCancel} onSwap={onSwap} />
      </div>
      {row.lateFlagNote ? <p className="text-small text-on-dark">{row.lateFlagNote}.</p> : null}
      {late ? (
        <Button variant="quiet" className="self-start" onClick={() => navigate({ name: 'morning', date: late.morning })}>
          {late.label}
        </Button>
      ) : null}
    </li>
  )
}

/** "Move" on every day that is not off; while a move waits, "Swap here" on the others and "Cancel" on its own day. */
function MoveControl({
  row,
  moving,
  busy,
  saving,
  onMove,
  onCancel,
  onSwap,
}: {
  row: DayRow
  moving: Day | null
  busy: boolean
  saving: boolean
  onMove: () => void
  onCancel: () => void
  onSwap: () => void
}) {
  if (moving === null) {
    if (!row.movable) return null
    return (
      <Button variant="quiet" onClick={onMove} disabled={busy} aria-label={`Move ${row.sessionWords} from ${WEEKDAY[row.day]}`}>
        Move
      </Button>
    )
  }
  if (moving === row.day) {
    return (
      <Button variant="quiet" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
    )
  }
  if (!row.swappable) return <span className="text-small text-on-dark-muted">Logged, stays</span>
  return (
    <Button onClick={onSwap} disabled={busy} aria-label={saving ? undefined : `Swap here, ${WEEKDAY[row.day]}`}>
      {saving ? 'Saving…' : 'Swap here'}
    </Button>
  )
}

function MovesBlock({
  moves,
  note,
  busy,
  undoing,
  error,
  onUndo,
}: {
  moves: MoveLine[]
  note: string | null
  busy: boolean
  /** The move whose undo is the write in flight. */
  undoing: string | null
  error: string | null
  onUndo: (id: string) => void
}) {
  if (moves.length === 0 && error === null) return null
  return (
    <section aria-label="Moves this week" className={SECTION}>
      <h2 className={HEADING}>Moves this week</h2>
      {error ? (
        <p role="alert" className="text-body text-on-dark">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col">
        {moves.map((move) => (
          <li key={move.id} className="flex items-center justify-between gap-4 border-t border-on-dark-faint py-3">
            <span className="flex flex-col gap-1">
              <span className="text-body text-on-dark">{move.title}</span>
              <span className="text-small text-on-dark-dim">{move.detail}</span>
            </span>
            {move.undoable ? (
              <Button onClick={() => onUndo(move.id)} disabled={busy} aria-label={undoing === move.id ? undefined : `Undo: ${move.title}`}>
                {undoing === move.id ? 'Saving…' : 'Undo'}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {note ? <p className="text-small text-on-dark-muted">{note}</p> : null}
    </section>
  )
}
