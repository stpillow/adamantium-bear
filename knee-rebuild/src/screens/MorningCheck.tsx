import { useState, type ReactNode } from 'react'
import { checkLink } from '../rules/morningLink.ts'
import { navigate } from '../app/router.ts'
import { PROGRAM, planSession, type Gym } from '../app/session.ts'
import { useToday } from '../app/today.ts'
import { Button } from '../components/Button.tsx'
import { ReadingWord, readingSentence } from '../components/ReadingWord.tsx'
import { Screen } from '../components/Screen.tsx'
import { Stepper } from '../components/Stepper.tsx'
import { Tap } from '../components/Tap.tsx'
import { useActiveLocation, useHistory, useSettings } from '../db/hooks.ts'
import { addLateMorningCheck, addMorningCheck, saveSettings, type History } from '../db/repo.ts'
import { addDays, isDeloadWeek, sessionDateInWeek } from '../rules/calendar.ts'
import { lateCheckFor, lateCheckReach, type LateCheckOffer } from '../rules/lateCheck.ts'
import { morningReading } from '../rules/reading.ts'
import { lateFlagNote, stopMessage } from '../rules/redFlags.ts'
import { MORNING_TAGS, type IsoDate, type Location, type MorningCheck as CheckRecord, type Settings } from '../schema/index.ts'
import {
  LATE_FLAG_INTRO,
  LATE_FORM_LINE,
  TAG_INTRO,
  TAG_LABELS,
  buildCheck,
  buildLateCheck,
  type CheckForm,
  type CheckSubject,
  dateWords,
  emptyForm,
  errorWords,
  type ExerciseSentence,
  exerciseSentences,
  formFromCheck,
  formWords,
  lateFlagWords,
  lateReachWords,
  lateRefusalWords,
  lateSubjectWords,
  nextTemplateFor,
  nextWeekFor,
  PAIN_CHANGE_MAX,
  PAIN_CHANGE_MIN,
  reachLiftDates,
  sessionName,
  settingsAfter,
  subjectFor,
  subjectWords,
  tagSectionLabel,
  toggleFlag,
  withCheck,
} from './MorningCheck.helpers.ts'

const TITLE = 'Morning check'

/** What a save produced: the record, the settings after it, and the history with it in, for the engine. */
interface Saved {
  check: CheckRecord
  subject: CheckSubject | null
  settings: Settings
  history: History
}

/** What a past morning's save produced (Batch D): the record, its subject, and what it changed in words. */
interface LateSaved {
  check: CheckRecord
  sessionDay: IsoDate
  changes: string[]
}

/**
 * The morning after a session: four taps, a pain change, the red-flag checklist, six optional tags
 * and a note. Saving shows the knee's reading in words and, for yesterday's lift, what changes next
 * time. With `date` before today (Batch D), the same form for that past morning: offered only while
 * lateCheckFor allows it, saved only when that morning has no check, its red flags a note, never the
 * stop. Every decision here comes from src/rules; this screen renders and collects input.
 */
