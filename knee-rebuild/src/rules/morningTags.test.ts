import { describe, expect, it } from 'vitest'
import type { MorningCheck, MorningTag } from '../schema/index.ts'
import type { SubjectReading } from './history.ts'
import { TAG_MIN_SAMPLE, anyTagged, pairedMornings, tagCounts } from './morningTags.ts'

const check = (date: string, tags?: MorningTag[], over: Partial<MorningCheck> = {}): MorningCheck => ({
  id: `mc-${date}`,
  date,
  appliesTo: null,
  stiffnessUnder30Min: true,
  worseThanYesterday: false,
  visibleSwelling: false,
  warmth: false,
  painChangePoints: 0,
  redFlags: [],
  ...(tags ? { tags } : {}),
  ...over,
})
const reading = (kind: 'workout' | 'run', date: string, result: SubjectReading['result'], id = `${kind}-${date}`): SubjectReading => ({ kind, id, date, result })

describe('pairing: each check with the worst reading it completes (PROGRAM-QUESTIONS 178)', () => {
  it('pairs a check with the sessions the day before, the worst of them', () => {
    const checks = [check('2026-11-11', ['poor-sleep'])]
    const readings = [reading('workout', '2026-11-10', 'clean'), reading('run', '2026-11-10', 'hold')]
    expect(pairedMornings(checks, readings)).toEqual([{ check: checks[0], result: 'hold' }])
  })
  it('skips a check with no session the day before, and a session with no check', () => {
    const checks = [check('2026-11-11', ['poor-sleep']), check('2026-11-14', ['brace'])]
    const readings = [reading('workout', '2026-11-10', 'clean'), reading('run', '2026-11-16', 'hold')]
    expect(pairedMornings(checks, readings).map((p) => p.check.date)).toEqual(['2026-11-11'])
    // Tagged but unpaired: counted as tagged, never as a reading.
    expect(tagCounts(checks, readings).find((t) => t.tag === 'brace')).toMatchObject({ tagged: 1, paired: 0 })
  })
  it('pairs only with the reading its own check completed: a linked check elsewhere takes the session', () => {
    // Two rows for Nov 14 (an imported mc-…-run row): the one linked to the run is the run's check.
    const plain = check('2026-11-14', ['nsaid'])
    const linked = check('2026-11-14', undefined, { id: 'mc-2026-11-14-run', appliesTo: { kind: 'run', id: 'run-x' } })
    const readings = [reading('run', '2026-11-13', 'back-off', 'run-x')]
    expect(pairedMornings([plain, linked], readings)).toEqual([{ check: linked, result: 'back-off' }])
    expect(tagCounts([plain, linked], readings).find((t) => t.tag === 'nsaid')?.paired).toBe(0)
  })
  it('counts a late check’s tags like any other: they describe that morning', () => {
    const late = check('2026-11-18', ['long-sitting'], { loggedOn: '2026-11-20' })
    expect(tagCounts([late], [reading('workout', '2026-11-17', 'clean')]).find((t) => t.tag === 'long-sitting')).toMatchObject({ paired: 1, clean: 1 })
  })
})

describe('tagCounts', () => {
  it('counts each tag’s readings and the paired mornings without it, in the form’s order', () => {
    const checks = [
      check('2026-11-03', ['poor-sleep']),
      check('2026-11-04', ['poor-sleep', 'brace']),
      check('2026-11-05'),
      check('2026-11-06', ['brace']),
      check('2026-11-07', ['poor-sleep']),
    ]
    const readings = [
      reading('run', '2026-11-02', 'hold'),
      reading('workout', '2026-11-03', 'back-off'),
      reading('run', '2026-11-04', 'clean'),
      reading('workout', '2026-11-05', 'clean'),
      reading('run', '2026-11-06', 'hold'),
    ]
    const counts = tagCounts(checks, readings)
    expect(counts.map((c) => c.tag)).toEqual(['poor-sleep', 'long-sitting', 'on-feet', 'brace', 'nsaid', 'new-shoes'])
    expect(counts[0]).toEqual({ tag: 'poor-sleep', tagged: 3, paired: 3, clean: 0, hold: 2, backOff: 1, without: { paired: 2, clean: 2, hold: 0, backOff: 0 } })
    expect(counts[3]).toEqual({ tag: 'brace', tagged: 2, paired: 2, clean: 1, hold: 0, backOff: 1, without: { paired: 3, clean: 1, hold: 2, backOff: 0 } })
    expect(counts[1]).toEqual({ tag: 'long-sitting', tagged: 0, paired: 0, clean: 0, hold: 0, backOff: 0, without: { paired: 5, clean: 2, hold: 2, backOff: 1 } })
  })
  it('the sample line is 5 paired mornings', () => {
    expect(TAG_MIN_SAMPLE).toBe(5)
  })
  it('says whether any tag was ever used', () => {
    expect(anyTagged([check('2026-11-03')])).toBe(false)
    expect(anyTagged([check('2026-11-03'), check('2026-11-04', ['nsaid'])])).toBe(true)
  })
})
