import type { History } from '../db/repo.ts'
import { evaluateGate, inWriteOrder, type GateContext, type GateItemResult, type GateResult } from '../rules/gates.ts'
import { attachChecks, subjectReadings, type SubjectReading, type WorkoutRecord } from '../rules/history.ts'
import { onTimeChecks } from '../rules/lateCheck.ts'
import { weekOf } from '../rules/calendar.ts'
import { locationOrHome } from '../rules/locations.ts'
import { withAddedSlots } from '../rules/addedSlots.ts'
import { applyToTemplate, overridesBySlot } from '../rules/overrides.ts'
import { advanceWaitsFor, awaitingMorningCheck, loadTestPrefill, phaseEntryWeek, type LoadTestPrefill, type LoadTestSession } from '../rules/progress.ts'
import { lateFlagNotes, progressionSuspended, stopMessage, type RedFlagState } from '../rules/redFlags.ts'
import { phaseLogsBothSides, phaseRunsExercise } from '../rules/session.ts'
import { bestOfTrials, fastestOfTrials, meetsSymmetry, meetsTimedSymmetry, symmetryPercent, timedSymmetryPercent } from '../rules/unilateral.ts'
import type { AclRsiEntry, Exercise, Gate, GateItem, GateTest, IsoDate, Location, Phase, Program, SessionTemplate, Settings, Side } from '../schema/index.ts'
import { lateFlagWords } from './MorningCheck.helpers.ts'
import { dateWords, runLabel, shortDateWords, workoutLabel } from './Today.helpers.ts'

/**
 * Pure helpers for the Gates screen: the context the gate rule reads, assembled from what is
 * logged; the words for each item's state and detail; the symmetry entry forms (best of the trials,
 * the live percent against the gate's line, the prefill from logged sets); the tests the screen
 * writes; and whether the phase may advance. Every verdict comes from src/rules (evaluateGate,
 * meetsSymmetry, symmetryPercent, bestOfTrials, progressionSuspended, loadTestPrefill); this file only
 * composes the answers and names them. The program pieces are passed in, so tests use fixtures.
 */

export type HistoryLike = Pick<History, 'workouts' | 'setLogs' | 'morningChecks' | 'runs' | 'gateTests' | 'sessionMoves' | 'programOverrides' | 'addedSlots'>
export type ProgramLike = Pick<Program, 'gates' | 'phases' | 'exercises' | 'redFlags' | 'templates' | 'weeklyTemplate'>

/** Which catalog exercises count as the single-leg calf raise for gate 2 (the M5 brief). */
export const CALF_RAISE_EXERCISE_IDS: readonly string[] = ['single-leg-calf-raise-step']

/** Generous ceilings: a triple hop runs past 200 in., a single-leg press stack past 300 lb; a 6-meter hop is 1.5 to 3 s, so 60 s is far past any real trial. */
export const TRIAL_MAX_IN = 600
export const TRIAL_MAX_S = 60
export const LOAD_MAX = 1000

/** The line a symmetry item reads against, as evaluateGate reads it (every seeded item states its own). */
export function lineOf(item: Pick<GateItem, 'threshold'>): number {
  return item.threshold ?? 0.9
}

/** "90%": a gate line in words. */
export function lineWords(threshold: number): string {
  return `${Math.round(threshold * 1000) / 10}%`
}

const otherSide = (side: Side): Side => (side === 'left' ? 'right' : 'left')
const SIDE_WORD: Record<Side, string> = { left: 'Left', right: 'Right' }

/** The two sides as the forms name them: "Right · injured" and "Left". */
export function sideNames(injuredSide: Side): { injured: string; other: string } {
  return { injured: `${SIDE_WORD[injuredSide]} · injured`, other: SIDE_WORD[otherSide(injuredSide)] }
}

/**
 * Gate tests in the order they were written: by date, then by id, the gate rule's own order
 * (inWriteOrder), so the screen's lists and the rule's "latest test" never disagree.
 */
export const orderedTests: (tests: readonly GateTest[]) => GateTest[] = inWriteOrder