export function MorningCheck({ date }: { date?: string } = {}) {
  const today = useToday()
  const settings = useSettings()
  const history = useHistory()
  // The next session is planned at the gym Today plans for (M4b).
  const activeLocation = useActiveLocation()
  const [saved, setSaved] = useState<Saved | null>(null)
  const [lateSaved, setLateSaved] = useState<LateSaved | null>(null)
  const [view, setView] = useState<'form' | 'result'>('form')

  if (settings === undefined || history === undefined || activeLocation === undefined || (settings !== null && activeLocation === null)) {
    return (
      <Screen title={TITLE} lead="Opening storage…">
        <p className="text-body text-on-dark-dim">Yesterday's session and the red-flag state load from the phone.</p>
      </Screen>
    )
  }
  if (settings === null || activeLocation === null) {
    return (
      <Screen title={TITLE} lead="This phone isn’t set up yet.">
        <Button wide onClick={() => navigate({ name: 'welcome' })}>
          Set up
        </Button>
      </Screen>
    )
  }

  // The result stays first: the live history refreshes after a save, and a past morning's offer
  // then reads "already saved"; the screen must not remount to that refusal.
  if (view === 'result' && lateSaved) return <LateResult saved={lateSaved} />
  if (view === 'result' && saved) {
    return <Result saved={saved} location={activeLocation} onChange={() => setView('form')} />
  }

  if (date !== undefined && date !== today) {
    return (
      <LateCheckScreen
        morning={date}
        today={today}
        settings={settings}
        history={history}
        onSaved={(result) => {
          setLateSaved(result)
          setView('result')
        }}
      />
    )
  }

  const yesterday = addDays(today, -1)
  const subject = subjectFor(history.workouts, history.runs, yesterday)
  const existing = saved?.check ?? history.morningChecks.find((c) => c.date === today) ?? null
  // No key on the form: the live history refreshes the moment its own first write lands, and a
  // remount then would wipe the form and the sentence about a second write (the red-flag state)
  // that failed. The form reads `initial` once, on mount, so it keeps its state across that refresh.
  return (
    <CheckFormScreen
      initial={existing}
      today={today}
      yesterday={yesterday}
      subject={subject}
      settings={settings}
      history={history}
      onSaved={(result) => {
        setSaved(result)
        setView('result')
      }}
    />
  )
}

/** A short mono label over a group, the way the components label their own states. */
function Label({ children }: { children: ReactNode }) {
  return <h2 className="font-mono text-small font-normal uppercase tracking-[0.22em] text-on-dark-muted">{children}</h2>
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <Label>{label}</Label>
      {children}
    </section>
  )
}

function CheckFormScreen({
  initial,
  today,
  yesterday,
  subject,
  settings,
  history,
  onSaved,
}: {
  initial: CheckRecord | null
  today: IsoDate
  yesterday: IsoDate
  subject: CheckSubject | null
  settings: Settings
  history: History
  onSaved: (saved: Saved) => void
}) {
  const [form, setForm] = useState<CheckForm>(() => (initial ? formFromCheck(initial) : emptyForm()))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const existingReading = initial ? morningReading(initial) : null

  async function save() {
    const check = buildCheck({ today, link: checkLink(history.workouts, history.runs, yesterday), form, catalog: PROGRAM.redFlags })
    const next = settingsAfter(settings, check)
    setSaving(true)
    setError(null)
    try {
      await addMorningCheck(check)
    } catch (e) {
      setError(`The check did not save (${errorWords(e)}). Nothing was written; tap Save again.`)
      setSaving(false)
      return
    }
    if (next !== settings) {
      try {
        await saveSettings(next)
      } catch (e) {
        setError(`The check saved, but the red-flag state did not (${errorWords(e)}). Tap Save again to retry.`)
        setSaving(false)
        return
      }
    }
    setSaving(false)
    onSaved({ check, subject, settings: next, history: withCheck(history, check) })
  }

  return (
    <Screen title={TITLE} lead={subjectWords(subject, yesterday, PROGRAM.templates)}>
      {initial && existingReading ? (
        <p className="flex flex-wrap items-center gap-2 text-small text-on-dark-dim">
          <span>Already checked in this morning:</span>
          <ReadingWord result={existingReading.result} />
          <span>Saving again replaces it.</span>
        </p>
      ) : null}

      <CheckFields form={form} setForm={setForm} late={false} />

      {error ? (
        <p role="alert" className="text-body text-on-dark">
          {error}
        </p>
      ) : null}
      <Button variant="primary" wide disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save check'}
      </Button>
    </Screen>
  )
}

