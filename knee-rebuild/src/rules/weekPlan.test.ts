import { describe, expect, it } from 'vitest'
import type { DownPeriod, MileageWeek, Run, WeeklyTemplate, Workout } from '../schema/index.ts'
import type { SubjectReading } from './history.ts'
import { weekMiles } from './mileage.ts'
import { readingsInWeek, runTypeFor, runsInWeek, sessionDone, suggestRun, targetForWeek, weekAdherence, weekDays, weekMilesSummary } from './weekPlan.ts'

const START = '2026-11-02'
const plan: MileageWeek[] = [10, 11, 12, 9, 13, 14, 15, 11, 16, 17, 18, 14].map((targetMiles, i) => ({ week: i + 1, targetMiles, isDown: [4, 8, 12].includes(i + 1) }))
const TEMPLATE: WeeklyTemplate = { mon: 'run:mbr', tue: 'lift:A', wed: 'run:easy', thu: 'lift:B', fri: 'run:long', sat: 'lift:C', sun: 'off' }
const run = (date: string, miles: number, type: Run['type'] = 'easy'): Run => ({ id: `r-${date}`, date, type, miles, minutes: 30, effort: 'easy', maxPain: 1, strides: false, tempo: false })
const reading = (date: string, result: SubjectReading['result'], kind: SubjectReading['kind'] = 'run'): SubjectReading => ({ kind, id: `${kind}-${date}`, date, result })

describe('week assembly', () => {
  it('puts runs and readings in their program week', () => {
    const runs = [run('2026-11-08', 3), run('2026-11-09', 3)]
    expect(runsInWeek(runs, START, 1).map((r) => r.date)).toEqual(['2026-11-08'])
    expect(readingsInWeek([reading('2026-11-09', 'clean')], START, 2)).toHaveLength(1)
  })
})

describe('targetForWeek (rule 7 from the logs)', () => {
  it("worked example: week 2's Friday run reads hold; week 3 is capped at week 2's actual miles, not 12", () => {
    const runs = [run('2026-11-09', 3, 'mbr'), run('2026-11-11', 3), run('2026-11-13', 4.5, 'long')]
    const readings = [reading('2026-11-09', 'clean'), reading('2026-11-11', 'clean'), reading('2026-11-13', 'hold')]
    expect(targetForWeek(plan, 3, START, runs, readings)).toMatchObject({ target: 10.5, capped: true })
  })
  it('a clean week leaves the next on plan; week 1 is the plan', () => {
    expect(targetForWeek(plan, 3, START, [run('2026-11-09', 3)], [reading('2026-11-09', 'clean')]).target).toBe(12)
    expect(targetForWeek(plan, 1, START, [], []).target).toBe(10)
  })
  it('a workout reading hold caps runs too', () => {
    expect(targetForWeek(plan, 3, START, [run('2026-11-09', 3)], [reading('2026-11-10', 'hold', 'workout')]).target).toBe(3)
  })
  it('a week with nothing logged caps nothing (PROGRAM-QUESTIONS 56)', () => {
    expect(targetForWeek(plan, 2, START, [], [])).toMatchObject({ target: 11, capped: false })
  })
  it('swaps add no miles to the cap', () => {
    const runs = [run('2026-11-09', 0, 'elliptical-swap'), run('2026-11-11', 3)]
    expect(targetForWeek(plan, 3, START, runs, [reading('2026-11-11', 'hold')]).target).toBe(3)
  })
})

