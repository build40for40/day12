import { cleanGnewsItems } from './fetchers/gnews'
import { fetchFeed } from './fetchers/rss'
import { dedupe, toCandidates } from './normalise'
import { SOURCES } from './sources'
import { purgeOld, saveNew } from './store'
import type { Candidate, Env, FetchLike, PullReport, RawItem, Source, SourceReport } from './types'

const REQUEST_TIMEOUT_MS = 15_000

const defaultFetch: FetchLike = (input, init) => fetch(input, init)

function withTimeout(fetchImpl: FetchLike): FetchLike {
  return (input, init) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
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

export async function runPull(env: Env, now: Date, fetchImpl: FetchLike = defaultFetch): Promise<PullReport> {
  const timedFetch = withTimeout(fetchImpl)
  const results = await Promise.all(SOURCES.map((source) => pullSource(source, timedFetch, now)))

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
