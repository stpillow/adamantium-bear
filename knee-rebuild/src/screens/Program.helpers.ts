import { PROGRAM } from '../app/session.ts'
import type { EngineMode } from '../rules/engineMode.ts'
import type { Block } from '../rules/markdown.ts'
import { plainText } from '../rules/markdown.ts'
import { addableSubstitutions, cleanCue, cueLength, editedParts, overridesBySlot, slotEdit, substitutionProblem, type Edited, type SlotEdit } from '../rules/overrides.ts'
import { slotsForPhaseWeek } from '../rules/session.ts'
import { CUE_MAX, showsText, type DownPeriod, type Exercise, type IsoDate, type ProgramOverride, type Settings, type Slot } from '../schema/index.ts'
import { coverageWeek, currentTemplates, shortDate } from './LocationEditor.helpers.ts'

/*
 * The Program screen (`#/program`, M6 brief section 1): the current phase's three sessions as they
 * run this week, each slot read-only until Edit, the editor for its cues and substitutions, and
 * program.md as reference. Words and view models only; the decisions are src/rules/overrides.ts's.
 */

/**
 * The catalog by id: for names, and handed to the overrides as the runner hands it (`planSession`),
 * so an edit naming an id it no longer has, or one the slot can't count or step (an imported file's;
 * the repo refuses one), is dropped here as it is there, and the screen shows the lists that run.
 */
const BY_ID: ReadonlyMap<string, Exercise> = new Map(PROGRAM.exercises.map((e) => [e.id, e]))
export const KNOWN_EXERCISES: ReadonlyMap<string, Exercise> = BY_ID

const nameOf = (id: string) => BY_ID.get(id)?.name ?? id

/** An exercise's name from the catalog; its id when the catalog no longer has it. */
export function exerciseName(id: string): string {
  return nameOf(id)
}

/** The third view, the published studies (Batch F), is read from src/screens/Evidence.helpers.ts; this file only names it. */
export type ProgramView = 'phase' | 'reference' | 'evidence'
export const VIEW_CHOICES: readonly { value: ProgramView; label: string }[] = [
  { value: 'phase', label: 'This phase' },
  { value: 'reference', label: 'program.md' },
  { value: 'evidence', label: 'Evidence' },
]

export const REFERENCE_LEAD = 'program.md as written, for reference. The app runs on its transcription, with your slot edits on top; program.md itself never changes.'

export interface SlotRow {
  /** program.md's slot, for the editor. */
  slot: Slot
  id: string
  /** The row number as program.md prints it: "1", "8a", "plyo". */
  label: string
  exerciseName: string
  /** program.md's "Sets × reps" cell, verbatim. */
  prescriptionText: string
  /** The cues as they run: Shawn's when edited, else program.md's. */
  cues: string[]
  /** The substitutions' names as they run, in order. */
  substitutions: string[]
  edited: boolean
  /** "Grouped with 6 and 7.", "Optional.": what else program.md says about the slot's place. */
  notes: string[]
}

export interface SessionSection {
  templateId: string
  heading: string
  rows: SlotRow[]
}

export interface PhaseScreen {
  lead: string
  sessions: SessionSection[]
  /** Phase 4: its sessions aren't written. Null otherwise. */
  notWritten: string | null
}

/** "Grouped with 6 and 7.": the other slots in this slot's superset this week, in session order; null for a slot on its own. */
export function groupWords(slot: Slot, slots: readonly Slot[]): string | null {
  if (!slot.groupId) return null
  const others = slots.filter((s) => s.groupId === slot.groupId && s.id !== slot.id).map((s) => s.label)
  if (others.length === 0) return null
  const list = others.length === 1 ? others[0] : `${others.slice(0, -1).join(', ')} and ${others[others.length - 1]}`
  return `Grouped with ${list}.`
}

/**
 * The current phase's sessions, A then B then C, each with the slots that run this week of the
 * phase (`slotsForPhaseWeek`, from the week Today plans, a down period's held band included), every
 * slot with its edits laid over it.
 */
/** What the Program screen lets a mode do (M-U3, PROGRAM-QUESTIONS 232): a tester reads the program; only full mode edits a slot or adds an exercise. */
export function programControls(mode: EngineMode): { canEdit: boolean } {
  return { canEdit: mode === 'full' }
}

