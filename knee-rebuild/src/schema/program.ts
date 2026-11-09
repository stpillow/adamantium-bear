import { z } from 'zod'
import {
  DaySession,
  GateEvaluator,
  IsoDate,
  LoadType,
  LoadUnit,
  Pattern,
  ProgressionRule,
  RepUnit,
  Rpe,
  SessionLetter,
  Side,
} from './enums.ts'

const kebab = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'expected a kebab-case id')

/** An item on the program's equipment list: a key into `Program.equipment`. */
export const EquipmentId = kebab
export type EquipmentId = z.infer<typeof EquipmentId>

/**
 * One item program.md names as equipment (M4b). The list is the vocabulary a gym is described in:
 * `Location.present` and `Settings.kit` hold these ids, and exercises require them.
 */
export const Equipment = z.strictObject({
  id: EquipmentId,
  name: z.string().min(1),
  /**
   * The first program.md "Program slot" row that lists it, verbatim ("Squat pattern"); for an item no row lists,
   * the row of what it is used for (the weight plate under "Hinge pattern"); "Bring" for the carried items.
   */
  group: z.string().min(1),
  /** A phrase copied verbatim from docs/program.md that names the item; a seed test checks it is there. */
  source: z.string().min(1),
  /** Other names a typed entry may use ("Bosu ball"). Unique across the list, names included. */
  aliases: z.array(z.string().min(1)),
  /** Shawn brings it to every gym (the ankle strap and the mini band); it lives in Settings.kit, not in a gym's list. */
  carried: z.boolean(),
  /** program.md hedges it: "if your club has one". */
  hedged: z.boolean(),
  /** The equipment list version the item first appeared in. */
  addedIn: z.number().int().positive(),
})
export type Equipment = z.infer<typeof Equipment>

/**
 * What an exercise needs: one item, or any one of several where program.md itself says "or"
 * ("on the leg press or Smith", "a folded mat or bosu").
 */
export const Requirement = z.union([EquipmentId, z.strictObject({ anyOf: z.array(EquipmentId).min(2) })])
export type Requirement = z.infer<typeof Requirement>

/**
 * The accessory and core catalog (Batch C, Nov 9; program.md "Accessory and core catalog",
 * PROGRAM-QUESTIONS 169): an exercise no session lists, addable in any phase and offered for extra
 * time, with its own default added prescription, cues and ordered substitutions.
 */
export const Accessory = z
  .strictObject({
    /** Its place in the extra-time pool: 'upper' after the 13 program pulls and pushes, 'core' last (PROGRAM-QUESTIONS 170). */
    tier: z.enum(['upper', 'core']),
    /**
     * Only a hold sets it (the farmer's hold, 'seconds'); absent reads as `addedRepUnit` reads the
     * exercise. Never yards, minutes or steps: those are a carry's, cardio's and a band walk's, which
     * an add refuses (`notAddableReason`) and a slot counts only its own way (`substitutionProblem`).
     */
    repUnit: z.literal('seconds').optional(),
    /** Default sets when added; at most ADDED_SETS_MAX (a seed test checks it against src/schema/log.ts, not imported here to keep the schema free of a cycle). */
    sets: z.number().int().min(1).max(6),
    repsMin: z.number().int().positive(),
    repsMax: z.number().int().positive(),
    cues: z.array(z.string().min(1)).min(1),
    /** Exercise ids to swap to, in order; bodyweight entries list the easier version first, where a back-off moves (PROGRAM-QUESTIONS 49). */
    substitutionIds: z.array(kebab),
  })
  .refine((a) => a.repsMax >= a.repsMin, { message: 'repsMax below repsMin', path: ['repsMax'] })
export type Accessory = z.infer<typeof Accessory>