/** A new test's id: the write's ISO stamp and the item key, with a suffix if that is somehow taken. */
export function newGateTestId(stamp: string, key: string, taken: readonly string[]): string {
  const base = `gate-test-${stamp}-${key}`
  if (!taken.includes(base)) return base
  let n = 2
  while (taken.includes(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/**
 * Everything evaluateGate reads, from what is logged: no field here is typed in on the Gates
 * screen except the tests. The ACL-RSI entries come in explicitly (the calfRaiseExerciseIds
 * pattern), never through History, so the gates rule stays their one rule-level reader
 * (src/rules/aclRsi.guard.test.ts).
 */
export function gateContext(input: { today: IsoDate; settings: Pick<Settings, 'injuredSide'>; history: HistoryLike; aclRsiEntries: readonly AclRsiEntry[] }): GateContext {
  const { today, settings, history } = input
  // Sessions read with on-time checks only (PROGRAM-QUESTIONS 176): a clean late check clears no gate item.
  const onTime = onTimeChecks(history.morningChecks)
  return {
    today,
    injuredSide: settings.injuredSide,
    readings: subjectReadings(attachChecks(history.workouts, history.setLogs, onTime), history.runs, onTime, settings.injuredSide),
    gateTests: orderedTests(history.gateTests),
    morningChecks: history.morningChecks,
    runs: history.runs,
    workouts: history.workouts,
    setLogs: history.setLogs,
    calfRaiseExerciseIds: CALF_RAISE_EXERCISE_IDS,
    aclRsiEntries: input.aclRsiEntries,
  }
}

/** The gate out of the current phase: the one whose fromPhase is it. None in Phase 4. */
export function currentGate(gates: readonly Gate[], currentPhase: number): Gate | null {
  return gates.find((g) => g.fromPhase === currentPhase) ?? null
}

/** "3 of 4 items pass". */
export function passCountWords(result: { items: readonly { pass: boolean }[] }): string {
  const total = result.items.length
  const n = result.items.filter((i) => i.pass).length
  return `${n} of ${total} ${total === 1 ? 'item' : 'items'} ${n === 1 ? 'passes' : 'pass'}`
}

/** An item's state as a mark and a word, so it reads without color. */
export function stateWords(pass: boolean): { mark: string; word: string } {
  return pass ? { mark: '✓', word: 'Passes' } : { mark: '○', word: 'Not yet' }
}

function dateInWords(date: string): string {
  try {
    return shortDateWords(date)
  } catch {
    return date
  }
}

/** The rule's detail as a sentence: dates in words, "an 80% line", a capital, a full stop. */
export function detailWords(detail: string): string {
  const dated = detail
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, dateInWords)
    .replace(/\ba (8\d(?:\.\d+)?%)/g, 'an $1')
    .trim()
  if (dated.length === 0) return ''
  const sentence = dated.charAt(0).toUpperCase() + dated.slice(1)
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
}

const RESULT_WORD: Record<SubjectReading['result'], string> = { clean: 'Clean', hold: 'Hold', 'back-off': 'Back off' }

/** "Session A", "Run: long": what a reading was of. */
function readingLabel(reading: Pick<SubjectReading, 'kind' | 'id'>, history: Pick<HistoryLike, 'workouts' | 'runs'>, templates: ProgramLike['templates']): string {
  if (reading.kind === 'run') {
    const run = history.runs.find((r) => r.id === reading.id)
    return run ? runLabel(run.type) : 'A run'
  }
  const workout = history.workouts.find((w) => w.id === reading.id)
  return workout ? workoutLabel(workout, templates) : 'A session'
}

/**
 * The clean-weeks detail with each reading that isn't clean named: "Hold on Tuesday Nov 17
 * (Session A).", as Progress names the last one; and a reading that is hold only because its
 * morning check is still due (awaitingMorningCheck) says so, with what to do: "Saturday Nov 21’s
 * Session A reads hold until its morning check is in; log it to count." The gate still reads it as
 * hold until then (rule 3, PROGRAM-QUESTIONS 109).
 */
export function cleanWeeksWords(detail: string, misses: readonly SubjectReading[], input: { today: IsoDate; history: HistoryLike; templates: ProgramLike['templates'] }): string {
  const named = misses.map((m) => {
    const label = readingLabel(m, input.history, input.templates)
    const when = dateInWords(m.date)
    if (awaitingMorningCheck(m, input.history.morningChecks, input.today)) return `${when}’s ${label} reads hold until its morning check is in; log it to count.`
    return `${RESULT_WORD[m.result]} on ${when} (${label}).`
  })
  return [detailWords(detail), ...named].join(' ')
}

// ---------------------------------------------------------------------------------------------
// Symmetry entry
// ---------------------------------------------------------------------------------------------

/** The session a load form opens on: loadTestPrefill's pick (src/rules/progress.ts). */
export type LoadPrefill = LoadTestSession

/**
 * One value in a form: a trial or a load, or null when it isn't entered. A hop trial of 0 is a
 * trial (he couldn't hop), not a blank (PROGRAM-QUESTIONS 108); the Stepper can only show numbers,
 * so not entered lives here.
 */
export type Trial = number | null

/** One side's values: the trials of a hop test, or the one value of a load test. */
export interface SymmetryForm {
  injured: Trial[]
  other: Trial[]
}

/** Each side's best so far; null when nothing is entered on that side. */
export interface FormBest {
  injured: number | null
  other: number | null
}

/** A fresh form: every trial not entered for a hop test, else the prefill's loads (not entered with nothing to prefill from). */
export function openForm(trials: number | null, prefill: Pick<LoadPrefill, 'injured' | 'other'> | null): SymmetryForm {
  if (trials !== null) return { injured: Array.from({ length: trials }, () => null), other: Array.from({ length: trials }, () => null) }
  return { injured: [prefill?.injured ?? null], other: [prefill?.other ?? null] }
}

/** A load form's opening: the values it shows with nothing typed, and whether they are a saved test's (Save then waits). */
export interface LoadOpening {
  form: SymmetryForm
  saved: boolean
}

/**
 * What a load test's form opens on when nothing is typed: its last saved test, when that is at
 * least as new as the session the prefill reads, else the prefill, else not entered. Opened on the
 * test, the form counts as saved, so Save waits until a value changes: coming back to Gates, one
 * tap can't write an older session's loads as a newer test that wins (PROGRAM-QUESTIONS 118).
 */
export function openLoadForm(prefill: Pick<LoadPrefill, 'date' | 'injured' | 'other'> | null, latest: Pick<GateTest, 'date' | 'valueInjured' | 'valueOther'> | null): LoadOpening {
  if (latest && (!prefill || latest.date >= prefill.date)) return { form: { injured: [latest.valueInjured], other: [latest.valueOther] }, saved: true }
  return { form: openForm(null, prefill), saved: false }
}

/** The form with one value changed; null takes it back to not entered. */
export function setValue(form: SymmetryForm, side: 'injured' | 'other', index: number, value: Trial): SymmetryForm {
  const values = form[side].map((v, i) => (i === index ? value : v))
  return { ...form, [side]: values }
}

/** The values a side has entered, in order: what a saved test stores as its trials. */
export function enteredValues(values: readonly Trial[]): number[] {
  return values.filter((v): v is number => v !== null)
}

function bestEntered(values: readonly Trial[], timed = false): number | null {
  const entered = enteredValues(values)
  if (entered.length === 0) return null
  return timed ? Math.min(...entered) : bestOfTrials(entered)
}

/**
 * Each side's best: the best of the entered trials for a hop test (bestOfTrials; the FASTEST —
 * lowest — for a timed hop, an entered 0 included so the zero-refusal words can point at it),
 * the one value otherwise.
 */
export function formBest(form: SymmetryForm, timed = false): FormBest {
  return { injured: bestEntered(form.injured, timed), other: bestEntered(form.other, timed) }
}

/**
 * Where Enter puts a value that isn't entered yet: a distance hop trial at 0, since 0 is a trial
 * (a hop he couldn't do, PROGRAM-QUESTIONS 108); a TIMED hop trial at 1 s, never 0 — 0 isn't a
 * time and the form refuses it (PROGRAM-QUESTIONS 157); a load at the exercise's first step,
 * since a load test needs a load on each side and 0 lb can't be saved.
 */
export function enterStart(entry: { trials: number | null; step: number; timed?: boolean }): number {
  if (entry.timed) return 1
  return entry.trials !== null ? 0 : entry.step
}

/**
 * A hop trial's full name, with its side: "Right · injured, trial 1". The screen shows "Trial 1"
 * under the side's legend, and every control of the trial (Enter, Clear, the field, up and down)
 * carries the side, so a screen reader never meets two "Trial 1"s on one item.
 */
export function trialName(sideName: string, index: number): string {
  return `${sideName}, trial ${index + 1}`
}

/** The Clear button's name: "Clear left, trial 1: back to not entered". */
export function clearWords(name: string): string {
  return `Clear ${name.toLowerCase()}: back to not entered`
}

/** The Enter button's name: "Enter right · injured, starting at 5 lb", "Enter trial 1, starting at 0 in". */
export function enterWords(label: string, start: number, unit: string): string {
  return `Enter ${label.toLowerCase()}, starting at ${start} ${unit}`
}

/**
 * A side's best, kept and shown: "Best 56 in" ("Best 0 in" when he couldn't hop), or that nothing
 * is entered yet; a timed hop says "Fastest 2.1 s", since its best is the lowest time.
 */
export function bestWords(best: number | null, unit: string, timed = false): string {
  const word = timed ? 'Fastest' : 'Best'
  return best === null ? `${word}: nothing entered yet` : `${word} ${best} ${unit}`
}

/** Why a load test with a 0 on a side can't save: the line and the Save button say the same. */
export const ZERO_LOAD_BLOCKER = 'A load test needs a load on each side, so 0 can’t be saved'

/** Why a timed hop with a 0 on a trial can't save: 0 isn't a time (PROGRAM-QUESTIONS 157 rereads 108 for seconds). */
export const ZERO_TIME_BLOCKER = 'A time reads in seconds; 0 isn’t a time — leave the trial empty if the hop didn’t happen'

/**
 * The live symmetry against the gate's line, from the two bests: "90.3% · the line is 90%: passes".
 * On a distance hop test 0 on the injured side reads 0%, and 0 on the other side is no percent at
 * all, and the line says so. On a load test (`loadTest`) a 0 on either side can't be saved, so the
 * line says what Save says rather than a percent beside a refusal. On a TIMED hop (`timed`) the
 * ratio inverts — the other side's time over the injured side's — and a 0 isn't a time, so the
 * line carries the zero-refusal words instead of the distance hops' "0 reads 0%" sentence.
 */
export function symmetryLine(best: FormBest, threshold: number, loadTest = false, timed = false): string {
  const { injured, other } = best
  if (injured === null && other === null) return 'Enter both sides to see the symmetry.'
  if (injured === null) return 'Enter the injured side to see the symmetry.'
  if (other === null) return 'Enter the other side to see the symmetry.'
  if (timed) {
    if (!(injured > 0 && other > 0)) return `${ZERO_TIME_BLOCKER}.`
    const inverted = timedSymmetryPercent(injured, other)
    return `${inverted}% · the line is ${lineWords(threshold)}: ${meetsTimedSymmetry(injured, other, threshold) ? 'passes' : 'not yet'}`
  }
  if (loadTest && !(injured > 0 && other > 0)) return `${ZERO_LOAD_BLOCKER}.`
  const pct = symmetryPercent(injured, other)
  if (pct === null) return injured === 0 ? 'Both sides are 0, so there is no percent.' : 'The other side is 0, so there is no percent.'
  return `${pct}% · the line is ${lineWords(threshold)}: ${meetsSymmetry(injured, other, threshold) ? 'passes' : 'not yet'}`
}

/**
 * The line over a hop form's trials: what counts, and what a 0 means there. Distance hops keep
 * the "0 is a hop he couldn't do" reading (PROGRAM-QUESTIONS 108); the timed hop replaces it with
 * the zero-refusal words and says the ratio's direction (PROGRAM-QUESTIONS 157).
 */
export function trialsIntro(entry: Pick<SymmetryEntry, 'trials' | 'timed'>): string {
  const trials = entry.trials ?? 3
  if (entry.timed) {
    return `Up to ${trials} trials per side, in seconds to a tenth; the fastest of each side counts, and the line reads the other side’s time over the injured side’s, so a slower injured side reads under 100%. ${ZERO_TIME_BLOCKER}.`
  }
  return `Up to ${trials} trials per side, in inches; the best of each side counts, and one trial a side is enough to save. A hop you couldn’t do is 0; a trial left not entered doesn’t count.`
}

/** Two forms hold the same values, side by side and trial by trial (not entered included). */
export function sameForm(a: SymmetryForm, b: SymmetryForm): boolean {
  const same = (x: readonly Trial[], y: readonly Trial[]) => x.length === y.length && x.every((v, i) => v === y[i])
  return same(a.injured, b.injured) && same(a.other, b.other)
}

/** Why Save waits right after a save: the form still holds the test just written. */
export const SAVED_BLOCKER = 'Saved; change a value to save another'

/**
 * Why the form can't be saved yet, in words, or null when it can. A distance hop test saves with
 * at least one trial entered on each side, a 0 included (Shawn, Nov 2), but not when the other
 * side's best is 0: that is no percent. A TIMED hop refuses a 0 anywhere — 0 isn't a time
 * (PROGRAM-QUESTIONS 157) — and saves with a positive time on each side. A load test needs a load
 * on each side. Right after a save the form keeps what was saved (`lastSaved`), and Save waits
 * until a value changes, so a second tap never writes the same test twice, or a prefill no test
 * lifted.
 */
export function formBlocker(form: SymmetryForm, trials: number | null, lastSaved: SymmetryForm | null = null, timed = false): string | null {
  if (lastSaved && sameForm(form, lastSaved)) return SAVED_BLOCKER
  const best = formBest(form, timed)
  if (timed) {
    if ([...form.injured, ...form.other].some((v) => v !== null && !(v > 0))) return ZERO_TIME_BLOCKER
    if (best.injured === null || best.other === null) return 'Enter at least one trial on each side to save'
    return null
  }
  if (trials !== null) {
    if (best.injured === null || best.other === null) return 'Enter at least one trial on each side to save'
    if (symmetryPercent(best.injured, best.other) === null) return best.injured === 0 ? 'Both sides are 0, so there is no percent to save' : 'The other side is 0, so there is no percent to save'
    return null
  }
  if (best.injured === null || best.other === null) return 'Enter both sides to save'
  if (!(best.injured > 0) || !(best.other > 0)) return ZERO_LOAD_BLOCKER
  return null
}

export type TestDraft = { ok: true; test: GateTest } | { ok: false; blocker: string }

/**
 * The GateTest a symmetry form saves: the best of each side as the values (the fastest for a
 * timed hop), the entered trials when the item has trials (a trial not entered isn't stored),
 * the optional one-line "how it looked" note on hop tests — quality is noted in words, never
 * pretended to be measured — and the pass from meetsSymmetry (meetsTimedSymmetry for a timed
 * item) against the item's line. Never manual.
 */
export function buildTest(input: { gate: Pick<Gate, 'number'>; item: GateItem; form: SymmetryForm; today: IsoDate; id: string; lastSaved?: SymmetryForm | null; note?: string }): TestDraft {
  const { gate, item, form, today, id } = input
  if (!item.testItem) return { ok: false, blocker: 'This item has no test key in the program data' }
  const trials = item.trials ?? null
  const timed = item.timed === true
  const blocker = formBlocker(form, trials, input.lastSaved ?? null, timed)
  if (blocker) return { ok: false, blocker }
  const { injured, other } = formBest(form, timed)
  // formBlocker has already said no to a side with nothing entered; this only narrows the types.
  if (injured === null || other === null) return { ok: false, blocker: 'Enter both sides to save' }
  const note = input.note?.trim() ?? ''
  return {
    ok: true,
    test: {
      id,
      date: today,
      gate: gate.number,
      item: item.testItem,
      valueInjured: injured,
      valueOther: other,
      ...(trials !== null ? { trialsInjured: enteredValues(form.injured), trialsOther: enteredValues(form.other) } : {}),
      ...(trials !== null && note !== '' ? { notes: note } : {}),
      pass: timed ? meetsTimedSymmetry(injured, other, lineOf(item)) : meetsSymmetry(injured, other, lineOf(item)),
      manual: false,
    },
  }
}

/** A manual item's toggle: a new test each time, the latest wins; unticking writes pass false. */
export function manualTest(input: { gate: Pick<Gate, 'number'>; item: Pick<GateItem, 'id'>; pass: boolean; today: IsoDate; id: string }): GateTest {
  return { id: input.id, date: input.today, gate: input.gate.number, item: input.item.id, valueInjured: 0, valueOther: 0, pass: input.pass, manual: true }
}

export interface EarlierTest {
  id: string
  when: string
  percent: string
  values: string
  pass: boolean
  word: string
  /** The "how it looked" note the test carried, or null: words beside the numbers, never a measurement. */
  note: string | null
}

/**
 * The item's tests so far, newest first: date, percent, the values compared, whether it reached
 * the line, and the note it carried. A timed item recomputes with the inverted direction: the
 * fastest of each side, the other side's time over the injured side's.
 */
export function earlierTests(tests: readonly GateTest[], gate: number, key: string, threshold: number, unit: string, timed = false): EarlierTest[] {
  return orderedTests(tests.filter((t) => t.gate === gate && t.item === key && !t.manual))
    .reverse()
    .map((t) => {
      const base = (word: { percent: string; pass: boolean }, injured: number, other: number): EarlierTest => ({
        id: t.id,
        when: dateInWords(t.date),
        percent: word.percent,
        values: `${injured} vs ${other} ${unit}`,
        pass: word.pass,
        word: word.pass ? '✓ passes' : '○ not yet',
        note: t.notes?.trim() ? t.notes.trim() : null,
      })
      if (timed) {
        const injured = t.trialsInjured?.length ? fastestOfTrials(t.trialsInjured) : t.valueInjured > 0 ? t.valueInjured : null
        const other = t.trialsOther?.length ? fastestOfTrials(t.trialsOther) : t.valueOther > 0 ? t.valueOther : null
        if (injured === null || other === null) return base({ percent: 'no percent (no usable time)', pass: false }, injured ?? 0, other ?? 0)
        const pct = timedSymmetryPercent(injured, other)
        return base({ percent: `${pct}%`, pass: meetsTimedSymmetry(injured, other, threshold) }, injured, other)
      }
      const injured = t.trialsInjured?.length ? bestOfTrials(t.trialsInjured) : t.valueInjured
      const other = t.trialsOther?.length ? bestOfTrials(t.trialsOther) : t.valueOther
      const pct = symmetryPercent(injured, other)
      return base({ percent: pct === null ? 'no percent (the other side was 0)' : `${pct}%`, pass: meetsSymmetry(injured, other, threshold) }, injured, other)
    })
}

type PassedOver = LoadTestPrefill['passedOver']

const sessionsWord = (n: number) => (n === 1 ? 'a later session' : `${n} later sessions`)

/** What the prefill passed over, in one sentence, or null when nothing was. */
function passedOverWords({ rackCapped, noLoad }: PassedOver): string | null {
  const total = rackCapped + noLoad
  if (total === 0) return null
  if (noLoad === 0) return `Passed over ${sessionsWord(total)} that the rack capped.`
  if (rackCapped === 0) return `Passed over ${sessionsWord(total)} with no load on a side.`
  return `Passed over ${total} later sessions: ${rackCapped} that the rack capped, ${noLoad} with no load on a side.`
}

/**
 * Where a load form's numbers came from, in one sentence or three: the session, the gym when it
 * isn't the one Today plans at, and the later sessions loadTestPrefill passed over (rack-capped, or
 * no load on a side; PROGRAM-QUESTIONS 115). `notRunIn` is the phase when it runs no slot of the
 * exercise, so no session of it can prefill the test (gate 1, PROGRAM-QUESTIONS 114). `bothLegsIn`
 * is the phase when it runs the exercise only on slots logged once for both legs, and nothing has
 * prefilled it, so no session of it will (PROGRAM-QUESTIONS 134).
 */
export function prefillWords(input: {
  exercise: Pick<Exercise, 'name' | 'loadUnit'> | null
  prefill: LoadPrefill | null
  injuredSide: Side
  notRunIn?: number | null
  bothLegsIn?: number | null
  gymName?: string | null
  passedOver?: PassedOver
  /** The last saved test the form opened on instead (openLoadForm), when it is newer than any prefill. */
  openedOn?: Pick<GateTest, 'date' | 'valueInjured' | 'valueOther'> | null
}): string {
  const { exercise, prefill, injuredSide } = input
  const passedOver = input.passedOver ?? { rackCapped: 0, noLoad: 0 }
  const notRun = input.notRunIn !== undefined && input.notRunIn !== null
  const bothLegs = !notRun && input.bothLegsIn !== undefined && input.bothLegsIn !== null
  if (input.openedOn) {
    const t = input.openedOn
    const unit = exercise && exercise.loadUnit !== 'none' ? ` ${exercise.loadUnit}` : ''
    const name = exercise ? `${exercise.name}, ` : ''
    const values = `${name}${t.valueInjured}${unit} ${SIDE_WORD[injuredSide].toLowerCase()} and ${t.valueOther}${unit} ${SIDE_WORD[otherSide(injuredSide)].toLowerCase()}`
    const why = notRun
      ? `. Phase ${input.notRunIn} doesn’t run this exercise, so no session can prefill this test.`
      : bothLegs
        ? `. Phase ${input.bothLegsIn} runs this exercise only on a slot logged for both legs at once, so no session can prefill this test.`
        : ', newer than any session that could prefill it.'
    return `Opened on the last test, ${dateInWords(t.date)}: ${values}${why} Change either to save a new test.`
  }
  if (!exercise) return 'Nothing to prefill from: enter the values from the test.'
  if (notRun) return `Phase ${input.notRunIn} doesn’t run this exercise (${exercise.name}), so no session can prefill this test. Enter the loads from the test.`
  if (bothLegs && !input.prefill) return `Phase ${input.bothLegsIn} runs this exercise (${exercise.name}) only on a slot logged for both legs at once, so no session can prefill this test. Enter the loads from the test.`
  if (!prefill) {
    const { rackCapped, noLoad } = passedOver
    if (rackCapped + noLoad === 0) return `Nothing to prefill: no session has logged both sides of this exercise (${exercise.name}) yet. Enter the loads from the test.`
    const why = noLoad === 0 ? 'was rack-capped' : rackCapped === 0 ? 'had no load on a side' : 'was rack-capped or had no load on a side'
    return `Nothing to prefill: every session that logged both sides of this exercise (${exercise.name}) ${why}. Enter the loads from the test.`
  }
  const unit = exercise.loadUnit === 'none' ? '' : ` ${exercise.loadUnit}`
  const injured = SIDE_WORD[injuredSide].toLowerCase()
  const other = SIDE_WORD[otherSide(injuredSide)].toLowerCase()
  const where = input.gymName ? ` at ${input.gymName}` : ''
  const over = passedOverWords(passedOver)
  return `Prefilled from ${dateInWords(prefill.date)}’s session${where}: ${exercise.name}, ${prefill.injured}${unit} ${injured} and ${prefill.other}${unit} ${other}, the heaviest set on each side.${over ? ` ${over}` : ''} Change either to what the test lifted.`
}

// ---------------------------------------------------------------------------------------------
// Advancing the phase
// ---------------------------------------------------------------------------------------------

export type AdvanceState = { enabled: true } | { enabled: false; why: string }

/** A session still open, as the Advance button names it: "Session C" and "Saturday, November 21". */
export interface OpenSession {
  label: string
  dateWords: string
}

/**
 * Whether the Advance phase button is live: only when every item passes (evaluateGate), not while
 * the red-flag state suspends progression (rule 9), and not while a session is open
 * (advanceWaitsFor, PROGRAM-QUESTIONS 117). Disabled, it says why in words.
 */
export function advanceState(result: { items: readonly { pass: boolean }[]; passes: boolean }, redFlag: RedFlagState, open: readonly OpenSession[] = []): AdvanceState {
  if (progressionSuspended(redFlag)) return { enabled: false, why: 'The red-flag state is on: clear it in Settings, with a note, before advancing' }
  if (!result.passes) {
    const failing = result.items.filter((i) => !i.pass).length
    return { enabled: false, why: failing === 1 ? '1 item doesn’t pass yet' : `${failing} items don’t pass yet` }
  }
  const [first] = open
  if (first && open.length === 1) return { enabled: false, why: `${first.label} from ${first.dateWords} is still open: finish it or end it early, then advance` }
  if (open.length > 1) return { enabled: false, why: `${open.length} sessions are still open: finish them or end them early, then advance` }
  return { enabled: true }
}

function phaseTitle(phases: readonly Phase[], number: number): string {
  const phase = phases.find((p) => p.number === number)
  return phase ? `Phase ${number}: ${phase.name}` : `Phase ${number}`
}

/**
 * The inline confirm's question, with the week the bands count from: the week the phase is entered
 * (phaseEntryWeek) against this program week. Once this week's lifts have begun, that is next week
 * (PROGRAM-QUESTIONS 113). Phase 4 has no sessions yet, so its question says so instead.
 */
export function advanceQuestion(gate: Pick<Gate, 'toPhase'>, phases: readonly Phase[], entryWeek: number, currentWeek: number): string {
  const title = phaseTitle(phases, gate.toPhase)
  if (gate.toPhase === 4) return `Advance to ${title}? Its sessions arrive with the next program update; until then Today says they are not written yet.`
  const lead = `Advance to ${title}? From the next session the templates change`
  if (currentWeek < 1) return `${lead} and week bands count from week ${entryWeek}.`
  if (entryWeek > currentWeek) return `${lead}; week bands count from next week, week ${entryWeek}, since this week’s lifts have begun.`
  return `${lead} and week bands count from this week.`
}

/** How the inline confirm closed: Not yet, Yes (the phase advanced), or a change to the checklist under it. */
export type ConfirmClose = 'not-yet' | 'advanced' | 'checklist'

/**
 * Where focus goes when the confirm closes, so a VoiceOver user is never left on the page: Not yet
 * back to Advance phase; Yes to the line saying what changed, since the Advance button is then the
 * next gate's and disabled, and focus on it would fall to the page; a tick or a save in the
 * checklist leaves focus where the tap was.
 */
export function focusAfterConfirm(closedBy: ConfirmClose): 'advance-button' | 'advanced-line' | null {
  if (closedBy === 'not-yet') return 'advance-button'
  if (closedBy === 'advanced') return 'advanced-line'
  return null
}

/** What the screen says once the phase has advanced. */
export function advancedWords(settings: Pick<Settings, 'currentPhase' | 'phaseEnteredWeek'>, phases: readonly Phase[]): string {
  return `${phaseTitle(phases, settings.currentPhase)}, entered in week ${settings.phaseEnteredWeek}.`
}

/** Phase 4: no gate leads out of it yet. */
export function noGateWords(gates: readonly Gate[], currentPhase: number): string {
  const passed = gates.find((g) => g.toPhase === currentPhase)
  if (passed && currentPhase === 4) return `Gate ${passed.number} passed; Phase 4’s sessions arrive with the next program update.`
  return `No gate leads out of Phase ${currentPhase} in the program data.`
}

/** A record without one key: the screen's per-item drafts, errors and saved lines. */
export function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(record)) if (k !== key) out[k] = v
  return out
}

