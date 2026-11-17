import { checkPost, EditorError, makeWritePost, type EditorOutput, type EditorRecord, type WritePost } from './editor'
import { findIssue, publish } from './publish'
import type { Stage } from './templates'
import type { Env, FetchLike } from './types'

// The rules for the day's pick, from docs/scoring.md, layer 3.
const NEWS_DAYS = 14
const NEWS_FLOOR = 16
const FLIP_DAYS = 7
const MAX_PLACE = 80

export interface Story {
  id: string
  origin: 'new' | 'evergreen'
  lane: 'good' | 'flip'
  added: string | null
  headline: string
  what_happened: string
  why_its_good: string
  bad_news: string | null
  flip_kind: string | null
  careful: string[]
  topic: string
  stage: Stage
  total: number
  sources: string[]
  line: string | null
  status: 'waiting' | 'in_bank' | 'published' | 'removed'
  published_on: string | null
}

export class DailyError extends Error {}

export function londonDate(time: number | Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(time)
}

function daysBetween(earlier: string, later: string): number {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000)
}

export async function loadStories(db: D1Database): Promise<Story[]> {
  const { results } = await db.prepare('SELECT * FROM stories ORDER BY position').all<Record<string, unknown>>()
  return results.map((row) => ({ ...row, careful: JSON.parse(String(row.careful)), sources: JSON.parse(String(row.sources)) }) as unknown as Story)
}

// The link a reader should get for one source, or null. Europe PMC API searches become the paper's DOI link.
export function readerLink(url: string): string | null {
  if (url.includes('eurekalert.org')) return null // its terms restrict reuse, so these need re-sourcing first
  if (url.includes('europepmc/webservices')) {
    const query = URL.canParse(url) ? (new URL(url).searchParams.get('query') ?? '') : ''
    return query.toUpperCase().startsWith('DOI:') ? `https://doi.org/${query.slice(4)}` : null
  }
  if (url.includes('format=json') || url.includes('/api/')) return null
  return url
}

export function sourceUrl(story: Story): string | null {
  for (const url of story.sources) {
    const link = readerLink(url)
    if (link) return link
  }
  return null
}

export function pickStory(stories: Story[], date: string): { story: Story; reason: string } {
  const flipRan = stories.some((s) => s.lane === 'flip' && s.published_on && daysBetween(s.published_on, date) >= 0 && daysBetween(s.published_on, date) < FLIP_DAYS)
  const usable = stories.filter((s) => (s.status === 'waiting' || s.status === 'in_bank') && sourceUrl(s) && !(s.lane === 'flip' && flipRan))

  const news = usable.filter(
    (s) => s.origin === 'new' && s.added && daysBetween(s.added, date) >= 0 && daysBetween(s.added, date) < NEWS_DAYS && s.total >= NEWS_FLOOR,
  )
  if (news.length > 0) {
    const best = news.reduce((a, b) => (b.total > a.total || (b.total === a.total && (b.added ?? '') > (a.added ?? '')) ? b : a))
    return { story: best, reason: `News story from ${best.added} scoring ${best.total} of 24, so it runs ahead of the bank.` }
  }

  const bank = usable.filter((s) => s.origin === 'evergreen' && s.status === 'in_bank')
  if (bank.length === 0) throw new DailyError('Nothing left to run: no news story scores 16 or more and the evergreen bank is empty.')
  const best = bank.reduce((a, b) => (b.total > a.total ? b : a)) // ties go to the earlier story in the backlog
  return { story: best, reason: `No news story from the last ${NEWS_DAYS} days scored ${NEWS_FLOOR} or more, so the best bank story runs: ${best.total} of 24.` }
}

export function editorRecord(story: Story, url: string): EditorRecord {
  const record: EditorRecord = {
    headline: story.headline,
    what_happened: story.what_happened,
    why_its_good: story.why_its_good,
    careful: story.careful,
    stage: story.stage,
    topic: story.topic,
    lane: story.lane,
    source_url: url,
  }
  if (story.lane === 'flip') Object.assign(record, { bad_news: story.bad_news, flip_kind: story.flip_kind })
  if (story.line) record.draft_line = story.line
  return record
}