/** One movement in the catalog. Loads are logged in `loadUnit`; `increment` is the smallest step. */
export const Exercise = z.strictObject({
  id: kebab,
  name: z.string().min(1),
  pattern: Pattern,
  equipment: z.string().min(1),
  loadType: LoadType,
  loadUnit: LoadUnit,
  /** Smallest step in `loadUnit`: 5 lb per dumbbell, 5 lb on a machine stack, 10 lb on the Smith, 2 in. of step. */
  increment: z.number().nonnegative(),
  /** `down` for assisted pull-ups, where less assist is the progression. */
  loadDirection: z.enum(['up', 'down']).default('up'),
  /** Logged per side, injured side first. */
  unilateral: z.boolean(),
  /** When the logged side isn't the obvious one, e.g. the standing leg on cable hip abduction. */
  sideMeaning: z.string().optional(),
  /**
   * The side words program.md writes on every slot of work it doesn't log per side ("each side" on the
   * dead bug, side plank and Pallof press, "each way" on the band walk). A swap or an add onto it from
   * a both-sides slot carries them, so it isn't done on one side only (PROGRAM-QUESTIONS 169(h)).
   * One-legged work says "each leg" through `unilateral` instead.
   */
  perSideLabel: z.string().min(1).optional(),
  /** Step-height exercises: the step rises by this many inches. */
  heightIncrementIn: z.number().positive().optional(),
  /** Step-height exercises that also hold dumbbells. */
  holdsLoad: LoadType.optional(),
  /** Ordered stages for the `stage` progression rule. */
  stages: z.array(z.string().min(1)).min(2).optional(),
  /**
   * The equipment the exercise needs; every entry must hold. Empty means floor and space only.
   * Dumbbells are listed only where they are the movement, not where they only add load (M4b).
   */
  requires: z.array(Requirement),
  /** Per stage, what that stage needs on top of `requires` (the folded mat, the bosu). Parallels `stages`. */
  stageRequires: z.array(z.array(Requirement)).optional(),
  notes: z.string().optional(),
  /** Present only on the accessory and core catalog (Batch C, PROGRAM-QUESTIONS 169). */
  accessory: Accessory.optional(),
}).refine((e) => e.stageRequires === undefined || e.stageRequires.length === (e.stages?.length ?? -1), {
  message: 'stageRequires needs one entry per stage, and stages to go with it',
  path: ['stageRequires'],
}).refine((e) => !(e.unilateral && e.perSideLabel !== undefined), {
  message: 'a one-legged exercise says "each leg" through unilateral, not perSideLabel',
  path: ['perSideLabel'],
})
export type Exercise = z.infer<typeof Exercise>

/** One line of a session template: an exercise plus its prescription, transcribed from program.md. */
export const Slot = z.strictObject({
  id: kebab,
  /** Position in the session, 1-based. Plyo and landing-prep blocks come first. */
  order: z.number().int().positive(),
  /** The row number as program.md prints it: "1", "8a", or "plyo". */
  label: z.string().min(1),
  exerciseId: kebab,
  sets: z.number().int().positive(),
  repsMin: z.number().int().positive(),
  repsMax: z.number().int().positive(),
  repUnit: RepUnit.default('reps'),
  /** The program's own words after the count: "each leg", "each side", "each", "each way". */
  perSideLabel: z.string().min(1).optional(),
  /** Logged per side, injured side first, healthy side on the injured side's rep budget. */
  unilateral: z.boolean().default(false),
  /** Phase 1 balance: injured side only. */
  injuredOnly: z.boolean().default(false),
  rpeTarget: Rpe.optional(),
  /** Where the RPE is written as a range over the phase ("RPE 6→7"). */
  rpeTargetEnd: Rpe.optional(),
  /** Verbatim "Sets × reps" cell from program.md, for display and spot checks. */
  prescriptionText: z.string().min(1),
  cues: z.array(z.string().min(1)),
  progressionRule: ProgressionRule,
  /** Exercise ids to swap to, in order. */
  substitutionIds: z.array(kebab),
  /** Slots sharing a groupId run together (a superset or tri-set); every group has at least two members. */
  groupId: kebab.optional(),
  /** Shown, skippable, never part of a reading. */
  optional: z.boolean().default(false),
  /**
   * The weeks of the phase the slot runs in, counted from the week the phase was entered (1-based),
   * inclusive; a null top means "to the end of the phase". Absent means the whole phase. Phases
   * advance on gate confirmation, so these cannot be calendar weeks (PROGRAM-QUESTIONS 46).
   */
  phaseWeeks: z
    .tuple([z.number().int().min(1), z.number().int().min(1).nullable()])
    .refine(([from, to]) => to === null || to >= from, 'phaseWeeks must not run backwards')
    .optional(),
  /** Step-height slots: where the step starts and where the phase caps it. */
  heightIn: z.number().positive().optional(),
  heightMaxIn: z.number().positive().optional(),
  /** height-then-load: load climbs to this before height moves (PROGRAM-QUESTIONS 2). */
  loadBeforeHeightLb: z.number().nonnegative().optional(),
  /** range-then-load: the knee angle the range stops at this phase (45 or 30). */
  rangeStopDeg: z.number().positive().optional(),
  /** Load guidance that isn't a number: "Bodyweight in week 1, dumbbells after", "heavy". */
  loadNote: z.string().optional(),
})
export type Slot = z.infer<typeof Slot>

export const SessionTemplate = z.strictObject({
  id: kebab,
  phase: z.number().int().min(1).max(3),
  letter: SessionLetter,
  slots: z.array(Slot).min(1),
})
export type SessionTemplate = z.infer<typeof SessionTemplate>

