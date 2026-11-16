import { KOOS_SUBSCALES, KOOS_SUBSCALE_ITEMS, KOOS_SUBSCALE_WORDS, koosNeeded, koosReplacesToday, koosSeries, type KoosSubscale } from '../rules/koos.ts'
import type { IsoDate, KoosEntry } from '../schema/index.ts'
import { shortDateWords } from './Today.helpers.ts'

/**
 * Pure helpers for the KOOS questionnaire screen (Batch A; PROGRAM-QUESTIONS 158): the 42 items
 * TRANSCRIBED from the official English KOOS LK1.0 (koos.nu; verified against the published
 * form), grouped as the form groups them, each answered by ticking one of five worded boxes
 * scored 0 to 4 left to right as the published scoring reads them — S4 and S5 run Always→Never,
 * the reverse of S1–S3, and P1 and Q1 carry frequency anchors, so the options live per question
 * and are never "simplified" to one shared set. Skips are allowed (the published missing-data
 * rule absorbs them); the Save summary says in words which subscales will score. Scoring is
 * src/rules/koos.ts's alone, and the score shows on Progress only, never on Gates.
 */

export type KoosField = keyof Omit<KoosEntry, 'date'>

export interface KoosQuestion {
  field: KoosField
  /** The item's number as the form prints it: "S4", "P1", "A12". */
  label: string
  /** The published stem, verbatim. */
  text: string
  /** The five worded boxes, left to right, scored 0 to 4 in this order. */
  options: readonly [string, string, string, string, string]
}

/** One display block, as the published form groups the items; `subscale` is the scoring bucket its items feed. */
export interface KoosFormSection {
  name: string
  /** The form's own instruction line for the block, verbatim or near. */
  instruction: string
  subscale: KoosSubscale
  questions: readonly KoosQuestion[]
}

const FREQ = ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'] as const
/** S4 and S5: the published anchors run the other way, so the ticked box still scores 0 to 4 left to right. */
const CAN = ['Always', 'Often', 'Sometimes', 'Rarely', 'Never'] as const
const SEVERITY = ['None', 'Mild', 'Moderate', 'Severe', 'Extreme'] as const
const PAIN_FREQ = ['Never', 'Monthly', 'Weekly', 'Daily', 'Always'] as const

const q = (field: KoosField, label: string, text: string, options: KoosQuestion['options']): KoosQuestion => ({ field, label, text, options })

