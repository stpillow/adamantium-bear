import Dexie, { type EntityTable, type Table } from 'dexie'
import type { AddedSlot, GateTest, HrSettings, IsoDateTime, Location, MorningCheck, ProgramOverride, Run, SessionMove, SetLog, Settings, Workout } from '../schema/index.ts'

/**
 * The settings row, keyed so there is exactly one. It never holds `lastExportedAt`: the build
 * before M6 parses this row strictly on every settings read, so a key it doesn't know would leave
 * it unable to open the app after a rollback (PROGRAM-QUESTIONS 132). An earlier M6 build did
 * write the key here; `getSettings` still reads it, and the next write takes it out.
 */
export type SettingsRow = Omit<Settings, 'lastExportedAt'> & { id: 'settings' }

/** When this phone last wrote a backup file (`Settings.lastExportedAt`, M6), in a row of its own in the settings table, which no older build reads. */
export interface ExportStampRow {
  id: 'last-export'
  at: IsoDateTime
}

/**
 * The app's one IndexedDB database. Schema versions are declared here and only here.
 * Version 1 (M0) was empty; version 2 (M3) adds the log tables; version 3 (M4b) adds the gyms,
 * with no upgrade callback, so no version 2 row is rewritten (the home gym is written at launch by
 * `ensureLocations`); version 4 (M6) adds the Program screen's edits, one row per edited slot, keyed
 * by its id, again with no upgrade callback, so no version 3 row is rewritten; version 5 adds the exercises
 * Shawn adds to a session, one row each, again with no upgrade callback; version 6 (metrics phase 1)
 * adds nothing to the store: runs may carry an RPE and workouts a session RPE and minutes, all
 * optional and unindexed, and the bump keeps the backup's schema version in step with this one
 * (src/db/backup.test.ts); version 7 (metrics phase 2) adds the one-row hrSettings table for
 * Shawn's max and resting heart rate, again with no upgrade callback — the numbers live outside
 * the settings row so older builds still read that row untouched (PROGRAM-QUESTIONS 132, 150) —
 * and runs may carry an average and max heart rate, optional and unindexed. Never edit a shipped
 * version; add the next one, and keep every change additive.
 */
export class KneeRebuildDb extends Dexie {
  /** The settings row and, once this phone has exported, the export stamp's row. */
  settings!: Table<SettingsRow | ExportStampRow, SettingsRow['id'] | ExportStampRow['id']>
  workouts!: EntityTable<Workout, 'id'>
  setLogs!: EntityTable<SetLog, 'id'>
  morningChecks!: EntityTable<MorningCheck, 'id'>
  runs!: EntityTable<Run, 'id'>
  gateTests!: EntityTable<GateTest, 'id'>
  sessionMoves!: EntityTable<SessionMove, 'id'>
  locations!: EntityTable<Location, 'id'>
  programOverrides!: EntityTable<ProgramOverride, 'slotId'>
  addedSlots!: EntityTable<AddedSlot, 'id'>
  /** The one heart-rate settings row (metrics phase 2): outside the settings table's strict row, so a rollback still opens (PROGRAM-QUESTIONS 150). */
  hrSettings!: EntityTable<HrSettings, 'id'>

  constructor() {
    super('knee-rebuild')
    this.version(1).stores({})
    this.version(2).stores({
      settings: 'id',
      workouts: 'id, date, status, templateId',
      setLogs: 'id, workoutId, exerciseId, [workoutId+slotId]',
      morningChecks: 'id, date',
      runs: 'id, date',
      gateTests: 'id, date, [gate+item]',
      sessionMoves: 'id, week',
    })
    this.version(3).stores({ locations: 'id' })
    this.version(4).stores({ programOverrides: 'slotId' })
    this.version(5).stores({ addedSlots: 'id, templateId' })
    this.version(6).stores({})
    this.version(7).stores({ hrSettings: 'id' })
  }
}

export const db = new KneeRebuildDb()
