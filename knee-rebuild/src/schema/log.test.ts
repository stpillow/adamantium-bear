import { describe, expect, it } from 'vitest'
import { IsoDate } from './enums.ts'
import { REST_MAX, REST_MIN } from '../screens/Settings.helpers.ts'
import {
  DEFAULT_KIT,
  DURATION_MAX,
  DURATION_MIN,
  EXTRA_TEXT_MAX,
  HR_MAX_MAX,
  HR_MAX_MIN,
  HR_RESTING_MAX,
  HR_RESTING_MIN,
  HrSettings,
  Location,
  MorningCheck,
  PLANET_FITNESS_LOCATION_ID,
  REST_TIMER_MAX,
  REST_TIMER_MIN,
  RUN_HR_MAX,
  RUN_HR_MIN,
  Run,
  SetLog,
  Settings,
  Workout,
  showsText,
} from './log.ts'

describe('IsoDate', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(IsoDate.safeParse('2026-11-02').success).toBe(true)
    expect(IsoDate.safeParse('2028-02-29').success).toBe(true)
    expect(IsoDate.safeParse('2026-13-45').success).toBe(false)
    expect(IsoDate.safeParse('2026-02-30').success).toBe(false)
    expect(IsoDate.safeParse('2026-11-2').success).toBe(false)
  })
})

describe('SetLog', () => {
  const base = { id: 's1', workoutId: 'w1', slotId: 'p1a-1', exerciseId: 'leg-press', setNumber: 1, side: 'both', load: 8, loadUnit: 'plate' } as const
  it('needs reps or seconds, exactly one', () => {
    expect(SetLog.safeParse({ ...base, reps: 12 }).success).toBe(true)
    expect(SetLog.safeParse({ ...base, seconds: 30 }).success).toBe(true)
    expect(SetLog.safeParse({ ...base }).success).toBe(false)
    expect(SetLog.safeParse({ ...base, reps: 12, seconds: 30 }).success).toBe(false)
  })
  it('rejects unknown keys so a typo cannot vanish silently', () => {
    expect(SetLog.safeParse({ ...base, reps: 12, pain: 2 }).success).toBe(false)
  })
})

describe('nested objects are strict too', () => {
  it('MorningCheck.appliesTo and Settings.redFlag reject unknown keys', () => {
    const check = { id: 'm1', date: '2026-11-03', appliesTo: { kind: 'workout', id: 'w1' }, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [] }
    expect(MorningCheck.safeParse(check).success).toBe(true)
    expect(MorningCheck.safeParse({ ...check, appliesTo: { kind: 'workout', id: 'w1', extra: 1 } }).success).toBe(false)
    const settings = { injuredSide: 'right', startDate: '2026-11-02', dumbbellMax: 80, restTimerSeconds: 60, painPerSet: false }
    expect(Settings.safeParse(settings).success).toBe(true)
    expect(Settings.safeParse({ ...settings, redFlag: { active: false, items: [], extra: 1 } }).success).toBe(false)
  })
})

describe('Settings takes what the Settings form takes', () => {
  const settings = { injuredSide: 'right', startDate: '2026-11-02', dumbbellMax: 80, restTimerSeconds: 60, painPerSet: false }
  it('a start date on a Monday only, the day weeks start (PROMPT rule 10)', () => {
    for (const date of ['2026-11-02', '2026-11-09', '2027-01-04']) expect(Settings.safeParse({ ...settings, startDate: date }).success, date).toBe(true)
    for (const date of ['2026-11-01', '2026-11-03', '2026-11-04', '2026-11-08']) {
      expect(Settings.safeParse({ ...settings, startDate: date }).error?.issues.map((i) => i.message), date).toEqual(['the start date is a Monday, the day weeks start'])
    }
  })
  it('a rest timer inside the stepper’s range, the same bounds the form uses', () => {
    expect([REST_TIMER_MIN, REST_TIMER_MAX]).toEqual([REST_MIN, REST_MAX])
    for (const seconds of [REST_TIMER_MIN, 60, REST_TIMER_MAX]) expect(Settings.safeParse({ ...settings, restTimerSeconds: seconds }).success, String(seconds)).toBe(true)
    for (const seconds of [REST_TIMER_MIN - 1, REST_TIMER_MAX + 1, 99999]) expect(Settings.safeParse({ ...settings, restTimerSeconds: seconds }).success, String(seconds)).toBe(false)
  })
})

