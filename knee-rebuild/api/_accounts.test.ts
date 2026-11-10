import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  MIGRATIONS,
  accountById,
  adminExists,
  attemptCounts,
  clearAttempts,
  findByCodeHash,
  forgetAttempt,
  forgetLiveDb,
  insertBootstrapAdmin,
  listAccounts,
  liveDb,
  migrate,
  mintAccount,
  neonDb,
  pruneAttempts,
  readMeta,
  recodeAccount,
  recordAttempt,
  revokeAccount,
  touchLastSeen,
  writeMeta,
  type MakeSql,
} from './_accounts.ts'
import { testDb, type TestDb } from './_testDb.ts'

const NOW = 1_800_000_000
const H = (c: string) => c.repeat(64)
let db: TestDb

beforeAll(async () => {
  db = await testDb()
})
afterAll(async () => {
  await db.close()
})
beforeEach(async () => {
  await db.reset()
})

const tester = (id: string, hash = H(id[0] ?? 'a'), at = NOW) => mintAccount(db, { id, name: `Tester ${id}`, role: 'tester', hash, at })

describe('migrations', () => {
  it('run twice without harm and leave one row per version', async () => {
    await migrate(db)
    await migrate(db)
    const rows = await db.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version')
    expect(rows).toEqual(MIGRATIONS.map((m) => ({ version: m.version })))
  })

  it('the constraints refuse an unknown role, an empty or overlong name, and a duplicate code', async () => {
    await expect(mintAccount(db, { id: 'x', name: 'X', role: 'owner' as never, hash: H('1'), at: NOW })).rejects.toThrow()
    await expect(mintAccount(db, { id: 'x', name: '', role: 'tester', hash: H('1'), at: NOW })).rejects.toThrow()
    await expect(mintAccount(db, { id: 'x', name: 'n'.repeat(41), role: 'tester', hash: H('1'), at: NOW })).rejects.toThrow()
    expect(await tester('a', H('1'))).toBe('a')
    await expect(tester('b', H('1'))).rejects.toThrow()
  })

  it('allow one admin at most: a second admin is refused by the index', async () => {
    expect(await mintAccount(db, { id: 'adm', name: 'Shawn', role: 'admin', hash: H('1'), at: NOW })).toBe('adm')
    await expect(mintAccount(db, { id: 'adm2', name: 'Other', role: 'admin', hash: H('2'), at: NOW })).rejects.toThrow()
  })
})

