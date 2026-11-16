import type { ReactNode } from 'react'

/*
 * The form pieces Settings, the location editor and first run share (M-U1): one labelled section,
 * its quiet note, and a choice that says it is chosen in words and a mark, never by color alone.
 */

/** A labelled group with a Saved word on its label row, an optional note while it waits, and a problem sentence under it. */
export function Section({ label, saved, problem, held = null, children }: { label: string; saved: boolean; problem: string | null; held?: string | null; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-3 border-t border-on-dark-faint pt-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-mono text-small font-normal uppercase tracking-[0.22em] text-on-dark-muted">{label}</h2>
        <span role="status" aria-live="polite" className="font-mono text-small uppercase tracking-[0.22em] text-green-bright">
          {saved ? '✓ Saved' : ''}
        </span>
      </div>
      {held ? <Note>{held}</Note> : null}
      {children}
      {problem ? (
        <p role="alert" className="text-body text-on-dark wrap-anywhere">
          {problem}
        </p>
      ) : null}
    </section>
  )
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-small text-on-dark-muted">{children}</p>
}

/** One of several choices, styled like a Tap: the chosen one says so with a mark (and, wide, a word), never by color alone. */
export function Choice({
  label,
  selected,
  onSelect,
  selectedWord = 'Chosen',
  compact = false,
  disabled = false,
}: {
  label: string
  selected: boolean
  onSelect: () => void
  selectedWord?: string
  compact?: boolean
  disabled?: boolean
}) {
  // The mark keeps to one line beside a label that wraps ("✓" over "Chosen" read as two marks).
  const mark = <span className="shrink-0 whitespace-nowrap font-mono text-small uppercase tracking-[0.22em]">{selected ? (compact ? '✓' : `✓ ${selectedWord}`) : '○'}</span>
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`tap flex w-full items-center rounded-sm border px-4 py-3 text-body disabled:opacity-50 ${compact ? 'justify-center gap-2' : 'justify-between gap-4 text-left'} ${
        selected ? 'border-paper bg-navy-lift text-on-dark' : 'border-on-dark-faint bg-transparent text-on-dark-dim'
      }`}
    >
      {compact ? (
        <>
          {mark}
          <span>{label}</span>
        </>
      ) : (
        <>
          <span className="min-w-0">{label}</span>
          {mark}
        </>
      )}
    </button>
  )
}
