import { describe, expect, it } from 'vitest'
import { phaseWeekFor } from '../app/session.ts'
import { homeLocation } from '../db/migrations.ts'
import { newDownPeriod } from '../rules/downPeriod.ts'
import { program } from '../program/program.ts'
import { availableEquipment, equipmentChecklist, usedEquipment } from '../rules/equipment.ts'
import { newLocation } from '../rules/locations.ts'
import { rowItems, typedOutcome } from '../rules/whereYouTrain.ts'
import type { Location, ProgramOverride, Settings } from '../schema/index.ts'
import {
  DEFAULT_START,
  KEEP_AS_TYPED,
  RACK_MAX,
  RACK_PRESETS,
  RACK_STEP,
  rackGridNote,
  rackSaved,
  START_CHOICES,
  changeWords,
  changesView,
  checklistSections,
  coverageWeek,
  currentTemplates,
  keptRows,
  kitAfter,
  kitRows,
  lackWords,
  markedWords,
  nameCheck,
  nameCountWords,
  extraTooLongWords,
  outcomeWords,
  rackChoiceWords,
  rackNote,
  removedExtraWords,
  removeExtraAsk,
  shortDate,
  startWords,
  startedFromWords,
  templatesAsRun,
  typedWords,
  usedByWords,
} from './LocationEditor.helpers.ts'

const KIT = ['ankle-strap', 'mini-band']
const byId = new Map(program.exercises.map((e) => [e.id, e]))
const checklist = equipmentChecklist(program.equipment, program.exercises)
const used = usedEquipment(program.exercises)
const lists = { planetFitness: program.planetFitness, equipmentListVersion: program.equipmentListVersion }
const availableOf = (l: Location, kit: string[] = KIT) => availableEquipment(l, program.equipment, program.planetFitness, kit)

const home = homeLocation(80, program.planetFitness, '2026-11-02', program.equipmentListVersion)
/** Brief's browser drive: started empty, a few items marked, dumbbells to 25. */
const marriott: Location = {
  ...newLocation('loc-1', { name: 'Marriott Downtown', startedFrom: 'empty', dumbbellMaxLb: 25, createdOn: '2026-11-09' }, lists),
  present: ['smith-machine', 'flat-bench', 'cable-station', 'mats', 'lat-pulldown'],
}

const settings = (over: Partial<Settings> = {}): Settings => ({
  injuredSide: 'right',
  startDate: '2026-11-02',
  dumbbellMax: 80,
  restTimerSeconds: 60,
  painPerSet: false,
  currentPhase: 1,
  phaseEnteredWeek: 1,
  redFlag: { active: false, items: [] },
  activeLocationId: 'planet-fitness',
  kit: [...KIT],
  ...over,
})

const section = (sections: ReturnType<typeof checklistSections>, id: string) => sections.flatMap((s) => s.rows).find((r) => r.id === id)

describe('shortDate', () => {
  it('reads the month and day from the stored string', () => {
    expect(shortDate('2026-11-10')).toBe('Nov 10')
    expect(shortDate('2027-01-04')).toBe('Jan 4')
  })
})