export function phaseScreen(settings: Settings, today: IsoDate, overrides: readonly ProgramOverride[], downPeriods: readonly DownPeriod[], mode: EngineMode = 'full'): PhaseScreen {

  const phase = PROGRAM.phases.find((p) => p.number === settings.currentPhase)
  const name = phase ? `Phase ${phase.number}, ${phase.name}` : `Phase ${settings.currentPhase}`
  const templates = currentTemplates(settings)
  if (templates.length === 0) {
    return {
      lead: `${name}.`,
      sessions: [],
      notWritten: `Phase ${settings.currentPhase}’s sessions are not written yet; program.md says they come once Gate 3 is clean. Its preview is under program.md.`,
    }
  }
  // Held where a down period holds the bands, so this week's sessions are the ones Today plans (PROGRAM-QUESTIONS 188).
  // Tester mode (M-U3): the calendar's phase week, with no down period holding a band, and nothing to edit.
  const phaseWeek = coverageWeek(settings, today, downPeriods, mode)
  const bySlot = overridesBySlot(overrides)
  return {
    lead: mode === 'tester' ? `${name}: week ${phaseWeek} of the phase, as written. A tester account can’t edit it.` : `${name}: week ${phaseWeek} of the phase. Read-only until you tap Edit on a slot.`,
    notWritten: null,
    sessions: templates.map((template) => {
      const slots = slotsForPhaseWeek(template, phaseWeek)
      return {
        templateId: template.id,
        heading: `Session ${template.letter}`,
        rows: slots.map((slot) => {
          const override = bySlot.get(slot.id)
          const edit = slotEdit(slot, override, KNOWN_EXERCISES)
          const parts = editedParts(slot, override, KNOWN_EXERCISES)
          const group = groupWords(slot, slots)
          return {
            slot,
            id: slot.id,
            label: slot.label,
            exerciseName: nameOf(slot.exerciseId),
            prescriptionText: slot.prescriptionText,
            cues: [...edit.cues],
            substitutions: edit.substitutionIds.map(nameOf),
            edited: parts.cues || parts.substitutions,
            notes: [...(group ? [group] : []), ...(slot.optional ? ['Optional.'] : [])],
          }
        }),
      }
    }),
  }
}

/** "Edited Nov 16: your cues, program.md’s substitutions.": which lists are Shawn's, and since when; null when neither is. */
export function editedDetail(edited: Edited, editedOn: IsoDate): string | null {
  if (!edited.cues && !edited.substitutions) return null
  const which = edited.cues && edited.substitutions ? 'your cues and substitutions' : edited.cues ? 'your cues, program.md’s substitutions' : 'your substitutions, program.md’s cues'
  return `Edited ${shortDate(editedOn)}: ${which}.`
}

export interface EditorView {
  /** The lists as they run: what the editor starts from. */
  edit: SlotEdit
  substitutions: { id: string; name: string }[]
  edited: Edited
  detail: string | null
  /** program.md's own cues, shown beside edited ones; null when the cues are program.md's. */
  writtenCues: string[] | null
  /** program.md's own substitutions by name, beside an edited list; null when the list is program.md's. */
  writtenSubstitutions: string[] | null
}

/** What the editor shows for a slot: its lists as they run, what is edited, and program.md's lists beside an edited one. */
export function editorView(slot: Slot, override: ProgramOverride | undefined): EditorView {
  const edit = slotEdit(slot, override, KNOWN_EXERCISES)
  const edited = editedParts(slot, override, KNOWN_EXERCISES)
  return {
    edit,
    substitutions: edit.substitutionIds.map((id) => ({ id, name: nameOf(id) })),
    edited,
    detail: override ? editedDetail(edited, override.editedOn) : null,
    writtenCues: edited.cues ? [...slot.cues] : null,
    writtenSubstitutions: edited.substitutions ? slot.substitutionIds.map(nameOf) : null,
  }
}

/**
 * What the order of a slot's substitutions does, under the list. The back-off is the engine's
 * easier version (src/rules/prescription.ts): the next entry after the exercise the slot is on that
 * this gym has, so each entry is also the back-off for the one before it (PROGRAM-QUESTIONS 79, 84).
 */
