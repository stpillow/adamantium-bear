import { describe, expect, it } from 'vitest'
import appSource from '../App.tsx?raw'
import type { Location, Settings } from '../schema/index.ts'
import {
  BACKUP_MAX_BYTES,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLES,
  MIGRATIONS,
  OLDEST_SCHEMA_VERSION,
  backupFileName,
  backupFrom,
  backupText,
  buildBackup,
  daysSinceExport,
  exportDay,
  exportNudge,
  importStamp,
  loggedRange,
  lostOnImport,
  migrateForward,
  parseBackup,
  redFlagOnImport,
  settingsOnImport,
  sizeProblem,
  summarize,
  type Backup,
  type BackupTables,
  type StoredContents,
} from './backup.ts'

/*
 * Inline fixtures, not the live seed: these pin the file's shape and the import's checks, whatever
 * program.md holds. Every field of every table is in use somewhere below, M4b's and M5's included.
 */

const settings: Settings = {
  injuredSide: 'right',
  startDate: '2026-11-02',
  dumbbellMax: 75,
  restTimerSeconds: 90,
  painPerSet: true,
  currentPhase: 2,
  phaseEnteredWeek: 4,
  redFlag: { active: false, items: [], clearedOn: '2026-11-20', clearNote: 'PT checked it Nov 19: no block' },
  activeLocationId: 'loc-1',
  kit: ['ankle-strap'],
  lastExportedAt: '2026-11-20T23:00:00.000Z',
}

const home: Location = {
  id: 'planet-fitness',
  name: 'Planet Fitness',
  present: ['seated-leg-press', 'rower'],
  dumbbellMaxLb: 75,
  startedFrom: 'planet-fitness',
  listVersion: 1,
  extras: [],
  markedOff: [],
  createdOn: '2026-11-02',
  archived: false,
}
const hotel: Location = {
  id: 'loc-1',
  name: 'Marriott Downtown',
  present: ['flat-bench'],
  dumbbellMaxLb: 25,
  startedFrom: 'empty',
  listVersion: 1,
  extras: [{ id: 'x-1', text: 'kettlebells to 35', addedOn: '2026-11-10' }],
  markedOff: [{ id: 'flat-bench', on: '2026-11-12' }],
  createdOn: '2026-11-09',
  archived: false,
}
const oldHotel: Location = { ...hotel, id: 'loc-2', name: 'Airport Hilton', extras: [], markedOff: [], createdOn: '2026-11-11', archived: true }

