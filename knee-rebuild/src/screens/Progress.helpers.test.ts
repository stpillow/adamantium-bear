import { describe, expect, it } from 'vitest'
import { program } from '../program/program.ts'
import { attachChecks, subjectReadings } from '../rules/history.ts'
import type { MilesWeek } from '../rules/progress.ts'
import type { SubjectReading } from '../rules/history.ts'
import type { Exercise, MileageWeek, MorningCheck, MorningTag, Run, SessionTemplate, SetLog, Settings, Workout } from '../schema/index.ts'
import {
  tagsView,
  type TagsView,
  axisDate,
  bandCenters,
  clampCenter,
  cleanDaysView,
  columnChartGeometry,
  columnPath,
  comparedWords,
  countUnitFor,
  crossings,
  datePositions,
  exerciseView,
  fmt,
  focusIndex,
  gatesWords,
  gestureAt,
  labelledPoints,
  leftOutLines,
  lineChartGeometry,
  linePath,
  lineYAt,
  loadAria,
  loadChart,
  loadReadout,
  loadSubtitle,
  loadTable,
  loggedExercises,
  milesAria,
  milesReadout,
  milesTable,
  milesView,
  nearestIndex,
  niceAxis,
  niceStep,
  pickedRow,
  progressView,
  adherenceLine,
  adherenceView,
  readoutText,
  refLabelBox,
  scaleLinear,
  spreadLabels,
  stepIndex,
  symmetryAria,
  symmetryAxis,
  symmetryEmptyWords,
  symmetryReadout,
  symmetryRefs,
  symmetryTable,
  textWidth,
  trainingLoadAria,
  trainingLoadNumber,
  trainingLoadReadout,
  trainingLoadTable,
  trainingLoadView,
  hrWeekLine,
  trainingLoadWarning,
  notCountedLines,
  ratioWords,
  skewLines,
  visibleRows,
  koosView,
  vo2Entry,
  vo2View,
  waitingWords,
  type HistoryLike,
  downPeriodLines,
} from './Progress.helpers.ts'
import type { AcuteChronic, TrainingLoadEntry } from '../rules/trainingLoad.ts'

const START = '2026-11-02'
const workout = (id: string, date: string, status: Workout['status'] = 'finished', templateId = 'p2-b'): Workout => ({ id, date, templateId, phase: 2, week: 5, isDeload: false, status })
const set = (workoutId: string, side: SetLog['side'], n: number, load: number, reps: number, exerciseId = 'bulgarian-split-squat'): SetLog => ({
  id: `${workoutId}-${exerciseId}-${side}-${n}`,
  workoutId,
  slotId: 'p2b-1',
  exerciseId,
  setNumber: n,
  side,
  load,
  loadUnit: 'lb',
  reps,
  painDuring: 1,
  stopped: false,
})
const timed = (workoutId: string, side: SetLog['side'], n: number, seconds: number, exerciseId = 'single-leg-balance'): SetLog => ({ id: `${workoutId}-${exerciseId}-${side}-${n}`, workoutId, slotId: 'p1a-9', exerciseId, setNumber: n, side, load: 0, loadUnit: 's', seconds, stopped: false })
const check = (date: string, over: Partial<MorningCheck> = {}): MorningCheck => ({ id: `m-${date}`, date, appliesTo: null, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [], ...over })
const run = (id: string, date: string, miles: number, maxPain = 1, type: Run['type'] = 'easy'): Run => ({ id, date, type, miles, minutes: 30, effort: 'easy', maxPain, strides: false, tempo: false })
const templates: SessionTemplate[] = [
  { id: 'p2-b', phase: 2, letter: 'B', slots: [] },
  { id: 'p1-a', phase: 1, letter: 'A', slots: [] },
]
const catalog = (over: Partial<Exercise> & Pick<Exercise, 'id' | 'name'>): Exercise => ({ pattern: 'single-leg', equipment: 'dumbbells', loadType: 'dumbbell-each', loadUnit: 'lb', increment: 5, loadDirection: 'up', unilateral: true, requires: [], ...over })
const CATALOG: Exercise[] = [
  catalog({ id: 'bulgarian-split-squat', name: 'Bulgarian split squat' }),
  catalog({ id: 'leg-press', name: 'Leg press, both legs', pattern: 'squat', loadType: 'stack', unilateral: false }),
  catalog({ id: 'single-leg-balance', name: 'Single-leg balance', pattern: 'balance', loadType: 'time', loadUnit: 's', increment: 5 }),
  catalog({ id: 'assisted-pull-up', name: 'Assisted pull-up', pattern: 'pull', loadType: 'stack', unilateral: false, loadDirection: 'down' }),
]
const settings: Settings = {
  injuredSide: 'right',
  startDate: START,
  dumbbellMax: 80,
  restTimerSeconds: 60,
  painPerSet: false,
  currentPhase: 1,
  phaseEnteredWeek: 1,
  redFlag: { active: false, items: [] },
  activeLocationId: 'planet-fitness',
  kit: ['ankle-strap', 'mini-band'],
}

describe('words', () => {
  it('dates under an axis, numbers to one decimal, gates in a list', () => {
    expect(axisDate('2026-11-03')).toBe('Nov 3')
    expect(axisDate('2027-01-25')).toBe('Jan 25')
    expect(fmt(185)).toBe('185')
    expect(fmt(87.5)).toBe('87.5')
    expect(fmt(12.25)).toBe('12.3')
    expect(gatesWords([1])).toBe('Gate 1')
    expect(gatesWords([3, 2])).toBe('Gates 2 and 3')
    expect(gatesWords([1, 2, 3])).toBe('Gates 1, 2 and 3')
  })
})

describe('scales and ticks', () => {
  it('maps a domain onto a range; a zero-width domain lands in the middle', () => {
    const y = scaleLinear([0, 20], [200, 0])
    expect(y(0)).toBe(200)
    expect(y(10)).toBe(100)
    expect(scaleLinear([5, 5], [0, 100])(5)).toBe(50)
  })

  it('picks 1, 2 or 5 times a power of ten', () => {
    expect(niceStep(18, 4)).toBe(5)
    expect(niceStep(5, 4)).toBe(2)
    expect(niceStep(30, 4)).toBe(10)
    expect(niceStep(0.8, 4)).toBe(0.2)
    expect(niceStep(0, 4)).toBe(1)
  })

  it('covers the data with clean ticks on one axis', () => {
    expect(niceAxis(0, 18)).toEqual({ min: 0, max: 20, ticks: [0, 5, 10, 15, 20] })
    expect(niceAxis(70, 100)).toEqual({ min: 70, max: 100, ticks: [70, 80, 90, 100] })
    expect(niceAxis(20, 25).ticks).toEqual([20, 22, 24, 26])
  })

  it('gives a single value room on both sides and never goes below the floor', () => {
    const one = niceAxis(25, 25)
    expect(one.min).toBeLessThan(25)
    expect(one.max).toBeGreaterThan(25)
    expect(niceAxis(0, 0)).toEqual({ min: 0, max: 1, ticks: [0, 0.5, 1] })
    expect(niceAxis(2, 3).min).toBeGreaterThanOrEqual(0)
  })

  it('a whole-number axis never shows half steps', () => {
    expect(niceAxis(8, 8).ticks).toEqual([7, 7.5, 8, 8.5, 9])
    expect(niceAxis(8, 8, 4, 0, 1).ticks).toEqual([7, 8, 9])
  })
})

describe('positions and hit testing', () => {
  it('spaces dates by the days between them; one date sits in the middle', () => {
    expect(datePositions(['2026-11-03', '2026-11-05', '2026-11-13'], 0, 100)).toEqual([0, 20, 100])
    expect(datePositions(['2026-11-03'], 0, 100)).toEqual([50])
    expect(datePositions([], 0, 100)).toEqual([])
  })

  it('splits a width into equal slots, one per week', () => {
    expect(bandCenters(4, 0, 100)).toEqual({ centers: [12.5, 37.5, 62.5, 87.5], slot: 25 })
    expect(bandCenters(0, 0, 100)).toEqual({ centers: [], slot: 0 })
  })

  it('a tap anywhere picks the nearest date, the earlier on a tie; nothing with no dates', () => {
    const xs = [10, 50, 90]
    expect(nearestIndex(xs, 0)).toBe(0)
    expect(nearestIndex(xs, 69)).toBe(1)
    expect(nearestIndex(xs, 71)).toBe(2)
    expect(nearestIndex(xs, 30)).toBe(0)
    expect(nearestIndex(xs, 400)).toBe(2)
    expect(nearestIndex([], 10)).toBeNull()
  })

  it('arrow keys step through the dates, Home and End jump, other keys do nothing', () => {
    expect(stepIndex(null, 'ArrowLeft', 4)).toBe(3)
    expect(stepIndex(3, 'ArrowLeft', 4)).toBe(2)
    expect(stepIndex(0, 'ArrowLeft', 4)).toBe(0)
    expect(stepIndex(2, 'ArrowRight', 4)).toBe(3)
    expect(stepIndex(3, 'ArrowRight', 4)).toBe(3)
    expect(stepIndex(2, 'Home', 4)).toBe(0)
    expect(stepIndex(0, 'End', 4)).toBe(3)
    expect(stepIndex(1, 'Enter', 4)).toBeNull()
    expect(stepIndex(null, 'ArrowRight', 0)).toBeNull()
  })

  it('a touch is a tap only while it stays within 10 px; past that it is a drag along the dates or a scroll of the page', () => {
    const start = { x: 100, y: 200 }
    expect(gestureAt(start, { x: 100, y: 200 })).toBe('tap')
    expect(gestureAt(start, { x: 108, y: 194 })).toBe('tap')
    // A vertical swipe that starts on the chart scrolls the page and picks nothing.
    expect(gestureAt(start, { x: 100, y: 180 })).toBe('scroll')
    expect(gestureAt(start, { x: 112, y: 160 })).toBe('scroll')
    // Sideways past the slop is a scrub along the dates.
    expect(gestureAt(start, { x: 130, y: 205 })).toBe('drag')
    expect(gestureAt(start, { x: 70, y: 190 })).toBe('drag')
    expect(gestureAt(start, { x: 104, y: 200 }, 3)).toBe('drag')
  })

  it('focus opens on the chart’s own opening point: this week on the miles chart, not the plan’s last week', () => {
    // Week 3 of 12: the readout opens on index 2, and focus and the first arrow start there.
    expect(focusIndex(null, 2, 12)).toBe(2)
    expect(focusIndex(7, 2, 12)).toBe(7)
    expect(focusIndex(null, 2, 0)).toBeNull()
    expect(focusIndex(null, 40, 12)).toBe(11)
    expect(stepIndex(null, 'ArrowRight', 12, 2)).toBe(3)
    expect(stepIndex(null, 'ArrowLeft', 12, 2)).toBe(2)
    // The line charts open on their latest point, as before.
    expect(focusIndex(null, undefined, 4)).toBe(3)
    expect(stepIndex(null, 'ArrowLeft', 4, undefined)).toBe(3)
  })
})

