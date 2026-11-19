import type { CardContent } from './card'
import { longDate } from './landing'
import type { Issue } from './publish'
import { sourceName } from './templates'
import type { Env } from './types'

export type RenderCard = (card: CardContent) => Promise<Uint8Array>

const CORE_TAGS = ['#FeelGoodAI', '#GoodNews', '#AI']
// Two more per topic, so the caption stays at five. Instagram is moving towards a handful of hashtags a post.
const TOPIC_TAGS: Record<string, string[]> = {
  science: ['#Science', '#Research'],
  accessibility: ['#Accessibility', '#Inclusion'],
  health: ['#Health', '#Medicine'],
  climate_and_nature: ['#Climate', '#Nature'],
  everyday_life: ['#Technology', '#EverydayLife'],
  space: ['#Space', '#Astronomy'],
}
const OTHER_TAGS = ['#Hope', '#Innovation']

export function hashtagsFor(topic: string | null): string[] {
  return [...CORE_TAGS, ...((topic && TOPIC_TAGS[topic]) || OTHER_TAGS)]
}

/** The caption to paste under the card. Links don't work in an Instagram caption, so the call to action points at the bio. */
export function buildCaption(issue: Pick<Issue, 'text' | 'place' | 'url'>, topic: string | null): string {
  const credit = [issue.place, `Source: ${sourceName(issue.url)}`].filter(Boolean).join('\n')
  return [
    issue.text,
    credit,
    'Get one true, hopeful AI story in your inbox every morning. Link in bio.',
    hashtagsFor(topic).join(' '),
  ].join('\n\n')
}

export function cardContent(issue: Pick<Issue, 'date' | 'text' | 'place' | 'stage' | 'url'>): CardContent {
  return { dateLabel: longDate(issue.date), text: issue.text, place: issue.place, stage: issue.stage, source: sourceName(issue.url) }
}

export interface InstagramPost {
  date: string
  caption: string
  image: Uint8Array
  createdAt: string
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function toPost(row: Record<string, unknown>): InstagramPost {
  return { date: String(row.date), caption: String(row.caption), image: fromBase64(String(row.image)), createdAt: String(row.created_at) }
}

export async function findInstagramPost(db: D1Database, date: string): Promise<InstagramPost | null> {
  const row = await db.prepare('SELECT * FROM instagram_posts WHERE date = ?').bind(date).first<Record<string, unknown>>()
  return row ? toPost(row) : null
}

export async function findLatestInstagramPost(db: D1Database): Promise<InstagramPost | null> {
  const row = await db.prepare('SELECT * FROM instagram_posts ORDER BY date DESC LIMIT 1').first<Record<string, unknown>>()
  return row ? toPost(row) : null
}

// The dates of the posts just before and just after a date.
export async function instagramNeighbours(db: D1Database, date: string): Promise<{ previous: string | null; next: string | null }> {
  const row = await db
    .prepare('SELECT (SELECT MAX(date) FROM instagram_posts WHERE date < ?1) AS previous, (SELECT MIN(date) FROM instagram_posts WHERE date > ?1) AS next')
    .bind(date)
    .first<{ previous: string | null; next: string | null }>()
  return { previous: row?.previous ?? null, next: row?.next ?? null }
}

/** The topic the day's story was picked under, kept on the pick. Null when the pick has none, such as a story added by hand. */
export async function topicFor(db: D1Database, date: string): Promise<string | null> {
  const row = await db.prepare('SELECT record FROM picks WHERE day = ?').bind(date).first<{ record: string | null }>()
  if (!row?.record) return null
  try {
    const topic = (JSON.parse(row.record) as { topic?: unknown }).topic
    return typeof topic === 'string' ? topic : null
  } catch {
    return null
  }
}

/** Draws the card for an issue and saves it with its caption. Running it again for the same date replaces the old one. */
export async function makeInstagramPost(env: Pick<Env, 'DB'>, issue: Issue, topic: string | null, render: RenderCard, now = new Date()): Promise<InstagramPost> {
  const image = await render(cardContent(issue))
  const caption = buildCaption(issue, topic)
  const createdAt = now.toISOString()
  await env.DB.prepare(
    `INSERT INTO instagram_posts (date, caption, image, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (date) DO UPDATE SET caption = excluded.caption, image = excluded.image, created_at = excluded.created_at`,
  )
    .bind(issue.date, caption, toBase64(image), createdAt)
    .run()
  return { date: issue.date, caption, image, createdAt }
}

/** The renderer the Worker uses. It loads on first use, so a Worker that never makes a card never loads the WebAssembly. */
export const renderCardInWorker: RenderCard = async (card) => (await import('./card-render')).renderCard(card)
