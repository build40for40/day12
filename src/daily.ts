import { dailyPick, londonDay, refillBank } from './bank'
import { checkPost, EditorError, makeWritePost, type EditorOutput, type EditorRecord, type WritePost } from './editor'
import { findIssue, publish } from './publish'
import type { Stage } from './templates'
import type { Env, FetchLike, StoryRecord } from './types'

const STAGES: Stage[] = ['in_the_lab', 'in_a_trial', 'helping_people_now']
const MAX_PLACE = 80

export class DailyError extends Error {}

export interface DailyOptions {
  date: string
  dryRun?: boolean
  force?: boolean
  // A banked story's slug, run instead of the pick.
  storyId?: string
  // A post written by a person, used instead of the headline editor. Needs storyId.
  text?: string
  place?: string
}

export interface DailyResult {
  status: 'already_sent' | 'preview' | 'published'
  date: string
  storyId: string
  title?: string
  reason?: string
  text?: string
  url?: string
  place?: string | null
  xPost?: string
  editor?: EditorOutput | null
  report?: { sent: number; failed: number; suppressed: number }
  preview?: { subject: string; text: string }
}

function editorRecord(record: StoryRecord, url: string): EditorRecord {
  return {
    headline: record.headline,
    what_happened: record.whatHappened,
    why_its_good: record.whyItsGood,
    careful: record.careful,
    stage: record.stage,
    topic: record.topic,
    lane: record.lane,
    source_url: url,
    ...(record.lane === 'flip' ? { bad_news: record.badNews ?? null, flip_kind: record.flipKind ?? null } : {}),
  }
}

/**
 * The day's story, start to finish: the pick in src/bank.ts chooses it, the headline editor writes the post,
 * and the same path as POST /publish emails it and stores the issue for the landing page.
 * A day that has already gone out is left alone, and the pick gives the same story if asked twice in a day,
 * so a run that stopped part way can simply be run again.
 */
export async function runDaily(
  env: Env,
  options: DailyOptions,
  deps: { write?: WritePost; fetchImpl?: FetchLike; now?: Date } = {},
): Promise<DailyResult> {
  const { date } = options
  const now = deps.now ?? new Date()
  if (options.text && !options.storyId) throw new DailyError('A hand-written post needs a story too, so it goes out with the story it was written for.')
  if (!options.dryRun && !options.force) {
    const sent = await findIssue(env.DB, date)
    if (sent) return { status: 'already_sent', date, storyId: sent.storyId }
  }

  // Checked before the pick, so a missing key doesn't use up a story.
  if (!options.text && !env.ANTHROPIC_API_KEY) {
    throw new DailyError('ANTHROPIC_API_KEY is not set, so the headline editor cannot run. Set the Worker secret, or send a hand-written post.')
  }

  // The pick dates by the London day of the time it's given, so noon on the date is that date.
  const picked = await dailyPick(env.DB, new Date(`${date}T12:00:00Z`), {
    dryRun: options.dryRun === true,
    ...(options.storyId ? { story: options.storyId } : {}),
  })
  if (picked.status === 'nothing_to_run') {
    throw new DailyError(options.storyId ? `No banked story called ${options.storyId}.` : 'Nothing to run: no news story scores 16 or more and the bank is empty.')
  }
  if (!picked.record) throw new DailyError(`The pick for ${date} (${picked.pick.storyKey}) has no story record any more.`)
  if (options.storyId && picked.pick.storyKey !== `evergreen:${options.storyId}`) {
    throw new DailyError(`${date} is already picked: ${picked.pick.title}. Run that day without a story, or pick another date.`)
  }
  const record = picked.record
  const url = record.sourceUrl
  if (!url) throw new DailyError(`${record.id} has no link a reader can use. Re-source it first.`)

  let text: string
  let editor: EditorOutput | null = null
  if (options.text) {
    const checked = checkPost(`${options.text} ${url}`, url)
    if ('problem' in checked) throw new DailyError(`The hand-written post was rejected: ${checked.problem}.`)
    text = checked.text
  } else {
    try {
      ;({ text, output: editor } = await (deps.write ?? makeWritePost())(env.ANTHROPIC_API_KEY!, editorRecord(record, url)))
    } catch (error) {
      if (error instanceof EditorError) throw new DailyError(error.message)
      throw error
    }
  }

  const rawPlace = options.place ?? editor?.place ?? null
  const place = rawPlace && rawPlace.trim() ? [...rawPlace.trim()].slice(0, MAX_PLACE).join('') : null
  const stage = STAGES.includes(record.stage as Stage) ? (record.stage as Stage) : undefined
  const base = { date, storyId: record.id, title: picked.pick.title, reason: picked.pick.reason, text, url, place, xPost: `${text} ${url}`, editor }

  const result = await publish(
    env,
    {
      date,
      story: { id: record.id, headline: record.headline, text, url, ...(stage ? { stage } : {}), ...(place ? { place } : {}) },
      dryRun: options.dryRun === true,
      force: options.force === true,
    },
    deps.fetchImpl,
    now,
  )
  switch (result.status) {
    case 'preview':
      return { ...base, status: 'preview', preview: { subject: result.subject, text: result.text } }
    case 'already_published':
      return { status: 'already_sent', date, storyId: result.issue.storyId }
    case 'failed':
      throw new DailyError(`The email didn't go out: ${result.report.failed} failed, none sent. Run the day again to retry.`)
    case 'published':
      await refillBank(env.DB, now) // as POST /pick does: aged-out news that scored well goes in for review
      return { ...base, status: 'published', report: result.report }
  }
}

// POST /daily, behind the same token as /pull: run the day by hand, or preview it with dry_run.
export async function dailyRoute(request: Request, env: Env, now = new Date()): Promise<Response> {
  let body: Record<string, unknown> = {}
  const raw = await request.text()
  if (raw.trim()) {
    try {
      body = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return Response.json({ ok: false, error: 'bad_json' }, { status: 400 })
    }
  }
  const date = typeof body.date === 'string' ? body.date : londonDay(now)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return Response.json({ ok: false, error: 'bad_date' }, { status: 400 })
  const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
  const options: DailyOptions = { date, dryRun: body.dry_run === true, force: body.force === true }
  const storyId = str(body.story)
  const text = str(body.text)
  const place = str(body.place)
  if (storyId) options.storyId = storyId
  if (text) options.text = text
  if (place) options.place = place

  try {
    return Response.json({ ok: true, ...(await runDaily(env, options, { now })) })
  } catch (error) {
    if (error instanceof DailyError) return Response.json({ ok: false, error: error.message }, { status: 422 })
    throw error
  }
}
