import { PROGRAM, currentTemplate } from '../app/session.ts'
import { weekOf } from '../rules/calendar.ts'
import { bandWeek } from '../rules/downPeriod.ts'
import { forNextProgramUpdate, type Available, type ChecklistGroup, type ChecklistItem, type CoverageMove, type ExerciseLookup, type RunSwapType } from '../rules/equipment.ts'
import { phaseWeekOf } from '../rules/session.ts'
import { RACK_MAX_LB, RACK_STEP_LB, rackValue } from '../rules/locations.ts'
import { applyToTemplate, overridesBySlot } from '../rules/overrides.ts'
import { ifNotHere, nameShows, nameTakenBy, newOnList, phaseCoverage, type SubstitutionRow, type TypedOutcome } from '../rules/whereYouTrain.ts'
import { EXTRA_TEXT_MAX, Location, type DownPeriod, type Equipment, type EquipmentId, type Exercise, type IsoDate, type ProgramOverride, type Requirement, type SessionTemplate, type Settings } from '../schema/index.ts'

/*
 * The location editor (`#/location/:id`, `#/location/new`, M4b design section 5): its choices and
 * every line it shows, in words. What is here, what moves and what typed text means come from
 * src/rules (equipment.ts, whereYouTrain.ts); these only word them.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Nov 10": a stored date in words, read from the string itself, no clock or time zone involved. */
export function shortDate(date: IsoDate): string {
  const [, month, day] = date.split('-').map(Number)
  return `${MONTHS[(month ?? 1) - 1] ?? ''} ${day ?? ''}`.trim()
}

// --- Name -------------------------------------------------------------------

/** A gym's name, as the schema holds it: 1 to 60 characters once trimmed. */
export const NAME_MAX = 60

export type NameCheck = { ok: true; name: string } | { ok: false; message: string }

/**
 * Characters as the schema counts them (Zod's max length counts code points): an emoji is one, not
 * the two UTF-16 units `length` gives, so the count under the field and a refusal match what saves.
 */
export function characterCount(text: string): number {
  return [...text.trim()].length
}

/**
 * Whether a typed name can be saved: something that shows (`nameShows`: not zero-width spaces or
 * fillers alone), the schema's 1 to 60 characters (trimmed), and not the name
 * of another gym the lists offer (`nameTakenBy`), which Today's Change couldn't tell apart. The
 * refusal names that gym as stored, so the typed text's own punctuation never ends up mid-sentence.
 */
export function nameCheck(text: string, locations: readonly Pick<Location, 'id' | 'name' | 'archived'>[], exceptId: string | null): NameCheck {
  const name = text.trim()
  if (name.length === 0) return { ok: false, message: 'A gym needs a name: type the one you will look for on Today.' }
  if (!nameShows(name)) return { ok: false, message: 'A name made only of invisible characters shows as a blank row on Today: type a letter, a digit or a symbol.' }
  if (!Location.shape.name.safeParse(name).success) return { ok: false, message: `That is ${characterCount(name)} characters; a gym’s name fits in ${NAME_MAX}.` }
  const taken = nameTakenBy(locations, name, exceptId)
  if (taken) return { ok: false, message: `${taken.name} already has that name. Pick one Today can tell apart.` }
  return { ok: true, name }
}

/** "12 of 60 characters", under the name field. */
export function nameCountWords(text: string): string {
  return `${characterCount(text)} of ${NAME_MAX} characters`
}

// --- Start and rack -----------------------------------------------------------

export const START_CHOICES: readonly { value: Location['startedFrom']; label: string }[] = [
  { value: 'planet-fitness', label: 'Start from Planet Fitness’s list' },
  { value: 'empty', label: 'Start empty' },
]

/** A new gym's start, preselected: Planet Fitness's list (design section 5). */
export const DEFAULT_START: Location['startedFrom'] = 'planet-fitness'

/**
 * What a new gym starts with, said before it is made. Started from Planet Fitness's list, it gets
 * program.md's list and nothing else (no 45° leg press assumed, PROGRAM-QUESTIONS 71); the words
 * name no one's club (M-U1, PROGRAM-QUESTIONS 211).
 */
export function startWords(startedFrom: Location['startedFrom']): string {
  return startedFrom === 'planet-fitness'
    ? 'Everything on program.md’s Planet Fitness list is marked here to start, and nothing else is. Untick what this gym lacks; tick what it adds.'
    : 'Nothing is marked here to start; tick what this gym has.'
}

/** How a stored gym began, under its title. */
export function startedFromWords(startedFrom: Location['startedFrom']): string {
  return startedFrom === 'planet-fitness' ? 'Started from Planet Fitness’s list.' : 'Started empty.'
}

