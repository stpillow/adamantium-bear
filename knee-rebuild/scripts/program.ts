/**
 * Prints a session from the seed data, the way the Session runner will see it.
 *
 *   npm run program -- --week 5 --session B
 *
 * Uses the nominal phase for the week; the app itself advances phases on gate confirmation.
 *
 *   npm run program -- --equipment
 *
 * Prints every exercise with the equipment it needs, in words, stage by stage where it has stages,
 * for a spot check of the seed against program.md (M4b).
 */
import { parseArgs } from 'node:util'
import { exerciseById, nominalPhaseForWeek, program, templateFor } from '../src/program/program.ts'
import { isDeloadWeek } from '../src/rules/calendar.ts'
import { prescribedSets } from '../src/rules/deload.ts'
import { warmUpParts } from '../src/rules/warmUp.ts'
import { rampEligible } from '../src/rules/warmUpRamp.ts'
import { phaseWeekOf, slotsForPhaseWeek } from '../src/rules/session.ts'
import { SessionLetter, type Requirement, type Slot } from '../src/schema/index.ts'

const { values } = parseArgs({
  options: {
    week: { type: 'string', short: 'w' },
    session: { type: 'string', short: 's' },
    equipment: { type: 'boolean', short: 'e' },
  },
})

const USAGE = 'usage: npm run program -- --week <1-12> --session <A|B|C>\n       npm run program -- --equipment'

