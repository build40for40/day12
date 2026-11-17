import type { Candidate, RawItem, Source } from './types'

export const LOOKBACK_HOURS = 48
export const MAX_TITLE_LENGTH = 300
export const MAX_URL_LENGTH = 2048

const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'ref'])

const AI_WORD = /\bAI\b/
const AI_PHRASES = /artificial intelligence|machine learning|algorithm|neural network|deep learning/i

export function urlKey(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return url.trim().toLowerCase().replace(/#.*$/, '').replace(/\/+$/, '')
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  const params = new URLSearchParams()
  for (const [name, value] of parsed.searchParams) {
    const lower = name.toLowerCase()
    if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) continue
    params.append(name, value)
  }
  const query = params.toString()
  const path = parsed.pathname.replace(/\/+$/, '')
  const port = parsed.port ? `:${parsed.port}` : ''
  return `${host}${port}${path}${query ? `?${query}` : ''}`
}

function normaliseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’‘`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function titleKey(title: string, publisher?: string): string {
  const key = normaliseText(title)
  const by = publisher ? normaliseText(publisher) : ''
  return by ? `${key}|${by}` : key
}

export function matchesAiKeywords(item: RawItem): boolean {
  const text = `${item.title}\n${item.summary}`
  return AI_WORD.test(text) || AI_PHRASES.test(text)
}

export function withinWindow(item: RawItem, now: Date, hours: number): boolean {
  if (!item.publishedAt) return true
  const published = Date.parse(item.publishedAt)
  if (Number.isNaN(published)) return true
  return published >= now.getTime() - hours * 3_600_000
}

export function toCandidates(source: Source, items: RawItem[], now: Date): Candidate[] {
  const candidates: Candidate[] = []
  for (const item of items) {
    if (!item.url || !item.title) continue
    if (item.title.length > MAX_TITLE_LENGTH || item.url.length > MAX_URL_LENGTH) continue
    if (!withinWindow(item, now, LOOKBACK_HOURS)) continue
    if (source.keywordFilter && !matchesAiKeywords(item)) continue
    const key = titleKey(item.title, source.type === 'gnews' ? item.publisher : undefined)
    if (!key) continue
    candidates.push({
      ...item,
      sourceId: source.id,
      tier: source.tier,
      urlKey: urlKey(item.url),
      titleKey: key,
    })
  }
  return candidates
}

export function dedupe(candidates: Candidate[]): Candidate[] {
  const urlKeys = new Set<string>()
  const titleKeys = new Set<string>()
  return candidates.filter((candidate) => {
    if (urlKeys.has(candidate.urlKey) || titleKeys.has(candidate.titleKey)) return false
    urlKeys.add(candidate.urlKey)
    titleKeys.add(candidate.titleKey)
    return true
  })
}