/** The rack presets (design section 5): none, then the racks a hotel or a club tends to have. */
export const RACK_PRESETS: readonly number[] = [0, 25, 50, 60, 75, 80]
export const RACK_STEP = RACK_STEP_LB
export const RACK_MIN = 0
export const RACK_MAX = RACK_MAX_LB

/** What a rack picked or typed saves as (`rackValue`): the 5 lb at or below it. */
export function rackSaved(lb: number): number {
  return rackValue(lb)
}

/** Under the rack's stepper: its field takes any whole number, and the grid is said in words. */
export const rackGridNote = 'Racks go by 5 lb: a weight typed in between saves as the 5 lb below it.'

/** A preset's label: "None" for no dumbbells, otherwise the pounds. */
export function rackChoiceWords(lb: number): string {
  return lb === 0 ? 'None' : `${lb} lb`
}

/** The line under the rack. */
export function rackNote(lb: number): string {
  return lb === 0
    ? 'No dumbbells: slots that need them move to the next exercise on their list that runs here.'
    : `The heaviest dumbbell is ${lb} lb. A load past it moves the slot, or with nothing to move to, is rack-capped and won’t count as clean.`
}

// --- Checklist ----------------------------------------------------------------

const SWAP_WORDS: Record<RunSwapType, string> = { 'elliptical-swap': 'the Hold-day elliptical swap', 'rower-swap': 'the Hold-day rower swap' }

/**
 * "Used by: Smith machine box squat; Smith machine hip thrust", plus a run swap or the lift warm-up
 * where the item is one. Semicolons, since program.md's names carry their own commas ("Leg press,
 * both legs"; "Copenhagen plank, short lever").
 */
export function usedByWords(entry: Pick<ChecklistItem, 'exerciseIds' | 'runSwap' | 'warmUp'>, byId: ExerciseLookup): string {
  const names = [...new Set(entry.exerciseIds.map((id) => byId.get(id)?.name ?? id))]
  if (entry.runSwap) names.push(SWAP_WORDS[entry.runSwap])
  if (entry.warmUp) names.push('the lift warm-up')
  return `Used by: ${names.join('; ')}`
}

export interface ChecklistRow {
  id: EquipmentId
  /** The Tap's label: the list's name, and "if your club has one" on a hedged item. */
  label: string
  here: boolean
  /** Lines under the Tap, in order: what uses it, the table's "If not here", new on the list, a mark-off. */
  notes: string[]
}

export interface ChecklistSection {
  /** program.md's "Program slot" row. */
  group: string
  rows: ChecklistRow[]
}

/**
 * The checklist (`equipmentChecklist`) as the editor shows it: each item Here or Not here as
 * `available` says (so a mark-off reads Not here, and an item new on Planet Fitness's list reads
 * Here at a gym started from it), with what uses it and the substitution table's row (`ifNotHere`).
 */
export function checklistSections(input: {
  checklist: readonly ChecklistGroup[]
  location: Pick<Location, 'listVersion' | 'markedOff'>
  available: Available
  byId: ExerciseLookup
  vocabulary: readonly Pick<Equipment, 'id' | 'name' | 'aliases'>[]
  table: readonly SubstitutionRow[]
}): ChecklistSection[] {
  return input.checklist.map((group) => ({
    group: group.group,
    rows: group.items.map((entry) => {
      const { item } = entry
      const row = ifNotHere(item.id, input.vocabulary, input.table)
      const mark = input.location.markedOff.find((m) => m.id === item.id)
      const notes = [
        usedByWords(entry, input.byId),
        ...(row ? [`If not here: ${row.useInstead}`] : []),
        ...(newOnList(item, input.location) ? ['New on the program’s list since this gym was made.'] : []),
        ...(mark ? [`Marked not here since ${shortDate(mark.on)}; Here clears the mark.`] : []),
      ]
      return { id: item.id, label: item.hedged ? `${item.name}, if your club has one` : item.name, here: input.available.has(item.id), notes }
    }),
  }))
}

// --- The bag ------------------------------------------------------------------

export interface KitRow {
  id: EquipmentId
  name: string
  inBag: boolean
}

/** "In your bag (every gym)": the items program.md says to bring, each in the bag or not. */
export function kitRows(vocabulary: readonly Pick<Equipment, 'id' | 'name' | 'carried'>[], kit: readonly EquipmentId[]): KitRow[] {
  return vocabulary.filter((item) => item.carried).map((item) => ({ id: item.id, name: item.name, inBag: kit.includes(item.id) }))
}

/** The bag after one item goes in or comes out: each item once, in the list's order, anything else already there kept. */
export function kitAfter(kit: readonly EquipmentId[], id: EquipmentId, inBag: boolean, vocabulary: readonly Pick<Equipment, 'id' | 'carried'>[]): EquipmentId[] {
  const next = new Set(kit.filter((k) => k !== id))
  if (inBag) next.add(id)
  const order = vocabulary.filter((item) => item.carried).map((item) => item.id)
  return [...order.filter((k) => next.has(k)), ...[...next].filter((k) => !order.includes(k))]
}

