import type { WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runDaily, type DailyDeps } from './daily'
import { EditorError, type WritePost } from './editor'
import { ScoringError, type ScoreLead } from './scorer'
import { fakeEnv } from './test-env'
import type { FetchLike, PullReport } from './types'

// These run against the real evergreen bank that migration 0003 loads.
const date = '2026-11-18'
const quiet = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() })

// Runs each step at once, with as many attempts as its retry limit allows, like the Workflows engine minus the waiting.
function fakeStep() {
  const names: string[] = []
  const step = {
    do: async (name: string, config: WorkflowStepConfig, callback: () => Promise<unknown>) => {
      names.push(name)
      let last: unknown
      for (let attempt = 0; attempt <= (config.retries?.limit ?? 5); attempt++) {
        try {
          return await callback()
        } catch (error) {
          last = error
          if (error instanceof NonRetryableError) break
        }
      }
      throw last
    },
  } as unknown as WorkflowStep
  return { step, names }
}

const passing = (id: number) => ({
  id,
  gate: 'pass',
  reason: 'A fake study that passed.',
  total: 18,
  lane: 'good',
  published: '2026-11-17',
  topic: 'health',
  stage: 'in_a_trial',
  story: { headline: 'Checked headline', what_happened: 'Fake researchers did a fake thing.', why_its_good: 'Fake patients are better off.', careful: [], sources: ['https://example.org/paper'] },
})

function setup() {
  const env = { ...fakeEnv(), ANTHROPIC_API_KEY: 'fake-key' }
  env.sqlite
    .prepare(`INSERT INTO signups (email, status, confirm_token, unsubscribe_token, created_at) VALUES ('fake.reader@example.com', 'confirmed', 'c', 'u', '2026-11-01T00:00:00Z')`)
    .run()
  const lead = (id: number) =>
    env.sqlite
      .prepare(`INSERT INTO candidates (id, url, url_key, title_key, title, summary, source_id, tier, pulled_at) VALUES (?, ?, ?, ?, 'A fake lead', 'Fake.', 's', 'lead', '2026-11-18T06:00:00Z')`)
      .run(id, `https://example.com/n${id}`, `n${id}`, `n${id}`)
  const emails: unknown[] = []
  const postmark = vi.fn<FetchLike>(async (_url, init) => {
    const messages = JSON.parse(String(init?.body)) as unknown[]
    emails.push(...messages)
    return Response.json(messages.map(() => ({ ErrorCode: 0 })))
  })
  const report: PullReport = { startedAt: '', sources: [{ sourceId: 'fake', fetched: 1, kept: 1, stored: 1 }], stored: 1 }
  const deps = {
    pull: vi.fn(async () => report),
    scoreLead: vi.fn<ScoreLead>(async (candidate) => passing(candidate.id)),
    writePost: vi.fn<WritePost>(async (_key, record) => ({
      text: 'A short true story about AI helping someone.',
      output: { decision: 'write', post: `A short true story about AI helping someone. ${record.source_url}`, text_length: 44, place: 'Somewhere, Earth', changes: 'Wrote it.', needs_from_source: null },
    })),
    fetchImpl: postmark,
    log: quiet(),
  } satisfies DailyDeps
  const count = (sql: string) => (env.sqlite.prepare(sql).get() as { n: number }).n
  return { env, lead, emails, postmark, deps, count }
}

