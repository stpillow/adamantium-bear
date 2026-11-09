import { FIRST_RUN_STEPS, type FirstRunStep } from '../app/router.ts'
import { comingMonday, daysBetween, weekOf } from '../rules/calendar.ts'
import { newLocation } from '../rules/locations.ts'
import { DEFAULT_KIT, KnownTimeZone, PLANET_FITNESS_LOCATION_ID, type Equipment, type EquipmentId, type IsoDate, type Location, type Program, type Side } from '../schema/index.ts'
import { DEFAULT_START, nameCheck } from './LocationEditor.helpers.ts'
import { checkStartDate, dateWords, sideWords, zoneWords } from './Settings.helpers.ts'

/*
 * First run (M-U1, `#/welcome`; PROGRAM-QUESTIONS 207, 208): the answers as they are typed, what
 * each step needs before Next, the step a link may open, and every line it shows. Which date is
 * the coming Monday, what week today is and whether a date is a Monday come from src/rules; the
 * gym's name and the start date are checked by the same helpers the location editor and Settings use.
 */

export type { FirstRunStep }
export { FIRST_RUN_STEPS }

/** The home gym's name until it is changed: neutral, never Shawn's club (PROGRAM-QUESTIONS 208, 211). */
export const DEFAULT_GYM_NAME = 'Home gym'

/** First run's answers as they stand, each with the default the step shows until it is changed. */
export interface FirstRunDraft {
  /** No default: a guess would load the wrong leg. */
  injuredSide: Side | null
  /** The date input's value, checked at Next (`checkStartDate`). */
  startDate: string
  /** Whether the start date was picked; until it is, a change of zone moves it to that zone's coming Monday. */
  startTouched: boolean
  /** The gym's name as typed, checked at Next (`nameCheck`). */
  gymName: string
  /** The home gym as it will be saved: where its list starts, its rack and what it has (the location editor's own row). */
  home: Location
  /** Whether a mark was made on What it has; until one is, a new list start rebuilds the list without asking. */
  equipmentTouched: boolean
  kit: EquipmentId[]
  zone: string
  /** The steps passed with Next: a default counts as answered only once its step was shown. */
  seen: FirstRunStep[]
}

/** What first run is built from: the program's lists and today, in the zone the phone proposes. */
export type FirstRunLists = Pick<Program, 'planetFitness' | 'equipmentListVersion'>

/** A fresh draft: no side, the coming Monday, a gym named "Home gym" from Planet Fitness's list with no dumbbells, program.md's bag, the phone's zone. */
export function newFirstRunDraft(today: IsoDate, zone: string, lists: FirstRunLists): FirstRunDraft {
  return {
    injuredSide: null,
    startDate: comingMonday(today),
    startTouched: false,
    gymName: DEFAULT_GYM_NAME,
    home: newLocation(PLANET_FITNESS_LOCATION_ID, { name: DEFAULT_GYM_NAME, startedFrom: DEFAULT_START, dumbbellMaxLb: 0, createdOn: today }, lists),
    equipmentTouched: false,
    kit: [...DEFAULT_KIT],
    zone,
    seen: [],
  }
}

/** A new zone: the start date follows to that zone's coming Monday unless it was picked. */
export function withZone(draft: FirstRunDraft, zone: string, todayThere: IsoDate): FirstRunDraft {
  return { ...draft, zone, ...(draft.startTouched ? {} : { startDate: comingMonday(todayThere) }) }
}

/** A new list start: the gym's list as `newLocation` builds it from that start, its name, rack and day kept; any marks made on What it has go. */
export function withListStart(draft: FirstRunDraft, startedFrom: Location['startedFrom'], lists: FirstRunLists): FirstRunDraft {
  const { name, dumbbellMaxLb, createdOn } = draft.home
  return { ...draft, home: newLocation(PLANET_FITNESS_LOCATION_ID, { name, startedFrom, dumbbellMaxLb, createdOn }, lists), equipmentTouched: false }
}

/** Why a step can't be left with Next, in words; null when it can. */
export function stepProblem(draft: FirstRunDraft, step: FirstRunStep, locations: readonly Pick<Location, 'id' | 'name' | 'archived'>[] = []): string | null {
  switch (step) {
    case 'side':
      return draft.injuredSide === null ? 'Pick the injured knee to go on. There’s no default: a guess would load the wrong leg.' : null
    case 'start': {
      const check = checkStartDate(draft.startDate)
      return check.ok ? null : check.message
    }
    case 'gym': {
      const check = nameCheck(draft.gymName, locations, PLANET_FITNESS_LOCATION_ID)
      return check.ok ? null : check.message
    }
    case 'equipment':
    case 'ready':
      return null
    case 'time':
      return KnownTimeZone.safeParse(draft.zone).success ? null : 'Pick a time zone this phone knows.'
  }
}

/** Every step's problem, in order; empty when the draft can be saved. */
export function firstRunProblems(draft: FirstRunDraft, locations: readonly Pick<Location, 'id' | 'name' | 'archived'>[] = []): { step: FirstRunStep; problem: string }[] {
  return FIRST_RUN_STEPS.flatMap((step) => {
    const problem = stepProblem(draft, step, locations)
    return problem === null ? [] : [{ step, problem }]
  })
}

/** The first step not yet passed with Next, or with a problem; Ready once every one has been. A link to a later step opens this one. */
export function firstIncompleteStep(draft: FirstRunDraft, locations: readonly Pick<Location, 'id' | 'name' | 'archived'>[] = []): FirstRunStep {
  return FIRST_RUN_STEPS.find((step) => step !== 'ready' && (!draft.seen.includes(step) || stepProblem(draft, step, locations) !== null)) ?? 'ready'
}

