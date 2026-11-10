import { describe, expect, it } from 'vitest'
import { planSession } from '../app/session.ts'
import type { History } from '../db/repo.ts'
import { homeLocation } from '../db/migrations.ts'
import { program, templateFor } from '../program/program.ts'
import { DEFAULT_KIT, Settings, type MorningCheck, type MorningTag, type Run, type SetLog, type Workout } from '../schema/index.ts'
import { settingsAfter } from '../screens/MorningCheck.helpers.ts'
import { evaluateGate } from './gates.ts'
import { attachChecks, exerciseReadings, subjectReadings } from './history.ts'
import { consecutiveCleanDays } from './progress.ts'
import { NO_RED_FLAG, afterMorningCheck, lateFlagNotes } from './redFlags.ts'
import { acuteChronic, trainingLoads, weeklyTrainingLoads } from './trainingLoad.ts'
import { targetForWeek } from './weekPlan.ts'
import { kneeMorning } from './wholeKnee.ts'

/*
 * Morning-check tags are counts only (Batch D, Shawn's Nov 8 decision 10; PROGRAM-QUESTIONS 178):
 * they feed no reading, prescription, gate or load. Tags travel inside History.morningChecks, so no
 * "loadHistory never carries it" check can hold them out; this guard holds them by mentions and by
 * behavior instead. Only the counting module and the screens that collect or show tags may mention
 * them, only Progress's helpers may import the counting module, and on a fixture history every
 * decision comes out the same with every tag stripped.
 */

// Every app source, read at test time through Vite (no node APIs needed).
const sources = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

/**
 * The counting module's importers: the screen helper that shows the counts, the module's own tests,
 * and the down-period guard (Batch E), which reads the counts only to prove a down period never changes them.
 */
const IMPORTERS: readonly string[] = [
  '/src/rules/morningTags.test.ts',
  '/src/screens/Progress.helpers.ts',
  '/src/screens/Progress.helpers.test.ts',
  '/src/rules/downPeriod.guard.test.ts',
  // The tester-mode guard (M-U3) spies on its exports only to prove tester mode never calls the counts.
  '/src/rules/engineMode.guard.test.ts',
]

/** The files that may mention tags: the schema, the counting module, the form, and the Progress section. */
const MENTIONS: readonly string[] = [
  '/src/schema/enums.ts',
  '/src/schema/log.ts',
  '/src/rules/morningTags.ts',
  '/src/screens/MorningCheck.helpers.ts',
  '/src/screens/MorningCheck.tsx',
  '/src/screens/Progress.helpers.ts',
  '/src/screens/Progress.tsx',
]