/** A rejected write, in words. */
export function errorWords(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.trim().length > 0 ? text.trim() : 'no reason was given'
}

export function testErrorSentence(error: unknown): string {
  return `The test did not save (${errorWords(error)}). Nothing was written; tap Save again.`
}

export function tickErrorSentence(error: unknown): string {
  return `The change did not save (${errorWords(error)}). The item is as it was; tap it again.`
}

export function advanceErrorSentence(error: unknown): string {
  return `The phase did not advance (${errorWords(error)}). Nothing changed; tap Yes, advance to try again.`
}

// ---------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------

export interface SymmetryEntry {
  /** The GateTest.item key; null when the program data names none (the form then can't save). */
  key: string | null
  threshold: number
  /** Trials per side for a hop test; null for a one-value load test. */
  trials: number | null
  /** A timed hop (Batch A): seconds, fastest kept, the line reads other ÷ injured, 0 refused in words. */
  timed: boolean
  unit: string
  step: number
  /** The Stepper's ceiling: 600 in. for distance hops, 60 s for the timed hop, 1000 lb for loads. */
  max: number
  prefill: LoadPrefill | null
  /** What the form shows with nothing typed: not entered for a hop test; for a load test, openLoadForm's pick. */
  opening: SymmetryForm
  /** The opening is the item's last saved test, so Save waits until a value changes (PROGRAM-QUESTIONS 118). */
  openingSaved: boolean
  /** Where a load form's numbers came from; null for hop tests. */
  prefillLine: string | null
  earlier: EarlierTest[]
  sides: { injured: string; other: string }
}

