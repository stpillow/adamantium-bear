import type { History } from '../db/repo.ts'
import { addDays, daysBetween, weekOf } from '../rules/calendar.ts'
import { attachChecks, subjectReadings, type SubjectReading, type WorkoutRecord } from '../rules/history.ts'
import { awaitingMorningCheck, consecutiveCleanDays, loadSeries, milesSeries, symmetryLeftOut, symmetrySeries, type LoadPoint, type MilesWeek, type SymmetryLeftOut, type SymmetryPoint } from '../rules/progress.ts'
import { ACUTE_HIGH, ACUTE_LOW, acuteChronic, hrPair, trainingLoads, weeklyTrainingLoads, type AcuteChronic, type Band, type HrPair, type TrainingLoadEntry, type TrainingLoadWeek } from '../rules/trainingLoad.ts'
import { LOWER_BODY_PATTERNS } from '../rules/wholeKnee.ts'
import type { Exercise, Gate, HrSettings, IsoDate, MileageWeek, MorningCheck, Program, Run, SessionTemplate, SetLog, SetSide, Settings, Side } from '../schema/index.ts'
import { runLabel, shortDateWords, workoutLabel } from './Today.helpers.ts'

/**
 * Pure helpers for the Progress screen: the words for the clean-days stat, the list of logged
 * exercises, the chart models, readouts, tables and accessible names, and the chart geometry
 * (scales, ticks, nearest-date hit testing, label selection and placement). Every knee number
 * (the series, the clean-day count, the gates' lines) comes from src/rules; this file only shapes
 * the answers for the screen and says them in words.
 */

export type HistoryLike = Pick<History, 'workouts' | 'setLogs' | 'morningChecks' | 'runs'>
export type ProgramLike = Pick<Program, 'exercises' | 'gates' | 'mileagePlan' | 'templates'>

// ---------------------------------------------------------------------------------------------
// Numbers and dates in words
// ---------------------------------------------------------------------------------------------

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Nov 3": the short form under a chart's axis. */
export function axisDate(date: IsoDate): string {
  const [, m, d] = date.split('-').map(Number)
  const month = m === undefined ? undefined : MONTH_SHORT[m - 1]
  if (month === undefined || d === undefined || Number.isNaN(d)) throw new RangeError(`not a YYYY-MM-DD date: ${date}`)
  return `${month} ${d}`
}

/** A number as the screen prints it: whole numbers as they are, anything else to one decimal. */
export function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n)
  const r = Math.round(n * 10) / 10
  return String(r)
}

const capitalize = (text: string) => (text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`)

/** "Gate 1", "Gates 2 and 3", "Gates 1, 2 and 3". */
export function gatesWords(numbers: readonly number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b)
  if (sorted.length === 1) return `Gate ${sorted[0]}`
  const last = sorted.at(-1)
  return `Gates ${sorted.slice(0, -1).join(', ')} and ${last}`
}

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

export interface Margin {
  top: number
  right: number
  bottom: number
  left: number
}

/** The plot's box inside the chart, in pixels. */
export interface Plot {
  left: number
  right: number
  top: number
  bottom: number
}

export function plotArea(width: number, height: number, margin: Margin): Plot {
  return {
    left: margin.left,
    top: margin.top,
    right: Math.max(margin.left + 1, width - margin.right),
    bottom: Math.max(margin.top + 1, height - margin.bottom),
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** A linear scale from a domain to a range; a zero-width domain maps to the middle of the range. */
export function scaleLinear(domain: readonly [number, number], range: readonly [number, number]): (value: number) => number {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0
  return (value) => (span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0))
}

/** A clean tick step about span / count apart: 1, 2 or 5 times a power of ten. */
export function niceStep(span: number, count: number): number {
  if (!(span > 0) || !(count > 0)) return 1
  const raw = span / count
  const power = 10 ** Math.floor(Math.log10(raw))
  const f = raw / power
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * power
}

export interface Axis {
  min: number
  max: number
  ticks: number[]
}

/**
 * One y-axis that covers lo to hi with clean ticks about `count` steps apart, never below `floor`.
 * A single value gets room on both sides, so a flat line sits in the middle rather than on an edge.
 */
export function niceAxis(lo: number, hi: number, count = 4, floor = 0, minStep = 0): Axis {
  let a = Math.max(floor, Math.min(lo, hi))
  let b = Math.max(a, lo, hi)
  if (a === b) {
    const pad = a === 0 ? 1 : Math.abs(a) * 0.1
    a = Math.max(floor, a - pad)
    b += pad
  }
  const step = Math.max(minStep, niceStep(b - a, count))
  const digits = Math.max(0, -Math.floor(Math.log10(step)))
  const fix = (n: number) => Number(n.toFixed(digits))
  const min = fix(Math.floor(a / step + 1e-9) * step)
  const max = fix(Math.ceil(b / step - 1e-9) * step)
  const ticks: number[] = []
  for (let i = 0; i < 100; i++) {
    const v = fix(min + i * step)
    if (v > max + step / 1e6) break
    ticks.push(v)
  }
  return { min, max, ticks }
}

/** x for each date, proportional to the days between them; a single date sits in the middle. */
export function datePositions(dates: readonly IsoDate[], x0: number, x1: number): number[] {
  const first = dates[0]
  const last = dates.at(-1)
  if (first === undefined || last === undefined) return []
  const span = daysBetween(first, last)
  if (span === 0) return dates.map(() => round2((x0 + x1) / 2))
  return dates.map((d) => round2(x0 + (daysBetween(first, d) / span) * (x1 - x0)))
}

/** Equal slots across a width (one per week), and each slot's centre. */
export function bandCenters(count: number, x0: number, x1: number): { centers: number[]; slot: number } {
  if (count <= 0) return { centers: [], slot: 0 }
  const slot = (x1 - x0) / count
  return { centers: Array.from({ length: count }, (_, i) => round2(x0 + (i + 0.5) * slot)), slot: round2(slot) }
}

/** The index of the position nearest x (the date a tap lands on), the earlier on a tie; null with none. */
export function nearestIndex(positions: readonly number[], x: number): number | null {
  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  positions.forEach((p, i) => {
    const d = Math.abs(p - x)
    if (d < bestDistance) {
      best = i
      bestDistance = d
    }
  })
  return best
}

/** How far a touch may wander and still be a tap, in px. */
export const TAP_SLOP = 10

/**
 * What a touch on a chart is so far, from where it went down to where it is: a tap while it stays
 * within the slop; past it, a drag along the dates when it went more sideways than up or down,
 * else a scroll of the page. A scroll that starts on a chart picks no date.
 */
export function gestureAt(start: { x: number; y: number }, now: { x: number; y: number }, slop = TAP_SLOP): 'tap' | 'drag' | 'scroll' {
  const dx = Math.abs(now.x - start.x)
  const dy = Math.abs(now.y - start.y)
  if (dx <= slop && dy <= slop) return 'tap'
  return dx > dy ? 'drag' : 'scroll'
}

/**
 * The date focus selects: the one already picked, else the chart's opening point (`initial`: this
 * week on the miles chart), else the latest. Null with no dates.
 */
export function focusIndex(current: number | null, initial: number | undefined, length: number): number | null {
  if (length <= 0) return null
  if (current !== null) return Math.min(length - 1, Math.max(0, current))
  return Math.min(length - 1, Math.max(0, initial ?? length - 1))
}

/**
 * Where a key moves the selected date: left and right one step, Home and End to either end. With
 * nothing picked yet it steps from the chart's opening point (`initial`, else the latest). Null for
 * other keys.
 */
export function stepIndex(current: number | null, key: string, length: number, initial?: number): number | null {
  if (length <= 0) return null
  const from = focusIndex(current, initial, length) ?? length - 1
  switch (key) {
    case 'ArrowLeft':
      return current === null ? from : Math.max(0, from - 1)
    case 'ArrowRight':
      return Math.min(length - 1, from + 1)
    case 'Home':
      return 0
    case 'End':
      return length - 1
    default:
      return null
  }
}

/**
 * The points on one series worth a label: the last, and the extreme (the highest) when it is
 * another point and higher than the last. Never every point.
 */
export function labelledPoints(values: readonly number[]): { last: number | null; extreme: number | null } {
  if (values.length === 0) return { last: null, extreme: null }
  const last = values.length - 1
  let extreme = 0
  values.forEach((v, i) => {
    if (v > (values[extreme] ?? Number.NEGATIVE_INFINITY)) extreme = i
  })
  const lastValue = values[last] ?? 0
  const extremeValue = values[extreme] ?? 0
  return { last, extreme: extreme !== last && extremeValue > lastValue ? extreme : null }
}

/**
 * End labels pushed apart to at least `gap` px, in their order, and kept between top and bottom.
 * The labels then sit off their dots, so the chart draws a leader line from each dot to its label.
 */
export function spreadLabels(ys: readonly number[], gap: number, top: number, bottom: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i)
  const placed = order.map((o) => o.y)
  for (let k = 0; k < placed.length; k++) {
    const prev = k > 0 ? (placed[k - 1] ?? top) + gap : top
    placed[k] = Math.max(placed[k] ?? top, prev)
  }
  for (let k = placed.length - 1; k >= 0; k--) {
    const next = k < placed.length - 1 ? (placed[k + 1] ?? bottom) - gap : bottom
    placed[k] = Math.min(placed[k] ?? bottom, next)
  }
  const out = Array.from({ length: ys.length }, () => 0)
  order.forEach((o, k) => {
    out[o.i] = round2(Math.max(top, placed[k] ?? top))
  })
  return out
}

/** A text's width estimate at a size: Plex Mono is 0.6 em a character; Plex Sans averages under 0.56. */
export function textWidth(text: string, size = 12, mono = true): number {
  return round2(text.length * size * (mono ? 0.6 : 0.56))
}

/** A middle-anchored label's centre, moved in so the whole label stays between min and max. */
export function clampCenter(center: number, width: number, min: number, max: number): number {
  const half = width / 2
  if (max - min <= width) return round2((min + max) / 2)
  return round2(Math.min(max - half, Math.max(min + half, center)))
}

/** An SVG path through the points. */
export function linePath(points: readonly { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round2(p.x)} ${round2(p.y)}`).join('')
}

