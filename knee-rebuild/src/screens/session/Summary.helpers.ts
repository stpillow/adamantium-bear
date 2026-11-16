import { exerciseById } from '../../program/program.ts'
import type { SessionCompliance } from '../../rules/compliance.ts'
import type { EngineMode } from '../../rules/engineMode.ts'
import { sessionReading } from '../../rules/reading.ts'
import type { ReadingResult, SessionTemplate, SetLog, Side } from '../../schema/index.ts'
import { loadWords, showsLoad, sideWords, stopReasonLabel } from '../SessionRunner.helpers.ts'

/*
 * The Summary's set count in words (Batch B, PROGRAM-QUESTIONS 163). The count itself comes from
 * src/rules/compliance.ts; this only says it. The restriction is in the line ("of the 3 exercises
 * run"), never only in the small print, so "All 9" can't read as the whole session.
 */

const sets = (n: number) => `${n} ${n === 1 ? 'set' : 'sets'}`

/**
 * "All 9 prescribed sets of the 3 exercises run." / "7 of 9 prescribed sets of the 4 exercises run, plus 1 extra set; 1 stopped early."
 * Null with nothing logged. In tester mode the sets are program.md's, so they are "written" sets (M-U3).
 */
export function complianceLine(c: SessionCompliance, mode: EngineMode): string | null {
  const word = mode === 'tester' ? 'written' : 'prescribed'
  if (c.prescribed === 0) return c.extra > 0 ? `No ${word} exercise logged a set; ${sets(c.extra)} extra.` : null
  const head = c.logged === c.prescribed ? `All ${c.prescribed} ${word} ${c.prescribed === 1 ? 'set' : 'sets'}` : `${c.logged} of ${c.prescribed} ${word} sets`
  const exercises = `of the ${c.exercises} ${c.exercises === 1 ? 'exercise' : 'exercises'} run`
  const extra = c.extra > 0 ? `, plus ${c.extra} extra ${c.extra === 1 ? 'set' : 'sets'}` : ''
  const stopped = c.stopped > 0 ? `; ${c.stopped} stopped early` : ''
  return `${head} ${exercises}${extra}${stopped}.`
}

/** The small print under it, when a slot the session runs this week logged nothing; null otherwise. */
export function complianceNote(c: SessionCompliance): string | null {
  if (!c.excluded || c.prescribed === 0) return null
  return 'Counts the exercises that logged a set. Anything skipped or dropped for time isn’t stored, so it isn’t counted.'
}

export interface SummaryBlock {
  key: string
  label: string
  name: string
  lines: string[]
  /** "Stopped: sharp joint-line pain." */
  stopped: string | null
  /** Full mode only: the exercise's session reading and why. Tester mode reads nothing (M-U3). */
  reading?: { result: ReadingResult; because: string | null }
}

interface ExerciseBlock {
  exerciseId: string
  label: string
  sets: SetLog[]
}

/** The logged exercises in slot order, one block per exercise (a mid-session swap gives two). */
export function exerciseBlocks(template: SessionTemplate, logged: readonly SetLog[]): ExerciseBlock[] {
  const blocks: ExerciseBlock[] = []
  for (const slot of template.slots) {
    const slotSets = logged.filter((s) => s.slotId === slot.id)
    for (const id of Array.from(new Set(slotSets.map((s) => s.exerciseId)))) {
      blocks.push({ exerciseId: id, label: slot.label, sets: slotSets.filter((s) => s.exerciseId === id) })
    }
  }
  return blocks
}

function sideLines(block: ExerciseBlock, injuredSide: Side): string[] {
  const exercise = exerciseById(block.exerciseId)
  const sides = Array.from(new Set(block.sets.map((s) => s.side))).sort((a, b) => (a === injuredSide || a === 'both' ? -1 : b === injuredSide ? 1 : 0))
  return sides.map((side) => {
    const sideSets = block.sets.filter((s) => s.side === side).sort((a, b) => a.setNumber - b.setNumber)
    const counts = sideSets.map((s) => s.seconds ?? s.reps ?? 0).join(', ')
    const load = showsLoad(exercise) ? `${loadWords(sideSets.at(-1)?.load ?? 0, exercise)} × ` : ''
    const label = sideWords(side, injuredSide)
    return `${label ? `${label}: ` : ''}${load}${counts}`
  })
}

/**
 * The Summary's exercise blocks: what was logged per side, a stop, and in full mode each exercise's
 * session reading (`sessionReading`). Tester mode never asks for a reading.
 */
export function summaryBlocks(mode: EngineMode, template: SessionTemplate, logged: readonly SetLog[], injuredSide: Side): SummaryBlock[] {
  return exerciseBlocks(template, logged).map((block) => {
    const stop = block.sets.find((s) => s.stopped)
    const base = {
      key: `${block.label}-${block.exerciseId}`,
      label: block.label,
      name: exerciseById(block.exerciseId).name,
      lines: sideLines(block, injuredSide),
      stopped: stop ? `Stopped: ${stopReasonLabel(stop.stopReason).toLowerCase()}.` : null,
    }
    if (mode === 'tester') return base
    const reading = sessionReading(block.sets, injuredSide)
    return { ...base, reading: { result: reading.result, because: reading.reasons.length > 0 ? reading.reasons.join('; ') : null } }
  })
}
