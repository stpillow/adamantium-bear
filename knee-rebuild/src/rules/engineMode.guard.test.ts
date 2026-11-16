import { beforeAll, describe, expect, it, vi } from 'vitest'

/*
 * Tester mode never reaches the engine (M-U3; Shawn's Nov 8 decision; PROGRAM-QUESTIONS 223 to 233).
 * The trainingLoad.guard shape, plus spies. Four parts:
 *
 * (a) Structural. The engine is every exported function of the engine modules below that isn't on
 *     ALLOWED (an allowlist, so a new export counts as engine until it is named here). No .tsx file
 *     names an engine function (comments and string literals stripped first, so an import path
 *     such as '../rules/prefill.ts' or a comment is no hit), and only the mode-taking modules may
 *     import one; each of those imports `EngineMode` and branches on it. And every export of a
 *     mode-taking module that the rest of the app imports and that reaches the engine (directly, or
 *     through a local helper or another mode-taking module's export) takes the mode, unless FULL_ONLY
 *     names it as called only on a full-mode path.
 * (b) Never invoked. Every export of the engine modules (and of src/app/session.ts) is wrapped in a
 *     spy (`vi.mock`); every view helper and the planner then run in tester mode over the rich
 *     history (src/testing/richHistory.fixture.test.ts), both settings variants, and no ENGINE spy
 *     may have been called. A call inside one module bypasses its mock; every such call is reached
 *     only through an export of that module, and every export of every engine module is spied, so
 *     the outer call is what trips. The tester planner lives in its own module (src/app/written.ts),
 *     so a call from it to planSession goes through the mock.
 * (c) Shape and words. No tester output carries a reading, a prescription, a suggestion, a stop, a
 *     ramp, a budget, a verdict, a clean count, tag counts or a capped target; and once program.md's
 *     own words are taken out (its row notes and cues say "hold"), no output string reads a reading,
 *     a back-off, the ortho or PT, progression, a stop, the engine, a budget, a suggestion or a pause.
 * (d) Full is the same planner: planFor('full', x) is planSession(x) exactly.
 */

const { spyAll } = vi.hoisted(() => ({
  spyAll: (mod: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(mod).map(([name, value]) => [name, typeof value === 'function' && !/^[A-Z]/.test(name) ? vi.fn(value as (...args: unknown[]) => unknown) : value])),
}))

vi.mock('./prescription.ts', async (orig) => spyAll(await orig()))
vi.mock('./slotExercise.ts', async (orig) => spyAll(await orig()))
vi.mock('./wholeKnee.ts', async (orig) => spyAll(await orig()))
vi.mock('./warmUpRamp.ts', async (orig) => spyAll(await orig()))
vi.mock('./reading.ts', async (orig) => spyAll(await orig()))
vi.mock('./history.ts', async (orig) => spyAll(await orig()))
vi.mock('./gates.ts', async (orig) => spyAll(await orig()))
vi.mock('./redFlags.ts', async (orig) => spyAll(await orig()))
vi.mock('./weekPlan.ts', async (orig) => spyAll(await orig()))
vi.mock('./lateCheck.ts', async (orig) => spyAll(await orig()))
vi.mock('./progress.ts', async (orig) => spyAll(await orig()))
vi.mock('./morningTags.ts', async (orig) => spyAll(await orig()))
vi.mock('./runnerGym.ts', async (orig) => spyAll(await orig()))
vi.mock('./unilateral.ts', async (orig) => spyAll(await orig()))
vi.mock('./prefill.ts', async (orig) => spyAll(await orig()))
vi.mock('./mileage.ts', async (orig) => spyAll(await orig()))
vi.mock('./gymLoads.ts', async (orig) => spyAll(await orig()))
vi.mock('./downPeriod.ts', async (orig) => spyAll(await orig()))
vi.mock('./extensions.ts', async (orig) => spyAll(await orig()))
vi.mock('./gymDay.ts', async (orig) => spyAll(await orig()))
vi.mock('./compliance.ts', async (orig) => spyAll(await orig()))
vi.mock('../app/session.ts', async (orig) => spyAll(await orig()))