/**
 * A column standing on the baseline: rounded at the top (4 px, less on a short column), square at
 * the baseline. Null when there is nothing to draw.
 */
export function columnPath(cx: number, width: number, baseline: number, top: number, radius = 4): string | null {
  const h = baseline - top
  if (!(h > 0) || !(width > 0)) return null
  const r = round2(Math.min(radius, h, width / 2))
  const x0 = round2(cx - width / 2)
  const x1 = round2(cx + width / 2)
  const t = round2(top)
  const b = round2(baseline)
  return `M${x0} ${b}V${round2(t + r)}A${r} ${r} 0 0 1 ${round2(x0 + r)} ${t}H${round2(x1 - r)}A${r} ${r} 0 0 1 ${x1} ${round2(t + r)}V${b}Z`
}

export interface Tick {
  value: number
  y: number
}

export interface Dot {
  x: number
  y: number
  value: number
}

export interface LineGeometry {
  key: string
  path: string
  dots: Dot[]
  /** The extreme's label, above its dot; only on the line the chart is about. */
  extreme: Dot | null
  /** The extreme's label goes under its dot: the lines crowd the space above it more than below. */
  extremeBelow: boolean
}

/** Where the extreme's label sits from its dot: its baseline 11 px above, or 20 px below. */
export const EXTREME_ABOVE_DY = -11
export const EXTREME_BELOW_DY = 20

/** A label at a line's end, in the right margin; `keys` holds both lines when they end on the same point. */
export interface EndLabel {
  keys: string[]
  value: number
  x: number
  y: number
  dotX: number
  dotY: number
  /** The label sits off its dot (pushed apart, or the line ends before the last date): draw a leader. */
  leader: boolean
}

/**
 * A reference line and where its words sit: above the line, or under it when the next line up is
 * closer than a label's height, at whichever end of the plot the data leaves clearer.
 */
export interface RefLine {
  value: number
  y: number
  label: string
  labelX: number
  anchor: 'start' | 'end'
  /** The words sit under the line: another gate's line runs too close above it to fit them there. */
  below: boolean
}

/** A reference label's baseline from its line: 5 px above, or 13 px below. */
export const REF_ABOVE_DY = -5
export const REF_BELOW_DY = 13
/** The room a reference label needs between its line and the next one up. */
const REF_LABEL_ROOM = 18

/** The box a reference label's words take, from where they sit. */
export function refLabelBox(ref: Pick<RefLine, 'y' | 'label' | 'labelX' | 'anchor' | 'below'>): { x0: number; x1: number; y0: number; y1: number } {
  const w = textWidth(ref.label, 12, false)
  const x0 = ref.anchor === 'start' ? ref.labelX : ref.labelX - w
  return { x0, x1: x0 + w, y0: ref.below ? ref.y + 2 : ref.y - 16, y1: ref.below ? ref.y + 16 : ref.y - 2 }
}

export interface LineChartGeometry {
  plot: Plot
  xs: number[]
  ticks: Tick[]
  refs: RefLine[]
  lines: LineGeometry[]
  ends: EndLabel[]
  dateLabels: { x: number; text: string }[]
}

export const END_LABEL_GAP = 14
const LINE_INSET = 8

/**
 * Everything a line chart draws, in pixels: the x of each date (by the days between them), the
 * ticks, reference lines, each line's path and dots, end labels pushed apart with leaders, the
 * extreme's label on one line, and the first and last dates under the axis (the first dropped when
 * the two would touch).
 */
