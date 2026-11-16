import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import raw from '../../data/evidence.json'
import { getEvidence, parseEvidence } from '../evidence/evidence.ts'
import { program } from '../program/program.ts'
import { Settings } from '../schema/index.ts'
import {
  ATTRIBUTION,
  EVIDENCE_LEAD,
  EVIDENCE_NOTE,
  NO_RATIONALE_NOTE,
  citationLine,
  countWords,
  designWords,
  doiHref,
  entryView,
  evidenceView,
  gateEvidenceLines,
  gradeWords,
  indirectWords,
  linksFor,
  phasePatterns,
  populationWords,
  rationaleView,
  readWords,
  shortCite,
  toggleWords,
} from './Evidence.helpers.ts'
import { GateCitation, Takeaway } from './program/Evidence.tsx'
import { Grade, START } from '../schema/evidence.ts'

const loaded = getEvidence()
const evidence = loaded.kind === 'ok' ? loaded.evidence : null
if (evidence === null) throw new Error('data/evidence.json didn’t parse')
const byId = (id: string) => {
  const e = evidence.entries.find((x) => x.id === id)
  if (!e) throw new Error(`no entry ${id}`)
  return e
}
const settingsIn = (over: Partial<Settings> = {}): Settings =>
  Settings.parse({ injuredSide: program.injuredSide, startDate: '2026-11-02', dumbbellMax: 80, restTimerSeconds: 60, painPerSet: false, ...over })
type Entry = (typeof evidence.entries)[number]
const like = (over: Partial<Entry>): Entry => ({ ...byId('silbernagel-2007-pain-monitoring'), ...over })

describe('words, never color', () => {
  it('the four GRADE words', () => {
    expect(gradeWords('high')).toBe('High certainty (GRADE)')
    expect(gradeWords('moderate')).toBe('Moderate certainty (GRADE)')
    expect(gradeWords('low')).toBe('Low certainty (GRADE)')
    expect(gradeWords('very low')).toBe('Very low certainty (GRADE)')
  })
  it('every design in words', () => {
    expect(designWords('rct')).toBe('Randomized trial')
    expect(designWords('meta-analysis')).toBe('Meta-analysis')
    expect(designWords('systematic-review')).toBe('Systematic review')
    expect(designWords('cohort')).toBe('Cohort study')
    expect(designWords('case-control')).toBe('Case-control study')
    expect(designWords('cross-sectional')).toBe('Cross-sectional study')
    expect(designWords('diagnostic-accuracy')).toBe('Measurement study (reliability or accuracy)')
    expect(designWords('case-series')).toBe('Case series')
    expect(designWords('narrative-review')).toBe('Narrative review')
    expect(designWords('expert-opinion')).toBe('Expert consensus or opinion')
    expect(designWords('guideline')).toBe('Clinical practice guideline')
  })
  it('the population, the indirect line in your words, and abstract only', () => {
    expect(populationWords(byId('sturgill-2009-effusion-stroke-test'))).toBe('Studied: 75 outpatients aged 16-65 with a one-sided knee problem.')
    expect(indirectWords(byId('sturgill-2009-effusion-stroke-test'))).toBe('Indirect for your knee (not a non-operative multi-ligament sprain, or a different outcome), which costs one GRADE level unless it is already very low.')
    expect(indirectWords(like({ indirect: false }))).toBeNull()
    expect(readWords(byId('sturgill-2009-effusion-stroke-test'))).toBe('(abstract only)')
    expect(readWords(byId('svantesson-2024-mcl-nonoperative'))).toBeNull()
  })
  it('counts and the toggle', () => {
    expect(countWords(0)).toBe('No study listed yet')
    expect(countWords(1)).toBe('1 study')
    expect(countWords(3)).toBe('3 studies')
    expect(toggleWords(false, 1)).toBe('Show 1 study')
    expect(toggleWords(false, 3)).toBe('Show 3 studies')
    expect(toggleWords(true, 3)).toBe('Hide studies')
  })
  it('the fixed lines', () => {
    expect(ATTRIBUTION).toBe('Citations found through Europe PMC and PubMed (US National Library of Medicine).')
    expect(NO_RATIONALE_NOTE).toBe('Items without “Why this test” have no study listed yet; their lines come from program.md.')
    expect(EVIDENCE_LEAD).toBe('Published studies behind this phase, the rules it runs on and its movement patterns, for reading. Nothing here changes what the app prescribes.')
    expect(EVIDENCE_NOTE).toBe(
      'None of these studies is of a non-operative multi-ligament sprain: many are after ACL surgery, others are of tendon injuries, kneecap pain or uninjured people, so every one is graded down for that unless it is already very low. The grade is a word: high, moderate, low or very low certainty.',
    )
  })
  it('the note’s “every one is graded down … unless it is already very low” holds: each grade sits below its start, or the start is the floor', () => {
    expect(EVIDENCE_NOTE).toMatch(/every one is graded down for that unless it is already very low\./)
    expect(EVIDENCE_NOTE).not.toMatch(/^Most/)
    expect(evidence.entries.filter((e) => !e.indirect).map((e) => e.id)).toEqual([])
    const rank = (g: Grade) => Grade.options.indexOf(g)
    const startOf = (e: (typeof evidence.entries)[number]) => e.sourceGrade ?? START[e.assessedAs ?? 'opinion']
    // Graded down: the grade is at least one level below where the rule starts it.
    const notDown = evidence.entries.filter((e) => startOf(e) !== 'very low' && rank(e.grade) <= rank(startOf(e)))
    expect(notDown.map((e) => e.id)).toEqual([])
    // The exception the note names: a start already at the floor stays very low, and there are some.
    const atFloor = evidence.entries.filter((e) => startOf(e) === 'very low')
    expect(atFloor.length).toBeGreaterThan(0)
    expect(atFloor.filter((e) => e.grade !== 'very low').map((e) => e.id)).toEqual([])
    const afterSurgery = evidence.entries.filter((e) => /ACL reconstruction|ACLR|after ACL surgery|post-?surgical/i.test(e.population))
    expect(afterSurgery.length).toBeLessThan(evidence.entries.length / 2)
  })
})

