import { describe, expect, it } from 'vitest'
import { program } from '../program/program.ts'
import { withPresent } from '../rules/locations.ts'
import {
  DEFAULT_GYM_NAME,
  FIRST_RUN_STEPS,
  IMPORT_NOTE,
  comingMondayWords,
  firstIncompleteStep,
  firstRunProblems,
  gymLine,
  kitWords,
  newFirstRunDraft,
  nextStep,
  readyLines,
  startFailedWords,
  startLine,
  stepProblem,
  stepToShow,
  stepWords,
  withListStart,
  withZone,
  zoneStepLines,
  type FirstRunDraft,
} from './Welcome.helpers.ts'

const TUESDAY = '2026-11-03'
const NY = 'America/New_York'
const LA = 'America/Los_Angeles'
const fresh = () => newFirstRunDraft(TUESDAY, NY, program)
const allSeen = (draft: FirstRunDraft): FirstRunDraft => ({ ...draft, seen: [...FIRST_RUN_STEPS] })

describe('a fresh draft: neutral defaults, never Shawn’s (PROGRAM-QUESTIONS 208)', () => {
  it('has no side, the coming Monday, a gym named Home gym from Planet Fitness’s list with no dumbbells, program.md’s bag and the phone’s zone', () => {
    const draft = fresh()
    expect(draft).toMatchObject({ injuredSide: null, startDate: '2026-11-09', startTouched: false, gymName: 'Home gym', equipmentTouched: false, kit: ['ankle-strap', 'mini-band'], zone: NY, seen: [] })
    expect(draft.home).toMatchObject({ id: 'planet-fitness', name: DEFAULT_GYM_NAME, startedFrom: 'planet-fitness', dumbbellMaxLb: 0, createdOn: TUESDAY, archived: false })
    expect(draft.home.present).toEqual(program.planetFitness)
    expect(draft.home.present).not.toContain('leg-press-45')
  })
  it('on a Monday the coming Monday is today', () => {
    expect(newFirstRunDraft('2026-11-09', NY, program).startDate).toBe('2026-11-09')
    expect(comingMondayWords('2026-11-09')).toBe('Use Monday Nov 9 (today)')
    expect(comingMondayWords(TUESDAY)).toBe('Use Monday Nov 9 (the coming Monday)')
  })
})

describe('defaults that follow other answers', () => {
  it('a new zone moves an untouched start to that zone’s coming Monday, and leaves a picked one', () => {
    // Monday Nov 2 in Los Angeles while it is Tuesday Nov 3 in New York.
    expect(withZone(fresh(), LA, '2026-11-02')).toMatchObject({ zone: LA, startDate: '2026-11-02' })
    expect(withZone({ ...fresh(), startDate: '2026-11-16', startTouched: true }, LA, '2026-11-02')).toMatchObject({ zone: LA, startDate: '2026-11-16' })
  })
  it('a new list start rebuilds the list, keeping the name, rack and day, and clears the marks', () => {
    const marked = { ...fresh(), home: withPresent({ ...fresh().home, dumbbellMaxLb: 50 }, 'leg-press-45', true), equipmentTouched: true }
    const empty = withListStart(marked, 'empty', program)
    expect(empty.home).toMatchObject({ startedFrom: 'empty', present: [], dumbbellMaxLb: 50, createdOn: TUESDAY })
    expect(empty.equipmentTouched).toBe(false)
    expect(withListStart(empty, 'planet-fitness', program).home.present).toEqual(program.planetFitness)
  })
})

describe('each step’s Next: only the side has no default, and nothing is left empty', () => {
  it('the side must be picked', () => {
    expect(stepProblem(fresh(), 'side')).toBe('Pick the injured knee to go on. There’s no default: a guess would load the wrong leg.')
    expect(stepProblem({ ...fresh(), injuredSide: 'left' }, 'side')).toBeNull()
  })
  it('the start date must be a Monday, and may be any Monday, past or future', () => {
    expect(stepProblem({ ...fresh(), startDate: '' }, 'start')).toBe('Pick a date. Week 1 starts on it, and the deload weeks hang off it.')
    expect(stepProblem({ ...fresh(), startDate: '2026-11-03' }, 'start')).toContain('is not a Monday')
    expect(stepProblem({ ...fresh(), startDate: '2026-10-05' }, 'start')).toBeNull()
    expect(stepProblem({ ...fresh(), startDate: '2027-03-01' }, 'start')).toBeNull()
  })
  it('the gym needs a name the location editor would take, and not another stored gym’s', () => {
    expect(stepProblem({ ...fresh(), gymName: '  ' }, 'gym')).toBe('A gym needs a name: type the one you will look for on Today.')
    expect(stepProblem({ ...fresh(), gymName: 'x'.repeat(61) }, 'gym')).toContain('fits in 60')
    expect(stepProblem({ ...fresh(), gymName: 'Hotel' }, 'gym', [{ id: 'loc-1', name: 'Hotel', archived: false }])).toBe('Hotel already has that name. Pick one Today can tell apart.')
    // The stored home gym's own name is not "taken".
    expect(stepProblem({ ...fresh(), gymName: 'Garage' }, 'gym', [{ id: 'planet-fitness', name: 'Garage', archived: false }])).toBeNull()
  })
  it('the zone must be one this phone knows', () => {
    expect(stepProblem({ ...fresh(), zone: 'Not/AZone' }, 'time')).toBe('Pick a time zone this phone knows.')
    expect(stepProblem({ ...fresh(), zone: 'UTC' }, 'time')).toBeNull()
  })
  it('what it has and Ready ask nothing', () => {
    expect(stepProblem({ ...fresh(), home: { ...fresh().home, present: [] }, kit: [] }, 'equipment')).toBeNull()
    expect(stepProblem(fresh(), 'ready')).toBeNull()
  })
  it('lists every problem in step order', () => {
    expect(firstRunProblems({ ...fresh(), gymName: '' }).map((p) => p.step)).toEqual(['side', 'gym'])
    expect(firstRunProblems({ ...fresh(), injuredSide: 'right' })).toEqual([])
  })
})