interface ItemBase {
  item: GateItem
  pass: boolean
  mark: string
  word: string
  detail: string
}

export type ItemView =
  | (ItemBase & { kind: 'auto' })
  | (ItemBase & { kind: 'manual' })
  | (ItemBase & { kind: 'symmetry'; entry: SymmetryEntry })
  /** The ACL-RSI item (Batch A): auto, the latest score and date already in its detail words, the questionnaire a tap away. */
  | (ItemBase & { kind: 'acl-rsi' })

export type GatesView =
  | { kind: 'no-gate'; line: string }
  | {
      kind: 'gate'
      gate: Gate
      result: GateResult
      countLine: string
      items: ItemView[]
      advance: AdvanceState
      /** The standing KOOS offer (KOOS_OFFER): plain routing words, never a score. */
      koosOffer: string
      /** The program week Yes, advance enters the next phase in (phaseEntryWeek). */
      entryWeek: number
      question: string
      /** The stop message while the red-flag state is on (rule 9), else null. */
      stop: { headline: string; items: string[] } | null
      /** Red flags on checks logged late, in words (Batch D): beside Advance, which they never lock; only a check for today suspends progression. */
      lateFlags: string[]
    }

/** Where the screen's gyms stand: every stored gym, and the one Today plans at. */
interface Gyms {
  locations: readonly Location[]
  activeId: string | undefined
}

