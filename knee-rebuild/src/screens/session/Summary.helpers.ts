import type { SessionCompliance } from '../../rules/compliance.ts'

/*
 * The Summary's set count in words (Batch B, PROGRAM-QUESTIONS 163). The count itself comes from
 * src/rules/compliance.ts; this only says it. The restriction is in the line ("of the 3 exercises
 * run"), never only in the small print, so "All 9" can't read as the whole session.
 */

const sets = (n: number) => `${n} ${n === 1 ? 'set' : 'sets'}`

/** "All 9 prescribed sets of the 3 exercises run." / "7 of 9 prescribed sets of the 4 exercises run, plus 1 extra set; 1 stopped early." Null with nothing logged. */
export function complianceLine(c: SessionCompliance): string | null {
  if (c.prescribed === 0) return c.extra > 0 ? `No prescribed exercise logged a set; ${sets(c.extra)} extra.` : null
  const head = c.logged === c.prescribed ? `All ${c.prescribed} prescribed ${c.prescribed === 1 ? 'set' : 'sets'}` : `${c.logged} of ${c.prescribed} prescribed sets`
  const exercises = `of the ${c.exercises} ${c.exercises === 1 ? 'exercise' : 'exercises'} run`
  const extra = c.extra > 0 ? `, plus ${c.extra} extra ${c.extra === 1 ? 'set' : 'sets'}` : ''
  const stopped = c.stopped > 0 ? `; ${c.stopped} stopped early` : ''
  return `${head} ${exercises}${extra}${stopped}.`
}

/** The small print under it, when a slot the session runs this week logged nothing; null otherwise. */
export function complianceNote(c: SessionCompliance): string | null {
  if (!c.excluded || c.prescribed === 0) return null
  return 'Counts the exercises that logged a set. Anything skipped or dropped for time isn’t stored, so it isn’t counted.'
}
