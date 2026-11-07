import { useMemo, useRef, useState, type RefObject } from 'react'
import { navigate } from '../app/router.ts'
import { PROGRAM } from '../app/session.ts'
import { useToday } from '../app/today.ts'
import { Button } from '../components/Button.tsx'
import { Screen } from '../components/Screen.tsx'
import { useHistory, useHrSettings, useSettings } from '../db/hooks.ts'
import type { History } from '../db/repo.ts'
import type { IsoDate, Settings } from '../schema/index.ts'
import {
  LIST_LIMIT,
  exerciseView,
  loadSubtitle,
  pickedRow,
  progressView,
  symmetryEmptyWords,
  symmetryName,
  visibleRows,
  type CleanDaysView,
  type ExerciseRow,
  type ExerciseView,
  type MilesView,
  type SymmetryRef,
  type TrainingLoadView,
} from './Progress.helpers.ts'
import { LoadChart } from './progress/LoadChart.tsx'
import { MilesChart } from './progress/MilesChart.tsx'
import { SymmetryChart } from './progress/SymmetryChart.tsx'
import { TrainingLoadChart } from './progress/TrainingLoadChart.tsx'

const TITLE = 'Progress'
const HEADING = 'font-sans text-h3 font-medium text-on-dark'
const SECTION = 'flex flex-col gap-3'

/**
 * How the knee is coming along: the run of clean days, one exercise's load over time, its
 * symmetry when it is two-sided, the weekly miles against the plan, and the weekly training load
 * with its warning in words. Every number comes from
 * src/rules through Progress.helpers; this file renders and takes the one tap that picks an exercise.
 */
export function Progress() {
  const today = useToday()
  const settings = useSettings()
  const history = useHistory()

  if (settings === undefined || history === undefined) {
    return (
      <Screen title={TITLE} lead="Opening storage…">
        <p className="text-body text-on-dark-dim">Reading the logged sessions, runs and morning checks from the phone.</p>
      </Screen>
    )
  }
  if (settings === null) {
    return (
      <Screen title={TITLE} lead="No settings yet.">
        <p className="text-body text-on-dark-dim">The injured side and the start date are set in Settings; the charts read both.</p>
        <Button wide onClick={() => navigate({ name: 'settings' })}>
          Settings
        </Button>
      </Screen>
    )
  }
  return <ProgressBody today={today} settings={settings} history={history} />
}

function ProgressBody({ today, settings, history }: { today: IsoDate; settings: Settings; history: History }) {
  const [picked, setPicked] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const chartRef = useRef<HTMLDivElement | null>(null)

  // Shawn's max and resting HR (metrics phase 2): only the HR-load line reads them; undefined while loading reads as none.
  const hrSettings = useHrSettings()
  const view = useMemo(() => progressView({ today, settings, history, program: PROGRAM, hrSettings: hrSettings ?? null }), [today, settings, history, hrSettings])
  const row = pickedRow(view.exercises, picked)
  const exercise = useMemo(
    () => (row ? exerciseView({ records: view.records, setLogs: history.setLogs, row, injuredSide: settings.injuredSide, catalog: PROGRAM.exercises }) : null),
    [row, view.records, history.setLogs, settings.injuredSide],
  )

  const pick = (id: string) => {
    setPicked(id)
    // The chart sits under the list; bring it into view so the tap shows its answer.
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    chartRef.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  }

  return (
    <Screen title={TITLE} lead="What is logged on this phone, over time: clean days, loads, symmetry, miles and training load.">
      <CleanDays clean={view.clean} />
      <LoadSection rows={view.exercises} row={row} exercise={exercise} showAll={showAll} onShowAll={setShowAll} onPick={pick} chartRef={chartRef} />
      <SymmetrySection row={row} exercise={exercise} settings={settings} refs={view.refs} />
      <MilesSection miles={view.miles} />
      <TrainingLoadSection training={view.training} />
    </Screen>
  )
}