describe('label selection and placement', () => {
  it('labels the last point and the highest when it is another, higher point', () => {
    expect(labelledPoints([20, 30, 25])).toEqual({ last: 2, extreme: 1 })
    expect(labelledPoints([20, 25, 30])).toEqual({ last: 2, extreme: null })
    expect(labelledPoints([30, 25, 30])).toEqual({ last: 2, extreme: null })
    expect(labelledPoints([])).toEqual({ last: null, extreme: null })
  })

  it('pushes colliding end labels apart, keeps them in order and inside the plot', () => {
    expect(spreadLabels([50, 100], 14, 0, 200)).toEqual([50, 100])
    expect(spreadLabels([100, 96], 14, 0, 200)).toEqual([110, 96])
    expect(spreadLabels([198, 199], 14, 0, 200)).toEqual([186, 200])
    expect(spreadLabels([1, 2], 14, 0, 200)).toEqual([1, 15])
  })

  it('estimates text widths and keeps a centred label inside its bounds', () => {
    expect(textWidth('Nov 3')).toBe(36)
    expect(textWidth('deload', 12, false)).toBe(40.32)
    expect(clampCenter(5, 40, 0, 343)).toBe(20)
    expect(clampCenter(340, 40, 0, 343)).toBe(323)
    expect(clampCenter(100, 40, 0, 343)).toBe(100)
  })

  it('draws a line through its points, and a column rounded at the top and square at the baseline', () => {
    expect(linePath([{ x: 0, y: 10 }, { x: 5.555, y: 20 }])).toBe('M0 10L5.56 20')
    expect(columnPath(50, 20, 100, 40)).toBe('M40 100V44A4 4 0 0 1 44 40H56A4 4 0 0 1 60 44V100Z')
    expect(columnPath(50, 20, 100, 98)).toBe('M40 100V100A2 2 0 0 1 42 98H58A2 2 0 0 1 60 100V100Z')
    expect(columnPath(50, 20, 100, 100)).toBeNull()
  })
})

describe('lineChartGeometry', () => {
  const margin = { top: 20, right: 80, bottom: 28, left: 40 }
  const axis = niceAxis(20, 30)

  it('puts the dates across the plot, one end label per line, and the extreme only on the line it is about', () => {
    const geo = lineChartGeometry({
      width: 343,
      height: 200,
      margin,
      dates: ['2026-11-03', '2026-11-10', '2026-11-17'],
      lines: [
        { key: 'right', points: [{ date: '2026-11-03', value: 20 }, { date: '2026-11-10', value: 30 }, { date: '2026-11-17', value: 25 }] },
        { key: 'left', points: [{ date: '2026-11-03', value: 25 }, { date: '2026-11-10', value: 30 }, { date: '2026-11-17', value: 30 }] },
      ],
      axis,
      extremeFor: 'right',
    })
    expect(geo.plot).toEqual({ left: 40, right: 263, top: 20, bottom: 172 })
    expect(geo.xs).toEqual([48, 151.5, 255])
    expect(geo.lines[0]?.extreme?.value).toBe(30)
    expect(geo.lines[1]?.extreme).toBeNull()
    expect(geo.ends.map((e) => e.keys)).toEqual([['right'], ['left']])
    expect(geo.ends.every((e) => e.x === 265)).toBe(true)
    expect(geo.dateLabels.map((d) => d.text)).toEqual(['Nov 3', 'Nov 17'])
    expect(geo.ticks[0]).toEqual({ value: axis.min, y: 172 })
  })

  it('two sides ending on the same point share one label; a line that ends early gets a leader', () => {
    const shared = lineChartGeometry({
      width: 343,
      height: 200,
      margin,
      dates: ['2026-11-03', '2026-11-10'],
      lines: [
        { key: 'right', points: [{ date: '2026-11-03', value: 20 }, { date: '2026-11-10', value: 25 }] },
        { key: 'left', points: [{ date: '2026-11-03', value: 25 }, { date: '2026-11-10', value: 25 }] },
      ],
      axis,
    })
    expect(shared.ends).toHaveLength(1)
    expect(shared.ends[0]?.keys).toEqual(['right', 'left'])
    expect(shared.ends[0]?.leader).toBe(false)

    const early = lineChartGeometry({
      width: 343,
      height: 200,
      margin,
      dates: ['2026-11-03', '2026-11-10'],
      lines: [
        { key: 'right', points: [{ date: '2026-11-03', value: 20 }, { date: '2026-11-10', value: 22 }] },
        { key: 'left', points: [{ date: '2026-11-03', value: 28 }] },
      ],
      axis,
    })
    expect(early.ends.find((e) => e.keys[0] === 'left')?.leader).toBe(true)
  })

  it('drops the first date label when it would touch the last, and places reference lines on the same scale', () => {
    const geo = lineChartGeometry({
      width: 343,
      height: 200,
      margin,
      dates: ['2026-11-03', '2026-11-04'],
      lines: [{ key: 'x', points: [{ date: '2026-11-03', value: 85 }, { date: '2026-11-04', value: 90 }] }],
      axis: niceAxis(70, 100),
      refs: [
        { value: 80, label: 'Gate 1 · 80%' },
        { value: 90, label: 'Gates 2 and 3 · 90%' },
      ],
    })
    // Two days apart still spans the plot, so both labels fit.
    expect(geo.dateLabels).toHaveLength(2)
    expect(geo.refs.map((r) => [r.value, r.label])).toEqual([
      [80, 'Gate 1 · 80%'],
      [90, 'Gates 2 and 3 · 90%'],
    ])
    expect(geo.refs[0]?.y).toBeGreaterThan(geo.refs[1]?.y ?? 0)

    const one = lineChartGeometry({ width: 343, height: 200, margin, dates: ['2026-11-03'], lines: [{ key: 'x', points: [{ date: '2026-11-03', value: 85 }] }], axis: niceAxis(70, 100) })
    expect(one.dateLabels.map((d) => d.text)).toEqual(['Nov 3'])
    expect(one.xs).toEqual([151.5])

    const narrow = lineChartGeometry({ width: 140, height: 200, margin, dates: ['2026-11-03', '2026-11-04'], lines: [], axis: niceAxis(70, 100) })
    expect(narrow.dateLabels.map((d) => d.text)).toEqual(['Nov 4'])
  })
})

describe('end and extreme labels keep off the gridlines and the other line', () => {
  const margin = { top: 24, right: 80, bottom: 28, left: 40 }

  it('one date: the end labels sit in the right margin, past the gridlines, with leaders to the dots', () => {
    const geo = lineChartGeometry({
      width: 343,
      height: 216,
      margin,
      dates: ['2026-11-03'],
      lines: [
        { key: 'right', points: [{ date: '2026-11-03', value: 55 }] },
        { key: 'left', points: [{ date: '2026-11-03', value: 75 }] },
      ],
      axis: niceAxis(55, 75, 4, 0, 1),
      extremeFor: 'right',
    })
    expect(geo.xs).toEqual([151.5])
    for (const end of geo.ends) {
      expect(end.x).toBeGreaterThanOrEqual(geo.plot.right)
      expect(end.leader).toBe(true)
    }
  })

  it('the extreme’s label goes under its dot when the other line crowds the space above it', () => {
    const dates = ['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24', '2026-12-01']
    const line = (key: string, values: number[]) => ({ key, points: values.map((value, i) => ({ date: dates[i] ?? '', value })) })
    const crowded = lineChartGeometry({
      width: 343,
      height: 216,
      margin,
      dates,
      lines: [line('right', [50, 70, 95, 75, 80]), line('left', [90, 95, 100, 100, 100])],
      axis: niceAxis(50, 100, 4, 0, 1),
      extremeFor: 'right',
    })
    expect(crowded.lines[0]?.extreme?.value).toBe(95)
    expect(crowded.lines[0]?.extremeBelow).toBe(true)
    const clear = lineChartGeometry({
      width: 343,
      height: 216,
      margin,
      dates,
      lines: [line('right', [50, 70, 95, 75, 80]), line('left', [55, 60, 70, 75, 80])],
      axis: niceAxis(50, 100, 4, 0, 1),
      extremeFor: 'right',
    })
    expect(clear.lines[0]?.extremeBelow).toBe(false)
  })
})