export const SUBSTITUTION_ORDER_NOTE =
  'In this order, the gym moves the slot on when something isn’t here, Swap offers them, and a back-off on bodyweight work steps from the exercise the slot is on to the next one after it that this gym has.'

/** "Back to program.md's", asked once inline before the slot's edits go. */
export const RESET_ASK = 'Put this slot back to program.md’s cues and substitutions? Your edits to it go.'

/** A cue's length is said from this many characters on, as it nears the 200 limit. */
export const CUE_COUNT_FROM = 160

/** "187 of 200 characters.", "214 of 200 characters: 14 over.", counted as the cue would be stored; null well under the limit. */
export function cueCountWords(text: string): string | null {
  const length = cueLength(text)
  if (length < CUE_COUNT_FROM) return null
  return length > CUE_MAX ? `${length} of ${CUE_MAX} characters: ${length - CUE_MAX} over.` : `${length} of ${CUE_MAX} characters.`
}

/**
 * A new cue typed but not added when the editor closes (Done editing, or another slot's Edit): the
 * text is kept in the slot's new-cue field (program/drafts.ts, so the program.md view and other
 * tabs keep it too, until the app closes), and the slot says so under it, quoting the cue as it
 * would be stored, so nothing typed goes without a word. Null when the field holds no words.
 */
export function unaddedCueWords(text: string): string | null {
  const cue = cleanCue(text)
  if (!showsText(cue)) return null
  return `Your new cue wasn’t added yet: “${cue}”. It waits in the new-cue field; tap Edit, then Add cue.`
}

/** What came off the list, said beside "Put it back". */
export function removedWords(kind: 'cue' | 'substitution', text: string): string {
  return kind === 'cue' ? `Removed the cue “${text}”.` : `Removed ${text} from the substitutions.`
}

/** A pattern's name in words: "Single-leg", "Hip". */
export function patternWords(pattern: string): string {
  return `${pattern.charAt(0).toUpperCase()}${pattern.slice(1)}`
}

export interface AddGroup {
  heading: string
  exercises: Exercise[]
}

/**
 * Add's offer in sections: the slot's own pattern first (named after its exercise), then every other
 * pattern; never an exercise the slot can't count or step (`substitutionProblem`, PROGRAM-QUESTIONS
 * 130), which the repo would refuse on save.
 */
export function addSections(slot: Slot, edit: SlotEdit, catalog: readonly Exercise[]): { same: AddGroup; others: AddGroup[]; otherCount: number } {
  const addable = addableSubstitutions(slot, edit, catalog)
  const fits = (e: Exercise) => substitutionProblem(slot, e) === null
  const samePattern = addable.samePattern.filter(fits)
  const others = addable.others.filter(fits)
  const own = catalog.find((e) => e.id === slot.exerciseId)
  const patterns = [...new Set(others.map((e) => e.pattern))]
  return {
    same: { heading: own ? `${patternWords(own.pattern)}, like ${own.name}` : 'Same pattern', exercises: samePattern },
    others: patterns.map((p) => ({ heading: patternWords(p), exercises: others.filter((e) => e.pattern === p) })),
    otherCount: others.length,
  }
}

/**
 * program.md's chart images by the path the file names them by, with each file's own width and
 * height (a test reads them from the PNGs), set on the image so the browser holds its place while
 * it loads and the reference doesn't jump under a thumb.
 */
export const CHART_SIZES: Readonly<Record<string, { width: number; height: number }>> = {
  'media/image1.png': { width: 1344, height: 416 },
  'media/image2.png': { width: 1344, height: 582 },
}

/** A table stays a grid only when it fits a phone: four columns at most, every cell short. Longer ones stack, row by row. */
export const GRID_CELL_MAX = 24

export function tableLayout(table: Extract<Block, { kind: 'table' }>): 'grid' | 'stacked' {
  if (table.header.length > 4) return 'stacked'
  const long = [...table.header, ...table.rows.flat()].some((cell) => plainText(cell).length > GRID_CELL_MAX)
  return long ? 'stacked' : 'grid'
}
