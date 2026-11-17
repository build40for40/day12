// Turns the evergreen records in data/backlog.json into SQL for the evergreen table.
// No imports, so scripts/seed-evergreen.ts can load it straight from Node.

export interface BacklogStory {
  id: string
  from: string
  status: string
  headline: string
  what_happened: string
  why_its_good: string
  careful?: string[]
  topic: string
  technology: string
  total: number
  sources: string[]
  published_on?: string | null
}

const STATUS: Record<string, string> = { in_bank: 'banked', published: 'used', removed: 'removed' }

const quote = (value: string | null): string => (value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`)

export function evergreenSeedSql(stories: BacklogStory[], checkedOn: string): string {
  const rows: string[] = []
  for (const s of stories) {
    const status = STATUS[s.status]
    const url = s.sources[0]
    if (s.from !== 'evergreen' || !status || !url) continue
    // Re-running the seed refreshes the wording but never undoes what the daily pick has done (status, used_on).
    rows.push(
      `INSERT INTO evergreen (slug, url, title, summary, why_its_good, careful, sources, topic, technology, total, status, used_on, verified_at, added_at)
VALUES (${[
        quote(s.id),
        quote(url),
        quote(s.headline),
        quote(s.what_happened),
        quote(s.why_its_good),
        quote(JSON.stringify(s.careful ?? [])),
        quote(JSON.stringify(s.sources)),
        quote(s.topic),
        quote(s.technology),
        String(Math.round(s.total)),
        quote(status),
        quote(status === 'used' ? (s.published_on ?? null) : null),
        quote(checkedOn),
        quote(checkedOn),
      ].join(', ')})
ON CONFLICT(slug) DO UPDATE SET title = excluded.title, summary = excluded.summary,
  why_its_good = excluded.why_its_good, careful = excluded.careful, sources = excluded.sources, topic = excluded.topic,
  technology = excluded.technology, total = excluded.total;`,
    )
  }
  return rows.join('\n')
}
