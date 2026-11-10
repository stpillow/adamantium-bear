/*
 * The accounts database (M-U2; PROGRAM-QUESTIONS 213 to 222): Neon Postgres in production, PGlite in
 * the tests, both behind one tiny query adapter. Every SQL statement the app runs lives in this file,
 * parameterised, and each one runs against PGlite in api/_accounts.test.ts (a guard pins `.query(`
 * here and to api/_testDb.ts). Timestamps go in as epoch seconds through to_timestamp() and come back
 * as epoch seconds, flags as booleans and counts as int, so the two drivers' type parsers never differ.
 * Neon over HTTP has no interactive transactions, so every invariant is one statement.
 */

/** One parameterised statement in, its rows out. */
export interface Db {
  query<T extends Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T[]>
}

/** What the Neon driver's `neon(url)` hands back, as far as this file uses it. */
export type MakeSql = (url: string) => { query: (text: string, params: unknown[]) => Promise<unknown> }

/** Neon's HTTP driver as a Db. `make` is injectable so a test can prove the pass-through with no network. */
export function neonDb(url: string, make: MakeSql): Db {
  const sql = make(url)
  return { query: async (text, params = []) => (await sql.query(text, [...params])) as never }
}

// ---------------------------------------------------------------------------------------------
// Migrations: idempotent, applied once per cold start by the function and by `npm run accounts -- migrate`

