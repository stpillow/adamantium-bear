import { describe, expect, it } from 'vitest'
import rawEvidence from '../../data/evidence.json'
import rawProgram from '../../data/program.json'
import { Pattern } from './enums.ts'
import { Evidence, EvidenceEntry, GateRationale, Seen, derivedGrade, isOneSentence, joinsTwoSentences, reviewPoolProblem, startProblem, wordCount, type Grade } from './evidence.ts'

/*
 * data/evidence.json against its schema and the GRADE rule (PROGRAM-QUESTIONS 191 to 199). The
 * entries are checked against the fetched records by `npm run evidence -- --verify`; this checks
 * the shape, the grade arithmetic, the one-sentence takeaways and that every topic names something
 * the seed has.
 */

const parsed = Evidence.safeParse(rawEvidence)
const evidence = parsed.success ? parsed.data : null
const problems = parsed.success ? '' : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')

/** A valid entry to vary one field at a time. */
const BASE = {
  id: 'example-2020-entry',
  authors: 'Example A, Other B.',
  title: 'An example.',
  journal: 'Journal of examples',
  year: 2020,
  pmid: '12345678',
  design: 'rct',
  assessedAs: 'randomized',
  indirect: true,
  imprecise: true,
  grade: 'low',
  gradeBasis: 'Randomized trial, high; down one for indirectness and one for a small study.',
  population: '20 healthy young adults',
  takeaway: 'Something happened in a small trial.',
  read: 'abstract-only',
  openAccess: false,
  phases: [1],
  patterns: [],
  appRules: [],
  foundBy: ['a-search'],
  verifiedOn: '2026-11-09',
  verifiedAgainst: 'europepmc',
} as const

const entry = (over: Record<string, unknown>, drop: readonly string[] = []) => {
  const e: Record<string, unknown> = { ...BASE, ...over }
  for (const k of drop) delete e[k]
  return EvidenceEntry.safeParse(e)
}

