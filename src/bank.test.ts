import { describe, expect, it } from 'vitest'
import { bankHealth, dailyPick, londonDay, refillBank } from './bank'
import { fakeD1 } from './fake-d1'

const now = new Date('2026-11-17T06:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString()

function setup(keepMigratedBank = false) {
  const { db, sqlite } = fakeD1()
  if (!keepMigratedBank) sqlite.exec('DELETE FROM evergreen')
  const bank = (slug: string, total: number, status = 'banked', verified: string | null = '2026-11-17') =>
    sqlite
      .prepare(
        `INSERT INTO evergreen (slug, url, title, summary, score, status, verified_at, topic) VALUES (?, ?, ?, 'x', ?, ?, ?, 'health')`,
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

  it('ignores news older than 14 days, unscored news and stories still in review', async () => {
    const { db, bank, news } = setup()
    news(1, 22, daysAgo(15))
    news(2, null, daysAgo(1))
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
    const rows = sqlite.prepare('SELECT url, status, score FROM evergreen ORDER BY url').all()
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

describe('the bank from the migrations', () => {
  it('starts with at least 20 ready stories, none used', async () => {
    const { db, sqlite } = setup(true)
    const health = await bankHealth(db)
    expect(health.ready).toBeGreaterThanOrEqual(20)
    expect(health).toMatchObject({ low: false, used: 0, review: 0 })
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM evergreen WHERE last_used_at IS NOT NULL').get()).toEqual({ n: 0 })
  })
})
