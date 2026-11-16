import { describe, expect, it } from 'vitest'
import type { History } from '../db/repo.ts'
import { homeLocation } from '../db/migrations.ts'
import { exerciseById, program } from '../program/program.ts'
import { addDays, scheduledSession, weekOf } from '../rules/calendar.ts'
import { newDownPeriod } from '../rules/downPeriod.ts'
import { lateStartedAt } from '../rules/retro.ts'
import { slotsForPhaseWeek } from '../rules/session.ts'
import {
  AclRsiEntry,
  AddedSlot,
  DEFAULT_KIT,
  GateTest,
  KoosEntry,
  Location,
  MorningCheck,
  ProgramOverride,
  Run,
  SetLog,
  Settings,
  Workout,
  type Exercise,
  type IsoDate,
  type RunType,
  type SessionMove,
  type SetSide,
  type Slot,
} from '../schema/index.ts'

/*
 * The rich logged history (M-U3, test-only; imported by nothing in the app): six program weeks from
 * the seed, Monday Nov 2, 2026, right knee, with every kind of thing the engine reads. The full-mode
 * pin (src/screens/fullMode.snapshot.test.ts) snapshots today's outputs over it, and the tester-mode
 * guard (src/rules/engineMode.guard.test.ts) runs every view helper over it to prove nothing in the
 * engine is reached. Named `.test.ts` so the guards' test exemptions (a down period, tags, the late
 * mark) cover it; its own test only checks the fixture against the schemas.
 *
 * What it holds: lifts that read clean twice, hold, back off, climb, and a stopped set; a unilateral
 * slot, an injured-only slot, a height-then-load, a range-then-load and a stage slot; a rack-capped
 * set, a swap, a late lift, an in-progress lift today; runs of every type including a swap; on-time
 * and late morning checks, a missing one, today's with a red flag ticked, and tags; a moved day; a
 * down period; gate tests; KOOS and ACL-RSI entries; an added exercise and a Program edit.
 */

export const RICH_START: IsoDate = '2026-11-02'
/** Saturday of week 6: Session C is in progress, this morning's check has Locking ticked. */
export const RICH_TODAY: IsoDate = '2026-12-12'
/** A "today" in each of weeks 1, 4 (deload) and 6, for the helpers that take one. */
export const RICH_TODAYS: readonly IsoDate[] = ['2026-11-04', '2026-11-24', '2026-11-26', '2026-12-08', RICH_TODAY]
const AT = '2026-11-01T13:00:00.000Z'

export const richSettings: Settings = Settings.parse({
  injuredSide: 'right',
  startDate: RICH_START,
  dumbbellMax: 80,
  restTimerSeconds: 90,
  painPerSet: true,
  currentPhase: 1,
  phaseEnteredWeek: 1,
})

/** The second variant: the red flag on from this morning's check, and Phase 3 entered in week 5. */
export const richSettingsFlagged: Settings = {
  ...richSettings,
  painPerSet: false,
  currentPhase: 3,
  phaseEnteredWeek: 5,
  redFlag: { active: true, since: RICH_TODAY, items: ['locking'] },
}

export const richHome: Location = homeLocation(80, program.planetFitness, RICH_START, program.equipmentListVersion)
/** A hotel gym: no leg press of either kind, no Smith machine, and a 25 lb rack. */
export const richMarriott: Location = Location.parse({
  ...richHome,
  id: 'loc-marriott',
  name: 'Marriott Downtown',
  startedFrom: 'empty',
  present: richHome.present.filter((id) => !['seated-leg-press', 'leg-press-45', 'smith-machine', 'seated-leg-curl'].includes(id)),
  dumbbellMaxLb: 25,
})
export const richLocations: readonly Location[] = [richHome, richMarriott]

const MOVES: SessionMove[] = [{ id: 'move-000001', week: 2, dayA: 'tue', dayB: 'wed' }]