/** The step a link asks for, or the first one not yet answered when it is further on. */
export function stepToShow(asked: FirstRunStep, draft: FirstRunDraft, locations: readonly Pick<Location, 'id' | 'name' | 'archived'>[] = []): FirstRunStep {
  const allowed = firstIncompleteStep(draft, locations)
  return FIRST_RUN_STEPS.indexOf(asked) <= FIRST_RUN_STEPS.indexOf(allowed) ? asked : allowed
}

/** The step after this one, for Next; null after Ready. */
export function nextStep(step: FirstRunStep): FirstRunStep | null {
  return FIRST_RUN_STEPS[FIRST_RUN_STEPS.indexOf(step) + 1] ?? null
}

const STEPS: Record<FirstRunStep, { title: string; lead: string; next: string }> = {
  side: { title: 'Injured side', lead: 'The side the program rehabs.', next: 'Next: start date' },
  start: { title: 'Start date', lead: 'Week 1 starts on a Monday.', next: 'Next: home gym' },
  gym: { title: 'Home gym', lead: 'Where you train most. More gyms go under Where you train later.', next: 'Next: what it has' },
  equipment: { title: 'What it has', lead: 'Tick what’s there; it decides the swaps.', next: 'Next: time zone' },
  time: { title: 'Time zone', lead: 'Today’s date and every week boundary are counted in it.', next: 'Next: check it' },
  ready: { title: 'Ready', lead: 'Check it, then Today.', next: 'Start the program' },
}

/** A step's title, its lead ("Step 2 of 6 · Week 1 starts on a Monday."), and its Next button's words. */
export function stepWords(step: FirstRunStep): { title: string; lead: string; next: string } {
  const { title, lead, next } = STEPS[step]
  return { title, lead: `Step ${FIRST_RUN_STEPS.indexOf(step) + 1} of ${FIRST_RUN_STEPS.length} · ${lead}`, next }
}

/** "Use Monday Nov 9 (the coming Monday)", or "(today)" on a Monday. */
export function comingMondayWords(today: IsoDate): string {
  const monday = comingMonday(today)
  return `Use ${dateWords(monday)} (${monday === today ? 'today' : 'the coming Monday'})`
}

/** "Monday Nov 2, 2026; today is in week 1." or "Monday Nov 9, 2026; it starts in 6 days." */
export function startLine(start: IsoDate, today: IsoDate): string {
  const week = weekOf(today, start)
  const when = week >= 1 ? `today is in week ${week}` : daysBetween(today, start) === 1 ? 'it starts tomorrow' : `it starts in ${daysBetween(today, start)} days`
  return `${dateWords(start)}, ${start.slice(0, 4)}; ${when}.`
}

/** "Planet Fitness, 31 items, dumbbells to 80 lb." */
export function gymLine(home: Pick<Location, 'name' | 'present' | 'dumbbellMaxLb'>): string {
  const items = home.present.length === 1 ? '1 item' : `${home.present.length} items`
  const rack = home.dumbbellMaxLb > 0 ? `dumbbells to ${home.dumbbellMaxLb} lb` : 'no dumbbells'
  return `${home.name}, ${items}, ${rack}.`
}

function andList(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`
}

/** The bag in words, by program.md's names in lower case: "cable ankle strap and mini loop band"; "nothing". */
export function kitWords(kit: readonly EquipmentId[], vocabulary: readonly Pick<Equipment, 'id' | 'name'>[]): string {
  const names = kit.map((id) => vocabulary.find((e) => e.id === id)?.name ?? id).map((name) => `${name.charAt(0).toLowerCase()}${name.slice(1)}`)
  return names.length === 0 ? 'nothing' : andList(names)
}

/**
 * Ready's lines, each with the step its Change opens. A home gym already stored (a phone with data
 * but no settings row) is kept as it is, and said so: first run never writes over it.
 */
export function readyLines(
  draft: FirstRunDraft,
  today: IsoDate,
  vocabulary: readonly Pick<Equipment, 'id' | 'name'>[],
  storedHome: Pick<Location, 'name' | 'present' | 'dumbbellMaxLb'> | null = null,
): { step: FirstRunStep; text: string }[] {
  const start = checkStartDate(draft.startDate)
  const home = { ...draft.home, name: draft.gymName.trim() }
  return [
    { step: 'side', text: draft.injuredSide ? `Injured: the ${sideWords(draft.injuredSide).toLowerCase()}.` : 'Injured: not picked yet.' },
    { step: 'start', text: start.ok ? `Week 1: ${startLine(start.date, today)}` : `Week 1: ${start.message}` },
    { step: 'gym', text: storedHome ? `Home gym: ${gymLine(storedHome).replace(/\.$/, '')}, already on this phone and kept as it is.` : `Home gym: ${gymLine(home)}` },
    { step: 'equipment', text: `You bring: ${kitWords(draft.kit, vocabulary)}.` },
    { step: 'time', text: `Dates in ${zoneWords(draft.zone)}.` },
  ]
}

/** The time zone step's lines: what the phone is set to, and today in the zone picked when that is another. */
export function zoneStepLines(device: string, zone: string, today: IsoDate): string[] {
  if (device === zone) return [`This phone is set to ${zoneWords(device)}. Today there is ${dateWords(today)}.`]
  return [`This phone is set to ${zoneWords(device)}.`, `Picked: ${zoneWords(zone)}. Today there is ${dateWords(today)}.`]
}

/** Why Start the program saved nothing, in words. */
export function startFailedWords(reason: string): string {
  return `Nothing was saved (${reason}); tap again.`
}

/** First run's first screen: the import's note. */
export const IMPORT_NOTE = 'Moving from another phone? A file from Export JSON brings everything, settings included, and skips these questions.'