import { PROGRAM, planSession } from '../app/session.ts'
import * as sessionModule from '../app/session.ts'
import { planFor, writtenFit, writtenSession } from '../app/written.ts'
import { settingsOnImport } from './backup.ts'
import { addDays } from './calendar.ts'
import { sessionCompliance } from './compliance.ts'
import * as compliance from './compliance.ts'
import * as downPeriod from './downPeriod.ts'
import * as extensions from './extensions.ts'
import * as gates from './gates.ts'
import * as gymDay from './gymDay.ts'
import * as gymLoads from './gymLoads.ts'
import * as history from './history.ts'
import * as lateCheck from './lateCheck.ts'
import * as mileage from './mileage.ts'
import * as morningTags from './morningTags.ts'
import * as prefill from './prefill.ts'
import * as prescription from './prescription.ts'
import * as progress from './progress.ts'
import * as reading from './reading.ts'
import * as redFlags from './redFlags.ts'
import * as runnerGym from './runnerGym.ts'
import * as slotExercise from './slotExercise.ts'
import * as unilateral from './unilateral.ts'
import * as warmUpRamp from './warmUpRamp.ts'
import * as weekPlan from './weekPlan.ts'
import * as wholeKnee from './wholeKnee.ts'
import type { EngineMode, ModeReason } from './engineMode.ts'
import type { MorningCheck, SetLog, Settings } from '../schema/index.ts'
import { RICH_TODAY, RICH_TODAYS, richAclRsi, richHistory, richHome, richKoos, richLocations, richMarriott, richSettings, richSettingsFlagged } from '../testing/richHistory.fixture.test.ts'
import { aclRsiLead, aclRsiSavedLine } from '../screens/AclRsi.helpers.ts'
import { gatesView } from '../screens/Gates.helpers.ts'
import { changesView, coverageWeek, rackNote, templatesAsRun, usedByWords } from '../screens/LocationEditor.helpers.ts'
import { afterSave, withTodaysFlags, checkResultView, existingCheckLine, formIntros, formWords, lateChanges, lateFormLine, lateResultView, nextTimeView, tagIntro } from '../screens/MorningCheck.helpers.ts'
import { logLateNote, previewDayLine, previewSlotsFor, previewView } from '../screens/Preview.helpers.ts'
import { phaseScreen, programControls } from '../screens/Program.helpers.ts'
import { exerciseView, progressLead, progressView } from '../screens/Progress.helpers.ts'
import { dayChoicesNote, loggedWords, loggerView, painRequiredWords } from '../screens/RunLogger.helpers.ts'
import {
  cardModel,
  deloadBadge,
  holdsOffFor,
  loadBlocked,
  notLoggedWords,
  redFlagRunnerLine,
  runnerPlan,
  setTarget,
  summaryCheckLine,
  summaryPhaseWeek,
  summaryTemplateFor,
} from '../screens/SessionRunner.helpers.ts'
import { discardWords, endWords } from '../screens/session/EndPanels.helpers.ts'
import { complianceLine, summaryBlocks } from '../screens/session/Summary.helpers.ts'
import { keptDownPeriodWords, phaseNote, redFlagView, settingsOnImportWords, sideNote } from '../screens/Settings.helpers.ts'
import { liftPlanView, modeLine, ownFlagLines, todayView, yesterdayLogged } from '../screens/Today.helpers.ts'
import { weekView } from '../screens/Week.helpers.ts'

const MODE: EngineMode = 'tester'

// ---------------------------------------------------------------------------------------------
// The engine, as an allowlist

/** Every engine module, by its path from the repository root, with its runtime exports (spied). */
const ENGINE_MODULES: Record<string, Record<string, unknown>> = {
  '/src/app/session.ts': sessionModule,
  '/src/rules/prescription.ts': prescription,
  '/src/rules/slotExercise.ts': slotExercise,
  '/src/rules/wholeKnee.ts': wholeKnee,
  '/src/rules/warmUpRamp.ts': warmUpRamp,
  '/src/rules/reading.ts': reading,
  '/src/rules/history.ts': history,
  '/src/rules/gates.ts': gates,
  '/src/rules/redFlags.ts': redFlags,
  '/src/rules/weekPlan.ts': weekPlan,
  '/src/rules/lateCheck.ts': lateCheck,
  '/src/rules/progress.ts': progress,
  '/src/rules/morningTags.ts': morningTags,
  '/src/rules/runnerGym.ts': runnerGym,
  '/src/rules/unilateral.ts': unilateral,
  '/src/rules/prefill.ts': prefill,
  '/src/rules/mileage.ts': mileage,
  '/src/rules/gymLoads.ts': gymLoads,
  '/src/rules/downPeriod.ts': downPeriod,
  '/src/rules/extensions.ts': extensions,
  '/src/rules/gymDay.ts': gymDay,
  '/src/rules/compliance.ts': compliance,
}

/**
 * What tester mode may use from each engine module: no pain-derived decision in any of them. The
 * plan's routing and the gym; what was logged and when; the plan's miles; the session's set count;
 * the logged series Progress draws (a symmetry ratio of logged numbers, a rack mark as stored);
 * a check's link to its subject; the down period's own records and words, never its pause.
 */
