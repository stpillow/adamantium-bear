import { describe, expect, it } from 'vitest'
import { homeLocation } from '../db/migrations.ts'
import { program } from '../program/program.ts'
import { forNextProgramUpdate } from '../rules/equipment.ts'
import type { Location } from '../schema/index.ts'
import { COPY_HEADING, copiedWords, copyText, updateLead, updateLine } from './NextUpdate.helpers.ts'

const home = homeLocation(80, program.planetFitness, '2026-11-02', program.equipmentListVersion)
const marriott: Location = {
  ...home,
  id: 'loc-1',
  name: 'Marriott Downtown',
  present: ['smith-machine'],
  startedFrom: 'empty',
  extras: [{ id: 'extra-1', text: 'Kettlebells', addedOn: '2026-11-10' }],
  archived: true,
}

describe('updateLine', () => {
  it('says where typed text came from and when', () => {
    expect(updateLine({ text: 'Kettlebells', locationName: 'Marriott Downtown', addedOn: '2026-11-10' })).toEqual({ what: 'Kettlebells', detail: 'Typed at Marriott Downtown, Nov 10' })
  })
  it('says a list item is here but unused', () => {
    expect(updateLine({ text: 'Cable crossover', locationName: 'Planet Fitness' })).toEqual({
      what: 'Cable crossover',
      detail: 'At Planet Fitness: on program.md’s list, but no session uses it',
    })
  })
})

describe('copyText', () => {
  it('lists every gym, archived ones included, under one heading', () => {
    const notes = forNextProgramUpdate([home, marriott], program.equipment, program.exercises)
    const text = copyText(notes)
    expect(text.split('\n')).toEqual([
      COPY_HEADING,
      '- Weight plate (at Planet Fitness: on program.md’s list, but no session uses it)',
      '- Floor tape (at Planet Fitness: on program.md’s list, but no session uses it)',
      '- Treadmill (at Planet Fitness: on program.md’s list, but no session uses it)',
      '- Stair climber (at Planet Fitness: on program.md’s list, but no session uses it)',
      '- Kettlebells (typed at Marriott Downtown, Nov 10)',
    ])
  })
  it('is just the heading with nothing kept', () => {
    expect(copyText([])).toBe('For the next program.md update')
  })
})

describe('updateLead and copiedWords', () => {
  it('counts what is kept, or says what lands here', () => {
    expect(updateLead(0)).toBe('Nothing yet. Equipment typed in a gym’s editor that no exercise uses lands here, with the gym and the day.')
    expect(updateLead(1)).toBe('1 thing the gyms have that the program doesn’t use, kept for the next time program.md is updated.')
    expect(updateLead(7)).toBe('7 things the gyms have that the program doesn’t use, kept for the next time program.md is updated.')
  })
  it('says whether the copy worked', () => {
    expect(copiedWords(true, 7)).toBe('Copied 7 lines.')
    expect(copiedWords(true, 1)).toBe('Copied 1 line.')
    expect(copiedWords(false, 7)).toBe('This browser didn’t allow copying; the text is below to select and copy.')
  })
})