describe('which step a link opens: a default counts only once its step was shown', () => {
  it('opens the first step not passed with Next, however far on the link points', () => {
    expect(firstIncompleteStep(fresh())).toBe('side')
    expect(stepToShow('ready', fresh())).toBe('side')
    expect(stepToShow('time', { ...fresh(), injuredSide: 'right', seen: ['side', 'start'] })).toBe('gym')
    expect(stepToShow('start', { ...fresh(), injuredSide: 'right', seen: ['side', 'start'] })).toBe('start')
    expect(firstIncompleteStep(allSeen({ ...fresh(), injuredSide: 'right' }))).toBe('ready')
    // A step passed once and then broken again (an emptied name) is the one to fix.
    expect(firstIncompleteStep(allSeen({ ...fresh(), injuredSide: 'right', gymName: '' }))).toBe('gym')
  })
  it('steps go in order', () => {
    expect(nextStep('side')).toBe('start')
    expect(nextStep('time')).toBe('ready')
    expect(nextStep('ready')).toBeNull()
  })
  it('each step says which of six it is', () => {
    expect(stepWords('side')).toEqual({ title: 'Injured side', lead: 'Step 1 of 6 · The side the program rehabs.', next: 'Next: start date' })
    expect(stepWords('time').lead).toBe('Step 5 of 6 · Today’s date and every week boundary are counted in it.')
    expect(stepWords('ready')).toEqual({ title: 'Ready', lead: 'Step 6 of 6 · Check it, then Today.', next: 'Start the program' })
  })
})

describe('Ready’s lines', () => {
  it('Shawn’s answers', () => {
    const draft: FirstRunDraft = {
      ...allSeen(fresh()),
      injuredSide: 'right',
      startDate: '2026-11-02',
      startTouched: true,
      gymName: 'Planet Fitness',
      home: withPresent({ ...fresh().home, name: 'Planet Fitness', dumbbellMaxLb: 80 }, 'leg-press-45', true),
    }
    expect(readyLines(draft, TUESDAY, program.equipment)).toEqual([
      { step: 'side', text: 'Injured: the right knee.' },
      { step: 'start', text: 'Week 1: Monday Nov 2, 2026; today is in week 1.' },
      { step: 'gym', text: 'Home gym: Planet Fitness, 31 items, dumbbells to 80 lb.' },
      { step: 'equipment', text: 'You bring: cable ankle strap and mini loop band.' },
      { step: 'time', text: 'Dates in New York time (America/New_York).' },
    ])
  })
  it('a start ahead, no dumbbells, an empty bag, another zone, and a home gym already stored', () => {
    expect(startLine('2026-11-09', TUESDAY)).toBe('Monday Nov 9, 2026; it starts in 6 days.')
    expect(startLine('2026-11-09', '2026-11-08')).toBe('Monday Nov 9, 2026; it starts tomorrow.')
    expect(gymLine({ name: 'Garage', present: ['flat-bench'], dumbbellMaxLb: 0 })).toBe('Garage, 1 item, no dumbbells.')
    expect(kitWords([], program.equipment)).toBe('nothing')
    const lines = readyLines({ ...fresh(), kit: [], zone: LA }, TUESDAY, program.equipment, { name: 'Old gym', present: [], dumbbellMaxLb: 25 })
    expect(lines.map((l) => l.text)).toEqual([
      'Injured: not picked yet.',
      'Week 1: Monday Nov 9, 2026; it starts in 6 days.',
      'Home gym: Old gym, 0 items, dumbbells to 25 lb, already on this phone and kept as it is.',
      'You bring: nothing.',
      'Dates in Los Angeles time (America/Los_Angeles).',
    ])
  })
  it('says a failed save in words, and the first screen’s import note', () => {
    expect(startFailedWords('QuotaExceededError')).toBe('Nothing was saved (QuotaExceededError); tap again.')
    expect(IMPORT_NOTE).toBe('Moving from another phone? A file from Export JSON brings everything, settings included, and skips these questions.')
  })
})

describe('the time zone step', () => {
  it('says what the phone is set to and today there, and the zone picked when it is another', () => {
    expect(zoneStepLines(LA, LA, '2026-11-02')).toEqual(['This phone is set to Los Angeles time (America/Los_Angeles). Today there is Monday Nov 2.'])
    expect(zoneStepLines(LA, NY, '2026-11-03')).toEqual(['This phone is set to Los Angeles time (America/Los_Angeles).', 'Picked: New York time (America/New_York). Today there is Tuesday Nov 3.'])
  })
})