describe('reference labels keep clear of the data', () => {
  it('reads where a line crosses x, and nothing where it does not reach', () => {
    const dots = [{ x: 0, y: 100 }, { x: 10, y: 50 }, { x: 20, y: 50 }]
    expect(lineYAt(dots, 5)).toBe(75)
    expect(lineYAt(dots, 15)).toBe(50)
    expect(lineYAt(dots, 30)).toBeNull()
    expect(lineYAt([{ x: 5, y: 9 }], 5)).toBe(9)
    expect(lineYAt([], 5)).toBeNull()
  })

  it('counts how much of a label box a line runs through', () => {
    const flat = [{ x: 0, y: 50 }, { x: 100, y: 50 }]
    expect(crossings([flat], { x0: 10, x1: 30, y0: 40, y1: 48 })).toBeGreaterThan(0)
    expect(crossings([flat], { x0: 10, x1: 30, y0: 10, y1: 20 })).toBe(0)
  })

  it('puts a gate’s label at the end of the plot the line keeps away from', () => {
    const margin = { top: 24, right: 56, bottom: 28, left: 44 }
    const axis = niceAxis(70, 100)
    const refs = [{ value: 80, label: 'Gate 1 · 80%' }]
    // The line starts just over 80% at the left and climbs away to the right: the label goes right.
    const rising = lineChartGeometry({ width: 343, height: 200, margin, dates: ['2026-11-07', '2026-12-12'], lines: [{ key: 's', points: [{ date: '2026-11-07', value: 82 }, { date: '2026-12-12', value: 100 }] }], axis, refs })
    expect(rising.refs[0]).toMatchObject({ anchor: 'end', labelX: 283 })
    // Far from the line on both sides, it stays at the left.
    const high = lineChartGeometry({ width: 343, height: 200, margin, dates: ['2026-11-07', '2026-12-12'], lines: [{ key: 's', points: [{ date: '2026-11-07', value: 98 }, { date: '2026-12-12', value: 100 }] }], axis, refs })
    expect(high.refs[0]).toMatchObject({ anchor: 'start', labelX: 48 })
  })

  describe('two gate lines close together keep their words apart and unstruck', () => {
    const margin = { top: 24, right: 56, bottom: 28, left: 44 }
    const refs = symmetryRefs(program.gates)
    const chart = (percents: number[]) => {
      const dates = percents.map((_, i) => `2026-11-${String(3 + 7 * i).padStart(2, '0')}`)
      const points = percents.map((percent, i) => ({ date: dates[i] ?? '', percent, basis: 'count' as const, injured: percent, other: 100 }))
      return lineChartGeometry({
        width: 343,
        height: 200,
        margin,
        dates,
        lines: [{ key: 's', points: points.map((p) => ({ date: p.date, value: p.percent })) }],
        axis: symmetryAxis(points, refs),
        refs: refs.map((r) => ({ value: r.percent, label: r.label })),
        extremeFor: 's',
      })
    }
    const clearOfEachOther = (geo: ReturnType<typeof chart>) => {
      const [low, high] = geo.refs
      if (!low || !high) throw new Error('expected two gate lines')
      const lowBox = refLabelBox(low)
      const highBox = refLabelBox(high)
      // Neither label sits across the other gate's hairline, and the two boxes don't meet.
      expect(low.y < lowBox.y0 || low.y > lowBox.y1).toBe(true)
      expect(high.y < lowBox.y0 || high.y > lowBox.y1).toBe(true)
      expect(low.y < highBox.y0 || low.y > highBox.y1).toBe(true)
      expect(lowBox.y1 < highBox.y0 || highBox.y1 < lowBox.y0).toBe(true)
    }

    it('a 200% count symmetry puts the lines 10 px apart: the 80% label goes under its line', () => {
      const geo = chart([90, 200])
      const [low, high] = geo.refs
      expect((low?.y ?? 0) - (high?.y ?? 0)).toBeLessThan(12)
      expect(low?.below).toBe(true)
      expect(high?.below).toBe(false)
      clearOfEachOther(geo)
    })

    it('a 300% outlier, 5 px apart, the same', () => {
      clearOfEachOther(chart([300]))
    })

    it('with room between the lines both labels sit above them, as before', () => {
      const geo = chart([85, 95])
      expect(geo.refs.map((r) => r.below)).toEqual([false, false])
      clearOfEachOther(geo)
    })
  })
})

