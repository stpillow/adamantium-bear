import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useEngineMode } from '../app/mode.ts'
import { navigate } from '../app/router.ts'
import { availableAt, PROGRAM, warmUpFor, type Gym } from '../app/session.ts'
import type { EngineMode } from '../rules/engineMode.ts'
import { isLateEntry } from '../rules/retro.ts'
import { TimeWindow } from '../components/TimeWindow.tsx'
import { useToday } from '../app/today.ts'
import { Button } from '../components/Button.tsx'
import { RestTimer } from '../components/RestTimer.tsx'
import { Screen } from '../components/Screen.tsx'
import { useHistory, useLocation, useLocations, useSetsFor, useSettings, useWorkout } from '../db/hooks.ts'
import { deleteSet, deleteWorkout, markOff, setActiveLocation, setDumbbellMax, setPresent, setWorkoutLocation, readWindow, SWAP_KEY_PREFIX, updateWorkout, upsertSet, writeWindow, type History } from '../db/repo.ts'
import { exerciseById } from '../program/program.ts'
import { effectiveSlot } from '../rules/effectiveSlot.ts'
import { gymLocked, listedLocations, locationIdOf } from '../rules/locations.ts'
import { loggedPain, painRewriteAllowed, type Draft } from '../rules/prefill.ts'
import { firstOpenStepOf, nextStep, openStepForSide, restAfter, type Step } from '../rules/runOrder.ts'
import { asksForRack, notHereSlots, skipTakesBack, swapOffer, type SwapOffer } from '../rules/runnerGym.ts'
import { warmUpParts } from '../rules/warmUp.ts'
import type { IsoDate, Location, SessionTemplate, SetLog, SetSide, Settings, StopReason, Workout } from '../schema/index.ts'
import { ActiveCard } from './session/ActiveCard.tsx'
import { DoneBar } from './session/DoneBar.tsx'
import { EndPanel, FinishPanel } from './session/EndPanels.tsx'
import { GymLine } from './session/GymLine.tsx'
import type { GymAction, RackAsk } from './session/GymNotes.tsx'
import { SlotList } from './session/SlotList.tsx'
import { Summary } from './session/Summary.tsx'
import { windowWords } from './Window.helpers.ts'
import {
  buildSet,
  cardModel,
  activeCardKey,
  deloadBadge,
  doneWords,
  heldBarWords,
  holdsOffFor,
  holdsOffWords,
  loggedMaxPain,
  markedWords,
  NO_DUMBBELLS_WORDS,
  notHereEntries,
  notHereWords,
  notLoggedLabels,
  notLoggedWords,
  offerNotes,
  parseStoredSlotIds,
  parseStoredSwaps,
  pickNotHereWords,
  RACK_ASK_LB,
  rackAskWords,
  rackSetWords,
  redFlagRunnerLine,
  routeLines,
  runnerPlan,
  runsExerciseId,
  setStepKey,
  setTarget,
  sideSets,
  slotRepUnit,
  standingMarkFor,
  staleStoredSwaps,
  stopReasonLabel,
  summaryPhaseWeek,
  summaryTemplateFor,
  swapChoices,
  swapPick,
  templateForWorkout,
  todayGymWords,
  todayTooLabel,
  warmUpWords,
  timedSets,
  type GymMark,
  type HoldsOff,
  type RunnerSlot,
  summaryCheckLine,
} from './SessionRunner.helpers.ts'
import { shortDateWords } from './Today.helpers.ts'

const COOL_DOWN_MS = 800
const SHOW_GO_FOR_SECONDS = 300
const ITEMS = PROGRAM.equipment
/** The items in the bag (`carried`): Settings' kit at every gym, never a mark at one (PROGRAM-QUESTIONS 75). */
const CARRIED = ITEMS.filter((item) => item.carried).map((item) => item.id)
const nameOf = (exerciseId: string) => exerciseById(exerciseId).name

function readStoredSwaps(key: string): Record<string, string | null> {
  try {
    return parseStoredSwaps(window.localStorage.getItem(key))
  } catch {
    return {}
  }
}

function readStoredSlotIds(key: string): string[] {
  try {
    return parseStoredSlotIds(window.localStorage.getItem(key))
  } catch {
    return []
  }
}

