import { describe, expect, it } from 'vitest'
import { HOME_HOST, HOME_URL } from '../rules/host.ts'
import { movedView } from './MovedNotice.helpers.ts'

describe('movedView (M-D1, PROGRAM-QUESTIONS 239)', () => {
  it('a set-up phone gets the new address, the steps in order and the way to Export', () => {
    const view = movedView(HOME_HOST, false)
    expect(view.lead).toBe('Knee Rebuild has moved to knee.shawnpillow.com. Your log stays at this address until you carry it across.')
    expect(view.steps).toEqual([
      'Export JSON here and save the file to Files.',
      'Open knee.shawnpillow.com in Safari, then Share, Add to Home Screen.',
      'Open the new icon and import the file on its first screen.',
      'From then on, log only in the new app. Delete this icon once the new one has logged a session.',
    ])
    expect(view.showExport).toBe(true)
    expect(view.link).toEqual({ href: HOME_URL, label: 'Open knee.shawnpillow.com' })
  })

  it('a phone in first run has nothing to carry: it is sent to set up on the new address, with no Export', () => {
    const view = movedView(HOME_HOST, true)
    expect(view.lead).toBe('Knee Rebuild has moved to knee.shawnpillow.com. Set it up there instead: open knee.shawnpillow.com in Safari, then Share, Add to Home Screen.')
    expect(view.steps).toEqual([])
    expect(view.showExport).toBe(false)
    expect(view.link.href).toBe(HOME_URL)
  })

  it('the steps warn against two copies of the log: one writer, no merge', () => {
    expect(movedView(HOME_HOST, false).steps.join(' ')).toMatch(/log only in the new app/)
  })

  it('the import named in the steps is the one first run offers on its first screen', async () => {
    const { IMPORT_NOTE } = await import('./Welcome.helpers.ts')
    expect(IMPORT_NOTE).toMatch(/Export JSON/)
    expect(movedView(HOME_HOST, false).steps[2]).toMatch(/first screen/)
  })
})