/** The gym's name when a session ran away from the one Today plans at, else null. */
function awayGymName(locationId: string, gyms: Gyms): string | null {
  const active = locationOrHome(gyms.locations, gyms.activeId)
  const there = locationOrHome(gyms.locations, locationId)
  return active && there && there.id !== active.id ? there.name : null
}

/**
 * The templates as their sessions run: Shawn's added exercises laid after program.md's slots
 * (`withAddedSlots`), then the Program screen's edits laid over them (`applyToTemplate`), in the
 * order `planSession` lays them, an exercise the catalog no longer has dropped. Whether a phase runs
 * a test's exercise, and logs both its sides, is read from these, so the prefill follows the lists
 * the runner's routing and Swap offer, and an added slot of the test's own exercise counts (Batch C,
 * PROGRAM-QUESTIONS 168). Extra-time slots need nothing here: they copy the phase's own slots or are
 * upper-body and core work.
 */
function templatesAsRun(program: Pick<ProgramLike, 'templates' | 'exercises'>, history: Pick<HistoryLike, 'programOverrides' | 'addedSlots'>): SessionTemplate[] {
  const bySlot = overridesBySlot(history.programOverrides ?? [])
  // The catalog's exercises, as the runner hands them: an edit naming one the slot can't count or step is dropped here too.
  const known = new Map(program.exercises.map((e) => [e.id, e]))
  return program.templates.map((template) => applyToTemplate(withAddedSlots(template, history.addedSlots ?? [], known, program.templates), bySlot, known))
}