/** The form, block by block, in the published order. The stiffness items score into Symptoms, as the published scoring has it. */
export const KOOS_FORM_SECTIONS: readonly KoosFormSection[] = [
  {
    name: 'Symptoms',
    instruction: 'These questions should be answered thinking of your knee symptoms during the last week.',
    subscale: 'symptoms',
    questions: [
      q('sy1', 'S1', 'Do you have swelling in your knee?', FREQ),
      q('sy2', 'S2', 'Do you feel grinding, hear clicking or any other type of noise when your knee moves?', FREQ),
      q('sy3', 'S3', 'Does your knee catch or hang up when moving?', FREQ),
      q('sy4', 'S4', 'Can you straighten your knee fully?', CAN),
      q('sy5', 'S5', 'Can you bend your knee fully?', CAN),
    ],
  },
  {
    name: 'Stiffness',
    instruction:
      'The following questions concern the amount of joint stiffness you have experienced during the last week in your knee. Stiffness is a sensation of restriction or slowness in the ease with which you move your knee joint.',
    subscale: 'symptoms',
    questions: [
      q('sy6', 'S6', 'How severe is your knee joint stiffness after first wakening in the morning?', SEVERITY),
      q('sy7', 'S7', 'How severe is your knee stiffness after sitting, lying or resting later in the day?', SEVERITY),
    ],
  },
  {
    // P1 carries its own frequency anchors and sits before the activities instruction, as the published form has it.
    name: 'Pain',
    instruction: '',
    subscale: 'pain',
    questions: [q('p1', 'P1', 'How often do you experience knee pain?', PAIN_FREQ)],
  },
  {
    name: '',
    instruction: 'What amount of knee pain have you experienced the last week during the following activities?',
    subscale: 'pain',
    questions: [
      q('p2', 'P2', 'Twisting/pivoting on your knee', SEVERITY),
      q('p3', 'P3', 'Straightening knee fully', SEVERITY),
      q('p4', 'P4', 'Bending knee fully', SEVERITY),
      q('p5', 'P5', 'Walking on flat surface', SEVERITY),
      q('p6', 'P6', 'Going up or down stairs', SEVERITY),
      q('p7', 'P7', 'At night while in bed', SEVERITY),
      q('p8', 'P8', 'Sitting or lying', SEVERITY),
      q('p9', 'P9', 'Standing upright', SEVERITY),
    ],
  },
  {
    name: 'Function, daily living',
    instruction:
      'The following questions concern your physical function. By this we mean your ability to move around and to look after yourself. For each of the following activities please indicate the degree of difficulty you have experienced in the last week due to your knee.',
    subscale: 'adl',
    questions: [
      q('a1', 'A1', 'Descending stairs', SEVERITY),
      q('a2', 'A2', 'Ascending stairs', SEVERITY),
      q('a3', 'A3', 'Rising from sitting', SEVERITY),
      q('a4', 'A4', 'Standing', SEVERITY),
      q('a5', 'A5', 'Bending to floor/pick up an object', SEVERITY),
      q('a6', 'A6', 'Walking on flat surface', SEVERITY),
      q('a7', 'A7', 'Getting in/out of car', SEVERITY),
      q('a8', 'A8', 'Going shopping', SEVERITY),
      q('a9', 'A9', 'Putting on socks/stockings', SEVERITY),
      q('a10', 'A10', 'Rising from bed', SEVERITY),
      q('a11', 'A11', 'Taking off socks/stockings', SEVERITY),
      q('a12', 'A12', 'Lying in bed (turning over, maintaining knee position)', SEVERITY),
      q('a13', 'A13', 'Getting in/out of bath', SEVERITY),
      q('a14', 'A14', 'Sitting', SEVERITY),
      q('a15', 'A15', 'Getting on/off toilet', SEVERITY),
      q('a16', 'A16', 'Heavy domestic duties (moving heavy boxes, scrubbing floors, etc)', SEVERITY),
      q('a17', 'A17', 'Light domestic duties (cooking, dusting, etc)', SEVERITY),
    ],
  },
  {
    name: 'Function, sports and recreational activities',
    instruction:
      'The following questions concern your physical function when being active on a higher level. The questions should be answered thinking of what degree of difficulty you have experienced during the last week due to your knee.',
    subscale: 'sport',
    questions: [
      q('sp1', 'SP1', 'Squatting', SEVERITY),
      q('sp2', 'SP2', 'Running', SEVERITY),
      q('sp3', 'SP3', 'Jumping', SEVERITY),
      q('sp4', 'SP4', 'Twisting/pivoting on your injured knee', SEVERITY),
      q('sp5', 'SP5', 'Kneeling', SEVERITY),
    ],
  },
  {
    name: 'Quality of Life',
    instruction: '',
    subscale: 'qol',
    questions: [
      q('q1', 'Q1', 'How often are you aware of your knee problem?', ['Never', 'Monthly', 'Weekly', 'Daily', 'Constantly']),
      q('q2', 'Q2', 'Have you modified your life style to avoid potentially damaging activities to your knee?', ['Not at all', 'Mildly', 'Moderately', 'Severely', 'Totally']),
      q('q3', 'Q3', 'How much are you troubled with lack of confidence in your knee?', ['Not at all', 'Mildly', 'Moderately', 'Severely', 'Extremely']),
      q('q4', 'Q4', 'In general, how much difficulty do you have with your knee?', SEVERITY),
    ],
  },
]

/** Every question in form order, for the draft and the entry. */
export const KOOS_QUESTIONS: readonly KoosQuestion[] = KOOS_FORM_SECTIONS.flatMap((s) => s.questions)

/** What the top of the form says: the official instructions, plus the last-week recall and where scores show. */
export const KOOS_LEAD =
  'This survey asks for your view about your knee, over the last week. Answer each question by ticking one box — tick the box that fits best, and if you are unsure, give the best answer you can. A question can be skipped; a subscale scores only with at least half its questions answered. Scores show on Progress, never on Gates.'

/** The answers being tapped: a field absent is a skip. */
export type KoosAnswers = Readonly<Partial<Record<KoosField, number>>>

/** The answers with one changed; tapping the ticked box again clears it back to skipped. */
export function withKoosAnswer(answers: KoosAnswers, field: KoosField, value: number): KoosAnswers {
  if (answers[field] === value) {
    const { [field]: _cleared, ...rest } = answers
    void _cleared
    return rest
  }
  return { ...answers, [field]: value }
}

/** How many questions the form has answered so far. */
export function koosAnsweredCount(answers: KoosAnswers): number {
  return KOOS_QUESTIONS.filter((question) => answers[question.field] !== undefined).length
}

/** Why Save waits, or null: an entry with nothing answered holds nothing, so one answer is the floor; skips are otherwise fine. */
export function koosFormBlocker(answers: KoosAnswers): string | null {
  return koosAnsweredCount(answers) === 0 ? 'Answer at least one question to save' : null
}

/**
 * The Save summary, one line per subscale: which will score and which have too few answers
 * (the published rule: at least half the subscale's items), in words, before anything is saved.
 */