/** 1. The stat: a Fraunces number with its unit, and the line that makes it mean something. */
function CleanDays({ clean }: { clean: CleanDaysView }) {
  return (
    <section aria-label="Consecutive clean days" className={SECTION}>
      <h2 className={HEADING}>Consecutive clean days</h2>
      <p className="flex flex-col gap-1">
        <span className="font-display text-stat text-on-dark">{clean.count}</span>
        <span className="text-body text-on-dark-dim">
          {/* A text token, not green: on this screen green-bright marks the injured side in the charts, and text never wears a data color. */}
          {clean.unit ? <span className="text-on-dark">{clean.unit} </span> : null}
          {clean.context}
        </span>
      </p>
      {clean.note ? <p className="text-small text-on-dark-muted">{clean.note}</p> : null}
    </section>
  )
}

/** 2. One exercise at a time: the logged exercises, most recent first, one tap picks; then its load chart. */
function LoadSection({
  rows,
  row,
  exercise,
  showAll,
  onShowAll,
  onPick,
  chartRef,
}: {
  rows: ExerciseRow[]
  row: ExerciseRow | null
  exercise: ExerciseView | null
  showAll: boolean
  onShowAll: (v: boolean) => void
  onPick: (id: string) => void
  chartRef: RefObject<HTMLDivElement | null>
}) {
  if (rows.length === 0 || !row || !exercise) {
    return (
      <section aria-label="Load over time" className={SECTION}>
        <h2 className={HEADING}>Load over time</h2>
        <p className="text-body text-on-dark-dim">Log a session to see this. Once a session is finished, each exercise it logged is listed here, with its heaviest set per session drawn over time.</p>
      </section>
    )
  }
  const shown = visibleRows(rows, showAll)
  return (
    <section aria-label="Load over time" className={SECTION}>
      <h2 className={HEADING}>Load over time</h2>
      <p className="text-small text-on-dark-muted">Exercises with logged sets, most recent first. Tap one to chart it.</p>
      <ul className="flex flex-col">
        {shown.map((r) => {
          const on = r.id === row.id
          return (
            <li key={r.id} className="border-t border-on-dark-faint">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onPick(r.id)}
                className={`tap flex w-full items-center justify-between gap-3 py-3 text-left ${on ? 'border-l-2 border-l-paper pl-3' : ''}`}
              >
                <span className="flex flex-col gap-1">
                  <span className="text-body text-on-dark">{r.name}</span>
                  <span className="text-small text-on-dark-muted">{r.detail}</span>
                </span>
                <span className={`shrink-0 font-mono text-small uppercase tracking-[0.22em] ${on ? 'text-on-dark' : 'text-on-dark-muted'}`}>{on ? '✓ Showing' : 'Show'}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {rows.length > LIST_LIMIT ? (
        // px-0! because Button's own px-6 comes later in the CSS and would win over a plain px-0.
        <Button variant="quiet" className="self-start px-0!" aria-expanded={showAll} onClick={() => onShowAll(!showAll)}>
          {showAll ? `Show the ${LIST_LIMIT} most recent` : `Show all ${rows.length} exercises`}
        </Button>
      ) : null}
      <div ref={chartRef} className="flex scroll-mt-4 flex-col gap-2 pt-2">
        <h3 className="font-sans text-lead font-medium text-on-dark">{row.name}</h3>
        <p className="text-small text-on-dark-muted">{loadSubtitle(exercise.chart, exercise.exercise, row.name)}</p>
        <LoadChart key={row.id} chart={exercise.chart} name={row.name} />
      </div>
    </section>
  )
}

/** 3. The picked exercise's symmetry, when it is two-sided: one line in percent against the gates' lines. */
function SymmetrySection({ row, exercise, settings, refs }: { row: ExerciseRow | null; exercise: ExerciseView | null; settings: Settings; refs: SymmetryRef[] }) {
  const points = exercise?.symmetry ?? []
  return (
    <section aria-label="Symmetry over time" className={SECTION}>
      <h2 className={HEADING}>Symmetry over time</h2>
      {row && exercise && points.length > 0 ? (
        <>
          <p className="text-small text-on-dark-muted">
            {row.name}: the {settings.injuredSide} side as a percent of the other ({symmetryName(settings.injuredSide).toLowerCase()}), per session. Loads are compared when they differ; the reps or seconds when they match or there is no load. A session on different steps, stages or ranges, or capped by a gym’s rack, is left out and listed under the chart.
          </p>
          <SymmetryChart key={row.id} points={points} name={row.name} injuredSide={settings.injuredSide} countUnit={exercise.chart.countUnit} refs={refs} />
        </>
      ) : (
        <p className="text-body text-on-dark-dim">{symmetryEmptyWords(row, exercise?.chart ?? null, settings.injuredSide, exercise?.leftOut.length ?? 0)}</p>
      )}
      {exercise && exercise.leftOut.length > 0 ? <LeftOutList lines={exercise.leftOut} /> : null}
    </section>
  )
}

/** The sessions the symmetry line leaves out, each with why, so none is simply missing. */
function LeftOutList({ lines }: { lines: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-mono text-small font-normal uppercase tracking-[0.22em] text-on-dark-muted">Left out of the line</h3>
      <ul className="flex flex-col">
        {lines.map((line) => (
          <li key={line} className="border-t border-on-dark-faint py-2 text-small text-on-dark-dim first:border-t-0">
            {line}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 4. The 12 weeks of miles, actual against plan. */
function MilesSection({ miles }: { miles: MilesView }) {
  return (
    <section aria-label="Weekly miles" className={SECTION}>
      <h2 className={HEADING}>Weekly miles</h2>
      <p className="text-small text-on-dark-muted">
        Actual miles against the plan, weeks 1 to 12. The plan holds flat in the deload weeks, so it never drops. {miles.anyRuns ? 'Swaps count as sessions and add no miles.' : 'No runs logged yet; each week’s column fills in as its runs are logged.'}
      </p>
      <MilesChart view={miles} />
    </section>
  )
}

/**
 * 5. Weekly training load (metrics phase 1): RPE × minutes for every session and run, by program
 * week, and the warning when the 7 days through yesterday run well above or below the weeks before.
 * The warning is a word with an arrow, never a color, and plain text (no live region: the history
 * re-reads on every write, and a status line would announce again each time). Metrics phase 2 adds
 * this week's HR load (TRIMP) in words under the warning; the warning reads the RPE load alone, so
 * the two can disagree visibly.
 */
function TrainingLoadSection({ training }: { training: TrainingLoadView }) {
  return (
    <section aria-label="Weekly training load" className={SECTION}>
      <h2 className={HEADING}>Weekly training load</h2>
      <p className="text-small text-on-dark-muted">
        RPE × minutes for every session and run, swaps included, by program week. A warning only: nothing here changes a prescription. HR load (TRIMP) is shown beside the training load; the
        warning reads the RPE load alone.
      </p>
      <p className="text-body text-on-dark">
        {training.warning.mark ? <span className="font-mono text-small uppercase tracking-[0.22em] text-on-dark">{training.warning.mark} · </span> : null}
        {training.warning.text}
      </p>
      {training.hrLine ? <p className="text-body text-on-dark">{training.hrLine}</p> : null}
      {training.skews.map((line) => (
        <p key={line} className="text-small text-on-dark-dim">
          {line}
        </p>
      ))}
      {training.any ? (
        <TrainingLoadChart view={training} />
      ) : (
        <p className="text-body text-on-dark-dim">Log a session or run to see this. Each one adds its RPE times its minutes to its week.</p>
      )}
      {training.olderRuns ? <p className="text-small text-on-dark-muted">{training.olderRuns}</p> : null}
      {training.notCounted.length > 0 ? <NotCountedList lines={training.notCounted} /> : null}
    </section>
  )
}

/** The sessions and runs training load leaves out, each with why, so none is simply missing. */
function NotCountedList({ lines }: { lines: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-mono text-small font-normal uppercase tracking-[0.22em] text-on-dark-muted">Not counted</h3>
      <ul className="flex flex-col">
        {lines.map((line) => (
          <li key={line} className="border-t border-on-dark-faint py-2 text-small text-on-dark-dim first:border-t-0">
            {line}
          </li>
        ))}
      </ul>
    </div>
  )
}
