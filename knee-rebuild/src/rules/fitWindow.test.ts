import { describe, expect, it } from 'vitest'
import { WINDOW_MAX, WINDOW_MIN, cleanWindow, fitToWindow, minutesOf, setWorkSeconds, type WindowSlot } from './fitWindow.ts'

const REST = 60
// 3 sets of 10 reps: 3 × (10 × 4 + 20) = 180 s of work + 3 × 60 s rest = 360 s = 6 min.
const lift = (slotId: string, over: Partial<WindowSlot> = {}): WindowSlot => ({
  slotId,
  added: false,
  optional: false,
  logged: false,
  sides: [{ sets: 3, repsTarget: 10, repUnit: 'reps' }],
  ...over,
})

describe('the estimate', () => {
  it('counts a rep as 4 s, 20 s to set up and log each set, and the rest after every set', () => {
    const fit = fitToWindow([lift('a')], null, REST, 0)
    expect(fit.fullMinutes).toBe(6)
    expect(fit.keptMinutes).toBe(6)
  })

  it('counts both sides of a one-leg exercise, seconds as seconds and minutes as minutes', () => {
    const both = lift('a', { sides: [{ sets: 2, repsTarget: 10, repUnit: 'reps' }, { sets: 2, repsTarget: 10, repUnit: 'reps' }] })
    expect(fitToWindow([both], null, REST, 0).fullMinutes).toBe(8)
    const hold = lift('b', { sides: [{ sets: 2, repsTarget: 30, repUnit: 'seconds' }] })
    expect(fitToWindow([hold], null, 30, 0).fullMinutes).toBe(3)
    const bike = lift('c', { sides: [{ sets: 1, repsTarget: 5, repUnit: 'minutes' }] })
    expect(fitToWindow([bike], null, REST, 0).fullMinutes).toBe(7)
  })

  it('counts a superset’s rests once per round, not once per member', () => {
    const pair = [lift('a', { groupId: 'g' }), lift('b', { groupId: 'g' })]
    // 2 × 180 s work + 3 rounds × 60 s = 540 s = 9 min; apart they would be 12.
    expect(fitToWindow(pair, null, REST, 0).fullMinutes).toBe(9)
  })

  it('one set’s work, by its unit: 4 s a rep, seconds as seconds, minutes as minutes, 2 s a yard or step, and 20 s to set up', () => {
    expect(setWorkSeconds({ repsTarget: 10, repUnit: 'reps' })).toBe(60)
    expect(setWorkSeconds({ repsTarget: 30, repUnit: 'seconds' })).toBe(50)
    expect(setWorkSeconds({ repsTarget: 5, repUnit: 'minutes' })).toBe(320)
    expect(setWorkSeconds({ repsTarget: 20, repUnit: 'yards' })).toBe(60)
    expect(setWorkSeconds({ repsTarget: 20, repUnit: 'steps' })).toBe(60)
  })

  it('rounds minutes up', () => {
    expect(minutesOf(60)).toBe(1)
    expect(minutesOf(61)).toBe(2)
  })
})

describe('fitToWindow', () => {
  const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => lift(id))

  it('keeps everything with no window, or one the session fits', () => {
    expect(fitToWindow(six, null, REST, 0)).toMatchObject({ dropped: [], keep: ['a', 'b', 'c', 'd', 'e', 'f'], fullMinutes: 36, fits: true })
    expect(fitToWindow(six, 36, REST, 0).dropped).toEqual([])
  })

  it('drops program.md’s own exercises from the end backwards until the rest fits', () => {
    const fit = fitToWindow(six, 20, REST, 0)
    expect(fit.keep).toEqual(['a', 'b', 'c'])
    expect(fit.dropped).toEqual(['f', 'e', 'd'])
    expect(fit.keptMinutes).toBe(18)
    expect(fit.fits).toBe(true)
  })

  it('drops what Shawn added first, then the optional ones, then the program’s own', () => {
    const slots = [lift('a'), lift('b', { optional: true }), lift('c'), lift('x', { added: true })]
    expect(fitToWindow(slots, 18, REST, 0).dropped).toEqual(['x'])
    expect(fitToWindow(slots, 12, REST, 0).dropped).toEqual(['x', 'b'])
    expect(fitToWindow(slots, 6, REST, 0).dropped).toEqual(['x', 'b', 'c'])
  })

  it('never drops the first exercise or one already logged, and says when that is already past the window', () => {
    const slots = [lift('a'), lift('b', { logged: true }), lift('c')]
    const fit = fitToWindow(slots, 5, REST, 0)
    expect(fit.keep).toEqual(['a', 'b'])
    expect(fit.dropped).toEqual(['c'])
    expect(fit.fits).toBe(false)
  })

  it('drops a superset whole, never one member', () => {
    const slots = [lift('a'), lift('b', { groupId: 'g' }), lift('c', { groupId: 'g' })]
    const fit = fitToWindow(slots, 8, REST, 0)
    expect(fit.dropped).toEqual(['b', 'c'])
    expect(fit.keep).toEqual(['a'])
  })

  it('keeps a superset that holds anything logged', () => {
    const slots = [lift('a'), lift('b', { groupId: 'g' }), lift('c', { groupId: 'g', logged: true })]
    expect(fitToWindow(slots, 8, REST, 0).dropped).toEqual([])
  })
})