describe('nameCheck', () => {
  const gyms = [home, marriott]

  it('takes 1 to 60 characters, trimmed', () => {
    expect(nameCheck('  Hilton Midtown ', gyms, null)).toEqual({ ok: true, name: 'Hilton Midtown' })
    expect(nameCheck('x'.repeat(60), gyms, null).ok).toBe(true)
    expect(nameCheck('   ', gyms, null)).toEqual({ ok: false, message: 'A gym needs a name: type the one you will look for on Today.' })
    expect(nameCheck('x'.repeat(61), gyms, null)).toEqual({ ok: false, message: 'That is 61 characters; a gym’s name fits in 60.' })
  })

  it("refuses another listed gym's name, and lets a gym keep its own", () => {
    expect(nameCheck('marriott downtown', gyms, null)).toEqual({ ok: false, message: 'Marriott Downtown already has that name. Pick one Today can tell apart.' })
    // The refusal names the gym as stored, not the typed text with its own punctuation ("planet FITNESS!.").
    expect(nameCheck('planet  FITNESS!', gyms, null)).toEqual({ ok: false, message: 'Planet Fitness already has that name. Pick one Today can tell apart.' })
    expect(nameCheck('Marriott Downtown', gyms, 'loc-1')).toEqual({ ok: true, name: 'Marriott Downtown' })
  })

  it('counts what is typed', () => {
    expect(nameCountWords(' Marriott ')).toBe('8 of 60 characters')
  })

  it('refuses a name that shows nothing, in a sentence of its own; an emoji name shows (M4b review)', () => {
    const blank = 'A name made only of invisible characters shows as a blank row on Today: type a letter, a digit or a symbol.'
    expect(nameCheck('\u200B', gyms, null)).toEqual({ ok: false, message: blank })
    expect(nameCheck('\u200B\u3164\u2800', gyms, null)).toEqual({ ok: false, message: blank })
    expect(nameCheck('🏨', gyms, null)).toEqual({ ok: true, name: '🏨' })
  })

  it('counts an emoji as one character, as the schema does, so the count and the refusal match what saves (M4b review)', () => {
    expect(nameCountWords('🏨'.repeat(31))).toBe('31 of 60 characters')
    expect(nameCheck('🏨'.repeat(60), gyms, null).ok).toBe(true)
    expect(nameCountWords('🏨'.repeat(60))).toBe('60 of 60 characters')
    expect(nameCheck('🏨'.repeat(61), gyms, null)).toEqual({ ok: false, message: 'That is 61 characters; a gym’s name fits in 60.' })
  })
})

describe('start and rack choices', () => {
  it("preselects Planet Fitness's list and offers starting empty", () => {
    expect(DEFAULT_START).toBe('planet-fitness')
    expect(START_CHOICES.map((c) => c.label)).toEqual(['Start from Planet Fitness’s list', 'Start empty'])
    // program.md's list and nothing else: a new gym gets no 45° leg press (PROGRAM-QUESTIONS 71); the words name no one's club (M-U1, PROGRAM-QUESTIONS 211).
    expect(startWords('planet-fitness')).toBe('Everything on program.md’s Planet Fitness list is marked here to start, and nothing else is. Untick what this gym lacks; tick what it adds.')
    expect(startWords('empty')).toBe('Nothing is marked here to start; tick what this gym has.')
    expect(startedFromWords('empty')).toBe('Started empty.')
    expect(startedFromWords('planet-fitness')).toBe('Started from Planet Fitness’s list.')
  })

  it('offers None, 25, 50, 60, 75 and 80, and a stepper by 5', () => {
    expect(RACK_PRESETS).toEqual([0, 25, 50, 60, 75, 80])
    expect(RACK_STEP).toBe(5)
    expect(RACK_PRESETS.map(rackChoiceWords)).toEqual(['None', '25 lb', '50 lb', '60 lb', '75 lb', '80 lb'])
    expect(rackNote(0)).toBe('No dumbbells: slots that need them move to the next exercise on their list that runs here.')
    expect(rackNote(25)).toBe('The heaviest dumbbell is 25 lb. A load past it moves the slot, or with nothing to move to, is rack-capped and won’t count as clean.')
  })

  it('a typed rack saves on the 5 lb grid, and the note says how (M4b review)', () => {
    // The stepper's field takes any whole number; a typed 47 saves as the 45 lb dumbbell.
    expect(rackSaved(47)).toBe(45)
    expect(rackSaved(80)).toBe(80)
    expect(RACK_MAX).toBe(200)
    expect(rackGridNote).toBe('Racks go by 5 lb: a weight typed in between saves as the 5 lb below it.')
  })
})

describe("the substitution table's rows on the live seed", () => {
  it('speaks for the items each row names, and gives the dumbbell bench press row to none', () => {
    expect(program.substitutionTable.map((row) => [row.takenOrMissing, rowItems(row, program.equipment)])).toEqual([
      ['Leg press', ['seated-leg-press', 'leg-press-45']],
      ['Seated leg curl', ['seated-leg-curl']],
      ['Smith machine', ['smith-machine']],
      ['Hip abductor or adductor machine', ['hip-abductor-machine', 'hip-adductor-machine']],
      ['Step platforms', ['step-platforms']],
      ['Lat pulldown', ['lat-pulldown']],
      ['Dumbbell bench', []],
      ['Seated row', ['seated-row']],
      ['Calf machine', ['seated-calf-machine']],
      ['Bosu or balance pad', ['bosu']],
      ['Medicine ball (Phase 3)', ['medicine-ball']],
    ])
  })
})