describe('suggestRun', () => {
  const base = { week: 1, target: 10, milesSoFar: 0, currentPhase: 1, phaseWeek: 1, morning: 'clean' as const }
  it('maps sessions to run types', () => {
    expect(runTypeFor('run:long')).toBe('long')
    expect(runTypeFor('lift:A')).toBeNull()
    expect(suggestRun({ ...base, session: 'off' })).toBeNull()
  })
  it('splits the week: long run 40% to the half mile, the others share the rest', () => {
    expect(suggestRun({ ...base, session: 'run:long' })?.miles).toBe(4)
    expect(suggestRun({ ...base, session: 'run:mbr' })?.miles).toBe(3)
  })
  it('never suggests more than what is left under the ceiling', () => {
    const s = suggestRun({ ...base, session: 'run:long', milesSoFar: 7.5 })
    expect(s?.miles).toBe(2.5)
    expect(s?.reasons.join(' ')).toContain('capped')
  })
  it('floors a capped run to the quarter mile and says what is left in hundredths, never float noise', () => {
    const left = (logged: number[], target: number, session: 'run:long' | 'run:easy' = 'run:long') =>
      suggestRun({ ...base, session, target, milesSoFar: weekMiles(logged.map((m, i) => run(`2026-11-0${i + 2}`, m))) })
    expect(left([3.3, 3.3], 10)).toMatchObject({ miles: 3.25, reasons: ["capped at the 3.4 miles left under this week's 10"] })
    expect(left([3.1, 3], 10)).toMatchObject({ miles: 3.75, reasons: ["capped at the 3.9 miles left under this week's 10"] })
    expect(left([4.6, 4.5], 12)).toMatchObject({ miles: 2.75, reasons: ["capped at the 2.9 miles left under this week's 12"] })
    expect(left([3.6, 3.5], 10, 'run:easy')).toMatchObject({ miles: 2.75, reasons: ["capped at the 2.9 miles left under this week's 10"] })
    expect(left([3.25, 3], 10)).toMatchObject({ miles: 3.75 })
    expect(left([5, 5.5], 10)).toMatchObject({ miles: 0, reasons: ["capped at the 0 miles left under this week's 10"] })
  })
  it('strides on Wednesdays and the tempo on Fridays from the third week, in Phase 3 only', () => {
    expect(suggestRun({ ...base, session: 'run:easy', currentPhase: 3, phaseWeek: 1 })?.strides).toBe(true)
    expect(suggestRun({ ...base, session: 'run:easy', currentPhase: 2, phaseWeek: 4 })?.strides).toBe(false)
    expect(suggestRun({ ...base, session: 'run:long', currentPhase: 3, phaseWeek: 2 })?.tempo).toBe(false)
    expect(suggestRun({ ...base, session: 'run:long', currentPhase: 3, phaseWeek: 3 })?.tempo).toBe(true)
  })
  it('a faster Friday every week from Phase 2, never in a deload week or on top of the tempo', () => {
    expect(suggestRun({ ...base, session: 'run:long', currentPhase: 2, phaseWeek: 2, week: 5 })?.fasterAllowed).toBe(true)
    expect(suggestRun({ ...base, session: 'run:long', currentPhase: 2, phaseWeek: 3, week: 6 })?.fasterAllowed).toBe(true)
    expect(suggestRun({ ...base, session: 'run:long', currentPhase: 2, phaseWeek: 1, week: 4 })?.fasterAllowed).toBe(false)
    expect(suggestRun({ ...base, session: 'run:long', currentPhase: 1, phaseWeek: 2, week: 2 })?.fasterAllowed).toBe(false)
    expect(suggestRun({ ...base, session: 'run:easy', currentPhase: 2, phaseWeek: 2, week: 5 })?.fasterAllowed).toBe(false)
    expect(suggestRun({ ...base, session: 'run:long', currentPhase: 3, phaseWeek: 1, week: 9 })?.fasterAllowed).toBe(true)
    expect(suggestRun({ ...base, session: 'run:long', currentPhase: 3, phaseWeek: 3, week: 11 })).toMatchObject({ tempo: true, fasterAllowed: false })
  })
  it('a hold or back-off morning suggests the swap and drops the hard parts', () => {
    const s = suggestRun({ ...base, session: 'run:long', currentPhase: 3, phaseWeek: 3, morning: 'hold' })
    expect(s).toMatchObject({ swapSuggested: true, tempo: false })
    expect(suggestRun({ ...base, session: 'run:easy', morning: 'back-off' })?.swapSuggested).toBe(true)
  })
  it('the reasons come from the final call: no strides, tempo or faster line on a hold or back-off morning', () => {
    const hard = /strides|comfortably-hard|faster/
    for (const morning of ['hold', 'back-off'] as const) {
      const faster = suggestRun({ ...base, session: 'run:long', currentPhase: 2, phaseWeek: 2, week: 5, morning })
      expect(faster).toMatchObject({ swapSuggested: true, fasterAllowed: false })
      expect(faster?.reasons).toHaveLength(1)
      expect(faster?.reasons.join(' ')).not.toMatch(hard)
      expect(suggestRun({ ...base, session: 'run:easy', currentPhase: 3, phaseWeek: 3, week: 10, morning })?.reasons.join(' ')).not.toMatch(hard)
      expect(suggestRun({ ...base, session: 'run:long', currentPhase: 3, phaseWeek: 3, week: 10, morning })?.reasons.join(' ')).not.toMatch(hard)
    }
    const clean = suggestRun({ ...base, session: 'run:long', currentPhase: 3, phaseWeek: 3, week: 10 })
    expect(clean?.reasons).toEqual(['carry a 2 × 5 min comfortably-hard segment with 3 min easy between'])
  })
  it('says when no morning check was logged', () => {
    expect(suggestRun({ ...base, session: 'run:easy', morning: null })?.reasons[0]).toContain('no morning check')
  })
  it('with no morning check yet, the miles stand but strides, the tempo and the faster effort wait (PROGRAM-QUESTIONS 60)', () => {
    const waiting = 'log the morning check first; strides, the tempo and any faster effort wait on a clean morning'
    const tempoDay = { ...base, session: 'run:long' as const, currentPhase: 3, phaseWeek: 3, week: 10, target: 17 }
    expect(suggestRun({ ...tempoDay, morning: 'clean' })).toMatchObject({ miles: 7, tempo: true })
    expect(suggestRun({ ...tempoDay, morning: null })).toEqual({
      type: 'long', miles: 7, headline: '7 miles', strides: false, tempo: false, fasterAllowed: false, swapSuggested: false,
      reasons: ['no morning check yet today', waiting],
    })
    expect(suggestRun({ ...base, session: 'run:easy', currentPhase: 3, phaseWeek: 1, week: 8, morning: null })).toMatchObject({ strides: false, swapSuggested: false })
    const faster = suggestRun({ ...base, session: 'run:long', currentPhase: 2, phaseWeek: 2, week: 5, morning: null })
    expect(faster).toMatchObject({ fasterAllowed: false, swapSuggested: false })
    expect(faster?.reasons).toContain(waiting)
    // Nothing to hold back in Phase 1: the line would only say what isn't on the plan anyway.
    expect(suggestRun({ ...base, session: 'run:mbr', morning: null })?.reasons).toEqual(['no morning check yet today'])
  })
})

