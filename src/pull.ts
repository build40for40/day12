import { cleanGnewsItems } from './fetchers/gnews'
import { fetchFeed } from './fetchers/rss'
import { dedupe, toCandidates } from './normalise'
import { SOURCES } from './sources'
import { purgeOld, saveNew } from './store'
import type { Candidate, Env, FetchLike, PullReport, RawItem, Source, SourceReport } from './types'

const REQUEST_TIMEOUT_MS = 15_000
const GNEWS_GAP_MS = 2_000
const BUSY_RETRY_WAITS_MS = [5_000, 15_000]
const TOO_MANY_REQUESTS = 429

export type Wait = (ms: number) => Promise<void>

const defaultFetch: FetchLike = (input, init) => fetch(input, init)
const defaultWait: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function withTimeout(fetchImpl: FetchLike): FetchLike {
  return (input, init) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
}

function retryingWhenBusy(fetchImpl: FetchLike, wait: Wait): FetchLike {
  return async (input, init) => {
    for (const pause of BUSY_RETRY_WAITS_MS) {
      const response = await fetchImpl(input, init)
      if (response.status !== TOO_MANY_REQUESTS) return response
      await response.body?.cancel()
      await wait(pause)
    }
    return fetchImpl(input, init)
  }
}

async function fetchSource(source: Source, fetchImpl: FetchLike): Promise<RawItem[]> {
  switch (source.type) {
    case 'rss':
      return fetchFeed(source, fetchImpl)
    case 'gnews':
      // A Google News description only repeats the title and publisher.
      return cleanGnewsItems(await fetchFeed(source, fetchImpl)).map((item) => ({ ...item, summary: '' }))
  }
}

interface SourceResult {
  report: SourceReport
  candidates: Candidate[]
}

async function pullSource(source: Source, fetchImpl: FetchLike, now: Date): Promise<SourceResult> {
  let items: RawItem[] = []
  let error: string | undefined
  try {
    items = await fetchSource(source, fetchImpl)
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown)
  }
  const candidates = toCandidates(source, items, now)
  const report: SourceReport = { sourceId: source.id, fetched: items.length, kept: candidates.length, stored: 0 }
  if (error !== undefined) report.error = error
  return { report, candidates }
}

// Google News answers 429 when its searches arrive together, so they go one at a time.
async function pullGnewsInTurn(sources: Source[], fetchImpl: FetchLike, wait: Wait, now: Date): Promise<SourceResult[]> {
  const results: SourceResult[] = []
  for (const source of sources) {
    if (results.length > 0) await wait(GNEWS_GAP_MS)
    results.push(await pullSource(source, fetchImpl, now))
  }
  return results
}

export async function runPull(env: Env, now: Date, fetchImpl: FetchLike = defaultFetch, wait: Wait = defaultWait): Promise<PullReport> {
  const timedFetch = withTimeout(fetchImpl)
  const gnews = SOURCES.filter((source) => source.type === 'gnews')
  const feeds = SOURCES.filter((source) => source.type !== 'gnews')
  const [gnewsResults, feedResults] = await Promise.all([
    pullGnewsInTurn(gnews, retryingWhenBusy(timedFetch, wait), wait, now),
    Promise.all(feeds.map((source) => pullSource(source, timedFetch, now))),
  ])
  const bySource = new Map([...gnewsResults, ...feedResults].map((result) => [result.report.sourceId, result]))
  const results = SOURCES.map((source) => bySource.get(source.id)!)

  const stored = await saveNew(env.DB, dedupe(results.flatMap((r) => r.candidates)), now)
  await purgeOld(env.DB, now)

  const storedBySource = new Map<string, number>()
  for (const c of stored) storedBySource.set(c.sourceId, (storedBySource.get(c.sourceId) ?? 0) + 1)

  return {
    startedAt: now.toISOString(),
    sources: results.map(({ report }) => ({ ...report, stored: storedBySource.get(report.sourceId) ?? 0 })),
    stored: stored.length,
  }
}
