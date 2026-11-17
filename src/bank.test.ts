import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bankHealth, dailyPick, londonDay, refillBank } from './bank'
import { evergreenSeedSql, type BacklogStory } from './bank-seed'
import { fakeD1 } from './fake-d1'

const now = new Date('2026-11-17T06:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString()

function setup() {
  const { db, sqlite } = fakeD1()
  const bank = (slug: string, total: number, status = 'banked', verified: string | null = '2026-11-17') =>
    sqlite
      .prepare(
        `INSERT INTO evergreen (slug, url, title, summary, total, status, verified_at, topic) VALUES (?, ?, ?, 'x', ?, ?, ?, 'health')`,
      )
      .run(slug, `https://example.com/${slug}`, `Bank ${slug}`, total, status, verified)
  const news = (id: number, score: number | null, pulledAt: string) =>
    sqlite
      .prepare(`INSERT INTO candidates (id, url, url_key, title_key, title, summary, source_id, tier, pulled_at, score) VALUES (?, ?, ?, ?, ?, '', 's', 'lead', ?, ?)`)
      .run(id, `https://example.com/n${id}`, `n${id}`, `n${id}`, `News ${id}`, pulledAt, score)
  return { db, sqlite, bank, news }
}

describe('dailyPick', () => {
  it('runs the best banked story when no news is strong enough, and uses it up', async () => {
    const { db, bank, news } = setup()
    bank('a', 20)
    bank('b', 23)
    news(1, 15, daysAgo(1))
    const result = await dailyPick(db, now)
    expect(result).toMatchObject({ status: 'picked', pick: { storyKey: 'evergreen:b', lane: 'evergreen', total: 23 } })
    const next = await dailyPick(db, new Date(now.getTime() + 86_400_000))
    expect(next).toMatchObject({ pick: { storyKey: 'evergreen:a' } })
  })

  it('runs fresh news that scores 16 or more ahead of a higher-scoring bank story', async () => {
    const { db, bank, news, sqlite } = setup()
    bank('a', 24)
    news(1, 16, daysAgo(2))
    news(2, 18, daysAgo(3))
    const result = await dailyPick(db, now)
    expect(result).toMatchObject({ status: 'picked', pick: { storyKey: 'news:2', lane: 'news' } })
    expect(sqlite.prepare("SELECT status FROM evergreen WHERE slug = 'a'").get()).toEqual({ status: 'banked' })
  })

  it('ignores news older than 14 days, unscored news and unchecked bank stories', async () => {
    const { db, bank, news } = setup()
    news(1, 22, daysAgo(15))
    news(2, null, daysAgo(1))
    bank('unchecked', 24, 'banked', null)
    bank('review', 24, 'review')
    expect(await dailyPick(db, now)).toMatchObject({ status: 'nothing_to_run', pick: null })
  })

  it('gives the same answer when asked twice in one day', async () => {
    const { db, bank } = setup()
    bank('a', 20)
    bank('b', 19)
    await dailyPick(db, now)
    expect(await dailyPick(db, now)).toMatchObject({ status: 'already_picked', pick: { storyKey: 'evergreen:a' } })
  })

  it('does not change anything on a dry run', async () => {
    const { db, bank, sqlite } = setup()
    bank('a', 20)
    expect(await dailyPick(db, now, true)).toMatchObject({ status: 'dry_run', pick: { storyKey: 'evergreen:a' } })
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM picks').get()).toEqual({ n: 0 })
    expect(sqlite.prepare("SELECT status FROM evergreen WHERE slug = 'a'").get()).toEqual({ status: 'banked' })
  })

  it('uses the London date for the day', () => {
    expect(londonDay(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02')
    expect(londonDay(new Date('2026-11-17T23:30:00Z'))).toBe('2026-11-17')
  })
})

describe('refillBank', () => {
  it('promotes strong news that has aged out and never ran, to review', async () => {
    const { db, news, sqlite } = setup()
    news(1, 19, daysAgo(20))
    news(2, 15, daysAgo(20))
    news(3, 19, daysAgo(3))
    news(4, 20, daysAgo(20))
    sqlite.exec("INSERT INTO picks VALUES ('2026-10-30', 'news:4', 'news', 'News 4', 20, 'ran', '2026-10-30T06:00:00Z')")
    expect(await refillBank(db, now)).toBe(1)
    const rows = sqlite.prepare('SELECT url, status, total FROM evergreen ORDER BY url').all()
    expect(rows.map((r) => r.url)).toEqual(['https://example.com/n1'])
    expect(rows.every((r) => r.status === 'review')).toBe(true)
    expect(await refillBank(db, now)).toBe(0)
  })

  it('keeps a promoted story out of the picks until it is checked', async () => {
    const { db, news, sqlite } = setup()
    news(1, 19, daysAgo(20))
    await refillBank(db, now)
    expect(await dailyPick(db, now)).toMatchObject({ status: 'nothing_to_run' })
    sqlite.exec("UPDATE evergreen SET status = 'banked', verified_at = '2026-11-17'")
    expect(await dailyPick(db, now)).toMatchObject({ status: 'picked', pick: { lane: 'evergreen' } })
  })
})

describe('bankHealth', () => {
  it('flags a bank below the floor and counts by status and topic', async () => {
    const { db, bank } = setup()
    bank('a', 20)
    bank('b', 20)
    bank('c', 20, 'used')
    bank('d', 20, 'review')
    expect(await bankHealth(db)).toEqual({ ready: 2, review: 1, used: 1, low: true, floor: 20, topics: { health: 2 } })
  })
})

describe('evergreenSeedSql', () => {
  const story = (over: Partial<BacklogStory>): BacklogStory => ({
    id: 'fake-story',
    from: 'evergreen',
    status: 'in_bank',
    headline: "AI finds a fake lab's tool",
    what_happened: 'Fake researchers did a fake thing.',
    why_its_good: 'Fake people are better off.',
    careful: ['Fake caution'],
    topic: 'health',
    technology: 'vision',
    total: 20,
    sources: ['https://example.com/a', 'https://example.com/b'],
    ...over,
  })

  it('loads banked, used and removed stories, and skips news', () => {
    const { sqlite } = setup()
    const sql = evergreenSeedSql(
      [
        story({}),
        story({ id: 'used-one', status: 'published', published_on: '2026-11-12', sources: ['https://example.com/u'] }),
        story({ id: 'gone', status: 'removed', sources: ['https://example.com/g'] }),
        story({ id: 'news-one', from: 'new', sources: ['https://example.com/n'] }),
      ],
      '2026-11-17',
    )
    sqlite.exec(sql)
    expect(sqlite.prepare('SELECT slug, status, used_on FROM evergreen ORDER BY slug').all()).toEqual([
      { slug: 'fake-story', status: 'banked', used_on: null },
      { slug: 'gone', status: 'removed', used_on: null },
      { slug: 'used-one', status: 'used', used_on: '2026-11-12' },
    ])
  })

  it('can be run again without undoing a pick', () => {
    const { sqlite } = setup()
    sqlite.exec(evergreenSeedSql([story({})], '2026-11-17'))
    sqlite.exec("UPDATE evergreen SET status = 'used', used_on = '2026-11-18'")
    sqlite.exec(evergreenSeedSql([story({ headline: 'New wording' })], '2026-11-17'))
    expect(sqlite.prepare('SELECT title, status FROM evergreen').all()).toEqual([{ title: 'New wording', status: 'used' }])
  })

  it('seeds the real bank with at least 20 ready stories', () => {
    const { sqlite } = setup()
    const backlog = JSON.parse(readFileSync('data/backlog.json', 'utf8')) as { updated: string; stories: BacklogStory[] }
    sqlite.exec(evergreenSeedSql(backlog.stories, backlog.updated))
    const ready = sqlite.prepare("SELECT COUNT(*) AS n FROM evergreen WHERE status = 'banked'").get() as { n: number }
    expect(ready.n).toBeGreaterThanOrEqual(20)
  })
})