// --- Something else here? -----------------------------------------------------

/** Typed text inside a sentence: "kettlebells" for "Kettlebells", but "TRX straps" stays as typed. */
export function typedWords(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return /^\p{Lu}\p{Ll}/u.test(t) ? `${t.charAt(0).toLowerCase()}${t.slice(1)}` : t
}

const nameOf = (id: EquipmentId, items: readonly Pick<Equipment, 'id' | 'name'>[]) => items.find((i) => i.id === id)?.name ?? id.replace(/-/g, ' ')

/** What typed equipment comes to, in words (design section 6). `typed` is the text as entered. */
export function outcomeWords(outcome: TypedOutcome, typed: string, items: readonly Pick<Equipment, 'id' | 'name'>[]): string {
  switch (outcome.kind) {
    case 'empty':
      return 'Type what the gym has first.'
    case 'mark':
      return `Matches ${nameOf(outcome.id, items)}. Mark it here?`
    case 'already':
      return `${nameOf(outcome.id, items)} is already marked here.`
    case 'bag':
      return `${nameOf(outcome.id, items)} goes in your bag, not on a gym’s list: In your bag (every gym) says whether you carry it.`
    case 'rack':
      return 'Dumbbells go by the rack: set the heaviest one under Dumbbells.'
    case 'unused':
      return `${nameOf(outcome.id, items)} is on program.md’s list, but no session uses it. Kept for the next program.md update.`
    case 'choose':
      return `Did you mean one of these? Nothing is marked until you tap one.`
    case 'keep':
      return `No exercise in the program uses ${typedWords(typed)}. Kept for the next program.md update.`
  }
}

/** Typed text past `EXTRA_TEXT_MAX` (`extraTooLong`), refused before anything is written: a mistaken paste never lands on the next-update list. */
export function extraTooLongWords(text: string): string {
  return `That is ${characterCount(text)} characters; typed equipment fits in ${EXTRA_TEXT_MAX}. Shorten it to the name of the equipment.`
}

/** After "Mark it here" or a near miss picked: the item is marked here. */
export function markedWords(id: EquipmentId, items: readonly Pick<Equipment, 'id' | 'name'>[]): string {
  return `${nameOf(id, items)} is marked here.`
}

/** The way out of a near-miss list. */
export const KEEP_AS_TYPED = 'Neither: keep as typed'

// --- What this changes --------------------------------------------------------

/**
 * The week of the phase "What this changes" and the Program screen read banded slots by: today's, as
 * Today and the plan read it (from week 1 before the start), so held where a down period holds the
 * bands (`bandWeek`, PROGRAM-QUESTIONS 188).
 */
export function coverageWeek(settings: Pick<Settings, 'startDate' | 'phaseEnteredWeek'>, today: IsoDate, downPeriods: readonly DownPeriod[]): number {
  const calendar = phaseWeekOf(Math.max(weekOf(today, settings.startDate), settings.phaseEnteredWeek), settings.phaseEnteredWeek)
  return bandWeek({ date: today, phaseWeek: calendar, startDate: settings.startDate, phaseEnteredWeek: settings.phaseEnteredWeek, periods: downPeriods })
}

/** The current phase's sessions, A then B then C; none in Phase 4, whose sessions aren't written. */
export function currentTemplates(settings: Settings): SessionTemplate[] {
  return (['A', 'B', 'C'] as const).flatMap((letter) => currentTemplate(settings, letter) ?? [])
}

/** The catalog by id, as `planSession` hands it: an edit naming an exercise the seed no longer has, or one the slot can't count or step, is dropped. */
const KNOWN: ReadonlyMap<string, Exercise> = new Map(PROGRAM.exercises.map((e) => [e.id, e]))

/**
 * The current phase's sessions as they run: the Program screen's edits laid over program.md's
 * lists (`applyToTemplate`, as `planSession` lays them), so "What this changes" names the stand-in
 * the session runs, not the one program.md lists first. program.md's templates are left alone.
 */
export function templatesAsRun(settings: Settings, overrides: readonly ProgramOverride[]): SessionTemplate[] {
  const bySlot = overridesBySlot(overrides)
  return currentTemplates(settings).map((template) => applyToTemplate(template, bySlot, KNOWN))
}

type ItemLike = Pick<Equipment, 'id' | 'name' | 'carried'>

/** A list name inside a sentence: "seated leg press", but "Smith machine", which program.md capitalizes. */
function inSentence(name: string): string {
  return /^Smith\b/.test(name) ? name : `${name.charAt(0).toLowerCase()}${name.slice(1)}`
}