function tables(): BackupTables {
  return {
    workouts: [
      { id: '2026-11-03-p1-a', date: '2026-11-03', templateId: 'p1-a', phase: 1, week: 1, isDeload: false, startedAt: '2026-11-03T11:00:00.000Z', finishedAt: '2026-11-03T12:00:00.000Z', maxPainDuring: 2, sessionRpe: 7, durationMinutes: 52, notes: 'Felt fine', status: 'finished' },
      { id: '2026-11-10-p1-a', date: '2026-11-10', templateId: 'p1-a', phase: 1, week: 2, isDeload: false, startedAt: '2026-11-10T11:00:00.000Z', status: 'in-progress', locationId: 'loc-1' },
    ],
    setLogs: [
      { id: '2026-11-03-p1-a:p1a-1:both:1', workoutId: '2026-11-03-p1-a', slotId: 'p1a-1', exerciseId: 'seated-leg-press', setNumber: 1, side: 'both', load: 90, loadUnit: 'lb', reps: 12, rpe: 7, painDuring: 2, stopped: false, loggedAt: '2026-11-03T11:10:00.000Z' },
      { id: '2026-11-03-p1-a:p1a-2:right:1', workoutId: '2026-11-03-p1-a', slotId: 'p1a-2', exerciseId: 'step-up', setNumber: 1, side: 'right', load: 10, loadUnit: 'lb', reps: 8, painDuring: 6, stopped: true, stopReason: 'sharp-joint-line-pain', heightIn: 6, loggedAt: '2026-11-03T11:20:00.000Z' },
      { id: '2026-11-10-p1-a:p1a-3:both:1', workoutId: '2026-11-10-p1-a', slotId: 'p1a-3', exerciseId: 'db-bench-press', setNumber: 1, side: 'both', load: 25, loadUnit: 'lb', reps: 10, rpe: 6, painDuring: 0, stopped: false, rackCapped: true },
      { id: '2026-11-10-p1-a:p1a-6:left:1', workoutId: '2026-11-10-p1-a', slotId: 'p1a-6', exerciseId: 'single-leg-balance', setNumber: 1, side: 'left', load: 0, loadUnit: 'none', seconds: 30, painDuring: 1, stopped: false, stage: 2 },
      { id: '2026-11-10-p1-a:p1a-7:both:1', workoutId: '2026-11-10-p1-a', slotId: 'p1a-7', exerciseId: 'leg-extension', setNumber: 1, side: 'both', load: 40, loadUnit: 'lb', reps: 12, painDuring: 1, stopped: false, rangeStopDeg: 45 },
    ],
    morningChecks: [
      { id: 'mc-2026-11-04', date: '2026-11-04', appliesTo: { kind: 'workout', id: '2026-11-03-p1-a' }, stiffnessUnder30Min: true, worseThanYesterday: false, visibleSwelling: false, warmth: false, painChangePoints: 0, redFlags: [] },
      { id: 'mc-2026-11-12', date: '2026-11-12', appliesTo: null, stiffnessUnder30Min: false, worseThanYesterday: true, visibleSwelling: false, warmth: true, painChangePoints: 2, redFlags: ['locking'], notes: 'Caught on the stairs “twice”\nthen fine' },
    ],
    runs: [
      { id: 'run-2026-11-02', date: '2026-11-02', type: 'mbr', miles: 3, minutes: 33, effort: 'easy', rpe: 3, avgHr: 150, maxHr: 171, maxPain: 1, strides: true, tempo: false, stravaUrl: 'https://www.strava.com/activities/1', notes: 'Windy' },
      { id: 'run-2026-11-11', date: '2026-11-11', type: 'rower-swap', miles: 0, minutes: 35, effort: 'moderate', maxPain: 1, strides: false, tempo: true, locationId: 'loc-1' },
    ],
    gateTests: [
      { id: 'gt-1', date: '2026-11-13', gate: 1, item: 'hop-single', valueInjured: 56, valueOther: 62, trialsInjured: [50, 56], trialsOther: [60, 62, 61], pass: true, manual: false, notes: 'Shoes on' },
      { id: 'gt-2', date: '2026-11-14', gate: 1, item: 'ortho-sign-off', valueInjured: 1, valueOther: 1, pass: true, manual: true },
    ],
    sessionMoves: [{ id: 'move-1', week: 2, dayA: 'fri', dayB: 'sun' }],
    locations: [home, hotel, oldHotel],
    programOverrides: [
      { slotId: 'p1a-1', cues: ['Feet high on the plate'], editedOn: '2026-11-16' },
      { slotId: 'p1a-2', substitutionIds: ['box-step-up', 'split-squat'], editedOn: '2026-11-17' },
      { slotId: 'p1b-1', cues: ['Slow down'], substitutionIds: [], editedOn: '2026-11-18' },
    ],
    addedSlots: [
      { id: 'added-a1', templateId: 'p1-a', exerciseId: 'db-bench-press', sets: 3, repsMin: 8, repsMax: 10, addedOn: '2026-11-18' },
      { id: 'added-a2', templateId: 'p1-b', exerciseId: 'wall-sit', sets: 2, repsMin: 30, repsMax: 45, addedOn: '2026-11-19' },
    ],
    hrSettings: [{ id: 'heart-rate', maxHr: 190, restingHr: 50 }],
  }
}

const stored = (over: Partial<StoredContents> = {}): StoredContents => ({ settings, ...tables(), ...over })
const EXPORTED_AT = '2026-11-21T14:05:00.000Z'
const built = () => buildBackup(stored(), EXPORTED_AT).backup
const fileText = (backup: unknown) => JSON.stringify(backup)
const without = <T extends object>(object: T, key: keyof T) => Object.fromEntries(Object.entries(object).filter(([k]) => k !== key))