/** The form's fields, shared by this morning's check and a past morning's: only the words differ. */
function CheckFields({ form, setForm, late }: { form: CheckForm; setForm: (update: (f: CheckForm) => CheckForm) => void; late: boolean }) {
  const noteId = 'morning-check-note'
  const set = <K extends keyof CheckForm>(key: K) => (value: CheckForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const words = formWords(late)
  return (
    <>
      <Section label={late ? 'Knee that morning' : 'Knee this morning'}>
        <Tap label="Stiffness gone within 30 minutes" value={form.stiffnessUnder30Min} onChange={set('stiffnessUnder30Min')} />
        <Tap label={words.worse} value={form.worseThanYesterday} onChange={set('worseThanYesterday')} />
        <Tap label="Visible swelling" value={form.visibleSwelling} onChange={set('visibleSwelling')} />
        <Tap label="Warmth" value={form.warmth} onChange={set('warmth')} />
      </Section>

      <Section label="Pain">
        <Stepper label={words.painLabel} unit="points" value={form.painChangePoints} onChange={set('painChangePoints')} min={PAIN_CHANGE_MIN} max={PAIN_CHANGE_MAX} />
        <p className="text-small text-on-dark-muted">{words.painNote}</p>
      </Section>

      <Section label="Red flags">
        <p className="text-small text-on-dark-muted">{PROGRAM.redFlagsIntro}</p>
        {late ? <p className="text-small text-on-dark">{LATE_FLAG_INTRO}</p> : null}
        {PROGRAM.redFlags.map((flag) => (
          <Tap key={flag.id} label={flag.text} value={form.redFlags.includes(flag.id)} onChange={() => set('redFlags')(toggleFlag(form.redFlags, flag.id))} yes="Flagged" no="No" />
        ))}
        <p className="text-small text-on-dark-dim">{PROGRAM.notFlags}</p>
      </Section>

      <Section label={tagSectionLabel(late)}>
        <p className="text-small text-on-dark-muted">{TAG_INTRO}</p>
        {MORNING_TAGS.map((tag) => (
          <Tap key={tag} label={TAG_LABELS[tag]} value={form.tags.includes(tag)} onChange={() => set('tags')(toggleFlag(form.tags, tag))} yes="Tagged" no="No" />
        ))}
      </Section>

      <Section label="Note">
        <label htmlFor={noteId} className="text-body text-on-dark-dim">
          Optional. Anything the taps did not catch.
        </label>
        <textarea
          id={noteId}
          rows={3}
          value={form.notes}
          onChange={(e) => set('notes')(e.target.value)}
          className="tap w-full rounded-sm bg-ink p-3 text-body text-on-dark"
        />
      </Section>
    </>
  )
}

/**
 * A past morning's check (Batch D, PROGRAM-QUESTIONS 174): the offer is fixed when the screen opens,
 * so midnight passing under an open form doesn't wipe the answers; Save asks again with the live
 * date and history, and refuses in words, keeping the form, when the morning has left the window or
 * taken a check since.
 */
function LateCheckScreen({ morning, today, settings, history, onSaved }: { morning: IsoDate; today: IsoDate; settings: Settings; history: History; onSaved: (saved: LateSaved) => void }) {
  const sessionDay = addDays(morning, -1)
  const ask = (on: IsoDate, h: History): LateCheckOffer => lateCheckFor({ sessionDay, today: on, startDate: settings.startDate, workouts: h.workouts, runs: h.runs, checks: h.morningChecks })
  const [offer] = useState<LateCheckOffer>(() => ask(today, history))
  const [form, setForm] = useState<CheckForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!offer.ok) {
    return (
      <Screen title={TITLE} lead={lateRefusalWords(offer.refusal, sessionDay)}>
        <div className="flex flex-col gap-3">
          <Button variant="primary" wide onClick={() => navigate({ name: 'week' })}>
            Week
          </Button>
          <Button wide onClick={() => navigate({ name: 'today' })}>
            Today
          </Button>
        </div>
      </Screen>
    )
  }

  const subject = subjectFor(history.workouts, history.runs, sessionDay)

  async function save() {
    const live = ask(today, history)
    if (!live.ok) {
      setError(`${lateRefusalWords(live.refusal, sessionDay)} Nothing was saved.`)
      return
    }
    const check = buildLateCheck({ morning, today, link: checkLink(history.workouts, history.runs, sessionDay), form, catalog: PROGRAM.redFlags })
    setSaving(true)
    setError(null)
    try {
      await addLateMorningCheck(check)
    } catch (e) {
      setError(`The check did not save (${errorWords(e)}). Nothing was written.`)
      setSaving(false)
      return
    }
    setSaving(false)
    const reach = lateCheckReach({
      workouts: history.workouts,
      setLogs: history.setLogs,
      runs: history.runs,
      before: history.morningChecks,
      after: withCheck(history, check).morningChecks,
      injuredSide: settings.injuredSide,
      liftDates: reachLiftDates({ today, startDate: settings.startDate, template: PROGRAM.weeklyTemplate, moves: history.sessionMoves, workouts: history.workouts }),
    })
    onSaved({ check, sessionDay, changes: lateReachWords(reach, history, PROGRAM.templates) })
  }

  return (
    <Screen title={TITLE} lead={lateSubjectWords(subject, sessionDay, PROGRAM.templates)}>
      <p className="text-body text-on-dark-dim">{LATE_FORM_LINE}</p>
      <CheckFields form={form} setForm={setForm} late />
      {error ? (
        <p role="alert" className="text-body text-on-dark">
          {error}
        </p>
      ) : null}
      <Button variant="primary" wide disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save check'}
      </Button>
    </Screen>
  )
}

