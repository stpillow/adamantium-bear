import { describe, expect, it } from 'vitest'
import programMd from '../../docs/program.md?raw'
import phasesChart from '../../docs/media/image1.png?inline'
import mileageChart from '../../docs/media/image2.png?inline'
import { planSession } from '../app/session.ts'
import { homeLocation } from '../db/migrations.ts'
import { program, templateFor } from '../program/program.ts'
import { newDownPeriod } from '../rules/downPeriod.ts'
import { fallbacksAfter } from '../rules/equipment.ts'
import { substitutionProblem } from '../rules/overrides.ts'
import { parseInline, parseMarkdown, type Block } from '../rules/markdown.ts'
import { DEFAULT_KIT, Settings, type ProgramOverride, type Slot } from '../schema/index.ts'
import {
  CHART_SIZES,
  CUE_COUNT_FROM,
  SUBSTITUTION_ORDER_NOTE,
  addSections,
  cueCountWords,
  editedDetail,
  editorView,
  exerciseName,
  groupWords,
  patternWords,
  phaseScreen,
  removedWords,
  tableLayout,
  unaddedCueWords,
} from './Program.helpers.ts'

const settingsIn = (over: Partial<Settings> = {}): Settings =>
  Settings.parse({ injuredSide: program.injuredSide, startDate: '2026-11-02', dumbbellMax: 80, restTimerSeconds: 60, painPerSet: false, ...over })
const edit = (over: Partial<ProgramOverride>): ProgramOverride => ({ slotId: 'p1a-1', editedOn: '2026-11-16', ...over }) as ProgramOverride
const seedSlot = (templateId: string, slotId: string): Slot => {
  const slot = program.templates.find((t) => t.id === templateId)?.slots.find((s) => s.id === slotId)
  if (!slot) throw new Error(`no slot ${slotId}`)
  return slot
}