describe('the export file', () => {
  it('names the app and version, carries every table in order, and leaves the phone’s own lastExportedAt out', () => {
    const { backup, unreadable } = buildBackup(stored(), EXPORTED_AT)
    expect(unreadable).toEqual([])
    expect(Object.keys(backup)).toEqual(['app', 'schemaVersion', 'exportedAt', 'settings', ...BACKUP_TABLES])
    expect(backup).toMatchObject({ app: 'knee-rebuild', schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: EXPORTED_AT })
    expect(backup.settings).toEqual(without(settings, 'lastExportedAt'))
    for (const name of BACKUP_TABLES) expect(backup[name], name).toHaveLength(tables()[name].length)
  })

  it('lists each table’s rows in key order, as the phone reads them, whatever order they came in', () => {
    const shuffled = stored({ setLogs: [...tables().setLogs].reverse(), locations: [oldHotel, home, hotel], programOverrides: [...tables().programOverrides].reverse() })
    const { backup } = buildBackup(shuffled, EXPORTED_AT)
    expect(backup.setLogs.map((s) => s.id)).toEqual(tables().setLogs.map((s) => s.id))
    expect(backup.locations.map((l) => l.id)).toEqual(['loc-1', 'loc-2', 'planet-fitness'])
    expect(backup.programOverrides.map((o) => o.slotId)).toEqual(['p1a-1', 'p1a-2', 'p1b-1'])
    expect(backupText(backup)).toBe(backupText(built()))
  })

  it('writes each row as the app stores it now: an M3 settings row gets the gym and bag defaults', () => {
    const { activeLocationId: _a, kit: _k, lastExportedAt: _l, ...m3 } = settings
    void [_a, _k, _l]
    const { backup } = buildBackup(stored({ settings: m3 as Settings }), EXPORTED_AT)
    expect(backup.settings).toMatchObject({ activeLocationId: 'planet-fitness', kit: ['ankle-strap', 'mini-band'] })
  })

  it('keeps a row that no longer reads as stored, as it is, and names it, rather than dropping it', () => {
    const bad = { ...tables().runs[0], maxPain: 11 } as BackupTables['runs'][number]
    const { backup, unreadable } = buildBackup(stored({ runs: [bad] }), EXPORTED_AT)
    expect(backup.runs).toEqual([bad])
    expect(unreadable).toEqual([expect.stringMatching(/^The run “run-2026-11-02” \(maxPain: .+\)\.$/)])
  })

  it('refuses, in words, a phone with no settings yet', () => {
    expect(() => buildBackup(stored({ settings: undefined }), EXPORTED_AT)).toThrow('There are no settings on this phone to export yet. Open Today once so the app can seed them.')
  })

  it('is two-space JSON with a final newline, named for the day it is written', () => {
    const text = backupText(built())
    expect(text.startsWith('{\n  "app": "knee-rebuild",\n  "schemaVersion": 7,\n  "exportedAt": "2026-11-21T14:05:00.000Z",\n')).toBe(true)
    expect(text.endsWith('}\n')).toBe(true)
    expect(backupFileName('2026-11-21')).toBe('knee-rebuild-2026-11-21.json')
  })
})