describe('columnChartGeometry', () => {
  const plan: MileageWeek[] = program.mileagePlan
  const weeks: MilesWeek[] = plan.map((w) => ({ week: w.week, planned: w.targetMiles, isDown: w.isDown, actual: w.week === 1 ? 9.5 : w.week === 2 ? 11 : 0 }))
  const geo = columnChartGeometry({ width: 343, height: 208, margin: { top: 24, right: 8, bottom: 44, left: 32 }, weeks, labelAt: [1, 0, 5] })

  it('caps columns at 24 px and well inside the slot; the plan mark sits within the slot', () => {
    expect(geo.colWidth).toBeLessThanOrEqual(24)
    expect(geo.colWidth).toBeLessThan(geo.slot)
    for (const c of geo.columns) {
      expect(c.planX2 - c.planX1).toBeLessThan(geo.slot)
      expect(c.planX2 - c.planX1).toBeGreaterThan(geo.colWidth)
    }
    // Neighbouring weeks' marks stay apart, so two equal weeks read as two marks, not one line.
    for (let i = 1; i < geo.columns.length; i++) {
      const prev = geo.columns[i - 1]
      const next = geo.columns[i]
      if (prev && next) expect(next.planX1 - prev.planX2).toBeGreaterThanOrEqual(4)
    }
    expect(geo.columns[2]?.path).toBeNull()
    expect(geo.columns[0]?.path).toMatch(/^M/)
  })

  it('labels the deload weeks under the axis, inside the chart, and values only where asked and logged', () => {
    expect(geo.downLabels).toHaveLength(3)
    expect(geo.weekLabels.map((w) => w.text)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
    const last = geo.downLabels.at(-1)
    expect((last?.x ?? 0) + textWidth('deload', 12, false) / 2).toBeLessThanOrEqual(343)
    expect(geo.valueLabels.map((v) => v.text)).toEqual(['11', '9.5'])
    expect(geo.ticks.at(-1)?.value).toBe(20)
  })

  it('a value sits on its own column’s cap, and over the plan mark only when the mark crowds the cap', () => {
    const few: MilesWeek[] = [
      { week: 1, planned: 10, actual: 2, isDown: false },
      { week: 2, planned: 11, actual: 10.5, isDown: false },
    ]
    const g = columnChartGeometry({ width: 343, height: 208, margin: { top: 24, right: 8, bottom: 44, left: 32 }, weeks: few, labelAt: [0, 1] })
    const [low, close] = g.valueLabels
    expect(low?.y).toBe((g.columns[0]?.top ?? 0) - 6)
    expect(close?.y).toBe((g.columns[1]?.planY ?? 0) - 6)
  })
})

describe('cleanDaysView', () => {
  const base = { runs: [] as Run[], checks: [] as MorningCheck[], templates }

  it('says there is nothing to count before the first reading', () => {
    expect(cleanDaysView({ ...base, readings: [], today: '2026-11-09', records: [] })).toMatchObject({ count: 0, unit: null, context: 'no readings yet' })
  })

  it('counts from the first reading when none was a hold or back-off', () => {
    const records = attachChecks([workout('w1', '2026-11-03')], [set('w1', 'both', 1, 20, 8, 'leg-press')], [check('2026-11-04')])
    const readings = subjectReadings(records, [], [check('2026-11-04')], 'right')
    expect(cleanDaysView({ ...base, readings, today: '2026-11-09', records, checks: [check('2026-11-04')] })).toEqual({ count: 7, unit: 'days', context: 'since the first reading, with no hold or back-off yet', note: null })
  })

  it('a session waiting on its morning check neither extends nor breaks the count, and the context line says so (PROGRAM-QUESTIONS 109)', () => {
    const view = (today: string, checks: MorningCheck[]) => {
      const records = attachChecks([workout('w1', '2026-11-03'), workout('w2', '2026-11-09', 'finished', 'p1-a')], [set('w1', 'both', 1, 20, 8, 'leg-press'), set('w2', 'both', 1, 20, 8, 'leg-press')], checks)
      return cleanDaysView({ ...base, readings: subjectReadings(records, [], checks, 'right'), today, records, checks })
    }
    const nov4 = [check('2026-11-04')]
    // Monday Nov 9's session has no check yet: Nov 3 to Nov 8 count, and its hold-until-checked doesn't break them.
    expect(view('2026-11-09', nov4)).toEqual({ count: 6, unit: 'days', context: 'since the first reading, with no hold or back-off yet, not counting today’s session until its morning check is in', note: null })
    expect(view('2026-11-10', nov4)).toEqual({ count: 6, unit: 'days', context: 'since the first reading, with no hold or back-off yet, not counting yesterday’s session until its morning check is in', note: null })
    // Once the check is in, the session's reading counts as usual.
    expect(view('2026-11-10', [...nov4, check('2026-11-10')])).toEqual({ count: 8, unit: 'days', context: 'since the first reading, with no hold or back-off yet', note: null })
    expect(view('2026-11-10', [...nov4, check('2026-11-10', { visibleSwelling: true })])).toEqual({ count: 1, unit: 'day', context: 'since the last hold or back-off', note: 'Back off on Monday Nov 9 (Session A).' })
    // Two days on with no check, the window has passed: the session reads hold, as everywhere, and the run starts again.
    expect(view('2026-11-11', nov4)).toEqual({ count: 2, unit: 'days', context: 'since the last hold or back-off', note: 'Hold on Monday Nov 9 (Session A).' })
  })

  it('with only a waiting session, there is nothing to count yet, and the line says what it waits on', () => {
    const runs = [run('r1', '2026-11-05', 3)]
    const readings = subjectReadings([], runs, [], 'right')
    expect(cleanDaysView({ ...base, readings, today: '2026-11-05', records: [], runs })).toMatchObject({ count: 0, unit: null, context: 'no readings yet, not counting today’s run until its morning check is in' })
  })

  it('names what is waiting, by day and kind', () => {
    const r = (date: string, kind: 'workout' | 'run' = 'workout') => ({ kind, id: `${kind}-${date}`, date, result: 'hold' as const })
    const today = '2026-11-10'
    expect(waitingWords([], today)).toBeNull()
    expect(waitingWords([r('2026-11-09')], today)).toBe('not counting yesterday’s session until its morning check is in')
    expect(waitingWords([r('2026-11-09'), r('2026-11-09', 'run')], today)).toBe('not counting yesterday’s session and run until their morning check is in')
    expect(waitingWords([r('2026-11-10'), r('2026-11-10')], today)).toBe('not counting today’s sessions until their morning check is in')
    expect(waitingWords([r('2026-11-10', 'run'), r('2026-11-09')], today)).toBe('not counting yesterday’s session and today’s run until their morning checks are in')
  })

  it('a run that read back off is named by its type, and one day reads "day"', () => {
    const runs = [run('r1', '2026-11-04', 3, 7)]
    const checks = [check('2026-11-05')]
    const readings = subjectReadings([], runs, checks, 'right')
    expect(cleanDaysView({ ...base, readings, today: '2026-11-05', records: [], runs, checks })).toEqual({ count: 1, unit: 'day', context: 'since the last hold or back-off', note: 'Back off on Wednesday Nov 4 (Run: easy).' })
  })
})

describe('the exercise list', () => {
  const records = attachChecks(
    [workout('w1', '2026-11-03'), workout('w2', '2026-11-10'), workout('w3', '2026-11-12', 'in-progress')],
    [set('w1', 'right', 1, 20, 8), set('w1', 'left', 1, 25, 8), set('w2', 'both', 1, 90, 10, 'leg-press'), set('w2', 'right', 1, 25, 8), set('w3', 'both', 1, 40, 8, 'assisted-pull-up')],
    [],
  )

  it('lists exercises from sessions that happened, most recent first, with what they are', () => {
    const rows = loggedExercises(records, CATALOG)
    expect(rows.map((r) => r.id)).toEqual(['bulgarian-split-squat', 'leg-press'])
    expect(rows[0]).toEqual({ id: 'bulgarian-split-squat', name: 'Bulgarian split squat', detail: 'Single-leg · per side · last Nov 10 · 2 sessions', lastDate: '2026-11-10', twoSided: true })
    expect(rows[1]?.detail).toBe('Squat · last Nov 10 · 1 session')
    expect(rows[1]?.twoSided).toBe(false)
  })

  it('among one session’s exercises, the knee’s work leads: lower body, then per side, then by name', () => {
    const one = attachChecks(
      [workout('w1', '2026-11-03')],
      [set('w1', 'both', 1, 8, 8, 'dead-bug'), set('w1', 'both', 1, 90, 10, 'leg-press'), set('w1', 'right', 1, 20, 8), set('w1', 'both', 1, 40, 8, 'assisted-pull-up')],
      [],
    )
    expect(loggedExercises(one, [...CATALOG, catalog({ id: 'dead-bug', name: 'Dead bug', pattern: 'core', unilateral: false })]).map((r) => r.id)).toEqual(['bulgarian-split-squat', 'leg-press', 'assisted-pull-up', 'dead-bug'])
  })

  it('an exercise missing from the catalog is listed by its id', () => {
    const odd = attachChecks([workout('w1', '2026-11-03')], [set('w1', 'both', 1, 10, 8, 'old-thing')], [])
    expect(loggedExercises(odd, CATALOG)[0]).toMatchObject({ name: 'old-thing', detail: 'last Nov 3 · 1 session' })
  })

  it('keeps the pick while it is listed, else shows the most recent; shows the first few until asked for all', () => {
    const rows = loggedExercises(records, CATALOG)
    expect(pickedRow(rows, 'leg-press')?.id).toBe('leg-press')
    expect(pickedRow(rows, 'gone')?.id).toBe('bulgarian-split-squat')
    expect(pickedRow([], null)).toBeNull()
    expect(visibleRows(rows, false, 1).map((r) => r.id)).toEqual(['bulgarian-split-squat'])
    expect(visibleRows(rows, true, 1)).toHaveLength(2)
  })
})

describe('loadChart', () => {
  it('draws the injured side first and the other side second, in pounds', () => {
    const records = attachChecks([workout('w1', '2026-11-03'), workout('w2', '2026-11-10')], [set('w1', 'right', 1, 20, 8), set('w1', 'left', 1, 25, 8), set('w2', 'right', 1, 25, 7)], [])
    const view = exerciseView({ records, setLogs: records.flatMap((r) => r.sets), row: loggedExercises(records, CATALOG)[0]!, injuredSide: 'right', catalog: CATALOG })
    const chart = view.chart
    expect(chart.measure).toBe('load')
    expect(chart.lines.map((l) => [l.key, l.role, l.name])).toEqual([
      ['right', 'injured', 'Right · injured'],
      ['left', 'other', 'Left'],
    ])
    expect(chart.dates).toEqual(['2026-11-03', '2026-11-10'])
    const readout = loadReadout(chart, 1, false)
    expect(readout && readoutText(readout)).toBe('25 lb × 7 right, injured · not logged (left) · Tuesday Nov 10')
    expect(readout?.parts.map((p) => p.mark)).toEqual(['dot', 'ring'])
    const latest = loadReadout(chart, 0, true)
    expect(latest && readoutText(latest)).toBe('20 lb × 8 right, injured · 25 lb × 8 left · Tuesday Nov 3, the latest')
    expect(loadReadout(chart, 5, false)).toBeNull()
    expect(loadSubtitle(chart, view.exercise, 'Bulgarian split squat')).toBe('The heaviest set of each session, in pounds, one line per side.')
    expect(loadAria(chart, 'Bulgarian split squat')).toBe(
      'Line chart of the heaviest load in pounds per session for Bulgarian split squat, the right side, injured, as filled dots and the left side as rings, 2 sessions from Nov 3 to Nov 10.',
    )
    expect(loadTable(chart, 'Bulgarian split squat')).toEqual({
      caption: 'Bulgarian split squat: heaviest set per session',
      head: ['Date', 'Right · injured', 'Left'],
      rows: [
        ['Tuesday Nov 10', '25 lb × 7', 'not logged'],
        ['Tuesday Nov 3', '20 lb × 8', '25 lb × 8'],
      ],
    })
    // The injured side is the left one on another install.
    expect(loadChart([{ date: '2026-11-03', side: 'right', load: 20, count: 8 }, { date: '2026-11-03', side: 'left', load: 15, count: 8 }], 'left', 'reps').lines.map((l) => l.role)).toEqual(['injured', 'other'])
  })

  it('charts the best set’s seconds when no load is logged, and says so', () => {
    const records = attachChecks([workout('w1', '2026-11-03')], [timed('w1', 'right', 1, 20), timed('w1', 'right', 2, 30)], [])
    const sets = records.flatMap((r) => r.sets)
    expect(countUnitFor(sets, 'single-leg-balance')).toBe('seconds')
    expect(countUnitFor(sets, 'leg-press')).toBe('reps')
    const row = loggedExercises(records, CATALOG)[0]!
    const view = exerciseView({ records, setLogs: sets, row, injuredSide: 'right', catalog: CATALOG })
    expect(view.chart.measure).toBe('count')
    expect(view.chart.lines[0]?.points).toEqual([{ date: '2026-11-03', value: 30, load: 0, count: 30 }])
    const readout = loadReadout(view.chart, 0, true)
    expect(readout && readoutText(readout)).toBe('30 s right, injured · Tuesday Nov 3, the latest')
    expect(loadSubtitle(view.chart, view.exercise, row.name)).toBe('No load is logged for Single-leg balance, so this is the best set’s seconds per session.')
  })

  it('a two-leg exercise is one line with no side names; assisted work says lower is stronger', () => {
    const chart = loadChart([{ date: '2026-11-03', side: 'both', load: 40, count: 8 }, { date: '2026-11-10', side: 'both', load: 35, count: 8 }], 'right', 'reps')
    expect(chart.lines.map((l) => l.role)).toEqual(['both'])
    const readout = loadReadout(chart, 1, false)
    expect(readout && readoutText(readout)).toBe('35 lb × 8 · Tuesday Nov 10')
    expect(loadSubtitle(chart, CATALOG[3] ?? null, 'Assisted pull-up')).toBe('The heaviest set of each session, in pounds. The load is the assist, so lower is stronger.')
    expect(loadTable(chart, 'Assisted pull-up').head).toEqual(['Date', 'Heaviest set'])
  })

  it('two-leg sets of a per-side exercise stay in the table, not on the chart', () => {
    const chart = loadChart(
      [
        { date: '2026-11-03', side: 'both', load: 40, count: 8 },
        { date: '2026-11-10', side: 'right', load: 20, count: 8 },
        { date: '2026-11-10', side: 'left', load: 20, count: 8 },
      ],
      'right',
      'reps',
    )
    expect(chart.lines.map((l) => l.key)).toEqual(['right', 'left'])
    expect(chart.extra.map((l) => l.key)).toEqual(['both'])
    expect(chart.dates).toEqual(['2026-11-10'])
    expect(loadTable(chart, 'X').head).toEqual(['Date', 'Right · injured', 'Left', 'Both legs'])
    expect(loadSubtitle(chart, null, 'X')).toContain('Two-leg sets of it are in the numbers, not drawn.')
  })
})

describe('symmetry', () => {
  it('reads the gates’ lines from the program: Gate 1 at 80%, gates 2 and 3 at 90%', () => {
    expect(symmetryRefs(program.gates)).toEqual([
      { percent: 80, label: 'Gate 1 · 80%' },
      { percent: 90, label: 'Gates 2 and 3 · 90%' },
    ])
  })

  it('says what was compared, loads or counts, in the readout and the table (56 against 62 is 90.3%)', () => {
    const records = attachChecks([workout('w1', '2026-11-03'), workout('w2', '2026-11-10')], [set('w1', 'right', 1, 56, 8), set('w1', 'left', 1, 62, 8), set('w2', 'right', 1, 25, 7), set('w2', 'left', 1, 25, 8)], [])
    const row = loggedExercises(records, CATALOG)[0]!
    const view = exerciseView({ records, setLogs: records.flatMap((r) => r.sets), row, injuredSide: 'right', catalog: CATALOG })
    expect(view.symmetry.map((p) => [p.percent, p.basis])).toEqual([
      [90.3, 'load'],
      [87.5, 'count'],
    ])
    const first = symmetryReadout(view.symmetry, 0, 'right', 'reps', false)
    expect(first && readoutText(first)).toBe('90.3% right ÷ left · 56 lb against 62 lb, loads compared · Tuesday Nov 3')
    const latest = symmetryReadout(view.symmetry, 1, 'right', 'reps', true)
    expect(latest && readoutText(latest)).toBe('87.5% right ÷ left · 7 against 8 reps, counts compared · Tuesday Nov 10, the latest')
    expect(symmetryTable(view.symmetry, 'Bulgarian split squat', 'right', 'reps')).toEqual({
      caption: 'Bulgarian split squat: right ÷ left per session',
      head: ['Date', 'Right ÷ left', 'Compared'],
      rows: [
        ['Tuesday Nov 10', '87.5%', '7 against 8 reps, counts compared'],
        ['Tuesday Nov 3', '90.3%', '56 lb against 62 lb, loads compared'],
      ],
    })
    expect(comparedWords({ basis: 'count', injured: 25, other: 30 }, 'seconds')).toBe('25 against 30 seconds, counts compared')
    expect(symmetryAria(view.symmetry, 'Bulgarian split squat', 'right', symmetryRefs(program.gates))).toBe(
      'Line chart of the right side as a percent of the left side for Bulgarian split squat, 2 sessions, against reference lines at 80% and 90%; latest 87.5% on Nov 10.',
    )
  })

  it('the axis always shows both gates’ lines and 100%', () => {
    const refs = symmetryRefs(program.gates)
    expect(symmetryAxis([{ date: '2026-11-03', percent: 95, basis: 'load', injured: 19, other: 20 }], refs)).toEqual({ min: 70, max: 100, ticks: [70, 80, 90, 100] })
    expect(symmetryAxis([{ date: '2026-11-03', percent: 56, basis: 'load', injured: 14, other: 25 }], refs).min).toBeLessThanOrEqual(56)
    expect(symmetryAxis([{ date: '2026-11-03', percent: 112, basis: 'count', injured: 9, other: 8 }], refs).max).toBeGreaterThanOrEqual(112)
  })

  it('lists the sessions the line leaves out, newest first, with why (PROGRAM-QUESTIONS 111, 112, 116)', () => {
    const step = (workoutId: string, side: SetLog['side'], heightIn: number): SetLog => ({ ...set(workoutId, side, 1, 0, 10, 'lateral-step-down'), heightIn })
    const records = attachChecks(
      [workout('w1', '2026-11-03'), workout('w2', '2026-11-10'), workout('w3', '2026-11-17')],
      [step('w1', 'right', 4), step('w1', 'left', 4), step('w2', 'right', 4), step('w2', 'left', 8), { ...set('w3', 'right', 1, 10, 10, 'lateral-step-down'), heightIn: 4, rackCapped: true }, { ...set('w3', 'left', 1, 10, 10, 'lateral-step-down'), heightIn: 4, rackCapped: true }],
      [],
    )
    const stepDown = catalog({ id: 'lateral-step-down', name: 'Lateral step-down' })
    const row = loggedExercises(records, [stepDown])[0]!
    const view = exerciseView({ records, setLogs: records.flatMap((r) => r.sets), row, injuredSide: 'right', catalog: [stepDown] })
    expect(view.symmetry.map((p) => p.date)).toEqual(['2026-11-03'])
    expect(view.leftOut).toEqual([
      'Tuesday Nov 17 · left out: the gym’s rack capped the loads (10 lb on the injured side, 10 lb on the other), so they say nothing of the knee',
      'Tuesday Nov 10 · left out: the sides stepped from different heights (4 in. on the injured side, 8 in. on the other)',
    ])
    expect(leftOutLines([])).toEqual([])
  })

  it('when every session is left out, the empty state says so rather than asking for both sides', () => {
    const step = (workoutId: string, side: SetLog['side'], heightIn: number): SetLog => ({ ...set(workoutId, side, 1, 0, 10, 'lateral-step-down'), heightIn })
    const records = attachChecks([workout('w1', '2026-11-10')], [step('w1', 'right', 4), step('w1', 'left', 8)], [])
    const stepDown = catalog({ id: 'lateral-step-down', name: 'Lateral step-down' })
    const row = loggedExercises(records, [stepDown])[0]!
    const view = exerciseView({ records, setLogs: records.flatMap((r) => r.sets), row, injuredSide: 'right', catalog: [stepDown] })
    expect(view.symmetry).toEqual([])
    expect(view.leftOut).toHaveLength(1)
    expect(symmetryEmptyWords(row, view.chart, 'right', view.leftOut.length)).toBe(
      'Every session of Lateral step-down that logged both sides is left out of the line so far, so there is nothing to draw yet. Each one and why:',
    )
  })

  it('says why there is no line: nothing logged, a two-leg exercise, or one side only', () => {
    expect(symmetryEmptyWords(null, null, 'right')).toBe('Log a session with single-leg work to see this: the injured side as a percent of the other, per session.')
    const press = loadChart([{ date: '2026-11-03', side: 'both', load: 90, count: 10 }], 'right', 'reps')
    expect(symmetryEmptyWords({ id: 'leg-press', name: 'Leg press, both legs', detail: '', lastDate: '2026-11-03', twoSided: false }, press, 'right')).toBe(
      'Leg press, both legs is logged as one set, not one per side, so it has no side-to-side number. Pick a per-side exercise above to see its symmetry.',
    )
    const oneSide = loadChart([{ date: '2026-11-03', side: 'right', load: 0, count: 30 }], 'right', 'seconds')
    expect(symmetryEmptyWords({ id: 'single-leg-balance', name: 'Single-leg balance', detail: '', lastDate: '2026-11-03', twoSided: true }, oneSide, 'right')).toBe(
      'Symmetry shows once both sides of Single-leg balance are logged in the same session. So far only the right side is logged. The right side is logged first, then the other.',
    )
  })
})

describe('milesView', () => {
  const runs = [run('r1', '2026-11-02', 3), run('r2', '2026-11-04', 3.5), run('r3', '2026-11-06', 4), run('r4', '2026-11-11', 4), run('r5', '2026-11-12', 0, 1, 'rower-swap'), run('r6', '2026-11-25', 12)]

  it('opens on this week and labels the latest week with miles and the extreme', () => {
    const view = milesView(program.mileagePlan, runs, START, '2026-11-26')
    expect(view.weeks.map((w) => w.actual).slice(0, 5)).toEqual([10.5, 4, 0, 12, 0])
    expect(view.current).toBe(3)
    expect(view.opening).toBe(3)
    expect(view.labelAt).toEqual([3])
    const readout = milesReadout(view, 3)
    expect(readout && readoutText(readout)).toBe('12 mi actual · 12 mi plan · Week 4, deload, this week')
    expect(readout?.parts.map((p) => p.mark)).toEqual(['column', 'plan'])
    expect(milesAria(view)).toBe('Column chart of miles run each week against the plan, weeks 1 to 12; this week, week 4, 12 of 12 miles.')
    expect(milesTable(view).rows[3]).toEqual(['4', '12 mi', '12 mi', 'deload, this week'])
    expect(milesTable(view).rows[0]).toEqual(['1', '10.5 mi', '10 mi', ''])
    // Every column has a header, the notes column included.
    expect(milesTable(view).head).toEqual(['Week', 'Actual', 'Plan', 'Note'])
  })

  it('labels a higher earlier week too; before the start it opens on week 1, after the plan on week 12', () => {
    const view = milesView(program.mileagePlan, runs.slice(0, 5), START, '2026-11-12')
    expect(view.labelAt).toEqual([1, 0])
    expect(milesView(program.mileagePlan, [], START, '2026-10-30')).toMatchObject({ current: null, opening: 0, anyRuns: false, labelAt: [] })
    expect(milesView(program.mileagePlan, [], START, '2027-03-01')).toMatchObject({ current: null, opening: 11 })
    expect(milesAria(milesView(program.mileagePlan, [], START, '2026-10-30'))).toBe('Column chart of miles run each week against the plan, weeks 1 to 12.')
  })
})

describe('progressView', () => {
  it('composes the stat, the list, the gates’ lines and the miles from stored history', () => {
    const history: HistoryLike = {
      workouts: [workout('w1', '2026-11-03', 'finished', 'p1-a')],
      setLogs: [set('w1', 'right', 1, 20, 8), set('w1', 'left', 1, 20, 8)],
      morningChecks: [check('2026-11-03'), check('2026-11-04')],
      runs: [run('r1', '2026-11-02', 3)],
      sessionMoves: [],
    }
    const view = progressView({ today: '2026-11-05', settings, history, program: { ...program, exercises: CATALOG } })
    expect(view.clean).toMatchObject({ count: 4, unit: 'days', context: 'since the first reading, with no hold or back-off yet' })
    expect(view.exercises.map((r) => r.id)).toEqual(['bulgarian-split-squat'])
    expect(view.refs).toHaveLength(2)
    expect(view.miles.current).toBe(0)
    expect(view.miles.weeks[0]?.actual).toBe(3)
    expect(view.training.weeks[0]).toMatchObject({ week: 1, load: 30 * 3, sessions: 1, notCounted: 1 })
    // The seed's week: runs Mon, Wed, Fri; lifts Tue, Thu, Sat. Monday's run and Tuesday's lift are done.
    expect(view.adherence.lines).toEqual(['Week 1 (so far) · Lifts 1 of 3 · Runs 1 of 3'])
  })
})

describe('sessions done of those scheduled, per program week (Batch B)', () => {
  const TEMPLATE = { mon: 'run:mbr', tue: 'lift:A', wed: 'run:easy', thu: 'lift:B', fri: 'run:long', sat: 'lift:C', sun: 'off' } as const
  const base = { startDate: START, template: TEMPLATE, moves: [] }

  it('one line per week from this one back to week 1, the current week marked so far', () => {
    const runs = [run('r1', '2026-11-02', 3), run('r2', '2026-11-04', 3), run('r3', '2026-11-06', 4), run('r4', '2026-11-09', 3)]
    const workouts = [workout('w1', '2026-11-03'), workout('w2', '2026-11-05'), workout('w3', '2026-11-10', 'abandoned')]
    expect(adherenceView({ ...base, today: '2026-11-11', runs, workouts })).toEqual({
      note: 'Sessions done, of those scheduled. A record, not a score: a skipped day on a bad knee is the program working.',
      lines: ['Week 2 (so far) · Lifts 1 of 3 · Runs 1 of 3', 'Week 1 · Lifts 2 of 3 · Runs 3 of 3'],
    })
  })

  it('a swap counts as its run, and a moved session on its moved day', () => {
    const moves = [{ id: 'm', week: 1, dayA: 'thu' as const, dayB: 'fri' as const }]
    const runs = [{ ...run('r1', '2026-11-02', 0, 1, 'rower-swap'), minutes: 35 }, run('r2', '2026-11-05', 4, 1, 'long')]
    expect(adherenceView({ ...base, moves, today: '2026-11-08', runs, workouts: [workout('w1', '2026-11-06')] }).lines).toEqual(['Week 1 (so far) · Lifts 1 of 3 · Runs 2 of 3'])
  })

  it('leaves out a half with nothing scheduled, and says nothing before the program or with nothing scheduled', () => {
    expect(adherenceLine(3, { liftsDone: 2, liftsScheduled: 3, runsDone: 0, runsScheduled: 0 }, false)).toBe('Week 3 · Lifts 2 of 3')
    expect(adherenceView({ ...base, today: '2026-10-30', runs: [], workouts: [] })).toEqual({ note: null, lines: [] })
    const allOff = { mon: 'off', tue: 'off', wed: 'off', thu: 'off', fri: 'off', sat: 'off', sun: 'off' } as const
    expect(adherenceView({ ...base, template: allOff, today: '2026-11-11', runs: [], workouts: [] })).toEqual({ note: null, lines: [] })
  })

  it('past week 12 it runs on to this week, as the Week screen does', () => {
    expect(adherenceView({ ...base, today: '2027-02-10', runs: [], workouts: [] }).lines).toHaveLength(15)
    expect(adherenceView({ ...base, today: '2027-02-10', runs: [], workouts: [] }).lines[0]).toBe('Week 15 (so far) · Lifts 0 of 3 · Runs 0 of 3')
  })

  it('never words a streak', () => {
    const view = adherenceView({ ...base, today: '2026-11-11', runs: [], workouts: [] })
    for (const text of [view.note ?? '', ...view.lines]) expect(text).not.toMatch(/streak|chain|in a row|don.t break/i)
  })
})

describe('the Progress screen’s text wears text tokens, never a data color', () => {
  // The screen's sources, read at test time through Vite as src/rules/guard.test.ts reads the rules.
  const sources = import.meta.glob<string>(['./Progress.tsx', './progress/*.tsx'], { query: '?raw', import: 'default', eager: true })

  it('no green text: green-bright marks the injured side in the charts, so it stays on lines and markers', () => {
    expect(Object.keys(sources)).toContain('./Progress.tsx')
    for (const [path, source] of Object.entries(sources)) {
      expect(source, `${path} gives text a green class`).not.toMatch(/\btext-green/)
      for (const line of source.split('\n').filter((l) => l.includes('fill-green'))) expect(line, `${path}: green fill off a marker`).toContain('<circle')
    }
  })
})

// ---------------------------------------------------------------------------------------------
// 5. Weekly training load (metrics phase 1)
// ---------------------------------------------------------------------------------------------

const comparison = (over: Partial<AcuteChronic> = {}): AcuteChronic => ({
  band: 'steady',
  acuteFrom: '2026-12-08',
  acuteTo: '2026-12-14',
  chronicFrom: '2026-11-10',
  chronicTo: '2026-12-07',
  acute: 1430,
  chronicWeek: 1300,
  ratio: 1.1,
  startsOn: null,
  notCountedAcute: [],
  notCountedChronic: [],
  skews: [],
  ...over,
})

describe('training load in words', () => {
  it('prints numbers with a thousands separator, rounded', () => {
    expect(trainingLoadNumber(2140.4)).toBe('2,140')
    expect(trainingLoadNumber(336)).toBe('336')
  })

  it('prints the ratio to one decimal, and says just over or just under where that would read as the line itself', () => {
    expect(ratioWords(1.6, 'high')).toBe('1.6×')
    expect(ratioWords(1.53, 'high')).toBe('just over 1.5×')
    expect(ratioWords(1.5, 'steady')).toBe('1.5×')
    expect(ratioWords(1.47, 'steady')).toBe('just under 1.5×')
    expect(ratioWords(0.78, 'low')).toBe('just under 0.8×')
    expect(ratioWords(0.82, 'steady')).toBe('just over 0.8×')
    expect(ratioWords(0.6, 'low')).toBe('0.6×')
    expect(ratioWords(1, 'steady')).toBe('1×')
  })

  it('high is an up arrow and a word, says both numbers are smoothed week-rates through yesterday, and that nothing changes', () => {
    expect(trainingLoadWarning(comparison({ band: 'high', acute: 2140, chronicWeek: 1330, ratio: 2140 / 1330 }))).toEqual({
      mark: '↑ High',
      text: 'Your recent week-rate of training load is 1.6× your longer rate (2,140 against 1,330, both smoothed through yesterday). A warning only: no session or run changes because of it.',
    })
  })

  it('low is a down arrow, a drop, and a note only', () => {
    expect(trainingLoadWarning(comparison({ band: 'low', acute: 780, chronicWeek: 1300, ratio: 0.6 }))).toEqual({
      mark: '↓ Low',
      text: 'Your recent week-rate of training load is 0.6× your longer rate (780 against 1,300, both smoothed through yesterday): a drop. A note only: nothing changes because of it.',
    })
  })

  it('steady is a dash and a word', () => {
    expect(trainingLoadWarning(comparison())).toEqual({ mark: '– Steady', text: 'Your recent week-rate of training load is 1.1× your longer rate (1,430 against 1,300, both smoothed through yesterday).' })
  })

  it('just over the line prints as just over, never as the line itself (ratioWords inside the sentence)', () => {
    expect(trainingLoadWarning(comparison({ band: 'high', acute: 1298.5, chronicWeek: 865.1, ratio: 1.501 })).text).toContain('is just over 1.5× your longer rate')
    expect(trainingLoadWarning(comparison({ band: 'low', acute: 505.7, chronicWeek: 635.2, ratio: 0.7962 })).text).toContain('is just under 0.8× your longer rate')
  })

  it('too early says when the comparison starts; with nothing logged it says so', () => {
    expect(trainingLoadWarning(comparison({ band: 'too-early', ratio: null, chronicWeek: null, startsOn: '2026-12-07' }))).toEqual({
      mark: null,
      text: 'No comparison yet: the smoothed rates need 35 days of history. It starts Monday Dec 7.',
    })
    expect(trainingLoadWarning(comparison({ band: 'too-early', ratio: null, chronicWeek: null, startsOn: null }))).toEqual({
      mark: null,
      text: 'Nothing logged yet. The comparison starts 35 days after the first session or run.',
    })
  })

  it('none says there is nothing to compare against', () => {
    expect(trainingLoadWarning(comparison({ band: 'none', ratio: null, chronicWeek: 0 })).text).toBe('No training load is counted in the 4 weeks before the last 7 days, so there is nothing to compare against yet.')
  })

  it('says which way uncounted sessions and deload weeks push the ratio', () => {
    const missing = (id: string, date: string): TrainingLoadEntry => ({ kind: 'run', id, date, runType: 'easy', rpe: 3, rpeSource: 'rated', minutes: null, load: null, hrLoad: null, hasHr: false, missing: ['minutes'] })
    const skewed = comparison({
      notCountedAcute: [missing('a', '2026-12-09')],
      notCountedChronic: [missing('b', '2026-11-12'), missing('c', '2026-11-13')],
      skews: [
        { why: 'not-counted', window: 'acute', reads: 'lower' },
        { why: 'deload', window: 'acute', reads: 'lower' },
        { why: 'not-counted', window: 'chronic', reads: 'higher' },
        { why: 'deload', window: 'chronic', reads: 'higher' },
      ],
    })
    expect(skewLines(skewed)).toEqual([
      '1 session in the last 7 days isn’t counted, so the ratio reads lower than it is.',
      'The last 7 days include deload days, planned lighter, so the ratio reads lower.',
      '2 sessions in the 4 weeks before aren’t counted, so the ratio reads higher than it is.',
      'The 4 weeks before include a deload week, planned lighter, so the ratio reads higher.',
    ])
  })

  it('says the ratio can read either way when the days behind one line pull both ways (PROGRAM-QUESTIONS 162d)', () => {
    const missing = (id: string, date: string): TrainingLoadEntry => ({ kind: 'run', id, date, runType: 'easy', rpe: 3, rpeSource: 'rated', minutes: null, load: null, hrLoad: null, hasHr: false, missing: ['minutes'] })
    const mixed = comparison({
      notCountedAcute: [missing('a', '2026-12-08'), missing('b', '2026-12-14')],
      skews: [
        { why: 'not-counted', window: 'acute', reads: 'either' },
        { why: 'deload', window: 'acute', reads: 'either' },
        { why: 'deload', window: 'chronic', reads: 'lower' },
      ],
    })
    expect(skewLines(mixed)).toEqual([
      '2 sessions in the last 7 days aren’t counted, so the ratio can read higher or lower than it is.',
      'The last 7 days include deload days, planned lighter, so the ratio can read higher or lower.',
      'The 4 weeks before include a deload week, planned lighter, so the ratio reads lower.',
    ])
  })

  it('lists what isn’t counted, newest first, with why and what can fix it', () => {
    const entries: TrainingLoadEntry[] = [
      { kind: 'workout', id: 'w1', date: '2026-11-03', templateId: 'p2-b', rpe: null, rpeSource: null, minutes: 40, load: null, hrLoad: null, hasHr: false, missing: ['rpe'] },
      { kind: 'workout', id: 'w2', date: '2026-11-05', templateId: 'p1-a', rpe: 7, rpeSource: 'session', minutes: null, load: null, hrLoad: null, hasHr: false, missing: ['minutes'] },
      { kind: 'run', id: 'r1', date: '2026-11-06', runType: 'mbr', rpe: 3, rpeSource: 'rated', minutes: null, load: null, hrLoad: null, hasHr: false, missing: ['minutes'] },
      { kind: 'run', id: 'r2', date: '2026-11-07', runType: 'easy', rpe: 3, rpeSource: 'rated', minutes: 30, load: 90, hrLoad: null, hasHr: false, missing: [] },
    ]
    expect(notCountedLines(entries, templates)).toEqual([
      'Friday Nov 6 · Run: MBR · no time logged',
      'Thursday Nov 5 · Session A · no minutes: add them from the session’s summary',
      'Tuesday Nov 3 · Session B · no RPE (no set rated): add it from the session’s summary',
    ])
  })
})

describe('trainingLoadView', () => {
  const twelve = (n: number) => Array.from({ length: n }, (_, i) => i + 1)
  it('every program week 1 to 12, and on past 12 while the program runs on', () => {
    const empty = trainingLoadView({ records: [], runs: [], startDate: START, today: '2026-11-05', templates })
    expect(empty.weeks.map((w) => w.week)).toEqual(twelve(12))
    expect(empty.current).toBe(0)
    expect(empty.any).toBe(false)
    expect(empty.warning.text).toBe('Nothing logged yet. The comparison starts 35 days after the first session or run.')
    expect(trainingLoadView({ records: [], runs: [], startDate: START, today: '2027-02-10', templates }).weeks.map((w) => w.week)).toEqual(twelve(15))
  })

  it('sums each week, says where older runs’ words stand in, and gives the readout, the name and the table', () => {
    const runs = [run('r1', '2026-11-02', 3), { ...run('r2', '2026-11-04', 3), rpe: 6 }, { ...run('r3', '2026-11-10', 3), minutes: 0 }]
    const records = attachChecks([{ ...workout('w1', '2026-11-05', 'finished', 'p1-a'), sessionRpe: 7, durationMinutes: 50 }], [], [])
    const view = trainingLoadView({ records, runs, startDate: START, today: '2026-11-11', templates })
    expect(view.weeks.slice(0, 2)).toEqual([
      { week: 1, load: 90 + 180 + 350, sessions: 3, notCounted: 0, isDeload: false, hrLoad: 0, withHr: 0, hrNotCounted: 0, runs: 2 },
      { week: 2, load: 0, sessions: 0, notCounted: 1, isDeload: false, hrLoad: 0, withHr: 0, hrNotCounted: 0, runs: 1 },
    ])
    expect(view.current).toBe(1)
    expect(view.any).toBe(true)
    expect(view.olderRuns).toBe('Runs logged before effort was rated 1 to 10 read their effort word as RPE 3, 5 or 8.')
    expect(view.notCounted).toEqual(['Tuesday Nov 10 · Run: easy · no time logged'])
    expect(view.warning.text).toBe('No comparison yet: the smoothed rates need 35 days of history. It starts Monday Dec 7.')
    expect(trainingLoadReadout(view, 0)).toEqual({ parts: [{ value: '620', name: 'training load', mark: 'column' }], when: 'Week 1, 3 counted' })
    expect(trainingLoadReadout(view, 1)).toEqual({ parts: [{ value: '0', name: 'training load', mark: 'column' }], when: 'Week 2, 1 not counted, this week' })
    expect(trainingLoadReadout(view, 3)?.when).toBe('Week 4, deload')
    expect(trainingLoadAria(view)).toBe('Column chart of training load, RPE times minutes, each week, weeks 1 to 12; this week, week 2, 0.')
    const table = trainingLoadTable(view)
    expect(table.head).toEqual(['Week', 'Training load', 'Counted', 'Not counted', 'Note'])
    expect(table.rows[0]).toEqual(['1', '620', '3', '0', ''])
    expect(table.rows[1]).toEqual(['2', '0', '0', '1', 'this week'])
    expect(table.rows[3]).toEqual(['4', '0', '0', '0', 'deload'])
  })

  it('without the heart-rate settings the HR line is null: nothing is said, never 0 (metrics phase 2)', () => {
    const runs = [{ ...run('r1', '2026-11-02', 3), rpe: 4, avgHr: 150, maxHr: 171 }]
    expect(trainingLoadView({ records: [], runs, startDate: START, today: '2026-11-05', templates }).hrLine).toBeNull()
    expect(trainingLoadView({ records: [], runs, startDate: START, today: '2026-11-05', templates, hrSettings: null }).hrLine).toBeNull()
    // Half a row (one stepper touched) computes nothing either.
    expect(trainingLoadView({ records: [], runs, startDate: START, today: '2026-11-05', templates, hrSettings: { id: 'heart-rate', maxHr: 190 } }).hrLine).toBeNull()
  })

  it('says this week’s HR load in words, counting the week’s runs and swaps as the denominator (lifts never have heart rate)', () => {
    const hrSettings = { id: 'heart-rate' as const, maxHr: 190, restingHr: 50 }
    const runs = [
      { ...run('r1', '2026-11-02', 3), minutes: 40, rpe: 4, avgHr: 150, maxHr: 171 },
      { ...run('r2', '2026-11-04', 0, 1, 'rower-swap' as const), minutes: 35, rpe: 4 },
    ]
    const records = attachChecks([{ ...workout('w1', '2026-11-03'), sessionRpe: 7, durationMinutes: 50 }], [], [])
    const view = trainingLoadView({ records, runs, startDate: START, today: '2026-11-05', templates, hrSettings })
    // 40 min at an average of 150 over 50–190 is TRIMP ≈ 72; the swap has no heart rate, the lift can't.
    expect(view.hrLine).toBe('HR load this week: 72 (1 of 2 runs had heart rate)')
    expect(view.weeks[0]).toMatchObject({ withHr: 1, runs: 2 })
    // The warning still reads the sRPE load alone: the words name RPE × minutes sums, not TRIMP.
    expect(view.warning.text).toBe('No comparison yet: the smoothed rates need 35 days of history. It starts Monday Dec 7.')
  })

  it('a week where HR and sRPE disagree still drives the warning from the sRPE load alone', () => {
    const hrSettings = { id: 'heart-rate' as const, maxHr: 190, restingHr: 50 }
    // Five easy weeks of history, then a quiet 7 days by RPE whose one run carries a sky-high heart rate.
    const chronicRuns = ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'].map((date, i) => ({ ...run(`c${i}`, date, 3), minutes: 100, rpe: 5 }))
    const acuteRun = { ...run('a', '2026-12-14', 3), minutes: 10, rpe: 1, avgHr: 189, maxHr: 190 }
    const withHr = trainingLoadView({ records: [], runs: [...chronicRuns, acuteRun], startDate: START, today: '2026-12-15', templates, hrSettings })
    const without = trainingLoadView({ records: [], runs: [...chronicRuns, acuteRun], startDate: START, today: '2026-12-15', templates })
    expect(withHr.warning).toEqual(without.warning)
    expect(withHr.warning.mark).toBe('↓ Low')
    expect(withHr.hrLine).toContain('HR load this week:')
  })

  it('hrWeekLine: singular for one run, null with no week or no runs in it', () => {
    const pair = { maxHr: 190, restingHr: 50 }
    expect(hrWeekLine({ hrLoad: 72.4, withHr: 1, hrNotCounted: 0, runs: 1 }, pair)).toBe('HR load this week: 72 (1 of 1 run had heart rate)')
    expect(hrWeekLine({ hrLoad: 310.2, withHr: 6, hrNotCounted: 0, runs: 7 }, pair)).toBe('HR load this week: 310 (6 of 7 runs had heart rate)')
    expect(hrWeekLine({ hrLoad: 0, withHr: 0, hrNotCounted: 0, runs: 0 }, pair)).toBeNull()
    expect(hrWeekLine(undefined, pair)).toBeNull()
    expect(hrWeekLine({ hrLoad: 72, withHr: 1, hrNotCounted: 0, runs: 1 }, null)).toBeNull()
  })

  it('hrWeekLine: a run with heart rate but no time still counts as having heart rate, and the words name what blocks its load', () => {
    const pair = { maxHr: 190, restingHr: 50 }
    expect(hrWeekLine({ hrLoad: 0, withHr: 1, hrNotCounted: 1, runs: 1 }, pair)).toBe('HR load this week: 0 (1 of 1 run had heart rate; 1 has no time logged)')
    expect(hrWeekLine({ hrLoad: 72.4, withHr: 3, hrNotCounted: 2, runs: 4 }, pair)).toBe('HR load this week: 72 (3 of 4 runs had heart rate; 2 have no time logged)')
  })

  it('a week whose only run has heart rate but no time: the view’s line says the heart rate was there and what is missing', () => {
    const hrSettings = { id: 'heart-rate' as const, maxHr: 190, restingHr: 50 }
    const runs = [{ ...run('r1', '2026-11-02', 3), minutes: 0, rpe: 4, avgHr: 150, maxHr: 171 }]
    const view = trainingLoadView({ records: [], runs, startDate: START, today: '2026-11-05', templates, hrSettings })
    expect(view.hrLine).toBe('HR load this week: 0 (1 of 1 run had heart rate; 1 has no time logged)')
    expect(view.weeks[0]).toMatchObject({ withHr: 1, hrNotCounted: 1, runs: 1 })
  })
})

describe('the VO2 max section (metrics phase 3)', () => {
  const readings = [
    { date: '2026-11-14', vo2: 45 },
    { date: '2026-11-07', vo2: 44 },
    { date: '2026-11-10', vo2: 43 },
  ]

  it('vo2View: with nothing stored, no stat, no trend, and the empty words', () => {
    expect(vo2View({ readings: [] })).toEqual({
      latest: null,
      trend: [],
      empty: 'No readings yet. Type the number from the watch when it changes.',
    })
  })

  it('vo2View: the latest reading with its date in words, and the trend newest first, whatever order the rows came in', () => {
    const view = vo2View({ readings })
    expect(view.latest).toEqual({ value: 45, when: 'from the watch, Nov 14' })
    expect(view.trend).toEqual([
      { date: '2026-11-14', words: '45 — Nov 14' },
      { date: '2026-11-10', words: '43 — Nov 10' },
      { date: '2026-11-07', words: '44 — Nov 7' },
    ])
  })

  it('vo2View: one reading is a stat and a one-row trend; nothing between readings is estimated', () => {
    const view = vo2View({ readings: [{ date: '2026-11-07', vo2: 44 }] })
    expect(view.latest).toEqual({ value: 44, when: 'from the watch, Nov 7' })
    expect(view.trend).toEqual([{ date: '2026-11-07', words: '44 — Nov 7' }])
  })

  it('vo2Entry: an empty field leaves Save waiting under the type-it-first words, no replace line on a day with no reading', () => {
    expect(vo2Entry({ value: null, readings, today: '2026-11-15' })).toEqual({
      problem: 'Type the number from the watch first.',
      replaces: null,
      saveLabel: 'Type the number from the watch first.',
    })
  })

  it('vo2Entry: out of bounds is refused in words, never clamped, and the Save button carries the blocker', () => {
    expect(vo2Entry({ value: 19, readings: [], today: '2026-11-15' })).toMatchObject({
      problem: 'VO2 max reads 20 to 90; 19 is outside that.',
      saveLabel: 'VO2 max reads 20 to 90; 19 is outside that.',
    })
    expect(vo2Entry({ value: 91, readings: [], today: '2026-11-15' }).problem).toBe('VO2 max reads 20 to 90; 91 is outside that.')
  })

  it('vo2Entry: a fine value frees Save, and the replace line shows only when today already has a reading', () => {
    expect(vo2Entry({ value: 46, readings, today: '2026-11-14' })).toEqual({
      problem: null,
      replaces: 'Today already has a reading (45). Saving replaces it.',
      saveLabel: 'Save reading',
    })
    expect(vo2Entry({ value: 46, readings, today: '2026-11-15' })).toEqual({ problem: null, replaces: null, saveLabel: 'Save reading' })
  })

  it('progressView carries the VO2 view, from readings handed in on their own, never through History', () => {
    const history = { workouts: [], setLogs: [], morningChecks: [], runs: [], sessionMoves: [] }
    const view = progressView({ today: '2026-11-15', settings, history, program: { ...program, exercises: CATALOG }, vo2Readings: readings })
    expect(view.vo2.latest).toEqual({ value: 45, when: 'from the watch, Nov 14' })
    const bare = progressView({ today: '2026-11-15', settings, history, program: { ...program, exercises: CATALOG } })
    expect(bare.vo2).toEqual({ latest: null, trend: [], empty: 'No readings yet. Type the number from the watch when it changes.' })
  })
})

describe('the KOOS section (Batch A): five subscale trends in words, scores on Progress only', () => {
  // Oct 11: Pain 5 of 9 answered, all 1 → 75; Symptoms 4 of 7, all 0 → 100; QOL 2 of 4, both 2 → 50; Sport 3 of 5, all 2 → 50; ADL unanswered.
  const earlier = { date: '2026-10-11', p1: 1, p2: 1, p3: 1, p4: 1, p5: 1, sy1: 0, sy2: 0, sy3: 0, sy4: 0, q1: 2, q2: 2, sp1: 2, sp2: 2, sp3: 2 }
  // Nov 8: Pain 75 (unchanged); Symptoms 75 (down); ADL 9 of 17, all 0 → 100 (first score); Sport 75 (up); QOL only 1 of 4 answered → not scored, the Oct 11 score still stands.
  const latest = { date: '2026-11-08', p1: 1, p2: 1, p3: 1, p4: 1, p5: 1, sy1: 1, sy2: 1, sy3: 1, sy4: 1, a1: 0, a2: 0, a3: 0, a4: 0, a5: 0, a6: 0, a7: 0, a8: 0, a9: 0, sp1: 1, sp2: 1, sp3: 1, q1: 3 }

  it('with nothing stored: no rows, the empty words, and the due line says none entered yet', () => {
    expect(koosView({ entries: [], today: '2026-11-08' })).toEqual({
      rows: [],
      due: 'A KOOS check is due — none entered yet.',
      empty: 'No questionnaire entries yet. The KOOS asks 42 questions about the knee over the last week; its five subscales trend here, 100 meaning no problems.',
    })
  })

  it('each subscale against the scored entry before it, in words and numbers with dates, whatever order the rows came in', () => {
    const view = koosView({ entries: [latest, earlier], today: '2026-11-08' })
    expect(view.rows).toEqual([
      { name: 'Pain', words: '75 — Nov 8, unchanged from 75 on Oct 11' },
      { name: 'Symptoms', words: '75 — Nov 8, down from 100 on Oct 11' },
      { name: 'Daily living', words: '100 — Nov 8' },
      { name: 'Sport and recreation', words: '75 — Nov 8, up from 50 on Oct 11' },
      { name: 'Quality of life', words: 'not scored Nov 8 — too few answers; last 50 on Oct 11' },
    ])
    expect(view.due).toBeNull()
  })

  it('a subscale never scored is said in words, never guessed; a fractional score keeps its one decimal', () => {
    // QOL both answered → 100; Pain 5 of 9 at mixed values: sum 4 over 5 → mean 0.8 → 80; the rest under half answered.
    const one = { date: '2026-11-08', q1: 0, q2: 0, p1: 1, p2: 1, p3: 1, p4: 1, p5: 0 }
    const view = koosView({ entries: [one], today: '2026-11-08' })
    expect(view.rows).toEqual([
      { name: 'Pain', words: '80 — Nov 8' },
      { name: 'Symptoms', words: 'not scored yet — too few answers' },
      { name: 'Daily living', words: 'not scored yet — too few answers' },
      { name: 'Sport and recreation', words: 'not scored yet — too few answers' },
      { name: 'Quality of life', words: '100 — Nov 8' },
    ])
    // Pain 9 of 9 with sum 5 → 86.11… reads 86.1: one decimal, as the rule rounds it.
    const nine = { date: '2026-11-08', p1: 1, p2: 1, p3: 1, p4: 1, p5: 1, p6: 0, p7: 0, p8: 0, p9: 0 }
    expect(koosView({ entries: [nine], today: '2026-11-08' }).rows[0]).toEqual({ name: 'Pain', words: '86.1 — Nov 8' })
  })

  it('the due line: 28 days since the last entry is due with its date, 27 is not (monthly means 28, PROGRAM-QUESTIONS 158)', () => {
    expect(koosView({ entries: [earlier], today: '2026-11-08' }).due).toBe('A KOOS check is due — the last entry was Oct 11.')
    expect(koosView({ entries: [earlier], today: '2026-11-07' }).due).toBeNull()
  })

  it('progressView carries the KOOS view, from entries handed in on their own, never through History', () => {
    const history = { workouts: [], setLogs: [], morningChecks: [], runs: [], sessionMoves: [] }
    const view = progressView({ today: '2026-11-08', settings, history, program: { ...program, exercises: CATALOG }, koosEntries: [latest, earlier] })
    expect(view.koos.rows[0]).toEqual({ name: 'Pain', words: '75 — Nov 8, unchanged from 75 on Oct 11' })
    const bare = progressView({ today: '2026-11-08', settings, history, program: { ...program, exercises: CATALOG } })
    expect(bare.koos.rows).toEqual([])
    expect(bare.koos.due).toBe('A KOOS check is due — none entered yet.')
  })
})

describe('Morning tags (Batch D, PROGRAM-QUESTIONS 178)', () => {
  const mc = (date: string, tags?: MorningTag[]): MorningCheck => ({
    id: `mc-${date}`, date, appliesTo: null, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [], ...(tags ? { tags } : {}),
  })
  const sr = (date: string, result: SubjectReading['result']): SubjectReading => ({ kind: 'run', id: `run-${date}`, date, result })
  const days = (n: number, from = 3) => Array.from({ length: n }, (_, i) => `2026-11-${String(from + i).padStart(2, '0')}`)
  /** A causal word, or a word that would read as one: counts say what came after, never why. */
  const CAUSAL = /\bbecause\b|\bcaused?\b|\bdue to\b|\bleads? to\b|\bimpacts?\b|\beffects?\b|\bdrives?\b|\btriggers?\b|\bresults? in\b|\blinked to\b|\bhelps?\b|\bhurts?\b|\bmakes?\b|\bmade\b/i
  const allWords = (v: TagsView) => [v.intro, v.empty ?? '', ...v.rows.flatMap((r) => [r.line, r.without ?? ''])]

  it('says in one sentence when no tag was ever used', () => {
    const v = tagsView({ checks: [mc('2026-11-04')], readings: [sr('2026-11-03', 'clean')] })
    expect(v.rows).toEqual([])
    expect(v.empty).toBe('No tags yet. They’re optional taps on the morning check; a tag’s counts show once it has 5 mornings with a session the day before.')
    expect(v.intro).toBe('Counts only: the readings on mornings after each tag. A count says what came after, not why.')
  })
  it('under 5 paired mornings says how many so far; an unused tag says so', () => {
    const v = tagsView({ checks: [mc('2026-11-04', ['poor-sleep']), mc('2026-11-05', ['poor-sleep']), mc('2026-11-09', ['brace'])], readings: [sr('2026-11-03', 'hold'), sr('2026-11-04', 'clean')] })
    expect(v.empty).toBeNull()
    expect(v.rows.map((r) => r.line)).toEqual([
      'Poor sleep: tagged on 2 mornings with a session the day before. Counts show from 5.',
      'A long sit or car ride: not tagged yet.',
      'A day on your feet: not tagged yet.',
      'Wearing the brace: tagged on 0 mornings with a session the day before. Counts show from 5.',
      'An anti-inflammatory: not tagged yet.',
      'New shoes: not tagged yet.',
    ])
    expect(v.rows.every((r) => r.without === null)).toBe(true)
  })
  it('from 5 shows the counts, and the mornings without it only once they reach 5 too', () => {
    const tagged = days(5, 3)
    const checks = tagged.map((d) => mc(addOne(d), ['poor-sleep']))
    const readings = tagged.map((d, i) => sr(d, i < 2 ? 'clean' : i < 4 ? 'hold' : 'back-off'))
    const few = tagsView({ checks, readings })
    expect(few.rows[0]).toEqual({ tag: 'poor-sleep', line: 'After poor sleep: 5 readings — 2 clean, 2 hold, 1 back off.', without: 'Mornings without it: fewer than 5 so far.' })
    const untagged = days(6, 20)
    const more = tagsView({ checks: [...checks, ...untagged.map((d) => mc(addOne(d)))], readings: [...readings, ...untagged.map((d) => sr(d, 'clean'))] })
    expect(more.rows[0]?.without).toBe('Mornings without it: 6 readings — 6 clean, 0 hold, 0 back off.')
    expect(more.rows[1]?.line).toBe('A long sit or car ride: not tagged yet.')
    for (const text of [...allWords(few), ...allWords(more)]) expect(text, text).not.toMatch(CAUSAL)
  })
  it('the causal-word check catches what it should', () => {
    for (const bad of ['Pain was up because of poor sleep', 'caused by', 'due to the brace', 'leads to hold', 'impacts trends', 'the effect of', 'drives readings', 'triggers', 'results in', 'linked to', 'helps', 'hurts', 'makes it', 'made']) expect(bad).toMatch(CAUSAL)
    expect('After poor sleep: 6 readings — 2 clean.').not.toMatch(CAUSAL)
  })
  it('rides on the Progress view, read from the stored checks', () => {
    const settings: Settings = { injuredSide: 'right', startDate: '2026-11-02', dumbbellMax: 75, restTimerSeconds: 60, painPerSet: false, currentPhase: 1, phaseEnteredWeek: 1, redFlag: { active: false, items: [] }, activeLocationId: 'planet-fitness', kit: [] }
    const history = { workouts: [], setLogs: [], morningChecks: [mc('2026-11-04', ['nsaid'])], runs: [], gateTests: [], sessionMoves: [] }
    const view = progressView({ today: '2026-11-09', settings, history, program })
    expect(view.tags.rows.find((r) => r.tag === 'nsaid')?.line).toBe('An anti-inflammatory: tagged on 0 mornings with a session the day before. Counts show from 5.')
  })
})

function addOne(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

describe('down periods on Progress (Batch E, PROGRAM-QUESTIONS 187)', () => {
  const AT = '2026-11-14T13:00:00.000Z'
  it('lists them newest first, in words, and leaves the weekly counts as they are', () => {
    const p1 = { id: 'dp-2026-11-14', start: '2026-11-14', plannedEnd: '2026-11-20', endedOn: '2026-11-17', declaredAt: AT }
    const p2 = { id: 'dp-2026-12-01', start: '2026-12-01', plannedEnd: '2026-12-03', declaredAt: AT }
    expect(downPeriodLines([p1, p2])).toEqual(['Tuesday Dec 1 to Thursday Dec 3 (3 days)', 'Saturday Nov 14 to Friday Nov 20, ended early on Tuesday Nov 17 (4 of 7 days)'])
    expect(downPeriodLines([])).toEqual([])
  })
})
