// The Worker's side of live scoring: hand unscored candidates to scripts/score.py and save its verdicts.

const DAY = 86_400_000
// Only stories young enough to still run as news are worth the cost of scoring.
const SCORE_WINDOW_DAYS = 14
const MAX_LIST = 300
const MAX_VERDICTS = 300

const GATES = ['pass', 'fail', 'triage'] as const
const TOPICS = ['health', 'climate_and_nature', 'space', 'accessibility', 'science', 'everyday_life']
const STAGES = ['in_the_lab', 'in_a_trial', 'helping_people_now']

export interface UnscoredCandidate {
  id: number
  title: string
  summary: string
  url: string
  publisher: string | null
  publishedAt: string | null
  sourceId: string
  tier: string
  pulledAt: string
}

export interface StoryHandoff {
  headline: string
  what_happened: string
  why_its_good: string
  careful: string[]
  sources: string[]
}

export type Verdict =
  | { id: number; gate: 'triage' | 'fail'; failedGate: string | null; reason: string }
  | { id: number; gate: 'pass'; reason: string; total: number; topic: string; stage: string; story: StoryHandoff }

export async function listUnscored(db: D1Database, now: Date, limit = MAX_LIST): Promise<UnscoredCandidate[]> {
  const rows = await db
    .prepare(
      `SELECT id, title, summary, url, publisher, published_at, source_id, tier, pulled_at FROM candidates
       WHERE scored_at IS NULL AND pulled_at >= ? ORDER BY pulled_at DESC LIMIT ?`,
    )
    .bind(new Date(now.getTime() - SCORE_WINDOW_DAYS * DAY).toISOString(), Math.min(Math.max(1, limit), MAX_LIST))
    .all<Record<string, string | number | null>>()
  return rows.results.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    summary: String(r.summary ?? ''),
    url: String(r.url),
    publisher: (r.publisher as string | null) ?? null,
    publishedAt: (r.published_at as string | null) ?? null,
    sourceId: String(r.source_id),
    tier: String(r.tier),
    pulledAt: String(r.pulled_at),
  }))
}

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null

const isUrl = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\//.test(value) && URL.canParse(value)

/** Checks one verdict from the scorer. Returns null when it is malformed, so a bad model answer never lands. */
export function parseVerdict(raw: unknown): Verdict | null {
  const v = (raw ?? {}) as Record<string, unknown>
  if (!Number.isInteger(v.id) || !GATES.includes(v.gate as (typeof GATES)[number])) return null
  const reason = text(v.reason, 1000)
  if (!reason) return null
  const id = v.id as number
  if (v.gate !== 'pass') {
    const failedGate = v.failed_gate == null ? null : text(v.failed_gate, 40)
    return { id, gate: v.gate as 'triage' | 'fail', failedGate, reason }
  }
  const s = (v.story ?? {}) as Record<string, unknown>
  const headline = text(s.headline, 300)
  const whatHappened = text(s.what_happened, 2000)
  const whyItsGood = text(s.why_its_good, 1000)
  const careful = Array.isArray(s.careful) ? s.careful.map((c) => text(c, 500)) : null
  const sources = Array.isArray(s.sources) ? s.sources.filter(isUrl).slice(0, 5) : []
  if (!Number.isInteger(v.total) || (v.total as number) < 0 || (v.total as number) > 24) return null
  if (!TOPICS.includes(v.topic as string) || !STAGES.includes(v.stage as string)) return null
  if (!headline || !whatHappened || !whyItsGood || !careful || careful.includes(null) || sources.length === 0) return null
  return {
    id,
    gate: 'pass',
    reason,
    total: v.total as number,
    topic: v.topic as string,
    stage: v.stage as string,
    story: { headline, what_happened: whatHappened, why_its_good: whyItsGood, careful: careful as string[], sources },
  }
}

/** Saves verdicts. A candidate that already has one keeps it. Returns how many were saved and how many were rejected. */
export async function saveVerdicts(db: D1Database, body: unknown, now: Date): Promise<{ saved: number; rejected: number }> {
  const list = (body as { verdicts?: unknown } | null)?.verdicts
  if (!Array.isArray(list) || list.length > MAX_VERDICTS) return { saved: 0, rejected: Array.isArray(list) ? list.length : 0 }
  let saved = 0
  let rejected = 0
  for (const raw of list) {
    const v = parseVerdict(raw)
    if (!v) {
      rejected++
      continue
    }
    const pass = v.gate === 'pass'
    const result = await db
      .prepare(
        `UPDATE candidates SET scored_at = ?, gate = ?, failed_gate = ?, reason = ?, score = ?, stage = ?, tags = ?, story = ?
         WHERE id = ? AND scored_at IS NULL`,
      )
      .bind(
        now.toISOString(),
        v.gate,
        pass ? null : v.failedGate,
        v.reason,
        pass ? v.total : null,
        pass ? v.stage : null,
        pass ? v.topic : null,
        pass ? JSON.stringify(v.story) : null,
        v.id,
      )
      .run()
    saved += result.meta.changes
  }
  return { saved, rejected }
}