describe('data/evidence.json', () => {
  it('parses', () => {
    expect(problems).toBe('')
    expect(evidence).not.toBeNull()
  })

  it('holds the curated entries, searches and gate rationales', () => {
    expect(evidence?.entries.length).toBeGreaterThanOrEqual(50)
    expect(evidence?.searches.length).toBeGreaterThanOrEqual(60)
    expect(evidence?.gateRationales.length).toBeGreaterThanOrEqual(10)
  })

  it('every gate rationale names a gate item in the seed', () => {
    const items = new Set(rawProgram.gates.flatMap((g) => g.items.map((i) => i.id)))
    for (const r of evidence?.gateRationales ?? []) expect(items.has(r.itemId), r.itemId).toBe(true)
  })

  it('every phase is one of the seed’s, every pattern one of the enum’s', () => {
    const phases = new Set(rawProgram.phases.map((p) => p.number))
    for (const e of evidence?.entries ?? []) {
      for (const p of e.phases) expect(phases.has(p), `${e.id} phase ${p}`).toBe(true)
      for (const p of e.patterns) expect(Pattern.options, e.id).toContain(p)
    }
  })

  it('every entry is indirect for this knee, says why, and names its population in words', () => {
    for (const e of evidence?.entries ?? []) {
      expect(e.indirect, e.id).toBe(true)
      expect(wordCount(e.population), e.id).toBeGreaterThanOrEqual(3)
      expect(e.gradeBasis, e.id).toMatch(/indirect|population|post-?ACLR|outcome/i)
    }
  })

  it('every stored grade is the rule’s', () => {
    for (const e of evidence?.entries ?? []) expect(e.grade, e.id).toBe(derivedGrade(e))
  })

  it('no entry or field carries abstract or full text: only the closed list of fields', () => {
    const text = JSON.stringify(rawEvidence)
    expect(text).not.toMatch(/"abstract(Text)?"\s*:/i)
    expect(text).not.toMatch(/"fullText"\s*:/i)
    expect(text).not.toMatch(/"relevance"\s*:/)
  })

  it('the one start below its design is named, with a reason (Thomeé 1997, for Shawn to confirm)', () => {
    const exceptions = (evidence?.entries ?? []).filter((e) => e.startReason !== undefined).map((e) => e.id)
    expect(exceptions).toEqual(['thomee-1997-pfps-pain-monitoring'])
  })

  it('curatedOn is a date and no seen PMID is an entry', () => {
    expect(evidence?.curatedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const pmids = new Set(evidence?.entries.map((e) => e.pmid))
    for (const s of evidence?.seen ?? []) expect(pmids.has(s.pmid), s.pmid).toBe(false)
  })
})

describe('the GRADE rule (PROGRAM-QUESTIONS 191)', () => {
  const cases: [Parameters<typeof derivedGrade>[0], Grade][] = [
    [{ assessedAs: 'randomized', indirect: false, imprecise: false }, 'high'],
    [{ assessedAs: 'observational', indirect: false, imprecise: false }, 'low'],
    [{ assessedAs: 'opinion', indirect: false, imprecise: false }, 'very low'],
    [{ assessedAs: 'randomized', indirect: true, imprecise: false }, 'moderate'],
    [{ assessedAs: 'randomized', indirect: false, imprecise: true }, 'moderate'],
    [{ assessedAs: 'randomized', indirect: true, imprecise: true }, 'low'],
    [{ assessedAs: 'observational', indirect: true, imprecise: false }, 'very low'],
    [{ assessedAs: 'observational', indirect: true, imprecise: true }, 'very low'],
    [{ assessedAs: 'opinion', indirect: true, imprecise: true }, 'very low'],
    [{ sourceGrade: 'high', indirect: false, imprecise: false }, 'high'],
    [{ sourceGrade: 'moderate', indirect: true, imprecise: false }, 'low'],
    [{ sourceGrade: 'low', indirect: true, imprecise: false }, 'very low'],
    [{ sourceGrade: 'very low', indirect: true, imprecise: false }, 'very low'],
  ]
  for (const [input, grade] of cases) {
    it(`${JSON.stringify(input)} is ${grade}`, () => expect(derivedGrade(input)).toBe(grade))
  }

  it('the source’s own GRADE and imprecise together are refused', () => {
    expect(entry({ sourceGrade: 'moderate', imprecise: true, grade: 'low' }, ['assessedAs']).success).toBe(false)
    expect(entry({ sourceGrade: 'moderate', imprecise: false, grade: 'low' }, ['assessedAs']).success).toBe(true)
  })

  it('exactly one of sourceGrade and assessedAs', () => {
    expect(entry({ sourceGrade: 'moderate', imprecise: false, grade: 'low' }).success).toBe(false)
    expect(entry({}, ['assessedAs']).success).toBe(false)
  })

  it('a stored grade the rule disagrees with is refused', () => {
    expect(entry({}).success).toBe(true)
    expect(entry({ grade: 'moderate' }).success).toBe(false)
    expect(entry({ grade: 'very low' }).success).toBe(false)
  })

  it('a design starts where the rule says; never higher, and lower only with a reason', () => {
    expect(startProblem({ design: 'rct', assessedAs: 'randomized' })).toBeNull()
    expect(startProblem({ design: 'meta-analysis', assessedAs: 'observational' })).toBeNull()
    expect(startProblem({ design: 'cohort', assessedAs: 'randomized' })).toMatch(/never higher/)
    expect(startProblem({ design: 'expert-opinion', assessedAs: 'observational' })).toMatch(/never higher/)
    expect(startProblem({ design: 'guideline', assessedAs: 'randomized' })).toMatch(/never higher/)
    expect(startProblem({ design: 'rct', assessedAs: 'observational' })).toMatch(/needs a start reason/)
    expect(startProblem({ design: 'rct', assessedAs: 'opinion', startReason: 'Pain monitoring ran in both arms.' })).toBeNull()
    expect(startProblem({ design: 'rct', assessedAs: 'randomized', startReason: 'Not needed.' })).toMatch(/natural start/)
    expect(entry({ design: 'cohort' }).success).toBe(false)
    expect(entry({ assessedAs: 'opinion', grade: 'very low' }).success).toBe(false)
    expect(entry({ assessedAs: 'opinion', grade: 'very low', startReason: 'Pain monitoring ran in both arms, so it reads as a case series.' }).success).toBe(true)
  })

  it('a review starts high only when its basis says the pool was randomized trials alone (191b)', () => {
    const review = { design: 'meta-analysis', assessedAs: 'randomized', indirect: true, imprecise: false, grade: 'moderate' } as const
    expect(reviewPoolProblem({ ...review, gradeBasis: 'Starts at high (meta-analysis of randomized trials). Down one for indirectness.' })).toBeNull()
    expect(reviewPoolProblem({ ...review, gradeBasis: 'Starts high: cluster RCTs only. Down one for the population.' })).toBeNull()
    expect(reviewPoolProblem({ ...review, gradeBasis: 'Starts at high (meta-analysis of randomized and/or controlled trials). Down one for indirectness.' })).toMatch(/randomized trials only/)
    expect(reviewPoolProblem({ ...review, gradeBasis: 'Starts at high (randomized and non-randomized trials). Down one for indirectness.' })).toMatch(/randomized trials only/)
    expect(reviewPoolProblem({ ...review, gradeBasis: 'Starts at high. Down one for indirectness.' })).toMatch(/randomized trials only/)
    expect(reviewPoolProblem({ ...review, assessedAs: 'observational', gradeBasis: 'A review of randomized and/or controlled trials, so it starts low; down one for indirectness.' })).toBeNull()
    expect(reviewPoolProblem({ ...review, design: 'rct', gradeBasis: 'Randomized trial, high; down one for indirectness.' })).toBeNull()
    expect(entry({ ...review, gradeBasis: 'Starts at high (meta-analysis of randomized and/or controlled trials). Down one for indirectness.' }).success).toBe(false)
    expect(entry({ ...review, gradeBasis: 'Starts at high (meta-analysis of randomized trials). Down one for indirectness.' }).success).toBe(true)
  })

  it('Nascimento 2018 pooled randomized and/or controlled trials, so it starts low; Palmieri-Smith 2013 is a randomized crossover, so it starts high', () => {
    const find = (id: string) => evidence?.entries.find((e) => e.id === id)
    expect(find('nascimento-2018-hip-knee-pfp')).toMatchObject({ assessedAs: 'observational', grade: 'very low' })
    expect(find('palmieri-smith-2013-pain-effusion-quadriceps')).toMatchObject({ design: 'rct', assessedAs: 'randomized', indirect: true, imprecise: true, grade: 'low' })
  })

  it('Graham 2026 compares the operated leg with the other leg, not the knee with the hip and ankle', () => {
    const takeaway = evidence?.entries.find((e) => e.id === 'graham-2026-rfess-acl')?.takeaway ?? ''
    expect(takeaway).not.toMatch(/than the hip and ankle/)
    expect(takeaway).toMatch(/other leg/)
  })

  it('an indirect entry’s basis says why', () => {
    expect(entry({ gradeBasis: 'Randomized trial, high; down two.' }).success).toBe(false)
    expect(entry({ gradeBasis: 'Randomized, high; down for the post-ACLR population and a small study.' }).success).toBe(true)
  })

  it('a pmid is required; a population is words', () => {
    expect(entry({}, ['pmid']).success).toBe(false)
    expect(entry({ population: 'adults' }).success).toBe(false)
  })
})

describe('one sentence of at most 40 words', () => {
  it('reads sentence ends, and leaves abbreviations and decimals alone', () => {
    expect(isOneSentence('A. B.')).toBe(false)
    expect(isOneSentence('x; y.')).toBe(true)
    expect(isOneSentence('They agreed well (kappa 0.75).')).toBe(true)
    expect(isOneSentence('Pooled by Smith et al. found less pain.')).toBe(true)
    expect(isOneSentence('Criteria vs. time were compared.')).toBe(true)
    expect(isOneSentence('Hip work, e.g. band walks, helped.')).toBe(true)
    expect(isOneSentence('Did it work? Maybe.')).toBe(false)
    expect(isOneSentence('No period at the end')).toBe(false)
  })

  it('a capital after a semicolon is a second sentence, unless it opens an acronym, a listed proper noun or a citation', () => {
    expect(joinsTwoSentences('Pain fell; Function rose.')).toBe(true)
    expect(joinsTwoSentences('Pain fell; function rose.')).toBe(false)
    expect(joinsTwoSentences('It did not; Among professionals there was none; Certainty was very low.')).toBe(true)
    expect(joinsTwoSentences('Pain fell; ACL injuries fell too.')).toBe(false)
    expect(joinsTwoSentences('Pain fell; Nordic curls helped.')).toBe(false)
    expect(joinsTwoSentences('Not curated; Logerstedt 2017 supersedes it.')).toBe(false)
    expect(entry({ takeaway: 'Pain fell; Function rose.' }).success).toBe(false)
    expect(entry({ takeaway: 'Pain fell; function rose.' }).success).toBe(true)
    expect(GateRationale.safeParse({ itemId: 'g1-run', why: 'One reason; Another reason.', entryIds: ['x'] }).success).toBe(false)
  })

  it('no takeaway, rationale or note in the data joins two sentences with a semicolon', () => {
    const texts = [
      ...(evidence?.entries ?? []).flatMap((e) => [e.takeaway, e.startReason ?? '']),
      ...(evidence?.gateRationales ?? []).map((r) => r.why),
      ...(evidence?.seen ?? []).map((s) => s.why),
    ]
    expect(texts.filter(joinsTwoSentences)).toEqual([])
  })

  it('refuses 41 words, and an abstract field', () => {
    const forty = `${Array.from({ length: 39 }, () => 'word').join(' ')} end.`
    expect(entry({ takeaway: forty }).success).toBe(true)
    expect(entry({ takeaway: `one ${forty}` }).success).toBe(false)
    expect(entry({ takeaway: 'First sentence. Second sentence.' }).success).toBe(false)
    expect(entry({ abstract: 'Background: …' }).success).toBe(false)
    expect(entry({ abstractText: 'Background: …' }).success).toBe(false)
    expect(entry({ relevance: 'Our note.' }).success).toBe(false)
  })

  it('a gate rationale is one sentence; a seen note is one sentence of at most 30 words', () => {
    expect(GateRationale.safeParse({ itemId: 'g1-run', why: 'One. Two.', entryIds: ['x'] }).success).toBe(false)
    expect(GateRationale.safeParse({ itemId: 'g1-run', why: 'One reason.', entryIds: [] }).success).toBe(false)
    expect(Seen.safeParse({ pmid: '1', why: `${Array.from({ length: 30 }, () => 'w').join(' ')} x.` }).success).toBe(false)
    expect(Seen.safeParse({ pmid: '1', why: 'Logerstedt 2017, no takeaway yet.' }).success).toBe(true)
  })
})

describe('the list as a whole', () => {
  const valid = rawEvidence as unknown as Record<string, unknown[]> & { entries: Record<string, unknown>[] }
  const first = valid.entries[0] ?? {}
  it('refuses the same PMID twice, an unknown search, an unknown cited entry and an entry that shows nowhere', () => {
    expect(Evidence.safeParse({ ...valid, entries: [...valid.entries, { ...first, id: 'another-id' }] }).success).toBe(false)
    expect(Evidence.safeParse({ ...valid, entries: [{ ...first, foundBy: ['no-such-search'] }, ...valid.entries.slice(1)] }).success).toBe(false)
    expect(Evidence.safeParse({ ...valid, gateRationales: [{ itemId: 'g1-stance', why: 'A reason.', entryIds: ['no-such-entry'] }] }).success).toBe(false)
    expect(Evidence.safeParse({ ...valid, entries: [...valid.entries, { ...first, id: 'nowhere-2020', pmid: '99999999', doi: undefined, phases: [], patterns: [], appRules: [] }] }).success).toBe(false)
  })
  it('refuses a seen PMID that is also an entry', () => {
    expect(Evidence.safeParse({ ...valid, seen: [{ pmid: first.pmid, why: 'Already an entry.' }] }).success).toBe(false)
  })
})