function symmetryEntry(item: GateItem, gate: Gate, history: HistoryLike, records: readonly WorkoutRecord[], injuredSide: Side, program: ProgramLike, gyms: Gyms): SymmetryEntry {
  const key = item.testItem ?? null
  const threshold = lineOf(item)
  const trials = item.trials ?? null
  const sides = sideNames(injuredSide)
  if (trials !== null) {
    // A timed hop enters seconds to a tenth (the first decimal trial field; PROGRAM-QUESTIONS 157); distance hops keep whole inches.
    const timed = item.timed === true
    const unit = timed ? 's' : 'in'
    return {
      key,
      threshold,
      trials,
      timed,
      unit,
      step: timed ? 0.1 : 1,
      max: timed ? TRIAL_MAX_S : TRIAL_MAX_IN,
      prefill: null,
      opening: openForm(trials, null),
      openingSaved: false,
      prefillLine: null,
      earlier: key ? earlierTests(history.gateTests, gate.number, key, threshold, unit, timed) : [],
      sides,
    }
  }
  // The program data names the exercise whose sets prefill a load test (PROGRAM-QUESTIONS 25: "prefilled
  // from the latest SetLogs per side"); hop tests have no logged exercise to start from.
  const exerciseId = item.prefillExerciseId
  const exercise = exerciseId ? (program.exercises.find((e) => e.id === exerciseId) ?? null) : null
  // A phase that runs no slot of the exercise can't produce a session to prefill from (PROGRAM-QUESTIONS 114),
  // read from the lists as edited, which is what its sessions run (PROGRAM-QUESTIONS 127); nor can one that
  // runs it only on slots logged once for both legs, which never log a side (PROGRAM-QUESTIONS 134).
  const asRun = templatesAsRun(program, history)
  const runs = exercise !== null && phaseRunsExercise(asRun, gate.fromPhase, exercise.id)
  const sided = exercise !== null && runs && phaseLogsBothSides(asRun, gate.fromPhase, exercise.id)
  const found = exercise && runs ? loadTestPrefill(records, exercise.id, injuredSide) : null
  const prefill = found?.prefill ?? null
  const unit = exercise && exercise.loadUnit !== 'none' ? exercise.loadUnit : 'lb'
  const latest = key ? (orderedTests(history.gateTests.filter((t) => t.gate === gate.number && t.item === key && !t.manual)).at(-1) ?? null) : null
  const opening = openLoadForm(prefill, latest)
  return {
    key,
    threshold,
    trials: null,
    timed: false,
    unit,
    step: exercise && exercise.increment > 0 ? exercise.increment : 5,
    max: LOAD_MAX,
    prefill,
    opening: opening.form,
    openingSaved: opening.saved,
    prefillLine: prefillWords({
      openedOn: opening.saved ? latest : null,
      exercise,
      prefill,
      injuredSide,
      notRunIn: exercise && !runs ? gate.fromPhase : null,
      bothLegsIn: exercise && runs && !sided && !prefill ? gate.fromPhase : null,
      gymName: prefill ? awayGymName(prefill.locationId, gyms) : null,
      ...(found ? { passedOver: found.passedOver } : {}),
    }),
    earlier: key ? earlierTests(history.gateTests, gate.number, key, threshold, unit) : [],
    sides,
  }
}

