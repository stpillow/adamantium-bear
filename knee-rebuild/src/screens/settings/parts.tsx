import { useId, useState, type ChangeEvent } from 'react'
import { PROGRAM } from '../../app/session.ts'
import { Button } from '../../components/Button.tsx'
import { Note, Section } from '../../components/FormParts.tsx'
import { phoneTimeZoneRows, readStored } from '../../db/backup.ts'
import { downPeriodsOnImport, lostOnImport, parseBackup, settingsOnImport, sizeProblem, summarize, timeZoneImportChange, timeZoneOnImport, type Backup, type BackupSummary, type BackupTable } from '../../rules/backup.ts'
import type { IsoDate } from '../../schema/index.ts'
import {
  IMPORT_CONFIRM,
  checkStartDate,
  dateWords,
  errorWords,
  exportedOnWords,
  holdsLine,
  importedWords,
  keptDownPeriodWords,
  lostWords,
  migratedWords,
  settingsOnImportWords,
  timeZoneImportWords,
} from '../Settings.helpers.ts'

/*
 * The Settings pieces first run shares (M-U1): the start-date picker and the import. Neither reads
 * the clock or the zone itself: today and the zone are handed in, since first run counts in the zone
 * its draft proposes and Settings in the stored one.
 */

/** A link or file picker that looks and taps like a secondary Button: 44 px, a word on it. */
export const LINK_BUTTON = 'tap flex w-full items-center justify-center rounded-sm border border-on-dark-faint bg-navy-lift px-6 py-3 text-center font-sans text-body font-medium text-on-dark wrap-anywhere'

/**
 * A date input that only lets a Monday through: any other day (or none) is refused in words, with
 * the nearest Mondays a tap away. Stateless: the value is the input's text as typed.
 */
export function StartDatePicker({ value, onChange, disabled = false, label = 'Week 1 starts on a Monday' }: { value: string; onChange: (value: string) => void; disabled?: boolean; label?: string }) {
  const id = useId()
  const check = checkStartDate(value)
  return (
    <>
      <label htmlFor={id} className="text-body text-on-dark-dim">
        {label}
      </label>
      <input id={id} type="date" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="tap w-full rounded-sm bg-ink px-3 text-body text-on-dark disabled:opacity-50" />
      {check.ok ? null : (
        <>
          <p role="alert" className="text-body text-on-dark">
            {check.message}
          </p>
          {check.mondays.map((monday) => (
            <Button key={monday} wide disabled={disabled} onClick={() => onChange(monday)}>
              Use {dateWords(monday)}
            </Button>
          ))}
        </>
      )}
    </>
  )
}

/** A file read and accepted by the rules, waiting on the inline confirm. */
interface PendingImport {
  name: string
  backup: Backup
  migratedFrom: number | null
  file: BackupSummary
  phone: BackupSummary
  lost: { table: BackupTable; count: number }[]
  /** What the import does to the settings, in words: the red flag it keeps on, and the settings the file changes. */
  settings: ReturnType<typeof settingsOnImportWords>
  /** The down period standing on this phone that the import keeps (PROGRAM-QUESTIONS 189), in words; null when none. */
  keptDownPeriod: string | null
  /** What the import does to the time zone (PROGRAM-QUESTIONS 206), in words; null when nothing. */
  timeZone: string | null
}

/**
 * Import (M6 brief, section 2): a file picker for `.json`. The whole file is read by the rules
 * before anything is touched; a refusal says why in words. An accepted file shows what it holds,
 * what this phone holds now and what the file lacks, then an inline confirm; Yes replaces every
 * table in one transaction, all or nothing, and says it did here, where Yes was tapped (the top of
 * the screen is a long scroll away). On first run's first screen (`firstRun`) the phone holds
 * nothing, so the confirm says only what the file brings and the zone dates will be counted in;
 * `onReplace` gets the sentence a finished import says, for the screen that comes next.
 */
