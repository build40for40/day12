import { describe, expect, it } from 'vitest'
import { dedupe, matchesAiKeywords, titleKey, toCandidates, urlKey, withinWindow } from './normalise'
import type { Candidate, RawItem, Source } from './types'

const now = new Date('2026-11-17T06:00:00Z')

function item(overrides: Partial<RawItem> = {}): RawItem {
  return { url: 'https://example.com/a', title: 'A robot plants trees', summary: '', publishedAt: null, ...overrides }
}

function candidate(urlKey: string, titleKey: string): Candidate {
  return { ...item(), sourceId: 'test', tier: 'lead', urlKey, titleKey }
}

describe('urlKey', () => {
  it('strips tracking params and fragments', () => {
    expect(urlKey('https://example.com/story?id=7&utm_source=x&utm_medium=y&fbclid=1&gclid=2&ref=feed#top')).toBe(
      'example.com/story?id=7',
    )
  })

  it('ignores www, host case and the trailing slash', () => {
    expect(urlKey('https://WWW.Example.com/story/')).toBe(urlKey('https://example.com/story'))
  })
})

describe('titleKey', () => {
  it('shares a key for titles that differ only in case or punctuation', () => {
    expect(titleKey('Robots   help bees: a new hope!')).toBe(titleKey("robots help bees, a new hope"))
  })

  it('keeps the same title from two publishers apart', () => {
    expect(titleKey('Robots help bees', 'Example Times')).not.toBe(titleKey('Robots help bees', 'Fake Gazette'))
  })
})

describe('matchesAiKeywords', () => {
  it('matches AI as a whole word only', () => {
    expect(matchesAiKeywords(item({ title: 'New AI spots whales' }))).toBe(true)
    expect(matchesAiKeywords(item({ title: 'She said Kuwait was sunny' }))).toBe(false)
    expect(matchesAiKeywords(item({ title: 'An ai tool' }))).toBe(false)
  })

  it('matches the longer phrases in any case', () => {
    expect(matchesAiKeywords(item({ summary: 'Built with Deep Learning' }))).toBe(true)
  })
})

describe('withinWindow', () => {
  it('keeps items inside the window and undated items', () => {
    expect(withinWindow(item({ publishedAt: '2026-11-16T07:00:00Z' }), now, 48)).toBe(true)
    expect(withinWindow(item({ publishedAt: '2026-11-15T05:00:00Z' }), now, 48)).toBe(false)
    expect(withinWindow(item({ publishedAt: null }), now, 48)).toBe(true)
  })
})

describe('toCandidates', () => {
  it('applies the keyword filter and adds the publisher to gnews title keys', () => {
    const gnews: Source = { id: 'g', name: 'G', type: 'gnews', url: 'https://example.com/g', tier: 'lead', keywordFilter: true }
    const result = toCandidates(
      gnews,
      [item({ title: 'AI helps farmers', publisher: 'Fake Gazette' }), item({ title: 'Cats nap a lot' })],
      now,
    )
    expect(result).toHaveLength(1)
    expect(result[0]?.titleKey).toBe('ai helps farmers|fake gazette')
    expect(result[0]?.urlKey).toBe('example.com/a')
  })

  it('drops items with an oversized title or url', () => {
    const rss: Source = { id: 'r', name: 'R', type: 'rss', url: 'https://example.com/r', tier: 'lead' }
    const result = toCandidates(
      rss,
      [item({ title: 'x'.repeat(301) }), item({ url: `https://example.com/${'y'.repeat(2048)}` }), item({ url: 'https://example.com/ok' })],
      now,
    )
    expect(result.map((c) => c.url)).toEqual(['https://example.com/ok'])
  })
})

describe('dedupe', () => {
  it('keeps the first on urlKey and then on titleKey', () => {
    const first = candidate('a.com/1', 'one')
    const sameUrl = candidate('a.com/1', 'two')
    const sameTitle = candidate('a.com/3', 'one')
    const other = candidate('a.com/4', 'four')
    expect(dedupe([first, sameUrl, sameTitle, other])).toEqual([first, other])
  })
})
