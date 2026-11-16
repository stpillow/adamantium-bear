import { describe, expect, it } from 'vitest'
import { program } from '../program/program.ts'
import type { MileageWeek, Run, SetLog, Slot } from '../schema/index.ts'
import { fitToWindow } from './fitWindow.ts'
import { ownFlagNote, writtenDraft, writtenFitSlots, writtenLoadMissing, writtenSides, writtenWeekMiles } from './written.ts'

const slotOf = (id: string): Slot => {
  const slot = program.templates.flatMap((t) => t.slots).find((s) => s.id === id)
  if (!slot) throw new Error(`no slot ${id}`)
  return slot
}
const set = (over: Partial<SetLog>): SetLog => ({ id: 'x', workoutId: 'w', slotId: 'p1a-1', exerciseId: 'leg-press', setNumber: 1, side: 'both', load: 90, loadUnit: 'lb', reps: 11, stopped: false, ...over })

describe('writtenSides: the written sets per side', () => {
  it('a two-sided slot is one row; deload weeks cut a third, from the calendar only', () => {
    expect(writtenSides(slotOf('p1a-1'), 'right', 1)).toEqual([{ side: 'both', sets: 3 }])
    expect(writtenSides(slotOf('p1a-1'), 'right', 4)).toEqual([{ side: 'both', sets: 2 }])
    expect(writtenSides(slotOf('p1a-1'), 'right', 5)).toEqual([{ side: 'both', sets: 3 }])
  })
  it('an injured-only slot is the injured side alone; a unilateral one is injured then other', () => {
    expect(writtenSides(slotOf('p1a-7'), 'left', 1)).toEqual([{ side: 'left', sets: 3 }])
    expect(writtenSides(slotOf('p1c-1'), 'right', 1)).toEqual([
      { side: 'right', sets: 3 },
      { side: 'left', sets: 3 },
    ])
  })
})

describe('writtenDraft: typed, never suggested', () => {
  const legPress = { id: 'leg-press' }
  it('the first set starts at load 0 and the written low end, RPE unrated, pain unrated', () => {
    expect(writtenDraft({ slot: slotOf('p1a-1'), exercise: legPress, side: 'both', slotSets: [], painPerSet: true })).toEqual({ load: 0, count: 10, rpe: null, pain: null })
  })
  it('later sets carry the tester’s own last set of this exercise and side, this session', () => {
    const sets = [set({ setNumber: 1, load: 80, reps: 12, painDuring: 2, loggedAt: '2026-12-01T10:00:00.000Z' }), set({ setNumber: 2, load: 90, reps: 11, painDuring: 3, loggedAt: '2026-12-01T10:03:00.000Z' })]
    expect(writtenDraft({ slot: slotOf('p1a-1'), exercise: legPress, side: 'both', slotSets: sets, painPerSet: true })).toEqual({ load: 90, count: 11, rpe: null, pain: 3 })
    // Pain once per exercise: what this exercise's sets carry.
    expect(writtenDraft({ slot: slotOf('p1a-1'), exercise: legPress, side: 'both', slotSets: sets, painPerSet: false }).pain).toBe(3)
    // Another exercise's sets on the slot (a swap) never carry over.
    expect(writtenDraft({ slot: slotOf('p1a-1'), exercise: { id: 'leg-press-45' }, side: 'both', slotSets: sets, painPerSet: true })).toEqual({ load: 0, count: 10, rpe: null, pain: null })
  })
  it('a step height, a range stop and a stage start where program.md writes them', () => {
    expect(writtenDraft({ slot: slotOf('p1c-1'), exercise: { id: 'step-up' }, side: 'right', slotSets: [], painPerSet: true }).heightIn).toBe(slotOf('p1c-1').heightIn)
    expect(writtenDraft({ slot: slotOf('p1c-5'), exercise: { id: 'leg-extension' }, side: 'both', slotSets: [], painPerSet: true }).rangeStopDeg).toBe(slotOf('p1c-5').rangeStopDeg)
    expect(writtenDraft({ slot: slotOf('p1a-7'), exercise: { id: 'single-leg-balance', stages: ['eyes open', 'eyes closed'] }, side: 'right', slotSets: [], painPerSet: true }).stage).toBe(0)
  })
  it('the count starts in the effective slot’s own unit after a swap to a timed exercise', () => {
    expect(writtenDraft({ slot: { ...slotOf('p1c-5'), repsMin: 30, rangeStopDeg: undefined }, exercise: { id: 'wall-sit' }, side: 'both', slotSets: [], painPerSet: true })).toEqual({ load: 0, count: 30, rpe: null, pain: null })
  })
})

describe('writtenLoadMissing', () => {
  it('a load to type on a loaded exercise; never on an assisted one or one with no load', () => {
    expect(writtenLoadMissing(true, 'up', { load: 0 })).toBe(true)
    expect(writtenLoadMissing(true, 'up', { load: 10 })).toBe(false)
    expect(writtenLoadMissing(true, 'down', { load: 0 })).toBe(false)
    expect(writtenLoadMissing(false, 'up', { load: 0 })).toBe(false)
  })
})

describe('writtenWeekMiles: the plan’s number, never capped', () => {
  const plan: MileageWeek[] = program.mileagePlan
  const run = (date: string, miles: number, type: Run['type'] = 'easy'): Run => ({ id: date, date, type, miles, minutes: 30, effort: 'easy', maxPain: 7, strides: false, tempo: false })
  it('reads the plan and the runs, whatever the pain', () => {
    const summary = writtenWeekMiles(plan, 2, '2026-11-02', [run('2026-11-09', 3), run('2026-11-11', 0, 'rower-swap'), run('2026-11-02', 4)])
    expect(summary).toEqual({ target: { target: plan.find((w) => w.week === 2)?.targetMiles ?? null, capped: false, reason: 'from the plan' }, miles: 3, sessions: 2, swaps: 1 })
  })
  it('outside the plan, no number, in the plan’s words', () => {
    expect(writtenWeekMiles(plan, 14, '2026-11-02', []).target).toEqual({ target: null, capped: false, reason: 'week 14 is outside the 12-week plan' })
  })
})

describe('ownFlagNote: the tester’s own note', () => {
  it('names the ticked flags in the catalog’s words, on time or late alike', () => {
    expect(ownFlagNote({ date: '2026-12-12', redFlags: ['locking'] }, program.redFlags)).toEqual({ date: '2026-12-12', items: ['Locking or catching: a mechanical block to straightening or bending'] })
    expect(ownFlagNote({ date: '2026-12-12', redFlags: [] }, program.redFlags)).toBeNull()
  })
})

describe('writtenFitSlots: the window over the written sets', () => {
  it('counts the top of the written range, with no warm-up sets and no extras', () => {
    const slots = writtenFitSlots([{ slot: slotOf('p1a-1'), sides: [{ side: 'both', sets: 3 }], repUnit: 'reps', here: true }], new Set(['p1a-1']))
    expect(slots).toEqual([{ slotId: 'p1a-1', added: false, extra: false, eligible: true, optional: false, logged: true, sides: [{ sets: 3, repsTarget: 12, repUnit: 'reps' }] }])
    expect(fitToWindow(slots, null, 90, 10).keep).toEqual(['p1a-1'])
  })
})
