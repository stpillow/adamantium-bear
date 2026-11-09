import type { IsoDate, MorningCheck, ReadingResult, SetLog, Side } from '../schema/index.ts'
import { addDays } from './calendar.ts'

export interface Reading {
  result: ReadingResult
  reasons: string[]
}

export interface MorningReading extends Reading {
  /** Any ticked red flag. The app enters the red-flag state (rule 9) regardless of the result. */
  redFlag: boolean
}

const RANK: Record<ReadingResult, number> = { clean: 0, hold: 1, 'back-off': 2 }

export function worse(a: ReadingResult, b: ReadingResult): ReadingResult {
  return RANK[a] >= RANK[b] ? a : b
}

export function worst(results: readonly ReadingResult[]): ReadingResult {
  return results.reduce<ReadingResult>((acc, r) => worse(acc, r), 'clean')
}

/** Pain climbing means a rise of 2 or more points across consecutive sets (PROMPT rule 1). */
export const CLIMB_POINTS = 2

function sideOrder(side: SetLog['side'], injuredSide: Side | undefined): number {
  if (side === 'both') return 0
  return side === injuredSide ? 0 : 1
}

/** Sets in the order they happened: by time when logged, else by set number with the injured side first. */
export function inOrder(sets: readonly SetLog[], injuredSide?: Side): SetLog[] {
  const sorted = [...sets]
  if (sorted.every((s) => s.loggedAt !== undefined)) {
    sorted.sort((a, b) => (a.loggedAt ?? '').localeCompare(b.loggedAt ?? ''))
  } else {
    sorted.sort((a, b) => a.setNumber - b.setNumber || sideOrder(a.side, injuredSide) - sideOrder(b.side, injuredSide))
  }
  return sorted
}

/**
 * Rule 1, per exercise. Pain per set when logged per set. When Settings.painPerSet is false the
 * runner stores the exercise's one pain value on every set it logs (that is the storage convention;
 * see CLAUDE.md), so "climbing" can only come from per-set logging.
 */
export function sessionReading(sets: readonly SetLog[], injuredSide?: Side): Reading {
  const ordered = inOrder(sets, injuredSide)
  const reasons: string[] = []
  const pains = ordered.map((s) => s.painDuring).filter((p): p is number => p !== undefined)

  const sharpStop = ordered.find((s) => s.stopped && s.stopReason === 'sharp-joint-line-pain')
  if (sharpStop) return { result: 'back-off', reasons: [`set ${sharpStop.setNumber} stopped for sharp joint-line pain`] }

  if (pains.length === 0) return { result: 'hold', reasons: ['no pain logged; unknown is not clean'] }

  const max = Math.max(...pains)
  if (max > 5) return { result: 'back-off', reasons: [`pain reached ${max}`] }

  let climbing = false
  for (let i = 1; i < pains.length; i++) {
    const prev = pains[i - 1]
    const curr = pains[i]
    if (prev !== undefined && curr !== undefined && curr - prev >= CLIMB_POINTS) {
      climbing = true
      reasons.push(`pain climbed from ${prev} to ${curr} between sets`)
    }
  }

  const otherStop = ordered.find((s) => s.stopped && s.stopReason !== 'sharp-joint-line-pain')
  if (otherStop) reasons.push(`set ${otherStop.setNumber} stopped (${otherStop.stopReason ?? 'no reason'})`)

  if (max >= 4 || climbing || otherStop) {
    if (max >= 4) reasons.unshift(`pain reached ${max}`)
    return { result: 'hold', reasons }
  }
  return { result: 'clean', reasons: [`pain stayed at ${max} or under and did not climb`] }
}

/** Rule 2. Stiffness past 30 minutes with nothing else flagged reads hold, not clean (PROGRAM-QUESTIONS 5). A ticked red flag reads back-off whatever else is ticked (PROGRAM-QUESTIONS 180). */
export function morningReading(check: MorningCheck): MorningReading {
  const redFlag = check.redFlags.length > 0
  const reasons: string[] = []
  if (redFlag) reasons.push(`red flag ticked: ${check.redFlags.join(', ')}`)

  if (check.visibleSwelling || check.warmth || check.painChangePoints >= 2) {
    if (check.visibleSwelling) reasons.push('visible swelling')
    if (check.warmth) reasons.push('warmth')
    if (check.painChangePoints >= 2) reasons.push(`pain up ${check.painChangePoints} points`)
    return { result: 'back-off', reasons, redFlag }
  }
  if (check.worseThanYesterday) {
    reasons.push('worse than yesterday')
    return { result: redFlag ? 'back-off' : 'hold', reasons, redFlag }
  }
  if (!check.stiffnessUnder30Min) {
    reasons.push('stiffness lasted past 30 minutes')
    return { result: redFlag ? 'back-off' : 'hold', reasons, redFlag }
  }
  reasons.push('back to baseline, stiffness gone within 30 minutes')
  return { result: redFlag ? 'back-off' : 'clean', reasons, redFlag }
}

export const MORNING_CHECK_WINDOW_HOURS = 36

/**
 * Rule 3: the worse of the session reading and the morning reading. No morning check within the
 * window reads hold for every exercise: unknown isn't clean.
 */
export function combinedReading(session: Reading, morning: MorningReading | undefined): Reading {
  if (!morning) {
    return { result: worse(session.result, 'hold'), reasons: [...session.reasons, `no morning check within ${MORNING_CHECK_WINDOW_HOURS} hours`] }
  }
  return { result: worse(session.result, morning.result), reasons: [...session.reasons, ...morning.reasons] }
}

/**
 * Whether a morning check belongs to a session: dated the morning after it (the 36-hour window at
 * the day granularity checks are logged in), which covers every session of the day before, or
 * linked to it explicitly. A link adds its session; it never takes the check away from the day's
 * other sessions, so a run logged for that day after the check was saved still reads it (changed
 * Nov 2 after the M4 review; PROGRAM-QUESTIONS 52). A check dated the same day describes the day
 * before, so it never applies to a session later that day.
 */
export function morningCheckApplies(
  check: MorningCheck,
  subject: { kind: 'workout' | 'run'; id: string; date: IsoDate },
): boolean {
  if (check.appliesTo?.kind === subject.kind && check.appliesTo.id === subject.id) return true
  return check.date === addDays(subject.date, 1)
}
