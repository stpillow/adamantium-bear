import { z } from 'zod'
import { Day, Effort, IsoDate, IsoDateTime, LoadUnit, Pain, ReadingResult, Rpe, RunType, SetSide, Side, StopReason, WholeRpe, WorkoutStatus } from './enums.ts'
import { EquipmentId, Slot } from './program.ts'

const id = z.string().min(1)

/** The gym every install starts at, and where a workout with no `locationId` happened (M4b). */
export const PLANET_FITNESS_LOCATION_ID = 'planet-fitness'

/** The two items program.md says to bring (its "Bring" row); a seed test keeps this in step with the list. */
export const DEFAULT_KIT: readonly EquipmentId[] = ['ankle-strap', 'mini-band']

const uniqueIds = (ids: readonly string[]) => new Set(ids).size === ids.length

/** Characters that take no room on screen: zero-width spaces and joiners, fillers and variation selectors (Unicode's default-ignorable code points), and the blank braille cell. */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\u2800]/gu

/** Text with the characters that take no room on screen taken out. */
export function withoutInvisible(text: string): string {
  return text.replace(INVISIBLE, '')
}

/** Whether text shows anything on screen: a letter, digit, punctuation mark or symbol once the invisible characters are out ("\u200B" or "ㅤ" alone shows nothing). */
export function showsText(text: string): boolean {
  return /[\p{L}\p{N}\p{P}\p{S}]/u.test(withoutInvisible(text))
}

/** Whether a YYYY-MM-DD date falls on a Monday, read on whole UTC days as src/rules/calendar.ts reads dates. */
function onMonday(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number)
  if (y === undefined || m === undefined || d === undefined) return false
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1
}

/** The rest timer's range, in seconds: what the Settings stepper offers, and all a stored row or a backup file may hold. */
export const REST_TIMER_MIN = 15
export const REST_TIMER_MAX = 600

/** One row, held in Dexie. Also carries the export and import controls' state. */
export const Settings = z.strictObject({
  injuredSide: Side,
  /** Week 1's Monday: weeks start Monday (PROMPT rule 10), so the form takes only a Monday and an imported file is held to the same. */
  startDate: IsoDate.refine(onMonday, 'the start date is a Monday, the day weeks start'),
  /**
   * Heaviest dumbbell on the rack. Presets 60, 75, 80. Frozen from M4b: each gym's own
   * `Location.dumbbellMaxLb` takes over, and the home gym is first written from this value.
   */
  dumbbellMax: z.number().int().positive(),
  restTimerSeconds: z.number().int().min(REST_TIMER_MIN).max(REST_TIMER_MAX),
  /** Pain per set when true; once per exercise when false. */
  painPerSet: z.boolean(),
  /** The phase the app is in. Advances only when Shawn confirms a gate, never by the calendar. */
  currentPhase: z.number().int().min(1).max(4).default(1),
  /** The program week the current phase was entered in; week-banded slots count from it. */
  phaseEnteredWeek: z.number().int().min(1).default(1),
  /** Set by any ticked red flag on a morning check; cleared from Settings with a note. */
  redFlag: z
    .strictObject({
      active: z.boolean(),
      since: IsoDate.optional(),
      items: z.array(id),
      clearedOn: IsoDate.optional(),
      clearNote: z.string().optional(),
    })
    .default({ active: false, items: [] }),
  /** The gym Today plans for; it stays until Shawn changes it (M4b). */
  activeLocationId: id.default(PLANET_FITNESS_LOCATION_ID),
  /** What Shawn carries to every gym, as equipment ids. */
  kit: z.array(EquipmentId).refine(uniqueIds, 'kit lists each item once').default(() => [...DEFAULT_KIT]),
  /**
   * When this phone last wrote a backup file (M6): the export's `exportedAt`, or an imported file's.
   * Absent means never. It belongs to the phone, not to the data, so a backup file leaves it out
   * (src/rules/backup.ts), and Reset all data clears it.
   */
  lastExportedAt: IsoDateTime.optional(),
})
export type Settings = z.infer<typeof Settings>

