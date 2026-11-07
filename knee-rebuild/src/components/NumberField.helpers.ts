/*
 * Pure helpers for NumberField, the nullable whole-number input (metrics phase 2): an optional
 * field whose empty state IS a value ("no heart rate"), which the Stepper can't represent (it
 * requires a number and clamps typed input into its bounds — clamping would store a number nobody
 * measured). Nothing is clamped here: an out-of-range number is kept as typed and refused in words
 * beside the field, so Save can say why instead of a schema error.
 */

/** The typed text as a whole number, or null: empty is null ("not entered"), and so is anything that isn't digits. */
export function wholeFromText(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  return Number(trimmed)
}

/** The value as the field shows it when not being edited: empty for null. */
export function textFromValue(value: number | null): string {
  return value === null ? '' : String(value)
}
