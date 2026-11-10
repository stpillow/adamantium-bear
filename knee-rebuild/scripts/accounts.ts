/**
 * `npm run accounts -- <command>` (M-U2; docs/accounts.md): the dev-time admin until the M-U5 admin
 * screen exists. Run on Shawn's machine only, never by the app. It reads DATABASE_URL and
 * AUTH_CODE_PEPPER from knee-rebuild/.env.accounts (gitignored), talks to Neon through the same
 * statements the function runs (api/_accounts.ts), and prints only what it just made: a fresh code,
 * once. It never prints a secret, a hash or a stored code (only hashes are stored).
 *
 * Before minting it checks its pepper against the one the deployment last used (the function stores
 * an HMAC of it on every redeem), so a local pepper that differs can't mint codes that never work.
 * The npm script sets NODE_USE_ENV_PROXY=1 so Node's fetch uses a configured HTTPS proxy.
 */
import { neon } from '@neondatabase/serverless'
import { PEPPER_CHECK_KEY, adminExists, clearAttempts, insertBootstrapAdmin, listAccounts, migrate, mintAccount, neonDb, readMeta, recodeAccount, revokeAccount, type Db, type MakeSql } from '../api/_accounts.ts'
import { formatCode, generateCode, hashCode, pepperCheck } from '../api/_code.ts'
import { USAGE, formatList, parseCommand, secretProblem } from './accounts.lib.ts'

const now = () => Math.floor(Date.now() / 1000)
const out = (text: string) => process.stdout.write(`${text}\n`)
const fail = (text: string): number => {
  process.stderr.write(`${text}\n`)
  return 1
}

function database(): Db | string {
  const url = process.env.DATABASE_URL
  const problem = secretProblem('DATABASE_URL', url)
  return problem ?? neonDb(url ?? '', neon as unknown as MakeSql)
}

/** The pepper, once it is well formed and matches the deployment's (when the deployment has used one yet). */
async function pepperFor(db: Db): Promise<string | { problem: string }> {
  const pepper = process.env.AUTH_CODE_PEPPER
  const problem = secretProblem('AUTH_CODE_PEPPER', pepper)
  if (problem || !pepper) return { problem: problem ?? 'AUTH_CODE_PEPPER isn’t set.' }
  const stored = await readMeta(db, PEPPER_CHECK_KEY)
  if (stored !== null && stored !== (await pepperCheck(pepper))) {
    return { problem: 'AUTH_CODE_PEPPER in .env.accounts is not the deployment’s: a code minted with it would never work. Copy the value from your password manager again.' }
  }
  if (stored === null) out('Note: no code has been redeemed on the deployment yet, so this pepper could not be checked against it.')
  return pepper
}

async function run(argv: readonly string[]): Promise<number> {
  const command = parseCommand(argv)
  if (command.kind === 'help') {
    if (command.problem) return fail(`${command.problem}\n\n${USAGE}`)
    out(USAGE)
    return 0
  }
  if (command.kind === 'code') {
    out(formatCode(generateCode()))
    return 0
  }

  const db = database()
  if (typeof db === 'string') return fail(db)
  await migrate(db)

  switch (command.kind) {
    case 'migrate':
      out('Tables are up to date.')
      return 0
    case 'list':
      out(formatList(await listAccounts(db)))
      return 0
    case 'unblock':
      await clearAttempts(db)
      out('The redeem rate limit is cleared.')
      return 0
    case 'revoke':
      out((await revokeAccount(db, command.id, now())) ? `Revoked ${command.id}: its code redeems nothing, and its sessions end on their next call.` : 'No live account has that id.')
      return 0
    case 'mint':
    case 'recode':
    case 'bootstrap': {
      const pepper = await pepperFor(db)
      if (typeof pepper !== 'string') return fail(pepper.problem)
      const code = generateCode()
      const hash = await hashCode(pepper, code)
      if (command.kind === 'mint') {
        const id = crypto.randomUUID()
        await mintAccount(db, { id, name: command.name, role: 'tester', hash, at: now() })
        out(`Tester ${command.name}, id ${id}`)
      } else if (command.kind === 'recode') {
        if (!(await recodeAccount(db, command.id, hash))) return fail('No live account has that id.')
        out(`New code for ${command.id}; the old one no longer works, and signed-in phones stay signed in.`)
      } else {
        if (await adminExists(db)) return fail('An admin already exists; bootstrap only makes the first one.')
        const made = await insertBootstrapAdmin(db, { id: crypto.randomUUID(), name: command.name, hash, at: now() })
        if (!made) return fail('An admin already exists; bootstrap only makes the first one.')
        out(`Admin ${made.display_name}, id ${made.id}`)
      }
      out(`Code (shown once): ${formatCode(code)}`)
      return 0
    }
  }
}

try {
  process.loadEnvFile('.env.accounts')
} catch {
  // No file: the environment may already carry the values.
}
run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  () => {
    // The error's own text can name the database host; say only what failed.
    process.exitCode = fail('The database couldn’t be reached or refused the request. Check DATABASE_URL in .env.accounts and the connection.')
  },
)
