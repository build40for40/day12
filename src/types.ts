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

export interface Pick { day: string; storyKey: string; lane: 'news' | 'evergreen'; title: string; total: number; reason: string }
export interface Considered { news: { title: string; total: number } | null; bank: { title: string; total: number } | null }
export interface StoryRecord {
  id: string; headline: string; whatHappened: string; whyItsGood: string | null; careful: string[]
  stage: string | null; topic: string | null; lane: 'good' | 'flip'; sourceUrl: string | null
  badNews?: string; flipKind?: string
}
export type PickResult =
  | { day: string; status: 'picked' | 'dry_run'; pick: Pick; record: StoryRecord; considered: Considered }
  | { day: string; status: 'already_picked'; pick: Pick; record: StoryRecord | null }
  | { day: string; status: 'nothing_to_run'; pick: null; record: null; considered: Considered }
export interface BankHealth { ready: number; review: number; used: number; low: boolean; floor: number; topics: Record<string, number> }
