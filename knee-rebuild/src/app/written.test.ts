import { describe, expect, it } from 'vitest'
import { prescribedSets } from '../rules/deload.ts'
import { RICH_TODAY, richHistory, richHome, richMarriott, richSettings, richSettingsFlagged } from '../testing/richHistory.fixture.test.ts'
import { PROGRAM, planSession } from './session.ts'
import { planFor, writtenFit, writtenSession } from './written.ts'

const gym = (location = richHome) => ({ location, kit: richSettings.kit })

describe('planFor', () => {
  it('full is planSession exactly', () => {
    for (const template of PROGRAM.templates) {
      for (const week of [1, 4, 6]) {
        const input = { template, week, settings: richSettings, history: richHistory, gym: gym(), before: RICH_TODAY }
        expect(planFor('full', input)).toStrictEqual({ mode: 'full', slots: planSession(input) })
      }
    }
  })
  it('tester is the session as written, extensions and the pause day dropped', () => {
    const template = PROGRAM.templates[0]
    if (!template) throw new Error('seed has templates')
    const plan = planFor('tester', { template, week: 1, settings: richSettings, history: richHistory, gym: gym(), before: RICH_TODAY, pauseDate: '2026-12-01', extend: [] })
    expect(plan.mode).toBe('tester')
    expect(plan.slots).toStrictEqual(writtenSession({ template, week: 1, settings: richSettings, history: richHistory, gym: gym() }))
  })
})

describe('writtenSession: every seed template, weeks 1 and 4', () => {
  it('the text is program.md’s cell verbatim, and the sets are the written ones, cut a third on the deload', () => {
    for (const settings of [richSettings, richSettingsFlagged]) {
      for (const template of PROGRAM.templates) {
        for (const week of [1, 4]) {
          for (const plan of writtenSession({ template, week, settings, history: richHistory, gym: gym() })) {
            expect(plan.text).toBe(plan.slot.prescriptionText)
            expect(plan.loadNote).toBe(plan.slot.loadNote ?? null)
            for (const side of plan.sides) expect(side.sets).toBe(prescribedSets(plan.slot.sets, week))
            expect(plan.deload).toStrictEqual(week === 4 ? { written: plan.slot.sets, sets: prescribedSets(plan.slot.sets, 4) } : null)
            expect(Object.keys(plan)).not.toContain('prescriptions')
          }
        }
      }
    }
  })
  it('routes at a gym without the leg press from the slot’s own exercise, never from history', () => {
    const template = PROGRAM.templates.find((t) => t.id === 'p1-a')
    if (!template) throw new Error('P1-A is in the seed')
    const [legPress] = writtenSession({ template, week: 6, settings: richSettings, history: richHistory, gym: gym(richMarriott) })
    expect(legPress?.route.kind).toBe('moved')
    expect(legPress?.exercise.id).toBe(legPress?.route.exerciseId)
    expect(legPress?.exercise.id).not.toBe('leg-press')
  })
  it('a chosen swap on the list runs; one off the list doesn’t', () => {
    const template = PROGRAM.templates.find((t) => t.id === 'p1-a')
    if (!template) throw new Error('P1-A is in the seed')
    const [onList] = writtenSession({ template, week: 1, settings: richSettings, history: richHistory, gym: gym(), chosenExercise: { 'p1a-1': 'goblet-squat-bench' } })
    expect(onList?.exercise.id).toBe('goblet-squat-bench')
    const [offList] = writtenSession({ template, week: 1, settings: richSettings, history: richHistory, gym: gym(), chosenExercise: { 'p1a-1': 'dead-bug' } })
    expect(offList?.exercise.id).toBe('leg-press')
  })
  it('injured-only and unilateral sides, the Program edits and the added exercise as content', () => {
    const a = PROGRAM.templates.find((t) => t.id === 'p1-a')
    const c = PROGRAM.templates.find((t) => t.id === 'p1-c')
    if (!a || !c) throw new Error('seed')
    const planA = writtenSession({ template: a, week: 1, settings: richSettings, history: richHistory, gym: gym() })
    expect(planA.find((p) => p.slot.id === 'p1a-7')?.sides).toEqual([{ side: 'right', sets: 3 }])
    expect(planA.find((p) => p.slot.id === 'p1a-2')?.slot.cues).toEqual(['Slow on the way back.', 'Hips down.'])
    expect(planA.some((p) => p.slot.id === 'added-p1-a-1')).toBe(true)
    expect(writtenSession({ template: c, week: 1, settings: richSettings, history: richHistory, gym: gym() }).find((p) => p.slot.id === 'p1c-1')?.sides).toEqual([
      { side: 'right', sets: 3 },
      { side: 'left', sets: 3 },
    ])
  })
})

describe('writtenFit', () => {
  it('fits the written sets, keeping a logged slot', () => {
    const template = PROGRAM.templates.find((t) => t.id === 'p1-a')
    if (!template) throw new Error('seed')
    const plans = writtenSession({ template, week: 1, settings: richSettings, history: richHistory, gym: gym() })
    const full = writtenFit(plans, 90, null, { warmUpMinutes: 10 })
    expect(full.keep).toEqual(plans.map((p) => p.slot.id))
    expect(full.added).toEqual([])
    const short = writtenFit(plans, 90, 25, { warmUpMinutes: 10, logged: new Set(['p1a-4']) })
    expect(short.keep).toContain('p1a-4')
    expect(short.keep.length).toBeLessThan(plans.length)
  })
})