function loadable(e: Exercise): boolean {
  if (e.loadType === 'step-height') return e.holdsLoad !== undefined
  return !['bodyweight', 'time', 'band'].includes(e.loadType)
}

function loadFor(e: Exercise, week: number): number {
  if (!loadable(e)) return 0
  if (e.loadType === 'dumbbell-each' || e.loadType === 'dumbbell-single' || e.holdsLoad !== undefined) return Math.min(15 + 5 * week, 40)
  if (e.loadUnit === 'plate') return 4 + week
  return 60 + 10 * week
}

function sidesOf(slot: Slot): SetSide[] {
  if (slot.injuredOnly) return ['right']
  return slot.unilateral ? ['right', 'left'] : ['both']
}

/** Pain per set for a slot in a week: the patterns the readings are meant to see. */
function painFor(templateId: string, slot: Slot, week: number, setNumber: number): number {
  if (week === 3 && slot.id === 'p1a-1') return 4 // hold
  if (week === 4 && slot.id === 'p1c-1') return 6 // back-off
  if (week === 4 && slot.id === 'p1a-2') return [1, 3, 5][setNumber - 1] ?? 5 // climbing
  if (week === 6 && templateId === 'p1-a') return 3
  return week <= 2 ? 1 : 2
}

function liftSets(workout: Workout, slots: readonly Slot[], week: number, stamp: (n: number) => string): SetLog[] {
  const out: SetLog[] = []
  let tick = 0
  for (const slot of slots) {
    if (slot.optional) continue
    // Week 5's Session B squat ran as its first substitution (a swap); everything else runs its own.
    const exerciseId = week === 5 && slot.id === 'p1b-1' ? (slot.substitutionIds[0] ?? slot.exerciseId) : slot.exerciseId
    const exercise = exerciseById(exerciseId)
    const sets = week === 4 ? Math.max(2, Math.floor((slot.sets * 2) / 3)) : slot.sets
    for (const side of sidesOf(slot)) {
      for (let n = 1; n <= sets; n += 1) {
        const stopped = week === 5 && slot.id === 'p1c-2' && n === 2
        const count = slot.repsMax - (side === 'left' ? 0 : n === sets ? 1 : 0)
        const set: SetLog = {
          id: `${workout.id}:${slot.id}:${side}:${n}`,
          workoutId: workout.id,
          slotId: slot.id,
          exerciseId: exercise.id,
          setNumber: n,
          side,
          load: loadFor(exercise, week),
          loadUnit: exercise.holdsLoad !== undefined ? 'lb' : exercise.loadUnit,
          ...(slot.repUnit === 'seconds' ? { seconds: count } : { reps: count }),
          ...(slot.rpeTarget !== undefined ? { rpe: Math.min(10, slot.rpeTarget + (n === sets ? 0.5 : 0)) } : {}),
          painDuring: painFor(workout.templateId, slot, week, n),
          stopped,
          ...(stopped ? { stopReason: 'sharp-joint-line-pain' as const } : {}),
          ...(slot.heightIn !== undefined ? { heightIn: slot.heightIn } : {}),
          ...(slot.rangeStopDeg !== undefined ? { rangeStopDeg: slot.rangeStopDeg } : {}),
          ...(exercise.stages ? { stage: Math.min(week > 3 ? 1 : 0, exercise.stages.length - 1) } : {}),
          ...(week === 3 && slot.id === 'p1c-4' ? { rackCapped: true } : {}),
          loggedAt: stamp(tick),
        }
        tick += 1
        out.push(SetLog.parse(set))
        if (stopped) break
      }
    }
  }
  return out
}

const RUN_MILES: Record<string, number> = { mbr: 3, easy: 3.5, long: 5 }

