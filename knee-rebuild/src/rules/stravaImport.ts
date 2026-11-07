import { RUN_HR_MAX, RUN_HR_MIN, type IsoDate, type RunType } from '../schema/index.ts'

/*
 * What an activity from Strava becomes in the app (Shawn's Nov 6 ask; PROGRAM-QUESTIONS 142). Strava
 * can supply the day, distance, time and a perceived effort; it can never supply max pain, which the
 * reading needs and which only Shawn knows, so an activity is never saved on its own: it opens the run
 * logger filled in, and Save waits on the pain like any run, and on the effort when Strava has none
 * (it is never guessed: an unrated effort would read as a rated one in training load). Runs,
 * elliptical and rowing map onto the run logger; a strength activity points at "Log this session after the fact"; everything else is
 * left out with the reason. An activity already logged (its Strava link on a run) is not offered again.
 */

/** The fields of a Strava SummaryActivity the import reads. */
export interface StravaActivity {
  id: number
  name?: string
  sport_type?: string
  /** Strava's older field, read when sport_type is absent. */
  type?: string
  /** Meters. */
  distance: number
  /** Seconds. */
  moving_time: number
  elapsed_time?: number
  /** Local wall time with a misleading "Z" on the end: only its first ten characters are the day. */
  start_date_local: string
  /** 1 to 10, only on a detailed activity, when the athlete set it. */
  perceived_exertion?: number | null
  /** On a run: 0 default, 1 race, 2 long run, 3 workout. */
  workout_type?: number | null
  /** The watch's whole-activity average heart rate, bpm, when Strava has one (metrics phase 2). */
  average_heartrate?: number | null
  /** The watch's max heart rate on the activity, bpm, when Strava has one. */
  max_heartrate?: number | null
}

const METERS_PER_MILE = 1609.344

export function stravaActivityUrl(id: number | string): string {
  return `https://www.strava.com/activities/${id}`
}

