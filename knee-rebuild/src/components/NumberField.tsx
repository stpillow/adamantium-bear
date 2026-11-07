import { useId, useState } from 'react'
import { textFromValue, wholeFromText } from './NumberField.helpers.ts'

export interface NumberFieldProps {
  label: string
  /** Null is "not entered", a state of its own, shown as an empty field; never 0. */
  value: number | null
  onChange: (value: number | null) => void
  unit?: string
  /** Shown as the empty field's placeholder, e.g. "150". */
  placeholder?: string
  disabled?: boolean
}

/**
 * An optional whole-number input (metrics phase 2): a 44 px numeric-keypad field whose empty state
 * is a value of its own, null, which the Stepper can't represent. Nothing is clamped: what is
 * typed is handed over as typed (whole numbers only), and the screen refuses an out-of-range
 * number in words beside the field, so nothing is stored that nobody measured. While the field has
 * focus it keeps the typed text, so clearing it reads as null the moment it blurs.
 */
export function NumberField({ label, value, onChange, unit, placeholder, disabled = false }: NumberFieldProps) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-body text-on-dark-dim">
        {label}
        {unit ? <span className="text-on-dark-muted"> ({unit})</span> : null}
      </label>
      <input
        id={id}
        disabled={disabled}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        className="tap w-20 rounded-sm bg-ink text-center font-mono text-lead text-on-dark placeholder:text-on-dark-muted disabled:opacity-50"
        value={draft ?? textFromValue(value)}
        placeholder={placeholder}
        onFocus={() => setDraft(textFromValue(value))}
        onChange={(e) => {
          const text = e.target.value
          setDraft(text)
          onChange(wholeFromText(text))
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  )
}