function build(): History {
  const workouts: Workout[] = []
  const setLogs: SetLog[] = []
  const runs: Run[] = []
  for (let date = RICH_START; date <= RICH_TODAY; date = addDays(date, 1)) {
    const { week, session } = scheduledSession(date, RICH_START, program.weeklyTemplate, MOVES)
    if (session === null || session === 'off') continue
    if (session.startsWith('lift:')) {
      const letter = session.slice(5)
      const template = program.templates.find((t) => t.phase === 1 && t.letter === letter)
      if (!template) continue
      const today = date === RICH_TODAY
      const late = date === '2026-11-19'
      const workout = Workout.parse({
        id: `${date}-${template.id}`,
        date,
        templateId: template.id,
        phase: 1,
        week,
        isDeload: week === 4,
        startedAt: late ? lateStartedAt(date) : `${date}T22:00:00.000Z`,
        ...(today || late ? {} : { finishedAt: `${date}T23:05:00.000Z`, sessionRpe: week === 4 ? 5 : 7, durationMinutes: 62 }),
        status: today ? 'in-progress' : 'finished',
        // Week 5's Session A ran at the hotel gym.
        ...(date === '2026-12-01' ? { locationId: richMarriott.id } : { locationId: richHome.id }),
      })
      workouts.push(workout)
      const slots = slotsForPhaseWeek(template, weekOf(date, RICH_START))
      const stamp = (n: number) => `${date}T22:${String(5 + n).padStart(2, '0')}:00.000Z`
      if (today) {
        // Today's Session C, in progress: two sets of the step-up logged on the injured side.
        const stepUp = slots.find((s) => s.id === 'p1c-1')
        if (stepUp) {
          for (const n of [1, 2]) {
            setLogs.push(
              SetLog.parse({
                id: `${workout.id}:p1c-1:right:${n}`,
                workoutId: workout.id,
                slotId: 'p1c-1',
                exerciseId: 'step-up',
                setNumber: n,
                side: 'right',
                load: 20,
                loadUnit: 'lb',
                reps: 10 - n,
                rpe: 6,
                painDuring: 2,
                stopped: false,
                heightIn: stepUp.heightIn,
                loggedAt: stamp(n),
              }),
            )
          }
        }
      } else {
        setLogs.push(...liftSets(workout, slots, week, stamp))
      }
      continue
    }
    const type = session.slice(4) as RunType
    // Week 3's easy run became an elliptical swap.
    const swap = week === 3 && type === 'easy'
    runs.push(
      Run.parse({
        id: `run-${date}`,
        date,
        type: swap ? 'elliptical-swap' : type,
        miles: swap ? 0 : (RUN_MILES[type] ?? 3) + (week === 4 ? -1 : 0),
        minutes: swap ? 35 : ((RUN_MILES[type] ?? 3) * 10),
        effort: 'easy',
        ...(week % 2 === 0 ? { rpe: 4, avgHr: 142, maxHr: 161 } : {}),
        maxPain: week === 4 && type === 'long' ? 5 : 1,
        strides: type === 'mbr' && week > 2,
        tempo: false,
        locationId: richHome.id,
      }),
    )
  }
  // A run logged late, nine days back, with no check after it.
  runs.push(Run.parse({ id: 'run-2026-12-03-late', date: '2026-12-03', type: 'easy', miles: 2, minutes: 22, effort: 'easy', maxPain: 2, strides: false, tempo: false }))

  const check = (date: IsoDate, over: Partial<MorningCheck> = {}): MorningCheck =>
    MorningCheck.parse({ id: `mc-${date}`, date, appliesTo: null, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [], ...over })
  const morningChecks: MorningCheck[] = []
  for (let date = addDays(RICH_START, 1); date <= RICH_TODAY; date = addDays(date, 1)) {
    if (date === '2026-12-06' || date === '2026-12-04') continue // missing: the lift and the run before them go without
    if (date === '2026-12-02') {
      // The morning after week 5's Session A, logged late with a flag.
      morningChecks.push(check(date, { loggedOn: '2026-12-05', redFlags: ['giving-way'], painChangePoints: 1 }))
      continue
    }
    if (date === RICH_TODAY) {
      morningChecks.push(check(date, { redFlags: ['locking'], tags: ['poor-sleep', 'brace'], notes: 'Stiff on the stairs.' }))
      continue
    }
    if (date === '2026-11-20') {
      morningChecks.push(check(date, { worseThanYesterday: true, painChangePoints: 1, tags: ['long-sitting'] }))
      continue
    }
    if (date === '2026-11-29') {
      morningChecks.push(check(date, { visibleSwelling: true, painChangePoints: 2, tags: ['on-feet'] }))
      continue
    }
    morningChecks.push(check(date, date.endsWith('5') || date.endsWith('8') ? { tags: ['brace'] } : {}))
  }

  const gateTests: GateTest[] = [
    GateTest.parse({ id: 'gt-1', date: '2026-12-05', gate: 1, item: 'g1-stance', valueInjured: 0, valueOther: 0, pass: true, manual: true }),
    GateTest.parse({ id: 'gt-2', date: '2026-12-05', gate: 1, item: 'sl-leg-press-10rm', valueInjured: 70, valueOther: 100, pass: false, manual: false }),
    GateTest.parse({ id: 'gt-3', date: '2026-12-08', gate: 1, item: 'sl-leg-press-10rm', valueInjured: 85, valueOther: 100, pass: true, manual: false }),
  ]
  const programOverrides: ProgramOverride[] = [
    ProgramOverride.parse({ slotId: 'p1a-2', cues: ['Slow on the way back.', 'Hips down.'], substitutionIds: ['stability-ball-leg-curl', 'lying-leg-curl'], editedOn: '2026-11-15' }),
  ]
  const addedSlots: AddedSlot[] = [AddedSlot.parse({ id: 'added-p1-a-1', templateId: 'p1-a', exerciseId: 'pallof-press', sets: 2, repsMin: 10, repsMax: 12, addedOn: '2026-11-15' })]
  return {
    workouts,
    setLogs,
    morningChecks,
    runs,
    gateTests,
    sessionMoves: MOVES,
    programOverrides,
    addedSlots,
    downPeriods: [newDownPeriod({ today: '2026-11-30', days: 4, declaredAt: AT, note: 'A cold.' })],
  }
}

