import { describe, expect, it } from 'vitest'
import { HOME_HOST, HOME_URL, RETIRED_HOSTS, movedTo } from './host.ts'

describe('movedTo (M-D1, PROGRAM-QUESTIONS 238)', () => {
  it('the old production address points at the new one', () => {
    expect(movedTo('knee-rebuild.vercel.app')).toBe('knee.shawnpillow.com')
  })

  it('reads a hostname as the browser may hand it over: any case, a trailing dot', () => {
    expect(movedTo('Knee-Rebuild.Vercel.App')).toBe(HOME_HOST)
    expect(movedTo('knee-rebuild.vercel.app.')).toBe(HOME_HOST)
    expect(movedTo(' knee-rebuild.vercel.app ')).toBe(HOME_HOST)
  })

  it('the new address itself says nothing', () => {
    expect(movedTo(HOME_HOST)).toBeNull()
    expect(movedTo('KNEE.shawnpillow.com.')).toBeNull()
  })

  it('previews, the longer production aliases, local builds and the dev server say nothing', () => {
    for (const host of [
      'knee-rebuild-git-claude-great-edison-l1zxct-spdc2.vercel.app',
      'knee-rebuild-git-dev-spdc2.vercel.app',
      'knee-rebuild-git-main-spdc2.vercel.app',
      'knee-rebuild-spdc2.vercel.app',
      'knee-rebuild-abc123def-spdc2.vercel.app',
      'localhost',
      '127.0.0.1',
      '',
    ]) {
      expect(movedTo(host), host).toBeNull()
    }
  })

  it('a name that only contains the old one is not the old one', () => {
    for (const host of ['knee-rebuild.vercel.app.example.com', 'evil-knee-rebuild.vercel.app', 'vercel.app', 'knee-rebuild.vercel']) {
      expect(movedTo(host), host).toBeNull()
    }
  })

  it('the new address is an https origin with no path, and is not itself retired', () => {
    expect(HOME_URL).toBe('https://knee.shawnpillow.com')
    expect(new URL(HOME_URL).origin).toBe(HOME_URL)
    expect(RETIRED_HOSTS).not.toContain(HOME_HOST)
    for (const host of RETIRED_HOSTS) expect(host).toBe(host.toLowerCase())
  })
})