export function lineChartGeometry(input: {
  width: number
  height: number
  margin: Margin
  dates: readonly IsoDate[]
  lines: readonly { key: string; points: readonly { date: IsoDate; value: number }[] }[]
  axis: Axis
  refs?: readonly { value: number; label: string }[]
  /** The line whose extreme is labelled (the injured side, or the only line). */
  extremeFor?: string
}): LineChartGeometry {
  const { width, height, margin, dates, axis } = input
  const plot = plotArea(width, height, margin)
  const xs = datePositions(dates, plot.left + LINE_INSET, plot.right - LINE_INSET)
  const y = scaleLinear([axis.min, axis.max], [plot.bottom, plot.top])
  const xOf = new Map(dates.map((d, i) => [d, xs[i] ?? plot.left]))
  const lastX = xs.at(-1) ?? plot.right

  const drawn = input.lines.map((line) => {
    const dots = line.points.map((p) => ({ x: xOf.get(p.date) ?? plot.left, y: round2(y(p.value)), value: p.value }))
    const marks = labelledPoints(line.points.map((p) => p.value))
    const extreme = line.key === input.extremeFor && marks.extreme !== null ? (dots[marks.extreme] ?? null) : null
    return { key: line.key, path: linePath(dots), dots, extreme }
  })
  // The extreme's label is checked against every line, the other side's rings included: it goes
  // under its dot when the lines run through less there, and the space fits above the axis.
  const allDots = drawn.map((l) => l.dots)
  const lines: LineGeometry[] = drawn.map((line) => {
    const e = line.extreme
    if (!e) return { ...line, extremeBelow: false }
    const half = textWidth(`${fmt(e.value)}%`) / 2
    const box = (dy: number) => ({ x0: e.x - half, x1: e.x + half, y0: e.y + dy - 9, y1: e.y + dy + 1 })
    const below = box(EXTREME_BELOW_DY)
    const fits = below.y1 <= plot.bottom
    return { ...line, extremeBelow: fits && crossings(allDots, below) < crossings(allDots, box(EXTREME_ABOVE_DY)) }
  })

  // End labels: one per line, one shared label when two lines end on the same point.
  const raw: { keys: string[]; dot: Dot }[] = []
  for (const line of lines) {
    const dot = line.dots.at(-1)
    if (!dot) continue
    const same = raw.find((r) => Math.abs(r.dot.x - dot.x) < 0.5 && Math.abs(r.dot.y - dot.y) < 0.5 && r.dot.value === dot.value)
    if (same) same.keys.push(line.key)
    else raw.push({ keys: [line.key], dot })
  }
  const labelYs = spreadLabels(
    raw.map((r) => r.dot.y),
    END_LABEL_GAP,
    plot.top,
    plot.bottom,
  )
  const ends: EndLabel[] = raw.map((r, i) => {
    const labelY = labelYs[i] ?? r.dot.y
    // Always in the right margin, past the gridlines' end, so no hairline strikes through it: with one
    // date the dot sits mid-plot, and the label gets a leader across to it.
    return {
      keys: r.keys,
      value: r.dot.value,
      x: round2(plot.right + 2),
      y: labelY,
      dotX: r.dot.x,
      dotY: r.dot.y,
      leader: Math.abs(labelY - r.dot.y) > 2 || r.dot.x < plot.right - LINE_INSET - 0.5,
    }
  })

  const dateLabels: { x: number; text: string }[] = []
  const first = dates[0]
  const last = dates.at(-1)
  if (first !== undefined && last !== undefined) {
    const lastText = axisDate(last)
    const lastW = textWidth(lastText)
    const lastCenter = clampCenter(lastX, lastW, 0, width)
    if (first !== last) {
      const firstText = axisDate(first)
      const firstW = textWidth(firstText)
      const firstCenter = clampCenter(xs[0] ?? plot.left, firstW, 0, width)
      if (lastCenter - lastW / 2 - (firstCenter + firstW / 2) >= 8) dateLabels.push({ x: firstCenter, text: firstText })
    }
    dateLabels.push({ x: lastCenter, text: lastText })
  }

  return {
    plot,
    xs,
    ticks: axis.ticks.map((v) => ({ value: v, y: round2(y(v)) })),
    refs: (input.refs ?? []).map((ref, _, all) => {
      const ry = round2(y(ref.value))
      // A gate line closer above than a label's height (an axis stretched to 200% puts 80% and 90%
      // 10 px apart): the words go under this line, so neither hairline runs through them and the
      // two labels never meet. Only when they fit above the axis.
      const above = all.map((r) => round2(y(r.value))).filter((oy) => oy < ry)
      const crowded = above.some((oy) => ry - oy < REF_LABEL_ROOM)
      const below = crowded && ry + 16 <= plot.bottom
      const at = (anchor: 'start' | 'end') => refLabelBox({ y: ry, label: ref.label, labelX: anchor === 'start' ? plot.left + 4 : plot.right - 4, anchor, below })
      const dots = lines.map((l) => l.dots)
      const atRight = crossings(dots, at('end')) < crossings(dots, at('start'))
      return { value: ref.value, y: ry, label: ref.label, labelX: atRight ? plot.right - 4 : plot.left + 4, anchor: atRight ? ('end' as const) : ('start' as const), below }
    }),
    lines,
    ends,
    dateLabels,
  }
}

/** Where a line drawn through the dots crosses x, or null where the line doesn't reach. */
export function lineYAt(dots: readonly { x: number; y: number }[], x: number): number | null {
  for (let i = 0; i < dots.length; i++) {
    const a = dots[i]
    const b = dots[i + 1]
    if (!a) continue
    if (!b) return Math.abs(a.x - x) < 0.5 ? a.y : null
    if (x >= a.x && x <= b.x) return b.x === a.x ? a.y : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y)
  }
  return null
}

/** How much of a label's box the lines run through: samples every 4 px across it, and every dot near it. */
export function crossings(lines: readonly (readonly { x: number; y: number }[])[], box: { x0: number; x1: number; y0: number; y1: number }): number {
  let hits = 0
  for (const dots of lines) {
    for (let x = box.x0; x <= box.x1; x += 4) {
      const ly = lineYAt(dots, x)
      if (ly !== null && ly >= box.y0 - 3 && ly <= box.y1 + 3) hits++
    }
    hits += dots.filter((d) => d.x >= box.x0 - 6 && d.x <= box.x1 + 6 && d.y >= box.y0 - 6 && d.y <= box.y1 + 6).length * 4
  }
  return hits
}

export interface ColumnGeometry {
  plot: Plot
  centers: number[]
  slot: number
  colWidth: number
  ticks: Tick[]
  columns: { week: number; x: number; path: string | null; top: number; planY: number; planX1: number; planX2: number }[]
  weekLabels: { x: number; text: string }[]
  downLabels: { x: number; text: string }[]
  valueLabels: { x: number; y: number; text: string }[]
}

/** The word under each deload week's slot. */
export const DELOAD_WORD = 'deload'

/**
 * The weekly-miles chart in pixels: one slot per week, a column of at most 24 px (never filling
 * the slot), the plan as a short mark across each slot, week numbers under the axis and "deload"
 * under the down weeks, and value labels only on the weeks `labelAt` names.
 */