describe('Run', () => {
  const base = { id: 'r1', date: '2026-11-02', type: 'mbr', miles: 3.1, minutes: 29, effort: 'easy', maxPain: 1 } as const
  it('only accepts https Strava links', () => {
    expect(Run.safeParse({ ...base, stravaUrl: 'https://www.strava.com/activities/1' }).success).toBe(true)
    expect(Run.safeParse({ ...base, stravaUrl: 'http://www.strava.com/activities/1' }).success).toBe(false)
    expect(Run.safeParse({ ...base, stravaUrl: 'javascript:alert(1)' }).success).toBe(false)
    expect(Run.safeParse({ ...base, stravaUrl: 'https://strava.com/activities/1' }).success).toBe(true)
    expect(Run.safeParse({ ...base, stravaUrl: 'https://example.com/strava.com' }).success).toBe(false)
  })
})

describe('Settings gains the active gym and the kit (M4b)', () => {
  const stored = { injuredSide: 'right', startDate: '2026-11-02', dumbbellMax: 80, restTimerSeconds: 60, painPerSet: false } as const
  it('a row stored before M4b reads as Planet Fitness with both carried items in the bag', () => {
    const settings = Settings.parse(stored)
    expect(settings.activeLocationId).toBe('planet-fitness')
    expect(settings.activeLocationId).toBe(PLANET_FITNESS_LOCATION_ID)
    expect(settings.kit).toEqual(['ankle-strap', 'mini-band'])
    expect(settings.kit).toEqual([...DEFAULT_KIT])
    expect(settings.dumbbellMax).toBe(80)
  })
  it('the default kit is a fresh array each time, so editing one parse cannot leak into the next', () => {
    const first = Settings.parse(stored)
    first.kit.pop()
    expect(Settings.parse(stored).kit).toEqual(['ankle-strap', 'mini-band'])
  })
  it('keeps a chosen gym and kit, an empty kit included', () => {
    expect(Settings.parse({ ...stored, activeLocationId: 'hotel', kit: [] })).toMatchObject({ activeLocationId: 'hotel', kit: [] })
    expect(Settings.parse({ ...stored, kit: ['mini-band'] }).kit).toEqual(['mini-band'])
  })
  it('rejects a blank gym id, a non-kebab item and an item listed twice', () => {
    expect(Settings.safeParse({ ...stored, activeLocationId: '' }).success).toBe(false)
    expect(Settings.safeParse({ ...stored, kit: ['Ankle strap'] }).success).toBe(false)
    expect(Settings.safeParse({ ...stored, kit: ['mini-band', 'mini-band'] }).success).toBe(false)
  })
})

