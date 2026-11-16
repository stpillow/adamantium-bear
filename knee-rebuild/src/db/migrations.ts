import { PLANET_FITNESS_LOCATION_ID, type EquipmentId, type IsoDate, type Location } from '../schema/index.ts'

/**
 * What Shawn's club has on top of Planet Fitness's list (his Oct 31 and Nov 1 answers): both leg
 * presses, the seated and the 45°, and the rower. The list already has the seated press and the
 * rower; the 45° press is the one it lacks (PROGRAM-QUESTIONS 71).
 */
export const HOME_ADDITIONS: readonly EquipmentId[] = ['seated-leg-press', 'leg-press-45', 'rower']

/**
 * The home gym as installs before M-U1 got it (design section 2): Planet Fitness, started from its
 * list, with Shawn's additions and the dumbbell max set before gyms existed. Since M-U1 first run
 * writes each phone's own home gym; this row is written only for a set-up phone that has none (one
 * that ran version 2, before gyms) and for an imported file from before gyms, through
 * `ensureLocations` (PROGRAM-QUESTIONS 211), and is a test fixture. Pure. `listVersion` is the
 * seed's `equipmentListVersion`, so items the program's list adds later read as new to this gym.
 */
export function homeLocation(dumbbellMax: number, planetFitness: readonly EquipmentId[], createdOn: IsoDate, listVersion: number): Location {
  return {
    id: PLANET_FITNESS_LOCATION_ID,
    name: 'Planet Fitness',
    present: [...new Set([...planetFitness, ...HOME_ADDITIONS])],
    dumbbellMaxLb: dumbbellMax,
    startedFrom: 'planet-fitness',
    listVersion,
    extras: [],
    markedOff: [],
    createdOn,
    archived: false,
  }
}
