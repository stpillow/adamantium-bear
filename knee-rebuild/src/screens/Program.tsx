import { useState } from 'react'
import { useEngineMode } from '../app/mode.ts'
import { useToday } from '../app/today.ts'
import { Screen } from '../components/Screen.tsx'
import { useAddedSlots, useDownPeriods, useProgramOverrides, useSettings } from '../db/hooks.ts'
import { EVIDENCE_LEAD, phasePatterns } from './Evidence.helpers.ts'
import { REFERENCE_LEAD, VIEW_CHOICES, phaseScreen, programControls, type ProgramView } from './Program.helpers.ts'
import { Evidence } from './program/Evidence.tsx'
import { PhaseSessions } from './program/PhaseSessions.tsx'
import { Choice } from './program/parts.tsx'
import { Reference } from './program/Reference.tsx'

/**
 * The Program screen (`#/program`, PROMPT section 5, M6 brief section 1): the current phase's three
 * sessions as they run this week, read-only until a slot's Edit opens its cues and substitutions in
 * place; and program.md as reference, with a contents list, This phase kept mounted behind it so an
 * open editor survives the look; and the published studies behind the phase, its rules and its
 * patterns, for reading (Batch F). Edits are overrides laid over
 * program.md's slots (src/rules/overrides.ts); the seed is never written.
 */
export function Program() {
  const settings = useSettings()
  const overrides = useProgramOverrides()
  const added = useAddedSlots()
  const downPeriods = useDownPeriods()
  const today = useToday()
  const { mode } = useEngineMode()
  const [view, setView] = useState<ProgramView>('phase')

  if (settings === undefined || overrides === undefined || added === undefined || downPeriods === undefined) {
    return (
      <Screen title="Program" lead="Opening storage…">
        <p className="text-body text-on-dark-dim">The program loads from the phone.</p>
      </Screen>
    )
  }
  if (settings === null) {
    return (
      <Screen title="Program" lead="No settings yet.">
        <p className="text-body text-on-dark-dim">Open the app from Today once so it can set itself up, then come back.</p>
      </Screen>
    )
  }

  const screen = phaseScreen(settings, today, overrides, downPeriods, mode)
  const { canEdit } = programControls(mode)
  return (
    <Screen title="Program" lead={view === 'phase' ? screen.lead : view === 'reference' ? REFERENCE_LEAD : EVIDENCE_LEAD}>
      {/* Three choices don't fit one row at 390 px: Evidence takes the second row, full width. */}
      <div role="radiogroup" aria-label="Show" className="grid grid-cols-2 gap-2 [&>*:nth-child(3)]:col-span-2">
        {VIEW_CHOICES.map((choice) => (
          <Choice key={choice.value} label={choice.label} selected={view === choice.value} onSelect={() => setView(choice.value)} />
        ))}
      </div>
      {/* This phase stays mounted behind the reference, so an open editor and what it holds are there on the way back. */}
      <div hidden={view !== 'phase'}>
        <PhaseSessions screen={screen} overrides={overrides} added={added} today={today} canEdit={canEdit} />
      </div>
      {view === 'reference' ? <Reference /> : null}
      {view === 'evidence' ? <Evidence phase={settings.currentPhase} patterns={phasePatterns(settings)} /> : null}
    </Screen>
  )
}