describe('Location (M4b)', () => {
  const home = {
    id: 'planet-fitness',
    name: 'Planet Fitness',
    present: ['smith-machine', 'seated-leg-press', 'mats'],
    dumbbellMaxLb: 80,
    startedFrom: 'planet-fitness',
    listVersion: 1,
    extras: [],
    markedOff: [],
    createdOn: '2026-11-01',
    archived: false,
  } as const
  it('parses a gym and its typed extras and mark-offs', () => {
    expect(Location.safeParse(home).success).toBe(true)
    const hotel = { ...home, id: 'loc-1', name: 'Marriott Downtown', startedFrom: 'empty', dumbbellMaxLb: 25, extras: [{ id: 'x1', text: 'kettlebells', addedOn: '2026-11-10' }], markedOff: [{ id: 'smith-machine', on: '2026-11-10' }] }
    expect(Location.safeParse(hotel).success).toBe(true)
  })
  it('a dumbbell max of 0 means no dumbbells; negative or fractional maxes are refused', () => {
    expect(Location.safeParse({ ...home, dumbbellMaxLb: 0 }).success).toBe(true)
    expect(Location.safeParse({ ...home, dumbbellMaxLb: -5 }).success).toBe(false)
    expect(Location.safeParse({ ...home, dumbbellMaxLb: 52.5 }).success).toBe(false)
  })
  it('names run 1 to 60 characters, trimmed', () => {
    expect(Location.parse({ ...home, name: '  Hotel gym  ' }).name).toBe('Hotel gym')
    expect(Location.safeParse({ ...home, name: '' }).success).toBe(false)
    expect(Location.safeParse({ ...home, name: '   ' }).success).toBe(false)
    expect(Location.safeParse({ ...home, name: 'x'.repeat(60) }).success).toBe(true)
    expect(Location.safeParse({ ...home, name: 'x'.repeat(61) }).success).toBe(false)
  })
  it('typed equipment runs 1 to 80 characters, trimmed, so a mistaken paste isn’t kept (PROGRAM-QUESTIONS 93)', () => {
    const extra = (text: string) => ({ ...home, extras: [{ id: 'extra-1', text, addedOn: '2026-11-10' }] })
    expect(EXTRA_TEXT_MAX).toBe(80)
    expect(Location.safeParse(extra('x'.repeat(80))).success).toBe(true)
    expect(Location.safeParse(extra(` ${'x'.repeat(80)} `)).success).toBe(true)
    expect(Location.safeParse(extra('x'.repeat(81))).success).toBe(false)
  })
  it('a name has to show something: zero-width spaces, fillers and the blank braille cell alone are refused', () => {
    for (const blank of ['\u200B', '\u200B\u200B', ' \u200D ', '\u3164', '\uFFA0', '\u2800', '\uFE0F']) expect(Location.safeParse({ ...home, name: blank }).success, JSON.stringify(blank)).toBe(false)
    for (const seen of ['🏨', '!!!', 'Gym\u200B', '45°']) expect(Location.safeParse({ ...home, name: seen }).success, seen).toBe(true)
    expect(showsText('\u200B')).toBe(false)
    expect(showsText('🏋️')).toBe(true)
  })
  it('starts from Planet Fitness\'s list or from nothing, and nothing else', () => {
    expect(Location.safeParse({ ...home, startedFrom: 'empty' }).success).toBe(true)
    expect(Location.safeParse({ ...home, startedFrom: 'hotel' }).success).toBe(false)
  })
  it('present holds equipment ids, each once; typed text belongs in extras', () => {
    expect(Location.safeParse({ ...home, present: [] }).success).toBe(true)
    expect(Location.safeParse({ ...home, present: ['mats', 'mats'] }).success).toBe(false)
    expect(Location.safeParse({ ...home, present: ['Kettlebells'] }).success).toBe(false)
    expect(Location.safeParse({ ...home, extras: [{ id: 'x1', text: '  ', addedOn: '2026-11-10' }] }).success).toBe(false)
  })
  it('needs a list version, real dates, and rejects unknown keys at every level', () => {
    expect(Location.safeParse({ ...home, listVersion: 0 }).success).toBe(false)
    expect(Location.safeParse({ ...home, createdOn: '2026-02-30' }).success).toBe(false)
    expect(Location.safeParse({ ...home, markedOff: [{ id: 'mats', on: '2026-11-31' }] }).success).toBe(false)
    expect(Location.safeParse({ ...home, color: 'green' }).success).toBe(false)
    expect(Location.safeParse({ ...home, extras: [{ id: 'x1', text: 'kettlebells', addedOn: '2026-11-10', by: 'me' }] }).success).toBe(false)
    expect(Location.safeParse({ ...home, markedOff: [{ id: 'mats', on: '2026-11-10', why: 'gone' }] }).success).toBe(false)
  })
})

