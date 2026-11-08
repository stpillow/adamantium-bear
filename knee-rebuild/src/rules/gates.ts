import type { AclRsiEntry, Gate, GateItem, GateTest, IsoDate, MorningCheck, Run, SetLog, Workout } from '../schema/index.ts'
import { aclRsiScore, latestAclRsiEntry } from './aclRsi.ts'
import { addDays } from './calendar.ts'
import type { SubjectReading } from './history.ts'
import { isSwap } from './mileage.ts'
import { morningCheckApplies, morningReading } from './reading.ts'
import { bestOfTrials, fastestOfTrials, meetsSymmetry, meetsTimedSymmetry, symmetryPercent, timedSymmetryPercent } from './unilateral.ts'

export interface GateContext {
  today: IsoDate
  injuredSide: 'left' | 'right'
  /** Every finished workout's and run's reading, dated. */
  readings: readonly SubjectReading[]
  gateTests: readonly GateTest[]
  morningChecks: readonly MorningCheck[]
  runs: readonly Run[]
  workouts: readonly Workout[]
  setLogs: readonly SetLog[]
  /** Which catalog exercises count as the single-leg calf raise. */
  calfRaiseExerciseIds: readonly string[]
  /**
   * The stored ACL-RSI entries (Batch A): handed over explicitly, never through History, so the
   * gates rule stays the questionnaire's one rule-level reader (src/rules/aclRsi.guard.test.ts).
   */
  aclRsiEntries: readonly AclRsiEntry[]
}

export interface GateItemResult {
  item: GateItem
  pass: boolean
  detail: string
  /** Clean weeks only: the readings in the window that aren't clean, oldest first, so a screen can name each one. */
  misses?: SubjectReading[]
}

export interface GateResult {
  gate: Gate
  items: GateItemResult[]
  /** Every item passes. The phase still advances only when Shawn confirms. */
  passes: boolean
}

export const DEFAULT_WINDOW_DAYS = 14

