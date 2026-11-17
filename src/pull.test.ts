import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { runPull } from './pull'
import type { Env, FetchLike } from './types'

const now = new Date('2026-11-17T06:00:00Z')
const SCIENCEDAILY = 'https://www.sciencedaily.com/rss/computers_math/artificial_intelligence.xml'
const PHYSORG = 'https://phys.org/rss-feed/technology-news/machine-learning-ai/'

function fakeD1(): D1Database {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync('migrations/0001_init.sql', 'utf8'))
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    bind: (...args: SQLInputValue[]) => statement(sql, args),
    run: async () => ({ results: [], meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } }),
    all: async () => ({ results: sqlite.prepare(sql).all(...params), meta: { changes: 0 } }),
    sql,
  })
  type Fake = ReturnType<typeof statement>
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: Fake[]) =>
      Promise.all(statements.map((s) => (/^\s*SELECT/i.test(s.sql) ? s.all() : s.run()))),
  } as unknown as D1Database
}

const feed = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Fake</title>${items}</channel></rss>`

const fakeFetch: FetchLike = async (url) => {
  if (url === PHYSORG) throw new Error('connection reset')
  if (url === SCIENCEDAILY) {
    return new Response(
      feed(`
        <item><title>Robot gardener grows fake tomatoes</title><link>https://example.com/tomatoes</link><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate></item>
        <item><title>Made-up model maps imaginary reefs</title><link>https://example.com/reefs</link><pubDate>Mon, 16 Nov 2026 11:00:00 GMT</pubDate></item>`),
    )
  }
  return new Response(feed(''))
}

const noWait = async () => {}
const isGnews = (url: string) => url.startsWith('https://news.google.com/')

describe('runPull', () => {
  it('records a failing source in the report and still stores the rest', async () => {
    const report = await runPull({ DB: fakeD1(), PULL_TOKEN: 'x' } as Env, now, fakeFetch, noWait)

    expect(report.sources.find((s) => s.sourceId === 'physorg-ml-ai')).toMatchObject({ fetched: 0, error: expect.stringContaining('connection reset') })
    expect(report.sources.find((s) => s.sourceId === 'sciencedaily-ai')).toEqual({ sourceId: 'sciencedaily-ai', fetched: 2, kept: 2, stored: 2 })
    expect(report.stored).toBe(2)
  })

  it('stores nothing when the same items come back on a second run', async () => {
    const env = { DB: fakeD1(), PULL_TOKEN: 'x' } as Env
    await runPull(env, now, fakeFetch, noWait)
    const second = await runPull(env, new Date(now.getTime() + 3_600_000), fakeFetch, noWait)

    expect(second.stored).toBe(0)
    expect(second.sources.find((s) => s.sourceId === 'sciencedaily-ai')).toMatchObject({ fetched: 2, kept: 2, stored: 0 })
  })

  it('sends the Google News searches one at a time, with a pause between them', async () => {
    let inFlight = 0
    let mostAtOnce = 0
    const waits: number[] = []
    const fetchImpl: FetchLike = async (url) => {
      if (!isGnews(url)) return new Response(feed(''))
      mostAtOnce = Math.max(mostAtOnce, ++inFlight)
      await Promise.resolve()
      inFlight--
      return new Response(feed(''))
    }

    const report = await runPull({ DB: fakeD1(), PULL_TOKEN: 'x' } as Env, now, fetchImpl, async (ms) => void waits.push(ms))

    const searches = report.sources.filter((s) => s.sourceId.startsWith('gnews-')).length
    expect(mostAtOnce).toBe(1)
    expect(waits).toEqual(Array(searches - 1).fill(2_000))
  })

  it('tries a Google News search again after a 429 instead of reporting it failed', async () => {
    const refused = new Set<string>()
    const fetchImpl: FetchLike = async (url) => {
      if (isGnews(url) && !refused.has(url)) {
        refused.add(url)
        return new Response('slow down', { status: 429 })
      }
      return new Response(feed(''))
    }

    const report = await runPull({ DB: fakeD1(), PULL_TOKEN: 'x' } as Env, now, fetchImpl, noWait)

    expect(refused.size).toBeGreaterThan(0)
    expect(report.sources.filter((s) => s.error)).toEqual([])
  })
})