describe('checklistSections', () => {
  const sections = (location: Location, kit: string[] = KIT) =>
    checklistSections({ checklist, location, available: availableOf(location, kit), byId, vocabulary: program.equipment, table: program.substitutionTable })

  it("groups by program.md's rows, as the checklist does", () => {
    expect(sections(home).map((s) => s.group)).toEqual(program.equipmentBySlot.map((r) => r.slot))
  })

  it("marks the home gym's items Here but the lying leg curl, which Shawn's club lacks", () => {
    const rows = sections(home).flatMap((s) => s.rows)
    expect(rows.filter((r) => !r.here).map((r) => r.id)).toEqual(['lying-leg-curl'])
  })

  it('says what uses an item and what the table says to use without it', () => {
    expect(section(sections(home), 'seated-leg-press')).toEqual({
      id: 'seated-leg-press',
      label: 'Seated leg press',
      here: true,
      notes: [usedByWords(checklist.flatMap((g) => g.items).find((e) => e.item.id === 'seated-leg-press')!, byId), 'If not here: Smith box squat, then goblet squat to a bench'],
    })
    expect(section(sections(home), 'stair')?.notes).toEqual(['Used by: Step-up on the lowest stair in the club; Single-leg calf raise on a step'])
  })

  it("hedges the bosu with program.md's words", () => {
    expect(section(sections(home), 'bosu')?.label).toBe('Bosu or balance pad, if your club has one')
    expect(section(sections(home), 'bosu')?.notes).toContain('If not here: Folded mat, then eyes closed on the floor')
  })

  it('reads a mark-off as Not here, with the day it was marked', () => {
    const marked = { ...home, markedOff: [{ id: 'seated-leg-press', on: '2026-11-10' }] }
    const row = section(sections(marked), 'seated-leg-press')
    expect(row?.here).toBe(false)
    expect(row?.notes.at(-1)).toBe('Marked not here since Nov 10; Here clears the mark.')
  })

  it('flags an item new on the list since the gym was made', () => {
    const old = { ...marriott, listVersion: 0 }
    expect(section(sections(old), 'smith-machine')?.notes).toContain('New on the program’s list since this gym was made.')
    expect(section(sections(marriott), 'smith-machine')?.notes).not.toContain('New on the program’s list since this gym was made.')
  })
})

describe('usedByWords', () => {
  const entry = (id: string) => checklist.flatMap((g) => g.items).find((e) => e.item.id === id)!

  it('names the exercises, the run swap and the warm-up that use an item', () => {
    expect(usedByWords(entry('elliptical'), byId)).toBe('Used by: Elliptical, easy; the Hold-day elliptical swap')
    expect(usedByWords(entry('rower'), byId)).toBe('Used by: the Hold-day rower swap')
    expect(usedByWords(entry('upright-bike'), byId)).toBe('Used by: the lift warm-up')
    expect(usedByWords(entry('bosu'), byId)).toBe('Used by: Balance on a folded mat or bosu')
  })

  it('keeps names that carry their own commas apart: "Leg press, both legs" is one exercise', () => {
    expect(usedByWords(entry('seated-leg-press'), byId)).toBe('Used by: Leg press, both legs; Single-leg leg press; Standing calf raise on the leg press or Smith')
  })
})

describe('the bag', () => {
  it('lists the two items to bring, each in the bag or not', () => {
    expect(kitRows(program.equipment, ['mini-band'])).toEqual([
      { id: 'ankle-strap', name: 'Cable ankle strap', inBag: false },
      { id: 'mini-band', name: 'Mini loop band', inBag: true },
    ])
  })

  it("puts an item in or takes it out, in the list's order, each once", () => {
    expect(kitAfter(['mini-band'], 'ankle-strap', true, program.equipment)).toEqual(['ankle-strap', 'mini-band'])
    expect(kitAfter(['ankle-strap', 'mini-band'], 'ankle-strap', false, program.equipment)).toEqual(['mini-band'])
    expect(kitAfter(['ankle-strap'], 'ankle-strap', true, program.equipment)).toEqual(['ankle-strap'])
    expect(kitAfter(['mini-band', 'odd-item'], 'ankle-strap', true, program.equipment)).toEqual(['ankle-strap', 'mini-band', 'odd-item'])
  })
})