describe('reading a file back', () => {
  it('reads its own export back exactly', () => {
    const backup = built()
    const read = parseBackup(backupText(backup))
    expect(read).toEqual({ ok: true, backup, migratedFrom: null })
    if (read.ok) expect(backupText(read.backup)).toBe(backupText(backup))
  })

  it('refuses what isn’t a backup at all', () => {
    expect(parseBackup('{"app": "knee-rebuild", ')).toEqual({ ok: false, refusal: 'This file isn’t a Knee Rebuild backup: it doesn’t read as JSON. Nothing was imported.' })
    for (const text of ['[]', 'null', '"knee-rebuild"', '{"schemaVersion": 4}']) {
      expect(parseBackup(text), text).toEqual({ ok: false, refusal: 'This file isn’t a Knee Rebuild backup: it doesn’t name the app that wrote it. Nothing was imported.' })
    }
  })

  it('refuses another app’s file in words, without quoting what it calls itself', () => {
    const read = parseBackup(fileText({ ...built(), app: 'strong-app' }))
    expect(read).toEqual({ ok: false, refusal: 'This file is from another app, not Knee Rebuild. Nothing was imported.' })
  })

  it('refuses a newer schema version, saying how to get an app that reads it, in the update prompt’s own words', () => {
    expect(parseBackup(fileText({ ...built(), schemaVersion: 8 }))).toEqual({
      ok: false,
      refusal:
        'This backup is from a newer version of the app (schema version 8; this one reads up to 7). Open the app with a signal and tap Reload now when “A new version is ready” shows, then import it again. Nothing was imported.',
    })
    // The prompt the refusal sends Shawn to is the one the app shows (src/App.tsx): its sentence and its button.
    expect(appSource).toContain('<span>A new version is ready. It will not reload on its own.</span>')
    expect(appSource).toMatch(/>\s*Reload now\s*</)
  })

  it('refuses a missing or nonsense version, and one older than any backup', () => {
    const noVersion = 'This backup has no schema version, so the app can’t tell how to read it. Nothing was imported.'
    expect(parseBackup(fileText(without(built(), 'schemaVersion')))).toEqual({ ok: false, refusal: noVersion })
    for (const v of ['4', 3.5, 0, -1, null]) expect(parseBackup(fileText({ ...built(), schemaVersion: v })), String(v)).toEqual({ ok: false, refusal: noVersion })
    expect(parseBackup(fileText({ ...built(), schemaVersion: 1 }))).toEqual({
      ok: false,
      refusal: 'This backup says schema version 1, and no backup was ever written below version 2, so the app can’t read it. Nothing was imported.',
    })
  })

  it('refuses a part the app doesn’t keep, the phone’s own lastExportedAt and a settings key included', () => {
    expect(parseBackup(fileText({ ...built(), notes: 'hi' }))).toEqual({ ok: false, refusal: 'This backup has a part the app doesn’t keep, “notes”. Nothing was imported.' })
    expect(parseBackup('{"app":"knee-rebuild","schemaVersion":4,"__proto__":{"polluted":true}}')).toMatchObject({ ok: false, refusal: expect.stringContaining('“__proto__”') })
    const lastExport = parseBackup(fileText({ ...built(), settings: { ...built().settings, lastExportedAt: EXPORTED_AT } }))
    expect(lastExport).toMatchObject({ ok: false, refusal: expect.stringMatching(/^This backup’s settings don’t read as the app stores them \(.*lastExportedAt.*\)\. Nothing was imported\.$/) })
    expect(parseBackup(fileText({ ...built(), settings: { ...built().settings, id: 'settings' } }))).toMatchObject({ ok: false })
    expect(({}) as Record<string, unknown>).not.toHaveProperty('polluted')
  })

  it('refuses settings the Settings form would refuse: a start date that isn’t a Monday, a rest timer off its stepper', () => {
    const settingsWith = (over: Partial<Settings>) => parseBackup(fileText({ ...built(), settings: { ...built().settings, ...over } }))
    expect(settingsWith({ startDate: '2026-11-04' })).toEqual({
      ok: false,
      refusal: 'This backup’s settings don’t read as the app stores them (startDate: the start date is a Monday, the day weeks start). Nothing was imported.',
    })
    expect(settingsWith({ restTimerSeconds: 99999 })).toMatchObject({ ok: false, refusal: expect.stringMatching(/^This backup’s settings don’t read as the app stores them \(restTimerSeconds: .+\)\. Nothing was imported\.$/) })
    expect(settingsWith({ restTimerSeconds: 5 })).toMatchObject({ ok: false, refusal: expect.stringContaining('restTimerSeconds') })
    expect(settingsWith({ startDate: '2026-11-09', restTimerSeconds: 600 })).toMatchObject({ ok: true })
    expect(settingsWith({ restTimerSeconds: 15 })).toMatchObject({ ok: true })
  })

  it('refuses a file missing its date, its settings or a table, or with a table that isn’t a list', () => {
    expect(parseBackup(fileText({ ...built(), exportedAt: 'Nov 21' }))).toEqual({ ok: false, refusal: 'This backup doesn’t say when it was exported. Nothing was imported.' })
    expect(parseBackup(fileText(without(built(), 'settings')))).toEqual({ ok: false, refusal: 'This backup has no settings. Nothing was imported.' })
    expect(parseBackup(fileText(without(built(), 'runs')))).toEqual({ ok: false, refusal: 'This backup has no list of runs. Nothing was imported.' })
    expect(parseBackup(fileText({ ...built(), setLogs: {} }))).toEqual({ ok: false, refusal: 'This backup’s sets aren’t a list. Nothing was imported.' })
  })

  it('refuses the whole file for one row the app wouldn’t store, naming its table and row', () => {
    const backup = built()
    const setLogs = backup.setLogs.map((s, i) => (i === 2 ? { ...s, painDuring: 11 } : s))
    const read = parseBackup(fileText({ ...backup, setLogs }))
    expect(read).toMatchObject({ ok: false, refusal: expect.stringMatching(/^This backup’s sets, row 3, doesn’t read as the app stores it \(painDuring: .+\)\. Nothing was imported\.$/) })
    // Strict rows: a key the schema doesn't know, a link that isn't Strava's, an edit with nothing in it.
    expect(parseBackup(fileText({ ...backup, workouts: [{ ...backup.workouts[0], mood: 'good' }] }))).toMatchObject({ ok: false, refusal: expect.stringContaining('This backup’s sessions, row 1') })
    expect(parseBackup(fileText({ ...backup, runs: [{ ...backup.runs[0], stravaUrl: 'javascript:alert(1)' }] }))).toMatchObject({ ok: false, refusal: expect.stringContaining('This backup’s runs, row 1') })
    expect(parseBackup(fileText({ ...backup, programOverrides: [{ slotId: 'p1a-1', editedOn: '2026-11-16' }] }))).toMatchObject({ ok: false, refusal: expect.stringContaining('This backup’s Program edits, row 1') })
  })

  it('refuses two rows on one key, which would otherwise leave one of them silently', () => {
    const backup = built()
    const first = backup.workouts[0]
    expect(parseBackup(fileText({ ...backup, workouts: [first, { ...first, notes: 'again' }] }))).toEqual({
      ok: false,
      refusal: 'This backup lists the session “2026-11-03-p1-a” twice. Nothing was imported.',
    })
    const edit = backup.programOverrides[0]
    expect(parseBackup(fileText({ ...backup, programOverrides: [edit, edit] }))).toMatchObject({ ok: false, refusal: expect.stringContaining('the Program edit “p1a-1” twice') })
    const longId = `${'x'.repeat(60)}\u0007`
    const run = backup.runs[0]
    expect(parseBackup(fileText({ ...backup, runs: [{ ...run, id: longId }, { ...run, id: longId }] }))).toMatchObject({
      ok: false,
      refusal: `This backup lists the run “${'x'.repeat(40)}…” twice. Nothing was imported.`,
    })
  })

  it('quotes nothing from the file whole: a key it doesn’t keep is named cut short, with no control or format characters, however long', () => {
    const backup = built()
    const huge = `\u202E${'x'.repeat(20_000)}`
    const unsafe = /[\p{Cc}\p{Cf}]/u
    const refusals = [
      parseBackup(fileText({ ...backup, runs: [{ ...backup.runs[0], [huge]: 1 }] })),
      parseBackup(fileText({ ...backup, settings: { ...backup.settings, [huge]: 1 } })),
      parseBackup(fileText({ ...backup, settings: { ...backup.settings, redFlag: { ...backup.settings.redFlag, [huge]: 1 } } })),
      parseBackup(fileText({ ...backup, [huge]: 1 })),
      parseBackup(fileText({ ...backup, runs: [{ ...backup.runs[0], id: huge }, { ...backup.runs[0], id: huge }] })),
      parseBackup(fileText({ ...backup, workouts: [{ ...backup.workouts[0], ['\u0007bell\u0000']: 1 }] })),
    ].map((read) => (read.ok ? '' : read.refusal))
    for (const refusal of refusals) {
      expect(refusal.length, refusal.slice(0, 80)).toBeGreaterThan(0)
      expect(refusal.length, refusal.slice(0, 80)).toBeLessThan(200)
      expect(refusal, refusal.slice(0, 80)).not.toMatch(unsafe)
    }
    expect(refusals[0]).toBe(`This backup’s runs, row 1, doesn’t read as the app stores it (a part the app doesn’t keep, “${'x'.repeat(40)}…”). Nothing was imported.`)
    expect(refusals[2]).toBe(`This backup’s settings don’t read as the app stores them (redFlag: a part the app doesn’t keep, “${'x'.repeat(40)}…”). Nothing was imported.`)
    expect(refusals[5]).toBe('This backup’s sessions, row 1, doesn’t read as the app stores it (a part the app doesn’t keep, “ bell ”). Nothing was imported.')
    // Two keys it doesn't keep: the first is named, the rest counted.
    expect(parseBackup(fileText({ ...backup, workouts: [{ ...backup.workouts[0], mood: 1, weather: 2 }] }))).toEqual({
      ok: false,
      refusal: 'This backup’s sessions, row 1, doesn’t read as the app stores it (a part the app doesn’t keep, “mood”, and 1 more). Nothing was imported.',
    })
  })

  it('refuses a file past any size a backup comes near, before reading it', () => {
    expect(sizeProblem(BACKUP_MAX_BYTES)).toBeNull()
    expect(sizeProblem(12.34 * 1024 * 1024)).toBe('This file is 12.3 MB, past the 10 MB no backup of this app comes near, so it isn’t one. Nothing was imported.')
    expect(parseBackup(' '.repeat(BACKUP_MAX_BYTES + 1))).toEqual({ ok: false, refusal: sizeProblem(BACKUP_MAX_BYTES + 1) })
  })
})

