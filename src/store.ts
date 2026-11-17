import { dedupe } from './normalise'
import type { Candidate } from './types'

// D1 allows at most 100 bound parameters per statement.
const LOOKUP_CHUNK = 40
const WRITE_CHUNK = 50

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

async function findSeen(db: D1Database, candidates: Candidate[]): Promise<{ urlKeys: Set<string>; titleKeys: Set<string> }> {
  const urlKeys = new Set<string>()
  const titleKeys = new Set<string>()
  const lookups = chunk(candidates, LOOKUP_CHUNK).map((group) => {
    const marks = group.map(() => '?').join(', ')
    return db
      .prepare(`SELECT url_key, title_key FROM seen WHERE url_key IN (${marks}) OR title_key IN (${marks})`)
      .bind(...group.map((c) => c.urlKey), ...group.map((c) => c.titleKey))
  })
  if (lookups.length === 0) return { urlKeys, titleKeys }
  const results = await db.batch<{ url_key: string; title_key: string }>(lookups)
  for (const result of results) {
    for (const row of result.results) {
      urlKeys.add(row.url_key)
      titleKeys.add(row.title_key)
    }
  }
  return { urlKeys, titleKeys }
}

export async function saveNew(db: D1Database, candidates: Candidate[], now: Date): Promise<Candidate[]> {
  const unique = dedupe(candidates)
  if (unique.length === 0) return []

  const seen = await findSeen(db, unique)
  const fresh = unique.filter((c) => !seen.urlKeys.has(c.urlKey) && !seen.titleKeys.has(c.titleKey))
  if (fresh.length === 0) return []

  const pulledAt = now.toISOString()
  const insertSeen = db.prepare('INSERT OR IGNORE INTO seen (url_key, title_key, first_seen) VALUES (?, ?, ?)')
  const insertCandidate = db.prepare(
    `INSERT OR IGNORE INTO candidates
      (url, url_key, title_key, title, summary, published_at, publisher, source_id, tier, pulled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  const stored: Candidate[] = []
  for (const group of chunk(fresh, WRITE_CHUNK)) {
    const statements = group.flatMap((c) => [
      insertSeen.bind(c.urlKey, c.titleKey, pulledAt),
      insertCandidate.bind(
        c.url,
        c.urlKey,
        c.titleKey,
        c.title,
        c.summary,
        c.publishedAt,
        c.publisher ?? null,
        c.sourceId,
        c.tier,
        pulledAt,
      ),
    ])
    const results = await db.batch(statements)
    group.forEach((c, i) => {
      if ((results[i * 2 + 1]?.meta.changes ?? 0) > 0) stored.push(c)
    })
  }
  return stored
}

export async function purgeOld(db: D1Database, now: Date, days = 30): Promise<void> {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString()
  await db.prepare('DELETE FROM candidates WHERE pulled_at < ?').bind(cutoff).run()
}
