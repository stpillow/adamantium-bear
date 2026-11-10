import { describe, expect, it } from 'vitest'
import { ALPHABET, checkSymbol, checksumOk, formatCode, generateCode, hashCode, hmacHex, normaliseCode, pepperCheck, sameDigest } from './_code.ts'
import { CODE_FIXTURES } from './_codeFixtures.ts'

const VALID = ['7K3MQ9X2T4HB8RD7', '1A2B3C4D5E6F7G8X', '0000000000000000', 'ZZZZZZZZZZZZZZZF']

describe('invite codes', () => {
  it('normalise the way a person types them', () => {
    for (const f of CODE_FIXTURES) expect(normaliseCode(f.input), f.input).toBe(f.norm)
  })

  it('carry a check symbol that every single mistyped character breaks', () => {
    for (const code of VALID) {
      expect(checksumOk(code), code).toBe(true)
      for (let i = 0; i < code.length; i++) {
        for (const c of ALPHABET) {
          if (c === code[i]) continue
          const typo = code.slice(0, i) + c + code.slice(i + 1)
          expect(checksumOk(typo), typo).toBe(false)
        }
      }
    }
    expect(checksumOk('7K3MQ9X2T4HB8RD')).toBe(false)
    expect(checkSymbol('7K3MQ9X2T4HB8RD')).toBe('7')
  })

  it('catch most swapped neighbours', () => {
    let caught = 0
    let swaps = 0
    for (const code of VALID) {
      for (let i = 0; i < code.length - 1; i++) {
        if (code[i] === code[i + 1]) continue
        swaps++
        if (!checksumOk(code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2))) caught++
      }
    }
    expect(caught / swaps).toBeGreaterThan(0.8)
  })

  it('are generated from 75 random bits, in the alphabet, with a good check symbol, roughly uniformly', () => {
    const counts = new Map<string, number>()
    for (let i = 0; i < 10_000; i++) {
      const code = generateCode()
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/)
      expect(checksumOk(code)).toBe(true)
      for (const c of code.slice(0, 15)) counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    // 150,000 random symbols over 32: about 4,688 each; a skewed generator would be far off.
    expect(counts.size).toBe(32)
    for (const [c, n] of counts) {
      expect(n, c).toBeGreaterThan(4_300)
      expect(n, c).toBeLessThan(5_100)
    }
  })

  it('take a byte’s low five bits, so every symbol is equally likely', () => {
    expect(generateCode((b) => b.fill(0))).toBe('0000000000000000')
    expect(generateCode((b) => b.fill(255)).slice(0, 15)).toBe('Z'.repeat(15))
    expect(generateCode((b) => b.fill(32 + 10)).slice(0, 15)).toBe('A'.repeat(15))
  })

  it('print in fours', () => {
    expect(formatCode('7K3MQ9X2T4HB8RD7')).toBe('7K3M-Q9X2-T4HB-8RD7')
  })

  it('are stored as a keyed hash: never the code, different under another pepper', async () => {
    const pepper = 'p'.repeat(40)
    const h = await hashCode(pepper, '7K3MQ9X2T4HB8RD7')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toContain('7K3M')
    expect(await hashCode(pepper, '7K3MQ9X2T4HB8RD7')).toBe(h)
    expect(await hashCode('q'.repeat(40), '7K3MQ9X2T4HB8RD7')).not.toBe(h)
    expect(await hmacHex(pepper, 'kr-code-v1:7K3MQ9X2T4HB8RD7')).toBe(h)
    expect(await pepperCheck(pepper)).not.toBe(await pepperCheck('q'.repeat(40)))
  })

  it('compare digests in constant time, and unequal lengths as unequal', () => {
    expect(sameDigest('ab12', 'ab12')).toBe(true)
    expect(sameDigest('ab12', 'ab13')).toBe(false)
    expect(sameDigest('ab12', 'ab1')).toBe(false)
    expect(sameDigest('', '')).toBe(true)
  })
})