function importsMorningTags(source: string): boolean {
  return /(?:from|import\()\s*['"`](?:\.{1,2}\/)+(?:[\w.-]+\/)*morningTags(?:\.ts)?['"`]/.test(source)
}

/** A mention of the tag enum, the list, or a `tags` field, read or written. A bare "tags" in prose is not one. */
function mentionsTags(source: string): boolean {
  return /\bMorningTag\b|\bMORNING_TAGS\b|\.tags\b|\btags\s*[:?,}]|\[['"]tags['"]\]/.test(source)
}

const isTest = (path: string) => /\.test\.tsx?$/.test(path)

describe('morning tags are counts only', () => {
  it('the checks catch the forms they should, and leave prose alone', () => {
    expect(importsMorningTags("import { tagCounts } from '../rules/morningTags.ts'")).toBe(true)
    expect(importsMorningTags('import { tagCounts } from "./morningTags"')).toBe(true)
    expect(importsMorningTags("const m = await import('../../rules/morningTags.ts')")).toBe(true)
    expect(importsMorningTags("import { x } from './morningTags.guard.test.ts'")).toBe(false)
    for (const form of ['if (check.tags?.includes(t)) return', 'const { tags } = check', 'const { tags, notes } = c', '{ ...c, tags: [] }', "row['tags']", 'type T = MorningTag', 'MORNING_TAGS.map(f)', 'c.tags ?? []']) {
      expect(mentionsTags(form), form).toBe(true)
    }
    expect(mentionsTags('// A heading line: "#" to "######", then a space, then the text. Blocks and tags are not read.')).toBe(false)
    expect(mentionsTags(sources['/src/rules/markdown.ts'] ?? '')).toBe(false)
    expect(mentionsTags('the fixed tags and the day it was saved')).toBe(false)
  })

  it('finds the sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    for (const path of [...IMPORTERS, ...MENTIONS]) expect(Object.keys(sources), path).toContain(path)
  })

  it('only Progress’s helpers import the counting module', () => {
    for (const [path, source] of Object.entries(sources)) {
      if (path === '/src/rules/morningTags.guard.test.ts' || IMPORTERS.includes(path)) continue
      expect(importsMorningTags(source), `${path} imports morningTags`).toBe(false)
    }
  })

  it('no other app source mentions tags', () => {
    for (const [path, source] of Object.entries(sources)) {
      if (isTest(path) || MENTIONS.includes(path)) continue
      expect(mentionsTags(source), `${path} mentions tags`).toBe(false)
    }
  })

  it('every listed file really does mention them (the list stays tight)', () => {
    for (const path of MENTIONS) expect(mentionsTags(sources[path] ?? ''), path).toBe(true)
  })
})

describe('stripping every tag changes no decision', () => {
  const START = '2026-11-02'
  const TODAY = '2026-11-20'
  const template = templateFor(1, 'A')
  const firstSlot = template.slots[0]
  if (!firstSlot) throw new Error('Session A has a slot')
  const lift = (date: string, status: Workout['status'] = 'finished'): Workout => ({ id: `${date}-p1-a`, date, templateId: 'p1-a', phase: 1, week: 1, isDeload: false, status, sessionRpe: 6, durationMinutes: 50 })
  const set = (w: Workout, n: number, pain: number): SetLog => ({ id: `${w.id}:${firstSlot.id}:both:${n}`, workoutId: w.id, slotId: firstSlot.id, exerciseId: firstSlot.exerciseId, setNumber: n, side: 'both', load: 8, loadUnit: 'plate', reps: 12, painDuring: pain, stopped: false })
  const run = (date: string, maxPain: number, miles = 4): Run => ({ id: `run-${date}`, date, type: 'long', miles, minutes: miles * 10, effort: 'easy', rpe: 4, maxPain, strides: false, tempo: false })
  const check = (date: string, tags: MorningTag[], over: Partial<MorningCheck> = {}): MorningCheck => ({
    id: `mc-${date}`, date, appliesTo: null, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [], tags, ...over,
  })
  const lifts = [lift('2026-11-03'), lift('2026-11-10'), lift('2026-11-17')]
  const history: History = {
    workouts: lifts,
    setLogs: lifts.flatMap((w, i) => [set(w, 1, i), set(w, 2, i + 1)]),
    runs: [run('2026-11-06', 1), run('2026-11-13', 4), run('2026-11-18', 2)],
    morningChecks: [
      check('2026-11-04', ['poor-sleep']),
      check('2026-11-07', ['long-sitting', 'brace']),
      check('2026-11-11', ['nsaid'], { worseThanYesterday: true }),
      check('2026-11-14', ['new-shoes'], { visibleSwelling: true }),
      check('2026-11-18', ['on-feet', 'poor-sleep'], { redFlags: ['locking'], loggedOn: TODAY }),
      check('2026-11-19', ['brace'], { painChangePoints: 2 }),
    ],
    gateTests: [],
    sessionMoves: [],
  }
  const stripped: History = { ...history, morningChecks: history.morningChecks.map(({ tags: _t, ...rest }) => (void _t, rest)) }
  const settings = Settings.parse({ injuredSide: 'right', startDate: START, dumbbellMax: 80, restTimerSeconds: 60, painPerSet: false, currentPhase: 1, phaseEnteredWeek: 1 })
  const gym = { location: homeLocation(80, program.planetFitness, START, program.equipmentListVersion), kit: DEFAULT_KIT }

  function decisions(h: History) {
    const records = attachChecks(h.workouts, h.setLogs, h.morningChecks)
    const readings = subjectReadings(records, h.runs, h.morningChecks, 'right')
    const loads = trainingLoads(records, h.runs)
    return {
      readings,
      exercise: exerciseReadings(records, firstSlot?.exerciseId ?? '', 'right'),
      knee: ['2026-11-12', '2026-11-15', '2026-11-19', '2026-11-21', '2026-11-24'].map((d) => kneeMorning(h.morningChecks, h.workouts, d)),
      targets: [2, 3, 4].map((week) => targetForWeek(program.mileagePlan, week, START, h.runs, readings)),
      clean: consecutiveCleanDays(readings, TODAY, h.morningChecks),
      gates: program.gates.map((gate) => evaluateGate(gate, { today: TODAY, injuredSide: 'right', readings, gateTests: [], morningChecks: h.morningChecks, runs: h.runs, workouts: h.workouts, setLogs: h.setLogs, calfRaiseExerciseIds: [], aclRsiEntries: [] })),
      plan: planSession({ template, week: 4, settings, history: h, gym, before: '2026-11-24' }).map((p) => p.prescriptions),
      loads,
      weekly: weeklyTrainingLoads(loads, START, 3),
      acwr: acuteChronic(loads, TODAY, START),
      redFlag: h.morningChecks.reduce((state, c) => afterMorningCheck(state, c), NO_RED_FLAG),
      settings: h.morningChecks.map((c) => settingsAfter(settings, c)),
      notes: lateFlagNotes(h.morningChecks, TODAY, program.redFlags),
    }
  }

  it('readings, plans, gates, loads, the red-flag state and its notes are the same with and without tags', () => {
    const tagged = decisions(history)
    // The fixture is not empty: something reads back off, and the late flag makes a note.
    expect(tagged.readings.some((r) => r.result === 'back-off')).toBe(true)
    expect(tagged.notes).toHaveLength(1)
    expect(decisions(stripped)).toEqual(tagged)
  })
})
