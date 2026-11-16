import { describe, expect, it } from 'vitest'
import type { Fit } from '../rules/fitWindow.ts'
import type { WarmUpParts } from '../rules/warmUp.ts'
import { windowWords } from './Window.helpers.ts'

const fit = (over: Partial<Fit> = {}): Fit => ({
  keep: ['a', 'b', 'c'],
  added: [],
  dropped: [],
  fullMinutes: 36,
  keptMinutes: 36,
  fits: true,
  warmUpMinutes: 0,
  warmUpPastWindow: false,
  firstPastWindow: false,
  ramped: [],
  ...over,
})
const name = (id: string) => ({ a: 'Leg press, both legs', c: 'Dumbbell bench press', d: 'Calf raise', e: 'Plank', x: 'Seated cable row', y: 'Dumbbell bench press' })[id] ?? id
const none: WarmUpParts = { bike: null, circuit: 0, total: 0 }
const bike: WarmUpParts = { bike: 5, circuit: 5, total: 10 }
const noBike: WarmUpParts = { bike: null, circuit: 5, total: 5 }

describe('windowWords', () => {
  it('says what the full session takes when no time is given, warm-up included', () => {
    expect(windowWords(fit(), null, 3, name, none)).toEqual(['The full session: about 36 min, warm-up included.'])
  })
  it('says everything fits, in the singular or plural', () => {
    expect(windowWords(fit(), 40, 3, name, none)).toEqual(['The full session is about 36 min, warm-up included.', 'In 40 min all 3 exercises fit.'])
    expect(windowWords(fit({ keep: ['a'] }), 40, 1, name, none)[1]).toBe('In 40 min all 1 exercise fits.')
  })
  it('says how many fit and names what is left out', () => {
    expect(windowWords(fit({ keep: ['a', 'b'], dropped: ['d', 'e'], keptMinutes: 24 }), 25, 4, name, none)).toEqual([
      'The full session is about 36 min, warm-up included.',
      'In 25 min, 2 of 4 exercises fit (about 24 min, warm-up included).',
      'Left out: Calf raise, Plank.',
    ])
  })
  it('says what is added when there is time to spare', () => {
    expect(windowWords(fit({ keep: ['a', 'b', 'c', 'x', 'y'], added: ['x', 'y'], fullMinutes: 18, keptMinutes: 30 }), 30, 3, name, none)).toEqual([
      'The full session is about 18 min, warm-up included.',
      'In 30 min all 3 fit, with room for 2 more (about 30 min, warm-up included).',
      'Added: Seated cable row, Dumbbell bench press.',
    ])
  })
  it('counts only the session’s own exercises as kept when it leaves some out', () => {
    expect(windowWords(fit({ keep: ['a', 'b'], dropped: ['d'] }), 25, 3, name, none)[1]).toBe('In 25 min, 2 of 3 exercises fit (about 36 min, warm-up included).')
  })
  it('says when what must stay already runs past the time', () => {
    const lines = windowWords(fit({ keep: ['a', 'b'], dropped: ['d'], keptMinutes: 12, fits: false }), 10, 3, name, none)
    expect(lines.at(-1)).toBe('The first exercise and what is already logged stay, and run past 10 min.')
  })
})

describe('windowWords, door to door (PROGRAM-QUESTIONS 166, 167)', () => {
  it('says what the warm-up takes off the top: the bike and the circuit', () => {
    const lines = windowWords(fit({ keep: ['a', 'b', 'c', 'd'], dropped: ['p9', 'p8', 'p5'], fullMinutes: 63, keptMinutes: 34, warmUpMinutes: 10 }), 45, 9, name, bike)
    expect(lines).toEqual([
      'The full session is about 63 min, warm-up included.',
      'The warm-up takes the first 10 min (bike 5, knee circuit 5), leaving 35 for the exercises.',
      'In 45 min, 4 of 9 exercises fit (about 34 min, warm-up included).',
      'Left out: p9, p8, p5.',
    ])
  })
  it('with no upright bike, the circuit only, and says the bike is missing', () => {
    expect(windowWords(fit({ warmUpMinutes: 5 }), 45, 3, name, noBike)[1]).toBe('The warm-up takes the first 5 min (knee circuit 5; no upright bike here), leaving 40 for the exercises.')
  })
  it('names the lifts whose warm-up sets are counted', () => {
    expect(windowWords(fit({ warmUpMinutes: 10, ramped: ['a', 'c'] }), 90, 3, name, bike).at(-1)).toBe('The warm-up sets before Leg press, both legs and Dumbbell bench press are counted in that time.')
    expect(windowWords(fit({ warmUpMinutes: 10, ramped: ['a'] }), 90, 3, name, bike).at(-1)).toBe('The warm-up sets before Leg press, both legs are counted in that time.')
    expect(windowWords(fit({ ramped: ['a'] }), null, 3, name, bike)).toEqual(['The full session: about 36 min, warm-up included.'])
  })
  it('a window the warm-up eats says so, never a negative time', () => {
    const lines = windowWords(fit({ keep: ['a'], dropped: ['c', 'b'], keptMinutes: 16, fits: false, warmUpMinutes: 10, warmUpPastWindow: true, firstPastWindow: true }), 10, 3, name, bike)
    expect(lines).toEqual([
      'The full session is about 36 min, warm-up included.',
      'The warm-up alone takes 10 min (bike 5, knee circuit 5), and you have 10: only the first exercise stays, and it runs past 10 min.',
    ])
    expect(lines.join(' ')).not.toMatch(/-\d/)
  })
  it('a window that leaves less than the first exercise says so in place of the generic line', () => {
    const lines = windowWords(fit({ keep: ['a'], dropped: ['c', 'b'], keptMinutes: 20, fits: false, warmUpMinutes: 10, firstPastWindow: true, ramped: ['a'] }), 15, 3, name, bike)
    expect(lines).toEqual([
      'The full session is about 36 min, warm-up included.',
      'The warm-up takes the first 10 min (bike 5, knee circuit 5), leaving 5 for the exercises.',
      'In 15 min, 1 of 3 exercises fit (about 20 min, warm-up included).',
      'Left out: Dumbbell bench press, b.',
      'The warm-up sets before Leg press, both legs are counted in that time.',
      'That leaves less than the first exercise takes: only the first exercise stays, and it runs past 15 min.',
    ])
  })
})
