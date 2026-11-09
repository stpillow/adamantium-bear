import { useMemo, useRef, useState, type RefObject } from 'react'
import { navigate } from '../app/router.ts'
import { PROGRAM } from '../app/session.ts'
import { useToday } from '../app/today.ts'
import { Button } from '../components/Button.tsx'
import { NumberField } from '../components/NumberField.tsx'
import { Screen } from '../components/Screen.tsx'
import { useHistory, useHrSettings, useKoosEntries, useSettings, useVo2Readings } from '../db/hooks.ts'
import { deleteVo2Reading, saveVo2Reading, type History } from '../db/repo.ts'
import type { IsoDate, KoosEntry, Settings, Vo2Reading } from '../schema/index.ts'
import {
  LIST_LIMIT,
  exerciseView,
  loadSubtitle,
  pickedRow,
  progressView,
  symmetryEmptyWords,
  symmetryName,
  visibleRows,
  vo2Entry,
  type AdherenceView,
  type CleanDaysView,
  type ExerciseRow,
  type ExerciseView,
  type MilesView,
  type SymmetryRef,
  type KoosView,
  type TagsView,
  type TrainingLoadView,
  type Vo2View,
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
 * symmetry when it is two-sided, the weekly miles against the plan, the weekly training load
 * with its warning in words, and the VO2 max readings typed from the watch. Every number comes from
 * src/rules through Progress.helpers; this file renders and takes the one tap that picks an exercise.
 */
export function Progress() {
  const today = useToday()
  const settings = useSettings()
  const history = useHistory()
  // The VO2 readings load with the history, so the section never says "No readings yet" before the read lands (metrics phase 3).
  const vo2Readings = useVo2Readings()
  // The KOOS entries the same way (Batch A): they come in on their own, never through History.
  const koosEntries = useKoosEntries()

  if (settings === undefined || history === undefined || vo2Readings === undefined || koosEntries === undefined) {
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
  return <ProgressBody today={today} settings={settings} history={history} vo2Readings={vo2Readings} koosEntries={koosEntries} />
}

function ProgressBody({ today, settings, history, vo2Readings, koosEntries }: { today: IsoDate; settings: Settings; history: History; vo2Readings: Vo2Reading[]; koosEntries: KoosEntry[] }) {
  const [picked, setPicked] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const chartRef = useRef<HTMLDivElement | null>(null)

  // Shawn's max and resting HR (metrics phase 2): only the HR-load line reads them; undefined while loading reads as none.
  const hrSettings = useHrSettings()
  const view = useMemo(
    () => progressView({ today, settings, history, program: PROGRAM, hrSettings: hrSettings ?? null, vo2Readings, koosEntries }),
    [today, settings, history, hrSettings, vo2Readings, koosEntries],
  )
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
    <Screen title={TITLE} lead="What is logged on this phone, over time: clean days, loads, symmetry, miles, training load, VO2 max, KOOS and morning tags.">
      <CleanDays clean={view.clean} adherence={view.adherence} downPeriods={view.downPeriods} />
      <LoadSection rows={view.exercises} row={row} exercise={exercise} showAll={showAll} onShowAll={setShowAll} onPick={pick} chartRef={chartRef} />
      <SymmetrySection row={row} exercise={exercise} settings={settings} refs={view.refs} />
      <MilesSection miles={view.miles} />
      <TrainingLoadSection training={view.training} />
      <Vo2Section vo2={view.vo2} readings={vo2Readings} today={today} />
      <KoosSection koos={view.koos} />
      <TagsSection tags={view.tags} />
    </Screen>
  )
}

/**
 * 1. The stat: a Fraunces number with its unit, and the line that makes it mean something. Under it
 * (Batch B), each program week's sessions done of those scheduled, in words, newest first: a record
 * beside the count, never a streak.
 */
function CleanDays({ clean, adherence, downPeriods }: { clean: CleanDaysView; adherence: AdherenceView; downPeriods: string[] }) {
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
      {adherence.note ? (
        <div className="flex flex-col gap-1">
          <p className="text-small text-on-dark-muted">{adherence.note}</p>
          <ul aria-label="Sessions done by week" className="flex flex-col gap-1">
            {adherence.lines.map((line) => (
              <li key={line} className="text-body text-on-dark">
                {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {downPeriods.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-small text-on-dark-muted">Down periods: progression paused, readings kept as read.</p>
          <ul aria-label="Down periods" className="flex flex-col gap-1">
            {downPeriods.map((line) => (
              <li key={line} className="text-body text-on-dark">
                {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
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
 * week, and the warning when the smoothed recent rate runs well above or below the longer one (Batch B: EWMA).
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
        RPE × minutes for every session and run, swaps included, by program week. The comparison below is smoothed day by day, weighted toward yesterday. A warning only: nothing here
        changes a prescription. HR load (TRIMP) is shown beside the training load; the
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

/**
 * 6. VO2 max (metrics phase 3): the latest reading typed from the watch, the entry right here (no
 * trip to Settings), and the worded trend, newest first. Nothing is estimated, and nothing here
 * changes a prescription: the screen talks only to Progress.helpers (the vo2 guard holds the rule
 * module to the helpers), and the readings never ride in History. Out of range is refused in words
 * beside the field and never clamped; the Save button carries the blocker word for word, disabled,
 * as the run logger's does. Every state is a word, never a color.
 */
function Vo2Section({ vo2, readings, today }: { vo2: Vo2View; readings: Vo2Reading[]; today: IsoDate }) {
  const [value, setValue] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const entry = vo2Entry({ value, readings, today })

  const save = async () => {
    if (entry.problem !== null || value === null) return
    setSaving(true)
    try {
      await saveVo2Reading({ date: today, vo2: value })
      setValue(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-label="VO2 max" className={SECTION}>
      <h2 className={HEADING}>VO2 max</h2>
      <p className="text-small text-on-dark-muted">
        The number the watch shows, typed in whenever it changes. The trend is the readings alone — nothing is estimated. It informs; nothing here changes a prescription.
      </p>
      {vo2.latest ? (
        <p className="flex flex-col gap-1">
          <span className="font-display text-stat text-on-dark">{vo2.latest.value}</span>
          <span className="text-body text-on-dark-dim">mL/kg/min, {vo2.latest.when}</span>
        </p>
      ) : (
        <p className="text-body text-on-dark-dim">{vo2.empty}</p>
      )}
      <NumberField label="Today’s reading" unit="mL/kg/min" placeholder="—" value={value} onChange={setValue} />
      {entry.replaces ? <p className="text-small text-on-dark-dim">{entry.replaces}</p> : null}
      <Button variant="primary" wide disabled={entry.problem !== null || saving} onClick={() => void save()}>
        {saving ? 'Saving…' : entry.saveLabel}
      </Button>
      {vo2.trend.length > 0 ? <Vo2TrendList rows={vo2.trend} /> : null}
    </section>
  )
}

/**
 * 7. KOOS (Batch A): the five subscale trends in words and numbers, in the style of the VO2 and
 * training-load sections. The scores show HERE ONLY, never on the Gates screen (Shawn, Nov 8),
 * and they inform and change nothing; the form itself is its own screen, a tap away. The due
 * words surface here too, the same line Today carries.
 */
function KoosSection({ koos }: { koos: KoosView }) {
  return (
    <section aria-label="KOOS" className={SECTION}>
      <h2 className={HEADING}>KOOS</h2>
      <p className="text-small text-on-dark-muted">
        The knee in its own words, 42 questions over the last week, scored 0 to 100 per subscale (100 = no problems). It informs; nothing here changes a prescription or a gate.
      </p>
      {koos.due ? <p className="text-body text-on-dark">{koos.due}</p> : null}
      {koos.rows.length > 0 ? (
        <ul className="flex flex-col">
          {koos.rows.map((row) => (
            <li key={row.name} className="flex flex-col border-t border-on-dark-faint py-1 first:border-t-0">
              <span className="text-body text-on-dark">{row.name}</span>
              <span className="text-small text-on-dark-dim">{row.words}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-on-dark-dim">{koos.empty}</p>
      )}
      <Button wide onClick={() => navigate({ name: 'koos' })}>
        Open the KOOS form
      </Button>
    </section>
  )
}

/**
 * Morning tags (Batch D, PROGRAM-QUESTIONS 178): plain counts in words, after each tag and on the
 * mornings without it. No score, no chart, no color; a count says what came after, never why.
 */
function TagsSection({ tags }: { tags: TagsView }) {
  return (
    <section aria-label="Morning tags" className={SECTION}>
      <h2 className={HEADING}>Morning tags</h2>
      <p className="text-small text-on-dark-muted">{tags.intro}</p>
      {tags.empty ? (
        <p className="text-body text-on-dark-dim">{tags.empty}</p>
      ) : (
        <ul className="flex flex-col">
          {tags.rows.map((row) => (
            <li key={row.tag} className="flex flex-col border-t border-on-dark-faint py-1 first:border-t-0">
              <span className="text-body text-on-dark">{row.line}</span>
              {row.without ? <span className="text-small text-on-dark-dim">{row.without}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** The stored readings, newest first, each a worded row with a quiet Delete: a reading is re-typeable, so no confirm (the HR Clear precedent). */
function Vo2TrendList({ rows }: { rows: { date: IsoDate; words: string }[] }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-mono text-small font-normal uppercase tracking-[0.22em] text-on-dark-muted">Readings</h3>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.date} className="flex items-center justify-between gap-3 border-t border-on-dark-faint py-1 first:border-t-0">
            <span className="text-small text-on-dark-dim">{row.words}</span>
            <Button variant="quiet" className="shrink-0 px-0!" onClick={() => void deleteVo2Reading(row.date)}>
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </div>
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