describe('phaseScreen: this phase, as it runs this week', () => {
  it('Phase 1 in week 2: its three sessions, every slot with its label, exercise, prescription verbatim, cues and substitutions in order', () => {
    const screen = phaseScreen(settingsIn(), '2026-11-10', [], [])
    expect(screen.lead).toBe('Phase 1, Foundation: week 2 of the phase. Read-only until you tap Edit on a slot.')
    expect(screen.notWritten).toBeNull()
    expect(screen.sessions.map((s) => s.heading)).toEqual(['Session A', 'Session B', 'Session C'])
    const legPress = screen.sessions[0]?.rows[0]
    expect(legPress).toMatchObject({
      id: 'p1a-1',
      label: '1',
      exerciseName: 'Leg press, both legs',
      prescriptionText: '3 × 10–12, RPE 6→7',
      cues: ['Feet high and shoulder-width; lower for 3 s; stop at 90° or wherever pain stays at 3 or under; no hard lockout'],
      substitutions: ['45° leg press', 'Smith machine box squat', 'Goblet squat to a bench'],
      edited: false,
    })
    expect(screen.sessions[0]?.rows.map((r) => r.label)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
  })

  it('shows only the slots that run this week of the phase: snap-downs join Phase 2 from its third week', () => {
    const phaseTwo = settingsIn({ currentPhase: 2, phaseEnteredWeek: 4 })
    expect(phaseScreen(phaseTwo, '2026-11-23', [], []).sessions[0]?.rows.some((r) => r.label === 'prep')).toBe(false)
    expect(phaseScreen(phaseTwo, '2026-12-07', [], []).sessions[0]?.rows[0]?.label).toBe('prep')
  })

  it('a down period holds the bands this week the way Today plans them (PROGRAM-QUESTIONS 188)', () => {
    // Phase 3 entered in week 8; a period Sat Jan 2 to Fri Jan 8, 2027; Tue Jan 5 is the calendar's phase week 3.
    const phaseThree = settingsIn({ currentPhase: 3, phaseEnteredWeek: 8 })
    const period = newDownPeriod({ today: '2027-01-02', days: 7, declaredAt: '2027-01-02T13:00:00.000Z' })
    const plyo = (screen: ReturnType<typeof phaseScreen>) => (screen.sessions[0]?.rows ?? []).map((r) => r.id).filter((id) => id.includes('plyo'))
    const held = phaseScreen(phaseThree, '2027-01-05', [], [period])
    expect(held.lead).toBe('Phase 3, Power, deceleration and lacrosse prep: week 2 of the phase. Read-only until you tap Edit on a slot.')
    expect(plyo(held)).toEqual(['p3a-plyo-1', 'p3a-plyo-2', 'p3a-plyo-3'])
    // The same slots Today's plan runs.
    const planned = planSession({ template: templateFor(3, 'A'), week: 10, settings: phaseThree, history: { workouts: [], setLogs: [], morningChecks: [], runs: [], gateTests: [], sessionMoves: [], downPeriods: [period] }, gym: { location: homeLocation(80, program.planetFitness, '2026-11-02', program.equipmentListVersion), kit: DEFAULT_KIT }, before: '2027-01-05' })
    expect(plyo(held)).toEqual(planned.map((p) => p.slot.id).filter((id) => id.includes('plyo')))
    expect(plyo(phaseScreen(phaseThree, '2027-01-05', [], []))).toEqual(['p3a-plyo-4', 'p3a-plyo-5', 'p3a-plyo-6', 'p3a-plyo-7'])
  })

  it('before the start date it reads week 1 of the phase', () => {
    expect(phaseScreen(settingsIn(), '2026-10-30', [], []).lead).toBe('Phase 1, Foundation: week 1 of the phase. Read-only until you tap Edit on a slot.')
  })

  it('an edited slot runs Shawn’s lists and says Edited; the rest stay program.md’s', () => {
    const screen = phaseScreen(settingsIn(), '2026-11-10', [edit({ cues: ['Feet high'], substitutionIds: ['goblet-squat-bench'] })], [])
    const [first, second] = screen.sessions[0]?.rows ?? []
    expect(first).toMatchObject({ cues: ['Feet high'], substitutions: ['Goblet squat to a bench'], edited: true })
    expect(second?.edited).toBe(false)
  })

  it('names a superset’s other slots, and says when a slot is optional', () => {
    const rows = phaseScreen(settingsIn(), '2026-11-10', [], []).sessions[0]?.rows ?? []
    expect(rows.find((r) => r.label === '5')?.notes).toEqual(['Grouped with 6 and 7.'])
    expect(rows.find((r) => r.label === '9')?.notes).toEqual(['Optional.'])
    expect(rows.find((r) => r.label === '1')?.notes).toEqual([])
  })

  it('Phase 4: no sessions, said in words', () => {
    const screen = phaseScreen(settingsIn({ currentPhase: 4, phaseEnteredWeek: 13 }), '2027-01-25', [], [])
    expect(screen.sessions).toEqual([])
    expect(screen.lead).toBe('Phase 4, Lacrosse.')
    expect(screen.notWritten).toBe('Phase 4’s sessions are not written yet; program.md says they come once Gate 3 is clean. Its preview is under program.md.')
  })
})

describe('groupWords', () => {
  it('names the other members of a group, in session order', () => {
    const slots = templateFor(1, 'A').slots
    expect(groupWords(slots[4] as Slot, slots)).toBe('Grouped with 6 and 7.')
    expect(groupWords(slots[5] as Slot, slots)).toBe('Grouped with 5 and 7.')
    expect(groupWords(slots[0] as Slot, slots)).toBeNull()
  })

  it('a group with one other member this week names just it', () => {
    const slots = templateFor(1, 'B').slots
    expect(groupWords(slots.find((s) => s.label === '7') as Slot, slots)).toBe('Grouped with 8.')
  })
})

describe('editorView: what the editor shows for a slot', () => {
  it('a slot as program.md writes it: no Edited line, no Back to program.md’s', () => {
    const view = editorView(seedSlot('p1-a', 'p1a-1'), undefined)
    expect(view.edit).toEqual({ cues: seedSlot('p1-a', 'p1a-1').cues, substitutionIds: seedSlot('p1-a', 'p1a-1').substitutionIds })
    expect(view.substitutions.map((s) => s.name)).toEqual(['45° leg press', 'Smith machine box squat', 'Goblet squat to a bench'])
    expect(view.edited).toEqual({ cues: false, substitutions: false })
    expect(view.detail).toBeNull()
    expect(view.writtenCues).toBeNull()
    expect(view.writtenSubstitutions).toBeNull()
  })

  it('an edited slot says what is Shawn’s and since when, and keeps program.md’s lists beside it', () => {
    const view = editorView(seedSlot('p1-a', 'p1a-1'), edit({ substitutionIds: ['goblet-squat-bench', 'smith-box-squat'] }))
    expect(view.detail).toBe('Edited Nov 16: your substitutions, program.md’s cues.')
    expect(view.writtenCues).toBeNull()
    expect(view.writtenSubstitutions).toEqual(['45° leg press', 'Smith machine box squat', 'Goblet squat to a bench'])
  })
})

describe('the lists the Program screen shows are the lists the runner runs', () => {
  it('drops an imported edit the slot can’t count or step, as planSession does (PROGRAM-QUESTIONS 130)', () => {
    // A carry, counted in yards, on Phase 1 A's leg press, counted in reps: the repo refuses it, but a file can bring it.
    const misfit = edit({ substitutionIds: ['farmers-carry', 'smith-box-squat'] })
    const slot = seedSlot('p1-a', 'p1a-1')
    expect(editorView(slot, misfit).substitutions.map((s) => s.id)).toEqual(['smith-box-squat'])
    const row = phaseScreen(settingsIn(), '2026-11-10', [misfit], []).sessions[0]?.rows[0]
    expect(row?.substitutions).toEqual(['Smith machine box squat'])
    const ran = planSession({
      template: templateFor(1, 'A'),
      week: 2,
      settings: settingsIn(),
      history: { workouts: [], setLogs: [], morningChecks: [], runs: [], gateTests: [], sessionMoves: [], programOverrides: [misfit] },
      gym: { location: homeLocation(80, program.planetFitness, '2026-11-02', program.equipmentListVersion), kit: DEFAULT_KIT },
    })
    expect(ran[0]?.slot.substitutionIds).toEqual(['smith-box-squat'])
  })
})

describe('exerciseName', () => {
  it('names an exercise from the catalog, and falls back to its id', () => {
    expect(exerciseName('smith-box-squat')).toBe('Smith machine box squat')
    expect(exerciseName('retired-press')).toBe('retired-press')
  })
})

describe('editedDetail', () => {
  it('says which lists are Shawn’s, in words', () => {
    expect(editedDetail({ cues: true, substitutions: false }, '2026-11-16')).toBe('Edited Nov 16: your cues, program.md’s substitutions.')
    expect(editedDetail({ cues: true, substitutions: true }, '2026-12-01')).toBe('Edited Dec 1: your cues and substitutions.')
    expect(editedDetail({ cues: false, substitutions: false }, '2026-12-01')).toBeNull()
  })
})

describe('cueCountWords', () => {
  it('stays quiet for a short cue, counts near the limit, and says how far over', () => {
    expect(cueCountWords('Feet high')).toBeNull()
    expect(cueCountWords('x'.repeat(CUE_COUNT_FROM))).toBe(`${CUE_COUNT_FROM} of 200 characters.`)
    expect(cueCountWords('x'.repeat(200))).toBe('200 of 200 characters.')
    expect(cueCountWords('x'.repeat(214))).toBe('214 of 200 characters: 14 over.')
    // Counted as it would be stored.
    expect(cueCountWords(`  ${'x'.repeat(200)}  `)).toBe('200 of 200 characters.')
  })

  it('counts an emoji as one character, as the refusal and the schema do', () => {
    expect(cueCountWords('💪'.repeat(150))).toBeNull()
    expect(cueCountWords('💪'.repeat(170))).toBe('170 of 200 characters.')
    expect(cueCountWords('💪'.repeat(201))).toBe('201 of 200 characters: 1 over.')
  })
})

describe('removedWords', () => {
  it('names what came off the list', () => {
    expect(removedWords('cue', 'Feet high')).toBe('Removed the cue “Feet high”.')
    expect(removedWords('substitution', 'Goblet squat to a bench')).toBe('Removed Goblet squat to a bench from the substitutions.')
  })
})

describe('SUBSTITUTION_ORDER_NOTE', () => {
  // The back-off it describes is prescription.ts's easier version: `fallbacksAfter(slot, current)[0]`,
  // the next entry after the exercise the slot is on that this gym has (PROGRAM-QUESTIONS 79 and 84).
  const byId = new Map(program.exercises.map((e) => [e.id, e]))
  const stepUps = seedSlot('p1-c', 'p1c-1')
  const everything = new Set(program.equipment.map((e) => e.id))

  it('says a back-off on bodyweight work steps to the next one after the exercise the slot is on, that this gym has', () => {
    expect(SUBSTITUTION_ORDER_NOTE).toBe(
      'In this order, the gym moves the slot on when something isn’t here, Swap offers them, and a back-off on bodyweight work steps from the exercise the slot is on to the next one after it that this gym has.',
    )
    expect(SUBSTITUTION_ORDER_NOTE).not.toContain('first one')
  })

  it('matches the rule: from the slot’s own exercise the first substitution, from the first the second, and past one the gym lacks', () => {
    expect([stepUps.exerciseId, ...stepUps.substitutionIds]).toEqual(['step-up', 'step-up-stair', 'split-squat'])
    expect(fallbacksAfter(stepUps, 'step-up', byId, everything)[0]?.id).toBe('step-up-stair')
    // Already on its first substitution, the slot backs off to its second: never "the first one".
    expect(fallbacksAfter(stepUps, 'step-up-stair', byId, everything)[0]?.id).toBe('split-squat')
    // A gym with no stair: the back-off from the step-up passes over it to the one this gym has.
    const noStair = new Set(program.equipment.map((e) => e.id).filter((id) => id !== 'stair'))
    expect(fallbacksAfter(stepUps, 'step-up', byId, noStair)[0]?.id).toBe('split-squat')
  })
})

describe('unaddedCueWords', () => {
  it('says a new cue typed but never added is kept in its field, quoting it as it would be stored, once the editor closes', () => {
    expect(unaddedCueWords('  Drive through\n  the heel ')).toBe('Your new cue wasn’t added yet: “Drive through the heel”. It waits in the new-cue field; tap Edit, then Add cue.')
    // Kept even when it couldn't be added as it stands: the words are his, and the field says what is wrong.
    expect(unaddedCueWords('x'.repeat(214))).toContain('wasn’t added yet')
  })
  it('says nothing when the field holds no words', () => {
    expect(unaddedCueWords('')).toBeNull()
    expect(unaddedCueWords('  \n\t ')).toBeNull()
    expect(unaddedCueWords('\u200b')).toBeNull()
  })
})

describe('addSections and patternWords', () => {
  it('offers the slot’s own pattern first, then the rest under their pattern’s name', () => {
    const slot = seedSlot('p1-a', 'p1a-5')
    const sections = addSections(slot, { cues: [], substitutionIds: slot.substitutionIds }, program.exercises)
    expect(sections.same.heading).toBe('Hip, like Hip abductor machine')
    expect(sections.same.exercises.map((e) => e.id)).toEqual(['smith-hip-thrust', 'db-glute-bridge', 'db-hip-thrust', 'single-leg-hip-thrust', 'hip-adductor-machine', 'cable-hip-adduction', 'copenhagen-plank-long'])
    expect(sections.others[0]?.heading).toBe('Squat')
    // Less the slot and its list (4), its own pattern (7), and the 6 it can't count or step (below).
    expect(sections.others.flatMap((g) => g.exercises)).toHaveLength(program.exercises.length - 4 - 7 - 6)
    expect(sections.otherCount).toBe(program.exercises.length - 4 - 7 - 6)
  })

  it('leaves out what the slot can’t count or step, which the repo would refuse (PROGRAM-QUESTIONS 130)', () => {
    const abductor = seedSlot('p1-a', 'p1a-5')
    const offered = (slot: Slot, substitutionIds = slot.substitutionIds) => {
      const sections = addSections(slot, { cues: [], substitutionIds }, program.exercises)
      return [...sections.same.exercises, ...sections.others.flatMap((g) => g.exercises)].map((e) => e.id)
    }
    // A reps slot with no step height: no step-up, no carry, no cardio.
    for (const id of ['step-up', 'step-up-stair', 'lateral-step-down', 'farmers-carry', 'suitcase-carry', 'elliptical-easy']) expect(offered(abductor)).not.toContain(id)
    // A slot counted in yards takes only a carry: with its list emptied, the carries are all Add offers.
    const carry = seedSlot('p1-c', 'p1c-7')
    expect(offered(carry, [])).toEqual(program.exercises.filter((e) => e.pattern === 'carry' && e.id !== carry.exerciseId).map((e) => e.id))
    // Every slot: nothing Add offers is refused on save.
    for (const slot of program.templates.flatMap((t) => t.slots)) {
      for (const id of offered(slot)) {
        const exercise = program.exercises.find((e) => e.id === id)
        expect(exercise && substitutionProblem(slot, exercise), `${slot.id} ${id}`).toBeNull()
      }
    }
  })

  it('words a pattern as program.md would: capitalized, hyphen kept', () => {
    expect(patternWords('single-leg')).toBe('Single-leg')
    expect(patternWords('plyo')).toBe('Plyo')
  })
})

/** A PNG's own width and height, from its IHDR chunk (bytes 16 to 23 of the file). */
function pngSize(dataUrl: string): { width: number; height: number } {
  const head = atob(dataUrl.slice(dataUrl.indexOf(',') + 1).slice(0, 32))
  const view = new DataView(Uint8Array.from(head, (c) => c.charCodeAt(0)).buffer)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

describe('CHART_SIZES', () => {
  it('gives each of program.md’s chart images its file’s own width and height, so the page keeps its place while one loads', () => {
    expect(CHART_SIZES['media/image1.png']).toEqual(pngSize(phasesChart))
    expect(CHART_SIZES['media/image2.png']).toEqual(pngSize(mileageChart))
    expect(CHART_SIZES['media/image1.png']).toEqual({ width: 1344, height: 416 })
    const named = parseMarkdown(programMd).flatMap((b) => (b.kind === 'image' ? [b.src] : []))
    expect(named).toEqual(['media/image1.png', 'media/image2.png'])
    expect(Object.keys(CHART_SIZES).sort()).toEqual(named)
  })
})

describe('tableLayout', () => {
  const table = (header: string[], rows: string[][]): Extract<Block, { kind: 'table' }> => ({
    kind: 'table',
    header: header.map((h) => parseInline(h)),
    rows: rows.map((r) => r.map((c) => (c === '' ? [] : parseInline(c)))),
  })

  it('keeps a narrow table of short cells as a grid: the mileage plan', () => {
    expect(tableLayout(table(['Week', 'Starts', 'Miles', 'Down week'], [['1', 'Nov 2', '10', ''], ['4', 'Nov 23', '9', 'down']]))).toBe('grid')
  })

  it('stacks a table with a long cell or more than four columns, so a phone never scrolls sideways', () => {
    expect(tableLayout(table(['#', 'Exercise', 'Sets × reps', 'Cues'], [['1', 'Leg press, both legs', '3 × 10–12', 'Feet high and shoulder-width; lower for 3 s']]))).toBe('stacked')
    expect(tableLayout(table(['a', 'b', 'c', 'd', 'e'], [['1', '2', '3', '4', '5']]))).toBe('stacked')
  })
})
