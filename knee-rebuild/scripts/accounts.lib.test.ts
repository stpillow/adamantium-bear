import { describe, expect, it } from 'vitest'
import { formatList, nameProblem, parseCommand, secretProblem, when } from './accounts.lib.ts'

const ID = '0b9c6f0e-3a1d-4f43-9c1e-7d2a5b8e6f10'

describe('npm run accounts', () => {
  it('reads each command', () => {
    expect(parseCommand(['code'])).toEqual({ kind: 'code' })
    expect(parseCommand(['migrate'])).toEqual({ kind: 'migrate' })
    expect(parseCommand(['list'])).toEqual({ kind: 'list' })
    expect(parseCommand(['unblock'])).toEqual({ kind: 'unblock' })
    expect(parseCommand(['mint', '--name', ' Alex '])).toEqual({ kind: 'mint', name: 'Alex' })
    expect(parseCommand(['bootstrap', '--name', 'Shawn'])).toEqual({ kind: 'bootstrap', name: 'Shawn' })
    expect(parseCommand(['revoke', ID.toUpperCase()])).toEqual({ kind: 'revoke', id: ID })
    expect(parseCommand(['recode', ID])).toEqual({ kind: 'recode', id: ID })
    expect(parseCommand([])).toEqual({ kind: 'help', problem: null })
  })
  it('refuses a missing or bad name or id, and an unknown command, in words', () => {
    expect(parseCommand(['mint'])).toEqual({ kind: 'help', problem: 'Give a name: --name "Alex".' })
    expect(parseCommand(['mint', '--name', 'x'.repeat(41)])).toEqual({ kind: 'help', problem: 'A name is 40 characters at most.' })
    expect(parseCommand(['revoke'])).toMatchObject({ kind: 'help' })
    expect(parseCommand(['revoke', 'alex'])).toMatchObject({ kind: 'help' })
    expect(parseCommand(['drop'])).toEqual({ kind: 'help', problem: 'Unknown command: drop.' })
  })
  it('checks a name: 1 to 40 characters, no control characters', () => {
    expect(nameProblem('Alex')).toBeNull()
    expect(nameProblem('  ')).toBe('Give a name: --name "Alex".')
    expect(nameProblem('Al\nex')).toBe('A name has no control characters.')
    expect(nameProblem('x'.repeat(40))).toBeNull()
  })
  it('refuses a local secret that is missing, short, or has whitespace around it, without printing it', () => {
    const pepper = 'p'.repeat(40)
    expect(secretProblem('AUTH_CODE_PEPPER', pepper)).toBeNull()
    expect(secretProblem('AUTH_CODE_PEPPER', undefined)).toContain('isn\'t set')
    expect(secretProblem('AUTH_CODE_PEPPER', `${pepper}\n`)).toContain('newline')
    expect(secretProblem('AUTH_CODE_PEPPER', 'short')).toContain('shorter')
    expect(secretProblem('DATABASE_URL', 'postgres://x')).toBeNull()
    for (const v of [`${pepper}\n`, 'zq7xk']) expect(secretProblem('AUTH_CODE_PEPPER', v)).not.toContain(v.trim())
  })
  it('lists accounts with no code, in UTC', () => {
    expect(when(null)).toBe('-')
    expect(when(1_800_000_000)).toBe('2027-01-15 08:00 UTC')
    expect(formatList([])).toBe('No accounts yet.')
    const text = formatList([{ id: ID, display_name: 'Alex', role: 'tester', created: 1_800_000_000, revoked: null, last_seen: 1_800_003_600 }])
    expect(text).toBe(`Alex (tester)\n  id         ${ID}\n  made       2027-01-15 08:00 UTC\n  revoked    -\n  last seen  2027-01-15 09:00 UTC`)
  })
})