export const richHistory: History = build()

export const richKoos: KoosEntry[] = [KoosEntry.parse({ date: '2026-11-09', p1: 1, p2: 2, sy1: 1, a1: 0, sp1: 2, q1: 2 }), KoosEntry.parse({ date: '2026-12-07', p1: 0, p2: 1, sy1: 1, a1: 0, sp1: 1, q1: 1 })]
export const richAclRsi: AclRsiEntry[] = [
  AclRsiEntry.parse({ date: '2026-12-07', i1: 6, i2: 7, i3: 6, i4: 7, i5: 6, i6: 7, i7: 6, i8: 7, i9: 6, i10: 7, i11: 6, i12: 7 }),
]

describe('the rich fixture', () => {
  it('is valid against the schemas and holds what it says', () => {
    expect(richHistory.workouts.length).toBeGreaterThanOrEqual(17)
    expect(richHistory.workouts.some((w) => w.status === 'in-progress' && w.date === RICH_TODAY)).toBe(true)
    expect(richHistory.setLogs.some((s) => s.stopped)).toBe(true)
    expect(richHistory.setLogs.some((s) => s.rackCapped)).toBe(true)
    expect(richHistory.setLogs.some((s) => s.side === 'left')).toBe(true)
    expect(richHistory.runs.some((r) => r.type === 'elliptical-swap')).toBe(true)
    expect(richHistory.morningChecks.some((c) => c.loggedOn !== undefined)).toBe(true)
    expect(richHistory.morningChecks.find((c) => c.date === RICH_TODAY)?.redFlags).toEqual(['locking'])
    expect(Settings.parse(richSettingsFlagged).redFlag.active).toBe(true)
    expect(DEFAULT_KIT.length).toBeGreaterThan(0)
  })
})