const ALLOWED: Record<string, readonly string[]> = {
  '/src/app/session.ts': ['availableAt', 'gymHere', 'withAdded', 'warmUpFor', 'phaseWeekFor', 'currentTemplate'],
  '/src/rules/prescription.ts': [],
  '/src/rules/slotExercise.ts': [],
  '/src/rules/wholeKnee.ts': [],
  '/src/rules/warmUpRamp.ts': [],
  '/src/rules/reading.ts': ['morningCheckApplies'],
  '/src/rules/history.ts': ['attachChecks', 'checkFor'],
  '/src/rules/gates.ts': ['inWriteOrder'],
  '/src/rules/redFlags.ts': [],
  '/src/rules/weekPlan.ts': ['runsInWeek', 'runTypeFor', 'sessionDone', 'weekDays', 'weekAdherence'],
  '/src/rules/lateCheck.ts': ['isLateCheck', 'lateCheckFor'],
  '/src/rules/progress.ts': ['loadSeries', 'slotPairs', 'symmetrySeries', 'symmetryLeftOut', 'milesSeries'],
  '/src/rules/morningTags.ts': ['anyTagged'],
  '/src/rules/runnerGym.ts': ['notHereSlots', 'markHereItems', 'lacksDumbbells', 'asksForRack', 'skipTakesBack', 'lacksFromBag', 'markOffItems', 'swapOffer'],
  '/src/rules/unilateral.ts': ['symmetryPercent'],
  '/src/rules/prefill.ts': ['loggedPain', 'painRewriteAllowed'],
  '/src/rules/mileage.ts': ['isSwap', 'weekMiles', 'weekSessions', 'planTarget', 'roundToHalf'],
  '/src/rules/gymLoads.ts': ['isRackCapped', 'withoutRackCapped'],
  '/src/rules/downPeriod.ts': ['coveringPeriod', 'standingPeriod', 'downPeriodWords', 'declareProblem', 'newDownPeriod', 'extendProblem', 'endProblem', 'resumeProblem', 'extended', 'endedEarly', 'resumed', 'lastPausedDay', 'plannedDays', 'latestEnd'],
  '/src/rules/extensions.ts': ['isExtraSlotId'],
  '/src/rules/gymDay.ts': ['liftGym', 'lastLoggedGym', 'gymToOffer', 'runSwapGym'],
  '/src/rules/compliance.ts': ['sessionCompliance', 'sessionPhaseWeek'],
}

/** The engine: every exported function of an engine module not on its allowlist. */
function engineNames(path: string): string[] {
  const mod = ENGINE_MODULES[path] ?? {}
  const allowed = ALLOWED[path] ?? []
  return Object.entries(mod)
    .filter(([name, value]) => typeof value === 'function' && !/^[A-Z]/.test(name) && !allowed.includes(name))
    .map(([name]) => name)
}
const ENGINE: ReadonlySet<string> = new Set(Object.keys(ENGINE_MODULES).flatMap(engineNames))

/** The modules that take the mode and may import the engine for their full-mode branch. */
const MODE_TAKING: readonly string[] = [
  '/src/app/written.ts',
  '/src/screens/Today.helpers.ts',
  '/src/screens/Week.helpers.ts',
  '/src/screens/Progress.helpers.ts',
  '/src/screens/Gates.helpers.ts',
  '/src/screens/RunLogger.helpers.ts',
  '/src/screens/MorningCheck.helpers.ts',
  '/src/screens/Preview.helpers.ts',
  '/src/screens/SessionRunner.helpers.ts',
  '/src/screens/session/Summary.helpers.ts',
  '/src/screens/Settings.helpers.ts',
  '/src/screens/LocationEditor.helpers.ts',
]

// ---------------------------------------------------------------------------------------------
// (a) Structural

const sources = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const isTest = (path: string) => /\.test\.tsx?$/.test(path)

/** The source with comments and string literals taken out: what is left is code (template literals keep their `${}` code). */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
}

/** Every engine name a source's code names, by word. */
function namesEngine(source: string): string[] {
  const code = codeOf(source)
  // As an identifier: not a property (`words.worse`) and not an object key (`{ worse: … }`).
  return [...ENGINE].filter((name) => new RegExp(`(?<![.\\w$])${name}\\b(?!\\s*:(?!:))`).test(code))
}

