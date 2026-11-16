import { useState } from 'react'
import { Button } from '../../components/Button.tsx'
import type { Pattern } from '../../schema/index.ts'
import { EVIDENCE_NOTE, evidenceView, toggleWords, type EntryView, type LinkView, type SectionView } from '../Evidence.helpers.ts'
import { HEADING, LABEL, Note } from './parts.tsx'

/**
 * The Program screen's Evidence view (Batch F): the published studies behind the current phase, the
 * rules the app runs on and the phase's movement patterns, each section collapsed until asked for.
 * Read-only: every grade is a word beside the population it was studied in, and nothing here changes
 * what the app prescribes. A study's links are plain navigations that open in the browser; the page
 * itself never contacts a literature site.
 */
export function Evidence({ phase, patterns }: { phase: number; patterns: readonly Pattern[] }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const view = evidenceView(phase, patterns)
  if (view.kind === 'error') {
    return (
      <p role="alert" className="text-body text-on-dark">
        {view.words}
      </p>
    )
  }
  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const [first, rules, ...patternSections] = view.sections
  return (
    <div className="flex flex-col gap-6">
      <Note>{EVIDENCE_NOTE}</Note>
      {[first, rules].map((s) => (s ? <Section key={s.id} section={s} open={open.has(s.id)} onToggle={() => toggle(s.id)} /> : null))}
      {view.patternsNote ? <Note>{view.patternsNote}</Note> : null}
      {patternSections.map((s) => (
        <Section key={s.id} section={s} open={open.has(s.id)} onToggle={() => toggle(s.id)} />
      ))}
      <footer className="flex flex-col gap-1 border-t border-on-dark-faint pt-4">
        {view.footer.map((line) => (
          <p key={line} className="text-small text-on-dark-muted">
            {line}
          </p>
        ))}
      </footer>
    </div>
  )
}

function Section({ section, open, onToggle }: { section: SectionView; open: boolean; onToggle: () => void }) {
  const headingId = `evidence-${section.id}-heading`
  const listId = `evidence-${section.id}`
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 border-t border-on-dark-faint pt-4">
      <h3 id={headingId} className={HEADING}>
        {section.heading}
      </h3>
      <p className="text-small text-on-dark-muted">{section.countWords}</p>
      {section.count > 0 ? (
        <Button variant="quiet" className="self-start px-0!" aria-expanded={open} aria-controls={listId} onClick={onToggle}>
          {toggleWords(open, section.count)}
        </Button>
      ) : null}
      {/* Always in the page, so aria-controls names an element that exists, open or not. */}
      <div id={listId}>
        {open ? (
          section.groups.length > 0 ? (
            <div className="flex flex-col gap-4">
              {section.groups.map((g) => (
                <div key={g.id} className="flex flex-col gap-1">
                  <h4 className={LABEL}>{g.heading}</h4>
                  <p className="text-small text-on-dark-muted">{g.countWords}</p>
                  <StudyList entries={g.entries} level={5} />
                </div>
              ))}
            </div>
          ) : (
            <StudyList entries={section.entries} />
          )
        ) : null}
      </div>
    </section>
  )
}

function StudyList({ entries, level = 4 }: { entries: readonly EntryView[]; level?: 4 | 5 }) {
  if (entries.length === 0) return null
  const Title = level === 4 ? 'h4' : 'h5'
  return (
    <ul className="flex flex-col">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-col gap-2 border-t border-on-dark-faint py-3">
          <Title className="text-body font-medium text-on-dark wrap-anywhere">{e.title}</Title>
          <p className="text-small text-on-dark-muted wrap-anywhere">{e.citation}</p>
          <p className="text-small text-on-dark">{e.kindLine}</p>
          <PopulationLine entry={e} />
          <Takeaway entry={e} />
          <p className="text-small text-on-dark-muted">{e.graded}</p>
          <StudyLinks links={e.links} />
        </li>
      ))}
    </ul>
  )
}

/**
 * One study under a gate item's "Why this test": its grade as a word, then who was studied and the
 * indirect line straight after it, then the takeaway (marked when abstract only) and the links. The
 * Gates screen renders it; Evidence.helpers.test.ts renders it to markup to pin that order.
 */
export function GateCitation({ citation }: { citation: EntryView }) {
  return (
    <li className="flex flex-col gap-1 border-t border-on-dark-faint py-3">
      <p className="text-small font-medium text-on-dark">{citation.gateLine}</p>
      <PopulationLine entry={citation} />
      <Takeaway entry={citation} />
      <StudyLinks links={citation.links} />
    </li>
  )
}

/** Who was studied, and the indirect line beside it. */
export function PopulationLine({ entry }: { entry: EntryView }) {
  return (
    <p className="text-small text-on-dark-dim">
      {entry.population}
      {entry.indirect ? ` ${entry.indirect}` : ''}
    </p>
  )
}

/** The one-sentence takeaway in our words, marked when it rests on the abstract alone. */
export function Takeaway({ entry }: { entry: EntryView }) {
  return (
    <p className="text-body text-on-dark">
      {entry.takeaway}
      {entry.abstractOnly ? <span className="text-small text-on-dark-muted"> {entry.abstractOnly}</span> : null}
    </p>
  )
}

/** DOI, PubMed, Europe PMC: 44 px links that open the browser, a navigation and not a fetch. */
export function StudyLinks({ links }: { links: readonly (LinkView & { ariaLabel: string })[] }) {
  return (
    <div className="flex flex-wrap gap-x-4">
      {links.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={l.ariaLabel}
          className="tap inline-flex items-center text-small text-on-dark-dim underline underline-offset-4"
        >
          {l.label}
        </a>
      ))}
    </div>
  )
}
