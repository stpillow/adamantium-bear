import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { program } from '../program/program.ts'
import { newLocation, withPresent } from '../rules/locations.ts'
import { onboardingState } from '../rules/onboarding.ts'
import { DEFAULT_KIT, PLANET_FITNESS_LOCATION_ID, type Location } from '../schema/index.ts'
import { db } from './db.ts'
import { homeLocation } from './migrations.ts'
import {
  FROZEN_RACK_PLACEHOLDER_LB,
  defaultSettings,
  ensureLocations,
  ensureSettings,
  getLocation,
  getSettings,
  getTimeZoneSetting,
  launch,
  onboard,
  onboardingFacts,
  saveExportStamp,
  saveHrSettings,
  saveTimeZone,
  type FirstRunAnswers,
} from './repo.ts'

/*
 * First run (M-U1): when a phone counts as set up, what launch does on each kind of phone, and what
 * first run's answers write. The key fixture: Shawn's own answers write exactly the rows the seed
 * before M-U1 wrote, so his phone and a phone he sets up again are the same phone.
 */

const D = '2026-11-02'

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false })
})

/** First run's home gym as the wizard builds it: `newLocation` from the list, then the checklist's taps. */
function draftHome(input: { name: string; rack: number; startedFrom?: Location['startedFrom'] }): Location {
  return newLocation('planet-fitness', { name: input.name, startedFrom: input.startedFrom ?? 'planet-fitness', dumbbellMaxLb: input.rack, createdOn: D }, program)
}

/** Shawn's answers: right knee, Monday Nov 2, his club named Planet Fitness with its 45° press ticked, an 80 lb rack, the bag program.md lists, New York. */
const shawn = (): FirstRunAnswers => ({
  injuredSide: 'right',
  startDate: '2026-11-02',
  home: withPresent(draftHome({ name: 'Planet Fitness', rack: 80 }), 'leg-press-45', true),
  kit: [...DEFAULT_KIT],
  timeZone: 'America/New_York',
})

describe('when a phone counts as set up, read from what is stored', () => {
  it('nothing stored is fresh, and launch writes nothing', async () => {
    expect(onboardingState(await onboardingFacts())).toBe('fresh')
    expect(await launch(program, D)).toBe('fresh')
    for (const table of db.tables) expect(await table.count(), table.name).toBe(0)
  })

  it('a time zone row alone is still fresh (first run proposes it)', async () => {
    await saveTimeZone('Europe/London')
    expect(await onboardingFacts()).toEqual({ settingsRow: false, otherRows: 0 })
    expect(await launch(program, D)).toBe('fresh')
  })

  it('the export stamp alone, or a heart-rate row alone, is data without settings: first run asks, and launch seeds nothing', async () => {
    await saveExportStamp('2026-11-04T23:00:00.000Z')
    expect(await onboardingFacts()).toEqual({ settingsRow: false, otherRows: 1 })
    expect(await launch(program, D)).toBe('data-without-settings')
    expect(await getSettings()).toBeUndefined()
    expect(await db.locations.count()).toBe(0)

    await db.delete({ disableAutoOpen: false })
    await saveHrSettings({ id: 'heart-rate', maxHr: 190 })
    expect(onboardingState(await onboardingFacts())).toBe('data-without-settings')
  })

  it('a logged session without a settings row is data without settings', async () => {
    await db.workouts.put({ id: 'w', date: '2026-11-03', templateId: 'p1-a', phase: 1, week: 1, isDeload: false, status: 'finished' })
    expect(await launch(program, D)).toBe('data-without-settings')
    expect(await getSettings()).toBeUndefined()
  })

  it('a settings row, with or without logs, is set up: launch writes the home gym only when it is missing (a phone from before gyms)', async () => {
    await ensureSettings(defaultSettings(program))
    expect(onboardingState(await onboardingFacts())).toBe('onboarded')
    expect(await launch(program, '2026-11-10')).toBe('onboarded')
    expect(await db.locations.toArray()).toEqual([homeLocation(80, program.planetFitness, '2026-11-10', program.equipmentListVersion)])
    await db.workouts.put({ id: 'w', date: '2026-11-03', templateId: 'p1-a', phase: 1, week: 1, isDeload: false, status: 'finished' })
    expect(await launch(program, '2026-11-20')).toBe('onboarded')
    expect(await db.locations.count()).toBe(1)
  })

  it('a settings row this build can’t read still counts as set up: the app stops in words instead of asking again', async () => {
    await db.table('settings').put({ ...defaultSettings(program), id: 'settings', restTimerSeconds: 'a minute' })
    expect(onboardingState(await onboardingFacts())).toBe('onboarded')
  })
})