describe('cleanWindow', () => {
  it('keeps whole minutes in range and treats anything else as the full session', () => {
    expect(cleanWindow(40)).toBe(40)
    expect(cleanWindow(40.4)).toBe(40)
    expect(cleanWindow(WINDOW_MIN)).toBe(WINDOW_MIN)
    expect(cleanWindow(WINDOW_MAX)).toBe(WINDOW_MAX)
    for (const bad of [WINDOW_MIN - 1, WINDOW_MAX + 1, NaN, Infinity, '40', null, undefined]) expect(cleanWindow(bad)).toBeNull()
  })
})

describe('more time than the session takes', () => {
  const own = ['a', 'b'].map((id) => lift(id)) // 6 min each: 12 min
  const extras = (ids: string[], over: Partial<WindowSlot> = {}) => ids.map((id) => lift(id, { extra: true, ...over }))

  it('adds from the front of the pool while the next one still fits, and counts only the session’s own as the full session', () => {
    const fit = fitToWindow([...own, ...extras(['x', 'y', 'z'])], 26, REST, 0)
    expect(fit.added).toEqual(['x', 'y'])
    expect(fit.keep).toEqual(['a', 'b', 'x', 'y'])
    expect(fit.fullMinutes).toBe(12)
    expect(fit.keptMinutes).toBe(24)
    expect(fit.dropped).toEqual([])
    expect(fit.fits).toBe(true)
  })

  it('skips one that is too long and takes a shorter one behind it, to use the time', () => {
    const long = lift('long', { extra: true, sides: [{ sets: 6, repsTarget: 20, repUnit: 'reps' }] })
    const fit = fitToWindow([...own, long, ...extras(['short'])], 20, REST, 0)
    expect(fit.added).toEqual(['short'])
  })

  it('adds nothing for the full session, for exactly the time it takes, or when the session had to be cut', () => {
    expect(fitToWindow([...own, ...extras(['x'])], null, REST, 0).added).toEqual([])
    expect(fitToWindow([...own, ...extras(['x'])], 12, REST, 0).added).toEqual([])
    expect(fitToWindow([...own, ...extras(['x'])], 8, REST, 0)).toMatchObject({ added: [], dropped: ['b'] })
  })

  it('never adds more than the most extras take, nor one the gym can’t run', () => {
    const many = extras(['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8'])
    expect(fitToWindow([...own, ...many], 120, REST, 0).added).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6'])
    const gym = [lift('x', { extra: true, eligible: false }), lift('y', { extra: true })]
    expect(fitToWindow([...own, ...gym], 30, REST, 0).added).toEqual(['y'])
  })

  it('keeps an extra that is already logged, even where the minutes would not have added it', () => {
    const fit = fitToWindow([...own, ...extras(['x']), lift('y', { extra: true, logged: true })], 12, REST, 0)
    expect(fit.added).toEqual(['y'])
    expect(fit.keep).toEqual(['a', 'b', 'y'])
  })
})

