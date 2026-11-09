import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { program } from '../program/program.ts'
import { NOT_YET_WORDS, phaseExerciseIds } from '../rules/addedSlots.ts'
import type { AddedSlot } from '../schema/index.ts'
import { db } from './db.ts'
import { defaultSettings, ensureLocations, ensureSettings, getAddedSlots, loadHistory, removeAddedSlot, resetAll, saveAddedSlot } from './repo.ts'

// The Program screen's "Add an exercise" writes (Dexie version 5): checked, then parsed, before they reach IndexedDB.

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false })
  await ensureSettings(defaultSettings(program))
  await ensureLocations(program, '2026-11-02')
})

const add = (over: Partial<AddedSlot> = {}): AddedSlot => ({ id: 'added-k1', templateId: 'p1-a', exerciseId: 'db-bench-press', sets: 3, repsMin: 8, repsMax: 10, addedOn: '2026-11-04', ...over })

describe('saving an added exercise', () => {
  it('refuses an exercise program.md holds for a later phase, and takes it in the phase that brings it in', async () => {
    const early = phaseExerciseIds(program.templates, 1)
    const later = [...phaseExerciseIds(program.templates, 2)].find((id) => !early.has(id) && program.exercises.some((e) => e.id === id && e.pattern !== 'plyo' && e.loadType !== 'step-height' && e.pattern !== 'carry' && e.pattern !== 'cardio'))
    expect(later, 'a phase 2 exercise that phase 1 never uses').toBeDefined()
    await expect(saveAddedSlot(add({ exerciseId: later! }), program)).rejects.toThrow(NOT_YET_WORDS)
    await expect(saveAddedSlot(add({ exerciseId: 'plyo-placeholder' }), program)).rejects.toThrow('That exercise isn’t in the catalog.')
    expect(await getAddedSlots()).toEqual([])
    await saveAddedSlot(add({ id: 'added-p2', templateId: 'p2-a', exerciseId: later! }), program)
    expect((await getAddedSlots()).map((a) => a.id)).toEqual(['added-p2'])
  })

  it('takes an accessory on a Phase 1 session, though no session of any phase lists it (Batch C, PROGRAM-QUESTIONS 169)', async () => {
    for (const id of ['db-curl', 'ab-rollout', 'farmers-hold']) expect(phaseExerciseIds(program.templates, 3).has(id), id).toBe(false)
    await saveAddedSlot(add({ id: 'added-c1', exerciseId: 'db-curl', repsMin: 10, repsMax: 12 }), program)
    await saveAddedSlot(add({ id: 'added-c2', exerciseId: 'farmers-hold', repsMin: 30, repsMax: 45 }), program)
    expect((await getAddedSlots()).map((a) => [a.id, a.exerciseId])).toEqual([
      ['added-c1', 'db-curl'],
      ['added-c2', 'farmers-hold'],
    ])
  })

  it('stores the row, reads it back, and hands it to the engine with the history', async () => {
    const saved = await saveAddedSlot(add(), program)
    expect(await getAddedSlots()).toEqual([saved])
    expect((await loadHistory()).addedSlots).toEqual([saved])
  })

  it('refuses, in words, a session or exercise program.md doesn’t have, one that can’t be added, a bad range, writing nothing', async () => {
    await expect(saveAddedSlot(add({ templateId: 'p9-z' }), program)).rejects.toThrow('No session p9-z in the program.')
    await expect(saveAddedSlot(add({ exerciseId: 'kettlebell-swing' }), program)).rejects.toThrow('That exercise isn’t in the catalog.')
    await expect(saveAddedSlot(add({ exerciseId: 'step-up' }), program)).rejects.toThrow(/step height/)
    await expect(saveAddedSlot(add({ repsMin: 10, repsMax: 8 }), program)).rejects.toThrow(/top of the range/)
    expect(await getAddedSlots()).toEqual([])
  })

  it('takes six to a session and then says so, a seventh refused and the first six kept', async () => {
    for (let i = 1; i <= 6; i++) await saveAddedSlot(add({ id: `added-k${i}` }), program)
    await expect(saveAddedSlot(add({ id: 'added-k7' }), program)).rejects.toThrow(/6 added exercises; remove one first/)
    expect(await getAddedSlots()).toHaveLength(6)
    // Another session has its own six, and re-saving one of the six is an edit, not a seventh.
    await saveAddedSlot(add({ id: 'added-b1', templateId: 'p1-b' }), program)
    await saveAddedSlot(add({ id: 'added-k1', sets: 2 }), program)
    expect(await getAddedSlots()).toHaveLength(7)
  })

  it('removing one takes it off its session and leaves the rest; Reset clears them all', async () => {
    await saveAddedSlot(add(), program)
    await saveAddedSlot(add({ id: 'added-k2' }), program)
    await removeAddedSlot('added-k1')
    expect((await getAddedSlots()).map((a) => a.id)).toEqual(['added-k2'])
    await resetAll(defaultSettings(program), program, '2026-11-02')
    expect(await getAddedSlots()).toEqual([])
  })
})