export interface DailyOptions {
  date: string
  dryRun?: boolean
  force?: boolean
  storyId?: string
  // A post written by a person, used instead of the headline editor. Needs storyId.
  text?: string
  place?: string
}

export interface DailyResult {
  status: 'already_sent' | 'preview' | 'published'
  date: string
  storyId: string
  reason?: string
  text?: string
  url?: string
  place?: string | null
  xPost?: string
  editor?: EditorOutput | null
  report?: { sent: number; failed: number; suppressed: number }
  preview?: { subject: string; text: string }
}

async function markPublished(db: D1Database, storyId: string, date: string): Promise<void> {
  await db.prepare("UPDATE stories SET status = 'published', published_on = ? WHERE id = ?").bind(date, storyId).run()
}

export async function runDaily(
  env: Env,
  options: DailyOptions,
  deps: { write?: WritePost; fetchImpl?: FetchLike; now?: Date } = {},
): Promise<DailyResult> {
  const { date } = options
  if (options.text && !options.storyId) throw new DailyError('A hand-written post needs a story id too, so it goes out with the story it was written for.')

  if (!options.dryRun && !options.force) {
    const sent = await findIssue(env.DB, date)
    if (sent) {
      // If a run sent the email but stopped before marking the story, mark it now.
      await env.DB.prepare("UPDATE stories SET status = 'published', published_on = ? WHERE id = ? AND status != 'published'").bind(date, sent.storyId).run()
      return { status: 'already_sent', date, storyId: sent.storyId }
    }
  }

  const stories = await loadStories(env.DB)
  let story: Story
  let reason: string
  if (options.storyId) {
    const found = stories.find((s) => s.id === options.storyId)
    if (!found) throw new DailyError(`No story with id ${options.storyId}.`)
    if (found.status !== 'waiting' && found.status !== 'in_bank' && !options.force) throw new DailyError(`${found.id} is ${found.status}, so it can't run again without force.`)
    story = found
    reason = 'Chosen by hand.'
  } else {
    ;({ story, reason } = pickStory(stories, date))
  }

  const url = sourceUrl(story)
  if (!url) throw new DailyError(`${story.id} has no link a reader can use. Re-source it first.`)

  let text: string
  let editor: EditorOutput | null = null
  if (options.text) {
    const checked = checkPost(`${options.text} ${url}`, url)
    if ('problem' in checked) throw new DailyError(`The hand-written post was rejected: ${checked.problem}.`)
    text = checked.text
  } else {
    if (!env.ANTHROPIC_API_KEY) throw new DailyError('ANTHROPIC_API_KEY is not set, so the headline editor cannot run. Set the Worker secret, or send a hand-written post.')
    try {
      ;({ text, output: editor } = await (deps.write ?? makeWritePost())(env.ANTHROPIC_API_KEY, editorRecord(story, url)))
    } catch (error) {
      if (error instanceof EditorError) throw new DailyError(error.message)
      throw error
    }
  }

  const rawPlace = options.place ?? editor?.place ?? null
  const place = rawPlace && rawPlace.trim() ? [...rawPlace.trim()].slice(0, MAX_PLACE).join('') : null
  const base = { date, storyId: story.id, reason, text, url, place, xPost: `${text} ${url}`, editor }

  const result = await publish(
    env,
    {
      date,
      story: { id: story.id, headline: story.headline, text, url, stage: story.stage, ...(place ? { place } : {}) },
      dryRun: options.dryRun === true,
      force: options.force === true,
    },
    deps.fetchImpl,
    deps.now,
  )
  switch (result.status) {
    case 'preview':
      return { ...base, status: 'preview', preview: { subject: result.subject, text: result.text } }
    case 'already_published':
      if (result.issue.storyId === story.id) await markPublished(env.DB, story.id, date)
      return { status: 'already_sent', date, storyId: result.issue.storyId }
    case 'failed':
      throw new DailyError(`The email didn't go out: ${result.report.failed} failed, none sent. The day is free to try again.`)
    case 'published':
      await markPublished(env.DB, story.id, date)
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
  const date = typeof body.date === 'string' ? body.date : londonDate(now)
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
