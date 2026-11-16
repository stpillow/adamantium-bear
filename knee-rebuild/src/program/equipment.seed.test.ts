import { describe, expect, it } from 'vitest'
import { homeLocation } from '../db/migrations.ts'
import { availableEquipment, equipmentChecklist, fallbacksAfter, forNextProgramUpdate, locationCoverage, matchTyped, routeSlot, stageCeiling, suggestedRunSwap } from '../rules/equipment.ts'
import { exerciseById, program } from './program.ts'

// The live seed through the equipment rules (design section 3): Shawn's club runs the program as written.

const byId = new Map(program.exercises.map((e) => [e.id, e]))
const kit = program.equipment.filter((e) => e.carried).map((e) => e.id)
const home = homeLocation(80, program.planetFitness, '2026-11-01', program.equipmentListVersion)
const available = availableEquipment(home, program.equipment, program.planetFitness, kit)

describe('a gym with the lowest stair and no step platforms (PROGRAM-QUESTIONS 68)', () => {
  const stairOnly = availableEquipment(
    { ...home, present: home.present.filter((id) => id !== 'step-platforms') },
    program.equipment,
    program.planetFitness,
    kit,
  )
  const slot = (templateId: string, slotId: string) => {
    const found = program.templates.find((t) => t.id === templateId)?.slots.find((s) => s.id === slotId)
    if (!found) throw new Error(`no slot ${slotId}`)
    return found
  }
  it('runs the single-leg calf raise on the stair (Shawn, Nov 2)', () => {
    for (const [t, s] of [['p2-a', 'p2a-6'], ['p3-a', 'p3a-6']] as const) expect(routeSlot(slot(t, s), byId, stairOnly), s).toMatchObject({ kind: 'own', exerciseId: 'single-leg-calf-raise-step' })
  })
  it('moves the lateral step-down to the step-up on the stair', () => {
    expect(routeSlot(slot('p2-b', 'p2b-6'), byId, stairOnly)).toEqual({
      kind: 'moved',
      exerciseId: 'step-up-stair',
      passedOver: [{ exerciseId: 'lateral-step-down', missing: ['step-platforms'] }],
    })
  })
})

describe('the adjustable bench (PROGRAM-QUESTIONS 66)', () => {
  it('a typed "incline bench" matches it, and Planet Fitness has it', () => {
    expect(matchTyped('incline bench', program.equipment, [])).toEqual({ kind: 'known', id: 'adjustable-bench' })
    expect(matchTyped('Incline bench', program.equipment, home.present)).toEqual({ kind: 'already', id: 'adjustable-bench' })
    expect(matchTyped('adjustable bench', program.equipment, [])).toEqual({ kind: 'known', id: 'adjustable-bench' })
  })
  it('a gym with only a flat bench moves the incline press and the chest-supported row on', () => {
    const flatOnly = availableEquipment({ ...home, present: home.present.filter((id) => id !== 'adjustable-bench') }, program.equipment, program.planetFitness, kit)
    const slotOf = (templateId: string, slotId: string) => program.templates.find((t) => t.id === templateId)?.slots.find((s) => s.id === slotId)
    const press = slotOf('p1-c', 'p1c-4')
    const row = slotOf('p1-b', 'p1b-3')
    if (!press || !row) throw new Error('missing slot')
    expect(routeSlot(press, byId, available).kind).toBe('own')
    expect(routeSlot(press, byId, flatOnly)).toEqual({ kind: 'moved', exerciseId: 'chest-press-machine', passedOver: [{ exerciseId: 'incline-db-press', missing: ['adjustable-bench'] }] })
    // The row's own exercise is the seated cable row; past it, the chest-supported row is passed over for the single-arm cable row.
    expect(fallbacksAfter(row, 'seated-cable-row', byId, available).map((e) => e.id)).toEqual(['chest-supported-db-row', 'single-arm-cable-row'])
    expect(fallbacksAfter(row, 'seated-cable-row', byId, flatOnly).map((e) => e.id)).toEqual(['single-arm-cable-row'])
  })
})

describe('the home gym on the live seed', () => {
  it('carries both items in the bag', () => {
    expect([...kit].sort()).toEqual(['ankle-strap', 'mini-band'])
  })

  it('routes every slot of all nine templates to its own exercise', () => {
    expect(program.templates).toHaveLength(9)
    const moved: string[] = []
    for (const template of program.templates) {
      for (const slot of template.slots) {
        const route = routeSlot(slot, byId, available)
        if (route.kind !== 'own') moved.push(`${template.id} ${slot.id}: ${route.kind} to ${route.exerciseId} (${JSON.stringify(route.passedOver)})`)
      }
    }
    expect(moved).toEqual([])
  })

  it('changes nothing in any week of any phase', () => {
    for (const phaseWeek of [1, 2, 3, 4, 5, 9]) {
      for (const coverage of locationCoverage(program.templates, phaseWeek, byId, available)) expect(coverage.moves, `${coverage.templateId} week ${phaseWeek}`).toEqual([])
    }
  })

  it('lets both balance ladders run every stage: his club has a bosu (Shawn, Nov 1)', () => {
    for (const id of ['single-leg-balance', 'balance-mat-bosu']) {
      const exercise = exerciseById(id)
      expect(exercise.stages?.length, id).toBeGreaterThan(0)
      expect(stageCeiling(exercise, available), id).toBeNull()
    }
  })

  it('suggests the elliptical on a Hold run day', () => {
    expect(suggestedRunSwap(available)).toBe('elliptical-swap')
  })

  it('has dumbbells from its max and the 45° press from Shawn\'s answers, which Planet Fitness\'s list lacks', () => {
    expect(available.has('dumbbells')).toBe(true)
    expect(program.planetFitness).not.toContain('leg-press-45')
    expect(available.has('leg-press-45')).toBe(true)
    expect(available.has('lying-leg-curl')).toBe(false)
  })

  it('names the four list items nothing in the program uses for the next program update (PROGRAM-QUESTIONS 78, 172)', () => {
    // The rower (a Hold-day run swap) and the upright bike (the warm-up) count as used, as the elliptical does.
    expect(forNextProgramUpdate([home], program.equipment, program.exercises).map((n) => n.text)).toEqual([
      'Weight plate',
      'Floor tape',
      'Treadmill',
      'Stair climber',
    ])
  })

  it('puts every used item on the editor checklist but dumbbells and the bag, and nothing the program doesn\'t use', () => {
    const listed = equipmentChecklist(program.equipment, program.exercises).flatMap((g) => g.items.map((i) => i.item.id))
    const unused = ['weight-plate', 'floor-tape', 'treadmill', 'stair-climber', 'tape-measure', 'medicine-ball']
    expect(listed).toEqual(program.equipment.map((e) => e.id).filter((id) => !unused.includes(id) && !kit.includes(id) && id !== 'dumbbells'))
    expect(listed).toEqual(expect.arrayContaining(['upright-bike', 'elliptical', 'rower', 'adjustable-bench', 'stair']))
    expect(equipmentChecklist(program.equipment, program.exercises).map((g) => g.group)).toEqual(program.equipmentBySlot.map((r) => r.slot))
  })
})