/** The activity id in a Strava link the run logger stored, or null for any other text. */
export function stravaIdFromUrl(url: string | undefined): string | null {
  if (!url) return null
  const m = /^https:\/\/(?:www\.)?strava\.com\/activities\/(\d+)(?:[/?#].*)?$/.exec(url.trim())
  return m?.[1] ?? null
}

/** The Strava activities the app already holds, by id, from the runs' Strava links. */
export function importedStravaIds(runs: readonly { stravaUrl?: string }[]): Set<string> {
  return new Set(runs.map((r) => stravaIdFromUrl(r.stravaUrl)).filter((id): id is string => id !== null))
}

/** The day an activity happened on, as the athlete's clock read it (never through Date: the "Z" would move a late run to the next day). */
export function activityDate(activity: Pick<StravaActivity, 'start_date_local'>): IsoDate {
  return activity.start_date_local.slice(0, 10)
}

/** Strava's perceived exertion as the run logger's whole RPE, rounded and kept from 1 to 10; null when Strava has none. */
export function rpeFromExertion(exertion: number | null | undefined): number | null {
  if (exertion === null || exertion === undefined || !Number.isFinite(exertion) || exertion <= 0) return null
  return Math.min(10, Math.max(1, Math.round(exertion)))
}

/** A watch heart rate as the run's whole-bpm field: rounded, or null when absent, not a number, or outside 30–250 after rounding (a misread is dropped, never clamped into a number nobody measured). */
function hrValue(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return null
  const rounded = Math.round(raw)
  return rounded >= RUN_HR_MIN && rounded <= RUN_HR_MAX ? rounded : null
}

/**
 * The heart-rate pair a draft carries (metrics phase 2): each number rounded and kept only inside
 * 30–250 — one out of range drops alone, the other is kept — and a rounded average above the max
 * drops BOTH: a garbage watch pair is never saved as typed, and optional HR never blocks Save, so
 * dropping loses nothing.
 */
export function hrFromStrava(average: number | null | undefined, max: number | null | undefined): { avgHr: number | null; maxHr: number | null } {
  const avgHr = hrValue(average)
  const maxHr = hrValue(max)
  if (avgHr !== null && maxHr !== null && avgHr > maxHr) return { avgHr: null, maxHr: null }
  return { avgHr, maxHr }
}

const RUNS = new Set(['Run', 'TrailRun', 'VirtualRun'])
const LIFTS = new Set(['WeightTraining', 'Workout', 'Crossfit'])

/** What the run logger opens filled in with. */
export interface RunDraft {
  date: IsoDate
  type: RunType
  miles: number
  minutes: number
  /** Effort as RPE 1 to 10, or null for Shawn to rate. */
  rpe: number | null
  /** Average heart rate, whole bpm, when the watch had a usable one; null is "no heart rate", never 0 (metrics phase 2). */
  avgHr: number | null
  /** Max heart rate on the activity, same deal. */
  maxHr: number | null
  stravaUrl: string
  notes: string
}

export type Candidate =
  /**
   * A run, elliptical or rowing session for the run logger. `needs` is what Save waits on (max pain,
   * which only Shawn knows, and the effort when Strava has none); `guessed` is what the draft filled
   * in by default, for him to check.
   */
  | { kind: 'run'; activityId: string; draft: RunDraft; needs: ('max pain' | 'effort')[]; guessed: 'type'[] }
  /** A strength activity: logged as a session after the fact, from that day's preview. */
  | { kind: 'lift'; activityId: string; date: IsoDate; name: string }
  /** Not something the program logs, or outside the days that can be logged. */
  | { kind: 'skip'; activityId: string; date: IsoDate; name: string; reason: string }

export interface ClassifyContext {
  /** The days a run can be logged for (the run logger's `dateChoices`). */
  dates: readonly IsoDate[]
  /** The run the schedule puts on a day (mbr, easy, long), or null. */
  scheduledRun: (date: IsoDate) => RunType | null
}

/** One activity as the import offers it. */
export function classify(activity: StravaActivity, ctx: ClassifyContext): Candidate {
  const activityId = String(activity.id)
  const date = activityDate(activity)
  const name = (activity.name ?? '').trim()
  const sport = activity.sport_type ?? activity.type ?? ''
  const label = name || sport || 'An activity'
  const isRun = RUNS.has(sport)
  const swap: RunType | null = sport === 'Elliptical' ? 'elliptical-swap' : sport === 'Rowing' || sport === 'VirtualRow' ? 'rower-swap' : null
  if (LIFTS.has(sport)) return { kind: 'lift', activityId, date, name: label }
  if (!isRun && swap === null) return { kind: 'skip', activityId, date, name: label, reason: `${sport || 'This activity'} isn’t a run, swap or lift the program logs.` }
  if (!ctx.dates.includes(date)) return { kind: 'skip', activityId, date, name: label, reason: 'It is older than the days a run can be logged for.' }
  const scheduled = ctx.scheduledRun(date)
  const type: RunType = swap ?? (activity.workout_type === 2 ? 'long' : (scheduled ?? 'easy'))
  const rpe = rpeFromExertion(activity.perceived_exertion)
  const guessed: 'type'[] = []
  if (isRun && activity.workout_type !== 2 && scheduled === null) guessed.push('type')
  // Strava's activity list carries no exertion (only a detailed activity does), so the effort nearly always waits for Shawn.
  const needs: ('max pain' | 'effort')[] = rpe === null ? ['max pain', 'effort'] : ['max pain']
  // Heart rate never waits on Shawn: optional fields, filled when the watch had them (metrics phase 2).
  const hr = hrFromStrava(activity.average_heartrate, activity.max_heartrate)
  return {
    kind: 'run',
    activityId,
    draft: {
      date,
      type,
      miles: swap ? 0 : Math.round((activity.distance / METERS_PER_MILE) * 100) / 100,
      minutes: Math.round(activity.moving_time) / 60,
      rpe,
      avgHr: hr.avgHr,
      maxHr: hr.maxHr,
      stravaUrl: stravaActivityUrl(activityId),
      notes: name,
    },
    needs,
    guessed,
  }
}

/** The activities to offer, newest first, without the ones already logged. */
export function candidates(activities: readonly StravaActivity[], imported: ReadonlySet<string>, ctx: ClassifyContext): Candidate[] {
  return [...activities]
    .filter((a) => !imported.has(String(a.id)))
    .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))
    .map((a) => classify(a, ctx))
}

/** The `after` a sync asks Strava for: midnight UTC on the earliest day that can be logged, in epoch seconds. */
export function syncAfter(dates: readonly IsoDate[]): number | null {
  const first = dates[0]
  return first ? Math.floor(Date.parse(`${first}T00:00:00Z`) / 1000) - 86_400 : null
}