export function columnChartGeometry(input: { width: number; height: number; margin: Margin; weeks: readonly MilesWeek[]; labelAt: readonly number[] }): ColumnGeometry {
  const { width, height, margin, weeks } = input
  const plot = plotArea(width, height, margin)
  const top = Math.max(0, ...weeks.map((w) => Math.max(w.actual, w.planned)))
  const axis = niceAxis(0, top, 4, 0)
  const y = scaleLinear([axis.min, axis.max], [plot.bottom, plot.top])
  const { centers, slot } = bandCenters(weeks.length, plot.left, plot.right)
  const colWidth = round2(Math.min(24, slot * 0.6))
  // 2 px past the column on each side and at least 4 px short of the next week's mark, so equal
  // weeks (3 and 4, 7 and 8, 11 and 12) still read as one mark per week, not one long line.
  const planHalf = round2(Math.min(slot / 2 - 2, colWidth / 2 + 2))
  const columns = weeks.map((w, i) => {
    const x = centers[i] ?? plot.left
    const colTop = round2(y(w.actual))
    return { week: w.week, x, path: columnPath(x, colWidth, plot.bottom, colTop), top: colTop, planY: round2(y(w.planned)), planX1: round2(x - planHalf), planX2: round2(x + planHalf) }
  })
  const deloadW = textWidth(DELOAD_WORD, 12, false)
  return {
    plot,
    centers,
    slot,
    colWidth,
    ticks: axis.ticks.map((v) => ({ value: v, y: round2(y(v)) })),
    columns,
    weekLabels: weeks.map((w, i) => ({ x: centers[i] ?? plot.left, text: String(w.week) })),
    downLabels: weeks.flatMap((w, i) => (w.isDown ? [{ x: clampCenter(centers[i] ?? plot.left, deloadW, 0, width), text: DELOAD_WORD }] : [])),
    valueLabels: input.labelAt.flatMap((i) => {
      const c = columns[i]
      const w = weeks[i]
      if (!c || !w || !(w.actual > 0)) return []
      // On its column's cap; above the plan mark instead when the mark sits just over the cap.
      const crowded = c.planY <= c.top && c.top - c.planY < 16
      return [{ x: c.x, y: round2((crowded ? c.planY : c.top) - 6), text: fmt(w.actual) }]
    }),
  }
}

// ---------------------------------------------------------------------------------------------
// Readouts, tables
// ---------------------------------------------------------------------------------------------

/** The mark beside a value in a readout or legend: the same shape the chart draws. */
export type MarkKind = 'dot' | 'ring' | 'column' | 'plan'

export interface ReadoutPart {
  /** Leads: the value is the strong element. */
  value: string
  /** Follows: what the value is. Empty for a single series, which the heading already names. */
  name: string
  mark: MarkKind | null
}

export interface Readout {
  parts: ReadoutPart[]
  when: string
}

/** The readout as one line of text: values first, then names, then the date. */
export function readoutText(readout: Readout): string {
  return [...readout.parts.map((p) => (p.name ? `${p.value} ${p.name}` : p.value)), readout.when].join(' · ')
}

export interface NumbersTable {
  caption: string
  head: string[]
  rows: string[][]
}

// ---------------------------------------------------------------------------------------------
// 1. Consecutive clean days
// ---------------------------------------------------------------------------------------------

export interface CleanDaysView {
  count: number
  /** The stat's unit word ("days", "day"), or null when there is nothing to count yet. */
  unit: 'day' | 'days' | null
  /** The rest of the context line after the unit, with what isn't counted yet while a morning check is due. */
  context: string
  /** Which reading stopped the run, in one sentence. */
  note: string | null
}

const READING_WORD: Record<SubjectReading['result'], string> = { clean: 'Clean', hold: 'Hold', 'back-off': 'Back off' }

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/**
 * What the count leaves out while its morning check is due, by day and kind: "not counting
 * yesterday’s session until its morning check is in". Null when nothing is waiting. One check
 * covers a day's sessions, so two days waiting is two checks.
 */
export function waitingWords(waiting: readonly Pick<SubjectReading, 'kind' | 'date'>[], today: IsoDate): string | null {
  if (waiting.length === 0) return null
  const days = [addDays(today, -1), today].flatMap((day) => {
    const own = waiting.filter((r) => r.date === day)
    if (own.length === 0) return []
    const sessions = own.filter((r) => r.kind === 'workout').length
    const runs = own.length - sessions
    const things = [sessions > 0 ? plural(sessions, 'session', 'sessions') : null, runs > 0 ? plural(runs, 'run', 'runs') : null].filter((t): t is string => t !== null)
    return [`${day === today ? 'today’s' : 'yesterday’s'} ${things.join(' and ')}`]
  })
  const until = days.length > 1 ? 'their morning checks are in' : waiting.length === 1 ? 'its morning check is in' : 'their morning check is in'
  return `not counting ${days.join(' and ')} until ${until}`
}

/**
 * The stat: the number from `consecutiveCleanDays`, and a context line that says what it counts
 * from. A session still waiting on its morning check (today's or yesterday's, awaitingMorningCheck)
 * neither extends nor breaks the count, and the line says it isn't counted yet (PROGRAM-QUESTIONS 109).
 */
export function cleanDaysView(input: {
  readings: readonly SubjectReading[]
  today: IsoDate
  records: readonly WorkoutRecord[]
  runs: readonly Run[]
  checks: readonly MorningCheck[]
  templates: readonly SessionTemplate[]
}): CleanDaysView {
  const { readings, today, checks } = input
  const count = consecutiveCleanDays(readings, today, checks)
  const unit = count === 1 ? 'day' : 'days'
  const past = [...readings].filter((r) => r.date <= today).sort((a, b) => a.date.localeCompare(b.date))
  const read = past.filter((r) => !awaitingMorningCheck(r, checks, today))
  const waiting = waitingWords(past.filter((r) => awaitingMorningCheck(r, checks, today)), today)
  const withWaiting = (context: string) => (waiting ? `${context}, ${waiting}` : context)
  if (read.length === 0) {
    return { count, unit: null, context: withWaiting('no readings yet'), note: 'The count starts with the first finished session or logged run, once its morning check is in.' }
  }
  const lastBad = read.filter((r) => r.result !== 'clean').at(-1)
  if (!lastBad) return { count, unit, context: withWaiting('since the first reading, with no hold or back-off yet'), note: null }

  // The label has its own colon ("Run: easy"), so it goes in brackets.
  const label = subjectLabel(lastBad, input.records, input.runs, input.templates)
  return { count, unit, context: withWaiting('since the last hold or back-off'), note: `${READING_WORD[lastBad.result]} on ${shortDateWords(lastBad.date)} (${label}).` }
}

function subjectLabel(reading: SubjectReading, records: readonly WorkoutRecord[], runs: readonly Run[], templates: readonly SessionTemplate[]): string {
  if (reading.kind === 'run') {
    const run = runs.find((r) => r.id === reading.id)
    return run ? runLabel(run.type) : 'a run'
  }
  const record = records.find((r) => r.workout.id === reading.id)
  return record ? workoutLabel(record.workout, templates) : 'a session'
}

// ---------------------------------------------------------------------------------------------
// 2. Load over time
// ---------------------------------------------------------------------------------------------

export interface ExerciseRow {
  id: string
  name: string
  /** "Single-leg · per side · last Nov 3 · 4 sessions". */
  detail: string
  lastDate: IsoDate
  /** Logged per side, or a per-side exercise in the catalog: symmetry applies. */
  twoSided: boolean
}

/**
 * The exercises with logged sets in sessions that happened (the ones `loadSeries` draws), most
 * recent first. A session logs several on one date; among those the knee's own work comes first
 * (lower-body patterns, as wholeKnee.ts names them), per-side work before two-leg, then by name.
 */