/** "A", "A and B", "A, B and C". */
function andList(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

const equipmentById = new Map(program.equipment.map((e) => [e.id, e]))

function itemWords(id: string): string {
  const item = equipmentById.get(id)
  if (!item) return `${id} (not on the list)`
  return item.carried ? `${item.name} (carried)` : item.name
}

/**
 * Requirements in words: every entry must hold; an anyOf holds when one of its items is here. The
 * options are split with "|" because some names hold an "or" of their own ("Bosu or balance pad").
 */
function requirementWords(requirements: readonly Requirement[]): string {
  if (requirements.length === 0) return 'nothing'
  return andList(requirements.map((r) => (typeof r === 'string' ? itemWords(r) : `one of ${r.anyOf.map(itemWords).join(' | ')}`)))
}

function printEquipment(): void {
  const pf = new Set(program.planetFitness)
  console.log(`${program.title} · equipment list version ${program.equipmentListVersion}: ${program.equipment.length} items, ${pf.size} at Planet Fitness`)
  console.log('Floor and space are assumed everywhere; "carried" items are in the bag (Settings.kit).')
  console.log('')
  const width = Math.max(...program.exercises.map((e) => e.id.length))
  for (const exercise of program.exercises) {
    console.log(`${exercise.id.padEnd(width)}  ${exercise.name}`)
    console.log(`${''.padEnd(width)}  needs ${requirementWords(exercise.requires)}`)
    exercise.stages?.forEach((stage, i) => {
      const more = exercise.stageRequires?.[i] ?? []
      console.log(`${''.padEnd(width)}  stage ${i + 1}, ${stage}: ${more.length === 0 ? 'nothing more' : `also ${requirementWords(more)}`}`)
    })
  }
  const used = new Set(
    program.exercises.flatMap((e) => [...e.requires, ...(e.stageRequires ?? []).flat()]).flatMap((r) => (typeof r === 'string' ? [r] : r.anyOf)),
  )
  console.log('')
  console.log(`On the list, needed by no exercise: ${andList(program.equipment.filter((e) => !used.has(e.id)).map((e) => e.name))}`)
  console.log(`Not on Planet Fitness's list: ${andList(program.equipment.filter((e) => !pf.has(e.id)).map((e) => e.name))}`)
}

function printSession(): void {
  const week = Number(values.week)
  const letterResult = SessionLetter.safeParse((values.session ?? '').toUpperCase())
  if (!Number.isInteger(week) || week < 1 || !letterResult.success) {
    console.error(USAGE)
    process.exit(2)
  }
  const letter = letterResult.data

  const phase = nominalPhaseForWeek(week)
  if (phase.number > 3) {
    console.error(`week ${week} is Phase 4, whose sessions are not written yet`)
    process.exit(2)
  }
  const template = templateFor(phase.number, letter)
  // Nominal schedule: the phase is entered in its scheduled first week. In the app this is state.
  const phaseWeek = phaseWeekOf(week, phase.weekStart)
  const deload = isDeloadWeek(week)
  const injured = program.injuredSide

  function repsText(slot: Slot): string {
    const range = slot.repsMin === slot.repsMax ? `${slot.repsMin}` : `${slot.repsMin}–${slot.repsMax}`
    const unit = { reps: '', seconds: ' s', minutes: ' min', yards: ' yd', steps: ' steps' }[slot.repUnit]
    const side = slot.perSideLabel ? ` ${slot.perSideLabel}` : ''
    return `${range}${unit}${side}`
  }

  function loadText(slot: Slot): string {
    const ex = exerciseById(slot.exerciseId)
    const parts: string[] = []
    switch (ex.loadType) {
      case 'dumbbell-each':
        parts.push(`dumbbells, ${ex.increment} lb steps`)
        break
      case 'dumbbell-single':
        parts.push(`one dumbbell, ${ex.increment} lb steps`)
        break
      case 'stack':
        parts.push(ex.loadDirection === 'down' ? 'assist stack, one plate less is harder' : 'stack, one plate steps')
        break
      case 'smith-plates':
        parts.push(`Smith, track plates, ${ex.increment} lb steps`)
        break
      case 'plates':
        parts.push(`plates, ${ex.increment} lb steps`)
        break
      case 'step-height':
        parts.push(`${slot.heightIn ?? '?'} in. step${slot.heightMaxIn ? ` to ${slot.heightMaxIn} in.` : ''}, ${ex.heightIncrementIn ?? ex.increment} in. risers`)
        if (ex.holdsLoad) parts.push('holds dumbbells')
        break
      case 'band':
        parts.push('mini band')
        break
      case 'bodyweight':
      case 'time':
        parts.push('bodyweight')
        break
    }
    if (slot.rangeStopDeg) parts.push(`range 90° to ${slot.rangeStopDeg}°`)
    if (slot.loadBeforeHeightLb) parts.push(`load to ${slot.loadBeforeHeightLb} lb before height`)
    if (slot.loadNote) parts.push(slot.loadNote)
    return parts.join(' · ')
  }

  const rpe = (slot: Slot) =>
    slot.rpeTarget === undefined ? '' : `, RPE ${slot.rpeTarget}${slot.rpeTargetEnd ? `→${slot.rpeTargetEnd}` : ''}`

  console.log(`${program.title} · Week ${week} · Session ${letter} · Phase ${phase.number}: ${phase.name} (week ${phaseWeek} of the phase)`)
  console.log(deload ? 'Deload week: sets × 2/3 rounded down, minimum 2; loads unchanged; no progression' : 'Not a deload week')
  const circuitMinutes = program.warmUp.lift.circuitMinutesByPhase[String(phase.number)]
  console.log(`Warm-up: ${program.warmUp.lift.intro}`)
  console.log(`Knee circuit this phase: ${circuitMinutes === undefined ? 'not written' : `${circuitMinutes} minutes`}, ${program.warmUp.lift.circuit.length} items`)
  console.log(`Warm-up total with the bike: ${warmUpParts(program.warmUp.lift, phase.number, true).total} minutes, off the top of the time window`)
  console.log('')

  for (const slot of slotsForPhaseWeek(template, phaseWeek)) {
    const ex = exerciseById(slot.exerciseId)
    const sets = prescribedSets(slot.sets, week)
    const setsText = sets === slot.sets ? `${sets}` : `${sets} (deload, from ${slot.sets})`
    const flags = [
      slot.optional ? 'optional' : '',
      slot.unilateral ? `injured (${injured}) ${slot.injuredOnly ? 'side only' : 'side first'}` : '',
      slot.groupId ? `group ${slot.groupId.split('-').slice(1).join('/')}` : '',
      slot.phaseWeeks ? `phase weeks ${slot.phaseWeeks[0]}${slot.phaseWeeks[1] === null ? ' on' : `–${slot.phaseWeeks[1]}`}` : '',
    ].filter(Boolean)
    console.log(`${slot.label.padStart(9)}  ${ex.name}`)
    console.log(`${''.padStart(11)}${setsText} × ${repsText(slot)}${rpe(slot)}   [${slot.prescriptionText}]`)
    console.log(`${''.padStart(11)}${loadText(slot)} · ${slot.progressionRule}${flags.length ? ' · ' + flags.join(' · ') : ''}`)
    if (rampEligible(ex, slot, slot.repUnit, program.warmUp.lift.ramp)) {
      const { percents, reps } = program.warmUp.lift.ramp
      console.log(`${''.padStart(11)}Warm-up sets (not logged): ${percents.map((p, i) => `${reps[i]} at ${p * 100}%`).join(', then ')} of the day's load, rounded down`)
    }
    if (ex.sideMeaning) console.log(`${''.padStart(11)}${ex.sideMeaning}`)
    for (const cue of slot.cues) console.log(`${''.padStart(11)}${cue}`)
    if (ex.stages) console.log(`${''.padStart(11)}Stages: ${ex.stages.join(' → ')}`)
    if (slot.substitutionIds.length) {
      console.log(`${''.padStart(11)}Swap: ${slot.substitutionIds.map((id) => exerciseById(id).name).join(' → ')}`)
    }
    console.log('')
  }
}

if (values.equipment) printEquipment()
else printSession()