describe('suggestRun with the bands held by a down period', () => {
  const base = { week: 9, target: 12, milesSoFar: 0, currentPhase: 3, morning: 'clean' as const, session: 'run:long' as const }
  it('says why the tempo is missing when the calendar would have it', () => {
    const r = suggestRun({ ...base, phaseWeek: 2, calendarPhaseWeek: 3, bandNote: 'Down period: progression paused until Friday Jan 8.' })
    expect(r?.tempo).toBe(false)
    expect(r?.reasons).toContain('no tempo this week: Down period: progression paused until Friday Jan 8.')
  })
  it('says nothing extra when the calendar would not have the tempo either, or the band is the calendar\'s', () => {
    expect(suggestRun({ ...base, phaseWeek: 1, calendarPhaseWeek: 2, bandNote: 'x' })?.reasons.some((x) => x.startsWith('no tempo'))).toBe(false)
    expect(suggestRun({ ...base, phaseWeek: 3, calendarPhaseWeek: 3, bandNote: null })?.tempo).toBe(true)
  })
})

describe('suggestRun headline', () => {
  const base = { week: 1, target: 10, milesSoFar: 0, currentPhase: 1, phaseWeek: 1, morning: 'clean' as const }
  it('names the swap when one is suggested, else the miles, else easy by feel outside the plan', () => {
    expect(suggestRun({ ...base, session: 'run:long', morning: 'hold' })?.headline).toBe('a 30 to 40 minute elliptical or rower swap')
    expect(suggestRun({ ...base, session: 'run:long', target: null, morning: 'back-off' })?.headline).toBe('a 30 to 40 minute elliptical or rower swap')
    expect(suggestRun({ ...base, session: 'run:long' })?.headline).toBe('4 miles')
    expect(suggestRun({ ...base, session: 'run:mbr', milesSoFar: 7.1 })?.headline).toBe('2.75 miles')
    expect(suggestRun({ ...base, session: 'run:mbr', milesSoFar: 9 })?.headline).toBe('1 mile')
    expect(suggestRun({ ...base, session: 'run:easy', week: 13, target: null })?.headline).toBe('easy, by feel')
  })
  it('never says easy over a hard effort the same suggestion calls for (M4 fix verification)', () => {
    // Week 13, Phase 3 since week 8: no mileage target, but Friday still carries the tempo.
    const tempo = suggestRun({ ...base, session: 'run:long', week: 13, target: null, currentPhase: 3, phaseWeek: 6 })
    expect(tempo).toMatchObject({ miles: null, tempo: true })
    expect(tempo?.headline).toBe('distance by feel')
    // Still in Phase 2 at week 13: Friday's faster effort is on.
    const faster = suggestRun({ ...base, session: 'run:long', week: 13, target: null, currentPhase: 2, phaseWeek: 9 })
    expect(faster).toMatchObject({ miles: null, fasterAllowed: true })
    expect(faster?.headline).toBe('distance by feel')
    // Strides finish an easy run, so the easy run stays easy.
    expect(suggestRun({ ...base, session: 'run:easy', week: 13, target: null, currentPhase: 3, phaseWeek: 6 })).toMatchObject({ strides: true, headline: 'easy, by feel' })
    // No check yet: the hard parts wait, so the headline is the plain one.
    expect(suggestRun({ ...base, session: 'run:long', week: 13, target: null, currentPhase: 3, phaseWeek: 6, morning: null })?.headline).toBe('easy, by feel')
  })
})