describe('older files carried forward', () => {
  // Version 2 as the M3 phone stored it: settings from before gyms, no gyms list, no Program edits.
  const { activeLocationId: _a, kit: _k, lastExportedAt: _l, ...m3Settings } = settings
  void [_a, _k, _l]
  const v2 = () => {
    const t = tables()
    return {
      app: 'knee-rebuild',
      schemaVersion: 2,
      exportedAt: EXPORTED_AT,
      settings: m3Settings,
      workouts: t.workouts.map((w) => without(without(without(w, 'locationId'), 'sessionRpe'), 'durationMinutes')),
      setLogs: t.setLogs.map((s) => without(s, 'rackCapped')),
      morningChecks: t.morningChecks,
      runs: t.runs.map((r) => without(without(without(without(r, 'locationId'), 'rpe'), 'avgHr'), 'maxHr')),
      gateTests: t.gateTests,
      sessionMoves: t.sessionMoves,
    }
  }
  const v3 = () => ({ ...v2(), schemaVersion: 3, settings: without(settings, 'lastExportedAt'), workouts: tables().workouts.map((w) => without(without(w, 'sessionRpe'), 'durationMinutes')), locations: tables().locations })
  // Version 5 as the build before metrics phase 1 wrote it: every list, and runs and sessions without their RPE or minutes.
  const v5 = () => ({ ...v3(), schemaVersion: 5, programOverrides: tables().programOverrides, addedSlots: tables().addedSlots })
  // Version 6 as the build before metrics phase 2 wrote it: sessions with their RPE and minutes, runs with their RPE but no heart rate, and no heart-rate settings list.
  const v6 = () => ({ ...v5(), schemaVersion: 6, workouts: tables().workouts, runs: tables().runs.map((r) => without(without(r, 'avgHr'), 'maxHr')) })

  it('has a step for every version from the oldest up to this one', () => {
    for (let v = OLDEST_SCHEMA_VERSION; v < BACKUP_SCHEMA_VERSION; v++) expect(MIGRATIONS[v], `version ${v}`).toBeTypeOf('function')
  })

  it('version 2 gains an empty gyms list, version 3 an empty Program edits list, version 4 an empty added exercises list, version 5 nothing, version 6 an empty heart-rate settings list', () => {
    expect(MIGRATIONS[2]?.(v2())).toEqual({ ...v2(), schemaVersion: 3, locations: [] })
    expect(MIGRATIONS[3]?.(v3())).toEqual({ ...v3(), schemaVersion: 4, programOverrides: [] })
    expect(MIGRATIONS[4]?.({ ...v3(), schemaVersion: 4, programOverrides: [] })).toEqual({ ...v3(), schemaVersion: 5, programOverrides: [], addedSlots: [] })
    expect(MIGRATIONS[5]?.(v5())).toEqual({ ...v5(), schemaVersion: 6 })
    expect(MIGRATIONS[6]?.(v6())).toEqual({ ...v6(), schemaVersion: 7, hrSettings: [] })
  })

  it('a step leaves a list the file already has for the schema to judge', () => {
    expect(MIGRATIONS[2]?.({ ...v2(), locations: [home] })).toMatchObject({ locations: [home] })
    expect(parseBackup(fileText({ ...v2(), locations: [{ ...home, name: '' }] }))).toMatchObject({ ok: false, refusal: expect.stringContaining('This backup’s gyms, row 1') })
  })

  it('reads a version 2 file as this version’s, with the M4b defaults, and says what it came from', () => {
    const read = parseBackup(fileText(v2()))
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.migratedFrom).toBe(2)
    expect(read.backup.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    expect(read.backup.settings).toEqual({ ...m3Settings, activeLocationId: 'planet-fitness', kit: ['ankle-strap', 'mini-band'] })
    expect(read.backup.locations).toEqual([])
    expect(read.backup.programOverrides).toEqual([])
    expect(read.backup.addedSlots).toEqual([])
    expect(read.backup.setLogs).toEqual(v2().setLogs)
  })

  it('reads a version 3 file with its gyms and no edits', () => {
    const read = parseBackup(fileText(v3()))
    expect(read).toMatchObject({ ok: true, migratedFrom: 3, backup: { locations: tables().locations, programOverrides: [], addedSlots: [] } })
  })

  it('reads a version 5 file with runs keeping their effort words, and invents no RPE or minutes', () => {
    const read = parseBackup(fileText(v5()))
    expect(read).toMatchObject({ ok: true, migratedFrom: 5 })
    if (!read.ok) return
    expect(read.backup.runs.map((r) => [r.effort, r.rpe])).toEqual([
      ['easy', undefined],
      ['moderate', undefined],
    ])
    expect(read.backup.workouts.map((w) => [w.sessionRpe, w.durationMinutes])).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ])
  })

  it('reads a version 6 file with an empty heart-rate settings list, and invents no heart rate on its runs', () => {
    const read = parseBackup(fileText(v6()))
    expect(read).toMatchObject({ ok: true, migratedFrom: 6 })
    if (!read.ok) return
    expect(read.backup.hrSettings).toEqual([])
    expect(read.backup.runs.map((r) => [r.avgHr, r.maxHr])).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ])
    expect(read.backup.runs.map((r) => r.rpe)).toEqual([3, undefined])
  })

  it('a version with no step can’t be carried', () => {
    expect(() => migrateForward({ schemaVersion: 1 })).toThrow('no step carries a version 1 backup forward')
    expect(migrateForward({ schemaVersion: 7, a: 1 })).toEqual({ schemaVersion: 7, a: 1 })
  })
})

