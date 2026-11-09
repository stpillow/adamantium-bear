import { describe, expect, it } from 'vitest'
import { FIRST_RUN_STEPS, backPops, parseHash, routeHash, stateFrom, type Route } from './router.ts'

describe('parseHash', () => {
  it('reads routes and session ids', () => {
    expect(parseHash('#/week')).toEqual({ name: 'week' })
    expect(parseHash('#/strava')).toEqual({ name: 'strava' })
    expect(parseHash('#/strava?result=connected')).toEqual({ name: 'strava', result: 'connected' })
    expect(parseHash('#/week?x=1')).toEqual({ name: 'week' })
    expect(parseHash('#/session/2026-11-03-p1-a')).toEqual({ name: 'session', workoutId: '2026-11-03-p1-a' })
    expect(parseHash('')).toEqual({ name: 'today' })
    expect(parseHash('#/nonsense')).toEqual({ name: 'today' })
  })
  it('lands on Today for a malformed escape instead of throwing', () => {
    expect(parseHash('#/session/%E0%A4%A')).toEqual({ name: 'today' })
    expect(parseHash('#/session/%')).toEqual({ name: 'today' })
  })
  it('round-trips a session route', () => {
    expect(parseHash(routeHash({ name: 'session', workoutId: 'a b/c' }))).toEqual({ name: 'session', workoutId: 'a b/c' })
  })
})

describe('Where you train routes (M4b)', () => {
  it('reads the gym list, the editor for a stored gym, the editor for a new one and the next-update list', () => {
    expect(parseHash('#/locations')).toEqual({ name: 'locations' })
    expect(parseHash('#/location/loc-1')).toEqual({ name: 'location', locationId: 'loc-1' })
    expect(parseHash('#/location/planet-fitness')).toEqual({ name: 'location', locationId: 'planet-fitness' })
    expect(parseHash('#/location/new')).toEqual({ name: 'new-location' })
    expect(parseHash('#/next-update')).toEqual({ name: 'next-update' })
  })
  it("writes the hash Today's New location already links to", () => {
    expect(routeHash({ name: 'new-location' })).toBe('#/location/new')
    expect(routeHash({ name: 'locations' })).toBe('#/locations')
    expect(routeHash({ name: 'location', locationId: 'loc-2' })).toBe('#/location/loc-2')
    expect(routeHash({ name: 'next-update' })).toBe('#/next-update')
  })
  it('lands on the gym list for an editor link with no gym or a malformed one', () => {
    expect(parseHash('#/location')).toEqual({ name: 'locations' })
    expect(parseHash('#/location/')).toEqual({ name: 'locations' })
    expect(parseHash('#/location/%E0%A4%A')).toEqual({ name: 'locations' })
  })
  it('round-trips every new route', () => {
    const routes: Route[] = [{ name: 'locations' }, { name: 'new-location' }, { name: 'location', locationId: 'loc 3/x' }, { name: 'next-update' }]
    for (const route of routes) expect(parseHash(routeHash(route))).toEqual(route)
  })
})

describe('session preview route', () => {
  it('reads a real date and round-trips it', () => {
    expect(parseHash('#/preview/2026-11-05')).toEqual({ name: 'preview', date: '2026-11-05' })
    expect(routeHash({ name: 'preview', date: '2026-11-05' })).toBe('#/preview/2026-11-05')
    expect(parseHash(routeHash({ name: 'preview', date: '2027-02-28' }))).toEqual({ name: 'preview', date: '2027-02-28' })
  })
  it('lands on Week for a missing, malformed or impossible date', () => {
    expect(parseHash('#/preview')).toEqual({ name: 'week' })
    expect(parseHash('#/preview/tomorrow')).toEqual({ name: 'week' })
    expect(parseHash('#/preview/2026-02-30')).toEqual({ name: 'week' })
    expect(parseHash('#/preview/2026-11-5')).toEqual({ name: 'week' })
  })
})


describe('a past morning’s check route (Batch D)', () => {
  it('reads a real date and round-trips it', () => {
    expect(parseHash('#/morning/2026-11-18')).toEqual({ name: 'morning', date: '2026-11-18' })
    expect(routeHash({ name: 'morning', date: '2026-11-18' })).toBe('#/morning/2026-11-18')
    expect(parseHash(routeHash({ name: 'morning', date: '2026-11-18' }))).toEqual({ name: 'morning', date: '2026-11-18' })
  })
  it('this morning’s check keeps its plain route', () => {
    expect(parseHash('#/morning')).toEqual({ name: 'morning' })
    expect(routeHash({ name: 'morning' })).toBe('#/morning')
  })
  it('opens this morning’s check for a malformed or impossible date', () => {
    expect(parseHash('#/morning/yesterday')).toEqual({ name: 'morning' })
    expect(parseHash('#/morning/2026-02-30')).toEqual({ name: 'morning' })
    expect(parseHash('#/morning/2026-11-8')).toEqual({ name: 'morning' })
  })
})

describe('first run (M-U1)', () => {
  it('reads #/welcome as the first screen and each step by name; an unknown step is the first screen', () => {
    expect(parseHash('#/welcome')).toEqual({ name: 'welcome' })
    expect(FIRST_RUN_STEPS).toEqual(['side', 'start', 'gym', 'equipment', 'time', 'ready'])
    for (const step of FIRST_RUN_STEPS) {
      expect(parseHash(`#/welcome/${step}`)).toEqual({ name: 'welcome', step })
      expect(parseHash(routeHash({ name: 'welcome', step }))).toEqual({ name: 'welcome', step })
    }
    expect(parseHash('#/welcome/nope')).toEqual({ name: 'welcome' })
    expect(routeHash({ name: 'welcome' })).toBe('#/welcome')
    expect(routeHash({ name: 'welcome', step: 'time' })).toBe('#/welcome/time')
  })
})

describe('a step’s own Back (M-U1)', () => {
  it('steps back through history when the entry under this one is the step it goes to, so the next back gesture leaves the step', () => {
    // Next from Time pushed Ready with Time's hash under it: Back pops, and history doesn't keep two Times.
    expect(backPops(stateFrom({ name: 'welcome', step: 'time' }), { name: 'welcome', step: 'time' })).toBe(true)
    // Set up this phone pushed the first step with the first screen under it.
    expect(backPops(stateFrom({ name: 'welcome' }), { name: 'welcome' })).toBe(true)
  })
  it('replaces in place for a step reached any other way: a link, a redirect, or Change from Ready', () => {
    expect(backPops(null, { name: 'welcome', step: 'time' })).toBe(false)
    expect(backPops(undefined, { name: 'welcome' })).toBe(false)
    expect(backPops({ other: 1 }, { name: 'welcome' })).toBe(false)
    // Change on Ready opened Home gym: what's under it is Ready, not What it has's step before it.
    expect(backPops(stateFrom({ name: 'welcome', step: 'ready' }), { name: 'welcome', step: 'start' })).toBe(false)
  })
})