export const Phase = z.strictObject({
  number: z.number().int().min(1).max(4),
  name: z.string().min(1),
  weekStart: z.number().int().min(1),
  /** Null for Phase 4, which has no end written yet. */
  weekEnd: z.number().int().min(1).nullable(),
  /** Estimated dates from program.md; the gates decide the real pace. */
  estimatedDates: z.string().min(1),
  summary: z.string().min(1),
  notes: z.array(z.string().min(1)),
  /** The gate that has to pass to leave this phase. Phase 4 has none yet. */
  gateToLeave: z.number().int().min(1).max(3).nullable(),
  /** Phase 4 preview rungs, until its sessions arrive. */
  preview: z.array(z.string().min(1)).optional(),
})
export type Phase = z.infer<typeof Phase>

export const GateItem = z.strictObject({
  id: kebab,
  /** The criterion, verbatim from program.md. */
  text: z.string().min(1),
  evaluator: GateEvaluator,
  /** symmetry: injured ÷ other must reach this (0.8 or 0.9). */
  threshold: z.number().positive().max(1).optional(),
  /** symmetry: the GateTest.item key the values are read from. */
  testItem: kebab.optional(),
  /** symmetry: hop tests store this many trials per side and keep the best. */
  trials: z.number().int().positive().optional(),
  /**
   * symmetry, timed hops (the 6-meter timed hop, Batch A): the unit is seconds and lower is
   * better, so best = the FASTEST positive trial and the line reads other ÷ injured — a slower
   * injured side reads under 100% (PROGRAM-QUESTIONS 157). Distance hops carry no flag and keep
   * the farther-is-better math.
   */
  timed: z.literal(true).optional(),
  /**
   * acl-rsi: the latest stored questionnaire entry's score (0 to 100) must reach this (76, the
   * strict published threshold; PROGRAM-QUESTIONS 156, 161). Not `threshold`, which is pinned to
   * the 0-to-1 symmetry line.
   */
  minScore: z.number().int().positive().optional(),
  /**
   * symmetry load tests: the two-sided exercise whose latest session that logged both sides
   * prefills the form (PROGRAM-QUESTIONS 25). Hop tests have none; their trials start not entered.
   * A seed test checks every one resolves and is two-sided.
   */
  prefillExerciseId: kebab.optional(),
  /** clean-weeks, no-swelling: the lookback in days. */
  windowDays: z.number().int().positive().optional(),
  /** run-no-reaction: the run has to be at least this long. */
  minMiles: z.number().positive().optional(),
  /** calf-raises: reps per side in one set. */
  minReps: z.number().int().positive().optional(),
})
export type GateItem = z.infer<typeof GateItem>

export const Gate = z.strictObject({
  number: z.number().int().min(1).max(3),
  fromPhase: z.number().int().min(1).max(3),
  toPhase: z.number().int().min(2).max(4),
  /** How program.md introduces it: "Gate 1, to leave Phase 1". */
  title: z.string().min(1),
  items: z.array(GateItem).min(1),
})
export type Gate = z.infer<typeof Gate>

export const MileageWeek = z.strictObject({
  week: z.number().int().min(1).max(12),
  targetMiles: z.number().positive(),
  /**
   * A deload week (4, 8, 12). program.md drops the miles here; Shawn's Nov 1 call holds them flat
   * at the week before instead, so the plan never decreases (PROGRAM-QUESTIONS 1).
   */
  isDown: z.boolean(),
})
export type MileageWeek = z.infer<typeof MileageWeek>

export const RedFlag = z.strictObject({ id: kebab, text: z.string().min(1) })
export type RedFlag = z.infer<typeof RedFlag>

export const WeeklyTemplate = z.strictObject({
  mon: DaySession,
  tue: DaySession,
  wed: DaySession,
  thu: DaySession,
  fri: DaySession,
  sat: DaySession,
  sun: DaySession,
})
export type WeeklyTemplate = z.infer<typeof WeeklyTemplate>

export const WeeklyTemplateRow = z.strictObject({
  day: z.string().min(1),
  session: z.string().min(1),
  notes: z.string(),
})

export const SignalRow = z.strictObject({
  signal: z.string().min(1),
  clean: z.string().min(1),
  hold: z.string().min(1),
  backOff: z.string().min(1),
})

export const SubstitutionRow = z.strictObject({
  takenOrMissing: z.string().min(1),
  useInstead: z.string().min(1),
})

export const EquipmentRow = z.strictObject({ slot: z.string().min(1), equipment: z.string().min(1) })

/**
 * The warm-up sets rule (Shawn, Nov 8, decision 5: "standard ramp"): one rep count per percent of the
 * day's working load, the percents rising and under 1, on the patterns and load types named, never on
 * an exercise that needs any of `excludeRequires`. `text` is program.md's paragraph, verbatim.
 */