/** Swaps and Do it anyway, per workout, under SWAP_KEY_PREFIX (so Reset clears both); null removes the key. */
function writeStored(key: string, value: Record<string, string | null> | readonly string[] | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private browsing: the choice still holds for this visit, and a swap is recovered from the sets once one is logged.
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function newest(sets: readonly SetLog[]): SetLog | undefined {
  return [...sets].sort((a, b) => (a.loggedAt ?? '').localeCompare(b.loggedAt ?? '')).at(-1)
}

/** The Session runner (PROMPT section 5, row 2). The design is docs/session-runner-design.md. */
export function SessionRunner({ workoutId }: { workoutId: string }) {
  const workout = useWorkout(workoutId)
  const sets = useSetsFor(workoutId)
  const settings = useSettings()
  const history = useHistory()
  const today = useToday()
  const { mode } = useEngineMode()

  if (workout === undefined || sets === undefined || settings === undefined || history === undefined) {
    return <Screen title="Session" lead="Opening storage…">{null}</Screen>
  }
  if (workout === null || settings === null) {
    return (
      <Screen title="Session" lead="This session isn't in storage.">
        <Button variant="primary" wide onClick={() => navigate({ name: 'today' })}>
          Back to Today
        </Button>
      </Screen>
    )
  }
  const template = templateForWorkout(workout, PROGRAM.templates)
  const lead = `Phase ${workout.phase} · Week ${workout.week} · ${shortDateWords(workout.date)}`
  if (!template) {
    return (
      <Screen title="Session" lead={lead}>
        <p className="text-body text-on-dark-dim">The sessions for this phase are not written yet.</p>
        <Button variant="primary" wide onClick={() => navigate({ name: 'today' })}>
          Back to Today
        </Button>
      </Screen>
    )
  }
  if (workout.status === 'finished' || workout.status === 'abandoned') {
    const summaryTemplate = summaryTemplateFor(mode, template, history, settings, workout)
    return (
      <Screen title={`Session ${template.letter}`} lead={lead}>
        <Summary
          mode={mode}
          workout={workout}
          template={summaryTemplate}
          sets={sets}
          injuredSide={settings.injuredSide}
          phaseWeek={summaryPhaseWeek(mode, workout, settings, history)}
          checkLine={summaryCheckLine({ mode, workout, today, startDate: settings.startDate, history })}
          timing={{
            workout,
            sets: timedSets(sets, (slotId) => summaryTemplate.slots.find((s) => s.id === slotId)?.repUnit),
            restSeconds: settings.restTimerSeconds,
            // No gym is opened for a summary: the estimate counts the bike as present, as the warm-up row does where there is one.
            warmUpMinutes: warmUpParts(PROGRAM.warmUp.lift, workout.phase, true).total,
          }}
        />
      </Screen>
    )
  }
  return <RunnerAtGym mode={mode} workout={workout} template={template} sets={sets} settings={settings} history={history} today={today} lead={lead} />
}

type RunnerProps = { mode: EngineMode; workout: Workout; template: SessionTemplate; sets: SetLog[]; settings: Settings; history: History; today: IsoDate; lead: string }

/**
 * The runner plans at the workout's own gym, stamped at Start (absent means Planet Fitness), not the
 * active one. A Change of gym (before the first set) starts the runner afresh there: offers and marks
 * made at the old gym don't follow it.
 */
function RunnerAtGym(props: RunnerProps) {
  const location = useLocation(locationIdOf(props.workout))
  if (location === undefined || location === null) {
    return <Screen title={`Session ${props.template.letter}`} lead="Opening storage…">{null}</Screen>
  }
  return <Runner key={location.id} {...props} location={location} />
}

function Runner({ mode, workout, template, sets, settings, history, today, lead, location }: RunnerProps & { location: Location }) {
  const storageKey = `${SWAP_KEY_PREFIX}${workout.id}`
  const anywayKey = `${storageKey}:anyway`
  const locations = useLocations()
  const [stored, setStored] = useState<Record<string, string | null>>(() => readStoredSwaps(storageKey))
  /** The minutes Shawn has for this session, from Start or changed here; null is the full session (`fitToWindow` drops whole exercises, never a set). */
  const [minutes, setMinutes] = useState<number | null>(() => readWindow(workout.id))
  /** Slots Shawn picked Do it anyway on: nothing on their list is here, and they run regardless. */
  const [runAnyway, setRunAnyway] = useState<string[]>(() => readStoredSlotIds(anywayKey))
  /** What the last Swap pick offers to mark at this gym, for its slot (`swapOffer`, made at the pick, read against what is here now). */
  const [offer, setOffer] = useState<{ slotId: string; offer: SwapOffer } | null>(null)
  /** The line after a mark is saved, on the slot it was made from. */
  const [marked, setMarked] = useState<{ slotId: string; text: string } | null>(null)
  const [focusSlot, setFocusSlot] = useState<string | null>(null)
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  /** Pain picked per exercise, keyed `${slotId}:${exerciseId}`: a swap never carries one exercise's pain to another. */
  const [painPicked, setPainPicked] = useState<Record<string, number>>({})
  const [panel, setPanel] = useState<'finish' | 'end' | null>(null)
  const [saving, setSaving] = useState(false)
  const [cooling, setCooling] = useState(false)
  /** A write that failed, in a sentence, where it was asked for: under the gym line, or in whatever the card's place shows (the card, Finish, End). */
  const [error, setError] = useState<{ at: 'gym' | 'session'; text: string } | null>(null)
  const [skippedRest, setSkippedRest] = useState<number | null>(null)
  const [showWarmUp, setShowWarmUp] = useState(false)
  const topRef = useRef<HTMLDivElement | null>(null)
  const [scrollTick, setScrollTick] = useState(0)

  useEffect(() => {
    if (!cooling) return
    const t = window.setTimeout(() => setCooling(false), COOL_DOWN_MS)
    return () => window.clearTimeout(t)
  }, [cooling])

  // A tap far down the page (a slot row, Finish, End) changes the card at the top: bring it into view.
  useEffect(() => {
    if (scrollTick === 0) return
    topRef.current?.scrollIntoView({ block: 'start' })
  }, [scrollTick])
  const bringToTop = () => setScrollTick((n) => n + 1)

  const gym = useMemo<Gym>(() => ({ location, kit: settings.kit }), [location, settings.kit])
  const available = useMemo(() => availableAt(gym), [gym])
  // Door to door (PROGRAM-QUESTIONS 166): the warm-up at this gym comes off the top; a late entry shows, and so counts, no warm-up sets.
  const warmParts = useMemo(() => warmUpFor(workout.phase, gym), [workout.phase, gym])
  const lateEntry = isLateEntry(workout)
  // The plan for the mode (`runnerPlan`): the engine's in full mode, the session as written in tester mode (M-U3). What the minutes leave
  // out is decided on the unswapped plan, so a Swap never changes which exercises run; a slot with a set logged always stays.
  const { everySlot, fit, unswapped, engineBySlot, chosen, plans, steps, ownCount } = useMemo(
    () => runnerPlan(mode, { template, workout, settings, history, gym, stored, minutes, sets, late: lateEntry }),
    [mode, template, workout, settings, history, gym, stored, minutes, sets, lateEntry],
  )
  // A stored swap taken off its slot's list is forgotten, so putting the exercise back on the list later doesn't bring the old pick back with it.
  useEffect(() => {
    const stale = staleStoredSwaps(stored, everySlot.map((rs) => rs.plan))
    if (stale.length === 0) return
    const next = Object.fromEntries(Object.entries(stored).filter(([slotId]) => !stale.includes(slotId)))
    setStored(next)
    writeStored(storageKey, Object.keys(next).length > 0 ? next : null)
  }, [stored, everySlot, storageKey])
  const done = useMemo(() => new Set(sets.map(setStepKey)), [sets])
  const stopped = useMemo(() => new Set(sets.filter((s) => s.stopped).map((s) => s.slotId)), [sets])
  const loggedSlots = useMemo(() => new Set(sets.map((s) => s.slotId)), [sets])
  // Slots nothing here runs, left for Skip, Do it anyway or Swap: never the run order's automatic next step (PROGRAM-QUESTIONS 83).
  const notHere = useMemo(
    () =>
      notHereSlots(
        plans.map((rs) => ({ slotId: rs.plan.slot.id, route: rs.plan.route })),
        new Set(runAnyway),
        new Set(Object.keys(chosen).filter((slotId) => chosen[slotId] !== undefined)),
        loggedSlots,
      ),
    [plans, runAnyway, chosen, loggedSlots],
  )
  const last = newest(sets)
  const editing = editingId ? (sets.find((s) => s.id === editingId) ?? null) : null

  const pinned = pinnedKey ? (steps.find((s) => s.key === pinnedKey && !done.has(s.key) && !stopped.has(s.slotId) && !notHere.has(s.slotId)) ?? null) : null
  // A tap on a slot with nothing here lands on it without a set to log, until Do it anyway.
  const focused = focusSlot && !notHere.has(focusSlot) ? firstOpenStepOf(steps, focusSlot, done, stopped) : null
  const current: Step | null = pinned ?? focused ?? (focusSlot ? null : nextStep(steps, done, stopped, last ? setStepKey(last) : null, notHere))
  const activeSlotId = editing?.slotId ?? pinned?.slotId ?? focusSlot ?? current?.slotId ?? null
  const activeSlot: RunnerSlot | undefined = plans.find((rs) => rs.plan.slot.id === activeSlotId)
  const activePlan = activeSlot?.plan
  const held = activePlan !== undefined && editing === null && notHere.has(activePlan.slot.id)
  const fallback = nextStep(steps, done, stopped, last ? setStepKey(last) : null, notHere)

  // A session entered after the fact (`isLateEntry`) has no live clock: no rest timer, no time window, no warm-up, and Finish stamps no finish time.
  const late = isLateEntry(workout)
  const restStart = !late && last?.loggedAt && restAfter(steps, setStepKey(last), done, stopped, notHere) ? Date.parse(last.loggedAt) : null
  const timer: ReactNode =
    restStart !== null && restStart !== skippedRest ? (
      <RestTimer startedAt={restStart} seconds={settings.restTimerSeconds} hideAfterSeconds={SHOW_GO_FOR_SECONDS} onSkip={() => setSkippedRest(restStart)} />
    ) : null

  async function write(action: () => Promise<void>, after?: () => void, at: 'gym' | 'session' = 'session') {
    setSaving(true)
    setError(null)
    try {
      await action()
      after?.()
      setCooling(true)
    } catch (e) {
      setError({ at, text: `Not saved: ${message(e)}. Tap again.` })
    } finally {
      setSaving(false)
    }
  }

  const slotSetsOf = (slotId: string) => sets.filter((s) => s.slotId === slotId)
  const painKey = (slotId: string, exerciseId: string) => `${slotId}:${exerciseId}`
  function exercisePain(slotId: string, exerciseId: string): number | null {
    return painPicked[painKey(slotId, exerciseId)] ?? loggedPain(slotSetsOf(slotId).filter((s) => s.exerciseId === exerciseId))
  }

  function logStep(step: Step, rs: RunnerSlot, draft: Draft, stop?: StopReason) {
    // What the set is stored as (`setTarget`): the prescription's exercise, unit and rack cap in full mode; in tester mode the
    // written plan's exercise, the unit it counts, and never a rack cap (M-U3 review B2).
    const target = setTarget(rs, step.side)
    if (!target) return
    const plan = rs.plan
    const exercise = exerciseById(target.exerciseId)
    const pain = settings.painPerSet ? draft.pain : exercisePain(plan.slot.id, exercise.id)
    const set = buildSet({
      workoutId: workout.id,
      slot: plan.slot,
      exercise,
      repUnit: target.repUnit,
      side: step.side,
      setNumber: step.setNumber,
      draft: { ...draft, pain },
      loggedAt: new Date().toISOString(),
      ...(stop ? { stop } : {}),
      rackCapped: target.rackCapped,
    })
    void write(
      () => upsertSet(set),
      () => {
        setFocusSlot(null)
        setPinnedKey(null)
      },
    )
  }

  function saveEdit(original: SetLog, plan: RunnerSlot['plan'], draft: Draft) {
    const exercise = exerciseById(original.exerciseId)
    const unit = effectiveSlot(plan.slot, exercise).repUnit
    const pain = settings.painPerSet ? draft.pain : (painPicked[painKey(plan.slot.id, exercise.id)] ?? original.painDuring ?? null)
    const set = buildSet({
      workoutId: workout.id,
      slot: plan.slot,
      exercise,
      // A correction keeps the field the set was stored in.
      repUnit: original.seconds !== undefined ? 'seconds' : unit === 'seconds' ? 'reps' : unit,
      side: original.side,
      setNumber: original.setNumber,
      draft: { ...draft, pain },
      // A correction keeps its time stamp: a fresh one would restart the rest timer and reorder sets for the climbing check.
      loggedAt: original.loggedAt ?? new Date().toISOString(),
      ...(original.stopped ? { stop: original.stopReason ?? 'other' } : {}),
      // A correction keeps the stamp it was logged with: the rack it ran at doesn't change after the fact.
      rackCapped: original.rackCapped === true,
    })
    void write(() => upsertSet(set), () => setEditingId(null))
  }

  function setExercisePain(slotId: string, exerciseId: string, value: number) {
    setPainPicked((p) => ({ ...p, [painKey(slotId, exerciseId)]: value }))
    if (settings.painPerSet) return
    const own = slotSetsOf(slotId).filter((s) => s.exerciseId === exerciseId)
    // Only sets logged per exercise (unrated, or one shared value) take the new rating; a climb logged per set stays.
    if (own.length === 0 || !painRewriteAllowed(own)) return
    void write(async () => {
      for (const s of own) await upsertSet({ ...s, painDuring: value })
    })
  }

  /** Skip: leave a slot with nothing here and go on in the run order; Finish names it. */
  function skip() {
    setFocusSlot(null)
    setPinnedKey(null)
    setEditingId(null)
  }

  /** Skip on a slot run anyway with nothing logged (`skipTakesBack`): Do it anyway is taken back, so the run order passes it again. */
  function takeBack(slotId: string) {
    const next = runAnyway.filter((id) => id !== slotId)
    setRunAnyway(next)
    writeStored(anywayKey, next)
    skip()
  }

  /** A rack tapped on the card (`asksForRack`): this session's gym's heaviest dumbbell, as Where you train sets it. */
  function setRack(slotId: string, lb: number) {
    void write(
      async () => {
        await setDumbbellMax(location.id, lb)
      },
      () => setMarked({ slotId, text: rackSetWords(location.name, lb) }),
    )
  }

  /** Do it anyway: the slot runs like any other, and the card offers to mark what it lacks here. */
  function doAnyway(slotId: string) {
    const next = [...new Set([...runAnyway, slotId])]
    setRunAnyway(next)
    writeStored(anywayKey, next)
    setPinnedKey(null)
    setFocusSlot(slotId)
  }

  /**
   * The exercise the plan runs without a swap when the card doesn't run it (`cardHoldsOff`: past
   * the rack, or backed off), read off the unswapped plan, so Swap can say why a tap on it keeps the card.
   */
  function heldOff(slotId: string): HoldsOff | null {
    return holdsOffFor(
      unswapped.find((rs) => rs.plan.slot.id === slotId),
      engineBySlot.get(slotId),
      location.dumbbellMaxLb,
    )
  }

  /**
   * A Swap pick (`swapPick`): the swap it stores, Do it anyway when it is the gym's own pick on a
   * slot with nothing here, and otherwise what it offers to mark (`swapOffer`): what a pick that
   * isn't here lacks, or what the exercise on the card needed that a pick that is here doesn't. A
   * pick of what the plan runs when the card holds it off answers in words: the card stays.
   */
  function swap(rs: RunnerSlot, exerciseId: string | null) {
    const plan = rs.plan
    const slotId = plan.slot.id
    const cardId = runsExerciseId(rs)
    const pick = swapPick({ pickId: exerciseId, engineId: engineBySlot.get(slotId) ?? plan.slot.exerciseId, cardId, routeKind: plan.route.kind })
    const next = { ...stored, [slotId]: pick.value }
    setStored(next)
    writeStored(storageKey, next)
    const held = heldOff(slotId)
    setMarked(held && exerciseId === held.exerciseId ? { slotId, text: holdsOffWords(nameOf(held.exerciseId), held.why, held.cardName, held.rackLb) } : null)
    if (pick.anyway) {
      setOffer(null)
      doAnyway(slotId)
      return
    }
    const pending = pick.offers && exerciseId !== null ? swapOffer(exerciseById(cardId), exerciseById(exerciseId), available, CARRIED) : null
    setOffer(pending ? { slotId, offer: pending } : null)
  }

  /** "Mark Smith machine here" or "Smith machine isn't here: mark it", at this session's gym. */
  function mark(slotId: string, m: GymMark) {
    void write(
      async () => {
        if (m.here) await setPresent(location.id, m.id, true)
        else await markOff(location.id, m.id, today)
      },
      () => setMarked({ slotId, text: markedWords(m.here, m.id, location.name, ITEMS, location.id === settings.activeLocationId) }),
    )
  }

  /**
   * What the card says the gym does to a slot, and the taps it offers: Skip and Do it anyway, then the
   * marks. A slot run anyway, or swapped to a pick that isn't here, keeps offering to mark what it
   * lacks (`standingMarkFor`, read from what is stored, so a reload keeps it) and says what the gym
   * lacks for a pick in words; otherwise the last pick's offer stands.
   */
  function gymFor(rs: RunnerSlot): { lines: string[]; actions: GymAction[]; rack: RackAsk | null } {
    const plan = rs.plan
    const slotId = plan.slot.id
    const swapped = chosen[slotId] !== undefined
    const cardId = runsExerciseId(rs)
    const lines = routeLines({ route: plan.route, swapped, gymName: location.name, items: ITEMS, nameOf })
    const pickLine = swapped ? pickNotHereWords(exerciseById(cardId), available, location.name, ITEMS) : null
    const standingId = standingMarkFor({ routeKind: plan.route.kind, routeExerciseId: plan.route.exerciseId, swapped, cardId, held: notHere.has(slotId) })
    const standing = standingId ? swapOffer(exerciseById(standingId), exerciseById(standingId), available, CARRIED) : null
    const pending = standing ?? (offer?.slotId === slotId ? offer.offer : null)
    const notes = offerNotes(pending, available, ITEMS)
    // Dumbbell work at a gym with none set: the load field stops at 0, so the card asks for the rack instead of only naming Where you train.
    const askRack = asksForRack(exerciseById(cardId), available, notHere.has(slotId))
    const actions: GymAction[] = notHere.has(slotId)
      ? [
          { label: 'Skip', onPress: skip },
          { label: 'Do it anyway', onPress: () => doAnyway(slotId) },
        ]
      : skipTakesBack({ slotId, route: plan.route }, new Set(runAnyway), loggedSlots)
        ? [{ label: 'Skip', onPress: () => takeBack(slotId) }]
        : []
    for (const m of notes.marks) actions.push({ label: m.label, onPress: () => mark(slotId, m) })
    const rack = askRack ? { words: rackAskWords(location.name), choices: RACK_ASK_LB.map((lb) => ({ label: `${lb} lb`, onPress: () => setRack(slotId, lb) })) } : null
    const noteLines = askRack ? notes.lines.filter((line) => line !== NO_DUMBBELLS_WORDS) : notes.lines
    return { lines: [...lines, ...(pickLine ? [pickLine] : []), ...noteLines, ...(marked?.slotId === slotId ? [marked.text] : [])], actions, rack }
  }

  function pickSide(slotId: string, side: SetSide) {
    const step = openStepForSide(steps, slotId, side, done, stopped)
    if (step) setPinnedKey(step.key)
  }

  /** A session with nothing logged didn't happen: it is discarded, never kept as an empty abandoned or finished one. */
  function discard() {
    void write(
      async () => {
        await deleteWorkout(workout.id)
        writeStored(storageKey, null)
        writeStored(anywayKey, null)
        writeWindow(workout.id, null)
      },
      () => navigate({ name: 'today' }),
    )
  }

  /** Max pain and the session's RPE only when rated; the minutes as the stepper holds them (metrics phase 1). */
  function finish(maxPain: number | null, sessionRpe: number | null, durationMinutes: number | null) {
    if (sets.length === 0) return discard()
    void write(async () => {
      await updateWorkout(workout.id, {
        ...(maxPain !== null ? { maxPainDuring: maxPain } : {}),
        ...(sessionRpe !== null ? { sessionRpe } : {}),
        ...(durationMinutes !== null ? { durationMinutes } : {}),
        ...(late ? {} : { finishedAt: new Date().toISOString() }),
        status: 'finished',
      })
      writeStored(storageKey, null)
      writeStored(anywayKey, null)
    })
  }

  function end(durationMinutes: number | null) {
    if (sets.length === 0) return discard()
    void write(
      async () => {
        await updateWorkout(workout.id, { ...(durationMinutes !== null ? { durationMinutes } : {}), ...(late ? {} : { finishedAt: new Date().toISOString() }), status: 'abandoned' })
        writeStored(storageKey, null)
        writeStored(anywayKey, null)
      },
      () => navigate({ name: 'today' }),
    )
  }

  function openPanel(which: 'finish' | 'end') {
    setPanel(which)
    setError(null)
    bringToTop()
  }

  /**
   * Change, before the first set: the session plans at the gym picked. Do it anyway answered "nothing
   * here" at the old gym, so it doesn't follow the session to the new one (the runner starts afresh
   * there, keyed by the gym); a swap is the session's own and stays.
   */
  function changeGym(locationId: string) {
    void write(
      async () => {
        await setWorkoutLocation(workout.id, locationId)
        writeStored(anywayKey, null)
      },
      undefined,
      'gym',
    )
  }

  const sessionError = error?.at === 'session' ? error.text : null
  // The runner's Change moves only the session: when Today plans at another gym, say so, with a tap to move Today too.
  const todayGym = locations?.find((l) => l.id === settings.activeLocationId)
  const elsewhere =
    todayGym && todayGym.id !== location.id
      ? { words: todayGymWords(todayGym.name), label: todayTooLabel(location.name), onUse: () => void write(() => setActiveLocation(location.id), undefined, 'gym') }
      : null

  const slotPlans = plans.map((rs) => rs.plan)
  const notHereLine = notHereWords(location.name, notHereEntries(slotPlans, loggedSlots, nameOf))
  const notLogged = notLoggedWords(notLoggedLabels(slotPlans, steps, done, stopped, notHere), notHereLine !== null, mode)
  const finished = doneWords(
    location.name,
    slotPlans.filter((p) => !p.slot.optional && notHere.has(p.slot.id)).map((p) => `${p.slot.label} ${p.exercise.name}`),
  )
  const staleDay = workout.date < today
  const busy = saving || cooling
  const lift = PROGRAM.warmUp.lift
  const warmUp = warmUpWords(warmParts)
  // What Finish and End preset the session's minutes from: the sets' times, or for a late entry an estimate of them (metrics phase 1).
  const timing = {
    workout,
    sets: timedSets(sets, (slotId) => {
      const rs = plans.find((p) => p.plan.slot.id === slotId)
      return rs ? slotRepUnit(rs) : undefined
    }),
    restSeconds: settings.restTimerSeconds,
    warmUpMinutes: warmParts.total,
  }
  const activeExerciseId = activeSlot ? runsExerciseId(activeSlot) : undefined

  const stopOfActive = activePlan && stopped.has(activePlan.slot.id) ? slotSetsOf(activePlan.slot.id).find((s) => s.stopped) : undefined
  const nextName = fallback ? (slotPlans.find((p) => p.slot.id === fallback.slotId)?.exercise.name ?? 'the next slot') : null
  const idleBar = fallback
    ? {
        line: held
          ? heldBarWords(location.name)
          : stopOfActive
            ? `Stopped: ${stopReasonLabel(stopOfActive.stopReason).toLowerCase()}. This exercise is done for today.`
            : 'All sets for this slot are logged.',
        label: `Next: ${nextName}`,
        onPress: skip,
      }
    : { line: held ? heldBarWords(location.name) : finished.bar, label: 'Finish session', onPress: () => openPanel('finish') }

  const sidesFor = (rs: RunnerSlot) =>
    rs.plan.slot.unilateral && !rs.plan.slot.injuredOnly && !notHere.has(rs.plan.slot.id)
      ? sideSets(rs).map((p) => ({ side: p.side, open: openStepForSide(steps, rs.plan.slot.id, p.side, done, stopped) !== null }))
      : []
  const activeStep = editing ? null : current && activePlan && current.slotId === activePlan.slot.id ? current : null
  const activeModel = activeSlot
    ? cardModel(mode, {
        rs: activeSlot,
        step: activeStep,
        editing,
        slotSets: slotSetsOf(activeSlot.plan.slot.id),
        sessionSets: sets,
        allSets: history.setLogs,
        injuredSide: settings.injuredSide,
        painPerSet: settings.painPerSet,
        swapped: chosen[activeSlot.plan.slot.id] !== undefined,
        late,
      })
    : null

  return (
    <Screen title={`Session ${template.letter}`} lead={lead}>
      <GymLine
        location={location}
        locations={locations ? listedLocations(locations) : undefined}
        locked={gymLocked(sets.length)}
        busy={busy}
        error={error?.at === 'gym' ? error.text : null}
        elsewhere={elsewhere}
        onPick={changeGym}
      />
      <div className="-mt-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="quiet" onClick={() => navigate({ name: 'today' })}>
          Today
        </Button>
        {workout.isDeload ? <span className="font-mono text-small uppercase tracking-[0.22em] text-on-dark">{deloadBadge(mode)}</span> : null}
      </div>
      {!late && sets.length === 0 && workout.status === 'in-progress' ? (
        <TimeWindow
          minutes={minutes}
          onChange={(m) => {
            setMinutes(m)
            writeWindow(workout.id, m)
          }}
          lines={windowWords(fit, minutes, ownCount, (slotId) => everySlot.find((rs) => rs.plan.slot.id === slotId)?.plan.exercise.name ?? slotId, warmParts)}
        />
      ) : minutes !== null ? (
        <p className="text-small text-on-dark-dim">{`${fit.added.length > 0 ? `Fitted to ${minutes} min: all ${ownCount} exercises, and ${fit.added.length} added.` : `Fitted to ${minutes} min: ${fit.keep.length} of ${ownCount} exercises.`}`}</p>
      ) : null}
      {redFlagRunnerLine(mode, settings) ? <p className="text-body text-on-dark">{redFlagRunnerLine(mode, settings)}</p> : null}
      {staleDay ? (
        <div className="flex flex-col gap-2">
          <p className="text-body text-on-dark">
            {late ? `Logging ${shortDateWords(workout.date)} after the fact: enter the sets as they went, then finish it.` : `Started ${shortDateWords(workout.date)}. Finish it or end it.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => openPanel('finish')}>Finish session</Button>
            <Button variant="quiet" onClick={() => openPanel('end')}>
              End without finishing
            </Button>
          </div>
        </div>
      ) : null}

      {!late && (sets.length === 0 || showWarmUp) ? (
        <section aria-label="Warm-up" className="flex flex-col gap-2">
          <p className="flex items-center justify-between gap-3 text-body text-on-dark">
            {warmUp.line}
            <Button variant="quiet" onClick={() => setShowWarmUp((v) => !v)}>
              {showWarmUp ? 'Hide' : 'Show'}
            </Button>
          </p>
          {warmUp.noBike ? <p className="text-small text-on-dark">{warmUp.noBike}</p> : null}
          {showWarmUp ? (
            <ol className="flex flex-col gap-1">
              {warmUp.noBike ? null : <li className="text-small text-on-dark-dim">{lift.bike}</li>}
              {lift.circuit.map((item) => (
                <li key={item} className="text-small text-on-dark-dim">
                  {item}
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}

      <div ref={topRef} className="scroll-mt-4">
        {panel === 'finish' ? (
          <FinishPanel
            mode={mode}
            notHere={notHereLine}
            notLogged={notLogged}
            loggedCount={sets.length}
            loggedMax={loggedMaxPain(sets)}
            timing={timing}
            late={late}
            busy={busy}
            error={sessionError}
            onFinish={finish}
            onBack={() => setPanel(null)}
          />
        ) : panel === 'end' ? (
          <EndPanel mode={mode} loggedCount={sets.length} timing={timing} late={late} busy={busy} error={sessionError} onEnd={end} onBack={() => setPanel(null)} />
        ) : activeSlot && activePlan && activeModel ? (
          <ActiveCard
            key={activeCardKey({ mode, editingId: editing?.id ?? null, stepKey: current?.slotId === activePlan.slot.id ? current.key : null, slotId: activePlan.slot.id, exerciseId: activeExerciseId ?? null })}
            mode={mode}
            slot={activePlan.slot}
            route={activePlan.route}
            model={activeModel}
            step={activeStep}
            editing={editing}
            slotSets={slotSetsOf(activePlan.slot.id)}
            setsBySide={Object.fromEntries(sideSets(activeSlot).map((p) => [p.side, p.sets]))}
            sides={sidesFor(activeSlot)}
            injuredSide={settings.injuredSide}
            painPerSet={settings.painPerSet}
            rackLb={location.dumbbellMaxLb}
            exercisePain={exercisePain(activePlan.slot.id, editing?.exerciseId ?? activeExerciseId ?? activePlan.exercise.id)}
            onExercisePain={(v) => setExercisePain(activePlan.slot.id, editing?.exerciseId ?? activeExerciseId ?? activePlan.exercise.id, v)}
            swapped={chosen[activePlan.slot.id] !== undefined}
            choices={swapChoices(exerciseById(activePlan.slot.exerciseId), activePlan.substitutions, available, ITEMS, heldOff(activePlan.slot.id))}
            backToName={nameOf(engineBySlot.get(activePlan.slot.id) ?? activePlan.slot.exerciseId)}
            gym={gymFor(activeSlot)}
            held={held}
            busy={busy}
            error={sessionError}
            timer={timer}
            idleBar={idleBar}
            onLog={(draft, stop) => current && logStep(current, activeSlot, draft, stop)}
            onSave={(set, draft) => saveEdit(set, activePlan, draft)}
            onRemove={(set) => void write(() => deleteSet(set.id), () => setEditingId(null))}
            onEdit={(set) => setEditingId(set ? set.id : null)}
            onSwap={(id) => swap(activeSlot, id)}
            onPickSide={(side) => pickSide(activePlan.slot.id, side)}
          />
        ) : (
          <>
            <section aria-label="Now" className="flex flex-col gap-2 rounded-md bg-navy-lift p-4">
              <h2 className="font-sans text-h3 font-semibold text-on-dark wrap-anywhere">{finished.heading}</h2>
              <p className="text-body text-on-dark-dim wrap-anywhere">{finished.line}</p>
              {sessionError ? (
                <p role="alert" className="text-body text-on-dark">
                  {sessionError}
                </p>
              ) : null}
            </section>
            <DoneBar timer={timer} line={idleBar.line} label={idleBar.label} disabled={busy} onPress={idleBar.onPress} />
          </>
        )}
      </div>

      <SlotList
        plans={plans.map((rs) => ({ slot: rs.plan.slot, runsExerciseId: runsExerciseId(rs) }))}
        steps={steps}
        done={done}
        stopped={stopped}
        currentSlotId={activeSlotId}
        notHere={notHere}
        onPick={(slotId) => {
          setEditingId(null)
          setPanel(null)
          setPinnedKey(null)
          setFocusSlot(slotId)
          bringToTop()
        }}
      />

      <div className="flex flex-col gap-2">
        <Button wide onClick={() => openPanel('finish')}>
          Finish session
        </Button>
        <Button variant="quiet" onClick={() => openPanel('end')}>
          End without finishing
        </Button>
      </div>
      <div aria-hidden="true" className="h-56" />
    </Screen>
  )
}
