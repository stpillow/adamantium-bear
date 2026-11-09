import { useState } from 'react'
import { navigate } from '../app/router.ts'
import { PROGRAM, availableAt } from '../app/session.ts'
import { Button } from '../components/Button.tsx'
import { Screen } from '../components/Screen.tsx'
import { useActiveLocation, useLocations, useSettings } from '../db/hooks.ts'
import { archiveLocation, setActiveLocation } from '../db/repo.ts'
import { equipmentChecklist } from '../rules/equipment.ts'
import { locationOrHome } from '../rules/locations.ts'
import { PLANET_FITNESS_LOCATION_ID } from '../schema/index.ts'
import { archiveAsk, archivedWords, failedWords, locationRows, type LocationRow } from './Locations.helpers.ts'

const TITLE = 'Where you train'
const LEAD = 'Each gym’s list decides what a session runs there. Today plans at the active one until you change it.'
const CHECKLIST = equipmentChecklist(PROGRAM.equipment, PROGRAM.exercises)

/**
 * Every gym the lists offer (`#/locations`, from More): its name, "Active" on the active one, its
 * rack and how much of the checklist it lacks; New, Use here, Edit and Archive (two inline taps;
 * no delete). Archiving the active gym returns to the home gym and says so.
 */
export function Locations() {
  const locations = useLocations()
  const settings = useSettings()
  const active = useActiveLocation()
  const [armed, setArmed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  if (locations === undefined || settings === undefined || active === undefined) {
    return (
      <Screen title={TITLE} lead="Opening storage…">
        <p className="text-body text-on-dark-dim">The gyms load from the phone.</p>
      </Screen>
    )
  }
  if (settings === null || active === null) {
    return (
      <Screen title={TITLE} lead="This phone isn’t set up yet.">
        <Button wide onClick={() => navigate({ name: 'welcome' })}>
          Set up
        </Button>
      </Screen>
    )
  }

  const rows = locationRows(locations, active.id, CHECKLIST, (location) => availableAt({ location, kit: settings.kit }))
  const homeName = locationOrHome(locations, PLANET_FITNESS_LOCATION_ID)?.name ?? 'the home gym'

  const use = async (row: LocationRow) => {
    setBusy(true)
    setProblem(null)
    setNotice(null)
    try {
      await setActiveLocation(row.id)
      setNotice(`${row.name} is active. Today plans there until you change it.`)
    } catch (e: unknown) {
      setProblem(failedWords('The switch', e, `Today still plans at ${active.name}.`))
    } finally {
      setBusy(false)
    }
  }

  const archive = async (row: LocationRow) => {
    setBusy(true)
    setProblem(null)
    setNotice(null)
    try {
      const { activeMovedHome } = await archiveLocation(row.id)
      setArmed(null)
      setNotice(archivedWords(row.name, activeMovedHome, homeName))
    } catch (e: unknown) {
      setProblem(failedWords('Archiving', e, `${row.name} is still listed.`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen title={TITLE} lead={LEAD}>
      {notice ? (
        <p role="status" className="text-body text-on-dark wrap-anywhere">
          {notice}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="text-body text-on-dark wrap-anywhere">
          {problem}
        </p>
      ) : null}

      <Button variant="primary" wide onClick={() => navigate({ name: 'new-location' })}>
        New location
      </Button>

      <ul aria-label="Gyms" className="flex flex-col gap-6">
        {rows.map((row) => (
          <li key={row.id} aria-label={row.name} className="flex flex-col gap-3 border-t border-on-dark-faint pt-4">
            <div className="flex items-baseline justify-between gap-4">
              {/* A name runs to 60 characters, one word at worst: it wraps in its own box, and the mark keeps its line. */}
              <h2 className="min-w-0 text-lead font-medium text-on-dark wrap-anywhere">{row.name}</h2>
              {row.active ? <span className="shrink-0 whitespace-nowrap font-mono text-small uppercase tracking-[0.22em] text-green-bright">✓ Active</span> : null}
            </div>
            <p className="text-body text-on-dark-dim">{row.summary}</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => navigate({ name: 'location', locationId: row.id })}>Edit</Button>
              {row.active ? null : (
                <Button disabled={busy} onClick={() => void use(row)}>
                  Use here
                </Button>
              )}
              {row.archivable && armed !== row.id ? (
                <Button variant="quiet" disabled={busy} onClick={() => setArmed(row.id)}>
                  Archive
                </Button>
              ) : null}
            </div>
            {armed === row.id ? (
              <div className="flex flex-col gap-2">
                <p className="text-body text-on-dark wrap-anywhere">{archiveAsk(row.name)}</p>
                <Button wide className="wrap-anywhere" disabled={busy} onClick={() => void archive(row)}>
                  Yes, archive {row.name}
                </Button>
                <Button variant="quiet" wide disabled={busy} onClick={() => setArmed(null)}>
                  Keep it
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Screen>
  )
}