export function loggedExercises(records: readonly WorkoutRecord[], catalog: readonly Exercise[]): ExerciseRow[] {
  const ids = Array.from(new Set(records.flatMap((r) => r.sets.map((s) => s.exerciseId))))
  const rows = ids.flatMap((id): { row: ExerciseRow; lower: boolean }[] => {
    const series = loadSeries(records, id)
    const last = series.at(-1)
    if (!last) return []
    const exercise = catalog.find((e) => e.id === id)
    const twoSided = (exercise?.unilateral ?? false) || series.some((p) => p.side !== 'both')
    const sessions = new Set(series.map((p) => p.date)).size
    const detail = [exercise ? capitalize(exercise.pattern) : null, twoSided ? 'per side' : null, `last ${axisDate(last.date)}`, `${sessions} ${sessions === 1 ? 'session' : 'sessions'}`]
      .filter((part): part is string => part !== null)
      .join(' · ')
    const lower = exercise !== undefined && LOWER_BODY_PATTERNS.has(exercise.pattern)
    return [{ row: { id, name: exercise?.name ?? id, detail, lastDate: last.date, twoSided }, lower }]
  })
  return rows
    .sort((a, b) => b.row.lastDate.localeCompare(a.row.lastDate) || Number(b.lower) - Number(a.lower) || Number(b.row.twoSided) - Number(a.row.twoSided) || a.row.name.localeCompare(b.row.name))
    .map((r) => r.row)
}

/** The exercise on show: the one picked while it is still listed, else the most recent. */
export function pickedRow(rows: readonly ExerciseRow[], picked: string | null): ExerciseRow | null {
  return rows.find((r) => r.id === picked) ?? rows[0] ?? null
}

/** The rows the list shows: the most recent few, or all of them. */
export const LIST_LIMIT = 5
export function visibleRows(rows: readonly ExerciseRow[], showAll: boolean, limit = LIST_LIMIT): ExerciseRow[] {
  return showAll ? [...rows] : rows.slice(0, limit)
}

export type CountUnit = 'reps' | 'seconds'

/** What an exercise's counts are: seconds when every set logged seconds, else reps. */
export function countUnitFor(sets: readonly SetLog[], exerciseId: string): CountUnit {
  const own = sets.filter((s) => s.exerciseId === exerciseId)
  return own.length > 0 && own.every((s) => s.seconds !== undefined) ? 'seconds' : 'reps'
}

const countShort = (unit: CountUnit) => (unit === 'seconds' ? 's' : 'reps')

export type SeriesRole = 'injured' | 'other' | 'both'

export interface ChartLine {
  key: SetSide
  role: SeriesRole
  /** The legend's words: "Right · injured", "Left", "Both legs". */
  name: string
  /** The readout's and the end label's words: "right, injured", "left", "". */
  short: string
  points: { date: IsoDate; value: number; load: number; count: number }[]
}

export interface LoadChart {
  /** Load in pounds, or the best set's count when no load is logged for the exercise. */
  measure: 'load' | 'count'
  countUnit: CountUnit
  /** The dates the drawn lines cover, oldest first. */
  dates: IsoDate[]
  /** The lines drawn, injured side first. */
  lines: ChartLine[]
  /** Logged but not drawn: two-leg sets of an exercise drawn per side. They stay in the table. */
  extra: ChartLine[]
}

const sideWord = (side: Side) => capitalize(side)

function chartLine(side: SetSide, injuredSide: Side, points: readonly LoadPoint[], measure: 'load' | 'count'): ChartLine {
  const byDate = new Map<IsoDate, ChartLine['points'][number]>()
  for (const p of points) {
    const value = measure === 'load' ? p.load : p.count
    const seen = byDate.get(p.date)
    if (!seen || value > seen.value) byDate.set(p.date, { date: p.date, value, load: p.load, count: p.count })
  }
  const role: SeriesRole = side === 'both' ? 'both' : side === injuredSide ? 'injured' : 'other'
  const name = side === 'both' ? 'Both legs' : role === 'injured' ? `${sideWord(side)} · injured` : sideWord(side)
  const short = side === 'both' ? '' : role === 'injured' ? `${side}, injured` : side
  return { key: side, role, name, short, points: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) }
}

/**
 * The load chart for one exercise from `loadSeries`: one line per side when it is logged per side
 * (injured first), else one line. Pounds, or the best set's reps or seconds when no load is logged
 * at all (bodyweight, time and band work).
 */
export function loadChart(points: readonly LoadPoint[], injuredSide: Side, countUnit: CountUnit): LoadChart {
  const measure = points.some((p) => p.load > 0) ? 'load' : 'count'
  const other: Side = injuredSide === 'left' ? 'right' : 'left'
  const order: SetSide[] = [injuredSide, other, 'both']
  const all = order.flatMap((side) => {
    const own = points.filter((p) => p.side === side)
    return own.length > 0 ? [chartLine(side, injuredSide, own, measure)] : []
  })
  const perSide = all.some((l) => l.role !== 'both')
  const lines = perSide ? all.filter((l) => l.role !== 'both') : all
  const extra = perSide ? all.filter((l) => l.role === 'both') : []
  const dates = Array.from(new Set(lines.flatMap((l) => l.points.map((p) => p.date)))).sort()
  return { measure, countUnit, dates, lines, extra }
}

/** A point's value in words: "185 lb × 8", "20 lb × 30 s", "12 reps", "30 s". */
export function loadValueWords(point: { load: number; count: number }, chart: Pick<LoadChart, 'measure' | 'countUnit'>): string {
  if (chart.measure === 'count') return `${fmt(point.count)} ${countShort(chart.countUnit)}`
  return `${fmt(point.load)} lb × ${fmt(point.count)}${chart.countUnit === 'seconds' ? ' s' : ''}`
}

const markFor = (role: SeriesRole): MarkKind => (role === 'other' ? 'ring' : 'dot')

/** The readout at a date: every line's value there, then its name, then the date. */
export function loadReadout(chart: LoadChart, index: number, latest: boolean): Readout | null {
  const date = chart.dates[index]
  if (date === undefined) return null
  const parts = chart.lines.map((line): ReadoutPart => {
    const p = line.points.find((x) => x.date === date)
    if (!p) return { value: 'not logged', name: line.short ? `(${line.short})` : '', mark: markFor(line.role) }
    return { value: loadValueWords(p, chart), name: line.short, mark: markFor(line.role) }
  })
  return { parts, when: `${shortDateWords(date)}${latest ? ', the latest' : ''}` }
}

/** What the y-axis measures, for the chart's line under its heading. */
export function loadSubtitle(chart: LoadChart, exercise: Pick<Exercise, 'name' | 'loadDirection'> | null, name: string): string {
  const sides = chart.lines.length > 1 ? ', one line per side' : ''
  const assist = exercise?.loadDirection === 'down' && chart.measure === 'load' ? ' The load is the assist, so lower is stronger.' : ''
  const extra = chart.extra.length > 0 ? ' Two-leg sets of it are in the numbers, not drawn.' : ''
  const what =
    chart.measure === 'load'
      ? `The heaviest set of each session, in pounds${sides}.`
      : `No load is logged for ${name}, so this is the best set’s ${chart.countUnit} per session${sides}.`
  return `${what}${assist}${extra}`
}

