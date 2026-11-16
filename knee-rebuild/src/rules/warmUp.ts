/*
 * The lift warm-up's minutes (program.md "Warm-up, mobility and recovery"): 5 minutes on the upright
 * bike, where the gym has one, then the knee circuit, 5 minutes in Phases 1–2 and 3 from Phase 3.
 * "45 minutes means door-to-door" (Shawn, Nov 8, decision 14): the time window takes these off the
 * top before any exercise is fitted (src/rules/fitWindow.ts), and a late session's minutes estimate
 * adds them. Nothing else reads them (PROGRAM-QUESTIONS 166).
 */

export interface WarmUpParts {
  /** The bike's minutes, or null where the gym has no upright bike (nothing else is written for it). */
  bike: number | null
  /** The knee circuit's minutes for the phase. */
  circuit: number
  total: number
}

/** The seed's warm-up, as this rule reads it. */
export interface WarmUpMinutesInput {
  bikeMinutes: number
  circuitMinutesByPhase: Readonly<Record<string, number>>
}

/**
 * The warm-up's minutes for a phase: the bike's (when the gym has one) and the knee circuit's. A
 * phase the program doesn't write a circuit for takes the longest circuit written, so the window
 * never under-counts the warm-up (the conservative reading).
 */
export function warmUpParts(lift: WarmUpMinutesInput, phase: number, bikeHere: boolean): WarmUpParts {
  const written = Object.values(lift.circuitMinutesByPhase)
  const circuit = lift.circuitMinutesByPhase[String(phase)] ?? (written.length > 0 ? Math.max(...written) : 0)
  const bike = bikeHere ? lift.bikeMinutes : null
  return { bike, circuit, total: circuit + (bike ?? 0) }
}
