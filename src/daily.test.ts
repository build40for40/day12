import { describe, expect, it, vi } from 'vitest'
import { DailyError, dailyRoute, londonDate, loadStories, pickStory, readerLink, runDaily, type Story } from './daily'
import type { WritePost } from './editor'
import { fakeEnv } from './test-env'
import type { FetchLike } from './types'

const story = (id: string, total: number, extra: Partial<Story> = {}): Story => ({
  id,
  origin: 'evergreen',
  lane: 'good',
  added: null,
  headline: `Headline for ${id}`,
  what_happened: 'Something good happened.',
  why_its_good: 'People are better off.',
  bad_news: null,
  flip_kind: null,
  careful: [],
  topic: 'health',
  stage: 'helping_people_now',
  total,
  sources: ['https://example.org/a'],
  line: null,
  status: 'in_bank',
  published_on: null,
  ...extra,
})

describe('pickStory', () => {
  it('runs fresh news scoring 16 ahead of a higher bank story', () => {
    const stories = [story('bank', 23), story('news', 16, { origin: 'new', status: 'waiting', added: '2026-11-10' })]
    expect(pickStory(stories, '2026-11-18').story.id).toBe('news')
  })

  it('leaves news below 16 or older than 14 days for the bank', () => {
    const stories = [
      story('bank', 12),
      story('weak', 15, { origin: 'new', status: 'waiting', added: '2026-11-17' }),
      story('old', 22, { origin: 'new', status: 'waiting', added: '2026-11-01' }),
    ]
    expect(pickStory(stories, '2026-11-18').story.id).toBe('bank')
  })

  it('takes the best bank story, and the earlier one on a tie', () => {
    expect(pickStory([story('low', 18), story('first', 23), story('second', 23)], '2026-11-18').story.id).toBe('first')
  })

  it('never picks a story that ran or was removed', () => {
    const stories = [story('ran', 24, { status: 'published', published_on: '2026-11-01' }), story('gone', 24, { status: 'removed' }), story('ok', 10)]
    expect(pickStory(stories, '2026-11-18').story.id).toBe('ok')
  })

  it('allows one flip a week', () => {
    const stories = [
      story('old-flip', 20, { origin: 'new', lane: 'flip', status: 'published', added: '2026-11-12', published_on: '2026-11-12' }),
      story('flip', 22, { origin: 'new', lane: 'flip', status: 'waiting', added: '2026-11-17' }),
      story('bank', 15),
    ]
    expect(pickStory(stories, '2026-11-18').story.id).toBe('bank')
    expect(pickStory(stories, '2026-11-19').story.id).toBe('flip')
  })

  it('skips stories with no link a reader can use', () => {
    const stories = [story('eurekalert', 24, { sources: ['https://www.eurekalert.org/news-releases/1'] }), story('ok', 10)]
    expect(pickStory(stories, '2026-11-18').story.id).toBe('ok')
  })

  it('stops when nothing is left', () => {
    expect(() => pickStory([story('ran', 20, { status: 'published' })], '2026-11-18')).toThrow(DailyError)
  })
})

describe('readerLink', () => {
  it('turns a Europe PMC search into the DOI link and drops EurekAlert', () => {
    expect(readerLink('https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:10.1111/1365-2664.13831&resultType=core&format=json')).toBe(
      'https://doi.org/10.1111/1365-2664.13831',
    )
    expect(readerLink('https://www.eurekalert.org/news-releases/1')).toBeNull()
  })
})

describe('londonDate', () => {
  it('gives the London day, including just after midnight in summer', () => {
    expect(londonDate(Date.parse('2026-11-17T06:00:00Z'))).toBe('2026-11-17')
    expect(londonDate(Date.parse('2026-07-01T23:30:00Z'))).toBe('2026-07-02')
  })
})

