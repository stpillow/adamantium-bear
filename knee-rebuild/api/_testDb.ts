/*
 * The tests' database: PGlite (Postgres compiled to WebAssembly, in-process; a dev dependency only)
 * behind the same Db adapter production gives Neon, with the same migrations. Only test files import
 * this (src/app/serverSide.guard.test.ts), so PGlite never reaches a function or the bundle.
 */
import { PGlite } from '@electric-sql/pglite'
import { migrate, type Db } from './_accounts.js'

export interface TestDb extends Db {
  /** Empties every table between tests. */
  reset(): Promise<void>
  close(): Promise<void>
  /** How many statements ran, for tests that prove a path never touched the database. */
  readonly statements: number
}

export async function testDb(): Promise<TestDb> {
  const pg = new PGlite()
  let statements = 0
  const db: Db = {
    query: async (text, params = []) => {
      statements++
      return (await pg.query(text, [...params])).rows as never
    },
  }
  await migrate(db)
  return {
    query: db.query,
    reset: async () => {
      await pg.query('TRUNCATE accounts, auth_attempts, meta')
    },
    close: () => pg.close(),
    get statements() {
      return statements
    },
  }
}
