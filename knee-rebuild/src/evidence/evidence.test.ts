import { describe, expect, it } from 'vitest'
import raw from '../../data/evidence.json'
import { program } from '../program/program.ts'
import { Pattern } from '../schema/enums.ts'
import { entriesForPattern, entriesForPhase, entriesForRule, getEvidence, parseEvidence, rationaleFor, sortEntries } from './evidence.ts'

const loaded = getEvidence()
const evidence = loaded.kind === 'ok' ? loaded.evidence : null
if (evidence === null) throw new Error('data/evidence.json didn’t parse')

describe('the evidence list, loaded', () => {
  it('parses once, lazily, and hands back the same object', () => {
    expect(loaded.kind).toBe('ok')
    expect(getEvidence()).toBe(loaded)
  })

  it('a broken list is an error in words, never a throw', () => {
    const broken = parseEvidence({ ...raw, entries: [] })
    expect(broken.kind).toBe('error')
    expect(broken.kind === 'error' ? broken.error : '').toMatch(/entries/)
    expect(parseEvidence(null).kind).toBe('error')
  })
})

describe('lookups', () => {
  it('by phase: phase 4 includes the merged Grindem entry; every phase has some', () => {
    expect(entriesForPhase(evidence, 4).map((e) => e.id)).toContain('grindem-2016-delaware-oslo')
    for (const n of [1, 2, 3, 4]) expect(entriesForPhase(evidence, n).length, `phase ${n}`).toBeGreaterThan(0)
    expect(entriesForPhase(evidence, 1).map((e) => e.id)).toEqual([
      'cuyul-vasquez-2022-cross-education-acl',
      'valdes-2026-cross-education-clinical',
      'svantesson-2024-mcl-nonoperative',
      'van-melick-2016-acl-practice-guideline',
      'eitzen-2010-progressive-5-week',
    ])
  })

  it('by pattern and by rule', () => {
    expect(entriesForPattern(evidence, 'hamstring').map((e) => e.id)).toContain('impellizzeri-2021-nordic-reappraisal')
    expect(entriesForPattern(evidence, 'hamstring').map((e) => e.id)).toContain('van-dyk-2019-nordic-hamstring')
    expect(entriesForPattern(evidence, 'single-leg').map((e) => e.id)).toContain('clark-2019-sl-leg-press-reliability')
    expect(entriesForPattern(evidence, 'push').map((e) => e.id)).toEqual(['mccrary-2015-upper-body-warm-up', 'spiering-2021-minimal-dose', 'acsm-2009-progression-models'])
    expect(entriesForRule(evidence, 'deload').map((e) => e.id)).toEqual(['pancar-2026-deload-within-subject', 'coleman-2024-deload-rct', 'bell-2023-deload-delphi', 'spiering-2021-minimal-dose'])
  })

  it('every movement pattern now has at least one study (the completed hand-off, PROGRAM-QUESTIONS 202)', () => {
    for (const p of Pattern.options) expect(entriesForPattern(evidence, p).length, p).toBeGreaterThan(0)
  })

  it('sorts by grade, best first, then newest, then id', () => {
    const order = sortEntries(entriesForPattern(evidence, 'hip')).map((e) => [e.grade, e.year])
    expect(order[0]).toEqual(['moderate', 2019])
    expect(order[1]).toEqual(['very low', 2026])
    for (let i = 1; i < order.length; i++) {
      const rank = (g: unknown) => ['high', 'moderate', 'low', 'very low'].indexOf(String(g))
      expect(rank(order[i]?.[0])).toBeGreaterThanOrEqual(rank(order[i - 1]?.[0]))
    }
  })

  it('a gate item’s rationale, or null where no study is listed', () => {
    const clean = rationaleFor(evidence, 'g1-clean-weeks')
    expect(clean?.entries.map((e) => e.id)).toEqual(['sprague-2021-pain-guided', 'silbernagel-2007-pain-monitoring'])
    expect(clean?.why).toMatch(/pain-monitoring model/)
    expect(rationaleFor(evidence, 'no-such-item')).toBeNull()
    const gateRationales = raw.gateRationales.filter((r) => r.itemId !== 'g1-stance')
    const cited = new Set(gateRationales.flatMap((r) => r.entryIds))
    // Studies cited only by the dropped rationale would show nowhere, so they go too.
    const entries = raw.entries.filter((e) => e.phases.length + e.patterns.length + e.appRules.length > 0 || cited.has(e.id))
    const withoutStance = parseEvidence({ ...raw, entries, gateRationales })
    if (withoutStance.kind !== 'ok') throw new Error(withoutStance.error)
    expect(rationaleFor(withoutStance.evidence, 'g1-stance')).toBeNull()
  })

  it('every gate item in the seed has a rationale, and each names only that item’s own studies', () => {
    const items = program.gates.flatMap((g) => g.items.map((i) => i.id))
    expect(items).toHaveLength(18)
    for (const id of items) expect(rationaleFor(evidence, id), id).not.toBeNull()
    expect(evidence.gateRationales.map((r) => r.itemId).filter((id) => !items.includes(id))).toEqual([])
  })

  it('the ACL-RSI rationale says where 76 comes from, that the app scores a different form, and that other cohorts disagree', () => {
    const r = rationaleFor(evidence, 'g3-acl-rsi')
    expect(r?.why).toMatch(/76/)
    expect(r?.why).toMatch(/post-surgery/)
    expect(r?.why).toMatch(/6-item short form/)
    expect(r?.why).toMatch(/app scores the full 12-item form/)
    expect(r?.why).toMatch(/return-to-sport lines sat in the 60s/)
    expect(r?.entries.map((e) => e.id)).toContain('mcpherson-2019-acl-rsi-second-injury')
  })
})
