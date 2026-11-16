import { describe, expect, it } from 'vitest'
import { PROGRAM, planSession, type Gym } from '../app/session.ts'
import { homeLocation } from '../db/migrations.ts'
import type { History } from '../db/repo.ts'
import { exerciseById } from '../program/program.ts'
import { DEFAULT_KIT, Settings, type Workout } from '../schema/index.ts'
import { caveatWords, nextLiftWords, previewRampWords, previewDownPeriodWords, previewRange, previewSlots, previewView, relationWords } from './Preview.helpers.ts'

const settings = Settings.parse({ injuredSide: 'right', startDate: '2026-11-02', dumbbellMax: 80, restTimerSeconds: 60, painPerSet: false, currentPhase: 1, phaseEnteredWeek: 1 })
const empty: History = { workouts: [], setLogs: [], morningChecks: [], runs: [], gateTests: [], sessionMoves: [] }
const home: Gym = { location: homeLocation(80, PROGRAM.planetFitness, '2026-11-02', PROGRAM.equipmentListVersion), kit: DEFAULT_KIT }
const nameOf = (id: string) => exerciseById(id).name

describe('previewView', () => {
  it('a lift day ahead: the current phase’s template, its week, and why the numbers can still change', () => {
    const v = previewView({ mode: 'full', date: '2026-11-05', today: '2026-11-03', settings, history: empty, program: PROGRAM })
    expect(v).toMatchObject({ dateWords: 'Thursday, November 5', relation: 'In 2 days', week: 1, deload: false, prev: '2026-11-04', next: '2026-11-06' })
    expect(v.phaseLine).toMatch(/^Phase 1 · /)
    expect(v.body).toMatchObject({ kind: 'lift', label: 'Session B', letter: 'B', week: 1, logged: null, missingWords: null })
    expect(v.body.kind === 'lift' ? v.body.template?.id : null).toBe('p1-b')
    expect(v.caveat).toContain('can change these numbers')
  })
  it('follows a session moved onto another day', () => {
    const history = { workouts: [], sessionMoves: [{ id: 'move-000001', week: 1, dayA: 'tue' as const, dayB: 'wed' as const }] }
    expect(previewView({ mode: 'full', date: '2026-11-04', today: '2026-11-02', settings, history, program: PROGRAM }).body).toMatchObject({ kind: 'lift', letter: 'A' })
    expect(previewView({ mode: 'full', date: '2026-11-03', today: '2026-11-02', settings, history, program: PROGRAM }).body).toMatchObject({ kind: 'run' })
  })
  it('a day with the session logged points at it; a deload week says so', () => {
    const done: Workout = { id: '2026-11-03-p1-a', date: '2026-11-03', templateId: 'p1-a', phase: 1, week: 1, isDeload: false, status: 'finished' }
    expect(previewView({ mode: 'full', date: '2026-11-03', today: '2026-11-05', settings, history: { workouts: [done], sessionMoves: [] }, program: PROGRAM }).body).toMatchObject({ kind: 'lift', logged: { workoutId: '2026-11-03-p1-a', status: 'finished' } })
    expect(previewView({ mode: 'full', date: '2026-11-24', today: '2026-11-03', settings, history: empty, program: PROGRAM })).toMatchObject({ week: 4, deload: true })
  })
  it('run and off days, and the days before week 1', () => {
    expect(previewView({ mode: 'full', date: '2026-11-02', today: '2026-11-02', settings, history: empty, program: PROGRAM }).body).toMatchObject({ kind: 'run' })
    expect(previewView({ mode: 'full', date: '2026-11-08', today: '2026-11-02', settings, history: empty, program: PROGRAM }).body).toMatchObject({ kind: 'off' })
    const before = previewView({ mode: 'full', date: '2026-10-30', today: '2026-10-30', settings, history: empty, program: PROGRAM })
    expect(before).toMatchObject({ prev: null, next: '2026-11-02', body: { kind: 'before-start', line: 'Week 1 starts Monday Nov 2.' } })
  })
  it('steps from the first day to the last Sunday of week 12, or the week after this one past it', () => {
    expect(previewRange('2026-11-03', '2026-11-02')).toEqual({ first: '2026-11-02', last: '2027-01-24' })
    expect(previewView({ mode: 'full', date: '2026-11-02', today: '2026-11-03', settings, history: empty, program: PROGRAM }).prev).toBeNull()
    expect(previewView({ mode: 'full', date: '2027-01-24', today: '2026-11-03', settings, history: empty, program: PROGRAM }).next).toBeNull()
    expect(previewRange('2027-01-27', '2026-11-02').last).toBe('2027-02-07')
  })
})

describe('words', () => {
  it('relation and caveat', () => {
    expect(relationWords('2026-11-03', '2026-11-03')).toBe('Today')
    expect(relationWords('2026-11-04', '2026-11-03')).toBe('Tomorrow')
    expect(relationWords('2026-11-02', '2026-11-03')).toBe('Yesterday')
    expect(relationWords('2026-11-10', '2026-11-03')).toBe('In 7 days')
    expect(relationWords('2026-10-30', '2026-11-03')).toBe('4 days ago')
    expect(caveatWords('2026-11-03', '2026-11-03')).toBe('Planned from what’s logged so far: this is what Start opens with.')
    expect(caveatWords('2026-11-01', '2026-11-03')).toContain('This day has passed')
  })
  it('the next lift on Today', () => {
    expect(nextLiftWords('2026-11-05', 'lift:B', PROGRAM.weeklyTemplateRows)).toBe('Next lift: Session B, Thursday Nov 5')
  })
})

