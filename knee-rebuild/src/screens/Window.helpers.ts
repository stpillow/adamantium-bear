import type { Fit } from '../rules/fitWindow.ts'
import type { WarmUpParts } from '../rules/warmUp.ts'

function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** "(bike 5, knee circuit 5)", or "(knee circuit 5; no upright bike here)". */
function partsWords(parts: WarmUpParts): string {
  return parts.bike !== null ? `(bike ${parts.bike}, knee circuit ${parts.circuit})` : `(knee circuit ${parts.circuit}; no upright bike here)`
}

/**
 * The lines under the time control, in words, door to door (PROGRAM-QUESTIONS 166): what the full
 * session takes with the warm-up, what the warm-up takes off the top, then what the minutes leave
 * out, or, with time to spare, what is added for them, and whose warm-up sets are counted. A window
 * the warm-up eats, or one that leaves less than the first exercise, says so in words. `total`
 * counts the session's own exercises.
 */
export function windowWords(fit: Fit, minutes: number | null, total: number, nameOf: (slotId: string) => string, parts: WarmUpParts): string[] {
  if (minutes === null) return [`The full session: about ${fit.fullMinutes} min, warm-up included.`]
  const lines = [`The full session is about ${fit.fullMinutes} min, warm-up included.`]
  const keptOwn = fit.keep.length - fit.added.length
  const onlyFirst = keptOwn === 1 ? 'only the first exercise stays' : 'the first exercise and what is already logged stay'
  if (fit.warmUpPastWindow) {
    lines.push(`The warm-up alone takes ${fit.warmUpMinutes} min ${partsWords(parts)}, and you have ${minutes}: ${onlyFirst}, and it runs past ${minutes} min.`)
    return lines
  }
  if (fit.warmUpMinutes > 0) lines.push(`The warm-up takes the first ${fit.warmUpMinutes} min ${partsWords(parts)}, leaving ${minutes - fit.warmUpMinutes} for the exercises.`)
  if (fit.dropped.length > 0) {
    lines.push(`In ${minutes} min, ${keptOwn} of ${total} exercises fit (about ${fit.keptMinutes} min, warm-up included).`)
    lines.push(`Left out: ${fit.dropped.map(nameOf).join(', ')}.`)
  } else if (fit.added.length > 0) {
    lines.push(`In ${minutes} min all ${total} fit, with room for ${fit.added.length} more (about ${fit.keptMinutes} min, warm-up included).`)
    lines.push(`Added: ${fit.added.map(nameOf).join(', ')}.`)
  } else {
    lines.push(`In ${minutes} min all ${total} ${total === 1 ? 'exercise fits' : 'exercises fit'}.`)
  }
  if (fit.ramped.length > 0) lines.push(`The warm-up sets before ${listWords(fit.ramped.map(nameOf))} are counted in that time.`)
  if (fit.firstPastWindow) lines.push(`That leaves less than the first exercise takes: ${onlyFirst}, and it runs past ${minutes} min.`)
  else if (!fit.fits) lines.push(`The first exercise and what is already logged stay, and run past ${minutes} min.`)
  return lines
}