export function koosSaveSummary(answers: KoosAnswers): string[] {
  return KOOS_SUBSCALES.map((subscale) => {
    const fields = KOOS_SUBSCALE_ITEMS[subscale]
    const answered = fields.filter((f) => answers[f] !== undefined).length
    const need = koosNeeded(subscale)
    const name = KOOS_SUBSCALE_WORDS[subscale]
    if (answered >= need) return `${name} will score (${answered} of ${fields.length} answered).`
    return `${name} won’t score (${answered} of ${fields.length} answered — it needs ${need}).`
  })
}

/** The entry a save writes: today's date and every answered box, skips left out. */
export function buildKoosEntry(answers: KoosAnswers, today: IsoDate): KoosEntry {
  const entry: { date: IsoDate } & Partial<Record<KoosField, number>> = { date: today }
  for (const question of KOOS_QUESTIONS) {
    const value = answers[question.field]
    if (value !== undefined) entry[question.field] = value
  }
  return entry
}

/** The same-day replace line (the 154 pattern); null with no entry today. */
export function koosReplaceLine(entries: readonly KoosEntry[], today: IsoDate): string | null {
  return koosReplacesToday(entries, today) ? 'Today already has an entry. Saving replaces it.' : null
}

/** The stored entries in words, newest first: the date and how much was answered; the scores live on Progress. */
export function koosEntryRows(entries: readonly KoosEntry[]): { date: IsoDate; words: string }[] {
  return koosSeries(entries)
    .map((e) => {
      const answered = KOOS_QUESTIONS.filter((question) => e[question.field] !== undefined).length
      return { date: e.date, words: `${dateInWords(e.date)} — ${answered} of 42 answered; scores on Progress` }
    })
    .reverse()
}

// ---------------------------------------------------------------------------------------------
// The resumable draft (PROGRAM-QUESTIONS 158): localStorage, keyed per date, written on every
// answer, cleared on Save. It lives UNDER the runner's SWAP_KEY_PREFIX so `forgetSwaps` clears
// it on Reset all data and on an import — wiped answers never resurface in the form — and a
// stale draft for a past date is dropped on open. Never a Dexie row: the tables hold one
// completed entry per day.
// ---------------------------------------------------------------------------------------------

/** Must extend src/db/repo.ts's SWAP_KEY_PREFIX ('knee-rebuild:swaps:'), which forgetSwaps clears; a test pins the two together. */
export const KOOS_DRAFT_PREFIX = 'knee-rebuild:swaps:koos-draft:'

/** The slice of Storage the draft touches, so tests hand in a plain fake. */
export interface DraftStore {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** A stored draft read back as answers: only known fields, each a whole 0 to 4; anything else is dropped, never guessed. */
export function cleanKoosDraft(raw: unknown): KoosAnswers {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const answers: Partial<Record<KoosField, number>> = {}
  for (const question of KOOS_QUESTIONS) {
    const value = (raw as Record<string, unknown>)[question.field]
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4) answers[question.field] = value
  }
  return answers
}

/** Today's draft, or nothing; a failed read is an empty form, never an error. */
export function readKoosDraft(store: DraftStore, today: IsoDate): KoosAnswers {
  try {
    const raw = store.getItem(`${KOOS_DRAFT_PREFIX}${today}`)
    return raw === null ? {} : cleanKoosDraft(JSON.parse(raw))
  } catch {
    return {}
  }
}

/** Writes the draft on every answer, so a phone interruption loses nothing; an empty form removes it. */
export function writeKoosDraft(store: DraftStore, today: IsoDate, answers: KoosAnswers): void {
  try {
    const key = `${KOOS_DRAFT_PREFIX}${today}`
    if (koosAnsweredCount(answers) === 0) store.removeItem(key)
    else store.setItem(key, JSON.stringify(answers))
  } catch {
    // Private browsing: the form still works, it just won't survive a reload.
  }
}

/** Drops every draft that isn't today's (a stale draft for a past date), called on open; Save clears today's too. */
export function dropOtherKoosDrafts(store: DraftStore, today: IsoDate): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (key?.startsWith(KOOS_DRAFT_PREFIX) && key !== `${KOOS_DRAFT_PREFIX}${today}`) keys.push(key)
    }
    for (const key of keys) store.removeItem(key)
  } catch {
    // Private browsing: nothing was stored.
  }
}

/** Takes today's draft out, after a save. */
export function clearKoosDraft(store: DraftStore, today: IsoDate): void {
  try {
    store.removeItem(`${KOOS_DRAFT_PREFIX}${today}`)
  } catch {
    // Private browsing: nothing was stored.
  }
}

function dateInWords(date: string): string {
  try {
    return shortDateWords(date)
  } catch {
    return date
  }
}