describe('weekDays', () => {
  const workout = (date: string, status: Workout['status']): Workout => ({ id: `w-${date}`, date, templateId: 'p1-a', phase: 1, week: 1, isDeload: false, status })
  it('marks each day done, missed, today, upcoming or off, with its worst reading', () => {
    const days = weekDays({
      startDate: START, week: 1, today: '2026-11-05', template: TEMPLATE, moves: [],
      runs: [run('2026-11-02', 3, 'mbr')], workouts: [workout('2026-11-03', 'finished')],
      readings: [reading('2026-11-02', 'clean'), reading('2026-11-03', 'hold', 'workout')],
    })
    expect(days.map((d) => d.status)).toEqual(['done', 'done', 'missed', 'today', 'upcoming', 'upcoming', 'off'])
    expect(days[1]?.reading).toBe('hold')
    expect(days[0]?.date).toBe('2026-11-02')
  })
  it('is done only when what was logged is the day’s session; anything else keeps the date’s status and stays listed', () => {
    // Thu Nov 5. Tue (Session A) has only a jog; Wed (easy run) only a workout; Mon a swap; Sun a run.
    const days = weekDays({
      startDate: START, week: 1, today: '2026-11-05', template: TEMPLATE, moves: [],
      runs: [run('2026-11-02', 0, 'rower-swap'), run('2026-11-03', 2), run('2026-11-05', 3, 'long'), run('2026-11-08', 2)],
      workouts: [workout('2026-11-04', 'finished')],
      readings: [],
    })
    expect(days.map((d) => `${d.day}:${d.status}`)).toEqual(['mon:done', 'tue:missed', 'wed:missed', 'thu:today', 'fri:upcoming', 'sat:upcoming', 'sun:done'])
    expect(days[1]?.runs.map((r) => r.date)).toEqual(['2026-11-03'])
    expect(days[2]?.workouts.map((w) => w.date)).toEqual(['2026-11-04'])
    expect(days[3]?.runs.map((r) => r.type)).toEqual(['long'])
  })
  it('an abandoned workout counts as the lift day’s session; one still open or only planned does not', () => {
    const days = weekDays({
      startDate: START, week: 1, today: '2026-11-08', template: TEMPLATE, moves: [],
      runs: [], workouts: [workout('2026-11-03', 'abandoned'), workout('2026-11-05', 'in-progress'), workout('2026-11-07', 'planned')], readings: [],
    })
    expect([days[1]?.status, days[3]?.status, days[5]?.status]).toEqual(['done', 'missed', 'missed'])
  })
  it('sessionDone: a lift needs a workout that happened, a run day a run or swap, an off day anything', () => {
    const jog = [{ date: '2026-11-03' }]
    expect(sessionDone('lift:A', jog, [])).toBe(false)
    expect(sessionDone('lift:A', [], [{ status: 'abandoned' }])).toBe(true)
    expect(sessionDone('lift:A', [], [{ status: 'in-progress' }])).toBe(false)
    expect(sessionDone('run:easy', [], [{ status: 'finished' }])).toBe(false)
    expect(sessionDone('run:easy', jog, [])).toBe(true)
    expect(sessionDone('off', [], [{ status: 'finished' }])).toBe(true)
    expect(sessionDone('off', [], [])).toBe(false)
  })
  it('a moved run on a lift day’s date is done once the run is logged there', () => {
    const days = weekDays({ startDate: START, week: 1, today: '2026-11-08', template: TEMPLATE, moves: [{ id: 'm', week: 1, dayA: 'thu', dayB: 'fri' }], runs: [run('2026-11-05', 4, 'long')], workouts: [], readings: [] })
    expect([days[3]?.session, days[3]?.status, days[4]?.session, days[4]?.status]).toEqual(['run:long', 'done', 'lift:B', 'missed'])
  })
  it('follows session moves', () => {
    const days = weekDays({ startDate: START, week: 1, today: '2026-11-01', template: TEMPLATE, moves: [{ id: 'm', week: 1, dayA: 'thu', dayB: 'fri' }], runs: [], workouts: [], readings: [] })
    expect(days[3]?.session).toBe('run:long')
    expect(days[4]?.session).toBe('lift:B')
  })
})