describe('citations', () => {
  it('a short cite: the first author’s surname, whole, with et al. when more follow', () => {
    expect(shortCite(byId('silbernagel-2007-pain-monitoring'))).toBe('Silbernagel et al., 2007')
    expect(shortCite(byId('thomee-1997-pfps-pain-monitoring'))).toBe('Thomeé, 1997')
    expect(shortCite(byId('buckthorpe-2019-late-stage-rehab'))).toBe('Buckthorpe, 2019')
    expect(shortCite(byId('escamilla-2001-squat-biomechanics'))).toBe('Escamilla, 2001')
    expect(shortCite(byId('van-melick-2016-acl-practice-guideline'))).toBe('van Melick et al., 2016')
    expect(shortCite(byId('van-dyk-2019-nordic-hamstring'))).toBe('van Dyk et al., 2019')
    expect(shortCite(byId('della-villa-2026-on-field-rehab-cohort'))).toBe('Della Villa et al., 2026')
    expect(shortCite(byId('al-attar-2022-plyometric-acl-prevention'))).toBe('Al Attar et al., 2022')
    expect(shortCite(like({ authors: 'Hamrin Senorski E, Svantesson E.', year: 2020 }))).toBe('Hamrin Senorski et al., 2020')
    expect(shortCite(like({ authors: 'American College of Sports Medicine', year: 2009 }))).toBe('American College of Sports Medicine, 2009')
  })
  it('the citation line', () => {
    expect(citationLine(byId('silbernagel-2007-pain-monitoring'))).toBe(
      'Silbernagel KG, Thomeé R, Eriksson BI, Karlsson J. Continued sports activity, using a pain-monitoring model, during rehabilitation in patients with Achilles tendinopathy: a randomized controlled study. The American journal of sports medicine, 2007.',
    )
    expect(citationLine(byId('pamboris-2024-okc-ckc'))).toMatch(/^Pamboris GM, Pavlou K, Paraskevopoulos E, Mohagheghi AA\. Effect of open vs\. closed/)
    expect(citationLine(like({ title: 'No final stop' }))).toMatch(/No final stop\. The American/)
  })
  it('links: DOI, PubMed, Europe PMC, in that order, each only from its id', () => {
    expect(linksFor(byId('smith-2017-painful-exercise'))).toEqual([
      { label: 'DOI', href: 'https://doi.org/10.1136/bjsports-2016-097383' },
      { label: 'PubMed', href: 'https://pubmed.ncbi.nlm.nih.gov/28596288/' },
      { label: 'Europe PMC', href: 'https://europepmc.org/article/MED/28596288' },
    ])
    expect(linksFor(like({ doi: undefined })).map((l) => l.label)).toEqual(['PubMed', 'Europe PMC'])
  })
  it('a DOI with reserved characters (an old SICI) is encoded per segment', () => {
    expect(doiHref('10.1002/(SICI)1097-4636(199709)36:3<345::AID-JBM9>3.0.CO;2-B')).toBe(
      'https://doi.org/10.1002/(SICI)1097-4636(199709)36%3A3%3C345%3A%3AAID-JBM9%3E3.0.CO%3B2-B',
    )
    expect(doiHref('10.1000/a#b?c')).toBe('https://doi.org/10.1000/a%23b%3Fc')
  })
  it('an entry’s view: words in order, no relevance note shown', () => {
    const v = entryView(byId('sturgill-2009-effusion-stroke-test'))
    expect(v.title).toBe('Interrater reliability of a clinical scale to assess knee joint effusion.')
    expect(v.kindLine).toBe('Measurement study (reliability or accuracy) · Very low certainty (GRADE)')
    expect(v.takeaway).toMatch(/^Physical therapists grading knee swelling/)
    expect(v.abstractOnly).toBe('(abstract only)')
    expect(v.graded).toMatch(/^How it was graded: Measurement-reliability study, so it starts at low\./)
    expect(JSON.stringify(v)).not.toMatch(/Why it’s here/)
    expect(v.links[0]?.ariaLabel).toBe('DOI: Sturgill et al., 2009, opens in the browser')
  })
})

