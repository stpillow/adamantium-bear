import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { program, templateFor } from '../program/program.ts'
import type { ProgramOverride } from '../schema/index.ts'
import { db } from './db.ts'
import { clearProgramOverride, defaultSettings, ensureLocations, ensureSettings, getProgramOverrides, loadHistory, resetAll, saveProgramOverride } from './repo.ts'

// The Program screen's writes (M6): each one parses the row and checks it against program.md's slot before it reaches IndexedDB.

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false })
  await ensureSettings(defaultSettings(program))
  await ensureLocations(program, '2026-11-02')
})

const edit = (over: Partial<ProgramOverride>): ProgramOverride => ({ slotId: 'p1a-1', editedOn: '2026-11-16', ...over }) as ProgramOverride

describe('saving a slot’s edit', () => {
  it('stores the row, reads it back, and hands it to the engine with the history', async () => {
    const saved = await saveProgramOverride(edit({ cues: ['  Feet high  '], substitutionIds: ['goblet-squat-bench', 'smith-box-squat'] }), program)
    expect(saved).toEqual({ slotId: 'p1a-1', cues: ['Feet high'], substitutionIds: ['goblet-squat-bench', 'smith-box-squat'], editedOn: '2026-11-16' })
    expect(await getProgramOverrides()).toEqual([saved])
    expect((await loadHistory()).programOverrides).toEqual([saved])
  })

  it('replaces the slot’s earlier row, and keeps other slots’ rows', async () => {
    await saveProgramOverride(edit({ cues: ['Feet high'] }), program)
    await saveProgramOverride(edit({ slotId: 'p1a-2', substitutionIds: ['lying-leg-curl'] }), program)
    await saveProgramOverride(edit({ substitutionIds: ['smith-box-squat'], editedOn: '2026-11-17' }), program)
    const rows = await getProgramOverrides()
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.slotId === 'p1a-1')).toEqual({ slotId: 'p1a-1', substitutionIds: ['smith-box-squat'], editedOn: '2026-11-17' })
  })

  it('refuses, in words, a slot program.md doesn’t have, the slot’s own exercise, an exercise not in the catalog, writing nothing', async () => {
    await saveProgramOverride(edit({ cues: ['Feet high'] }), program)
    await expect(saveProgramOverride(edit({ slotId: 'p9a-1', cues: [] }), program)).rejects.toThrow('No slot p9a-1 in the program.')
    await expect(saveProgramOverride(edit({ substitutionIds: ['leg-press'] }), program)).rejects.toThrow('Leg press, both legs is this slot’s own exercise, so it is never its substitution.')
    await expect(saveProgramOverride(edit({ substitutionIds: ['kettlebell-swing'] }), program)).rejects.toThrow('kettlebell-swing is not in the program’s catalog')
    // An exercise the slot can't count or step (PROGRAM-QUESTIONS 130).
    await expect(saveProgramOverride(edit({ slotId: 'p1c-7', substitutionIds: ['suitcase-carry', 'db-rdl'] }), program)).rejects.toThrow(
      'This slot is counted in yards, which only a carry is, so Dumbbell Romanian deadlift can’t stand in here.',
    )
    expect(await getProgramOverrides()).toEqual([{ slotId: 'p1a-1', cues: ['Feet high'], editedOn: '2026-11-16' }])
  })

  it('refuses a row the schema refuses in a sentence, the rule’s own words first: a cue over 200 characters, a repeat, an empty edit, a control character', async () => {
    const refusal = async (row: ProgramOverride) => {
      const error = await saveProgramOverride(row, program).then(
        () => null,
        (e: unknown) => e,
      )
      return error instanceof Error ? error.message : String(error)
    }
    expect(await refusal(edit({ cues: ['x'.repeat(201)] }))).toBe('Cue 1: A cue runs to 200 characters; this one is 201.')
    expect(await refusal(edit({ substitutionIds: ['smith-box-squat', 'smith-box-squat'] }))).toBe('Smith machine box squat is listed twice.')
    expect(await refusal(edit({}))).toBe('That edit can’t be stored: an override edits the cues, the substitutions, or both.')
    // A raw cue the screen would have cleaned (src/rules/overrides.ts cleanCue) is still refused in words, never as Zod's issue list.
    expect(await refusal(edit({ cues: ['Knees out\u0007now'] }))).toBe('That edit can’t be stored: a cue is one line of plain text.')
    expect(await refusal(edit({ cues: ['Feet high'], editedOn: 'Nov 16' as ProgramOverride['editedOn'] }))).toMatch(/^That edit can’t be stored: [^[{]+\.$/)
    expect(await db.programOverrides.count()).toBe(0)
  })

  it('never writes the seed: program.md’s slot is as it was', async () => {
    const before = structuredClone(templateFor(1, 'A'))
    await saveProgramOverride(edit({ cues: [], substitutionIds: [] }), program)
    expect(templateFor(1, 'A')).toEqual(before)
  })
})

describe('Back to program.md’s', () => {
  it('deletes the slot’s row, and leaves the others', async () => {
    await saveProgramOverride(edit({ cues: ['Feet high'] }), program)
    await saveProgramOverride(edit({ slotId: 'p1a-2', cues: [] }), program)
    await clearProgramOverride('p1a-1')
    expect((await getProgramOverrides()).map((r) => r.slotId)).toEqual(['p1a-2'])
    // A slot with no row: nothing to do, and no error.
    await clearProgramOverride('p1a-1')
    expect(await db.programOverrides.count()).toBe(1)
  })
})

describe('Reset all data', () => {
  it('clears the edits with everything else', async () => {
    await saveProgramOverride(edit({ cues: ['Feet high'] }), program)
    await resetAll()
    expect(await getProgramOverrides()).toEqual([])
  })
})
