import { describe, expect, it } from 'vitest'
import { dailyPick, refillBank } from './bank'
import { fakeD1 } from './fake-d1'
import { listUnscored, parseVerdict, saveVerdicts } from './scores'

const now = new Date('2026-11-17T06:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString()

function setup() {
  const { db, sqlite } = fakeD1()
  sqlite.exec('DELETE FROM evergreen')
  const news = (id: number, pulledAt: string) =>
    sqlite
      .prepare(`INSERT INTO candidates (id, url, url_key, title_key, title, summary, source_id, tier, pulled_at) VALUES (?, ?, ?, ?, ?, 'A fake summary', 's', 'lead', ?)`)
      .run(id, `https://example.com/n${id}`, `n${id}`, `n${id}`, `Fake news ${id}`, pulledAt)
  return { db, sqlite, news }
}

const pass = (id: number, total = 18) => ({
  id,
  gate: 'pass',
  reason: 'A fake study that passed.',
  total,
  lane: 'good',
  published: daysAgo(1).slice(0, 10),
  topic: 'health',
  stage: 'in_a_trial',
  story: {
    headline: `Checked headline ${id}`,
    what_happened: 'Fake researchers did a fake thing.',
    why_its_good: 'Fake patients are better off.',
    careful: ['Only a pilot'],
    sources: [`https://example.org/paper${id}`],
  },
})

describe('parseVerdict', () => {
  it('accepts a pass, a fail and a triage drop', () => {
    expect(parseVerdict(pass(1))).toMatchObject({ gate: 'pass', total: 18 })
    expect(parseVerdict({ id: 2, gate: 'fail', failed_gate: 'evidence', reason: 'Preprint.' })).toMatchObject({ failedGate: 'evidence' })
    expect(parseVerdict({ id: 3, gate: 'triage', reason: 'A funding round.' })).toMatchObject({ gate: 'triage' })
  })

  it('rejects a pass with a bad score, topic, stage, missing handoff or no source link', () => {
    expect(parseVerdict({ ...pass(1), total: 25 })).toBeNull()
    expect(parseVerdict({ ...pass(1), topic: 'sport' })).toBeNull()
    expect(parseVerdict({ ...pass(1), stage: 'rumour' })).toBeNull()
    expect(parseVerdict({ ...pass(1), story: { ...pass(1).story, why_its_good: '' } })).toBeNull()
    expect(parseVerdict({ ...pass(1), story: { ...pass(1).story, sources: ['not a link'] } })).toBeNull()
    expect(parseVerdict({ id: 'x', gate: 'pass' })).toBeNull()
  })
})

describe('listUnscored and saveVerdicts', () => {
  it('lists only unscored stories from the last 14 days, and never lists one twice', async () => {
    const { db, news } = setup()
    news(1, daysAgo(1))
    news(2, daysAgo(2))
    news(3, daysAgo(20))
    expect((await listUnscored(db, now)).map((c) => c.id)).toEqual([1, 2])
    expect(await saveVerdicts(db, { verdicts: [pass(1), { id: 2, gate: 'triage', reason: 'Industry news.' }] }, now)).toEqual({ saved: 2, rejected: 0 })
    expect(await listUnscored(db, now)).toEqual([])
  })

  it('only gives passes a score, and keeps the first verdict', async () => {
    const { db, sqlite, news } = setup()
    news(1, daysAgo(1))
    news(2, daysAgo(1))
    await saveVerdicts(db, { verdicts: [pass(1), { id: 2, gate: 'fail', failed_gate: 'happened', reason: 'Only a plan.' }, { id: 9, bad: true }] }, now)
    expect(await saveVerdicts(db, { verdicts: [pass(2, 24)] }, now)).toEqual({ saved: 0, rejected: 0 })
    expect(sqlite.prepare('SELECT id, gate, score, tags FROM candidates ORDER BY id').all()).toEqual([
      { id: 1, gate: 'pass', score: 18, tags: 'health' },
      { id: 2, gate: 'fail', score: null, tags: null },
    ])
  })
})

describe('a scored story in the daily pick', () => {
  it('uses first publication dates, keeps the checked flip handoff and caps flips across seven dates', async () => {
    const { db, news } = setup()
    for (const id of [1, 2, 3, 4]) news(id, daysAgo(1))
    const flip = (id: number, score: number) => {
      const base = pass(id, score)
      return { ...base, lane: 'flip', flip_kind: 'system_responding',
        story: { ...base.story, bad_news: 'The bad news.', sources: [...base.story.sources, 'https://example.org/coverage'] } }
    }
    await saveVerdicts(db, { verdicts: [
      flip(1, 23), flip(2, 20), pass(3, 18), { ...pass(4, 24), published: daysAgo(18).slice(0, 10) },
    ] }, now)
    expect(await dailyPick(db, now)).toMatchObject({ record: { id: 'news-1', lane: 'flip', badNews: 'The bad news.' } })
    expect(await dailyPick(db, new Date(+now + 86_400_000))).toMatchObject({ record: { id: 'news-3' } })
    expect(await dailyPick(db, new Date(+now + 7 * 86_400_000))).toMatchObject({ record: { id: 'news-2' } })
  })

  it('runs ahead of the bank with the checked handoff, not the feed text', async () => {
    const { db, sqlite, news } = setup()
    sqlite.exec(`INSERT INTO evergreen (slug, url, title, summary, score, status) VALUES ('b', 'https://example.com/b', 'Bank', 'x', 24, 'banked')`)
    news(1, daysAgo(1))
    await saveVerdicts(db, { verdicts: [pass(1)] }, now)
    expect(await dailyPick(db, now)).toMatchObject({
      pick: { storyKey: 'news:1', lane: 'news' },
      record: { headline: 'Checked headline 1', whyItsGood: 'Fake patients are better off.', careful: ['Only a pilot'], topic: 'health', stage: 'in_a_trial', sourceUrl: 'https://example.org/paper1' },
    })
  })

  it('moves a strong story that never ran into the bank for review, handoff included', async () => {
    const { db, sqlite, news } = setup()
    news(1, daysAgo(20))
    sqlite.exec(`UPDATE candidates SET scored_at = '${daysAgo(19)}', gate = 'pass', score = 19, stage = 'in_a_trial', tags = 'health', story = '${JSON.stringify({ ...pass(1).story, lane: 'good', published: daysAgo(20).slice(0, 10) })}'`)
    expect(await refillBank(db, now)).toBe(1)
    expect(sqlite.prepare('SELECT title, why_its_good, topic, status FROM evergreen').get()).toEqual({
      title: 'Checked headline 1',
      why_its_good: 'Fake patients are better off.',
      topic: 'health',
      status: 'review',
    })
  })
})