describe('the Program screen’s Evidence view', () => {
  it('phase 1’s patterns: the whole phase’s templates, in enum order', () => {
    expect(phasePatterns(settingsIn())).toEqual(['squat', 'quad', 'hinge', 'single-leg', 'hamstring', 'hip', 'calf', 'balance', 'push', 'pull', 'core', 'carry', 'cardio'])
    expect(phasePatterns(settingsIn({ currentPhase: 2 }))).toContain('plyo')
    expect(phasePatterns(settingsIn({ currentPhase: 4 }))).toEqual([])
  })

  it('sections: the phase, the rules, then each pattern, with counts in words', () => {
    const view = evidenceView(1, phasePatterns(settingsIn()))
    if (view.kind !== 'ok') throw new Error(view.words)
    expect(view.sections.map((s) => s.id)).toEqual(['phase-1', 'rules', 'squat', 'quad', 'hinge', 'single-leg', 'hamstring', 'hip', 'calf', 'balance', 'push', 'pull', 'core', 'carry', 'cardio'])
    expect(view.sections[0]?.heading).toBe('Phase 1 · Foundation')
    expect(view.sections[0]?.countWords).toBe('5 studies')
    const rules = view.sections[1]
    expect(rules?.heading).toBe('Rules the app runs on')
    expect(rules?.groups.map((g) => [g.heading, g.countWords])).toEqual([
      ['Pain monitoring (clean, hold, back-off)', '6 studies'],
      ['Gates, not dates', '7 studies'],
      ['Deload weeks', '4 studies'],
      ['Warm-up', '9 studies'],
    ])
    expect(view.sections.find((s) => s.id === 'push')?.countWords).toBe('3 studies')
    expect(view.sections.filter((s) => s.count === 0).map((s) => s.id)).toEqual([])
    expect(view.sections.find((s) => s.id === 'single-leg')?.heading).toBe('Single-leg')
    expect(view.patternsNote).toBeNull()
    expect(view.footer).toEqual([ATTRIBUTION, 'Curated by hand on Nov 9 from searches saved with the app.', 'Studies open in the browser; the app itself never contacts these sites.'])
  })

  it('phase 4 has no patterns, and says so', () => {
    const view = evidenceView(4, [])
    if (view.kind !== 'ok') throw new Error(view.words)
    expect(view.sections.map((s) => s.id)).toEqual(['phase-4', 'rules'])
    expect(view.sections[0]?.heading).toBe('Phase 4 · Lacrosse')
    expect(view.patternsNote).toBe('Phase 4’s sessions aren’t written yet, so there are no movement patterns to list.')
  })

  it('a list that didn’t parse is a sentence, and nothing the app prescribes depends on it', () => {
    const view = evidenceView(1, ['squat'], parseEvidence({ ...raw, version: 2 }))
    expect(view.kind).toBe('error')
    expect(view.kind === 'error' ? view.words : '').toMatch(/^The evidence list didn’t load \(version: .+\)\. Nothing the app prescribes depends on it\.$/)
  })
})