describe('rows stored before M4b still parse (M4b fields are optional)', () => {
  it('a workout without a gym, a set without rackCapped, a run without a gym', () => {
    const workout = { id: 'w1', date: '2026-11-03', templateId: 'p1-a', phase: 1, week: 1, isDeload: false, status: 'finished' } as const
    expect(Workout.parse(workout).locationId).toBeUndefined()
    expect(Workout.parse({ ...workout, locationId: 'loc-1' }).locationId).toBe('loc-1')
    const set = { id: 's1', workoutId: 'w1', slotId: 'p1a-1', exerciseId: 'leg-press', setNumber: 1, side: 'both', load: 90, loadUnit: 'lb', reps: 12 } as const
    expect(SetLog.parse(set).rackCapped).toBeUndefined()
    expect(SetLog.parse({ ...set, rackCapped: true }).rackCapped).toBe(true)
    const run = { id: 'r1', date: '2026-11-04', type: 'elliptical-swap', miles: 0, minutes: 35, effort: 'easy', maxPain: 1 } as const
    expect(Run.parse(run).locationId).toBeUndefined()
    expect(Run.parse({ ...run, locationId: 'loc-1' }).locationId).toBe('loc-1')
  })
})

describe('metrics phase 1: a run’s RPE, a session’s RPE and minutes are optional whole numbers', () => {
  const run = { id: 'r1', date: '2026-11-04', type: 'easy', miles: 3, minutes: 30, effort: 'easy', maxPain: 1 } as const
  const workout = { id: 'w1', date: '2026-11-03', templateId: 'p1-a', phase: 1, week: 1, isDeload: false, status: 'finished' } as const
  it('rows stored before it still parse: a run with only its effort word, a workout with neither', () => {
    expect(Run.parse(run).rpe).toBeUndefined()
    expect(Workout.parse(workout).sessionRpe).toBeUndefined()
    expect(Workout.parse(workout).durationMinutes).toBeUndefined()
  })
  it('takes RPE 1 to 10 whole, and refuses 0, 11 and a half', () => {
    for (const rpe of [1, 6, 10]) {
      expect(Run.safeParse({ ...run, rpe }).success, String(rpe)).toBe(true)
      expect(Workout.safeParse({ ...workout, sessionRpe: rpe }).success, String(rpe)).toBe(true)
    }
    for (const rpe of [0, 11, 6.5]) {
      expect(Run.safeParse({ ...run, rpe }).success, String(rpe)).toBe(false)
      expect(Workout.safeParse({ ...workout, sessionRpe: rpe }).success, String(rpe)).toBe(false)
    }
  })
  it('takes whole minutes inside the stepper’s range, the same bounds Finish uses', () => {
    expect([DURATION_MIN, DURATION_MAX]).toEqual([1, 300])
    for (const m of [DURATION_MIN, 48, DURATION_MAX]) expect(Workout.safeParse({ ...workout, durationMinutes: m }).success, String(m)).toBe(true)
    for (const m of [0, DURATION_MAX + 1, 7.5]) expect(Workout.safeParse({ ...workout, durationMinutes: m }).success, String(m)).toBe(false)
  })
  it('still refuses a key it doesn’t know', () => {
    expect(Workout.safeParse({ ...workout, minutes: 40 }).success).toBe(false)
    expect(Run.safeParse({ ...run, sessionRpe: 4 }).success).toBe(false)
  })
})