describe('what a file holds', () => {
  it('counts each table, the archived gyms, and the days logged', () => {
    expect(summarize(tables())).toEqual({
      counts: { workouts: 2, setLogs: 5, morningChecks: 2, runs: 2, gateTests: 2, sessionMoves: 1, locations: 3, programOverrides: 3, addedSlots: 2, hrSettings: 1 },
      archivedGyms: 1,
      first: '2026-11-02',
      last: '2026-11-14',
    })
  })

  it('has no days with nothing logged', () => {
    expect(loggedRange({ workouts: [], runs: [], morningChecks: [], gateTests: [] })).toEqual({ first: null, last: null })
  })

  it('names what an import would erase: rows on the phone the file doesn’t have, by key', () => {
    const file = tables()
    const phone = tables()
    phone.workouts.push({ ...phone.workouts[0]!, id: '2026-11-12-p1-b', date: '2026-11-12', templateId: 'p1-b' })
    phone.setLogs.push({ ...phone.setLogs[0]!, id: 'a' }, { ...phone.setLogs[0]!, id: 'b' })
    phone.programOverrides.push({ slotId: 'p1c-1', cues: ['New'], editedOn: '2026-11-21' })
    // A pre-phase-2 file has no heart-rate row, so an import from one erases the phone's: named as "1 heart rate setting" (the row holds both numbers; accepted wording, PROGRAM-QUESTIONS 150).
    file.hrSettings = []
    // A row on the same key that changed is replaced, not lost.
    phone.runs[0] = { ...phone.runs[0]!, notes: 'edited' }
    expect(lostOnImport(phone, file)).toEqual([
      { table: 'workouts', count: 1 },
      { table: 'setLogs', count: 2 },
      { table: 'programOverrides', count: 1 },
      { table: 'hrSettings', count: 1 },
    ])
    expect(lostOnImport(file, phone)).toEqual([])
  })
})