/** The SVG's name: what the chart shows, in one sentence. */
export function loadAria(chart: LoadChart, name: string): string {
  const what = chart.measure === 'load' ? 'the heaviest load in pounds per session' : `the best set’s ${chart.countUnit} per session`
  const lines = chart.lines.length > 1 ? `, ${chart.lines.map((l) => (l.role === 'injured' ? `the ${l.key} side, injured, as filled dots` : `the ${l.key} side as rings`)).join(' and ')}` : ''
  const first = chart.dates[0]
  const last = chart.dates.at(-1)
  const span = first === undefined || last === undefined ? '' : first === last ? `, one session on ${axisDate(first)}` : `, ${chart.dates.length} sessions from ${axisDate(first)} to ${axisDate(last)}`
  return `Line chart of ${what} for ${name}${lines}${span}.`
}

/** The chart's table twin, newest first; two-leg sets that aren't drawn get their own column. */
export function loadTable(chart: LoadChart, name: string): NumbersTable {
  const columns = [...chart.lines, ...chart.extra]
  const dates = Array.from(new Set(columns.flatMap((l) => l.points.map((p) => p.date)))).sort().reverse()
  const head = ['Date', ...columns.map((l) => (columns.length === 1 ? (chart.measure === 'load' ? 'Heaviest set' : 'Best set') : l.name))]
  const rows = dates.map((d) => [shortDateWords(d), ...columns.map((l) => {
    const p = l.points.find((x) => x.date === d)
    return p ? loadValueWords(p, chart) : 'not logged'
  })])
  return { caption: `${name}: ${chart.measure === 'load' ? 'heaviest set per session' : `best set’s ${chart.countUnit} per session`}`, head, rows }
}

// ---------------------------------------------------------------------------------------------
// 3. Symmetry over time
// ---------------------------------------------------------------------------------------------

export interface SymmetryRef {
  percent: number
  /** "Gate 1 · 80%", "Gates 2 and 3 · 90%". */
  label: string
}

/** The gates' symmetry lines, read from the program: one per threshold, naming the gates that use it. */
export function symmetryRefs(gates: readonly Gate[]): SymmetryRef[] {
  const byPercent = new Map<number, number[]>()
  for (const gate of gates) {
    for (const item of gate.items) {
      if (item.evaluator !== 'symmetry' || item.threshold === undefined) continue
      const percent = Math.round(item.threshold * 100)
      const list = byPercent.get(percent) ?? []
      if (!list.includes(gate.number)) list.push(gate.number)
      byPercent.set(percent, list)
    }
  }
  return [...byPercent.entries()].sort((a, b) => a[0] - b[0]).map(([percent, numbers]) => ({ percent, label: `${gatesWords(numbers)} · ${percent}%` }))
}

/** "Right ÷ left". */
export function symmetryName(injuredSide: Side): string {
  return `${sideWord(injuredSide)} ÷ ${injuredSide === 'left' ? 'right' : 'left'}`
}

/** What was compared, values first: "20 lb against 25 lb, loads compared", "7 against 8 reps, counts compared". */
export function comparedWords(point: Pick<SymmetryPoint, 'basis' | 'injured' | 'other'>, countUnit: CountUnit): string {
  if (point.basis === 'load') return `${fmt(point.injured)} lb against ${fmt(point.other)} lb, loads compared`
  return `${fmt(point.injured)} against ${fmt(point.other)} ${countUnit}, counts compared`
}

export function symmetryReadout(points: readonly SymmetryPoint[], index: number, injuredSide: Side, countUnit: CountUnit, latest: boolean): Readout | null {
  const p = points[index]
  if (!p) return null
  return {
    parts: [
      { value: `${fmt(p.percent)}%`, name: symmetryName(injuredSide).toLowerCase(), mark: 'dot' },
      { value: comparedWords(p, countUnit), name: '', mark: null },
    ],
    when: `${shortDateWords(p.date)}${latest ? ', the latest' : ''}`,
  }
}

/** The y-axis for symmetry: the data and every gate's line, with room up to 100%. */
export function symmetryAxis(points: readonly SymmetryPoint[], refs: readonly SymmetryRef[]): Axis {
  const values = points.map((p) => p.percent)
  const refValues = refs.map((r) => r.percent)
  const lo = Math.min(...values, ...refValues.map((v) => v - 10), 100)
  const hi = Math.max(...values, ...refValues, 100)
  return niceAxis(lo, hi, 4, 0, 1)
}

export function symmetryAria(points: readonly SymmetryPoint[], name: string, injuredSide: Side, refs: readonly SymmetryRef[]): string {
  const other = injuredSide === 'left' ? 'right' : 'left'
  const last = points.at(-1)
  const lines = refs.length > 0 ? `, against reference lines at ${refs.map((r) => `${r.percent}%`).join(' and ')}` : ''
  const latest = last ? `; latest ${fmt(last.percent)}% on ${axisDate(last.date)}` : ''
  return `Line chart of the ${injuredSide} side as a percent of the ${other} side for ${name}, ${points.length} ${points.length === 1 ? 'session' : 'sessions'}${lines}${latest}.`
}

export function symmetryTable(points: readonly SymmetryPoint[], name: string, injuredSide: Side, countUnit: CountUnit): NumbersTable {
  return {
    caption: `${name}: ${symmetryName(injuredSide).toLowerCase()} per session`,
    head: ['Date', symmetryName(injuredSide), 'Compared'],
    rows: [...points].reverse().map((p) => [shortDateWords(p.date), `${fmt(p.percent)}%`, comparedWords(p, countUnit)]),
  }
}

/**
 * The sessions the symmetry line leaves out (symmetryLeftOut), newest first as the table runs, each
 * with its reason: "Tuesday Nov 10 · left out: the sides stepped from different heights (…)".
 */
export function leftOutLines(leftOut: readonly SymmetryLeftOut[]): string[] {
  return [...leftOut].reverse().map((l) => `${shortDateWords(l.date)} · left out: ${l.reason}`)
}

/** Why there is no symmetry line for the exercise on show, in words; `leftOut` counts the sessions logged on both sides but left out. */
export function symmetryEmptyWords(row: ExerciseRow | null, chart: LoadChart | null, injuredSide: Side, leftOut = 0): string {
  if (!row || !chart) return 'Log a session with single-leg work to see this: the injured side as a percent of the other, per session.'
  if (!row.twoSided) return `${row.name} is logged as one set, not one per side, so it has no side-to-side number. Pick a per-side exercise above to see its symmetry.`
  if (leftOut > 0) return `Every session of ${row.name} that logged both sides is left out of the line so far, so there is nothing to draw yet. Each one and why:`
  const sides = chart.lines.filter((l) => l.role !== 'both').map((l) => l.key)
  const only = sides.length === 1 ? ` So far only the ${sides[0]} side is logged.` : ''
  return `Symmetry shows once both sides of ${row.name} are logged in the same session.${only} The ${injuredSide} side is logged first, then the other.`
}

// ---------------------------------------------------------------------------------------------
// 4. Weekly miles
// ---------------------------------------------------------------------------------------------

export interface MilesView {
  weeks: MilesWeek[]
  /** The index of this program week in the plan, or null before or after it. */
  current: number | null
  /** The week the readout opens on: this week, else the nearest end of the plan. */
  opening: number
  anyRuns: boolean
  /** The weeks whose column carries its value: the latest with miles and the extreme. */
  labelAt: number[]
}