function itemView(r: GateItemResult, gate: Gate, today: IsoDate, history: HistoryLike, records: readonly WorkoutRecord[], injuredSide: Side, program: ProgramLike, gyms: Gyms): ItemView {
  const detail = r.misses && r.misses.length > 0 ? cleanWeeksWords(r.detail, r.misses, { today, history, templates: program.templates }) : detailWords(r.detail)
  const base: ItemBase = { item: r.item, pass: r.pass, ...stateWords(r.pass), detail }
  if (r.item.evaluator === 'manual') return { ...base, kind: 'manual' }
  if (r.item.evaluator === 'symmetry') return { ...base, kind: 'symmetry', entry: symmetryEntry(r.item, gate, history, records, injuredSide, program, gyms) }
  if (r.item.evaluator === 'acl-rsi') return { ...base, kind: 'acl-rsi' }
  return { ...base, kind: 'auto' }
}

/**
 * The KOOS offer on the Gates screen (Batch A): opening Gates is attempting the gate, so the
 * offer is a standing line that routes to the questionnaire (PROGRAM-QUESTIONS 158). It carries
 * NO score and never will: the koos guard bars this file from src/rules/koos.ts, so a dipping
 * subscale cannot read as an extra gate requirement — scores live on Progress alone.
 */
export const KOOS_OFFER = 'Attempting a gate? A KOOS check goes with it: fill the questionnaire in when you test. Scores show on Progress, never here.'