describe('weekMilesSummary', () => {
  it('counts miles, sessions and swaps against the target', () => {
    const runs = [run('2026-11-02', 3, 'mbr'), run('2026-11-04', 0, 'rower-swap'), run('2026-11-06', 4, 'long')]
    expect(weekMilesSummary(plan, 1, START, runs, [])).toMatchObject({ miles: 7, sessions: 3, swaps: 1, target: { target: 10 } })
  })
})

describe('weekAdherence: sessions done of those scheduled, one program week (Batch B, PROGRAM-QUESTIONS 164)', () => {
  const workout = (date: string, status: Workout['status'] = 'finished'): Workout => ({ id: `w-${date}`, date, templateId: 'p1-a', phase: 1, week: 1, isDeload: false, status })
  const base = { startDate: START, template: TEMPLATE, moves: [] }

  it('counts lifts and runs against the weekly template: Lifts 2 of 3, Runs 3 of 3', () => {
    // Week 1, Nov 2 to 8: runs Mon, Wed, Fri; lifts Tue and Thu; Saturday's lift skipped.
    const runs = [run('2026-11-02', 3, 'mbr'), run('2026-11-04', 3), run('2026-11-06', 4, 'long')]
    expect(weekAdherence({ ...base, week: 1, runs, workouts: [workout('2026-11-03'), workout('2026-11-05')] })).toEqual({ liftsDone: 2, liftsScheduled: 3, runsDone: 3, runsScheduled: 3 })
  })

  it('a swap counts as the run it stood in for', () => {
    const runs = [run('2026-11-02', 0, 'elliptical-swap'), run('2026-11-04', 0, 'rower-swap')]
    expect(weekAdherence({ ...base, week: 1, runs, workouts: [] })).toMatchObject({ runsDone: 2, runsScheduled: 3 })
  })

  it('a moved session counts on its moved day', () => {
    // Thursday's lift and Friday's long run trade days: the long run on Thursday counts, the lift on Friday counts.
    const moves = [{ id: 'm', week: 1, dayA: 'thu' as const, dayB: 'fri' as const }]
    const r = weekAdherence({ ...base, moves, week: 1, runs: [run('2026-11-05', 4, 'long')], workouts: [workout('2026-11-06')] })
    expect(r).toMatchObject({ liftsDone: 1, runsDone: 1 })
    // Without the move the same days count for nothing: a run on a lift day and a lift on a run day.
    expect(weekAdherence({ ...base, week: 1, runs: [run('2026-11-05', 4, 'long')], workouts: [workout('2026-11-06')] })).toMatchObject({ liftsDone: 0, runsDone: 0 })
  })

  it('a move in another week changes nothing here (moves swap days within one week)', () => {
    const moves = [{ id: 'm', week: 2, dayA: 'thu' as const, dayB: 'fri' as const }]
    expect(weekAdherence({ ...base, moves, week: 1, runs: [run('2026-11-06', 4, 'long')], workouts: [workout('2026-11-05')] })).toMatchObject({ liftsDone: 1, runsDone: 1 })
  })

  it('a deload week is an ordinary scheduled week', () => {
    // Week 4 is Nov 23 to 29.
    expect(weekAdherence({ ...base, week: 4, runs: [run('2026-11-23', 2, 'mbr')], workouts: [workout('2026-11-24')] })).toEqual({ liftsDone: 1, liftsScheduled: 3, runsDone: 1, runsScheduled: 3 })
  })

  it('an ended-early lift counts (it happened); one open or only planned does not', () => {
    const workouts = [workout('2026-11-03', 'abandoned'), workout('2026-11-05', 'in-progress'), workout('2026-11-07', 'planned')]
    expect(weekAdherence({ ...base, week: 1, runs: [], workouts })).toMatchObject({ liftsDone: 1 })
  })

  it('a run on a lift day does not make the lift done, and a run on an off day counts toward nothing', () => {
    // Tue is Session A, Sun is off: three runs done, none on a run day.
    const runs = [run('2026-11-03', 2), run('2026-11-08', 3), run('2026-11-07', 2)]
    expect(weekAdherence({ ...base, week: 1, runs, workouts: [] })).toEqual({ liftsDone: 0, liftsScheduled: 3, runsDone: 0, runsScheduled: 3 })
  })

  it('two things on one day count once', () => {
    const r = weekAdherence({ ...base, week: 1, runs: [run('2026-11-02', 3, 'mbr'), { ...run('2026-11-02', 0, 'rower-swap'), id: 'r-2' }], workouts: [workout('2026-11-03'), { ...workout('2026-11-03'), id: 'w-2' }] })
    expect(r).toMatchObject({ liftsDone: 1, runsDone: 1 })
  })

  it('other weeks’ sessions are not this week’s', () => {
    expect(weekAdherence({ ...base, week: 2, runs: [run('2026-11-02', 3, 'mbr')], workouts: [workout('2026-11-03')] })).toEqual({ liftsDone: 0, liftsScheduled: 3, runsDone: 0, runsScheduled: 3 })
  })

  it('null before the program and for a week with nothing scheduled', () => {
    expect(weekAdherence({ ...base, week: 0, runs: [], workouts: [] })).toBeNull()
    const allOff = { mon: 'off', tue: 'off', wed: 'off', thu: 'off', fri: 'off', sat: 'off', sun: 'off' } as const
    expect(weekAdherence({ ...base, template: allOff, week: 1, runs: [], workouts: [] })).toBeNull()
  })

  it('a week with only lifts scheduled has 0 runs scheduled (the screen leaves that half out)', () => {
    const liftsOnly = { ...TEMPLATE, mon: 'off', wed: 'off', fri: 'off' } as const
    expect(weekAdherence({ ...base, template: liftsOnly, week: 1, runs: [], workouts: [workout('2026-11-03')] })).toEqual({ liftsDone: 1, liftsScheduled: 3, runsDone: 0, runsScheduled: 0 })
  })
})