/**
 * A past morning's result: led by that morning in words, so the reading's "yesterday" reads as the
 * day before it; the reading and its reasons; a red flag as a note with the way to this morning's
 * check; what the check changed; and no way to change it (PROGRAM-QUESTIONS 174).
 */
function LateResult({ saved }: { saved: LateSaved }) {
  const { check, sessionDay, changes } = saved
  const reading = morningReading(check)
  const note = lateFlagNote(check, PROGRAM.redFlags)
  return (
    <Screen
      title={TITLE}
      lead={
        <>
          <span className="text-green-bright">Saved.</span> The check for {dateWords(check.date)}’s morning, after {dateWords(sessionDay)}, logged late.
        </>
      }
    >
      <Section label="Reading">
        <div className="flex flex-col gap-2">
          <ReadingWord result={reading.result} />
          <p className="text-lead text-on-dark">{readingSentence(reading.result)}</p>
        </div>
        <ul className="flex flex-col gap-1 text-body text-on-dark-dim">
          {reading.reasons.map((reason) => (
            <li key={reason}>Because: {reason}.</li>
          ))}
        </ul>
      </Section>

      {note ? (
        <Section label="Red flag (past morning)">
          <p className="text-body text-on-dark">{lateFlagWords(note)}</p>
          <Button onClick={() => navigate({ name: 'morning' })}>This morning’s check</Button>
        </Section>
      ) : null}

      <Section label="What changed">
        <ul className="flex flex-col gap-1 text-body text-on-dark-dim">
          {changes.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Section>

      <p className="text-small text-on-dark-muted">A check for a past morning stays as saved.</p>
      <div className="flex flex-col gap-3">
        <Button variant="primary" wide onClick={() => navigate({ name: 'week' })}>
          Week
        </Button>
        <Button wide onClick={() => navigate({ name: 'today' })}>
          Today
        </Button>
      </div>
    </Screen>
  )
}

function Result({ saved, location, onChange }: { saved: Saved; location: Location; onChange: () => void }) {
  const { check, subject, settings, history } = saved
  const reading = morningReading(check)
  const stop = stopMessage(settings.redFlag, PROGRAM.redFlags)
  return (
    <Screen
      title={TITLE}
      lead={
        <>
          <span className="text-green-bright">Saved.</span> {subjectWords(subject, addDays(check.date, -1), PROGRAM.templates)}
        </>
      }
    >
      <Section label="Reading">
        <div className="flex flex-col gap-2">
          <ReadingWord result={reading.result} />
          <p className="text-lead text-on-dark">{readingSentence(reading.result)}</p>
        </div>
        <ul className="flex flex-col gap-1 text-body text-on-dark-dim">
          {reading.reasons.map((reason) => (
            <li key={reason}>Because: {reason}.</li>
          ))}
        </ul>
      </Section>

      {stop ? (
        <Section label="Red flag">
          <p className="text-lead font-medium text-on-dark">{stop.headline}</p>
          <ul className="flex flex-col gap-1 text-body text-on-dark-dim">
            {stop.items.map((item) => (
              <li key={item}>Flagged: {item}.</li>
            ))}
          </ul>
          <p className="text-body text-on-dark-dim">Progression is suspended until the red-flag state is cleared in Settings with a note.</p>
          <Button onClick={() => navigate({ name: 'settings' })}>Open Settings</Button>
        </Section>
      ) : null}

      <Section label="Next time">
        <NextTime subject={subject} settings={settings} history={history} gym={{ location, kit: settings.kit }} />
      </Section>

      <div className="flex flex-col gap-3">
        <Button variant="primary" wide onClick={() => navigate({ name: 'today' })}>
          Today
        </Button>
        <Button variant="quiet" wide onClick={onChange}>
          Change this check
        </Button>
      </div>
    </Screen>
  )
}

/** For yesterday's lift: one sentence per exercise from the engine, planned with the new history. */
function NextTime({ subject, settings, history, gym }: { subject: CheckSubject | null; settings: Settings; history: History; gym: Gym }) {
  if (!subject) {
    return <p className="text-body text-on-dark-dim">No session was logged for yesterday, so this check changes nothing on its own.</p>
  }
  if (subject.kind === 'run') {
    return <p className="text-body text-on-dark-dim">Yesterday was a run. Its reading counts toward this week's mileage cap; the Week screen shows where the week stands.</p>
  }
  const { workout } = subject
  // After a gate advance the next session of this letter is the new phase's (nextTemplateFor).
  const nextId = nextTemplateFor(workout.templateId, PROGRAM.templates, settings.currentPhase)
  const template = PROGRAM.templates.find((t) => t.id === nextId)
  if (!template) {
    return <p className="text-body text-on-dark-dim">Yesterday's session uses a template this program does not have ({workout.templateId}), so there is nothing to plan from.</p>
  }
  const week = nextWeekFor(workout, settings.startDate)
  // The day that session falls on, after moves: a down period covering it pauses progression there (Batch E). Planned from every record, so no `before`.
  const pauseDate = sessionDateInWeek(settings.startDate, week, PROGRAM.weeklyTemplate, history.sessionMoves, `lift:${template.letter}`)
  let sentences: ExerciseSentence[]
  try {
    sentences = exerciseSentences(planSession({ template, week, settings, history, gym, ...(pauseDate ? { pauseDate } : {}) }), settings.injuredSide)
  } catch (e) {
    return <p className="text-body text-on-dark-dim">The next session could not be planned ({errorWords(e)}).</p>
  }
  return (
    <>
      <p className="text-body text-on-dark">
        Next {sessionName(template.id, PROGRAM.templates)}, week {week}
        {isDeloadWeek(week) ? ', a deload week' : ''}:
      </p>
      {workout.status === 'in-progress' ? (
        <div className="flex flex-col gap-3">
          <p className="text-body text-on-dark-dim">Yesterday's session was never finished, so its sets do not count yet. Finish or abandon it in the runner; the next plan will read them.</p>
          <Button onClick={() => navigate({ name: 'session', workoutId: workout.id })}>Open yesterday's session</Button>
        </div>
      ) : null}
      {sentences.length === 0 ? (
        <p className="text-body text-on-dark-dim">Nothing is written for that session yet.</p>
      ) : (
        <ul className="flex flex-col">
          {sentences.map((s) => (
            <li key={s.slotId} className="flex flex-col gap-1 border-t border-on-dark-faint py-3">
              <span className="text-body font-medium text-on-dark">
                {s.name}
                {s.optional ? <span className="text-on-dark-muted"> (optional)</span> : null}
              </span>
              {s.lines.map((line) => (
                <span key={line} className="text-body text-on-dark-dim">
                  {line}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