describe('the red flag through an import (PROGRAM-QUESTIONS 128)', () => {
  const off = { active: false, items: [] }
  const cleared = { active: false, items: [], clearedOn: '2026-11-20', clearNote: 'PT checked it Nov 19: no block' }
  const locking = { active: true, since: '2026-11-05', items: ['locking'] }

  it('never lifts a red flag the phone has on: an older file’s clear state leaves it on, as it was', () => {
    expect(redFlagOnImport(locking, off)).toEqual(locking)
    expect(redFlagOnImport(locking, cleared)).toEqual(locking)
  })

  it('with both on, the flags join, each once, the phone’s first, from the earlier day', () => {
    expect(redFlagOnImport(locking, { active: true, since: '2026-11-03', items: ['giving-way', 'locking'] })).toEqual({ active: true, since: '2026-11-03', items: ['locking', 'giving-way'] })
    expect(redFlagOnImport({ active: true, items: ['locking'] }, { active: true, since: '2026-11-07', items: ['numbness'] })).toEqual({ active: true, since: '2026-11-07', items: ['locking', 'numbness'] })
  })

  it('with the phone’s flag off, or no settings on the phone, the file’s state comes in whole, its last clear and note included', () => {
    expect(redFlagOnImport(cleared, locking)).toEqual(locking)
    expect(redFlagOnImport(off, cleared)).toEqual(cleared)
    expect(redFlagOnImport(undefined, locking)).toEqual(locking)
  })

  const fileSettings = without(settings, 'lastExportedAt') as Omit<Settings, 'lastExportedAt'>

  it('the confirm is told which flag the import keeps on, and nothing when the file has it on too', () => {
    expect(settingsOnImport({ ...settings, redFlag: locking }, fileSettings)).toEqual({ keptRedFlag: locking, changes: [] })
    expect(settingsOnImport({ ...settings, redFlag: locking }, { ...fileSettings, redFlag: locking })).toEqual({ keptRedFlag: null, changes: [] })
    expect(settingsOnImport({ ...settings, redFlag: { ...locking, items: ['locking', 'numbness'] } }, { ...fileSettings, redFlag: locking }).keptRedFlag).toEqual({ ...locking, items: ['locking', 'numbness'] })
    expect(settingsOnImport(settings, fileSettings)).toEqual({ keptRedFlag: null, changes: [] })
  })

  it('names each setting the file changes: the injured side, the start date, the phase and the week it was entered', () => {
    const file = { ...fileSettings, injuredSide: 'left' as const, startDate: '2026-11-09', currentPhase: 1, phaseEnteredWeek: 1, painPerSet: false }
    expect(settingsOnImport(settings, file).changes).toEqual([
      { field: 'injuredSide', phone: 'right', file: 'left' },
      { field: 'startDate', phone: '2026-11-02', file: '2026-11-09' },
      { field: 'currentPhase', phone: 2, file: 1 },
      { field: 'phaseEnteredWeek', phone: 4, file: 1 },
    ])
    expect(settingsOnImport(undefined, file)).toEqual({ keptRedFlag: null, changes: [] })
  })
})

