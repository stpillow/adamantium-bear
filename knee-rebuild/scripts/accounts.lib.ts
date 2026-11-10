/**
 * The pure half of `npm run accounts` (M-U2; docs/accounts.md): reading the command line, checking
 * a name and a local secret, and printing the account list. The SQL is api/_accounts.ts's, tested
 * there against PGlite; scripts/accounts.ts wires the two to Neon.
 */

export type Command =
  | { kind: 'code' }
  | { kind: 'migrate' }
  | { kind: 'mint'; name: string }
  | { kind: 'list' }
  | { kind: 'revoke'; id: string }
  | { kind: 'recode'; id: string }
  | { kind: 'bootstrap'; name: string }
  | { kind: 'unblock' }
  | { kind: 'help'; problem: string | null }

export const USAGE = `npm run accounts -- <command>

  code                     print a fresh code (for AUTH_BOOTSTRAP_CODE); needs nothing
  migrate                  create or update the tables
  mint --name "Alex"       a tester account; prints its code once
  list                     every account: id, name, role, made, revoked, last seen (never a code)
  revoke <id>              the account's code redeems nothing and its sessions end on their next call
  recode <id>              a new code for an account; the old one stops working, sessions carry on
  bootstrap --name "Shawn" the first admin from the terminal; refuses once an admin exists
  unblock                  clears the redeem rate limit's record

Reads DATABASE_URL and AUTH_CODE_PEPPER from knee-rebuild/.env.accounts (gitignored).`

/** A display name: 1 to 40 characters once trimmed, no control characters; or why not. */
export function nameProblem(name: string): string | null {
  const t = name.trim()
  if (t === '') return 'Give a name: --name "Alex".'
  if (t.length > 40) return 'A name is 40 characters at most.'
  if ([...t].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return 'A name has no control characters.'
  return null
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseCommand(argv: readonly string[]): Command {
  const [verb, ...rest] = argv
  const flag = (name: string) => {
    const i = rest.indexOf(`--${name}`)
    return i >= 0 ? rest[i + 1] : undefined
  }
  const named = (kind: 'mint' | 'bootstrap'): Command => {
    const name = flag('name')
    const problem = name === undefined ? 'Give a name: --name "Alex".' : nameProblem(name)
    return problem ? { kind: 'help', problem } : { kind, name: (name ?? '').trim() }
  }
  const byId = (kind: 'revoke' | 'recode'): Command => {
    const id = rest[0]
    return id && ID.test(id) ? { kind, id: id.toLowerCase() } : { kind: 'help', problem: `Give the account's id (from list): npm run accounts -- ${kind} <id>.` }
  }
  switch (verb) {
    case 'code':
    case 'migrate':
    case 'list':
    case 'unblock':
      return { kind: verb }
    case 'mint':
    case 'bootstrap':
      return named(verb)
    case 'revoke':
    case 'recode':
      return byId(verb)
    case undefined:
    case 'help':
    case '--help':
      return { kind: 'help', problem: null }
    default:
      return { kind: 'help', problem: `Unknown command: ${verb}.` }
  }
}

/** Why a local secret can't be used, or null: set, 32 or more characters, nothing around it (a stray newline would void every code). */
export function secretProblem(name: string, value: string | undefined): string | null {
  if (!value) return `${name} isn't set: put it in knee-rebuild/.env.accounts.`
  if (value !== value.trim()) return `${name} has spaces or a newline around it; remove them (the deployment's value has none).`
  if (name !== 'DATABASE_URL' && value.length < 32) return `${name} is shorter than 32 characters; it isn't the deployment's.`
  return null
}

/** An epoch-seconds time as a UTC date and minute, or a dash. */
export function when(epoch: number | null): string {
  return epoch === null ? '-' : `${new Date(epoch * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export interface ListedRow {
  id: string
  display_name: string
  role: string
  created: number
  revoked: number | null
  last_seen: number | null
}

/** The account list as text: one block per account, never a code or a hash. */
export function formatList(rows: readonly ListedRow[]): string {
  if (rows.length === 0) return 'No accounts yet.'
  return rows
    .map((r) => [`${r.display_name} (${r.role})`, `  id         ${r.id}`, `  made       ${when(r.created)}`, `  revoked    ${when(r.revoked)}`, `  last seen  ${when(r.last_seen)}`].join('\n'))
    .join('\n\n')
}