export function ImportSection({
  today,
  timeZone,
  held,
  onReplace,
  firstRun = false,
}: {
  today: IsoDate
  timeZone: string
  held: string | null
  onReplace: (backup: Backup, done: string) => Promise<void>
  firstRun?: boolean
}) {
  const inputId = useId()
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [step, setStep] = useState<'idle' | 'reading' | 'writing'>('idle')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [imported, setImported] = useState<string | null>(null)

  async function choose(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = event.currentTarget
    const picked = input.files?.[0]
    // Cleared at once, so picking the same file again reads it again.
    input.value = ''
    if (!picked) return
    setPending(null)
    setRefusal(null)
    setImported(null)
    const size = sizeProblem(picked.size)
    if (size) {
      setRefusal(size)
      return
    }
    setStep('reading')
    try {
      const read = parseBackup(await picked.text())
      if (!read.ok) {
        setRefusal(read.refusal)
        return
      }
      const phone = await readStored()
      const phoneZone = await phoneTimeZoneRows()
      setPending({
        name: picked.name,
        backup: read.backup,
        migratedFrom: read.migratedFrom,
        file: summarize(read.backup),
        phone: summarize(phone),
        // A standing down period stays (downPeriodsOnImport), and so does the phone's zone when the file has none it can use: neither is named among what the import erases.
        lost: lostOnImport(phone, {
          ...read.backup,
          downPeriods: downPeriodsOnImport(phone.downPeriods, read.backup.downPeriods, today),
          timeZoneSettings: timeZoneOnImport(phoneZone, read.backup.timeZoneSettings),
        }),
        settings: settingsOnImportWords(settingsOnImport(phone.settings, read.backup.settings), PROGRAM.redFlags, PROGRAM.phases),
        keptDownPeriod: keptDownPeriodWords(phone.downPeriods, read.backup.downPeriods, today),
        timeZone: timeZoneImportWords(timeZoneImportChange(phoneZone, read.backup.timeZoneSettings), firstRun),
      })
    } catch (e) {
      setRefusal(`The file couldn’t be read (${errorWords(e)}). Nothing was imported.`)
    } finally {
      setStep('idle')
    }
  }

  async function replace(file: PendingImport): Promise<void> {
    setStep('writing')
    setRefusal(null)
    const done = importedWords(file.name, file.file)
    try {
      await onReplace(file.backup, done)
      setPending(null)
      setImported(done)
    } catch (e) {
      setRefusal(`Nothing was imported (${errorWords(e)}); this phone still holds what it held.`)
    } finally {
      setStep('idle')
    }
  }

  return (
    <Section label="Import" saved={false} problem={null} held={held}>
      <Note>A file from Export JSON. Importing replaces everything on this phone with what the file holds; nothing is merged.</Note>
      <label htmlFor={inputId} aria-disabled={step !== 'idle' || held !== null} className={`${LINK_BUTTON} ${step === 'idle' && held === null ? '' : 'pointer-events-none opacity-50'}`}>
        {step === 'reading' ? 'Reading the file…' : 'Choose a backup file'}
      </label>
      <input id={inputId} type="file" accept=".json,application/json" disabled={step !== 'idle' || held !== null} onChange={(e) => void choose(e)} className="sr-only" />
      {/* A refusal can quote a key from the file, cut to 40 characters but unbroken: it wraps anywhere, like the lines beside it. */}
      {refusal ? (
        <p role="alert" className="text-body text-on-dark wrap-anywhere">
          {refusal}
        </p>
      ) : null}
      {imported ? (
        <p role="status" className="text-body text-on-dark wrap-anywhere">
          {imported}
        </p>
      ) : null}
      {pending ? (
        <div className="flex flex-col gap-3">
          <p className="text-body text-on-dark wrap-anywhere">
            {pending.name}, exported {exportedOnWords(pending.backup.exportedAt, today, timeZone)}: {holdsLine(pending.file)}
          </p>
          {migratedWords(pending.migratedFrom) ? <Note>{migratedWords(pending.migratedFrom)}</Note> : null}
          {firstRun ? null : <p className="text-body text-on-dark-dim">This phone now: {holdsLine(pending.phone)}</p>}
          {lostWords(pending.lost) ? <p className="text-body text-on-dark">{lostWords(pending.lost)}</p> : null}
          {pending.settings.changes.map((line) => (
            <p key={line} className="text-body text-on-dark wrap-anywhere">
              {line}
            </p>
          ))}
          {pending.settings.redFlag ? <p className="text-body text-on-dark wrap-anywhere">{pending.settings.redFlag}</p> : null}
          {pending.keptDownPeriod ? <p className="text-body text-on-dark wrap-anywhere">{pending.keptDownPeriod}</p> : null}
          {pending.timeZone ? <p className="text-body text-on-dark wrap-anywhere">{pending.timeZone}</p> : null}
          <p className="text-lead font-medium text-on-dark">{IMPORT_CONFIRM}</p>
          <Button wide disabled={step === 'writing' || held !== null} onClick={() => void replace(pending)}>
            {step === 'writing' ? 'Replacing…' : 'Yes, replace everything'}
          </Button>
          <Button variant="quiet" wide disabled={step === 'writing'} onClick={() => setPending(null)}>
            Keep what’s here
          </Button>
        </div>
      ) : null}
    </Section>
  )
}