/** What a gym lacks, in words: "no Smith machine", "no cable ankle strap in your bag", each item of an either-or. */
export function lackWords(missing: readonly Requirement[], items: readonly ItemLike[]): string {
  return missing
    .flatMap((r) => (typeof r === 'string' ? [r] : r.anyOf))
    .map((id) => {
      const item = items.find((i) => i.id === id)
      const name = inSentence(item?.name ?? id.replace(/-/g, ' '))
      return item?.carried ? `no ${name} in your bag` : `no ${name}`
    })
    .join(', ')
}

/** One move: "Seated leg press → Goblet squat to a bench (no seated leg press)", or "Nothing here for Step-off landing (no step platforms)". */
export function changeWords(move: CoverageMove, byId: ExerciseLookup, items: readonly ItemLike[]): string {
  const name = (id: string) => byId.get(id)?.name ?? id
  const lack = move.missing.length > 0 ? ` (${lackWords(move.missing, items)})` : ''
  return move.kind === 'none' ? `Nothing here for ${name(move.from)}${lack}` : `${name(move.from)} → ${name(move.to)}${lack}`
}

export interface ChangesView {
  /** The line over the list. */
  heading: string
  /** One per session with something that moves, in session order. */
  sessions: { label: string; lines: string[] }[]
}

/**
 * "What this changes": what moves at the gym for the rest of the current phase (`phaseCoverage`),
 * each session's moves in words, this week's first, then each later block's prefixed with the
 * program week it starts ("From week 11: …"); the heading says when nothing moves, and that Phase 4
 * has no sessions yet.
 */
export function changesView(input: {
  templates: readonly SessionTemplate[]
  phase: number
  /** This week of the phase (`coverageWeek`). */
  phaseWeek: number
  /** The program week the phase was entered, to name a later block's start as a program week. */
  phaseEnteredWeek: number
  byId: ExerciseLookup
  available: Available
  items: readonly ItemLike[]
  gymName: string
}): ChangesView {
  if (input.templates.length === 0) return { heading: `Phase ${input.phase}’s sessions aren’t written yet, so nothing moves at ${input.gymName} yet.`, sessions: [] }
  const sessions = phaseCoverage(input.templates, input.phaseWeek, input.byId, input.available)
    .map((coverage) => ({
      label: `Session ${input.templates.find((t) => t.id === coverage.templateId)?.letter ?? coverage.templateId}`,
      lines: coverage.moves.map((move) => {
        const words = changeWords(move, input.byId, input.items)
        return move.fromPhaseWeek === null ? words : `From week ${input.phaseEnteredWeek + move.fromPhaseWeek - 1}: ${words}`
      }),
    }))
    .filter((session) => session.lines.length > 0)
  if (sessions.length === 0) return { heading: `Every slot of Phase ${input.phase}’s sessions runs its own exercise at ${input.gymName}.`, sessions: [] }
  return { heading: `What moves at ${input.gymName} for the rest of Phase ${input.phase}:`, sessions }
}

// --- Kept for the next program update ----------------------------------------

export interface KeptRow {
  key: string
  /** "Kettlebells, typed Nov 10", or "Treadmill, on program.md’s list". */
  text: string
  /** A typed line's id, which Remove takes back (`removeExtra`); null for a list item, which Not here takes back. */
  extraId: string | null
  /** The typed text, for Remove's ask; null for a list item. */
  typed: string | null
}

/** This gym's lines of the next-update list (`forNextProgramUpdate`): what was typed (with the day), then list items no session uses. */
export function keptRows(
  location: Pick<Location, 'name' | 'present' | 'extras' | 'markedOff'>,
  vocabulary: readonly Pick<Equipment, 'id' | 'name'>[],
  exercises: readonly Pick<Exercise, 'requires' | 'stageRequires'>[],
): KeptRow[] {
  const typed = location.extras.map((extra) => ({ key: `extra:${extra.id}`, text: `${extra.text}, typed ${shortDate(extra.addedOn)}`, extraId: extra.id, typed: extra.text }))
  const listed = forNextProgramUpdate([location], vocabulary, exercises)
    .filter((note) => note.addedOn === undefined)
    .map((note) => ({ key: `item:${note.text}`, text: `${note.text}, on program.md’s list`, extraId: null, typed: null }))
  return [...typed, ...listed]
}

/** Remove's ask, the first of two taps (as Archive's). */
export function removeExtraAsk(typed: string): string {
  return `Take “${typed.trim()}” off this gym and the next-update list? Nothing else changes.`
}

/** After a typed line is taken back. */
export function removedExtraWords(typed: string): string {
  return `“${typed.trim()}” is off the list.`
}
