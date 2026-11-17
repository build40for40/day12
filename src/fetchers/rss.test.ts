import { describe, expect, it, vi } from 'vitest'
import type { Source } from '../types'
import { fetchFeed, parseFeed } from './rss'

const rss = (items: string) => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Fake Feed</title><link>https://example.test/</link>${items}</channel></rss>`

const source: Source = { id: 'fake', name: 'Fake', type: 'rss', url: 'https://example.test/feed', tier: 'lab_blog' }

describe('parseFeed', () => {
  it('reads RSS 2.0 items with pubDate, description and source', () => {
    const items = parseFeed(rss(`
      <item>
        <title>Robots plant trees</title>
        <link>https://example.test/robots</link>
        <description>A fake story</description>
        <pubDate>Tue, 17 Nov 2026 08:30:00 GMT</pubDate>
        <source url="https://paper.example.test">The Fake Times</source>
      </item>
      <item><title>Second</title><link>https://example.test/second</link></item>`))
    expect(items).toEqual([
      {
        url: 'https://example.test/robots',
        title: 'Robots plant trees',
        summary: 'A fake story',
        publishedAt: '2026-11-17T08:30:00.000Z',
        publisher: 'The Fake Times',
      },
      { url: 'https://example.test/second', title: 'Second', summary: '', publishedAt: null },
    ])
  })

  it('returns an array for a feed with a single item', () => {
    const items = parseFeed(rss('<item><title>Only one</title><link>https://example.test/one</link></item>'))
    expect(items).toHaveLength(1)
  })

  it('reads Atom entries, preferring the alternate link and the published date', () => {
    const items = parseFeed(`<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <link rel="self" href="https://example.test/feed.atom"/>
        <entry>
          <title type="html">Satellites &amp;amp; seagrass</title>
          <link rel="edit" href="https://example.test/edit/1"/>
          <link rel="alternate" type="text/html" href="/news/seagrass"/>
          <published>2026-11-16T09:00:00+01:00</published>
          <updated>2026-11-17T09:00:00Z</updated>
          <content type="html">&lt;p&gt;Mapped from space&lt;/p&gt;</content>
        </entry>
      </feed>`)
    expect(items).toEqual([
      {
        url: 'https://example.test/news/seagrass',
        title: 'Satellites & seagrass',
        summary: 'Mapped from space',
        publishedAt: '2026-11-16T08:00:00.000Z',
      },
    ])
  })

  it('reads dc:date from an RDF feed', () => {
    const items = parseFeed(`<?xml version="1.0"?>
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <channel rdf:about="https://example.test/"><title>Fake</title><link>https://example.test/</link></channel>
        <item rdf:about="https://example.test/rdf"><title>RDF story</title><link>https://example.test/rdf</link><dc:date>2026-11-17T06:00:00Z</dc:date></item>
      </rdf:RDF>`)
    expect(items.map((i) => i.publishedAt)).toEqual(['2026-11-17T06:00:00.000Z'])
  })

  it('strips HTML, decodes entities and trims summaries to 500 characters', () => {
    const long = 'word '.repeat(200)
    const [first, second] = parseFeed(rss(`
      <item><title>Tags</title><link>https://example.test/a</link>
        <description><![CDATA[<p>Caf&eacute; &#8216;AI&#8217; &amp; <b>bees</b><script>x()</script></p>]]></description></item>
      <item><title>Long</title><link>https://example.test/b</link><description>${long}</description></item>`))
    expect(first?.summary).toBe('Café ‘AI’ & bees')
    expect(second?.summary.length).toBe(500)
  })

  it('returns null for an unparseable date', () => {
    const [item] = parseFeed(rss('<item><title>T</title><link>https://example.test/t</link><pubDate>someday</pubDate></item>'))
    expect(item?.publishedAt).toBeNull()
  })
})

describe('fetchFeed', () => {
  it('parses the response body with a generic user agent', async () => {
    const fetchImpl = vi.fn(async () => new Response(rss('<item><title>T</title><link>https://example.test/t</link></item>')))
    const items = await fetchFeed(source, fetchImpl)
    expect(items).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledWith(source.url, expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': 'day12-pull/0.1' }) }))
  })

  it('throws a clear error on a non-2xx response', async () => {
    const fetchImpl = async () => new Response('nope', { status: 503, statusText: 'Service Unavailable' })
    await expect(fetchFeed(source, fetchImpl)).rejects.toThrow('fake: feed request failed with HTTP 503 Service Unavailable')
  })
})
