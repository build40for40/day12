import { XMLParser } from 'fast-xml-parser'
import type { FetchLike, RawItem, Source } from '../types'
import { readText } from './http'

const USER_AGENT = 'day12-pull/0.1'
const SUMMARY_LIMIT = 500
const ARRAY_TAGS = new Set(['item', 'entry', 'link'])

type Node = Record<string, unknown>

const localName = (name: string) => name.slice(name.indexOf(':') + 1)

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name, _path, _leaf, isAttribute) => !isAttribute && ARRAY_TAGS.has(localName(name)),
})

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', bull: '•', middot: '·', deg: '°', copy: '©', reg: '®', trade: '™',
  pound: '£', euro: '€', cent: '¢', times: '×', micro: 'µ', shy: '',
  eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', iacute: 'í', oacute: 'ó', uacute: 'ú',
  auml: 'ä', ouml: 'ö', uuml: 'ü', ccedil: 'ç', ntilde: 'ñ', szlig: 'ß',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })
}

export function htmlToText(html: string): string {
  const withoutTags = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(withoutTags).replace(/\s+/g, ' ').trim()
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  return text.slice(0, limit - 1).trimEnd() + '…'
}

function child(node: Node, name: string): unknown {
  if (name in node) return node[name]
  const key = Object.keys(node).find((k) => localName(k) === name)
  return key === undefined ? undefined : node[key]
}

function asNode(value: unknown): Node | undefined {
  if (Array.isArray(value)) return asNode(value[0])
  return value !== null && typeof value === 'object' ? (value as Node) : undefined
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    for (const v of value) {
      const text = textOf(v)
      if (text.trim()) return text
    }
    return ''
  }
  const node = asNode(value)
  return node ? textOf(node['#text']) : ''
}

function firstText(node: Node, names: string[]): string {
  for (const name of names) {
    const text = textOf(child(node, name)).trim()
    if (text) return text
  }
  return ''
}

function absoluteUrl(raw: string, base?: string): string | null {
  const href = decodeEntities(raw.trim())
  if (!href) return null
  try {
    const url = new URL(href, base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function linkOf(node: Node, base?: string): string | null {
  const links = [child(node, 'link')].flat().filter((l) => l !== undefined)
  const textLink = links.map(textOf).find((t) => t.trim())
  const hrefLinks = links
    .map(asNode)
    .filter((l): l is Node => l !== undefined && typeof l['@_href'] === 'string')
  const alternate =
    hrefLinks.find((l) => (l['@_rel'] ?? 'alternate') === 'alternate') ?? (textLink ? undefined : hrefLinks[0])
  const candidates = [textLink, alternate?.['@_href'] as string | undefined]
  const guid = asNode(child(node, 'guid'))
  const guidText = textOf(child(node, 'guid'))
  if (guidText && guid?.['@_isPermaLink'] !== 'false') candidates.push(guidText)
  for (const candidate of candidates) {
    const url = candidate ? absoluteUrl(candidate, base) : null
    if (url) return url
  }
  return null
}

function isoDate(text: string): string | null {
  if (!text) return null
  const time = Date.parse(text)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

function toItem(node: Node, base?: string): RawItem | null {
  const url = linkOf(node, base)
  const title = htmlToText(firstText(node, ['title']))
  if (!url || !title) return null
  const summary = truncate(htmlToText(firstText(node, ['description', 'summary', 'content', 'encoded'])), SUMMARY_LIMIT)
  const publishedAt = isoDate(firstText(node, ['pubDate', 'published', 'date', 'issued', 'updated']))
  const item: RawItem = { url, title, summary, publishedAt }
  const publisher = htmlToText(firstText(node, ['source']))
  if (publisher) item.publisher = publisher
  return item
}

export function parseFeed(xml: string): RawItem[] {
  const doc = parser.parse(xml) as Node
  const rootKey = Object.keys(doc).find((k) => !k.startsWith('?'))
  const root = rootKey ? asNode(doc[rootKey]) : undefined
  if (!root) return []
  const channel = asNode(child(root, 'channel'))
  const feedLink = channel ? linkOf(channel) : linkOf(root)
  const base = feedLink ?? undefined
  const nodes = [child(root, 'entry'), child(root, 'item'), channel && child(channel, 'item')]
    .flatMap((value) => (value === undefined ? [] : [value].flat()))
    .map(asNode)
    .filter((node): node is Node => node !== undefined)
  return nodes.map((node) => toItem(node, base)).filter((item): item is RawItem => item !== null)
}

export async function fetchFeed(source: Source, fetchImpl: FetchLike): Promise<RawItem[]> {
  const response = await fetchImpl(source.url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5',
    },
  })
  if (!response.ok) {
    throw new Error(`${source.id}: feed request failed with HTTP ${response.status} ${response.statusText}`.trim())
  }
  return parseFeed(await readText(response))
}
