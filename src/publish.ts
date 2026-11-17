import { publicUrl, sendNewsletter, type NewsletterReport } from './emails'
import { readText } from './fetchers/http'
import { MAX_STORY_CHARS, renderNewsletter, type NewsletterStory, type Stage } from './templates'
import type { Env, FetchLike } from './types'

const MAX_PUBLISH_BYTES = 16_384
const STAGES: Stage[] = ['in_the_lab', 'in_a_trial', 'helping_people_now']
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_PLACE_CHARS = 80

export interface PublishRequest {
  date: string
  story: { id: string; headline?: string; text: string; url: string; stage?: Stage; place?: string }
  dryRun: boolean
  force: boolean
}

export interface Issue {
  date: string
  storyId: string
  headline: string | null
  text: string
  url: string
  stage: Stage | null
  place: string | null
  createdAt: string
}

type Parsed = { ok: true; request: PublishRequest } | { ok: false; error: string }

export function parsePublish(body: unknown): Parsed {
  const b = (body ?? {}) as Record<string, unknown>
  const s = (b.story ?? {}) as Record<string, unknown>
  if (typeof b.date !== 'string' || !DATE.test(b.date) || Number.isNaN(Date.parse(b.date))) return { ok: false, error: 'bad_date' }
  if (typeof s.id !== 'string' || s.id.length === 0) return { ok: false, error: 'bad_story_id' }
  if (typeof s.text !== 'string' || s.text.trim().length === 0 || [...s.text].length > MAX_STORY_CHARS) return { ok: false, error: 'bad_text' }
  if (typeof s.url !== 'string' || !/^https?:\/\//.test(s.url) || !URL.canParse(s.url)) return { ok: false, error: 'bad_url' }
  if (s.stage !== undefined && !STAGES.includes(s.stage as Stage)) return { ok: false, error: 'bad_stage' }
  if (s.headline !== undefined && typeof s.headline !== 'string') return { ok: false, error: 'bad_headline' }
  if (s.place != null && (typeof s.place !== 'string' || [...s.place].length > MAX_PLACE_CHARS)) return { ok: false, error: 'bad_place' }
  const story: PublishRequest['story'] = { id: s.id, text: s.text.trim(), url: s.url }
  if (typeof s.headline === 'string') story.headline = s.headline
  if (s.stage !== undefined) story.stage = s.stage as Stage
  if (typeof s.place === 'string' && s.place.trim()) story.place = s.place.trim()
  return { ok: true, request: { date: b.date, story, dryRun: b.dry_run === true, force: b.force === true } }
}

// The issue is dated by its London day, but rendered at noon UTC so the subject line never slips a day.
function issueDate(date: string): Date {
  return new Date(`${date}T12:00:00Z`)
}

function toIssue(row: Record<string, unknown>): Issue {
  return {
    date: String(row.date),
    storyId: String(row.story_id),
    headline: (row.headline as string | null) ?? null,
    text: String(row.text),
    url: String(row.url),
    stage: (row.stage as Stage | null) ?? null,
    place: (row.place as string | null) ?? null,
    createdAt: String(row.created_at),
  }
}

export async function findLatestIssue(db: D1Database): Promise<Issue | null> {
  return (await listIssues(db, 1))[0] ?? null
}

// The dates of the issues just before and just after a date, for the page's earlier and later links.
export async function findNeighbours(db: D1Database, date: string): Promise<{ previous: string | null; next: string | null }> {
  const row = await db
    .prepare('SELECT (SELECT MAX(date) FROM issues WHERE date < ?1) AS previous, (SELECT MIN(date) FROM issues WHERE date > ?1) AS next')
    .bind(date)
    .first<{ previous: string | null; next: string | null }>()
  return { previous: row?.previous ?? null, next: row?.next ?? null }
}

export async function findIssue(db: D1Database, date: string): Promise<Issue | null> {
  const row = await db.prepare('SELECT * FROM issues WHERE date = ?').bind(date).first<Record<string, unknown>>()
  return row ? toIssue(row) : null
}

export async function listIssues(db: D1Database, limit = 30): Promise<Issue[]> {
  const { results } = await db.prepare('SELECT * FROM issues ORDER BY date DESC LIMIT ?').bind(limit).all<Record<string, unknown>>()
  return results.map(toIssue)
}

export type PublishResult =
  | { status: 'preview'; subject: string; html: string; text: string }
  | { status: 'already_published'; issue: Issue }
  | { status: 'published'; issue: Issue; report: NewsletterReport }
  | { status: 'failed'; report: NewsletterReport }

export async function publish(env: Env, request: PublishRequest, fetchImpl?: FetchLike, now = new Date()): Promise<PublishResult> {
  const story: NewsletterStory = { text: request.story.text, url: request.story.url }
  if (request.story.stage) story.stage = request.story.stage
  const rendered = renderNewsletter([story], issueDate(request.date), publicUrl(env))
  if (request.dryRun) return { status: 'preview', ...rendered }

  const existing = await findIssue(env.DB, request.date)
  if (existing && !request.force) return { status: 'already_published', issue: existing }

  // Claim the date before sending, so two runs at once can't both send.
  const createdAt = now.toISOString()
  const claim = await env.DB.prepare(
    `INSERT INTO issues (date, story_id, headline, text, url, stage, place, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (date) DO UPDATE SET story_id = excluded.story_id, headline = excluded.headline, text = excluded.text,
        url = excluded.url, stage = excluded.stage, place = excluded.place, created_at = excluded.created_at,
        sent = NULL, failed = NULL, suppressed = NULL
      WHERE ?`,
  )
    .bind(
      request.date,
      request.story.id,
      request.story.headline ?? null,
      story.text,
      story.url,
      story.stage ?? null,
      request.story.place ?? null,
      createdAt,
      request.force ? 1 : 0,
    )
    .run()
  if ((claim.meta.changes ?? 0) === 0) {
    const raced = await findIssue(env.DB, request.date)
    if (raced) return { status: 'already_published', issue: raced }
  }

  const release = () => env.DB.prepare('DELETE FROM issues WHERE date = ? AND created_at = ?').bind(request.date, createdAt).run()
  let report: NewsletterReport
  try {
    report = await sendNewsletter(env, { subject: rendered.subject, html: rendered.html, text: rendered.text }, fetchImpl, now)
  } catch (error) {
    await release()
    throw error
  }
  // Postmark reports a dead connection as failed messages, not an error. If nothing got through, free the date for a retry.
  if (report.sent === 0 && report.failed > 0) {
    await release()
    return { status: 'failed', report }
  }
  await env.DB.prepare('UPDATE issues SET sent = ?, failed = ?, suppressed = ? WHERE date = ?')
    .bind(report.sent, report.failed, report.suppressed, request.date)
    .run()

  return { status: 'published', issue: (await findIssue(env.DB, request.date))!, report }
}

export async function publishRoute(request: Request, env: Env, fetchImpl?: FetchLike, now = new Date()): Promise<Response> {
  let body: unknown
  try {
    body = JSON.parse(await readText(new Response(request.body, { headers: request.headers }), MAX_PUBLISH_BYTES))
  } catch {
    return Response.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }
  const parsed = parsePublish(body)
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 })
  if (!parsed.request.dryRun && !env.POSTMARK_SERVER_TOKEN) return Response.json({ ok: false, error: 'not_configured' }, { status: 503 })

  try {
    const result = await publish(env, parsed.request, fetchImpl, now)
    switch (result.status) {
      case 'preview':
        return Response.json({ ok: true, preview: { subject: result.subject, html: result.html, text: result.text } })
      case 'already_published':
        return Response.json({ ok: false, error: 'already_published', issue: result.issue }, { status: 409 })
      case 'published':
        return Response.json({ ok: true, issue: result.issue, report: result.report })
      case 'failed':
        return Response.json({ ok: false, error: 'send_failed', report: result.report }, { status: 502 })
    }
  } catch (error) {
    console.error(`publish failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    return Response.json({ ok: false, error: 'send_failed' }, { status: 502 })
  }
}

function publicHeaders(request: Request, env: Env): Record<string, string> {
  const headers: Record<string, string> = { 'Cache-Control': 'public, max-age=300', Vary: 'Origin' }
  if (request.headers.get('Origin') === env.ALLOWED_ORIGIN) headers['Access-Control-Allow-Origin'] = env.ALLOWED_ORIGIN
  return headers
}

export async function latestIssueRoute(request: Request, env: Env): Promise<Response> {
  const [issue] = await listIssues(env.DB, 1)
  if (!issue) return Response.json({ ok: false, error: 'no_issues' }, { status: 404, headers: publicHeaders(request, env) })
  return Response.json({ ok: true, issue }, { headers: publicHeaders(request, env) })
}

export async function issuesRoute(request: Request, env: Env): Promise<Response> {
  return Response.json({ ok: true, issues: await listIssues(env.DB, 30) }, { headers: publicHeaders(request, env) })
}