describe('the export reminder', () => {
  it('reads the export’s day in America/New_York', () => {
    // 10:30 pm on Monday Nov 9 in New York is already Nov 10 in UTC.
    expect(exportDay('2026-11-10T03:30:00.000Z')).toBe('2026-11-09')
    expect(exportDay('2026-11-10T05:00:00.000Z')).toBe('2026-11-10')
    expect(exportDay('2026-11-09T22:30:00-05:00')).toBe('2026-11-09')
  })

  it('counts whole days since the last export, 0 the same day, null when never', () => {
    expect(daysSinceExport(undefined, '2026-11-20')).toBeNull()
    expect(daysSinceExport('2026-11-10T03:30:00.000Z', '2026-11-09')).toBe(0)
    expect(daysSinceExport('2026-11-10T03:30:00.000Z', '2026-11-18')).toBe(9)
    // An export stamped after today (a phone clock set ahead, then back) reads as today's.
    expect(daysSinceExport('2026-11-25T12:00:00.000Z', '2026-11-20')).toBe(0)
  })

  it('says so once the last export is more than 7 days old', () => {
    const at = '2026-11-10T15:00:00.000Z'
    expect(exportNudge(at, '2026-11-17', '2026-11-02')).toBeNull()
    expect(exportNudge(at, '2026-11-18', '2026-11-02')).toEqual({ kind: 'since-export', days: 8 })
    expect(exportNudge(at, '2026-11-19', null)).toEqual({ kind: 'since-export', days: 9 })
  })

  it('an import records the file’s stamp, or the import’s own moment when the file says it was written later (a clock set ahead, or a hand edit)', () => {
    const now = '2026-12-20T15:00:00.000Z'
    expect(importStamp('2026-11-21T14:05:00.000Z', now)).toBe('2026-11-21T14:05:00.000Z')
    expect(importStamp('2099-01-01T00:00:00Z', now)).toBe(now)
    expect(importStamp('2026-12-20T15:00:00.001Z', now)).toBe(now)
    expect(importStamp('2026-12-20T09:59:00-05:00', now)).toBe('2026-12-20T09:59:00-05:00')
    // So a file stamped decades ahead can't keep the reminder quiet: it shows once the import is a week old.
    expect(exportNudge(importStamp('2099-01-01T00:00:00Z', now), '2026-12-28', '2026-11-02')).toEqual({ kind: 'since-export', days: 8 })
  })

  it('an old stamp counts its days right, whatever its year', () => {
    expect(daysSinceExport('0001-01-01T12:00:00Z', '2026-11-02')).toBe(739_921)
  })

  it('never exported: counts from the first thing logged, and says nothing with nothing logged', () => {
    expect(exportNudge(undefined, '2026-11-20', null)).toBeNull()
    expect(exportNudge(undefined, '2026-11-09', '2026-11-02')).toBeNull()
    expect(exportNudge(undefined, '2026-11-10', '2026-11-02')).toEqual({ kind: 'never-exported', days: 8 })
  })
})

describe('the file type', () => {
  it('a built file satisfies the Backup type and backupFrom reads the object form too', () => {
    const backup: Backup = built()
    expect(backupFrom(JSON.parse(backupText(backup)))).toEqual({ ok: true, backup, migratedFrom: null })
  })
})
