import { describe, expect, it } from 'vitest'
import { SOURCES } from '../sources'
import type { RawItem } from '../types'
import { cleanGnewsItems, gnewsUrl } from './gnews'

const item = (title: string, publisher?: string): RawItem => ({
  url: 'https://news.google.com/rss/articles/fake',
  title,
  summary: 'Fake summary',
  publishedAt: '2026-11-16T09:00:00.000Z',
  publisher,
})

describe('gnewsUrl', () => {
  it('builds a GB search URL with the two day window first', () => {
    const url = new URL(gnewsUrl('intitle:AI (whales OR "coral reef")'))
    expect(url.origin + url.pathname).toBe('https://news.google.com/rss/search')
    expect(url.searchParams.get('q')).toBe('when:2d intitle:AI (whales OR "coral reef")')
    expect(url.searchParams.get('hl')).toBe('en-GB')
    expect(url.searchParams.get('gl')).toBe('GB')
    expect(url.searchParams.get('ceid')).toBe('GB:en')
  })

  it('keeps every Google News source query short enough that Google does not truncate it', () => {
    const queries = SOURCES.filter((s) => s.type === 'gnews').map((s) => new URL(s.url).searchParams.get('q') ?? '')
    expect(queries.length).toBeGreaterThan(0)
    for (const q of queries) expect(q.length).toBeLessThanOrEqual(180)
  })
})

describe('cleanGnewsItems', () => {
  it('strips the publisher suffix and keeps the publisher', () => {
    const [cleaned] = cleanGnewsItems([item('Robot finds lost sock - The Daily Fake', 'The Daily Fake')])
    expect(cleaned).toMatchObject({ title: 'Robot finds lost sock', publisher: 'The Daily Fake' })
  })

  it('handles a publisher name that itself contains a dash', () => {
    const [cleaned] = cleanGnewsItems([item('Model spots fake comet - Fake Times - Daily Edition', 'Fake Times - Daily Edition')])
    expect(cleaned?.title).toBe('Model spots fake comet')
  })

  it('takes the publisher from the title when the feed gave none', () => {
    const [cleaned] = cleanGnewsItems([item('Test - driven tool helps fake farmers - Example News')])
    expect(cleaned).toMatchObject({ title: 'Test - driven tool helps fake farmers', publisher: 'Example News' })
  })

  it('leaves a title without a suffix alone', () => {
    const [cleaned] = cleanGnewsItems([item('No suffix here', 'Example News')])
    expect(cleaned?.title).toBe('No suffix here')
  })
})