describe('the statements', () => {
  it('findByCodeHash and accountById read an account back, revoked as a flag and times as epoch seconds', async () => {
    await tester('a', H('1'))
    expect(await findByCodeHash(db, H('1'))).toEqual({ id: 'a', display_name: 'Tester a', role: 'tester', code_hash: H('1'), revoked: false })
    expect(await findByCodeHash(db, H('2'))).toBeNull()
    expect(await accountById(db, 'a')).toEqual({ id: 'a', display_name: 'Tester a', role: 'tester', revoked: false, last_seen: null })
    expect(await accountById(db, 'nobody')).toBeNull()
  })

  it('touchLastSeen writes at most once an hour', async () => {
    await tester('a')
    await touchLastSeen(db, 'a', NOW)
    expect((await accountById(db, 'a'))?.last_seen).toBe(NOW)
    await touchLastSeen(db, 'a', NOW + 3599)
    expect((await accountById(db, 'a'))?.last_seen).toBe(NOW)
    await touchLastSeen(db, 'a', NOW + 3601)
    expect((await accountById(db, 'a'))?.last_seen).toBe(NOW + 3601)
  })

  it('revokeAccount revokes a live account once; recodeAccount swaps the code of a live one only', async () => {
    await tester('a', H('1'))
    expect(await recodeAccount(db, 'a', H('2'))).toBe(true)
    expect(await findByCodeHash(db, H('1'))).toBeNull()
    expect((await findByCodeHash(db, H('2')))?.id).toBe('a')
    expect(await revokeAccount(db, 'a', NOW + 10)).toBe(true)
    expect(await revokeAccount(db, 'a', NOW + 20)).toBe(false)
    expect(await revokeAccount(db, 'nobody', NOW)).toBe(false)
    expect((await findByCodeHash(db, H('2')))?.revoked).toBe(true)
    expect(await recodeAccount(db, 'a', H('3'))).toBe(false)
  })

  it('listAccounts lists every account in the order made, with no code hash', async () => {
    await tester('b', H('2'), NOW + 5)
    await tester('a', H('1'), NOW)
    await revokeAccount(db, 'b', NOW + 9)
    expect(await listAccounts(db)).toEqual([
      { id: 'a', display_name: 'Tester a', role: 'tester', created: NOW, revoked: null, last_seen: null },
      { id: 'b', display_name: 'Tester b', role: 'tester', created: NOW + 5, revoked: NOW + 9, last_seen: null },
    ])
  })

  it('insertBootstrapAdmin makes the admin only while none exists, and is idempotent', async () => {
    expect(await adminExists(db)).toBe(false)
    expect(await insertBootstrapAdmin(db, { id: 'adm', name: 'Shawn', hash: H('1'), at: NOW })).toEqual({ id: 'adm', display_name: 'Shawn', role: 'admin' })
    expect(await adminExists(db)).toBe(true)
    expect(await insertBootstrapAdmin(db, { id: 'adm2', name: 'Shawn', hash: H('1'), at: NOW })).toBeNull()
    expect(await insertBootstrapAdmin(db, { id: 'adm3', name: 'Someone', hash: H('2'), at: NOW })).toBeNull()
    const both = await Promise.all([1, 2].map((i) => insertBootstrapAdmin(db, { id: `again${i}`, name: 'Shawn', hash: H('1'), at: NOW })))
    expect(both).toEqual([null, null])
    expect((await listAccounts(db)).map((a) => a.id)).toEqual(['adm'])
  })

  it('insertBootstrapAdmin takes no tester’s code as the admin’s', async () => {
    await tester('a', H('1'))
    expect(await insertBootstrapAdmin(db, { id: 'adm', name: 'Shawn', hash: H('1'), at: NOW })).toBeNull()
    expect(await adminExists(db)).toBe(false)
  })

  it('attemptCounts counts the 15-minute window, per client and overall; pruneAttempts keeps 24 hours; clearAttempts empties it', async () => {
    for (let i = 0; i < 3; i++) await recordAttempt(db, 'me', NOW + i)
    await recordAttempt(db, 'you', NOW)
    expect(await attemptCounts(db, 'me', NOW + 10)).toEqual({ mine: 3, everyone: 4 })
    expect(await attemptCounts(db, 'them', NOW + 10)).toEqual({ mine: 0, everyone: 4 })
    expect(await attemptCounts(db, 'me', NOW + 15 * 60 + 2)).toEqual({ mine: 0, everyone: 0 })
    await pruneAttempts(db, NOW + 24 * 3600 - 1)
    expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM auth_attempts'))[0]?.n).toBe(4)
    // Older than 24 hours: the two at NOW go, the two after it stay.
    await pruneAttempts(db, NOW + 24 * 3600 + 1)
    expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM auth_attempts'))[0]?.n).toBe(2)
    await clearAttempts(db)
    expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM auth_attempts'))[0]?.n).toBe(0)
  })

  it('recordAttempt hands back its row, and forgetAttempt takes exactly that row back, once', async () => {
    const first = await recordAttempt(db, 'me', NOW)
    const second = await recordAttempt(db, 'me', NOW)
    expect(first).not.toBe(second)
    expect(await attemptCounts(db, 'me', NOW)).toEqual({ mine: 2, everyone: 2 })
    await forgetAttempt(db, second)
    expect(await attemptCounts(db, 'me', NOW)).toEqual({ mine: 1, everyone: 1 })
    await forgetAttempt(db, second)
    expect(await attemptCounts(db, 'me', NOW)).toEqual({ mine: 1, everyone: 1 })
    await forgetAttempt(db, first)
    expect(await attemptCounts(db, 'me', NOW)).toEqual({ mine: 0, everyone: 0 })
  })

  it('readMeta and writeMeta keep one value per key, rewritten when it changes', async () => {
    expect(await readMeta(db, 'pepper_check')).toBeNull()
    await writeMeta(db, 'pepper_check', 'one')
    await writeMeta(db, 'pepper_check', 'one')
    expect(await readMeta(db, 'pepper_check')).toBe('one')
    await writeMeta(db, 'pepper_check', 'two')
    expect(await readMeta(db, 'pepper_check')).toBe('two')
  })
})

describe('the Neon adapter', () => {
  it('passes the text and parameters through and hands back the rows', async () => {
    const calls: { text: string; params: unknown[] }[] = []
    const make: MakeSql = (url) => {
      expect(url).toBe('postgres://x')
      return { query: async (text, params) => (calls.push({ text, params }), [{ ok: 1 }]) }
    }
    const neon = neonDb('postgres://x', make)
    expect(await neon.query('SELECT $1', [7])).toEqual([{ ok: 1 }])
    expect(calls).toEqual([{ text: 'SELECT $1', params: [7] }])
  })

  it('migrates once per cold start, and tries again after a failure', async () => {
    forgetLiveDb()
    let calls = 0
    let fail = true
    const make: MakeSql = () => ({
      query: async () => {
        calls++
        if (fail) throw new Error('postgres://user:secret@host.neon.tech is down')
        return [{ v: 1 }]
      },
    })
    await expect(liveDb('postgres://a', make)).rejects.toThrow()
    fail = false
    const one = await liveDb('postgres://a', make)
    const before = calls
    const two = await liveDb('postgres://a', make)
    expect(two).toBe(one)
    expect(calls).toBe(before)
    forgetLiveDb()
  })
})