describe('door to door: the warm-up off the top (PROGRAM-QUESTIONS 166)', () => {
  const three = ['a', 'b', 'c'].map((id) => lift(id)) // 6 min each: 18 min

  it('with no warm-up, the minutes are the exercises’ own, as before', () => {
    const fit = fitToWindow(three, 20, REST, 0)
    expect(fit).toMatchObject({ keep: ['a', 'b', 'c'], dropped: [], fullMinutes: 18, keptMinutes: 18, warmUpMinutes: 0, warmUpPastWindow: false, firstPastWindow: false })
  })

  it('a 5-minute warm-up leaves 15 for the exercises: the third goes, and every figure counts the warm-up', () => {
    const fit = fitToWindow(three, 20, REST, 5)
    expect(fit.dropped).toEqual(['c'])
    expect(fit.keep).toEqual(['a', 'b'])
    expect(fit.fullMinutes).toBe(23)
    expect(fit.keptMinutes).toBe(17)
    expect(fit.fits).toBe(true)
    expect(fit.warmUpMinutes).toBe(5)
  })

  it('the full session counts the warm-up too', () => {
    expect(fitToWindow(three, null, REST, 10)).toMatchObject({ fullMinutes: 28, keptMinutes: 28, warmUpPastWindow: false, firstPastWindow: false })
  })

  it('with time to spare, extras are added only into what the warm-up leaves', () => {
    const pool = ['x', 'y', 'z'].map((id) => lift(id, { extra: true }))
    expect(fitToWindow([...three, ...pool], 30, REST, 0).added).toEqual(['x', 'y'])
    expect(fitToWindow([...three, ...pool], 30, REST, 5).added).toEqual(['x'])
    expect(fitToWindow([...three, ...pool], 30, REST, 5).keptMinutes).toBe(29)
  })

  it('a window no longer than the warm-up keeps the first exercise only, says it runs past, and is never empty or negative', () => {
    for (const [minutes, warm] of [[5, 5], [8, 10]] as const) {
      const fit = fitToWindow(three, minutes, REST, warm)
      expect(fit.keep).toEqual(['a'])
      expect(fit.dropped).toEqual(['c', 'b'])
      expect(fit.fits).toBe(false)
      expect(fit.warmUpPastWindow).toBe(true)
      expect(fit.firstPastWindow).toBe(true)
      expect(fit.keptMinutes).toBe(6 + warm)
    }
  })

  it('what the warm-up leaves shorter than the first exercise: only it stays, and that is said apart from the warm-up taking it all', () => {
    const fit = fitToWindow(three, 15, REST, 10) // 300 s left, the first takes 360
    expect(fit).toMatchObject({ keep: ['a'], fits: false, warmUpPastWindow: false, firstPastWindow: true })
    expect(fitToWindow(three, 15, REST, 0).firstPastWindow).toBe(false)
    expect(fitToWindow(three, 20, REST, 10)).toMatchObject({ keep: ['a'], fits: true, firstPastWindow: false }) // 600 s left
  })
})

describe('warm-up sets in the estimate (PROGRAM-QUESTIONS 167)', () => {
  it('each warm-up set is its reps at 4 s, 20 s to set up, and a full rest: 8 then 5 is 212 s at 60 s rest', () => {
    const ramped = [lift('a', { rampReps: [8, 5] }), lift('b'), lift('c')]
    expect(fitToWindow(ramped, null, REST, 0).fullMinutes).toBe(22) // 1080 + 212 = 1292 s
    expect(fitToWindow(ramped, null, REST, 5).fullMinutes).toBe(27)
    expect(fitToWindow([lift('a', { rampReps: [8, 5] })], null, 90, 0).fullMinutes).toBe(minutesOf(360 + 90 + 272))
  })

  it('an empty ramp counts nothing', () => {
    expect(fitToWindow([lift('a', { rampReps: [] })], null, REST, 0).fullMinutes).toBe(6)
  })

  it('a ramp can tip a slot out of the window', () => {
    const plain = [lift('a'), lift('b'), lift('c')]
    expect(fitToWindow(plain, 23, REST, 5).dropped).toEqual([])
    expect(fitToWindow([lift('a'), lift('b', { rampReps: [8, 5] }), lift('c')], 23, REST, 5).dropped).toEqual(['c'])
  })

  it('names the kept slots whose warm-up sets are counted, in session order, and not a dropped one', () => {
    const slots = [lift('a', { rampReps: [8, 5] }), lift('b'), lift('c', { rampReps: [8] })]
    expect(fitToWindow(slots, null, REST, 0).ramped).toEqual(['a', 'c'])
    expect(fitToWindow(slots, 15, REST, 0).ramped).toEqual(['a'])
  })

  it('counts a ramped extra the same way', () => {
    const own = [lift('a')]
    const plainX = fitToWindow([...own, lift('x', { extra: true })], 13, REST, 0)
    const rampedX = fitToWindow([...own, lift('x', { extra: true, rampReps: [8, 5] })], 13, REST, 0)
    expect(plainX.added).toEqual(['x'])
    expect(rampedX.added).toEqual([])
  })
})
