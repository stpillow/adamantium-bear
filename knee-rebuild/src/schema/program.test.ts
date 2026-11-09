import { describe, expect, it } from 'vitest'
import programMd from '../../docs/program.md?raw'
import raw from '../../data/program.json'
import { program, templateFor } from '../program/program.ts'
import { addedPrescriptionText, addedRepUnit, addedRule, notAddableReason, slotFromAdded } from '../rules/addedSlots.ts'
import { DELOAD_WEEKS } from '../rules/calendar.ts'
import { effectiveSlot } from '../rules/effectiveSlot.ts'
import { extensionPool } from '../rules/extensions.ts'
import { parseMarkdown, plainText, type Block } from '../rules/markdown.ts'
import { substitutionProblem } from '../rules/overrides.ts'
import { phaseRunsExercise } from '../rules/session.ts'
import { isLowerBody } from '../rules/wholeKnee.ts'
import { ADDED_SETS_MAX, CUE_MAX, DEFAULT_KIT } from './log.ts'
import { Accessory, Equipment, Exercise, Program, Requirement } from './program.ts'

describe('data/program.json', () => {
  it('validates against the Program schema', () => {
    expect(() => Program.parse(raw)).not.toThrow()
  })

  it('has nine templates, three per phase, A B C each', () => {
    expect(program.templates).toHaveLength(9)
    for (const phase of [1, 2, 3] as const) {
      expect(program.templates.filter((t) => t.phase === phase).map((t) => t.letter).sort()).toEqual(['A', 'B', 'C'])
    }
  })

  it('every slot points at a catalog exercise, and so does every substitution and pairing', () => {
    const exerciseIds = new Set(program.exercises.map((e) => e.id))
    for (const template of program.templates) {
      const slotIds = new Set(template.slots.map((s) => s.id))
      for (const slot of template.slots) {
        expect(exerciseIds, `${slot.id} exercise`).toContain(slot.exerciseId)
        for (const sub of slot.substitutionIds) expect(exerciseIds, `${slot.id} substitution`).toContain(sub)
        expect(slot.repsMax).toBeGreaterThanOrEqual(slot.repsMin)
      }
      expect(slotIds.size).toBe(template.slots.length)
      const groups = new Map<string, number>()
      for (const slot of template.slots) if (slot.groupId) groups.set(slot.groupId, (groups.get(slot.groupId) ?? 0) + 1)
      for (const [groupId, size] of groups) expect(size, `${template.id} group ${groupId}`).toBeGreaterThanOrEqual(2)
      const orders = template.slots.map((s) => s.order)
      expect(orders).toEqual([...orders].sort((a, b) => a - b))
      expect(new Set(orders).size).toBe(orders.length)
    }
  })

  it('unilateral slots use unilateral exercises, and the injured side logs first on all of them', () => {
    const byId = new Map(program.exercises.map((e) => [e.id, e]))
    for (const template of program.templates) {
      for (const slot of template.slots) {
        if (slot.unilateral) expect(byId.get(slot.exerciseId)?.unilateral, slot.id).toBe(true)
      }
    }
  })

  it('mileage plan: the chart’s climb to 18 by week 11, held flat in deload weeks 4, 8 and 12 (Shawn, Nov 1)', () => {
    const miles = program.mileagePlan.map((w) => w.targetMiles)
    expect(miles).toEqual([10, 11, 12, 12, 13, 14, 15, 15, 16, 17, 18, 18])
    // Only climbs, never decreases (PROGRAM-QUESTIONS 1).
    for (let i = 1; i < miles.length; i++) expect(miles[i]).toBeGreaterThanOrEqual(miles[i - 1] ?? 0)
    expect(program.mileagePlan.filter((w) => w.isDown).map((w) => w.week)).toEqual([4, 8, 12])
    expect(program.mileagePlan.map((w) => w.week)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
  })

  it('selectorized machines log pounds in 5 lb steps, not plate numbers (Shawn, Nov 1)', () => {
    const stacks = program.exercises.filter((e) => e.loadType === 'stack')
    expect(stacks.length).toBeGreaterThan(0)
    for (const e of stacks) expect({ id: e.id, unit: e.loadUnit, step: e.increment }).toEqual({ id: e.id, unit: 'lb', step: 5 })
  })
  it('the mileage down weeks are the lifting deload weeks', () => {
    expect(program.mileagePlan.filter((w) => w.isDown).map((w) => w.week)).toEqual([...DELOAD_WEEKS])
  })

  it('bands: Phase 2 snap-downs from phase week 3, Phase 3 plyo blocks in phase weeks 1–2, 3–4, 5 on', () => {
    expect(templateFor(2, 'A').slots.find((s) => s.id === 'p2a-prep')?.phaseWeeks).toEqual([3, null])
    const bands = templateFor(3, 'C').slots.filter((s) => s.phaseWeeks).map((s) => s.phaseWeeks)
    expect(new Set(bands.map((b) => JSON.stringify(b)))).toEqual(new Set(['[1,2]', '[3,4]', '[5,null]']))
  })

  it('gates: 1 wants 80% symmetry, 2 and 3 want 90%', () => {
    const thresholds = (gate: number) =>
      new Set(program.gates.find((g) => g.number === gate)?.items.filter((i) => i.evaluator === 'symmetry').map((i) => i.threshold))
    expect(thresholds(1)).toEqual(new Set([0.8]))
    expect(thresholds(2)).toEqual(new Set([0.9]))
    expect(thresholds(3)).toEqual(new Set([0.9]))
    // The four-hop battery (Batch A): single, triple, crossover and the 6-meter timed hop.
    expect(program.gates.find((g) => g.number === 3)?.items.filter((i) => i.trials === 3)).toHaveLength(4)
  })

  it('gates: exactly one gate-3 item is timed — the 6-meter hop, fastest kept, other ÷ injured (Batch A)', () => {
    const items = program.gates.flatMap((g) => g.items)
    const timed = items.filter((i) => i.timed)
    expect(timed.map((i) => i.id)).toEqual(['g3-six-meter-timed-hop'])
    expect(timed[0]).toMatchObject({ evaluator: 'symmetry', threshold: 0.9, testItem: 'six-meter-timed-hop', trials: 3 })
    expect(timed[0]?.prefillExerciseId).toBeUndefined()
  })

  it('gates: the ACL-RSI item is its own evaluator at the strict published 76, beside the untouched trust toggle (Batch A)', () => {
    const gate3 = program.gates.find((g) => g.number === 3)
    const aclRsi = gate3?.items.find((i) => i.evaluator === 'acl-rsi')
    expect(aclRsi).toMatchObject({ id: 'g3-acl-rsi', minScore: 76 })
    expect(aclRsi?.testItem).toBeUndefined()
    expect(aclRsi?.trials).toBeUndefined()
    expect(aclRsi?.threshold).toBeUndefined()
    // The manual "would trust it at full speed" toggle stays its own item.
    expect(gate3?.items.find((i) => i.id === 'g3-trust')).toMatchObject({ evaluator: 'manual' })
    // No other gate carries an acl-rsi item.
    expect(program.gates.flatMap((g) => g.items).filter((i) => i.evaluator === 'acl-rsi')).toHaveLength(1)
  })

  it('gates: every load test names the two-sided exercise whose latest session prefills it; hop tests name none', () => {
    const byId = new Map(program.exercises.map((e) => [e.id, e]))
    const items = program.gates.flatMap((g) => g.items)
    const prefills = Object.fromEntries(items.filter((i) => i.prefillExerciseId !== undefined).map((i) => [i.id, i.prefillExerciseId]))
    expect(prefills).toEqual({
      'g1-sl-leg-press': 'single-leg-leg-press',
      'g2-sl-leg-press': 'single-leg-leg-press',
      'g2-bulgarian': 'bulgarian-split-squat',
      'g3-sl-leg-press-8rm': 'single-leg-leg-press',
    })
    for (const item of items) {
      const loadTest = item.evaluator === 'symmetry' && item.trials === undefined
      expect(item.prefillExerciseId !== undefined, `${item.id} names a prefill exercise only if it is a load test`).toBe(loadTest)
      if (item.prefillExerciseId === undefined) continue
      const exercise = byId.get(item.prefillExerciseId)
      expect(exercise, `${item.id} prefill resolves`).toBeDefined()
      expect(exercise?.unilateral, `${item.id} prefill is two-sided`).toBe(true)
    }
  })

  it('gates: a load test’s prefill exercise is one its phase’s sessions can log, except gate 1’s (PROGRAM-QUESTIONS 114)', () => {
    // Phase 1 runs only the two-legged leg press, so no Phase 1 session can log both sides of the
    // single-leg press gate 1 tests: the Gates screen has to say so rather than wait for one.
    const unreachable = program.gates.flatMap((g) =>
      g.items.filter((i) => i.prefillExerciseId !== undefined && !phaseRunsExercise(program.templates, g.fromPhase, i.prefillExerciseId)).map((i) => i.id),
    )
    expect(unreachable).toEqual(['g1-sl-leg-press'])
  })

  it('carries the seven red flags and the start date', () => {
    expect(program.redFlags).toHaveLength(7)
    expect(program.startDate).toBe('2026-11-02')
    expect(program.injuredSide).toBe('right')
  })

  it('spot checks against program.md', () => {
    const p1a = templateFor(1, 'A').slots
    expect(p1a[0]?.exerciseId).toBe('leg-press')
    expect(p1a[0]?.prescriptionText).toBe('3 × 10–12, RPE 6→7')
    const stepUp = templateFor(1, 'C').slots.find((s) => s.exerciseId === 'step-up')
    expect(stepUp?.heightIn).toBe(6)
    expect(stepUp?.loadBeforeHeightLb).toBe(20)
    const p2b1 = templateFor(2, 'B').slots.find((s) => s.label === '1')
    expect(p2b1?.exerciseId).toBe('bulgarian-split-squat')
    expect(p2b1?.prescriptionText).toBe('3 × 8 each leg, RPE 7')
    const p3a1 = templateFor(3, 'A').slots.find((s) => s.label === '1')
    expect(p3a1?.prescriptionText).toBe('4 × 6–8, RPE 8')
    expect(templateFor(3, 'C').slots.find((s) => s.label === '6')?.exerciseId).toBe('walking-lunge')
  })
})

describe('equipment schema (M4b)', () => {
  const balance = {
    id: 'balance', name: 'Balance', pattern: 'balance', equipment: 'Folded mat or bosu', loadType: 'time', loadUnit: 's', increment: 5, unilateral: true,
    stages: ['folded mat', 'bosu'], requires: [{ anyOf: ['mats', 'bosu'] }], stageRequires: [['mats'], ['bosu']],
  } as const
  it('a requirement is one id, or anyOf two or more ids', () => {
    expect(Requirement.safeParse('mats').success).toBe(true)
    expect(Requirement.safeParse({ anyOf: ['mats', 'bosu'] }).success).toBe(true)
    expect(Requirement.safeParse({ anyOf: ['mats'] }).success).toBe(false)
    expect(Requirement.safeParse({ anyOf: ['mats', 'bosu'], allOf: [] }).success).toBe(false)
    expect(Requirement.safeParse('Folded mat').success).toBe(false)
  })
  it('exercises must say what they require, even when it is nothing', () => {
    expect(Exercise.safeParse(balance).success).toBe(true)
    expect(Exercise.safeParse({ ...balance, requires: [] }).success).toBe(true)
    const { requires: _requires, ...without } = balance
    expect(Exercise.safeParse(without).success).toBe(false)
  })
  it('stageRequires has one entry per stage, and needs stages', () => {
    expect(Exercise.safeParse({ ...balance, stageRequires: [['mats']] }).success).toBe(false)
    expect(Exercise.safeParse({ ...balance, stageRequires: [['mats'], ['bosu'], []] }).success).toBe(false)
    const { stages: _stages, ...noStages } = balance
    expect(Exercise.safeParse(noStages).success).toBe(false)
    const { stageRequires: _sr, ...noStageRequires } = balance
    expect(Exercise.safeParse(noStageRequires).success).toBe(true)
  })
  it('an equipment item is strict', () => {
    const mats = { id: 'mats', name: 'Mats', group: 'Balance and plyos', source: 'Mats', aliases: ['mat'], carried: false, hedged: false, addedIn: 1 }
    expect(Equipment.safeParse(mats).success).toBe(true)
    expect(Equipment.safeParse({ ...mats, addedIn: 0 }).success).toBe(false)
    expect(Equipment.safeParse({ ...mats, id: 'Mats' }).success).toBe(false)
    expect(Equipment.safeParse({ ...mats, weightLb: 2 }).success).toBe(false)
  })
})

describe('data/program.json equipment (M4b)', () => {
  const vocabulary = new Map(program.equipment.map((e) => [e.id, e]))
  const idsIn = (requirements: readonly Requirement[]) => requirements.flatMap((r) => (typeof r === 'string' ? [r] : r.anyOf))
  const allRequirements = (e: Exercise) => [...e.requires, ...(e.stageRequires ?? []).flat()]
  const needs = (e: Exercise, id: string) => idsIn(allRequirements(e)).includes(id)
  const normalize = (text: string) => text.trim().toLowerCase()

  it('every exercise carries requires, all 91 of them (71, and the 20 of the accessory and core catalog)', () => {
    expect(raw.exercises).toHaveLength(91)
    for (const e of raw.exercises) expect(Array.isArray((e as { requires?: unknown }).requires), e.id).toBe(true)
  })

  it('ids are unique, and every requirement and Planet Fitness id is on the list', () => {
    expect(vocabulary.size).toBe(program.equipment.length)
    for (const e of program.exercises) for (const id of idsIn(allRequirements(e))) expect(vocabulary.has(id), `${e.id} needs ${id}`).toBe(true)
    for (const id of program.planetFitness) expect(vocabulary.has(id), `planetFitness ${id}`).toBe(true)
    expect(new Set(program.planetFitness).size).toBe(program.planetFitness.length)
  })

  it('names and aliases are unique across the list once lowercased and trimmed', () => {
    const seen = new Map<string, string>()
    for (const e of program.equipment) {
      for (const text of [e.name, ...e.aliases]) {
        const key = normalize(text)
        expect(seen.get(key), `"${text}" on ${e.id} is also on ${seen.get(key)}`).toBeUndefined()
        seen.set(key, e.id)
      }
    }
  })

  it('every source is copied verbatim from docs/program.md', () => {
    expect(programMd.length).toBeGreaterThan(1000)
    for (const e of program.equipment) expect(programMd, `${e.id} source "${e.source}"`).toContain(e.source)
  })

  it('groups are program.md\'s "Program slot" rows, or Bring for exactly the carried items', () => {
    const rows = new Set(program.equipmentBySlot.map((r) => r.slot))
    for (const e of program.equipment) {
      expect(e.group === 'Bring' || rows.has(e.group), `${e.id} group ${e.group}`).toBe(true)
      expect(e.carried, `${e.id} carried`).toBe(e.group === 'Bring')
    }
    expect(program.equipment.filter((e) => e.carried).map((e) => e.id)).toEqual([...DEFAULT_KIT])
  })

  it('items no "Program slot" row lists sit under the row of what they are used for; the pinned eight', () => {
    // PROGRAM-QUESTIONS 63. program.md names these outside the slot table, so their sources are not in it.
    const unlisted: Record<string, string> = {
      'leg-extension-machine': 'Squat pattern',
      'weight-plate': 'Hinge pattern',
      stair: 'Single-leg',
      'stability-ball': 'Hamstrings',
      'rear-delt-machine': 'Upper body',
      'adjustable-bench': 'Upper body',
      'medicine-ball': 'Balance and plyos',
      'tape-measure': 'Balance and plyos',
    }
    const table = normalize(program.equipmentBySlot.map((r) => r.equipment).join('\n'))
    for (const [id, group] of Object.entries(unlisted)) {
      const item = vocabulary.get(id)
      expect(item?.group, id).toBe(group)
      expect(table, `${id} source`).not.toContain(normalize(item?.source ?? id))
    }
  })

  it('only the bosu is hedged, as program.md hedges it', () => {
    const hedged = program.equipment.filter((e) => e.hedged)
    expect(hedged.map((e) => e.id)).toEqual(['bosu'])
    expect(hedged[0]?.source).toContain('if your club has one')
  })

  it('is list version 1, and every item was added in it', () => {
    expect(program.equipmentListVersion).toBe(1)
    for (const e of program.equipment) expect(e.addedIn, e.id).toBe(1)
  })

  it('dumbbells are required wherever they are the movement; the pinned load-only exercises run at bodyweight', () => {
    // Design section 8: step-ups, split squats, the back extension and the Phase 2 calf raise run at
    // bodyweight; dumbbells only add load there (PROGRAM-QUESTIONS 64).
    const loadOnly = ['back-extension-45', 'bulgarian-split-squat', 'single-leg-calf-raise-step', 'split-squat', 'step-up', 'step-up-stair']
    const holdsDumbbells = (e: Exercise) =>
      e.loadType === 'dumbbell-each' || e.loadType === 'dumbbell-single' || e.holdsLoad === 'dumbbell-each' || e.holdsLoad === 'dumbbell-single'
    const dumbbellExercises = program.exercises.filter(holdsDumbbells)
    expect(dumbbellExercises.filter((e) => !e.requires.includes('dumbbells')).map((e) => e.id).sort()).toEqual(loadOnly)
    for (const e of program.exercises) if (needs(e, 'dumbbells')) expect(holdsDumbbells(e), `${e.id} needs dumbbells but holds none`).toBe(true)
    for (const e of program.exercises.filter((x) => loadOnly.includes(x.id))) expect(needs(e, 'dumbbells'), e.id).toBe(false)
  })

  it('stageRequires runs alongside the stages of both balance exercises', () => {
    const staged = program.exercises.filter((e) => e.stages)
    expect(staged.map((e) => e.id).sort()).toEqual(['balance-mat-bosu', 'single-leg-balance'])
    for (const e of staged) expect(e.stageRequires?.length, e.id).toBe(e.stages?.length)
    expect(program.exercises.filter((e) => e.stageRequires && !e.stages)).toEqual([])
    const stagesNeeding = (id: string, item: string) => {
      const e = program.exercises.find((x) => x.id === id)
      return (e?.stages ?? []).filter((_, i) => idsIn(e?.stageRequires?.[i] ?? []).includes(item))
    }
    expect(stagesNeeding('single-leg-balance', 'mats')).toEqual(['on a folded mat'])
    expect(stagesNeeding('balance-mat-bosu', 'mats')).toEqual(['folded mat', 'folded mat, slow head turns', 'folded mat, eyes closed'])
    expect(stagesNeeding('balance-mat-bosu', 'bosu')).toEqual(['bosu', 'bosu, slow head turns', 'bosu, eyes closed'])
    expect(stagesNeeding('single-leg-balance', 'bosu')).toEqual([])
  })

  it('anyOf appears only where program.md says "or", and where Shawn said so; the pinned four', () => {
    const withAnyOf = program.exercises.filter((e) => allRequirements(e).some((r) => typeof r !== 'string'))
    expect(Object.fromEntries(withAnyOf.map((e) => [e.id, e.requires.filter((r) => typeof r !== 'string')]))).toEqual({
      // "Standing calf raise on the leg press or Smith"; the seed has two leg presses.
      'standing-calf-raise': [{ anyOf: ['seated-leg-press', 'leg-press-45', 'smith-machine'] }],
      // "Single-leg calf raise on a step": the lowest stair counts as its step (Shawn, Nov 2; PROGRAM-QUESTIONS 68).
      'single-leg-calf-raise-step': [{ anyOf: ['step-platforms', 'stair'] }],
      // "Balance on a folded mat or bosu"
      'balance-mat-bosu': [{ anyOf: ['mats', 'bosu'] }],
      // The lat pulldown thigh pad; "The back extension bench's foot plates work too."
      'nordic-negatives': [{ anyOf: ['lat-pulldown', 'back-extension-bench'] }],
    })
    // The lateral step-down still needs the step platforms; the stair is its substitution's.
    expect(program.exercises.find((e) => e.id === 'lateral-step-down')?.requires).toEqual(['step-platforms'])
  })

  it('floor and space are assumed; a mat is needed only to balance on, under Nordic knees, or to kneel on for the ab rollout', () => {
    expect(program.exercises.filter((e) => needs(e, 'mats')).map((e) => e.id).sort()).toEqual(['ab-rollout', 'balance-mat-bosu', 'nordic-negatives', 'single-leg-balance'])
    expect(program.exercises.find((e) => e.id === 'single-leg-balance')?.requires).toEqual([])
    for (const id of ['dead-bug', 'side-plank', 'wall-sit', 'split-squat', 'snap-down', 'pogo-hops', 'change-of-direction-45']) {
      expect(program.exercises.find((e) => e.id === id)?.requires, id).toEqual([])
    }
  })

  it('program.md\'s words over catalog strings: no rope, the incline press\'s own bench, the 45° and seated presses apart', () => {
    const requiresOf = (id: string) => program.exercises.find((e) => e.id === id)?.requires
    expect(requiresOf('face-pull')).toEqual(['cable-station'])
    // Shawn, Nov 2 (PROGRAM-QUESTIONS 66): the two incline-bench exercises need an adjustable bench, sourced from "Incline dumbbell press".
    expect(requiresOf('incline-db-press')).toEqual(['dumbbells', 'adjustable-bench'])
    expect(requiresOf('chest-supported-db-row')).toEqual(['dumbbells', 'adjustable-bench'])
    expect(vocabulary.get('adjustable-bench')).toMatchObject({ name: 'Adjustable bench', group: 'Upper body', source: 'Incline dumbbell press', carried: false, hedged: false })
    expect(program.equipment.some((e) => /rope/i.test(`${e.id} ${e.name} ${e.aliases.join(' ')}`))).toBe(false)
    expect(program.equipment.filter((e) => /incline/i.test(`${e.id} ${e.name} ${e.aliases.join(' ')}`)).map((e) => e.id)).toEqual(['adjustable-bench'])
    expect(requiresOf('leg-press')).toEqual(['seated-leg-press'])
    expect(requiresOf('single-leg-leg-press')).toEqual(['seated-leg-press'])
    expect(requiresOf('leg-press-45')).toEqual(['leg-press-45'])
    expect(requiresOf('cable-hip-abduction')).toEqual(['cable-station', 'ankle-strap'])
    expect(requiresOf('lateral-band-walk')).toEqual(['mini-band'])
  })

  it('the flat bench covers every bench but the incline ones; the pinned thirteen and two', () => {
    // PROGRAM-QUESTIONS 66 lists these for Shawn; a new bench exercise has to be added there too.
    expect(program.exercises.filter((e) => needs(e, 'flat-bench')).map((e) => e.id).sort()).toEqual([
      'bench-dip',
      'bulgarian-split-squat',
      'copenhagen-plank-long',
      'copenhagen-plank-short',
      'db-bench-press',
      'db-hip-thrust',
      'db-pullover',
      'goblet-squat-bench',
      'seated-db-shoulder-press',
      'single-leg-hip-thrust',
      'smith-bench-press',
      'smith-box-squat',
      'smith-hip-thrust',
    ])
    expect(program.exercises.filter((e) => needs(e, 'adjustable-bench')).map((e) => e.id).sort()).toEqual(['chest-supported-db-row', 'incline-db-press'])
  })

  it('items no exercise needs stay on the list for typed matching; the pinned set', () => {
    const used = new Set(program.exercises.flatMap((e) => idsIn(allRequirements(e))))
    const unused = program.equipment.filter((e) => !used.has(e.id)).map((e) => e.id).sort()
    // The cable fly uses the cable crossover and the overhead press machine the shoulder press machine (PROGRAM-QUESTIONS 172).
    expect(unused).toEqual(['floor-tape', 'medicine-ball', 'rower', 'stair-climber', 'tape-measure', 'treadmill', 'upright-bike', 'weight-plate'])
  })

  it('planetFitness: program.md\'s club with Shawn\'s Nov 1 answers; nothing carried, no dumbbells, no lying leg curl', () => {
    const pf = new Set(program.planetFitness)
    for (const id of ['bosu', 'stability-ball', 'stair', 'seated-leg-press', 'rower', 'smith-machine', 'step-platforms', 'cable-station', 'adjustable-bench']) expect(pf.has(id), id).toBe(true)
    expect(pf.has('lying-leg-curl')).toBe(false)
    expect(pf.has('dumbbells')).toBe(false)
    for (const e of program.equipment.filter((x) => x.carried)) expect(pf.has(e.id), e.id).toBe(false)
    expect(program.equipment.filter((e) => !pf.has(e.id)).map((e) => e.id).sort()).toEqual(
      ['ankle-strap', 'dumbbells', 'leg-press-45', 'lying-leg-curl', 'medicine-ball', 'mini-band', 'tape-measure'],
    )
  })

  it('machines keep pounds in 5 lb steps alongside their requirements (Shawn, Nov 1)', () => {
    for (const e of program.exercises.filter((x) => x.loadType === 'stack')) expect([e.loadUnit, e.increment], e.id).toEqual(['lb', 5])
  })
})

describe('the accessory and core catalog (Batch C, PROGRAM-QUESTIONS 169)', () => {
  const ACCESSORY_IDS = [
    'db-curl',
    'hammer-curl',
    'triceps-pressdown',
    'overhead-triceps-extension',
    'lateral-raise',
    'push-up',
    'front-raise',
    'upright-row-cable',
    'shrug',
    'overhead-press-machine',
    'cable-fly',
    'db-pullover',
    'straight-arm-pulldown',
    'assisted-dip',
    'bench-dip',
    'inverted-row',
    'cable-crunch',
    'hanging-knee-raise',
    'farmers-hold',
    'ab-rollout',
  ]
  const accessories = program.exercises.filter((e) => e.accessory !== undefined)
  const byId = new Map(program.exercises.map((e) => [e.id, e]))
  const catalog = new Map(program.exercises.map((e) => [e.id, e]))

  it('is exactly the twenty movements Shawn chose, in catalog order, after the 71 program.md runs', () => {
    expect(accessories.map((e) => e.id)).toEqual(ACCESSORY_IDS)
    expect(program.exercises.slice(71).map((e) => e.id)).toEqual(ACCESSORY_IDS)
    // No session lists them: they are added or offered for extra time only.
    for (const t of program.templates) for (const s of t.slots) expect(ACCESSORY_IDS, s.id).not.toContain(s.exerciseId)
  })

  it('is knee-neutral: push, pull or core only, nothing lower-body, no carry, cardio, jump or step, and nothing one-legged', () => {
    for (const e of accessories) {
      expect(['push', 'pull', 'core'], e.id).toContain(e.pattern)
      expect(isLowerBody(e), e.id).toBe(false)
      expect(notAddableReason(e), e.id).toBeNull()
      expect(e.loadType, e.id).not.toBe('step-height')
      // Unilateral would read "each leg" and run on the injured side's rep budget.
      expect(e.unilateral, e.id).toBe(false)
      expect(e.accessory?.tier, e.id).toBe(e.pattern === 'core' ? 'core' : 'upper')
    }
    // The farmer's hold is a hold, not a carry: a carry is counted in yards and can't be added.
    expect(byId.get('farmers-hold')).toMatchObject({ pattern: 'core', loadType: 'dumbbell-each' })
  })

  it('has every field the catalog carries, with the defaults inside what an add can store', () => {
    for (const e of accessories) {
      const a = e.accessory
      if (!a) throw new Error(e.id)
      expect(a.sets, e.id).toBeLessThanOrEqual(ADDED_SETS_MAX)
      expect(a.repsMax, e.id).toBeGreaterThanOrEqual(a.repsMin)
      for (const cue of a.cues) expect(cue.length, `${e.id}: ${cue}`).toBeLessThanOrEqual(CUE_MAX)
      if (e.loadType === 'bodyweight') expect([e.loadUnit, e.increment], e.id).toEqual(['none', 0])
      else expect([e.loadUnit, e.increment], e.id).toEqual(['lb', 5])
      if (e.loadType === 'dumbbell-each' || e.loadType === 'dumbbell-single') expect(e.requires, e.id).toContain('dumbbells')
    }
    // Only the farmer's hold is counted in seconds; it climbs by double progression over the seconds.
    expect(accessories.filter((e) => e.accessory?.repUnit !== undefined).map((e) => [e.id, e.accessory?.repUnit])).toEqual([['farmers-hold', 'seconds']])
    const hold = byId.get('farmers-hold')
    if (!hold) throw new Error('farmers-hold')
    expect([addedRepUnit(hold), addedRule(hold)]).toEqual(['seconds', 'double-progression'])
    // The bodyweight ones repeat under the fixed rule and never progress (flagged for Shawn).
    expect(accessories.filter((e) => addedRule(e) === 'fixed').map((e) => e.id)).toEqual(['push-up', 'bench-dip', 'inverted-row', 'hanging-knee-raise', 'ab-rollout'])
  })

  it('the schema keeps an accessory to seconds or reps, a range that runs forward, and at most six sets', () => {
    const ok = { tier: 'upper', sets: 3, repsMin: 8, repsMax: 12, cues: ['Slow'], substitutionIds: [] }
    expect(Accessory.safeParse(ok).success).toBe(true)
    expect(Accessory.safeParse({ ...ok, repUnit: 'seconds' }).success).toBe(true)
    for (const unit of ['yards', 'minutes', 'steps', 'reps']) expect(Accessory.safeParse({ ...ok, repUnit: unit }).success, unit).toBe(false)
    expect(Accessory.safeParse({ ...ok, repsMin: 12, repsMax: 8 }).success).toBe(false)
    expect(Accessory.safeParse({ ...ok, sets: 7 }).success).toBe(false)
    expect(Accessory.safeParse({ ...ok, cues: [] }).success).toBe(false)
    expect(Accessory.safeParse({ ...ok, tier: 'lower' }).success).toBe(false)
  })

  it('every substitution resolves, can be added, and can stand in on the slot the accessory runs as', () => {
    for (const e of accessories) {
      const subs = e.accessory?.substitutionIds ?? []
      expect(subs.length, e.id).toBeGreaterThan(0)
      expect(subs, e.id).not.toContain(e.id)
      expect(new Set(subs).size, e.id).toBe(subs.length)
      const defaults = { sets: e.accessory?.sets ?? 3, repsMin: e.accessory?.repsMin ?? 8, repsMax: e.accessory?.repsMax ?? 12 }
      // The slot as it runs, its own list emptied, so the fit check reads each substitution on its merits.
      const slot = { ...slotFromAdded({ id: `added-${e.id}`, ...defaults }, e, 1, 1), substitutionIds: [] }
      for (const id of subs) {
        const sub = byId.get(id)
        expect(sub, `${e.id} -> ${id}`).toBeDefined()
        if (!sub) continue
        expect(notAddableReason(sub), `${e.id} -> ${id}`).toBeNull()
        expect(substitutionProblem(slot, sub), `${e.id} -> ${id}`).toBeNull()
        // A seconds slot never lists a carry.
        if (slot.repUnit === 'seconds') expect(sub.pattern, `${e.id} -> ${id}`).not.toBe('carry')
      }
    }
  })

  it('a swap keeps program.md’s side words: a substitute it writes "each side" reads "each side" on the both-sides slot (PROGRAM-QUESTIONS 169(h))', () => {
    // The side words program.md writes on its own slots of an exercise not logged per side; undefined where it writes none.
    const writtenSides = (id: string): string | undefined => {
      const labels = new Set(program.templates.flatMap((t) => t.slots.filter((s) => s.exerciseId === id && !s.unilateral).map((s) => s.perSideLabel)))
      expect(labels.size, `${id} is written both ways`).toBeLessThanOrEqual(1)
      return [...labels][0]
    }
    const perSide: string[] = []
    for (const e of accessories) {
      const a = e.accessory
      if (!a) throw new Error(e.id)
      const slot = slotFromAdded({ id: `added-${e.id}`, sets: a.sets, repsMin: a.repsMin, repsMax: a.repsMax }, e, 1, 1)
      expect(slot.perSideLabel, e.id).toBeUndefined()
      for (const id of a.substitutionIds) {
        const sub = byId.get(id)
        if (!sub) throw new Error(`${e.id} -> ${id}`)
        // One-legged would read "each leg" and run on the injured side's rep budget, which an accessory slot never sets.
        expect(sub.unilateral, `${e.id} -> ${id}`).toBe(false)
        const written = writtenSides(id)
        expect(effectiveSlot(slot, sub).perSideLabel, `${e.id} -> ${id}`).toBe(written)
        if (written !== undefined) perSide.push(`${e.id} -> ${id}`)
      }
    }
    // The ones that were losing "each side": anti-rotation and lateral trunk work done on one side only.
    expect(perSide).toEqual([
      'cable-crunch -> pallof-press',
      'cable-crunch -> dead-bug',
      'hanging-knee-raise -> dead-bug',
      'hanging-knee-raise -> pallof-press',
      'farmers-hold -> side-plank',
      'ab-rollout -> dead-bug',
      'ab-rollout -> pallof-press',
    ])
  })

  it('an exercise carries perSideLabel exactly where program.md writes side words on work it doesn’t log per side', () => {
    for (const e of program.exercises) {
      const slots = program.templates.flatMap((t) => t.slots.filter((s) => s.exerciseId === e.id))
      const words = new Set(slots.map((s) => s.perSideLabel))
      if (e.unilateral || slots.length === 0 || words.has(undefined)) expect(e.perSideLabel, e.id).toBeUndefined()
      else expect([e.perSideLabel], e.id).toEqual([...words])
    }
    expect(program.exercises.filter((e) => e.perSideLabel !== undefined).map((e) => [e.id, e.perSideLabel])).toEqual([
      ['lateral-band-walk', 'each way'],
      ['dead-bug', 'each side'],
      ['side-plank', 'each side'],
      ['pallof-press', 'each side'],
      ['skater-bounds-stuck', 'each side'],
      ['change-of-direction-45', 'each way'],
    ])
    // One-legged work says "each leg" through `unilateral`; the schema refuses both at once.
    const deadBug = byId.get('dead-bug')
    if (!deadBug) throw new Error('dead-bug')
    expect(Exercise.safeParse({ ...deadBug, unilateral: true }).success).toBe(false)
    expect(Exercise.safeParse({ ...deadBug, perSideLabel: '' }).success).toBe(false)
  })

  it('the kneeling and hanging ones say so in their cues, and name a swap (PROGRAM-QUESTIONS 171)', () => {
    const cues = (id: string) => (byId.get(id)?.accessory?.cues ?? []).join(' ')
    expect(cues('ab-rollout')).toMatch(/if kneeling hurts the injured knee, stop and do the dead bug instead/)
    expect(cues('assisted-dip')).toMatch(/kneecaps; if that is sore at all, do the bench dip instead/)
    expect(byId.get('assisted-dip')?.accessory?.substitutionIds[0]).toBe('bench-dip')
    expect(cues('hanging-knee-raise')).toMatch(/No weight pinned/)
    expect(cues('hanging-knee-raise')).toMatch(/never drop to the floor/)
    expect(byId.get('hanging-knee-raise')?.name).toBe('Knee raise on the dip handles')
    expect(cues('push-up')).toMatch(/On the toes, not the knees/)
    expect(cues('push-up')).toMatch(/without kneeling/)
    expect(cues('farmers-hold')).toMatch(/hip hinge/)
    // The cable crunch stands: nobody asked for a kneeling one, and kneeling loads the kneecap.
    expect(byId.get('cable-crunch')).toMatchObject({ name: 'Cable crunch (standing)', requires: ['cable-station'] })
    expect(cues('cable-crunch')).toMatch(/^Stand facing away from the stack/)
  })

  it('program.md’s accessory and core table matches the seed cell by cell', () => {
    const blocks = parseMarkdown(programMd)
    const label = blocks.findIndex((b) => b.kind === 'paragraph' && plainText(b.inlines) === 'Accessory and core catalog')
    expect(label).toBeGreaterThan(0)
    const table = blocks.slice(label).find((b): b is Extract<Block, { kind: 'table' }> => b.kind === 'table')
    if (!table) throw new Error('no accessory table in program.md')
    expect(table.header.map((c) => plainText(c))).toEqual(['Exercise', 'Equipment', 'Added as', 'Cues', 'Use instead, in order'])
    const expected = accessories.map((e) => {
      const a = e.accessory
      if (!a) throw new Error(e.id)
      return [e.name, e.equipment, addedPrescriptionText(a, e), a.cues.join(' '), a.substitutionIds.map((id) => byId.get(id)?.name ?? id).join(', then ')]
    })
    expect(table.rows.map((r) => r.map((c) => plainText(c)))).toEqual(expected)
    // The farmer's hold reads in seconds: addedPrescriptionText takes the exercise for its unit.
    expect(plainText(table.rows.find((r) => plainText(r[0] ?? []) === 'Farmer’s hold' || plainText(r[0] ?? []) === "Farmer's hold")?.[2] ?? [])).toBe('3 × 30–45 s')
  })

  it('extra time offers program.md’s pulls and pushes first, then the upper accessories taking turns, then core (PROGRAM-QUESTIONS 170)', () => {
    const p1a = templateFor(1, 'A')
    const upper = extensionPool({ template: p1a, templates: program.templates, phaseWeek: 1, catalog }).filter((s) => s.label.startsWith('+U'))
    expect(upper.map((s) => s.exerciseId)).toEqual([
      // program.md's own, +U1 to +U7 as before Batch C (the rest already run in A or come from B and C first)
      'single-arm-cable-pulldown',
      'chest-press-machine',
      'smith-bench-press',
      'chest-supported-db-row',
      'single-arm-cable-row',
      'face-pull',
      'rear-delt-machine',
      // the upper tier, pulls and pushes taking turns
      'db-curl',
      'triceps-pressdown',
      'hammer-curl',
      'overhead-triceps-extension',
      'upright-row-cable',
      'lateral-raise',
      'shrug',
      'push-up',
      'db-pullover',
      'front-raise',
      'straight-arm-pulldown',
      'overhead-press-machine',
      'inverted-row',
      'cable-fly',
      'assisted-dip',
      'bench-dip',
      // then core
      'cable-crunch',
      'hanging-knee-raise',
      'farmers-hold',
      'ab-rollout',
    ])
    expect(upper.map((s) => s.label)).toEqual(upper.map((_, i) => `+U${i + 1}`))
  })
})

describe('the warm-up: its minutes and its warm-up sets (Batch C, PROGRAM-QUESTIONS 165, 166)', () => {
  const lift = program.warmUp.lift

  it('the knee circuit runs 5 minutes in Phases 1–2 and 3 from Phase 3, and the bike 5, as the intro says', () => {
    expect(lift.circuitMinutesByPhase).toEqual({ '1': 5, '2': 5, '3': 3, '4': 3 })
    expect(lift.bikeMinutes).toBe(5)
    expect(lift.intro).toContain('5 minutes on the upright bike')
    expect(lift.intro).toContain('5-minute knee circuit')
    expect(lift.intro).toContain('shrinks to 3 minutes')
  })

  it('the ramp: 8 reps at half the working load, then 5 at three-quarters', () => {
    expect(lift.ramp.percents).toEqual([0.5, 0.75])
    expect(lift.ramp.reps).toEqual([8, 5])
    expect(lift.ramp.patterns).toEqual(['squat', 'hinge', 'push'])
    expect(lift.ramp.loadTypes).toEqual(['stack', 'plates', 'smith-plates', 'dumbbell-each', 'dumbbell-single'])
    expect(lift.ramp.excludeRequires).toEqual(['back-extension-bench'])
  })

  it('the ramp’s words are program.md’s warm-up paragraph, verbatim, between the circuit and the run warm-up', () => {
    expect(programMd).toContain(`\n\n${lift.ramp.text}\n\n`)
    const at = programMd.indexOf(lift.ramp.text)
    expect(programMd.lastIndexOf('Knee-to-wall ankle rocks', at)).toBeGreaterThan(0)
    expect(programMd.indexOf('Before a run:', at)).toBeGreaterThan(at)
    expect(lift.ramp.text).toMatch(/^Warm-up sets \(added Nov 9, 2026\)/)
    expect(lift.ramp.text).toContain("They aren't logged and don't count as sets.")
  })

  it('covers exactly the eleven big two-legged, two-handed loaded lifts, and the text names every one of them', () => {
    const r = lift.ramp
    const eligible = program.exercises
      .filter(
        (e) =>
          r.patterns.includes(e.pattern) &&
          r.loadTypes.includes(e.loadType) &&
          e.loadDirection === 'up' &&
          !e.unilateral &&
          e.accessory === undefined &&
          !e.requires.flatMap((q) => (typeof q === 'string' ? [q] : q.anyOf)).some((id) => r.excludeRequires.includes(id)),
      )
      .map((e) => e.id)
    expect(eligible).toEqual(['leg-press', 'leg-press-45', 'smith-box-squat', 'goblet-squat-bench', 'db-rdl', 'smith-rdl', 'db-bench-press', 'incline-db-press', 'chest-press-machine', 'smith-bench-press', 'seated-db-shoulder-press'])
    for (const words of ['leg press', 'Smith box squat', 'goblet squat', '45° leg press', 'dumbbell or Smith RDL', 'dumbbell bench, incline or shoulder press', 'chest press machine', 'Smith bench press', 'back extension', 'accessory and core catalog'])
      expect(r.text, words).toContain(words)
  })

  it('the schema wants one rep count per percent, rising percents under 1, and known patterns and load types', () => {
    const ok = { ...raw.warmUp, lift: { ...raw.warmUp.lift } }
    expect(Program.shape.warmUp.safeParse(ok).success).toBe(true)
    const withRamp = (ramp: object) => Program.shape.warmUp.safeParse({ ...ok, lift: { ...ok.lift, ramp: { ...ok.lift.ramp, ...ramp } } }).success
    expect(withRamp({ reps: [8] })).toBe(false)
    expect(withRamp({ percents: [0.75, 0.5] })).toBe(false)
    expect(withRamp({ percents: [0.5, 1] })).toBe(false)
    expect(withRamp({ patterns: ['carry-ish'] })).toBe(false)
    expect(withRamp({ loadTypes: ['kettlebell'] })).toBe(false)
    expect(Program.shape.warmUp.safeParse({ ...ok, lift: { ...ok.lift, bikeMinutes: 0 } }).success).toBe(false)
  })
})