export function milesView(plan: readonly MileageWeek[], runs: readonly Run[], startDate: IsoDate, today: IsoDate): MilesView {
  const weeks = milesSeries(plan, runs, startDate)
  const week = weekOf(today, startDate)
  const i = weeks.findIndex((w) => w.week === week)
  const current = i === -1 ? null : i
  const opening = current ?? (week < 1 ? 0 : Math.max(0, weeks.length - 1))
  const withMiles = weeks.map((w, k) => (w.actual > 0 ? k : -1)).filter((k) => k >= 0)
  const latest = withMiles.at(-1)
  const marks = labelledPoints(weeks.map((w) => w.actual))
  const labelAt = latest === undefined ? [] : [latest, ...(marks.extreme !== null && marks.extreme !== latest && (weeks[marks.extreme]?.actual ?? 0) > (weeks[latest]?.actual ?? 0) ? [marks.extreme] : [])]
  return { weeks, current, opening, anyRuns: runs.length > 0, labelAt }
}

export function milesReadout(view: MilesView, index: number): Readout | null {
  const w = view.weeks[index]
  if (!w) return null
  const notes = [w.isDown ? 'deload' : null, view.current === index ? 'this week' : null].filter((n): n is string => n !== null)
  return {
    parts: [
      { value: `${fmt(w.actual)} mi`, name: 'actual', mark: 'column' },
      { value: `${fmt(w.planned)} mi`, name: 'plan', mark: 'plan' },
    ],
    when: [`Week ${w.week}`, ...notes].join(', '),
  }
}

export function milesAria(view: MilesView): string {
  const first = view.weeks[0]?.week ?? 1
  const last = view.weeks.at(-1)?.week ?? first
  const now = view.current === null ? null : view.weeks[view.current]
  const current = now ? `; this week, week ${now.week}, ${fmt(now.actual)} of ${fmt(now.planned)} miles` : ''
  return `Column chart of miles run each week against the plan, weeks ${first} to ${last}${current}.`
}

export function milesTable(view: MilesView): NumbersTable {
  return {
    caption: 'Weekly miles, actual against plan',
    head: ['Week', 'Actual', 'Plan', 'Note'],
    rows: view.weeks.map((w, i) => [String(w.week), `${fmt(w.actual)} mi`, `${fmt(w.planned)} mi`, [w.isDown ? 'deload' : null, view.current === i ? 'this week' : null].filter(Boolean).join(', ')]),
  }
}

// ---------------------------------------------------------------------------------------------
// 5. Weekly training load (metrics phase 1)
// ---------------------------------------------------------------------------------------------

/** A training load as the screen prints it, in words and in the table: rounded, with a thousands separator. */
export function trainingLoadNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/**
 * The ratio as the words print it, to one decimal. Where one decimal would print the line itself on
 * the other side of it (1.53 printed 1.5 but reading high), it says "just over 1.5×" or "just under",
 * so the number never contradicts the word. The band is decided on the exact ratio (src/rules).
 */
export function ratioWords(ratio: number, band: Band): string {
  const printed = Math.round(ratio * 10) / 10
  if (printed === ACUTE_HIGH && ratio !== ACUTE_HIGH) return `just ${band === 'high' ? 'over' : 'under'} ${ACUTE_HIGH}×`
  if (printed === ACUTE_LOW && ratio !== ACUTE_LOW) return `just ${band === 'low' ? 'under' : 'over'} ${ACUTE_LOW}×`
  return `${printed}×`
}

const ACUTE_WORDS = 'the 7 days through yesterday'
const CHRONIC_WORDS = 'the 4 weeks before'

/** The warning: a mark (an arrow and a word, never a color) and its sentence. */
export function trainingLoadWarning(ac: AcuteChronic): { mark: string | null; text: string } {
  if (ac.band === 'too-early') {
    return ac.startsOn === null
      ? { mark: null, text: 'Nothing logged yet. The comparison starts 35 days after the first session or run.' }
      : { mark: null, text: `No comparison yet: it needs 4 weeks logged before ${ACUTE_WORDS}. It starts ${shortDateWords(ac.startsOn)}.` }
  }
  if (ac.band === 'none' || ac.ratio === null || ac.chronicWeek === null) {
    return { mark: null, text: `No training load is counted in ${CHRONIC_WORDS} ${ACUTE_WORDS}, so there is nothing to compare against yet.` }
  }
  const compared = `The 7 days through yesterday carried ${ratioWords(ac.ratio, ac.band)} your average week of ${CHRONIC_WORDS} (${trainingLoadNumber(ac.acute)} against ${trainingLoadNumber(ac.chronicWeek)})`
  if (ac.band === 'high') return { mark: '↑ High', text: `${compared}. A warning only: no session or run changes because of it.` }
  if (ac.band === 'low') return { mark: '↓ Low', text: `${compared}: a drop. A note only: nothing changes because of it.` }
  return { mark: '– Steady', text: `${compared}.` }
}

/** What pushes the ratio, and which way, one sentence each (src/rules' `skews`, in its order). */
export function skewLines(ac: AcuteChronic): string[] {
  return ac.skews.map((skew) => {
    const where = skew.window === 'acute' ? ACUTE_WORDS : CHRONIC_WORDS
    if (skew.why === 'deload') {
      return skew.window === 'acute'
        ? `The 7 days through yesterday include deload days, planned lighter, so the ratio reads ${skew.reads}.`
        : `The 4 weeks before include a deload week, planned lighter, so the ratio reads ${skew.reads}.`
    }
    const n = (skew.window === 'acute' ? ac.notCountedAcute : ac.notCountedChronic).length
    return `${n} ${n === 1 ? 'session' : 'sessions'} in ${where} ${n === 1 ? 'isn’t' : 'aren’t'} counted, so the ratio reads ${skew.reads} than it is.`
  })
}

/** Each session or run not counted, newest first: its day, what it was, what it lacks, and how to add it where that can be done. */
export function notCountedLines(entries: readonly TrainingLoadEntry[], templates: readonly SessionTemplate[]): string[] {
  return entries
    .filter((e) => e.load === null)
    .reverse()
    .map((e) => {
      const what = e.kind === 'workout' ? workoutLabel({ templateId: e.templateId ?? '' }, templates) : runLabel(e.runType ?? 'easy')
      const lacks =
        e.kind === 'run'
          ? 'no time logged'
          : e.missing
              .map((m) => (m === 'rpe' ? 'no RPE (no set rated)' : 'no minutes'))
              .join(' and ')
              .concat(`: add ${e.missing.length === 1 && e.missing[0] === 'rpe' ? 'it' : 'them'} from the session’s summary`)
      return `${shortDateWords(e.date)} · ${what} · ${lacks}`
    })
}

/**
 * This week's HR load (TRIMP) in words, e.g. "HR load this week: 310 (2 of 3 runs had heart
 * rate)" — the denominator counts the week's runs and swaps, the only entries that can carry one
 * (lifts never can: Workout has no HR fields), and the numerator the runs that logged a heart
 * rate, whether or not a load came of it. One with heart rate but no time has no computable load,
 * and the words say so ("1 has no time logged"), as the sRPE side's notCountedLines does: the
 * number printed is then a sum over fewer runs, never a claim that the heart rate wasn't there.
 * Null with no Settings pair, no current week, or no runs this week: nothing is said rather than 0.
 */
