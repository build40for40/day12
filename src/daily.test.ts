import { describe, expect, it, vi } from 'vitest'
import { DailyError, dailyRoute, runDaily } from './daily'
import type { WritePost } from './editor'
import { fakeEnv } from './test-env'
import type { FetchLike } from './types'

// These run against the real evergreen bank that migration 0003 loads.
const now = new Date('2026-11-18T06:00:00Z')

function setup(key = 'fake-key') {
  const env = { ...fakeEnv(), ANTHROPIC_API_KEY: key }
  env.sqlite
    .prepare(`INSERT INTO signups (email, status, confirm_token, unsubscribe_token, created_at) VALUES ('fake.reader@example.com', 'confirmed', 'c', 'u', ?)`)
    .run(now.toISOString())
  const sent: unknown[] = []
  const fetchImpl: FetchLike = async (_url, init) => {
    const messages = JSON.parse(String(init?.body)) as unknown[]
    sent.push(...messages)
    return Response.json(messages.map(() => ({ ErrorCode: 0 })))
  }
  const write = vi.fn<WritePost>(async (_key, record) => ({
    text: 'A short true story about AI helping someone.',
    output: {
      decision: 'write',
      post: `A short true story about AI helping someone. ${record.source_url}`,
      text_length: 44,
      place: 'Somewhere, Earth',
      changes: 'Wrote it.',
      needs_from_source: null,
    },
  }))
  const count = (sql: string) => (env.sqlite.prepare(sql).get() as { n: number }).n
  return { env, sent, fetchImpl, write, count }
}

describe('runDaily', () => {
  it('picks from the bank, writes, sends, and stores the issue for the page', async () => {
    const { env, sent, fetchImpl, write, count } = setup()

    const result = await runDaily(env, { date: '2026-11-18' }, { write, fetchImpl, now })

    expect(result).toMatchObject({ status: 'published', date: '2026-11-18', report: { sent: 1, failed: 0, suppressed: 0 }, place: 'Somewhere, Earth' })
    expect(write).toHaveBeenCalledWith('fake-key', expect.objectContaining({ headline: result.title, source_url: result.url }))
    expect(sent).toHaveLength(1)
    expect(env.sqlite.prepare('SELECT story_id, place FROM issues WHERE date = ?').get('2026-11-18')).toEqual({ story_id: result.storyId, place: 'Somewhere, Earth' })
    expect(env.sqlite.prepare('SELECT status, used_on FROM evergreen WHERE slug = ?').get(result.storyId)).toEqual({ status: 'used', used_on: '2026-11-18' })
    expect(count("SELECT COUNT(*) AS n FROM picks WHERE day = '2026-11-18'")).toBe(1)
  })

  it('does nothing on a second run for the same day', async () => {
    const { env, sent, fetchImpl, write } = setup()
    await runDaily(env, { date: '2026-11-18' }, { write, fetchImpl, now })

    const again = await runDaily(env, { date: '2026-11-18' }, { write, fetchImpl, now })

    expect(again.status).toBe('already_sent')
    expect(write).toHaveBeenCalledTimes(1)
    expect(sent).toHaveLength(1)
  })

  it('says the day already went out even when the key is missing', async () => {
    const { env, fetchImpl, write } = setup()
    await runDaily(env, { date: '2026-11-18' }, { write, fetchImpl, now })

    const again = await runDaily({ ...env, ANTHROPIC_API_KEY: '' }, { date: '2026-11-18' }, { fetchImpl, now })

    expect(again.status).toBe('already_sent')
  })

  it('sends the same story when a run picked but stopped before the email went out', async () => {
    const { env, fetchImpl, write } = setup()
    const failing: FetchLike = async () => {
      throw new Error('network down')
    }
    await expect(runDaily(env, { date: '2026-11-18' }, { write, fetchImpl: failing, now })).rejects.toThrow(DailyError)

    const retry = await runDaily(env, { date: '2026-11-18' }, { write, fetchImpl, now })

    expect(retry.status).toBe('published')
    expect(write.mock.calls[1]![1].headline).toBe(write.mock.calls[0]![1].headline)
  })

  it('previews without sending, picking or storing anything', async () => {
    const { env, sent, fetchImpl, write, count } = setup()

    const result = await runDaily(env, { date: '2026-11-18', dryRun: true }, { write, fetchImpl, now })

    expect(result.status).toBe('preview')
    expect(result.preview?.subject).toBe('Nov 18th - Feel good AI')
    expect(sent).toHaveLength(0)
    expect(count('SELECT COUNT(*) AS n FROM picks')).toBe(0)
    expect(count('SELECT COUNT(*) AS n FROM issues')).toBe(0)
    expect(count("SELECT COUNT(*) AS n FROM evergreen WHERE status = 'used'")).toBe(0)
  })

  it('sends a hand-written post for a named bank story without calling the editor', async () => {
    const { env, fetchImpl, write } = setup('')

    const result = await runDaily(
      env,
      { date: '2026-11-18', storyId: 'monsoon-forecasts-for-farmers', text: '38 million farmers in India got AI monsoon forecasts by text.', place: 'India' },
      { write, fetchImpl, now },
    )

    expect(write).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'published', storyId: 'monsoon-forecasts-for-farmers', place: 'India' })
  })

  it('refuses a hand-written post without a story, and a run with no key', async () => {
    const { env, fetchImpl, write } = setup('')
    await expect(runDaily(env, { date: '2026-11-18', text: 'Some words.' }, { write, fetchImpl, now })).rejects.toThrow('needs a story')
    await expect(runDaily(env, { date: '2026-11-18' }, { fetchImpl, now })).rejects.toThrow('ANTHROPIC_API_KEY')
    // and the missing key didn't use up a story
    expect(env.sqlite.prepare('SELECT COUNT(*) AS n FROM picks').get()).toEqual({ n: 0 })
  })
})

describe('POST /daily', () => {
  it('answers 422 with the reason when the run cannot go ahead', async () => {
    const { env } = setup('')
    const response = await dailyRoute(new Request('https://brief.example.com/daily', { method: 'POST', body: '{"dry_run": true}' }), env, now)
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining('ANTHROPIC_API_KEY') })
  })

  it('answers 400 for a date that is not a date', async () => {
    const { env } = setup()
    const response = await dailyRoute(new Request('https://brief.example.com/daily', { method: 'POST', body: '{"date": "tomorrow"}' }), env, now)
    expect(response.status).toBe(400)
  })
})