/** Typed equipment kept as text ("Something else here?") runs 1 to this many characters, trimmed: a name, not a pasted message. */
export const EXTRA_TEXT_MAX = 80

/**
 * A gym Shawn trains at (M4b, design section 2). `present` holds what is there; dumbbells are the
 * max, not an item (0 means none); things typed that program.md doesn't name are `extras`, kept
 * as text for the next program update and never treated as equipment.
 */
export const Location = z.strictObject({
  id,
  /** 1 to 60 characters once trimmed, showing something: a name of zero-width spaces would be a blank row on Today. */
  name: z.string().trim().min(1).max(60).refine(showsText, 'a gym’s name shows a letter, digit or symbol'),
  present: z.array(EquipmentId).refine(uniqueIds, 'present lists each item once'),
  /** Heaviest dumbbell on the rack, in pounds; 0 means no dumbbells. */
  dumbbellMaxLb: z.number().int().nonnegative(),
  startedFrom: z.enum(['planet-fitness', 'empty']),
  /** Program.equipmentListVersion when this gym's list was made; items added to the program's list later are new to it. */
  listVersion: z.number().int().positive(),
  extras: z.array(z.strictObject({ id, text: z.string().trim().min(1).max(EXTRA_TEXT_MAX), addedOn: IsoDate })),
  /** Items marked not here from the runner or Today, and since when. */
  markedOff: z.array(z.strictObject({ id: EquipmentId, on: IsoDate })),
  createdOn: IsoDate,
  /** Archived gyms leave the list but stay stored: workouts point at them. */
  archived: z.boolean(),
})
export type Location = z.infer<typeof Location>

/** A session's minutes as Finish, End or the Summary store them: the stepper's range, in whole minutes (metrics phase 1). */
export const DURATION_MIN = 1
export const DURATION_MAX = 300

/** One per lift day. */
export const Workout = z.strictObject({
  id,
  date: IsoDate,
  templateId: id,
  phase: z.number().int().min(1).max(4),
  week: z.number().int().min(1),
  isDeload: z.boolean(),
  startedAt: IsoDateTime.optional(),
  finishedAt: IsoDateTime.optional(),
  maxPainDuring: Pain.optional(),
  /**
   * How hard the whole session was, 1 to 10, asked at Finish (metrics phase 1). Stored only when
   * Shawn rated it; without it, training load reads the average of the sets' RPE
   * (src/rules/trainingLoad.ts). Reopen clears it.
   */
  sessionRpe: WholeRpe.optional(),
  /**
   * How long the session took, in whole minutes, from the stepper on Finish or End (preset from the
   * sets' times, or an estimate for a late entry), or added later from the Summary. Not the runner's
   * time window, which decides what runs. Reopen clears it.
   */
  durationMinutes: z.number().int().min(DURATION_MIN).max(DURATION_MAX).optional(),
  notes: z.string().optional(),
  status: WorkoutStatus,
  /** The gym, stamped at Start. Absent means Planet Fitness: every workout before M4b was there. */
  locationId: id.optional(),
})
export type Workout = z.infer<typeof Workout>

/** One logged set. `exerciseId` is stored because a swap changes which exercise the slot ran. */
export const SetLog = z.strictObject({
  id,
  workoutId: id,
  slotId: id,
  exerciseId: id,
  setNumber: z.number().int().positive(),
  /** Required on unilateral slots; the injured side is logged first. */
  side: SetSide,
  load: z.number().nonnegative(),
  loadUnit: LoadUnit,
  reps: z.number().int().nonnegative().optional(),
  seconds: z.number().nonnegative().optional(),
  rpe: Rpe.optional(),
  painDuring: Pain.optional(),
  stopped: z.boolean().default(false),
  stopReason: StopReason.optional(),
  heightIn: z.number().positive().optional(),
  rangeStopDeg: z.number().positive().optional(),
  /** Index into the exercise's stages for the `stage` rule. */
  stage: z.number().int().nonnegative().optional(),
  /** The gym's rack stopped the load short of the prescription; such a set never counts as clean. */
  rackCapped: z.boolean().optional(),
  loggedAt: IsoDateTime.optional(),
}).refine((set) => (set.reps === undefined) !== (set.seconds === undefined), {
  message: 'a set logs reps or seconds, exactly one of them',
})
export type SetLog = z.infer<typeof SetLog>