/** The names a source imports at runtime (not `import type`, not `type X`) from each specifier. */
function runtimeImports(source: string): { spec: string; names: string[] }[] {
  const out: { spec: string; names: string[] }[] = []
  for (const m of source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) {
    if (m[1]) continue
    const names = (m[2] ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n !== '' && !n.startsWith('type '))
      .map((n) => n.split(/\s+as\s+/)[0] ?? n)
    out.push({ spec: m[3] ?? '', names })
  }
  for (const m of source.matchAll(/import\s+\*\s+as\s+\w+\s+from\s+['"]([^'"]+)['"]/g)) out.push({ spec: m[1] ?? '', names: ['*'] })
  for (const m of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({ spec: m[1] ?? '', names: ['*'] })
  return out
}

/** A specifier, resolved from the importing file, to a repository path. */
function resolve(from: string, spec: string): string {
  if (!spec.startsWith('.')) return spec
  const parts = from.split('/').slice(0, -1)
  for (const piece of spec.split('/')) {
    if (piece === '..') parts.pop()
    else if (piece !== '.') parts.push(piece)
  }
  const joined = parts.join('/')
  return joined.endsWith('.ts') || joined.endsWith('.tsx') ? joined : `${joined}.ts`
}

/** The app code tester mode runs through: screens, components, the app layer, the shell. */
const APP = Object.keys(sources).filter((p) => !isTest(p) && (p.startsWith('/src/screens/') || p.startsWith('/src/components/') || p.startsWith('/src/app/') || p === '/src/App.tsx' || p === '/src/main.tsx'))

describe('(a) the engine is reachable only through mode-taking helpers', () => {
  it('self-test: the name scan skips comments and strings, and catches code', () => {
    expect(namesEngine("import { loggedPain } from '../rules/prefill.ts'")).toEqual([])
    expect(namesEngine('// windowFit decides the minutes\nconst a = 1')).toEqual([])
    expect(namesEngine('/* planSession */ const x = 2')).toEqual([])
    expect(namesEngine('const d = prefill({ prescription })')).toContain('prefill')
    expect(namesEngine('const p = planSession(input)')).toContain('planSession')
    expect(namesEngine('const w = words.worse; const o = { worse: 1 }')).toEqual([])
  })

  it('self-test: imports are read by name, static and dynamic, and type imports are not runtime', () => {
    expect(runtimeImports("import { prefill, loggedPain as lp } from '../rules/prefill.ts'")).toEqual([{ spec: '../rules/prefill.ts', names: ['prefill', 'loggedPain'] }])
    expect(runtimeImports("import type { Draft } from '../rules/prefill.ts'")).toEqual([])
    expect(runtimeImports("import { type Draft, loggedPain } from '../rules/prefill.ts'")).toEqual([{ spec: '../rules/prefill.ts', names: ['loggedPain'] }])
    expect(runtimeImports("const m = await import('../rules/prescription.ts')")).toEqual([{ spec: '../rules/prescription.ts', names: ['*'] }])
    expect(resolve('/src/screens/session/ActiveCard.tsx', '../../rules/prefill.ts')).toBe('/src/rules/prefill.ts')
  })

  it('finds the sources, the engine and the mode-taking modules', () => {
    expect(APP.length).toBeGreaterThan(60)
    for (const path of [...MODE_TAKING, ...Object.keys(ENGINE_MODULES)]) expect(Object.keys(sources), path).toContain(path)
    for (const name of ['prescribe', 'planSession', 'sessionReading', 'morningReading', 'evaluateGate', 'stopMessage', 'suggestRun', 'lateCheckReach', 'rampFor', 'kneeMorning', 'weekTarget', 'tagCounts', 'bandWeek', 'healthySideTargets', 'prefill', 'cardHoldsOff', 'swapCallAt', 'extensionPool', 'sessionExtensions', 'slotRamp', 'rampsInOrder', 'windowFit', 'advancePhase', 'consecutiveCleanDays', 'subjectReadings', 'exerciseHistory', 'capReading', 'pauseOn', 'sessionBandWeek']) {
      expect(ENGINE.has(name), name).toBe(true)
    }
    for (const [path, names] of Object.entries(ALLOWED)) for (const name of names) expect(typeof ENGINE_MODULES[path]?.[name], `${path} ${name}`).toBe('function')
  })

  it('no .tsx names an engine function', () => {
    for (const path of APP.filter((p) => p.endsWith('.tsx'))) expect(namesEngine(sources[path] ?? ''), path).toEqual([])
  })

  it('only the mode-taking modules import an engine function; every one of them takes the mode', () => {
    for (const path of APP) {
      if (MODE_TAKING.includes(path) || path === '/src/app/session.ts') continue
      for (const { spec, names } of runtimeImports(sources[path] ?? '')) {
        const target = resolve(path, spec)
        if (!(target in ENGINE_MODULES)) continue
        const engine = names.filter((n) => n === '*' || ENGINE.has(n))
        expect(engine, `${path} imports ${engine.join(', ')} from ${target}`).toEqual([])
      }
    }
    for (const path of MODE_TAKING) expect(sources[path] ?? '', path).toMatch(/import type \{[^}]*\bEngineMode\b[^}]*\} from '[./]*\/?(rules\/)?engineMode\.ts'|import type \{ EngineMode \} from/)
  })

  it('self-test: a declaration that reaches the engine through a local helper or another mode-taking module is found', () => {
    const a = "import { bandWeek } from '../rules/downPeriod.ts'\nfunction held(d) { return bandWeek(d) }\nexport function week(d) { return held(d) }\nexport function plain(d) { return d }\nexport function withMode(mode, d) { return mode === 'tester' ? d : held(d) }"
    const b = "import { week } from './A.helpers.ts'\nexport function screenWeek(d) { return week(d) }"
    const reach = reachingExports({ '/src/screens/A.helpers.ts': a, '/src/screens/B.helpers.ts': b })
    expect(reach.get('/src/screens/A.helpers.ts')).toEqual(new Map([['week', false], ['withMode', true]]))
    expect(reach.get('/src/screens/B.helpers.ts')).toEqual(new Map([['screenWeek', false]]))
  })

  it('every mode-taking export the app imports that reaches the engine, directly or through another, takes the mode', () => {
    const reach = reachingExports(Object.fromEntries(MODE_TAKING.map((p) => [p, sources[p] ?? ''])))
    for (const [path, names] of Object.entries(FULL_ONLY)) for (const name of names) expect(reach.get(path)?.get(name), `${path} ${name} is on FULL_ONLY`).toBe(false)
    const modeless = APP.filter((p) => !MODE_TAKING.includes(p)).flatMap((path) =>
      runtimeImports(sources[path] ?? '').flatMap(({ spec, names: imported }) => {
        const target = resolve(path, spec)
        return imported.filter((n) => reach.get(target)?.get(n) === false && !(FULL_ONLY[target] ?? []).includes(n)).map((n) => `${path} imports ${n} from ${target}`)
      }),
    )
    expect(modeless).toEqual([])
  })
})