function inWindow(date: IsoDate, today: IsoDate, windowDays: number): boolean {
  return date > addDays(today, -windowDays) && date <= today
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Gate tests in the order they were written: by date, then by id. Ids lead with the write's ISO
 * stamp (the Gates screen's newGateTestId), so a tick and an untick on the same day keep their
 * order whatever order the tests are handed over in, and "the latest test wins" (the M5 brief)
 * means the last one written.
 */
export function inWriteOrder(tests: readonly GateTest[]): GateTest[] {
  return [...tests].sort((a, b) => a.date.localeCompare(b.date) || byId(a.id, b.id))
}

function latestTest(tests: readonly GateTest[], gate: number, item: string, manual: boolean): GateTest | undefined {
  return inWriteOrder(tests.filter((t) => t.gate === gate && t.item === item && t.manual === manual)).at(-1)
}

/**
 * Two clean weeks. A rack-capped workout that read clean is left out: it neither counts as clean nor
 * breaks the streak, and it is not a session for "both weeks"; a capped hold or back-off still
 * breaks it (Shawn's Nov 2 answer, PROGRAM-QUESTIONS 73).
 */
function cleanWeeks(item: GateItem, ctx: GateContext): GateItemResult {
  const window = item.windowDays ?? DEFAULT_WINDOW_DAYS
  const inRange = ctx.readings.filter((r) => inWindow(r.date, ctx.today, window))
  const leftOut = inRange.filter((r) => r.rackCapped === true && r.result === 'clean').length
  const recent = inRange.filter((r) => !(r.rackCapped === true && r.result === 'clean'))
  const half = addDays(ctx.today, -Math.floor(window / 2))
  const firstHalf = recent.filter((r) => r.date <= half)
  const secondHalf = recent.filter((r) => r.date > half)
  const bad = recent.filter((r) => r.result !== 'clean')
  const left = leftOut === 0 ? '' : `${leftOut} rack-capped session${leftOut === 1 ? '' : 's'} left out`
  if (bad.length > 0) {
    const misses = [...bad].sort((a, b) => a.date.localeCompare(b.date))
    return { item, pass: false, detail: `${bad.length} of ${recent.length} readings in the last ${window} days read ${bad.map((b) => b.result).join(', ')}${left && ` (${left})`}`, misses }
  }
  if (firstHalf.length === 0 || secondHalf.length === 0) return { item, pass: false, detail: `needs sessions in both of the last two weeks (${recent.length} readings so far${left && `, ${left}`})` }
  return { item, pass: true, detail: `${recent.length} readings in the last ${window} days, all clean${left && ` (${left})`}` }
}

function symmetry(item: GateItem, gate: Gate, ctx: GateContext): GateItemResult {
  const test = item.testItem ? latestTest(ctx.gateTests, gate.number, item.testItem, false) : undefined
  const threshold = item.threshold ?? 0.9
  if (!test) return { item, pass: false, detail: 'no test entered yet' }
  if (item.timed) return timedSymmetry(item, test, threshold)
  const injured = test.trialsInjured?.length ? bestOfTrials(test.trialsInjured) : test.valueInjured
  const other = test.trialsOther?.length ? bestOfTrials(test.trialsOther) : test.valueOther
  const pct = symmetryPercent(injured, other)
  const pass = meetsSymmetry(injured, other, threshold)
  return { item, pass, detail: pct === null ? 'cannot compute: the other side is 0' : `${pct}% (${injured} vs ${other}) against a ${threshold * 100}% line, tested ${test.date}` }
}

/**
 * A timed hop (Batch A, PROGRAM-QUESTIONS 157): seconds, lower is better, so best = the FASTEST
 * positive trial and the line reads other ÷ injured — a slower injured side reads under 100%.
 * A hop he couldn't do has no time: 0 and non-positive values are ignored (`fastestOfTrials`),
 * and a side with no usable time fails in words rather than dividing by 0. The stored `value*`
 * fields stand in only when a test somehow carries no trials, and only when positive.
 */
function timedSymmetry(item: GateItem, test: GateTest, threshold: number): GateItemResult {
  const injured = test.trialsInjured?.length ? fastestOfTrials(test.trialsInjured) : test.valueInjured > 0 ? test.valueInjured : null
  const other = test.trialsOther?.length ? fastestOfTrials(test.trialsOther) : test.valueOther > 0 ? test.valueOther : null
  if (injured === null) return { item, pass: false, detail: `no usable time on the injured side, tested ${test.date}` }
  if (other === null) return { item, pass: false, detail: `no usable time on the other side, tested ${test.date}` }
  const pct = timedSymmetryPercent(injured, other)
  const pass = meetsTimedSymmetry(injured, other, threshold)
  return { item, pass, detail: `${pct}% (other ${other} s over injured ${injured} s) against a ${threshold * 100}% line, tested ${test.date}` }
}

/**
 * The ACL-RSI item (Batch A, PROGRAM-QUESTIONS 156): the latest stored questionnaire entry's
 * score against the item's line (76, the strict published threshold), read the way the hop items
 * read their latest tests. No entry fails in words; nothing is ever estimated.
 */
function aclRsi(item: GateItem, ctx: GateContext): GateItemResult {
  const entry = latestAclRsiEntry(ctx.aclRsiEntries)
  const line = item.minScore ?? 76
  if (!entry) return { item, pass: false, detail: 'no questionnaire entered yet' }
  const score = aclRsiScore(entry)
  return { item, pass: score >= line, detail: `scored ${score} on ${entry.date}; the line is ${line}` }
}

function calfRaises(item: GateItem, ctx: GateContext): GateItemResult {
  const window = item.windowDays ?? DEFAULT_WINDOW_DAYS
  const minReps = item.minReps ?? 20
  const dates = new Map(ctx.workouts.map((w) => [w.id, w.date]))
  const sets = ctx.setLogs.filter((s) => {
    const date = dates.get(s.workoutId)
    return date !== undefined && inWindow(date, ctx.today, window) && ctx.calfRaiseExerciseIds.includes(s.exerciseId) && (s.reps ?? 0) >= minReps
  })
  const left = sets.some((s) => s.side === 'left')
  const right = sets.some((s) => s.side === 'right')
  if (left && right) return { item, pass: true, detail: `a set of ${minReps} or more on each side in the last ${window} days` }
  return { item, pass: false, detail: `${minReps}+ reps logged on ${left ? 'left only' : right ? 'right only' : 'neither side'} in the last ${window} days` }
}

function noSwelling(item: GateItem, ctx: GateContext, needsPlyo: boolean): GateItemResult {
  const window = item.windowDays ?? DEFAULT_WINDOW_DAYS
  const checks = ctx.morningChecks.filter((c) => inWindow(c.date, ctx.today, window))
  const swollen = checks.filter((c) => c.visibleSwelling)
  if (checks.length === 0) return { item, pass: false, detail: `no morning checks in the last ${window} days` }
  if (swollen.length > 0) return { item, pass: false, detail: `swelling flagged on ${swollen.map((c) => c.date).join(', ')}` }
  if (needsPlyo) {
    const plyo = ctx.workouts.filter((w) => w.status === 'finished' && w.phase === 3 && /-(a|c)$/.test(w.templateId) && inWindow(w.date, ctx.today, window))
    if (plyo.length === 0) return { item, pass: false, detail: `no Phase 3 A or C session in the last ${window} days` }
    return { item, pass: true, detail: `${plyo.length} plyo sessions and ${checks.length} morning checks in the last ${window} days, no swelling` }
  }
  return { item, pass: true, detail: `${checks.length} morning checks in the last ${window} days, no swelling` }
}

function runNoReaction(item: GateItem, ctx: GateContext): GateItemResult {
  const minMiles = item.minMiles ?? 4
  const qualifying = ctx.runs.filter((r) => !isSwap(r) && r.miles >= minMiles)
  const clean = qualifying.find((run) => {
    const subject = { kind: 'run' as const, id: run.id, date: run.date }
    const check = ctx.morningChecks.find((c) => c.appliesTo?.kind === 'run' && c.appliesTo.id === run.id) ?? ctx.morningChecks.find((c) => morningCheckApplies(c, subject))
    return check !== undefined && morningReading(check).result === 'clean' && run.maxPain <= 3
  })
  if (clean) return { item, pass: true, detail: `${clean.miles} miles on ${clean.date} with a clean morning after` }
  if (qualifying.length === 0) return { item, pass: false, detail: `no run of ${minMiles} miles or more yet` }
  return { item, pass: false, detail: `${qualifying.length} runs of ${minMiles}+ miles, none with a clean morning check after` }
}

function manual(item: GateItem, gate: Gate, ctx: GateContext): GateItemResult {
  const test = latestTest(ctx.gateTests, gate.number, item.id, true)
  if (!test) return { item, pass: false, detail: 'not ticked' }
  return { item, pass: test.pass, detail: test.pass ? `ticked ${test.date}` : `unticked ${test.date}` }
}

/** Rule 8: evaluate every item of a gate from logged data and manual toggles. */
export function evaluateGate(gate: Gate, ctx: GateContext): GateResult {
  const items = gate.items.map((item) => {
    switch (item.evaluator) {
      case 'clean-weeks':
        return cleanWeeks(item, ctx)
      case 'symmetry':
        return symmetry(item, gate, ctx)
      case 'calf-raises':
        return calfRaises(item, ctx)
      case 'no-swelling':
        return noSwelling(item, ctx, false)
      case 'no-swelling-after-plyo':
        return noSwelling(item, ctx, true)
      case 'run-no-reaction':
        return runNoReaction(item, ctx)
      case 'acl-rsi':
        return aclRsi(item, ctx)
      case 'manual':
        return manual(item, gate, ctx)
    }
  })
  return { gate, items, passes: items.every((i) => i.pass) }
}
