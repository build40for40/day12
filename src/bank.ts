import type { BankHealth, Pick, PickResult, StoryRecord } from './types'

// Rules from docs/scoring.md, "The daily pick".
export const NEWS_MIN_SCORE = 16
export const NEWS_WINDOW_DAYS = 14
// A story that scored this well in the news but didn't run is good enough for the bank.
export const PROMOTE_MIN_SCORE = 16
// Below this many ready stories the bank is thin: three weeks at one a day.
export const BANK_FLOOR = 20

const DAY = 86_400_000

interface PickRow {
  day: string
  story_key: string
  lane: string
  title: string
  total: number
  reason: string
}

const toPick = (row: PickRow): Pick => ({
  day: row.day,
  storyKey: row.story_key,
  lane: row.lane === 'news' ? 'news' : 'evergreen',
  title: row.title,
  total: row.total,
  reason: row.reason,
})

/** The London date, like 2026-11-17, which is what a "day" means to readers. */
export function londonDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now)
}

/** The headline of the bank story that stands in for a day with no issue yet. It moves on one story a day. */
export async function standInFor(db: D1Database, day: string): Promise<string | null> {
  const { results } = await db.prepare("SELECT title FROM evergreen WHERE status = 'banked' ORDER BY id ASC").all<{ title: string }>()
  if (results.length === 0) return null
  const dayNumber = Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000)
  return results[dayNumber % results.length]!.title
}

/** The link a reader should get for one source, or null. Mirrors reader_link in scripts/daily.py. */
export function readerLink(url: string): string | null {
  if (url.includes('eurekalert.org')) return null // its terms restrict reuse, so these need re-sourcing
  if (url.includes('europepmc/webservices')) {
    const query = URL.canParse(url) ? (new URL(url).searchParams.get('query') ?? '') : ''
    return /^doi:/i.test(query) ? `https://doi.org/${query.slice(4)}` : null
  }
  if (url.includes('format=json') || url.includes('/api/')) return null
  return url
}

function usableLink(sources: unknown): string | null {
  let list: unknown = sources
  if (typeof sources === 'string') {
    try {
      list = JSON.parse(sources)
    } catch {
      list = [sources]
    }
  }
  for (const url of Array.isArray(list) ? list : []) {
    const link = typeof url === 'string' ? readerLink(url) : null
    if (link) return link
  }
  return null
}

interface NewsRow { id: number; title: string; summary: string; url: string; score: number }
interface BankRow { slug: string; title: string; summary: string; why_its_good: string | null; careful: string | null; sources: string | null; url: string; stage: string | null; topic: string | null; total: number }

const BANK_COLUMNS = 'slug, title, summary, why_its_good, careful, sources, url, stage, topic, score AS total'

async function topNews(db: D1Database, now: Date): Promise<NewsRow | null> {
  const rows = await db
    .prepare(
      `SELECT id, title, summary, url, score FROM candidates
       WHERE score >= ? AND pulled_at >= ? AND 'news:' || id NOT IN (SELECT story_key FROM picks)
       ORDER BY score DESC, pulled_at DESC LIMIT 20`,
    )
    .bind(NEWS_MIN_SCORE, new Date(now.getTime() - NEWS_WINDOW_DAYS * DAY).toISOString())
    .all<NewsRow>()
  return rows.results.find((r) => readerLink(r.url)) ?? null
}

/** The best banked story a reader can be given a link for. `slug` forces one by hand. */
async function topBank(db: D1Database, slug?: string): Promise<BankRow | null> {
  const rows = slug
    ? await db.prepare(`SELECT ${BANK_COLUMNS} FROM evergreen WHERE status = 'banked' AND slug = ?`).bind(slug).all<BankRow>()
    : await db.prepare(`SELECT ${BANK_COLUMNS} FROM evergreen WHERE status = 'banked' ORDER BY score DESC, id ASC`).all<BankRow>()
  return rows.results.find((r) => usableLink(r.sources ?? [r.url])) ?? null
}

const bankRecord = (r: BankRow): StoryRecord => ({
  id: r.slug,
  headline: r.title,
  whatHappened: r.summary,
  whyItsGood: r.why_its_good,
  careful: r.careful ? (JSON.parse(r.careful) as string[]) : [],
  stage: r.stage,
  topic: r.topic,
  lane: 'good',
  sourceUrl: usableLink(r.sources ?? [r.url]),
})

const newsRecord = (r: NewsRow): StoryRecord => ({
  id: `news-${r.id}`,
  headline: r.title,
  whatHappened: r.summary || r.title,
  whyItsGood: null,
  careful: [],
  stage: null,
  topic: null,
  lane: 'good',
  sourceUrl: readerLink(r.url),
})

async function recordFor(db: D1Database, storyKey: string): Promise<StoryRecord | null> {
  if (storyKey.startsWith('news:')) {
    const row = await db.prepare('SELECT id, title, summary, url, score FROM candidates WHERE id = ?').bind(Number(storyKey.slice(5))).first<NewsRow>()
    return row ? newsRecord(row) : null
  }
  const row = await db.prepare(`SELECT ${BANK_COLUMNS} FROM evergreen WHERE slug = ?`).bind(storyKey.slice('evergreen:'.length)).first<BankRow>()
  return row ? bankRecord(row) : null
}