/**
 * Mode-taking exports that reach the engine without taking the mode, each read and called by its
 * screen only on a full-mode path: Today's run suggestion (a tester's run has none); Gates' hop-test
 * form and Advance (a tester's Gates has neither); clearing the red-flag state (a tester's Settings
 * has no red-flag section). Anything else the app imports from a mode-taking module must take it.
 */
const FULL_ONLY: Record<string, readonly string[]> = {
  '/src/screens/Today.helpers.ts': ['runSuggestionAtGym'],
  '/src/screens/Gates.helpers.ts': ['formBest', 'symmetryLine', 'formBlocker', 'buildTest', 'advanceSettings'],
  '/src/screens/Settings.helpers.ts': ['clearedSettings'],
}

/** Top-level declarations of a source's code by name (overloads joined), and whether each is exported. */
function declarations(source: string): Map<string, { code: string; exported: boolean }> {
  const code = codeOf(source)
  const starts = [...code.matchAll(/^(export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)]
  const out = new Map<string, { code: string; exported: boolean }>()
  starts.forEach((m, i) => {
    const name = m[2] ?? ''
    const body = code.slice(m.index, starts[i + 1]?.index ?? code.length)
    const prior = out.get(name)
    out.set(name, { code: `${prior?.code ?? ''}\n${body}`, exported: (prior?.exported ?? false) || m[1] !== undefined })
  })
  return out
}

const names = (code: string, name: string) => new RegExp(`(?<![.\\w$])${name.replace(/\$/g, '\\$')}\\b(?!\\s*:(?!:))`).test(code)

/**
 * For each module, its exports that reach an engine function (named directly, or through a local
 * declaration or an import from another of the modules that does), each with whether it takes the
 * mode (names `mode`, `x.mode` included, or `EngineMode` in its own code).
 */
function reachingExports(modules: Record<string, string>): Map<string, Map<string, boolean>> {
  const decls = new Map(Object.entries(modules).map(([path, source]) => [path, declarations(source)]))
  const imports = new Map(Object.entries(modules).map(([path, source]) => [path, runtimeImports(source).map(({ spec, names: n }) => ({ target: resolve(path, spec), names: n }))]))
  const reaching = new Map<string, Set<string>>([...decls.keys()].map((p) => [p, new Set<string>()]))
  for (const [path, ds] of decls) for (const [name, d] of ds) if (namesEngine(d.code).length > 0) reaching.get(path)?.add(name)
  let grew = true
  while (grew) {
    grew = false
    for (const [path, ds] of decls) {
      const here = reaching.get(path) ?? new Set<string>()
      const imported = (imports.get(path) ?? []).flatMap(({ target, names: n }) => n.filter((x) => reaching.get(target)?.has(x)))
      for (const [name, d] of ds) {
        if (here.has(name)) continue
        if ([...here, ...imported].some((other) => other !== name && names(d.code, other))) {
          here.add(name)
          grew = true
        }
      }
    }
  }
  return new Map(
    [...decls].map(([path, ds]) => [
      path,
      new Map([...ds].filter(([name, d]) => d.exported && reaching.get(path)?.has(name)).map(([name, d]) => [name, /(?<![\w$])(mode|EngineMode)\b/.test(d.code)])),
    ]),
  )
}

// ---------------------------------------------------------------------------------------------
// (b) and (c): run every helper in tester mode and collect what it returns

/** Every spy on an engine name, by "module name". */
type Spy = { mock: { calls: unknown[][] } }
function engineSpies(): [string, Spy][] {
  return Object.entries(ENGINE_MODULES).flatMap(([path, mod]) =>
    engineNames(path).map((name): [string, Spy] => {
      const fn = mod[name]
      if (!vi.isMockFunction(fn)) throw new Error(`${path} ${name} is not spied`)
      return [`${path} ${name}`, fn]
    }),
  )
}

const SETTINGS: readonly Settings[] = [richSettings, richSettingsFlagged]
const todaysCheck = richHistory.morningChecks.find((c) => c.date === RICH_TODAY) as MorningCheck
const lateCheckRecord: MorningCheck = { id: 'mc-2026-12-06', date: '2026-12-06', appliesTo: null, stiffnessUnder30Min: false, worseThanYesterday: true, visibleSwelling: false, warmth: false, painChangePoints: 2, redFlags: ['rom-worse'], loggedOn: RICH_TODAY }

/** Outputs checked for shape only: the training load view, whose words are kept unchanged for testers. */
const exempt: unknown[] = []

function runTesterMode(): unknown[] {
  const out: unknown[] = []
  const push = (...values: unknown[]) => out.push(...values)
  const byId = new Map(PROGRAM.exercises.map((e) => [e.id, e]))
  const nameOf = (id: string) => byId.get(id)?.name ?? id
  for (const settings of SETTINGS) {
    for (const today of RICH_TODAYS) {
      const view = todayView({ mode: MODE, today, settings, history: richHistory, program: PROGRAM })
      push(view, yesterdayLogged(today, richHistory, PROGRAM.templates), ownFlagLines(today, richHistory.morningChecks, PROGRAM.redFlags))
      if (view.body.kind === 'lift' && view.body.template) {
        for (const gym of richLocations) {
          for (const minutes of [null, 30, 75]) {
            push(liftPlanView(MODE, { template: view.body.template, week: view.body.week, settings, history: richHistory, gym, before: today, minutes, label: view.body.label, byId, items: PROGRAM.equipment }))
          }
        }
      }
      push(previewView({ mode: MODE, date: today, today: RICH_TODAY, settings, history: richHistory, program: PROGRAM }))
      push(gatesView({ mode: MODE, today, settings, history: richHistory, program: PROGRAM, locations: richLocations, aclRsiEntries: richAclRsi }))
      for (const location of richLocations) {
        push(loggerView({ mode: MODE, today: RICH_TODAY, picked: { date: today, type: null }, settings, history: richHistory, program: PROGRAM, gym: { name: location.name, available: sessionModule.availableAt({ location, kit: settings.kit }) } }))
      }
    }
    for (const week of [1, 2, 3, 4, 5, 6, 14]) push(weekView({ mode: MODE, today: RICH_TODAY, selected: week, settings, history: richHistory, program: PROGRAM }))
    const progressed = progressView({ mode: MODE, today: RICH_TODAY, settings, history: richHistory, program: PROGRAM, hrSettings: { id: 'heart-rate', maxHr: 185, restingHr: 52 }, vo2Readings: [{ date: '2026-12-01', vo2: 44 }], koosEntries: richKoos })
    // Training load and its warning are kept for testers in words, unchanged (the decision): shape-checked, but their words are their own.
    push({ ...progressed, records: [], training: null })
    exempt.push(progressed.training)
    for (const row of progressed.exercises) push(exerciseView({ records: progressed.records, setLogs: richHistory.setLogs, row, injuredSide: settings.injuredSide, catalog: PROGRAM.exercises }))

    // The morning check.
    const after = afterSave(MODE, settings, todaysCheck)
    expect(after).toBe(settings)
    expect(withTodaysFlags(MODE, settings, richHistory.morningChecks, RICH_TODAY)).toBe(settings)
    push(checkResultView(MODE, { check: todaysCheck, settings: after }, PROGRAM), lateResultView(MODE, lateCheckRecord, PROGRAM))
    push(lateChanges(MODE, { check: lateCheckRecord, today: RICH_TODAY, settings, history: richHistory, program: PROGRAM }))
    for (const workout of richHistory.workouts) push(nextTimeView(MODE, { subject: { kind: 'workout', workout }, settings, history: richHistory, gym: { location: richHome, kit: settings.kit }, program: PROGRAM }))
    push(existingCheckLine(MODE, todaysCheck), formWords(false, MODE), formWords(true, MODE), formIntros(MODE, false, PROGRAM), formIntros(MODE, true, PROGRAM), tagIntro(MODE), lateFormLine(MODE))

    // Preview, the planner and the runner.
    for (const template of PROGRAM.templates) {
      for (const week of [1, 4, 6]) {
        const plan = planFor(MODE, { template, week, settings, history: richHistory, gym: { location: richHome, kit: settings.kit }, before: RICH_TODAY })
        push(plan)
        if (plan.mode === 'tester') push(writtenFit(plan.slots, settings.restTimerSeconds, 40, { warmUpMinutes: 10 }))
        push(previewSlotsFor(MODE, { template, week, date: RICH_TODAY, today: RICH_TODAY, settings, history: richHistory, gym: { location: richMarriott, kit: settings.kit }, items: PROGRAM.equipment, nameOf }))
      }
    }
    for (const workout of richHistory.workouts) {
      const template = PROGRAM.templates.find((t) => t.id === workout.templateId)
      if (!template) continue
      const sets = richHistory.setLogs.filter((s) => s.workoutId === workout.id)
      for (const location of richLocations) {
        const plan = runnerPlan(MODE, { template, workout, settings, history: richHistory, gym: { location, kit: settings.kit }, stored: { 'p1a-1': 'goblet-squat-bench' }, minutes: location.id === richHome.id ? null : 40, sets, late: false })
        push(plan)
        for (const rs of plan.plans) {
          const slotSets = sets.filter((s) => s.slotId === rs.plan.slot.id)
          const base = { rs, slotSets, sessionSets: sets, allSets: richHistory.setLogs, injuredSide: settings.injuredSide, painPerSet: settings.painPerSet, swapped: plan.chosen[rs.plan.slot.id] !== undefined, late: false }
          for (const step of [null, ...plan.steps.filter((s) => s.slotId === rs.plan.slot.id)]) {
            const model = cardModel(MODE, { ...base, step, editing: null })
            push(model)
            if (model?.draft) push(loadBlocked(MODE, model, model.draft))
          }
          const editing: SetLog | undefined = slotSets[0]
          if (editing) push(cardModel(MODE, { ...base, step: null, editing }))
          for (const side of ['left', 'right', 'both'] as const) {
            const target = setTarget(rs, side)
            expect(target?.rackCapped).toBe(false)
            push(target)
          }
          push(holdsOffFor(plan.unswapped.find((u) => u.plan.slot.id === rs.plan.slot.id), plan.engineBySlot.get(rs.plan.slot.id), location.dumbbellMaxLb))
        }
      }
      push(summaryBlocks(MODE, summaryTemplateFor(MODE, template, richHistory, settings, workout), sets, settings.injuredSide))
      push(summaryCheckLine({ mode: MODE, workout, today: RICH_TODAY, startDate: settings.startDate, history: richHistory }))
      push(complianceLine(sessionCompliance({ slots: template.slots, workout, sets, phaseWeek: summaryPhaseWeek(MODE, workout, settings, richHistory) }), MODE))
    }
    push(redFlagRunnerLine(MODE, settings), deloadBadge(MODE), notLoggedWords({ notLogged: ['1 Leg press'], notFinished: ['2 Seated leg curl'] }, false, MODE))

    // Settings, Program and the rest of the words.
    push(redFlagView(MODE, settings.redFlag, PROGRAM.redFlags))
    push(settingsOnImportWords(MODE, settingsOnImport(settings, { ...richSettings, redFlag: { active: true, since: '2026-12-01', items: ['numbness'] } }), PROGRAM.redFlags, PROGRAM.phases))
    push(keptDownPeriodWords(richHistory.downPeriods ?? [], [], '2026-12-01', MODE))
    push(phaseScreen(settings, RICH_TODAY, richHistory.programOverrides ?? [], richHistory.downPeriods ?? [], MODE), programControls(MODE))
    // The location editor's "What this changes", with a stored period across a band boundary: Phase 3 entered in week 4, Dec 5 to 8 (PROGRAM-QUESTIONS 231).
    const banded = { ...settings, currentPhase: 3, phaseEnteredWeek: 4 }
    const periods = [...(richHistory.downPeriods ?? []), downPeriod.newDownPeriod({ today: '2026-12-05', days: 4, declaredAt: '2026-12-05T13:00:00.000Z' })]
    for (const today of RICH_TODAYS) {
      for (const location of richLocations) {
        const phaseWeek = coverageWeek(banded, today, periods, MODE)
        push(changesView({ templates: templatesAsRun(banded, richHistory.programOverrides ?? []), phase: 3, phaseWeek, phaseEnteredWeek: 4, byId, available: sessionModule.availableAt({ location, kit: settings.kit }), items: PROGRAM.equipment, gymName: location.name }))
      }
    }
    for (const run of richHistory.runs) push(loggedWords(MODE, run, RICH_TODAY, richHistory.morningChecks, true))
  }
  for (const reason of ['tester', 'signed-out', 'unconfirmed'] as ModeReason[]) push(modeLine({ mode: 'tester', reason }))
  push(sideNote(MODE), phaseNote(MODE), progressLead(MODE), aclRsiLead(MODE), aclRsiSavedLine(MODE), rackNote(25, MODE), usedByWords({ exerciseIds: [], runSwap: 'elliptical-swap', warmUp: false }, new Map(), MODE))
  push(discardWords(MODE), endWords(MODE, 0), endWords(MODE, 4), dayChoicesNote(MODE), painRequiredWords(MODE), previewDayLine(MODE, 'run'), logLateNote(MODE))
  return out
}

let outputs: unknown[] = []
const calledInTester: string[] = []

beforeAll(() => {
  vi.clearAllMocks()
  outputs = runTesterMode()
  for (const [name, spy] of engineSpies()) if (spy.mock.calls.length > 0) calledInTester.push(name)
})

describe('(b) tester mode never invokes the engine', () => {
  it('runs every helper and the planner over the rich history', () => {
    expect(outputs.length).toBeGreaterThan(1000)
    expect(engineSpies().length).toBeGreaterThan(60)
  })
  it('no engine spy was called', () => {
    expect(calledInTester).toEqual([])
  })
  it("self-test: full mode does reach the spies", () => {
    vi.clearAllMocks()
    todayView({ mode: 'full', today: RICH_TODAY, settings: richSettings, history: richHistory, program: PROGRAM })
    runnerPlan('full', { template: PROGRAM.templates[0] ?? (undefined as never), workout: richHistory.workouts[0] ?? (undefined as never), settings: richSettings, history: richHistory, gym: { location: richHome, kit: richSettings.kit }, stored: {}, minutes: null, sets: [], late: false })
    const called = engineSpies().filter(([, spy]) => spy.mock.calls.length > 0).map(([name]) => name)
    expect(called).toEqual(expect.arrayContaining(['/src/rules/redFlags.ts stopMessage', '/src/app/session.ts planSession', '/src/rules/prescription.ts prescribe', '/src/rules/history.ts subjectReadings']))
  })
})

// ---------------------------------------------------------------------------------------------
// (c) Shape and words

/** Keys that carry the engine's answers; present only empty (null, false, [], none) in tester mode. */
const FORBIDDEN_KEYS: readonly string[] = ['reading', 'readings', 'result', 'prescriptions', 'prescription', 'suggestion', 'stop', 'ramp', 'ramps', 'budget', 'budgetLine', 'pass', 'passes', 'advance', 'clean', 'tags', 'refs', 'swapCall', 'lateFlags', 'downPeriod', 'downPeriods', 'checkNote', 'holdsOff']

function empty(value: unknown): boolean {
  return value === null || value === undefined || value === false || (Array.isArray(value) && value.length === 0)
}

/** Every forbidden key with a value, and every `capped: true`, anywhere in an output, by path. */
function shapeLeaks(value: unknown, path = '$', seen = new Set<unknown>()): string[] {
  if (value === null || typeof value !== 'object' || seen.has(value)) return []
  seen.add(value)
  if (value instanceof Map) return [...value.values()].flatMap((v, i) => shapeLeaks(v, `${path}<${i}>`, seen))
  if (value instanceof Set) return [...value].flatMap((v, i) => shapeLeaks(v, `${path}{${i}}`, seen))
  return Object.entries(value as Record<string, unknown>).flatMap(([key, v]) => {
    const here = `${path}.${key}`
    const own = (FORBIDDEN_KEYS.includes(key) && !empty(v)) || (key === 'capped' && v === true) ? [here] : []
    return [...own, ...shapeLeaks(v, here, seen)]
  })
}

/** Every string anywhere in an output. */
function strings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') return [value]
  if (value === null || typeof value !== 'object' || seen.has(value)) return []
  seen.add(value)
  if (value instanceof Map) return [...value.values()].flatMap((v) => strings(v, seen))
  if (value instanceof Set) return [...value].flatMap((v) => strings(v, seen))
  return Object.values(value as Record<string, unknown>).flatMap((v) => strings(v, seen))
}