describe('previewSlots, on the live seed', () => {
  const plans = planSession({ template: PROGRAM.templates.find((t) => t.id === 'p1-a')!, week: 1, settings, history: empty, gym: home, before: '2026-11-03' })
  const slots = previewSlots(plans, { injuredSide: 'right', gymName: 'Planet Fitness', items: PROGRAM.equipment, nameOf })

  it('every slot of Session A, in order, with what the runner will prescribe', () => {
    expect(slots.map((s) => s.slotId)).toEqual(plans.map((p) => p.slot.id))
    const first = slots[0]!
    expect(first.name).toBe(plans[0]!.exercise.name)
    // A first-ever session picks its load at RPE 7: the preview says so rather than inventing a number.
    expect(first.lines.join(' ')).toContain('load to pick')
    expect(first.notes.length).toBeGreaterThan(0)
    expect(first.cues).toEqual(plans[0]!.slot.cues)
    expect(first.cuesFor).toBeNull()
    expect(first.gymLines).toEqual([])
  })
  it('a one-leg slot is said per side, injured side first', () => {
    const all = ['p1-a', 'p1-b', 'p1-c'].flatMap((id) => planSession({ template: PROGRAM.templates.find((t) => t.id === id)!, week: 1, settings, history: empty, gym: home, before: '2026-11-03' }))
    const plan = all.find((p) => p.prescriptions.length === 2)
    expect(plan).toBeDefined()
    const [slot] = previewSlots([plan!], { injuredSide: 'right', gymName: 'Planet Fitness', items: PROGRAM.equipment, nameOf })
    expect(slot!.lines[0]).toMatch(/^Right · injured: /)
    expect(slot!.lines[1]).toMatch(/^Left: /)
  })
  it('names the other members of a superset (A5, A6 and A7 run together)', () => {
    expect(slots.find((s) => s.label === '5')?.groupWith).toBe('with 6 and 7')
    expect(slots.find((s) => s.label === '7')?.groupWith).toBe('with 5 and 6')
  })
  it('at a gym without the seated leg press, the move is said in the runner’s words, with the cues labelled', () => {
    const hotel: Gym = { location: { ...home.location, id: 'loc-1', name: 'Marriott Downtown', present: home.location.present.filter((id) => id !== 'seated-leg-press' && id !== 'leg-press-45' && id !== 'smith-machine') }, kit: DEFAULT_KIT }
    const away = planSession({ template: PROGRAM.templates.find((t) => t.id === 'p1-a')!, week: 1, settings, history: empty, gym: hotel, before: '2026-11-03' })
    const awaySlots = previewSlots(away, { injuredSide: 'right', gymName: 'Marriott Downtown', items: PROGRAM.equipment, nameOf })
    const moved = awaySlots.find((s) => s.gymLines.some((l) => l.startsWith('Not at Marriott Downtown')))
    expect(moved).toBeDefined()
    expect(moved?.cuesFor).toMatch(/^Cues written for /)
  })
  it('says the warm-up sets before a big lift, from the ramps it is given, and none without them (PROGRAM-QUESTIONS 165)', () => {
    expect(slots.every((s) => s.ramp === null)).toBe(true)
    const ramps = plans.map((_, i) => (i === 0 ? { kind: 'sets' as const, workingLoad: 180, sets: [{ load: 90, reps: 8, light: null }, { load: 135, reps: 5, light: null }] } : { kind: 'none' as const, why: 'not-eligible' as const }))
    const withRamps = previewSlots(plans, { injuredSide: 'right', gymName: 'Planet Fitness', items: PROGRAM.equipment, nameOf, ramps })
    expect(withRamps[0]?.ramp).toBe('Warm-up sets: 90 lb × 8, then 135 lb × 5 (not logged).')
    expect(withRamps.slice(1).every((s) => s.ramp === null)).toBe(true)
  })
  it('one warm-up set in the singular, the empty bar in words', () => {
    expect(previewRampWords({ kind: 'sets', workingLoad: 10, sets: [{ load: 0, reps: 8, light: 'empty-bar' }] }, exerciseById('smith-box-squat'))).toBe('Warm-up set: empty bar × 8 (not logged).')
    expect(previewRampWords({ kind: 'none', why: 'too-light', workingLoad: 5 }, exerciseById('db-bench-press'))).toBeNull()
    expect(previewRampWords(undefined, exerciseById('db-bench-press'))).toBeNull()
  })
})

describe('a down period on the Preview (Batch E)', () => {
  const P1 = { id: 'dp-2026-11-14', start: '2026-11-14', plannedEnd: '2026-11-20', declaredAt: '2026-11-14T13:00:00.000Z' }
  it('says when a period covers the day, until its last paused day', () => {
    expect(previewDownPeriodWords('2026-11-17', [P1])).toBe('A down period covers this day: progression paused until Friday Nov 20.')
    expect(previewDownPeriodWords('2026-11-17', [{ ...P1, endedOn: '2026-11-17' }])).toBe('A down period covers this day: progression paused until Tuesday Nov 17.')
    expect(previewDownPeriodWords('2026-11-21', [P1])).toBeNull()
    expect(previewView({ mode: 'full', date: '2026-11-17', today: '2026-11-16', settings, history: { ...empty, downPeriods: [P1] }, program: PROGRAM }).downPeriod).toBe('A down period covers this day: progression paused until Friday Nov 20.')
    expect(previewView({ mode: 'full', date: '2026-11-17', today: '2026-11-16', settings, history: empty, program: PROGRAM }).downPeriod).toBeNull()
  })
})