export const MIGRATIONS: readonly { version: number; statements: readonly string[] }[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS accounts (
        id text PRIMARY KEY,
        display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
        role text NOT NULL CHECK (role IN ('admin', 'tester')),
        code_hash text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL,
        revoked_at timestamptz,
        last_seen_at timestamptz,
        last_app_version text
      )`,
      // One admin at most (the operational-only admin is Shawn; PROGRAM-QUESTIONS 215). A later migration can drop it.
      `CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_admin ON accounts ((role)) WHERE role = 'admin'`,
      `CREATE TABLE IF NOT EXISTS auth_attempts (client_key text NOT NULL, at timestamptz NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS auth_attempts_client_at ON auth_attempts (client_key, at)`,
      `CREATE INDEX IF NOT EXISTS auth_attempts_at ON auth_attempts (at)`,
      `CREATE TABLE IF NOT EXISTS meta (k text PRIMARY KEY, v text NOT NULL)`,
    ],
  },
]

async function migrateOnce(db: Db): Promise<void> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  const [row] = await db.query<{ v: number }>('SELECT coalesce(max(version), 0)::int AS v FROM schema_migrations')
  const at = row?.v ?? 0
  for (const m of MIGRATIONS) {
    if (m.version <= at) continue
    for (const statement of m.statements) await db.query(statement)
    await db.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [m.version])
  }
}

/** Brings the tables up to date. Two cold starts racing on CREATE ... IF NOT EXISTS can collide in pg_type, so it tries once more. */
export async function migrate(db: Db): Promise<void> {
  try {
    await migrateOnce(db)
  } catch {
    await migrateOnce(db)
  }
}

let live: { url: string; db: Db; ready: Promise<void> } | null = null

/** One Neon client and one migration per cold start; a failed one is retried on the next request. The driver loads only here. */
export async function liveDb(url: string, make?: MakeSql): Promise<Db> {
  let entry = live
  if (!entry || entry.url !== url) {
    const maker = make ?? ((await import('@neondatabase/serverless')).neon as unknown as MakeSql)
    const db = neonDb(url, maker)
    const created = { url, db, ready: migrate(db) }
    live = created
    created.ready.catch(() => {
      if (live === created) live = null
    })
    entry = created
  }
  await entry.ready
  return entry.db
}

/** For tests: forget the cold start's client. */
export function forgetLiveDb(): void {
  live = null
}

// ---------------------------------------------------------------------------------------------
// The statements

export type Role = 'admin' | 'tester'

export interface CodeRow extends Record<string, unknown> {
  id: string
  display_name: string
  role: Role
  code_hash: string
  revoked: boolean
}

export interface AccountRow extends Record<string, unknown> {
  id: string
  display_name: string
  role: Role
  revoked: boolean
  /** Epoch seconds, or null before the first authenticated request. */
  last_seen: number | null
}

export interface ListedAccount extends Record<string, unknown> {
  id: string
  display_name: string
  role: Role
  created: number
  revoked: number | null
  last_seen: number | null
}

export async function findByCodeHash(db: Db, hash: string): Promise<CodeRow | null> {
  const [row] = await db.query<CodeRow>('SELECT id, display_name, role, code_hash, (revoked_at IS NOT NULL) AS revoked FROM accounts WHERE code_hash = $1', [hash])
  return row ?? null
}

export async function accountById(db: Db, id: string): Promise<AccountRow | null> {
  const [row] = await db.query<AccountRow>(
    'SELECT id, display_name, role, (revoked_at IS NOT NULL) AS revoked, extract(epoch FROM last_seen_at)::float8 AS last_seen FROM accounts WHERE id = $1',
    [id],
  )
  return row ?? null
}

/** The first admin, only while none exists; a bare ON CONFLICT absorbs a clash on the code or on the one-admin index. */
export async function insertBootstrapAdmin(db: Db, a: { id: string; name: string; hash: string; at: number }): Promise<{ id: string; display_name: string; role: Role } | null> {
  const [row] = await db.query<{ id: string; display_name: string; role: Role }>(
    `INSERT INTO accounts (id, display_name, role, code_hash, created_at)
     SELECT $1, $2, 'admin', $3, to_timestamp($4)
     WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE role = 'admin')
     ON CONFLICT DO NOTHING
     RETURNING id, display_name, role`,
    [a.id, a.name, a.hash, a.at],
  )
  return row ?? null
}

/** At most one write an hour per account (the caller also skips it when it knows the last one is recent). */
export async function touchLastSeen(db: Db, id: string, at: number): Promise<void> {
  await db.query("UPDATE accounts SET last_seen_at = to_timestamp($2) WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < to_timestamp($2) - interval '1 hour')", [id, at])
}

export async function pruneAttempts(db: Db, at: number): Promise<void> {
  await db.query("DELETE FROM auth_attempts WHERE at < to_timestamp($1) - interval '24 hours'", [at])
}

/** Records one redeem attempt and hands back its row (its ctid as text; the table is insert-and-delete only, so it never moves), for forgetAttempt. */
export async function recordAttempt(db: Db, key: string, at: number): Promise<string> {
  const [row] = await db.query<{ row: string }>('INSERT INTO auth_attempts (client_key, at) VALUES ($1, to_timestamp($2)) RETURNING ctid::text AS row', [key, at])
  return row?.row ?? ''
}

/** Takes back one attempt recordAttempt made: a redeem refused by the limit leaves no row (PROGRAM-QUESTIONS 217). */
export async function forgetAttempt(db: Db, row: string): Promise<void> {
  if (row === '') return
  await db.query('DELETE FROM auth_attempts WHERE ctid = $1::tid', [row])
}

/** Redeem attempts in the last 15 minutes: this client's and everyone's. */
export async function attemptCounts(db: Db, key: string, at: number): Promise<{ mine: number; everyone: number }> {
  const [row] = await db.query<{ mine: number; everyone: number }>(
    "SELECT count(*) FILTER (WHERE client_key = $1)::int AS mine, count(*)::int AS everyone FROM auth_attempts WHERE at > to_timestamp($2) - interval '15 minutes'",
    [key, at],
  )
  return { mine: row?.mine ?? 0, everyone: row?.everyone ?? 0 }
}

/** Lifts a rate-limit lockout (`npm run accounts -- unblock`). */
export async function clearAttempts(db: Db): Promise<void> {
  await db.query('DELETE FROM auth_attempts')
}

export async function mintAccount(db: Db, a: { id: string; name: string; role: Role; hash: string; at: number }): Promise<string | null> {
  const [row] = await db.query<{ id: string }>('INSERT INTO accounts (id, display_name, role, code_hash, created_at) VALUES ($1, $2, $3, $4, to_timestamp($5)) RETURNING id', [
    a.id,
    a.name,
    a.role,
    a.hash,
    a.at,
  ])
  return row?.id ?? null
}

export function listAccounts(db: Db): Promise<ListedAccount[]> {
  return db.query<ListedAccount>(
    'SELECT id, display_name, role, extract(epoch FROM created_at)::float8 AS created, extract(epoch FROM revoked_at)::float8 AS revoked, extract(epoch FROM last_seen_at)::float8 AS last_seen FROM accounts ORDER BY created_at, id',
  )
}

/** True when it revoked a live account; false when there was none, or it was already revoked. */
export async function revokeAccount(db: Db, id: string, at: number): Promise<boolean> {
  return (await db.query('UPDATE accounts SET revoked_at = to_timestamp($2) WHERE id = $1 AND revoked_at IS NULL RETURNING id', [id, at])).length === 1
}

/** A new code for a live account: the old one stops working, sessions carry on. */
export async function recodeAccount(db: Db, id: string, hash: string): Promise<boolean> {
  return (await db.query('UPDATE accounts SET code_hash = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING id', [id, hash])).length === 1
}

export async function adminExists(db: Db): Promise<boolean> {
  const [row] = await db.query<{ present: boolean }>("SELECT EXISTS (SELECT 1 FROM accounts WHERE role = 'admin') AS present")
  return row?.present === true
}

export async function readMeta(db: Db, k: string): Promise<string | null> {
  const [row] = await db.query<{ v: string }>('SELECT v FROM meta WHERE k = $1', [k])
  return row?.v ?? null
}

/** Writes a value, rewriting it only when it changed. */
export async function writeMeta(db: Db, k: string, v: string): Promise<void> {
  await db.query('INSERT INTO meta (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = excluded.v WHERE meta.v <> excluded.v', [k, v])
}

export const PEPPER_CHECK_KEY = 'pepper_check'