describe('onboard: first run’s answers', () => {
  it('Shawn’s answers write exactly the rows the seed before M-U1 wrote, plus the zone', async () => {
    await onboard(shawn())
    expect(await getSettings()).toEqual(defaultSettings(program))
    expect(await getLocation(PLANET_FITNESS_LOCATION_ID)).toEqual(homeLocation(80, program.planetFitness, D, program.equipmentListVersion))
    expect(await db.locations.count()).toBe(1)
    expect(await getTimeZoneSetting()).toEqual({ zone: 'America/New_York', stored: 'ok' })
    expect(onboardingState(await onboardingFacts())).toBe('onboarded')
    // A launch afterwards finds nothing to write.
    const rows = await db.locations.toArray()
    expect(await launch(program, '2026-11-10')).toBe('onboarded')
    expect(await db.locations.toArray()).toEqual(rows)
  })

  it('another user’s answers: their side, their Monday, their gym and bag, their zone; nothing of Shawn’s', async () => {
    await onboard({
      injuredSide: 'left',
      startDate: '2026-11-16',
      home: draftHome({ name: 'Garage', rack: 50, startedFrom: 'empty' }),
      kit: ['mini-band'],
      timeZone: 'America/Los_Angeles',
    })
    expect(await getSettings()).toMatchObject({ injuredSide: 'left', startDate: '2026-11-16', dumbbellMax: 50, restTimerSeconds: 60, painPerSet: false, kit: ['mini-band'], activeLocationId: 'planet-fitness', currentPhase: 1, phaseEnteredWeek: 1 })
    expect(await getLocation(PLANET_FITNESS_LOCATION_ID)).toMatchObject({ name: 'Garage', present: [], dumbbellMaxLb: 50, startedFrom: 'empty', archived: false })
    expect(await getTimeZoneSetting()).toEqual({ zone: 'America/Los_Angeles', stored: 'ok' })
  })

  it('a home rack of None: the gym has none, and the frozen settings value holds the positive placeholder (PROGRAM-QUESTIONS 209)', async () => {
    await onboard({ ...shawn(), home: draftHome({ name: 'Home gym', rack: 0 }) })
    expect((await getLocation(PLANET_FITNESS_LOCATION_ID))?.dumbbellMaxLb).toBe(0)
    expect((await getSettings())?.dumbbellMax).toBe(FROZEN_RACK_PLACEHOLDER_LB)
    expect(FROZEN_RACK_PLACEHOLDER_LB).toBe(5)
  })

  it('refuses on a phone already set up, and writes nothing (a second tap, a second tab)', async () => {
    await onboard(shawn())
    const before = await getSettings()
    await expect(onboard({ ...shawn(), injuredSide: 'left', timeZone: 'Asia/Tokyo' })).rejects.toThrow('This phone is already set up; nothing was changed.')
    expect(await getSettings()).toEqual(before)
    expect((await getTimeZoneSetting()).zone).toBe('America/New_York')
  })

  it('refuses a zone this phone doesn’t know, a non-Monday or an empty gym name, and writes nothing', async () => {
    await expect(onboard({ ...shawn(), timeZone: 'Not/AZone' })).rejects.toThrow()
    await expect(onboard({ ...shawn(), startDate: '2026-11-03' })).rejects.toThrow()
    await expect(onboard({ ...shawn(), home: draftHome({ name: '   ', rack: 80 }) })).rejects.toThrow()
    for (const table of db.tables) expect(await table.count(), table.name).toBe(0)
  })

  it('on a phone with data but no settings row, keeps every row there, a stored home gym included', async () => {
    await ensureSettings(defaultSettings(program))
    await ensureLocations(program, D)
    await db.settings.delete('settings')
    await saveHrSettings({ id: 'heart-rate', maxHr: 190 })
    expect(onboardingState(await onboardingFacts())).toBe('data-without-settings')
    const home = await getLocation(PLANET_FITNESS_LOCATION_ID)
    expect(await onboard({ ...shawn(), injuredSide: 'left', home: draftHome({ name: 'Somewhere else', rack: 25 }) })).toEqual({ keptHome: true })
    expect(await getLocation(PLANET_FITNESS_LOCATION_ID)).toEqual(home)
    expect(await db.hrSettings.get('heart-rate')).toEqual({ id: 'heart-rate', maxHr: 190 })
    expect(await getSettings()).toMatchObject({ injuredSide: 'left' })
  })
})