describe('runDaily', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-18T06:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('pulls, scores, picks, writes and sends in that order, and a fresh news story beats the bank', async () => {
    const { env, lead, emails, deps } = setup()
    lead(1)
    const { step, names } = fakeStep()

    const summary = await runDaily(env, { date }, step, deps)

    expect(names).toEqual(['check today is not sent', 'pull', 'find new leads', 'score lead 1', 'pick', 'write', 'publish', 'refill the bank'])
    expect(summary).toMatchObject({ status: 'published', storyId: 'news-1', leads: [{ id: 1, outcome: 'saved', total: 18 }], report: { sent: 1 } })
    expect(emails).toHaveLength(1)
    expect(env.sqlite.prepare('SELECT story_id, place FROM issues WHERE date = ?').get(date)).toEqual({ story_id: 'news-1', place: 'Somewhere, Earth' })
  })

  it('does nothing on a second run for the same date', async () => {
    const { env, emails, deps } = setup()
    await runDaily(env, { date }, fakeStep().step, deps)
    const again = fakeStep()

    const summary = await runDaily(env, { date }, again.step, deps)

    expect(summary.status).toBe('already_sent')
    expect(again.names).toEqual(['check today is not sent'])
    expect(deps.writePost).toHaveBeenCalledTimes(1)
    expect(emails).toHaveLength(1)
  })

  it('still sends from the bank when the pull fails and the leads cannot be scored', async () => {
    const { env, lead, emails, deps, count } = setup()
    lead(1)
    lead(2)
    deps.pull.mockRejectedValue(new Error('D1 is down'))
    deps.scoreLead.mockImplementation(async (candidate) => {
      throw candidate.id === 1 ? new ScoringError('Required evidence was not fetched') : new Error('overloaded')
    })

    const summary = await runDaily(env, { date }, fakeStep().step, deps)

    expect(summary).toMatchObject({ status: 'published', pull: 'failed', pick: { storyKey: expect.stringMatching(/^evergreen:/) } })
    expect(summary.leads?.map((l) => l.outcome)).toEqual(['deferred', 'deferred'])
    // The unusable answer isn't paid for twice, the overloaded API gets one more try.
    expect(deps.scoreLead).toHaveBeenCalledTimes(3)
    expect(count('SELECT COUNT(*) AS n FROM candidates WHERE scored_at IS NULL')).toBe(2)
    expect(emails).toHaveLength(1)
  })

  it('previews a dry run without pulling, saving verdicts, picking or sending', async () => {
    const { env, lead, emails, deps, count } = setup()
    lead(1)

    const summary = await runDaily(env, { date, dryRun: true }, fakeStep().step, deps)

    expect(summary).toMatchObject({ status: 'preview', pull: 'skipped', leads: [{ id: 1, outcome: 'previewed' }], preview: { subject: 'Nov 18th - Feel good AI' } })
    expect(deps.pull).not.toHaveBeenCalled()
    expect(emails).toHaveLength(0)
    expect(count('SELECT COUNT(*) AS n FROM candidates WHERE scored_at IS NOT NULL')).toBe(0)
    expect(count('SELECT COUNT(*) AS n FROM picks') + count('SELECT COUNT(*) AS n FROM issues')).toBe(0)
    expect(count("SELECT COUNT(*) AS n FROM evergreen WHERE status = 'used'")).toBe(0)
  })

  it('stops before the pick when the Anthropic key is missing, so no story is used up', async () => {
    const { env, deps, count } = setup()

    await expect(runDaily({ ...env, ANTHROPIC_API_KEY: '' }, { date }, fakeStep().step, deps)).rejects.toThrow('ANTHROPIC_API_KEY')
    expect(count('SELECT COUNT(*) AS n FROM picks')).toBe(0)
  })

  it('stops when the post cannot be written, and a rerun sends the story that was picked', async () => {
    const { env, emails, deps } = setup()
    const working = deps.writePost.getMockImplementation()!
    deps.writePost.mockRejectedValueOnce(new EditorError('The model declined to write this story.'))

    await expect(runDaily(env, { date }, fakeStep().step, deps)).rejects.toThrow('declined')
    expect(deps.writePost).toHaveBeenCalledTimes(1)
    expect(deps.log.error).toHaveBeenCalledWith('daily 2026-11-18 stopped at write: The model declined to write this story.')
    const first = env.sqlite.prepare('SELECT story_key FROM picks WHERE day = ?').get(date)
    deps.writePost.mockImplementation(working)

    const summary = await runDaily(env, { date }, fakeStep().step, deps)

    expect(summary.pick).toMatchObject({ status: 'already_picked', storyKey: (first as { story_key: string }).story_key })
    expect(emails).toHaveLength(1)
  })

  it('does not retry a failed send, and leaves the date free for a rerun', async () => {
    const { env, deps, postmark, count } = setup()
    postmark.mockResolvedValue(Response.json({ ErrorCode: 500, Message: 'down' }, { status: 500 }))

    await expect(runDaily(env, { date }, fakeStep().step, deps)).rejects.toThrow("The email didn't go out")
    expect(postmark).toHaveBeenCalledTimes(1)
    expect(count('SELECT COUNT(*) AS n FROM issues')).toBe(0)
  })

  it('runs a named bank story without scoring, giving the editor its draft line', async () => {
    const { env, lead, deps } = setup()
    lead(1)

    const summary = await runDaily(env, { date, story: 'monsoon-forecasts-for-farmers' }, fakeStep().step, deps)

    expect(summary).toMatchObject({ status: 'published', storyId: 'monsoon-forecasts-for-farmers', leads: [] })
    expect(deps.scoreLead).not.toHaveBeenCalled()
    expect(deps.writePost.mock.calls[0]![1].draft_line).toMatch(/^38 million farmers/)
  })
})