export function hrWeekLine(week: Pick<TrainingLoadWeek, 'hrLoad' | 'withHr' | 'hrNotCounted' | 'runs'> | undefined, pair: HrPair | null): string | null {
  if (pair === null || week === undefined || week.runs === 0) return null
  const had = `${week.withHr} of ${week.runs} ${week.runs === 1 ? 'run' : 'runs'} had heart rate`
  const blocked = week.hrNotCounted > 0 ? `; ${week.hrNotCounted} ${week.hrNotCounted === 1 ? 'has' : 'have'} no time logged` : ''
  return `HR load this week: ${trainingLoadNumber(week.hrLoad)} (${had}${blocked})`
}

export interface TrainingLoadView {
  /** Program weeks 1 to 12, or to this week once past 12. */
  weeks: TrainingLoadWeek[]
  /** The index of this program week, or null before the program. */
  current: number | null
  /** The week the readout opens on. */
  opening: number
  /** Any session or run logged at all. */
  any: boolean
  labelAt: number[]
  warning: { mark: string | null; text: string }
  skews: string[]
  notCounted: string[]
  /** Said when an older run's effort word stands in for its RPE. */
  olderRuns: string | null
  /** This week's HR load in words (metrics phase 2); null with no Settings numbers or nothing this week. The warning above reads the sRPE load alone. */
  hrLine: string | null
}

export function trainingLoadView(input: {
  records: readonly WorkoutRecord[]
  runs: readonly Run[]
  startDate: IsoDate
  today: IsoDate
  templates: readonly SessionTemplate[]
  /** The stored heart-rate numbers (metrics phase 2); omitted or null, no HR load is computed anywhere. */
  hrSettings?: HrSettings | null
}): TrainingLoadView {
  const { startDate, today } = input
  const pair = hrPair(input.hrSettings)
  const entries = trainingLoads(input.records, input.runs, pair)
  const week = weekOf(today, startDate)
  const weeks = weeklyTrainingLoads(entries, startDate, Math.max(12, week))
  const i = weeks.findIndex((w) => w.week === week)
  const current = i === -1 ? null : i
  const withLoad = weeks.map((w, k) => (w.load > 0 ? k : -1)).filter((k) => k >= 0)
  const latest = withLoad.at(-1)
  const marks = labelledPoints(weeks.map((w) => w.load))
  const labelAt = latest === undefined ? [] : [latest, ...(marks.extreme !== null && marks.extreme !== latest && (weeks[marks.extreme]?.load ?? 0) > (weeks[latest]?.load ?? 0) ? [marks.extreme] : [])]
  const ac = acuteChronic(entries, today, startDate)
  return {
    weeks,
    current,
    opening: current ?? (week < 1 ? 0 : Math.max(0, weeks.length - 1)),
    any: entries.length > 0,
    labelAt,
    warning: trainingLoadWarning(ac),
    skews: skewLines(ac),
    notCounted: notCountedLines(
      entries.filter((e) => weekOf(e.date, startDate) >= 1),
      input.templates,
    ),
    olderRuns: entries.some((e) => e.rpeSource === 'word') ? 'Runs logged before effort was rated 1 to 10 read their effort word as RPE 3, 5 or 8.' : null,
    hrLine: hrWeekLine(current === null ? undefined : weeks[current], pair),
  }
}

const weekNotes = (view: TrainingLoadView, index: number, w: TrainingLoadWeek) =>
  [w.isDeload ? 'deload' : null, view.current === index ? 'this week' : null].filter((n): n is string => n !== null)

export function trainingLoadReadout(view: TrainingLoadView, index: number): Readout | null {
  const w = view.weeks[index]
  if (!w) return null
  const counts = [w.sessions > 0 ? `${w.sessions} counted` : null, w.notCounted > 0 ? `${w.notCounted} not counted` : null].filter((n): n is string => n !== null)
  return { parts: [{ value: trainingLoadNumber(w.load), name: 'training load', mark: 'column' }], when: [`Week ${w.week}`, ...counts, ...weekNotes(view, index, w)].join(', ') }
}

export function trainingLoadAria(view: TrainingLoadView): string {
  const first = view.weeks[0]?.week ?? 1
  const last = view.weeks.at(-1)?.week ?? first
  const now = view.current === null ? null : view.weeks[view.current]
  const current = now ? `; this week, week ${now.week}, ${trainingLoadNumber(now.load)}` : ''
  return `Column chart of training load, RPE times minutes, each week, weeks ${first} to ${last}${current}.`
}

export function trainingLoadTable(view: TrainingLoadView): NumbersTable {
  return {
    caption: 'Weekly training load, RPE times minutes',
    head: ['Week', 'Training load', 'Counted', 'Not counted', 'Note'],
    rows: view.weeks.map((w, i) => [String(w.week), trainingLoadNumber(w.load), String(w.sessions), String(w.notCounted), weekNotes(view, i, w).join(', ')]),
  }
}

// ---------------------------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------------------------

export interface ExerciseView {
  row: ExerciseRow
  exercise: Exercise | null
  chart: LoadChart
  /** `symmetrySeries` for a two-sided exercise; empty for one logged as one set. */
  symmetry: SymmetryPoint[]
  /** The sessions logged on both sides that the line leaves out, newest first, in words (leftOutLines). */
  leftOut: string[]
}

export interface ProgressView {
  clean: CleanDaysView
  exercises: ExerciseRow[]
  refs: SymmetryRef[]
  miles: MilesView
  training: TrainingLoadView
  records: WorkoutRecord[]
}

/** Everything the screen shows that doesn't depend on the exercise picked. */
export function progressView(input: { today: IsoDate; settings: Settings; history: HistoryLike; program: ProgramLike; hrSettings?: HrSettings | null }): ProgressView {
  const { today, settings, history, program } = input
  const records = attachChecks(history.workouts, history.setLogs, history.morningChecks)
  const readings = subjectReadings(records, history.runs, history.morningChecks, settings.injuredSide)
  return {
    clean: cleanDaysView({ readings, today, records, runs: history.runs, checks: history.morningChecks, templates: program.templates }),
    exercises: loggedExercises(records, program.exercises),
    refs: symmetryRefs(program.gates),
    miles: milesView(program.mileagePlan, history.runs, settings.startDate, today),
    training: trainingLoadView({ records, runs: history.runs, startDate: settings.startDate, today, templates: program.templates, hrSettings: input.hrSettings ?? null }),
    records,
  }
}

/** The picked exercise's charts. */
export function exerciseView(input: { records: readonly WorkoutRecord[]; setLogs: readonly SetLog[]; row: ExerciseRow; injuredSide: Side; catalog: readonly Exercise[] }): ExerciseView {
  const { records, row, injuredSide } = input
  const chart = loadChart(loadSeries(records, row.id), injuredSide, countUnitFor(input.setLogs, row.id))
  return {
    row,
    exercise: input.catalog.find((e) => e.id === row.id) ?? null,
    chart,
    symmetry: row.twoSided ? symmetrySeries(records, row.id, injuredSide) : [],
    leftOut: row.twoSided ? leftOutLines(symmetryLeftOut(records, row.id, injuredSide)) : [],
  }
}