/** Four taps plus an optional note, the morning after a session. */
export const MorningCheck = z.strictObject({
  id,
  date: IsoDate,
  appliesTo: z
    .strictObject({ kind: z.enum(['workout', 'run']), id })
    .nullable(),
  stiffnessUnder30Min: z.boolean(),
  worseThanYesterday: z.boolean(),
  visibleSwelling: z.boolean(),
  warmth: z.boolean(),
  /** Pain change versus the day before, in points. */
  painChangePoints: z.number().int().min(-10).max(10),
  /** Red flag ids ticked. Any entry puts the app in the red-flag state. */
  redFlags: z.array(id),
  notes: z.string().optional(),
})
export type MorningCheck = z.infer<typeof MorningCheck>

/** A run's heart rate fields take whole beats per minute inside this range; anything outside is a watch misread, not a measurement (metrics phase 2). */
export const RUN_HR_MIN = 30
export const RUN_HR_MAX = 250

/** Swaps count as the week's session but add no miles. */
export const Run = z.strictObject({
  id,
  date: IsoDate,
  type: RunType,
  miles: z.number().nonnegative(),
  minutes: z.number().nonnegative(),
  /**
   * The effort word: written by the run logger from `rpe` (1–3 easy, 4–6 moderate, 7–10 hard), and
   * all a run logged before metrics phase 1 has, read then as RPE 3, 5 or 8.
   */
  effort: Effort,
  /** Effort as rated, 1 to 10 whole (metrics phase 1). Absent on runs logged before it. */
  rpe: WholeRpe.optional(),
  /** Average heart rate, whole bpm, from a watch via Strava or typed (metrics phase 2). Absent means no heart rate, never 0. */
  avgHr: z.number().int().min(RUN_HR_MIN).max(RUN_HR_MAX).optional(),
  /** Max heart rate on the run, whole bpm, same sources (metrics phase 2). Absent means no heart rate, never 0. */
  maxHr: z.number().int().min(RUN_HR_MIN).max(RUN_HR_MAX).optional(),
  maxPain: Pain,
  strides: z.boolean().default(false),
  tempo: z.boolean().default(false),
  /** https and strava.com only: this gets rendered as a link. */
  stravaUrl: z.url({ protocol: /^https$/, hostname: /^(www\.)?strava\.com$/ }).optional(),
  notes: z.string().optional(),
  /** Where a swap (elliptical or rower) was done. Absent means Planet Fitness, or a run outside. */
  locationId: id.optional(),
}).refine((r) => r.avgHr === undefined || r.maxHr === undefined || r.avgHr <= r.maxHr, { message: 'average heart rate is at or under max', path: ['avgHr'] })
export type Run = z.infer<typeof Run>

/** Shawn's max heart rate as Settings takes it, in whole bpm: the stepper's range, and all a stored row or a backup may hold (metrics phase 2). */
export const HR_MAX_MIN = 120
export const HR_MAX_MAX = 230
/** Shawn's resting heart rate, same deal. Its top sits under HR_MAX_MIN, so any stored pair already has resting under max. */
export const HR_RESTING_MIN = 25
export const HR_RESTING_MAX = 100

/**
 * The heart-rate numbers TRIMP needs (metrics phase 2), in a one-row table of their own
 * (src/db/db.ts, Dexie version 7), never on the settings row: older builds parse that row strictly
 * on every read, so a new key there would brick a rollback (PROGRAM-QUESTIONS 132, 150). Both
 * fields are optional: a stepper touch saves only the touched number, and the app never invents
 * the other one. The HR load is computed only when both are set.
 */
export const HrSettings = z
  .strictObject({
    id: z.literal('heart-rate'),
    /** Max heart rate, whole bpm. */
    maxHr: z.number().int().min(HR_MAX_MIN).max(HR_MAX_MAX).optional(),
    /** Resting heart rate, whole bpm. */
    restingHr: z.number().int().min(HR_RESTING_MIN).max(HR_RESTING_MAX).optional(),
  })
  .refine((s) => s.maxHr === undefined || s.restingHr === undefined || s.restingHr < s.maxHr, { message: 'resting heart rate is under max', path: ['restingHr'] })