/**
 * Picks the one story for the day. Asking twice for the same day returns the same answer, so a run that
 * died after picking can be run again without burning a second story. A fresh news story scoring 16 or
 * more runs first; otherwise the best banked story runs and the bank gives it up for good.
 * `story` forces a banked story by slug. Stories with no link a reader can use are skipped.
 */
export async function dailyPick(db: D1Database, now: Date, options: { dryRun?: boolean; story?: string } = {}): Promise<PickResult> {
  const { dryRun = false, story } = options
  const day = londonDay(now)
  const existing = await db.prepare('SELECT * FROM picks WHERE day = ?').bind(day).first<PickRow>()
  if (existing) return { day, status: 'already_picked', pick: toPick(existing), record: await recordFor(db, existing.story_key) }

  const [news, bank] = await Promise.all([story ? null : topNews(db, now), topBank(db, story)])
  const considered = {
    news: news ? { title: news.title, total: news.score } : null,
    bank: bank ? { title: bank.title, total: bank.total } : null,
  }
  if (!news && !bank) return { day, status: 'nothing_to_run', pick: null, record: null, considered }

  const pick: Pick = news
    ? {
        day,
        storyKey: `news:${news.id}`,
        lane: 'news',
        title: news.title,
        total: news.score,
        reason: bank
          ? `A news story scoring ${news.score} runs ahead of the bank, whose best is ${bank.total}.`
          : `A news story scoring ${news.score}, and the bank is empty.`,
      }
    : {
        day,
        storyKey: `evergreen:${bank!.slug}`,
        lane: 'evergreen',
        title: bank!.title,
        total: bank!.total,
        reason: story
          ? 'Chosen by hand.'
          : `No news story scored ${NEWS_MIN_SCORE} or more in the last ${NEWS_WINDOW_DAYS} days, so the best banked story runs.`,
      }
  const record = news ? newsRecord(news) : bankRecord(bank!)
  if (dryRun) return { day, status: 'dry_run', pick, record, considered }

  const written = await db
    .prepare('INSERT OR IGNORE INTO picks (day, story_key, lane, title, total, reason, picked_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(day, pick.storyKey, pick.lane, pick.title, pick.total, pick.reason, now.toISOString())
    .run()
  if (written.meta.changes === 0) {
    // Someone picked this day while we were deciding.
    const winner = await db.prepare('SELECT * FROM picks WHERE day = ?').bind(day).first<PickRow>()
    if (winner) return { day, status: 'already_picked', pick: toPick(winner), record: await recordFor(db, winner.story_key) }
    throw new Error('pick was not saved')
  }
  if (bank && !news) {
    await db
      .prepare("UPDATE evergreen SET status = 'used', used_on = ?, last_used_at = ? WHERE slug = ?")
      .bind(day, now.toISOString(), bank.slug)
      .run()
  }
  return { day, status: 'picked', pick, record, considered }
}

const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)

/**
 * Refills the bank from the news. A story that scored well, is past its 14 days as news and never ran
 * goes in as `review`. It joins the pickable bank only once someone fact-checks it and sets it to `banked`.
 */
export async function refillBank(db: D1Database, now: Date): Promise<number> {
  const aged = await db
    .prepare(
      `SELECT id, url, title, summary, score, stage FROM candidates
       WHERE score >= ? AND pulled_at < ? AND 'news:' || id NOT IN (SELECT story_key FROM picks)
         AND url NOT IN (SELECT url FROM evergreen)`,
    )
    .bind(PROMOTE_MIN_SCORE, new Date(now.getTime() - NEWS_WINDOW_DAYS * DAY).toISOString())
    .all<{ id: number; url: string; title: string; summary: string; score: number; stage: string | null }>()

  let added = 0
  for (const c of aged.results) {
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO evergreen (slug, url, title, summary, stage, score, status, sources, added_at)
         VALUES (?, ?, ?, ?, ?, ?, 'review', ?, ?)`,
      )
      .bind(
        `${slugify(c.title)}-${c.id}`,
        c.url,
        c.title,
        c.summary || c.title,
        c.stage,
        Math.round(c.score),
        JSON.stringify([c.url]),
        now.toISOString(),
      )
      .run()
    added += result.meta.changes
  }
  return added
}

export async function bankHealth(db: D1Database): Promise<BankHealth> {
  const rows = await db
    .prepare('SELECT status, topic, COUNT(*) AS n FROM evergreen GROUP BY status, topic')
    .all<{ status: string; topic: string | null; n: number }>()
  const count = (status: string) => rows.results.filter((r) => r.status === status).reduce((sum, r) => sum + r.n, 0)
  const topics: Record<string, number> = {}
  for (const r of rows.results) if (r.status === 'banked') topics[r.topic ?? 'untagged'] = (topics[r.topic ?? 'untagged'] ?? 0) + r.n
  const ready = count('banked')
  return { ready, review: count('review'), used: count('used'), low: ready < BANK_FLOOR, floor: BANK_FLOOR, topics }
}