describe('Something else here?', () => {
  const at = (text: string, location: Location = marriott) => typedOutcome(text, program.equipment, used, availableOf(location))
  const words = (text: string, location: Location = marriott) => outcomeWords(at(text, location), text, program.equipment)

  it('asks before marking a known item', () => {
    expect(words('Bosu ball')).toBe('Matches Bosu or balance pad. Mark it here?')
    expect(words('Smith')).toBe('Smith machine is already marked here.')
    expect(markedWords('bosu', program.equipment)).toBe('Bosu or balance pad is marked here.')
  })

  it('offers near misses with a way out', () => {
    expect(at('Rowing machine')).toEqual({ kind: 'choose', ids: ['rower', 'seated-row'] })
    expect(words('Rowing machine')).toBe('Did you mean one of these? Nothing is marked until you tap one.')
    expect(KEEP_AS_TYPED).toBe('Neither: keep as typed')
  })

  it('keeps what no exercise uses, in its own words', () => {
    expect(words('Kettlebells')).toBe('No exercise in the program uses kettlebells. Kept for the next program.md update.')
    expect(words('TRX')).toBe('No exercise in the program uses TRX. Kept for the next program.md update.')
    expect(words('treadmill')).toBe('Treadmill is on program.md’s list, but no session uses it. Kept for the next program.md update.')
    // The overhead press machine uses it now (Batch C, PROGRAM-QUESTIONS 172): typed, it reads as an item the program uses.
    expect(at('shoulder press')).toEqual({ kind: 'mark', id: 'shoulder-press-machine' })
    expect(words('shoulder press')).toBe('Matches Shoulder press machine. Mark it here?')
  })

  it("sends the bag and the rack to their sections, and asks for text when there is none", () => {
    expect(words('ankle strap')).toBe('Cable ankle strap goes in your bag, not on a gym’s list: In your bag (every gym) says whether you carry it.')
    expect(words('dumbbells')).toBe('Dumbbells go by the rack: set the heaviest one under Dumbbells.')
    expect(words('  ')).toBe('Type what the gym has first.')
  })

  it('puts typed text inside a sentence', () => {
    expect(typedWords('  Kettlebells ')).toBe('kettlebells')
    expect(typedWords('TRX straps')).toBe('TRX straps')
    expect(typedWords('sled  track')).toBe('sled track')
  })
})