describe('targetForWeek with down periods (Batch E, PROGRAM-QUESTIONS 183)', () => {
  /** The seed's plan: each down week equals the week before it. */
  const seed: MileageWeek[] = [10, 11, 12, 12, 13, 14, 15, 15, 16, 17, 18, 18].map((targetMiles, i) => ({ week: i + 1, targetMiles, isDown: [4, 8, 12].includes(i + 1) }))
  const AT = '2026-11-01T08:00:00-05:00'
  const period = (start: string, plannedEnd: string, endedOn?: string): DownPeriod => ({ id: `dp-${start}`, start, plannedEnd, declaredAt: AT, ...(endedOn ? { endedOn } : {}) })
  const targets = (p: readonly MileageWeek[], periods: readonly DownPeriod[], runs: Run[] = [], readings: SubjectReading[] = []) =>
    p.map((w) => targetForWeek(p, w.week, START, runs, readings, periods).target)
  const P1 = period('2026-11-14', '2026-11-20')

  it('no period: rule 7 exactly as before', () => {
    expect(targets(seed, [])).toEqual([10, 11, 12, 12, 13, 14, 15, 15, 16, 17, 18, 18])
    expect(targetForWeek(seed, 3, START, [], [], [])).toEqual(targetForWeek(seed, 3, START, [], []))
  })

  it('worked example 5: declared Wed Nov 11 to Tue Nov 17, week 2 stays 11 and week 3 holds at 11, for the whole week', () => {
    const p4 = period('2026-11-11', '2026-11-17')
    const week3 = targetForWeek(seed, 3, START, [], [], [p4])
    expect(week3).toEqual({ target: 11, capped: true, reason: 'down period: held at last week’s 11 miles', downPeriod: { kind: 'held', lastWeek: 11 } })
    expect(targetForWeek(seed, 2, START, [], [], [p4])).toEqual(targetForWeek(seed, 2, START, [], []))
    // Week 4 (a flat down week) climbs one plan step from 11: 11 + (12 − 12) = 11; week 5: 11 + 1; and so on, never above the plan.
    expect(targets(seed, [p4])).toEqual([10, 11, 11, 11, 12, 13, 14, 14, 15, 16, 17, 17])
    expect(targetForWeek(seed, 5, START, [], [], [p4])).toMatchObject({ target: 12, capped: true, reason: 'after a down period: up one plan step from last week’s 11 miles', downPeriod: { kind: 'climbing', lastWeek: 11 } })
  })

  it('ended early, the week whose Monday it covered still holds', () => {
    expect(targets(seed, [period('2026-11-14', '2026-11-20', '2026-11-17')]).slice(0, 4)).toEqual([10, 11, 11, 11])
    // Ended on Sunday: Monday Nov 16 is free.
    expect(targets(seed, [period('2026-11-14', '2026-11-20', '2026-11-15')])).toEqual(targets(seed, []))
  })

  it('worked example 3: a period over the deload week holds nothing the plan doesn’t already hold', () => {
    const p2 = period('2026-11-23', '2026-11-27')
    expect(targetForWeek(seed, 4, START, [], [], [p2])).toEqual({ target: 12, capped: false, reason: 'from the plan' })
    expect(targets(seed, [p2])).toEqual(targets(seed, []))
  })

  it('a dropping down week keeps its lower number (the min)', () => {
    // The test plan drops to 9 in week 4.
    const over4 = period('2026-11-22', '2026-11-30')
    expect(targetForWeek(plan, 4, START, [], [], [over4])).toEqual({ target: 9, capped: false, reason: 'from the plan' })
    // Week 5's Monday Nov 30 is covered: it holds at week 4's 9, not the plan's 13.
    expect(targetForWeek(plan, 5, START, [], [], [over4])).toMatchObject({ target: 9, downPeriod: { kind: 'held', lastWeek: 9 } })
  })

  it('held weeks in a row hold the same number; week 1 has nothing to hold from', () => {
    // Covering the Mondays of weeks 1 and 2: week 2 holds at 10, week 3 climbs one step (10 + 1), flat week 4 stays.
    const long = period('2026-11-02', '2026-11-15')
    expect(targets(seed, [long]).slice(0, 4)).toEqual([10, 10, 11, 11])
    // Two periods back to back over the Mondays of weeks 2 to 4: all three hold at week 1's 10, then the climb.
    expect(targets(seed, [period('2026-11-09', '2026-11-22'), period('2026-11-23', '2026-11-25')]).slice(0, 6)).toEqual([10, 10, 10, 10, 11, 12])
    expect(targetForWeek(seed, 1, START, [], [], [long])).toEqual({ target: 10, capped: false, reason: 'from the plan' })
  })

  it('rule 7’s cap still binds, and the lower number stands', () => {
    // Week 2: a hold, 6 miles run. Week 3 is capped at 6 by rule 7, and held at 11 by the period: 6 stands.
    const runs = [run('2026-11-09', 6)]
    const readings = [reading('2026-11-09', 'hold')]
    expect(targetForWeek(seed, 3, START, runs, readings, [P1])).toEqual(targetForWeek(seed, 3, START, runs, readings))
    expect(targetForWeek(seed, 3, START, runs, readings, [P1]).target).toBe(6)
  })

  it('never above what rule 7 alone gives, week by week, over many periods', () => {
    const sets: DownPeriod[][] = [
      [P1],
      [period('2026-11-02', '2026-11-15')],
      [period('2026-11-29', '2026-12-12')],
      [period('2026-11-14', '2026-11-20', '2026-11-16'), period('2026-11-21', '2026-12-04')],
      [period('2026-12-28', '2027-01-10')],
    ]
    const runs = [run('2026-11-09', 6), run('2026-11-30', 13)]
    for (const readings of [[], [reading('2026-11-09', 'hold')], [reading('2026-11-30', 'back-off')]]) {
      for (const periods of sets) {
        for (const p of [seed, plan]) {
          for (let w = 1; w <= 13; w++) {
            const paused = targetForWeek(p, w, START, runs, readings, periods)
            const unpaused = targetForWeek(p, w, START, runs, readings)
            if (paused.downPeriod === undefined) expect(paused).toEqual(unpaused)
            else expect(paused.target ?? 0).toBeLessThan(unpaused.target ?? 0)
            expect(paused.capped).toBe((paused.target ?? Infinity) < (p.find((x) => x.week === w)?.targetMiles ?? -Infinity))
          }
        }
      }
    }
  })

  it('weekMilesSummary passes the periods on', () => {
    expect(weekMilesSummary(seed, 3, START, [run('2026-11-16', 3)], [], [P1])).toEqual({ target: targetForWeek(seed, 3, START, [], [], [P1]), miles: 3, sessions: 1, swaps: 0 })
  })
})
