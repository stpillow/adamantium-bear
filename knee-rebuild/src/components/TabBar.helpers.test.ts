import { describe, expect, it } from 'vitest'
import { parseHash, type Route } from '../app/router.ts'
import { activeTab } from './TabBar.helpers.ts'

describe('activeTab', () => {
  it('underlines More on the four Where you train screens, which are reached from More (M4b)', () => {
    expect(activeTab({ name: 'locations' })).toBe('more')
    expect(activeTab({ name: 'location', locationId: 'loc-1' })).toBe('more')
    expect(activeTab({ name: 'new-location' })).toBe('more')
    expect(activeTab({ name: 'next-update' })).toBe('more')
  })

  it('underlines More for the hashes those screens live at, as the router reads them', () => {
    for (const hash of ['#/locations', '#/location/planet-fitness', '#/location/new', '#/next-update']) expect(activeTab(parseHash(hash))).toBe('more')
  })

  it('keeps every other screen under the tab it had', () => {
    const cases: [Route, string][] = [
      [{ name: 'today' }, 'today'],
      [{ name: 'session', workoutId: '2026-11-03-p1-a' }, 'today'],
      [{ name: 'week' }, 'week'],
      [{ name: 'progress' }, 'progress'],
      [{ name: 'gates' }, 'gates'],
      [{ name: 'more' }, 'more'],
      [{ name: 'morning' }, 'more'],
      [{ name: 'run' }, 'more'],
      [{ name: 'program' }, 'more'],
      [{ name: 'settings' }, 'more'],
      // Batch A: the KOOS form sits under Progress (its scores live there); ACL-RSI under Gates (its row lives there).
      [{ name: 'koos' }, 'progress'],
      [{ name: 'acl-rsi' }, 'gates'],
    ]
    for (const [route, tab] of cases) expect(activeTab(route)).toBe(tab)
  })
})
