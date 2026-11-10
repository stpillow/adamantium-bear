import { useEngineMode } from '../../app/mode.ts'
import { PROGRAM, availableAt } from '../../app/session.ts'
import { Choice, Note, Section } from '../../components/FormParts.tsx'
import { Stepper } from '../../components/Stepper.tsx'
import { Tap } from '../../components/Tap.tsx'
import { equipmentChecklist } from '../../rules/equipment.ts'
import type { EquipmentId, Location } from '../../schema/index.ts'
import { RACK_MAX, RACK_MIN, RACK_PRESETS, RACK_STEP, checklistSections, kitRows, rackChoiceWords, rackGridNote, rackNote, rackSaved } from '../LocationEditor.helpers.ts'

/*
 * The gym pieces the location editor and first run share (M-U1): the rack, the checklist of what a
 * gym has and the bag, so first run records a home gym exactly the way the editor does, never a
 * parallel form. Each is stateless: the editor saves each change, first run keeps it in its draft.
 */

const CHECKLIST = equipmentChecklist(PROGRAM.equipment, PROGRAM.exercises)
const BY_ID = new Map(PROGRAM.exercises.map((e) => [e.id, e]))

/** None, 25, 50, 60, 75, 80, or any rack by 5 lb on the stepper; a weight typed in between saves as the 5 lb below it (`rackValue`). */
export function RackPicker({ value, onChange: save }: { value: number; onChange: (lb: number) => void }) {
  const { mode } = useEngineMode()
  const onChange = (lb: number) => save(rackSaved(lb))
  return (
    <>
      <div role="radiogroup" aria-label="Heaviest dumbbell" className="grid grid-cols-3 gap-2">
        {RACK_PRESETS.map((lb) => (
          <Choice
            key={lb}
            compact
            label={rackChoiceWords(lb)}
            selected={value === lb}
            onSelect={() => {
              if (value !== lb) onChange(lb)
            }}
          />
        ))}
      </div>
      <Stepper label="Heaviest dumbbell" unit="lb" value={value} step={RACK_STEP} min={RACK_MIN} max={RACK_MAX} onChange={onChange} />
      <Note>{rackNote(value, mode)}</Note>
      <Note>{rackGridNote}</Note>
    </>
  )
}

/** The bag: the items program.md says to bring, each In the bag or not. */
export function KitList({ kit, onChange }: { kit: readonly EquipmentId[]; onChange: (id: EquipmentId, inBag: boolean) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {kitRows(PROGRAM.equipment, kit).map((row) => (
        <Tap key={row.id} label={row.name} value={row.inBag} yes="In the bag" no="Not in the bag" onChange={(inBag) => onChange(row.id, inBag)} />
      ))}
    </div>
  )
}

/**
 * What a gym has: the checklist, one section per program slot, each item Here or Not here with what
 * uses it and what stands in when it isn't there. `saved` and `problem` say, per section, what the
 * last change came to (the editor's), or nothing (first run's draft).
 */
export function EquipmentChecklist({
  location,
  kit,
  onToggle,
  saved = () => false,
  problem = () => null,
}: {
  location: Location
  kit: readonly EquipmentId[]
  onToggle: (group: string, itemId: EquipmentId, here: boolean) => void
  saved?: (group: string) => boolean
  problem?: (group: string) => string | null
}) {
  const available = availableAt({ location, kit })
  const { mode } = useEngineMode()
  const sections = checklistSections({ checklist: CHECKLIST, location, available, byId: BY_ID, vocabulary: PROGRAM.equipment, table: PROGRAM.substitutionTable, mode })
  return (
    <>
      {sections.map((s) => (
        <Section key={s.group} label={s.group} saved={saved(s.group)} problem={problem(s.group)}>
          {s.rows.map((row) => (
            <div key={row.id} className="flex flex-col gap-1">
              <Tap label={row.label} value={row.here} yes="Here" no="Not here" onChange={(here) => onToggle(s.group, row.id, here)} />
              {row.notes.map((line) => (
                <Note key={line}>{line}</Note>
              ))}
            </div>
          ))}
        </Section>
      ))}
    </>
  )
}