export type HrSettings = z.infer<typeof HrSettings>

/** A gate test entry. Hop tests store three trials per side and keep the best. */
export const GateTest = z.strictObject({
  id,
  date: IsoDate,
  gate: z.number().int().min(1).max(3),
  item: id,
  valueInjured: z.number().nonnegative(),
  valueOther: z.number().nonnegative(),
  trialsInjured: z.array(z.number().nonnegative()).optional(),
  trialsOther: z.array(z.number().nonnegative()).optional(),
  pass: z.boolean(),
  manual: z.boolean(),
  notes: z.string().optional(),
})
export type GateTest = z.infer<typeof GateTest>

/** Computed, never stored. */
export const Reading = z.strictObject({
  subject: z.strictObject({ kind: z.enum(['workout', 'run', 'exercise']), id }),
  result: ReadingResult,
  reasons: z.array(z.string()),
})
export type Reading = z.infer<typeof Reading>

/** A session moved within its week: the two days swap what they hold (PROMPT rule 10). */
export const SessionMove = z.strictObject({
  id,
  week: z.number().int().positive(),
  dayA: Day,
  dayB: Day,
})
export type SessionMove = z.infer<typeof SessionMove>

/** A cue written on the Program screen runs 1 to this many characters once trimmed (M6). */
export const CUE_MAX = 200

/** One cue as Shawn wrote it: one line of plain text, 1 to 200 characters once trimmed, showing something. */
export const Cue = z
  .string()
  .trim()
  .min(1)
  .max(CUE_MAX)
  .refine((text) => !/\p{Cc}/u.test(text), 'a cue is one line of plain text')
  .refine(showsText, 'a cue shows a letter, digit or symbol')
export type Cue = z.infer<typeof Cue>

/**
 * A slot's edits from the Program screen (M6, Dexie version 4): its cues and its substitutions as
 * Shawn rewrote them, laid over program.md's slot (`applyOverrides`), never written into it. An
 * absent field is program.md's own; "Back to program.md's" deletes the row. Whether the
 * substitutions are exercises from the catalog, and never the slot's own, is checked against the
 * seed (`overrideProblems`, src/rules/overrides.ts) before the row is written.
 */
export const ProgramOverride = z
  .strictObject({
    slotId: Slot.shape.id,
    cues: z.array(Cue).optional(),
    substitutionIds: Slot.shape.substitutionIds.refine(uniqueIds, 'substitutions list each exercise once').optional(),
    editedOn: IsoDate,
  })
  .refine((o) => o.cues !== undefined || o.substitutionIds !== undefined, { message: 'an override edits the cues, the substitutions, or both' })
export type ProgramOverride = z.infer<typeof ProgramOverride>

/** The most exercises Shawn can add to one session, and the most sets one added exercise takes. */
export const ADDED_SLOTS_MAX = 6
export const ADDED_SETS_MAX = 6

/**
 * An exercise Shawn added to a session (Dexie version 5): the template it joins (a phase's A, B or
 * C), the catalog exercise and the sets and rep range he chose. Whether the exercise can be added,
 * and the slot it becomes (rule, units, order), is `slotFromAdded` in src/rules/addedSlots.ts;
 * the seed is never written, the engine lays the slot after the template's own.
 */
export const AddedSlot = z
  .strictObject({
    id: Slot.shape.id,
    templateId: id,
    exerciseId: Slot.shape.exerciseId,
    sets: z.number().int().min(1).max(ADDED_SETS_MAX),
    repsMin: Slot.shape.repsMin,
    repsMax: Slot.shape.repsMax,
    addedOn: IsoDate,
  })
  .refine((a) => a.repsMax >= a.repsMin, { message: 'the top of the range is not below the bottom', path: ['repsMax'] })
export type AddedSlot = z.infer<typeof AddedSlot>