describe('What this changes', () => {
  it("reads today's week of the phase, from week 1 before the start", () => {
    expect(coverageWeek(settings(), '2026-10-30', [])).toBe(1)
    expect(coverageWeek(settings(), '2026-11-18', [])).toBe(3)
    expect(coverageWeek(settings({ currentPhase: 2, phaseEnteredWeek: 5 }), '2026-12-16', [])).toBe(3)
  })

  it('reads the band a down period holds, as Today and the plan read it (PROGRAM-QUESTIONS 188)', () => {
    // Phase 3 entered in week 8; a period Sat Jan 2 to Fri Jan 8, 2027: Tue Jan 5 is the calendar's phase week 3, held at 2.
    const phaseThree = settings({ currentPhase: 3, phaseEnteredWeek: 8 })
    const period = newDownPeriod({ today: '2027-01-02', days: 7, declaredAt: '2027-01-02T13:00:00.000Z' })
    expect(coverageWeek(phaseThree, '2027-01-05', [period])).toBe(2)
    expect(coverageWeek(phaseThree, '2027-01-05', [])).toBe(3)
    const history = { downPeriods: [period] }
    for (const [date, week] of [['2027-01-01', 9], ['2027-01-05', 10], ['2027-01-09', 10], ['2027-01-12', 11], ['2027-01-19', 12]] as const) {
      expect(coverageWeek(phaseThree, date, [period]), date).toBe(phaseWeekFor(week, phaseThree, history, date))
    }
  })

  it("takes the current phase's three sessions, and none in Phase 4", () => {
    expect(currentTemplates(settings()).map((t) => t.id)).toEqual(['p1-a', 'p1-b', 'p1-c'])
    expect(currentTemplates(settings({ currentPhase: 2 })).map((t) => t.id)).toEqual(['p2-a', 'p2-b', 'p2-c'])
    expect(currentTemplates(settings({ currentPhase: 4 }))).toEqual([])
  })

  const view = (location: Location, over: Partial<Settings> = {}, phaseWeek = 1) => {
    const s = settings(over)
    return changesView({
      templates: currentTemplates(s),
      phase: s.currentPhase,
      phaseWeek,
      phaseEnteredWeek: s.phaseEnteredWeek,
      byId,
      available: availableOf(location),
      items: program.equipment,
      gymName: location.name,
    })
  }

  it('says nothing moves at the home gym', () => {
    expect(view(home)).toEqual({ heading: 'Every slot of Phase 1’s sessions runs its own exercise at Planet Fitness.', sessions: [] })
  })

  it("lists each session's moves at a gym started empty, in words", () => {
    const { heading, sessions } = view(marriott)
    expect(heading).toBe('What moves at Marriott Downtown for the rest of Phase 1:')
    expect(sessions.map((s) => s.label)).toEqual(['Session A', 'Session B', 'Session C'])
    expect(sessions[0]?.lines).toEqual([
      'Leg press, both legs → Smith machine box squat (no seated leg press)',
      'Nothing here for Seated leg curl (no seated leg curl)',
      'Hip abductor machine → Cable hip abduction, ankle strap (no hip abductor machine)',
      'Nothing here for Elliptical, easy (no elliptical)',
    ])
    expect(sessions[2]?.lines).toContain('Incline dumbbell press → Smith bench press (no adjustable bench)')
  })

  it('lists the blocks that start later in the phase, from the program week they start (Phase 3 entered in week 9)', () => {
    const phase3 = { currentPhase: 3, phaseEnteredWeek: 9 }
    const [a] = view(marriott, phase3).sessions
    expect(a?.lines).toContain('Nothing here for Step-off landing from a 6–8 in. step, stuck for 2 s (no step platforms)')
    expect(a?.lines).toContain('From week 11: Nothing here for Jump onto the circuit step and step down (no step platforms)')
    expect(a?.lines.findIndex((l) => l.startsWith('From week 11'))).toBeGreaterThan(a?.lines.findIndex((l) => l.startsWith('Nothing here for Step-off')) ?? 0)
    // In the phase's third week the first block has passed and the second runs now.
    const [later] = view(marriott, phase3, 3).sessions
    expect(later?.lines).toContain('Nothing here for Jump onto the circuit step and step down (no step platforms)')
    expect(later?.lines.some((l) => l.includes('Step-off landing'))).toBe(false)
  })

  it('names the stand-in the session runs: the Program screen’s edits to a slot’s substitutions, not program.md’s list', () => {
    const s = settings()
    // Shawn put the goblet squat ahead of the Smith box squat on Phase 1 A's leg press.
    const edit: ProgramOverride = { slotId: 'p1a-1', substitutionIds: ['goblet-squat-bench', 'smith-box-squat'], editedOn: '2026-11-16' }
    const edited = changesView({
      templates: templatesAsRun(s, [edit]),
      phase: s.currentPhase,
      phaseWeek: 1,
      phaseEnteredWeek: s.phaseEnteredWeek,
      byId,
      available: availableOf(marriott),
      items: program.equipment,
      gymName: marriott.name,
    })
    expect(edited.sessions[0]?.lines[0]).toBe('Leg press, both legs → Goblet squat to a bench (no seated leg press)')
    // The runner plans the same slot from the same lists.
    expect(templatesAsRun(s, [edit])[0]?.slots[0]?.substitutionIds).toEqual(['goblet-squat-bench', 'smith-box-squat'])
    // With no edits, the lists are program.md's; an id the catalog no longer has is dropped, never named.
    expect(templatesAsRun(s, [])).toEqual(currentTemplates(s))
    const retired: ProgramOverride = { slotId: 'p1a-1', substitutionIds: ['retired-press', 'smith-box-squat'], editedOn: '2026-11-16' }
    expect(templatesAsRun(s, [retired])[0]?.slots[0]?.substitutionIds).toEqual(['smith-box-squat'])
    // An imported file's edit the slot can't count (a carry, in yards, on a reps slot) is dropped, as the runner drops it.
    const misfit: ProgramOverride = { slotId: 'p1a-1', substitutionIds: ['farmers-carry', 'smith-box-squat'], editedOn: '2026-11-16' }
    expect(templatesAsRun(s, [misfit])[0]?.slots[0]?.substitutionIds).toEqual(['smith-box-squat'])
    // program.md's templates are never written.
    expect(currentTemplates(s)[0]?.slots[0]?.substitutionIds).toEqual(['leg-press-45', 'smith-box-squat', 'goblet-squat-bench'])
  })

  it('says Phase 4 has no sessions to move', () => {
    expect(view(home, { currentPhase: 4 })).toEqual({ heading: 'Phase 4’s sessions aren’t written yet, so nothing moves at Planet Fitness yet.', sessions: [] })
  })

  it('words a move, a slot with nothing here, and what is missing from the bag', () => {
    const items = program.equipment
    expect(lackWords(['smith-machine', { anyOf: ['step-platforms', 'stair'] }, 'ankle-strap'], items)).toBe('no Smith machine, no step platforms, no stair, no cable ankle strap in your bag')
    expect(changeWords({ slotId: 'x', from: 'goblet-squat-bench', to: 'goblet-squat-bench', kind: 'none', missing: ['dumbbells'] }, byId, items)).toBe(
      `Nothing here for ${byId.get('goblet-squat-bench')?.name} (no dumbbells)`,
    )
  })
})