/** program.md's own words, as the seed carries them, longest first: written content may say "hold". */
const PROGRAM_WORDS: readonly string[] = [...new Set(strings(PROGRAM))].filter((s) => s.length >= 8).sort((a, b) => b.length - a.length)
const withoutProgramWords = (text: string) => PROGRAM_WORDS.reduce((t, w) => (t.includes(w) ? t.split(w).join(' ') : t), text)

const READING_WORDS = /\bclean\b|\bhold\b|\bback[ -]off\b|ortho or PT|progression|suspended|Stop\.|prescri|engine|whole knee|budget|warm-up set|suggest|\breads?\b(?!-only)|paus/i

describe('(c) tester outputs carry no engine answer, in shape or in words', () => {
  it('self-test: the walk finds a reading, a stop and a capped target, and lets an empty field through', () => {
    expect(shapeLeaks({ a: { reading: { result: 'hold' } } })).toEqual(['$.a.reading', '$.a.reading.result'])
    expect(shapeLeaks({ stop: null, suggestion: null, refs: [], capped: false })).toEqual([])
    expect(shapeLeaks({ target: { capped: true } })).toEqual(['$.target.capped'])
    expect(READING_WORDS.test('Session A reads hold')).toBe(true)
    // "Read-only" says what a screen lets you do, not what the knee reads.
    expect(READING_WORDS.test('Read-only. On a tester account the phase stays where it is.')).toBe(false)
    expect(READING_WORDS.test(withoutProgramWords('Flattest route you have. Elliptical instead if the knee reads Hold'))).toBe(false)
  })

  it('no output has a reading, a prescription, a suggestion, a stop, a ramp, a budget, a verdict or a cap', () => {
    const leaks = [...outputs, ...exempt].flatMap((o, i) => shapeLeaks(o, `#${i}`))
    expect(leaks).toEqual([])
  })

  it('no output string reads the knee, once program.md’s own words are taken out', () => {
    const hits = [...new Set(outputs.flatMap((o) => strings(o)))].map(withoutProgramWords).filter((s) => READING_WORDS.test(s))
    expect(hits).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// (d) Full is the same planner

describe('(d) full mode is the engine’s planner exactly', () => {
  it('planFor(full) is planSession over every template and week', () => {
    for (const template of PROGRAM.templates) {
      for (const week of [1, 2, 3, 4, 5, 6]) {
        const input = { template, week, settings: richSettings, history: richHistory, gym: { location: richHome, kit: richSettings.kit }, before: RICH_TODAY }
        expect(planFor('full', input)).toStrictEqual({ mode: 'full', slots: planSession(input) })
      }
    }
  })
  it('the tester planner is the written session, and reads no date', () => {
    const template = PROGRAM.templates[0]
    if (!template) throw new Error('seed')
    const input = { template, week: 5, settings: richSettings, history: richHistory, gym: { location: richHome, kit: richSettings.kit } }
    expect(planFor('tester', { ...input, before: addDays(RICH_TODAY, -3), pauseDate: '2026-12-01' })).toStrictEqual({ mode: 'tester', slots: writtenSession(input) })
  })
})