// The real stories table, loaded by the migration from data/backlog.json.
describe('runDaily against the real backlog', () => {
  const now = new Date('2026-11-18T06:00:00Z')

  function setup() {
    const env = { ...fakeEnv(), ANTHROPIC_API_KEY: 'fake-key' }
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
      output: { decision: 'write', post: `A short true story about AI helping someone. ${record.source_url}`, text_length: 44, place: 'Somewhere, Earth', changes: 'Wrote it.', needs_from_source: null },
    }))
    return { env, sent, fetchImpl, write }
  }

  it('loads every story from the migration', async () => {
    const stories = await loadStories(fakeEnv().DB)
    expect(stories.length).toBeGreaterThan(50)
    expect(stories.every((s) => Array.isArray(s.careful) && Array.isArray(s.sources))).toBe(true)
  })

  it('picks, writes, sends, stores the issue and marks the story', async () => {
    const { env, sent, fetchImpl, write } = setup()

    const result = await runDaily(env, { date: '2026-11-18' }, { write, fetchImpl, now })

    expect(result).toMatchObject({ status: 'published', date: '2026-11-18', report: { sent: 1, failed: 0, suppressed: 0 }, place: 'Somewhere, Earth' })
    expect(write).toHaveBeenCalledWith('fake-key', expect.objectContaining({ headline: expect.any(String), source_url: result.url }))
    expect(sent).toHaveLength(1)
    expect(env.sqlite.prepare('SELECT status, published_on FROM stories WHERE id = ?').get(result.storyId)).toEqual({ status: 'published', published_on: '2026-11-18' })
    expect(env.sqlite.prepare('SELECT story_id, place FROM issues WHERE date = ?').get('2026-11-18')).toEqual({ story_id: result.storyId, place: 'Somewhere, Earth' })
  })

  it('does nothing on a second run for the same day', async () => {
    const { env, sent, fetchImpl, write } = setup()
    await runDaily(env, { date: '2026-11-18' }, { write, fetchImpl, now })

    const again = await runDaily(env, { date: '2026-11-18' }, { write, fetchImpl, now })

    expect(again.status).toBe('already_sent')
    expect(write).toHaveBeenCalledTimes(1)
    expect(sent).toHaveLength(1)
  })

  it('marks the story if the email went out but the run stopped before marking it', async () => {
    const { env, fetchImpl, write } = setup()
    const first = await runDaily(env, { date: '2026-11-18' }, { write, fetchImpl, now })
    env.sqlite.prepare("UPDATE stories SET status = 'waiting', published_on = NULL WHERE id = ?").run(first.storyId)

    await runDaily(env, { date: '2026-11-18' }, { write, fetchImpl, now })

    expect(env.sqlite.prepare('SELECT status FROM stories WHERE id = ?').get(first.storyId)).toEqual({ status: 'published' })
  })

  it('previews without sending, storing or marking anything', async () => {
    const { env, sent, fetchImpl, write } = setup()

    const result = await runDaily(env, { date: '2026-11-18', dryRun: true }, { write, fetchImpl, now })

    expect(result.status).toBe('preview')
    expect(result.preview?.subject).toBe('Nov 18th - Feel good AI')
    expect(sent).toHaveLength(0)
    expect(env.sqlite.prepare("SELECT COUNT(*) AS n FROM stories WHERE status = 'published'").get()).toEqual({ n: 0 })
  })

  it('sends a hand-written post for a named story without calling the editor', async () => {
    const { env, fetchImpl, write } = setup()

    const result = await runDaily(
      env,
      { date: '2026-11-18', storyId: 'dublin-flood-warning', text: 'Dublin starts piloting an AI flood warning this week.', place: 'Dublin, Ireland' },
      { write, fetchImpl, now },
    )

    expect(write).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'published', storyId: 'dublin-flood-warning', place: 'Dublin, Ireland' })
  })

  it('refuses a hand-written post without a story, and a missing key', async () => {
    const { env, fetchImpl, write } = setup()
    await expect(runDaily(env, { date: '2026-11-18', text: 'Some words.' }, { write, fetchImpl, now })).rejects.toThrow(DailyError)
    await expect(runDaily({ ...env, ANTHROPIC_API_KEY: '' }, { date: '2026-11-18' }, { fetchImpl, now })).rejects.toThrow('ANTHROPIC_API_KEY')
  })
})

describe('POST /daily', () => {
  it('answers 422 with the reason when the run cannot go ahead', async () => {
    const env = { ...fakeEnv(), ANTHROPIC_API_KEY: '' }
    const response = await dailyRoute(new Request('https://brief.example.com/daily', { method: 'POST', body: '{"dry_run": true}' }), env)
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining('ANTHROPIC_API_KEY') })
  })
})
