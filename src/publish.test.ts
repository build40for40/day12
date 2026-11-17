import { describe, expect, it } from 'vitest'
import { latestIssueRoute, parsePublish, publishRoute } from './publish'
import { fakeEnv } from './test-env'
import type { Env, FetchLike } from './types'

const now = new Date('2026-11-18T06:00:00Z')
const BASE = 'https://brief.example.com'

const story = {
  id: 'japan-ai-lost-property-keio',
  headline: 'A Tokyo railway returned nearly three times as many lost items',
  text: 'A Tokyo railway used AI to match lost umbrellas and bags to their owners, and by its own count returned nearly three times as many.',
  url: 'https://www.tokyoupdates.metro.tokyo.lg.jp/en/post-1641/',
  stage: 'in_a_trial',
}

function postmark(): { batches: unknown[][]; fetchImpl: FetchLike } {
  const batches: unknown[][] = []
  return {
    batches,
    fetchImpl: async (_url, init) => {
      const messages = JSON.parse(String(init?.body)) as unknown[]
      batches.push(messages)
      return Response.json(messages.map(() => ({ ErrorCode: 0 })))
    },
  }
}

function subscribe(env: ReturnType<typeof fakeEnv>, email: string, status = 'confirmed'): void {
  env.sqlite
    .prepare(`INSERT INTO signups (email, status, confirm_token, unsubscribe_token, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(email, status, crypto.randomUUID(), crypto.randomUUID(), now.toISOString())
}

const call = (env: Env, body: unknown, fetchImpl: FetchLike) =>
  publishRoute(new Request(`${BASE}/publish`, { method: 'POST', body: JSON.stringify(body) }), env, fetchImpl, now)

describe('parsePublish', () => {
  it('accepts a full request', () => {
    expect(parsePublish({ date: '2026-11-18', story })).toMatchObject({ ok: true, request: { date: '2026-11-18', dryRun: false, force: false } })
  })

  it.each([
    [{ date: '18 Nov', story }, 'bad_date'],
    [{ date: '2026-11-18', story: { ...story, id: '' } }, 'bad_story_id'],
    [{ date: '2026-11-18', story: { ...story, text: 'x'.repeat(281) } }, 'bad_text'],
    [{ date: '2026-11-18', story: { ...story, url: 'ftp://example.com' } }, 'bad_url'],
    [{ date: '2026-11-18', story: { ...story, stage: 'soon' } }, 'bad_stage'],
  ])('rejects %j with %s', (body, error) => {
    expect(parsePublish(body)).toEqual({ ok: false, error })
  })
})

describe('POST /publish', () => {
  it('previews without sending or storing on a dry run', async () => {
    const env = fakeEnv()
    subscribe(env, 'fake.reader@example.com')
    const { batches, fetchImpl } = postmark()

    const response = await call(env, { date: '2026-11-18', story, dry_run: true }, fetchImpl)
    const body = (await response.json()) as { preview: { subject: string; text: string } }

    expect(response.status).toBe(200)
    expect(body.preview.subject).toBe('Nov 18th - Feel good AI')
    expect(body.preview.text).toContain(story.text)
    expect(batches).toHaveLength(0)
    expect(env.sqlite.prepare('SELECT COUNT(*) AS n FROM issues').get()).toEqual({ n: 0 })
  })

  it('sends to confirmed subscribers only and records the issue', async () => {
    const env = fakeEnv()
    subscribe(env, 'fake.reader@example.com')
    subscribe(env, 'fake.pending@example.com', 'pending')
    const { batches, fetchImpl } = postmark()

    const response = await call(env, { date: '2026-11-18', story }, fetchImpl)
    const body = (await response.json()) as { report: unknown; issue: { storyId: string } }

    expect(response.status).toBe(200)
    expect(body.report).toEqual({ sent: 1, failed: 0, suppressed: 0 })
    expect(body.issue.storyId).toBe(story.id)
    expect(batches[0]).toHaveLength(1)
    expect(batches[0]![0]).toMatchObject({ To: 'fake.reader@example.com', Subject: 'Nov 18th - Feel good AI' })
  })

  it('refuses to send the same date twice unless forced', async () => {
    const env = fakeEnv()
    subscribe(env, 'fake.reader@example.com')
    const { batches, fetchImpl } = postmark()

    await call(env, { date: '2026-11-18', story }, fetchImpl)
    const again = await call(env, { date: '2026-11-18', story }, fetchImpl)
    expect(again.status).toBe(409)
    expect(batches).toHaveLength(1)

    const forced = await call(env, { date: '2026-11-18', story, force: true }, fetchImpl)
    expect(forced.status).toBe(200)
    expect(batches).toHaveLength(2)
  })

  it('frees the date again when the send fails', async () => {
    const env = fakeEnv()
    subscribe(env, 'fake.reader@example.com')
    const failing: FetchLike = async () => {
      throw new Error('network down')
    }

    const response = await call(env, { date: '2026-11-18', story }, failing)

    expect(response.status).toBe(502)
    expect(env.sqlite.prepare('SELECT COUNT(*) AS n FROM issues').get()).toEqual({ n: 0 })
  })

  it('rejects a bad body', async () => {
    const env = fakeEnv()
    const response = await publishRoute(new Request(`${BASE}/publish`, { method: 'POST', body: 'not json' }), env, postmark().fetchImpl, now)
    expect(response.status).toBe(400)
  })
})

describe('GET /issues/latest', () => {
  it('returns 404 before anything is published, then the newest issue', async () => {
    const env = fakeEnv()
    subscribe(env, 'fake.reader@example.com')
    const request = () => new Request(`${BASE}/issues/latest`, { headers: { Origin: 'https://site.example.com' } })

    expect((await latestIssueRoute(request(), env)).status).toBe(404)

    await call(env, { date: '2026-11-18', story }, postmark().fetchImpl)
    const response = await latestIssueRoute(request(), env)

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://site.example.com')
    expect(await response.json()).toMatchObject({ ok: true, issue: { date: '2026-11-18', text: story.text, url: story.url, stage: 'in_a_trial', place: null } })
  })

  it('stores the place line when one is given', async () => {
    const env = fakeEnv()
    subscribe(env, 'fake.reader@example.com')

    await call(env, { date: '2026-11-18', story: { ...story, place: ' Tokyo, Japan ' } }, postmark().fetchImpl)
    const response = await latestIssueRoute(new Request(`${BASE}/issues/latest`), env)

    expect(await response.json()).toMatchObject({ issue: { place: 'Tokyo, Japan' } })
  })
})