describe('metrics phase 2: a run’s heart rate is two optional whole numbers', () => {
  const run = { id: 'r1', date: '2026-11-04', type: 'easy', miles: 3, minutes: 30, effort: 'easy', maxPain: 1 } as const
  it('rows stored before it still parse, with nothing invented: absent means no heart rate, never 0', () => {
    const parsed = Run.parse(run)
    expect(parsed.avgHr).toBeUndefined()
    expect(parsed.maxHr).toBeUndefined()
  })
  it('takes whole bpm from 30 to 250, and refuses 29, 251 and a half', () => {
    expect([RUN_HR_MIN, RUN_HR_MAX]).toEqual([30, 250])
    for (const hr of [RUN_HR_MIN, 150, RUN_HR_MAX]) {
      expect(Run.safeParse({ ...run, avgHr: hr, maxHr: hr }).success, String(hr)).toBe(true)
    }
    for (const hr of [RUN_HR_MIN - 1, RUN_HR_MAX + 1, 150.5]) {
      expect(Run.safeParse({ ...run, avgHr: hr }).success, String(hr)).toBe(false)
      expect(Run.safeParse({ ...run, maxHr: hr }).success, String(hr)).toBe(false)
    }
  })
  it('either field parses alone, and an average above the max is refused only when both are set', () => {
    expect(Run.parse({ ...run, avgHr: 150 })).toMatchObject({ avgHr: 150 })
    expect(Run.parse({ ...run, maxHr: 171 })).toMatchObject({ maxHr: 171 })
    expect(Run.safeParse({ ...run, avgHr: 150, maxHr: 171 }).success).toBe(true)
    expect(Run.safeParse({ ...run, avgHr: 150, maxHr: 150 }).success).toBe(true)
    expect(Run.safeParse({ ...run, avgHr: 172, maxHr: 171 }).success).toBe(false)
  })
  it('keeps its shape readable after the refine: the Strava-link check and the backup’s field list read it', () => {
    expect(Run.shape.stravaUrl.safeParse('https://www.strava.com/activities/1').success).toBe(true)
    expect(Object.keys(Run.shape)).toContain('avgHr')
    expect(Object.keys(Run.shape)).toContain('maxHr')
  })
})

describe('metrics phase 2: the heart-rate settings row (its own table, never the settings row)', () => {
  const row = { id: 'heart-rate' } as const
  it('pins the bounds the Settings steppers use, resting always under max by construction', () => {
    expect([HR_MAX_MIN, HR_MAX_MAX]).toEqual([120, 230])
    expect([HR_RESTING_MIN, HR_RESTING_MAX]).toEqual([25, 100])
    expect(HR_RESTING_MAX).toBeLessThan(HR_MAX_MIN)
  })
  it('takes whole bpm inside the bounds and refuses outside, halves included', () => {
    expect(HrSettings.safeParse({ ...row, maxHr: 190, restingHr: 50 }).success).toBe(true)
    for (const maxHr of [HR_MAX_MIN - 1, HR_MAX_MAX + 1, 190.5]) expect(HrSettings.safeParse({ ...row, maxHr }).success, String(maxHr)).toBe(false)
    for (const restingHr of [HR_RESTING_MIN - 1, HR_RESTING_MAX + 1, 50.5]) expect(HrSettings.safeParse({ ...row, restingHr }).success, String(restingHr)).toBe(false)
  })
  it('each field parses alone, and a row with only its id parses: a touch saves only the touched number', () => {
    expect(HrSettings.parse({ ...row, maxHr: 190 })).toEqual({ id: 'heart-rate', maxHr: 190 })
    expect(HrSettings.parse({ ...row, restingHr: 50 })).toEqual({ id: 'heart-rate', restingHr: 50 })
    expect(HrSettings.parse(row)).toEqual({ id: 'heart-rate' })
  })
  it('is strict: a key it doesn’t know, or another id, is refused; resting at or over max is the backup-import backstop', () => {
    expect(HrSettings.safeParse({ ...row, vo2: 50 }).success).toBe(false)
    expect(HrSettings.safeParse({ id: 'hr', maxHr: 190 }).success).toBe(false)
    // Unreachable from the steppers (resting tops out under max's floor), kept so no hand-edited backup can store it.
    expect(HrSettings.safeParse({ ...row, maxHr: 130, restingHr: 130 }).success).toBe(false)
  })
})
