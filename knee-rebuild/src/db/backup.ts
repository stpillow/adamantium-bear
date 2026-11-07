import { db } from './db.ts'
import { ensureLocations, forgetSwaps, getSettings, getSettingsRow, getStoredSettings, saveExportStamp, saveSettings, type HomeLists } from './repo.ts'
import { BACKUP_TABLES, backupFrom, buildBackup, importStamp, redFlagOnImport, type Backup, type ExportResult, type StoredContents } from '../rules/backup.ts'
import { Settings, type IsoDate, type IsoDateTime } from '../schema/index.ts'

/**
 * Export and import (M6 brief, section 2): read every table, and replace every table in one
 * transaction. What the file is, and whether one may be imported, is src/rules/backup.ts's call;
 * this file only moves rows.
 */

/** The settings row aside, every Dexie table is one the file carries; a table added to db.ts and not to the file stops both directions here, before anything is read or written. */
function checkCovered(): void {
  const carried = new Set<string>(['settings', ...BACKUP_TABLES])
  const missing = db.tables.map((t) => t.name).filter((name) => !carried.has(name))
  if (missing.length > 0) throw new Error(`The backup doesn’t carry the ${missing.join(', ')} table yet.`)
}

/** Everything the phone holds, read in one transaction so the file is one moment's data: the settings as stored, the export stamp read back in, and every table as stored. */
export async function readStored(): Promise<StoredContents> {
  checkCovered()
  return db.transaction('r', db.tables, async () => {
    return {
      settings: await getStoredSettings(),
      workouts: await db.workouts.toArray(),
      setLogs: await db.setLogs.toArray(),
      morningChecks: await db.morningChecks.toArray(),
      runs: await db.runs.toArray(),
      gateTests: await db.gateTests.toArray(),
      sessionMoves: await db.sessionMoves.toArray(),
      locations: await db.locations.toArray(),
      programOverrides: await db.programOverrides.toArray(),
      addedSlots: await db.addedSlots.toArray(),
      hrSettings: await db.hrSettings.toArray(),
    }
  })
}

/** The file for what the phone holds now, stamped `exportedAt` (src/rules/backup.ts `buildBackup`). */
export async function exportBackup(exportedAt: IsoDateTime): Promise<ExportResult> {
  return buildBackup(await readStored(), exportedAt)
}

/**
 * Records that the file stamped `exportedAt` left the phone: Settings' "Last export" and Today's
 * reminder read it. The stamp goes in its own row; the settings row is written again only to take
 * out a stamp an earlier M6 build left on it (PROGRAM-QUESTIONS 132).
 */
export async function markExported(exportedAt: IsoDateTime): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const settings = await getSettings()
    if (!settings) throw new Error('no settings row to record the export on')
    const row = await getSettingsRow()
    if (row && 'lastExportedAt' in row) await saveSettings(settings)
    await saveExportStamp(exportedAt)
  })
}

/**
 * Replaces everything on the phone with a backup read by `parseBackup`, all or nothing: the file is
 * read through the rules once more before the transaction opens, then every table is cleared and
 * written in one transaction, so a refusal or a failed write leaves the phone as it was. The
 * settings come from the file with `lastExportedAt` set to the file's `exportedAt` (the phone now
 * holds what that file holds), or to `now`, the import's own moment, when the file's is later
 * (`importStamp`); except a red flag the phone has on, which stays on until Settings
 * clears it with a note (`redFlagOnImport`, PROGRAM-QUESTIONS 128); a file with no home gym gets
 * one through `ensureLocations`, the launch path, from its own settings. The runner's stored swaps
 * go, as on Reset.
 */
export async function replaceAll(backup: Backup, lists: HomeLists, createdOn: IsoDate, now: IsoDateTime = new Date().toISOString()): Promise<void> {
  checkCovered()
  const read = backupFrom(backup)
  if (!read.ok) throw new Error(read.refusal)
  const file = read.backup
  await db.transaction('rw', db.tables, async () => {
    // The phone's red flag, read as stored: a settings row that no longer reads whole still gives its flag, and never blocks a restore.
    const flag = Settings.shape.redFlag.safeParse((await getSettingsRow())?.redFlag)
    const settings = Settings.parse({ ...file.settings, redFlag: redFlagOnImport(flag.success ? flag.data : undefined, file.settings.redFlag) })
    for (const table of db.tables) await table.clear()
    await saveSettings(settings)
    await saveExportStamp(importStamp(file.exportedAt, now))
    for (const name of BACKUP_TABLES) await db.table(name).bulkAdd(file[name])
    await ensureLocations(lists, createdOn)
  })
  forgetSwaps()
}
