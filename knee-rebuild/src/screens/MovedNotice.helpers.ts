/*
 * The words on the old address (M-D1; PROGRAM-QUESTIONS 238, 239). Whether to show them is
 * src/rules/host.ts's call; this only says it. A set-up phone has a log to carry across, so it gets
 * the steps and the way to Export; a phone still in first run has nothing to carry, so it is sent to
 * set up on the new address instead.
 */

export interface MovedView {
  lead: string
  /** The move, in order; empty when there is nothing to carry. */
  steps: string[]
  /** Whether to offer the way to Settings' Export section. */
  showExport: boolean
  link: { href: string; label: string }
}

export function movedView(host: string, firstRun: boolean): MovedView {
  const link = { href: `https://${host}`, label: `Open ${host}` }
  if (firstRun) {
    return {
      lead: `Knee Rebuild has moved to ${host}. Set it up there instead: open ${host} in Safari, then Share, Add to Home Screen.`,
      steps: [],
      showExport: false,
      link,
    }
  }
  return {
    lead: `Knee Rebuild has moved to ${host}. Your log stays at this address until you carry it across.`,
    steps: [
      'Export JSON here and save the file to Files.',
      `Open ${host} in Safari, then Share, Add to Home Screen.`,
      'Open the new icon and import the file on its first screen.',
      'From then on, log only in the new app. Delete this icon once the new one has logged a session.',
    ],
    showExport: true,
    link,
  }
}