/**
 * What the Gates screen shows: the current gate evaluated live, item by item, and whether it may
 * advance. `locations` lets a prefill line name a gym away from the one Today plans at.
 * `aclRsiEntries` rides through to the gate rule (gateContext); the screen hands them in from
 * useAclRsiEntries, never through History.
 */
export function gatesView(input: { today: IsoDate; settings: Settings; history: HistoryLike; program: ProgramLike; locations?: readonly Location[]; aclRsiEntries: readonly AclRsiEntry[] }): GatesView {
  const { today, settings, history, program } = input
  const gyms: Gyms = { locations: input.locations ?? [], activeId: settings.activeLocationId }
  const gate = currentGate(program.gates, settings.currentPhase)
  if (!gate) return { kind: 'no-gate', line: noGateWords(program.gates, settings.currentPhase) }
  const records = attachChecks(history.workouts, history.setLogs, history.morningChecks)
  const result = evaluateGate(gate, gateContext({ today, settings, history, aclRsiEntries: input.aclRsiEntries }))
  const entryWeek = phaseEntryWeek({ today, startDate: settings.startDate, template: program.weeklyTemplate, moves: history.sessionMoves, workouts: history.workouts })
  return {
    kind: 'gate',
    gate,
    result,
    countLine: passCountWords(result),
    items: result.items.map((r) => itemView(r, gate, today, history, records, settings.injuredSide, program, gyms)),
    advance: advanceState(
      result,
      settings.redFlag,
      advanceWaitsFor(history.workouts).map((w) => ({ label: workoutLabel(w, program.templates), dateWords: dateWords(w.date) })),
    ),
    koosOffer: KOOS_OFFER,
    entryWeek,
    question: advanceQuestion(gate, program.phases, entryWeek, weekOf(today, settings.startDate)),
    stop: stopMessage(settings.redFlag, program.redFlags),
    lateFlags: lateFlagNotes(history.morningChecks, today, program.redFlags).map(lateFlagWords),
  }
}
