/*
 * Invite codes (M-U2; PROGRAM-QUESTIONS 213, 214). Shared server code: the underscore keeps Vercel
 * from deploying it as a function. Imports inside api/ end in `.js` (Vercel's compile keeps the
 * specifier; the `.ts` file it names is emitted as `.js`).
 *
 * A code is 16 Crockford base32 symbols printed in fours, XXXX-XXXX-XXXX-XXXX: 15 random symbols
 * (75 bits; a random byte & 31 is exactly uniform, since 256 is a multiple of 32) and a Luhn mod 32
 * check symbol that catches every single mistyped character and most swapped neighbours. The server
 * stores only HMAC-SHA-256(AUTH_CODE_PEPPER, 'kr-code-v1:' + code); two secrets are compared in
 * constant time.
 */
import { timingSafeEqual } from 'node:crypto'

/** Crockford's base32: no I, L, O or U. */
export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const CODE_LENGTH = 16
const N = ALPHABET.length

/** Uppercase, spaces, dashes and underscores out, O read as 0 and I or L as 1; null unless 16 alphabet symbols are left. */
export function normaliseCode(text: string): string | null {
  const s = text
    .toUpperCase()
    .replace(/[\s_-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (s.length !== CODE_LENGTH) return null
  for (const c of s) if (!ALPHABET.includes(c)) return null
  return s
}

/** Luhn mod N over the symbols' positions in the alphabet, from the right; `withCheck` says whether the last symbol is the check. */
function luhnSum(symbols: string, withCheck: boolean): number {
  let factor = withCheck ? 1 : 2
  let sum = 0
  for (let i = symbols.length - 1; i >= 0; i--) {
    let addend = factor * ALPHABET.indexOf(symbols[i] ?? '')
    factor = factor === 2 ? 1 : 2
    addend = Math.floor(addend / N) + (addend % N)
    sum += addend
  }
  return sum % N
}

export function checkSymbol(body: string): string {
  return ALPHABET[(N - luhnSum(body, false)) % N] ?? '0'
}

/** A normalised code whose last symbol is the right check symbol. */
export function checksumOk(norm: string): boolean {
  return norm.length === CODE_LENGTH && [...norm].every((c) => ALPHABET.includes(c)) && luhnSum(norm, true) === 0
}

/** A fresh code, normalised (no dashes): 15 random symbols and the check. */
export function generateCode(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(CODE_LENGTH - 1))
  const body = Array.from(bytes, (b) => ALPHABET[b & 31] ?? '0').join('')
  return body + checkSymbol(body)
}

/** XXXX-XXXX-XXXX-XXXX. */
export function formatCode(norm: string): string {
  return (norm.match(/.{1,4}/g) ?? []).join('-')
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** HMAC-SHA-256 of a message under a key, lowercase hex. */
export async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message)))
}

/** What the database stores for a code: never the code itself. */
export function hashCode(pepper: string, norm: string): Promise<string> {
  return hmacHex(pepper, `kr-code-v1:${norm}`)
}

/** The value the function stores so the dev script can tell its local pepper is the deployment's. */
export function pepperCheck(pepper: string): Promise<string> {
  return hmacHex(pepper, 'kr-pepper-check')
}

/** Two hex digests, compared in constant time; different lengths are simply unequal. */
export function sameDigest(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}