export const WarmUpRamp = z
  .strictObject({
    text: z.string().min(1),
    percents: z.array(z.number().gt(0).lt(1)).min(1),
    reps: z.array(z.number().int().positive()).min(1),
    patterns: z.array(Pattern).min(1),
    loadTypes: z.array(LoadType).min(1),
    excludeRequires: z.array(EquipmentId),
  })
  .refine((r) => r.reps.length === r.percents.length && r.percents.every((p, i) => i === 0 || p > (r.percents[i - 1] ?? 1)), {
    message: 'one rep count per percent, the percents rising',
  })
export type WarmUpRamp = z.infer<typeof WarmUpRamp>

export const WarmUp = z.strictObject({
  lift: z.strictObject({
    intro: z.string().min(1),
    bike: z.string().min(1),
    circuit: z.array(z.string().min(1)).min(1),
    /** Minutes for the knee circuit by phase: 5 in Phases 1–2, 3 from Phase 3. */
    circuitMinutesByPhase: z.record(z.string(), z.number().positive()),
    /** The bike's minutes, from the intro: "5 minutes on the upright bike" (the time window counts them, PROGRAM-QUESTIONS 166). */
    bikeMinutes: z.number().int().positive(),
    /** Warm-up sets before the big lifts (Batch C, Nov 9; program.md's warm-up section; PROGRAM-QUESTIONS 165). Display only: src/rules/warmUpRamp.ts. */
    ramp: WarmUpRamp,
  }),
  run: z.string().min(1),
  offDays: z.array(z.string().min(1)),
  recovery: z.array(z.string().min(1)),
})

export const Running = z.strictObject({
  intro: z.string().min(1),
  rules: z.array(z.string().min(1)).min(1),
  phase3: z.string().min(1),
  /** Structured versions of the Phase 3 running notes, for the run logger. */
  strides: z.strictObject({ fromWeek: z.number().int(), day: z.string(), text: z.string() }),
  tempo: z.strictObject({ fromWeek: z.number().int(), day: z.string(), requiresGate: z.number().int(), text: z.string() }),
  fasterFriday: z.strictObject({ fromPhase: z.number().int(), text: z.string() }),
  longRunShare: z.number().positive().max(1),
})

export const Program = z.strictObject({
  title: z.string().min(1),
  sourceDate: IsoDate,
  startDate: IsoDate,
  injuredSide: Side,
  operatingRules: z.strictObject({
    intro: z.string().min(1),
    signals: z.array(SignalRow).min(1),
    triggers: z.array(z.string().min(1)).min(1),
    loading: z.array(z.string().min(1)).min(1),
    /**
     * A down period's length in days (Batch E; its rule is the last of `loading`, transcribed from
     * program.md's loading rules). src/schema/log.ts's DOWN_PERIOD_MIN_DAYS and DOWN_PERIOD_MAX_DAYS
     * mirror it, pinned by src/schema/program.test.ts.
     */
    downPeriod: z
      .strictObject({ minDays: z.number().int().positive(), maxDays: z.number().int().positive() })
      .refine((r) => r.minDays <= r.maxDays, { message: 'a down period’s shortest is not past its longest', path: ['maxDays'] }),
  }),
  weeklyTemplate: WeeklyTemplate,
  weeklyTemplateRows: z.array(WeeklyTemplateRow).length(7),
  weeklyTemplateNote: z.string().min(1),
  equipmentBySlot: z.array(EquipmentRow).min(1),
  phases: z.array(Phase).length(4),
  templates: z.array(SessionTemplate).length(9),
  gates: z.array(Gate).length(3),
  mileagePlan: z.array(MileageWeek).length(12),
  exercises: z.array(Exercise).min(1),
  /** The equipment vocabulary (M4b): everything program.md names as equipment, and nothing it doesn't. */
  equipment: z.array(Equipment).min(1),
  /**
   * What a gym started from "Planet Fitness's list" has: program.md's Planet Fitness, with Shawn's
   * Nov 1 answers about his club. Carried items are not here (they live in Settings.kit), and
   * neither are dumbbells (a gym's dumbbell max says whether it has them).
   */
  planetFitness: z.array(EquipmentId),
  /** Bumped when program.md adds items, so a gym's list can tell what is new since it was made. */
  equipmentListVersion: z.number().int().positive(),
  redFlags: z.array(RedFlag).min(1),
  redFlagsIntro: z.string().min(1),
  notFlags: z.string().min(1),
  warmUp: WarmUp,
  running: Running,
  setupNotes: z.array(z.string().min(1)).min(1),
  substitutionTable: z.array(SubstitutionRow).min(1),
})
export type Program = z.infer<typeof Program>