describe('the Gates screen’s “Why this test”', () => {
  it('an item with studies: the sentence and the citations', () => {
    const r = rationaleView('g1-clean-weeks')
    expect(r?.why).toMatch(/^Loading through pain that stays within set limits/)
    expect(r?.citations.map((c) => c.cite)).toEqual(['Sprague et al., 2021', 'Silbernagel et al., 2007'])
    expect(r?.citations[0]?.kindLine).toBe('Randomized trial · Low certainty (GRADE)')
    expect(r?.citations[0]?.gateLine).toBe('Sprague et al., 2021, Randomized trial: Low certainty (GRADE).')
  })
  it('an item without: null, and the lines under the checklist', () => {
    const gateRationales = raw.gateRationales.filter((r) => !['g1-stance', 'g3-trust'].includes(r.itemId))
    const cited = new Set(gateRationales.flatMap((r) => r.entryIds))
    // Studies cited only by the dropped rationales would show nowhere, so they go too.
    const entries = raw.entries.filter((e) => e.phases.length + e.patterns.length + e.appRules.length > 0 || cited.has(e.id))
    const without = parseEvidence({ ...raw, entries, gateRationales })
    expect(without.kind).toBe('ok')
    expect(rationaleView('g1-stance', without)).toBeNull()
    expect(gateEvidenceLines(['g1-clean-weeks', 'g1-sl-leg-press', 'g1-stance', 'g1-run'], without)).toEqual([ATTRIBUTION, NO_RATIONALE_NOTE])
    expect(gateEvidenceLines(['g1-stance', 'g3-trust'], without)).toEqual([])
    expect(rationaleView('g1-clean-weeks', parseEvidence(null))).toBeNull()
  })
  it('with the completed list every gate has a rationale on every item, so only the attribution shows', () => {
    expect(gateEvidenceLines(['g1-clean-weeks', 'g1-sl-leg-press', 'g1-stance', 'g1-run'])).toEqual([ATTRIBUTION])
    expect(gateEvidenceLines(['g2-step-down', 'g2-sl-leg-press', 'g2-bulgarian', 'g2-calf-raises', 'g2-no-swelling'])).toEqual([ATTRIBUTION])
    const g3 = ['g3-single-hop', 'g3-triple-hop', 'g3-crossover-hop', 'g3-six-meter-timed-hop', 'g3-sl-leg-press-8rm', 'g3-acl-rsi', 'g3-no-swelling-plyo', 'g3-trust', 'g3-sign-off']
    expect(gateEvidenceLines(g3)).toEqual([ATTRIBUTION])
  })
})

/*
 * The two display checks a reviewer asked for (Batch F completion, PROGRAM-QUESTIONS 202): rendered to
 * markup with React's server renderer, since the test run has no DOM. Each fails if the mark it pins
 * disappears from what Shawn sees.
 */
describe('what the screens render', () => {
  const abstractOnly = evidence.entries.filter((e) => e.read === 'abstract-only')
  const fullText = evidence.entries.filter((e) => e.read === 'full-text')
  /** The words a reader sees: tags gone, React's escapes undone. */
  const text = (html: string) =>
    html
      .replace(/<[^>]+>/g, '')
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')

  it('a rendered takeaway read from the abstract alone ends with the “(abstract only)” mark; a full-text one has none', () => {
    expect(abstractOnly.length).toBeGreaterThan(0)
    expect(fullText.length).toBeGreaterThan(0)
    for (const e of abstractOnly) expect(text(renderToStaticMarkup(createElement(Takeaway, { entry: entryView(e) }))), e.id).toBe(`${e.takeaway} (abstract only)`)
    for (const e of fullText) expect(text(renderToStaticMarkup(createElement(Takeaway, { entry: entryView(e) }))), e.id).toBe(e.takeaway)
  })

  it('every citation under a gate’s “Why this test” renders its grade, then who was studied and the indirect line', () => {
    let checked = 0
    for (const r of evidence.gateRationales) {
      const view = rationaleView(r.itemId)
      if (view === null) throw new Error(`${r.itemId} has no rationale view`)
      for (const c of view.citations) {
        const entry = byId(c.id)
        const words = text(renderToStaticMarkup(createElement(GateCitation, { citation: c })))
        const graded = `${shortCite(entry)}, ${designWords(entry.design)}: ${gradeWords(entry.grade)}.`
        const studied = `${populationWords(entry)} ${indirectWords(entry) ?? ''}`.trim()
        expect(words.startsWith(`${graded}${studied}`), `${r.itemId}: ${c.id} reads “${words.slice(0, 160)}…”`).toBe(true)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(30)
  })
})