describe('keptRows', () => {
  it("lists what was typed with its day, then the list's items no session uses", () => {
    const gym: Location = { ...marriott, present: [...marriott.present, 'treadmill'], extras: [{ id: 'extra-1', text: 'Kettlebells', addedOn: '2026-11-10' }] }
    expect(keptRows(gym, program.equipment, program.exercises).map((r) => r.text)).toEqual(['Kettlebells, typed Nov 10', 'Treadmill, on program.md’s list'])
    expect(keptRows(marriott, program.equipment, program.exercises)).toEqual([])
  })
  it('a typed line carries its id, so it can be taken back; a list item is taken back by marking it Not here (M4b review)', () => {
    const gym: Location = {
      ...marriott,
      present: [...marriott.present, 'treadmill'],
      extras: [
        { id: 'extra-1', text: 'Kettlebels', addedOn: '2026-11-10' },
        { id: 'extra-2', text: 'Kettlebells', addedOn: '2026-11-10' },
      ],
    }
    expect(keptRows(gym, program.equipment, program.exercises)).toEqual([
      { key: 'extra:extra-1', text: 'Kettlebels, typed Nov 10', extraId: 'extra-1', typed: 'Kettlebels' },
      { key: 'extra:extra-2', text: 'Kettlebells, typed Nov 10', extraId: 'extra-2', typed: 'Kettlebells' },
      { key: 'item:Treadmill', text: 'Treadmill, on program.md’s list', extraId: null, typed: null },
    ])
    expect(removeExtraAsk('Kettlebels')).toBe('Take “Kettlebels” off this gym and the next-update list? Nothing else changes.')
    expect(removedExtraWords('Kettlebels')).toBe('“Kettlebels” is off the list.')
  })
})

describe('typed equipment past 80 characters (M4b review)', () => {
  it('is refused in words before anything is written, counted as the schema counts', () => {
    expect(extraTooLongWords('x'.repeat(112))).toBe('That is 112 characters; typed equipment fits in 80. Shorten it to the name of the equipment.')
    expect(extraTooLongWords(`  ${'🏨'.repeat(81)}  `)).toBe('That is 81 characters; typed equipment fits in 80. Shorten it to the name of the equipment.')
  })
})
