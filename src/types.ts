export type Tier = 'press_release' | 'organisation' | 'lab_blog' | 'lead'
export type SourceType = 'rss' | 'gnews'
export interface Source { id: string; name: string; type: SourceType; url: string; tier: Tier; keywordFilter?: boolean }
export interface RawItem { url: string; title: string; summary: string; publishedAt: string | null; publisher?: string }
export interface Candidate extends RawItem { sourceId: string; tier: Tier; urlKey: string; titleKey: string }
export interface SourceReport { sourceId: string; fetched: number; kept: number; stored: number; error?: string }
export interface PullReport { startedAt: string; sources: SourceReport[]; stored: number }
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>
export interface Env {
  DB: D1Database
  PULL_TOKEN: string
  POSTMARK_SERVER_TOKEN: string
  EMAIL_FROM: string
  PUBLIC_BASE_URL: string
  ALLOWED_ORIGIN: string
  POSTMARK_TRANSACTIONAL_STREAM: string
  POSTMARK_BROADCAST_STREAM: string
  // The company Anthropic key, for the headline editor. A Worker secret.
  ANTHROPIC_API_KEY?: string
}
