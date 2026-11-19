import type { CardContent } from './card'
import { longDate } from './landing'
import type { Issue } from './publish'
import { sourceName } from './templates'
import type { Env } from './types'

export type RenderCard = (card: CardContent) => Promise<Uint8Array>

/** The sign-up address as people type it, with no "https://" and no trailing slash: "build40for40.com/feel-good". */
export function signupAddress(publicBaseUrl: string): string {
  return publicBaseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

/**
 * The caption to paste under the card: one line, like The Daily Stoic's. The card already carries the story, the place
 * and the source. A link in an Instagram caption isn't clickable, but people can type it.
 */
export function buildCaption(publicBaseUrl: string): string {
  return `Sign up for a daily feel good AI email at: ${signupAddress(publicBaseUrl)}`
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

/** Draws the card for an issue and saves it with its caption. Running it again for the same date replaces the old one. */
export async function makeInstagramPost(env: Pick<Env, 'DB' | 'PUBLIC_BASE_URL'>, issue: Issue, render: RenderCard, now = new Date()): Promise<InstagramPost> {
  const image = await render(cardContent(issue))
  const caption = buildCaption(env.PUBLIC_BASE_URL)
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
