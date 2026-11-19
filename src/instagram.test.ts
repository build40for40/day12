import { describe, expect, it, vi } from 'vitest'
import { buildCaption, cardContent, findInstagramPost, findLatestInstagramPost, fromBase64, hashtagsFor, instagramNeighbours, makeInstagramPost, toBase64, topicFor, type RenderCard } from './instagram'
import type { Issue } from './publish'
import { fakeEnv } from './test-env'

const issue: Issue = {
  date: '2026-11-19',
  storyId: 'fake-story',
  headline: null,
  text: 'A fake story about AI helping someone.',
  url: 'https://www.example.org/news/fake',
  stage: 'in_a_trial',
  place: 'Nowhere, Earth',
  createdAt: '2026-11-19T06:00:00Z',
}

describe('buildCaption', () => {
  it('is the story, then the place and source, then the call to action, then the hashtags', () => {
    expect(buildCaption(issue, 'health')).toBe(
      [
        'A fake story about AI helping someone.',
        'Nowhere, Earth\nSource: example.org',
        'Get one true, hopeful AI story in your inbox every morning. Link in bio.',
        '#FeelGoodAI #GoodNews #AI #Health #Medicine',
      ].join('\n\n'),
    )
  })

  it('leaves out the place line when there is no place', () => {
    expect(buildCaption({ ...issue, place: null }, null)).toContain('\n\nSource: example.org\n\n')
  })

  it('puts no link in the caption, since Instagram would not make it clickable', () => {
    expect(buildCaption(issue, 'space')).not.toMatch(/https?:\/\//)
  })
})

describe('hashtagsFor', () => {
  it('gives five hashtags for every topic, and for none', () => {
    for (const topic of ['science', 'accessibility', 'health', 'climate_and_nature', 'everyday_life', 'space', 'something_new', null]) {
      expect(hashtagsFor(topic)).toHaveLength(5)
    }
    expect(hashtagsFor(null).slice(3)).toEqual(['#Hope', '#Innovation'])
  })
})

describe('cardContent', () => {
  it("reads the card's words from the issue", () => {
    expect(cardContent(issue)).toEqual({ dateLabel: '19 November 2026', text: issue.text, place: 'Nowhere, Earth', stage: 'in_a_trial', source: 'example.org' })
  })
})

describe('base64', () => {
  it('round-trips bytes, including ones past the chunk size', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 7) % 256)
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
  })
})

describe('makeInstagramPost', () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
  const render = () => vi.fn<RenderCard>(async () => jpeg)

  it('draws the card from the issue and saves it with the caption', async () => {
    const env = fakeEnv()
    const draw = render()

    const post = await makeInstagramPost(env, issue, 'space', draw, new Date('2026-11-19T06:01:00Z'))

    expect(draw).toHaveBeenCalledWith(cardContent(issue))
    expect(post.caption).toContain('#Space #Astronomy')
    expect(await findInstagramPost(env.DB, '2026-11-19')).toEqual({ date: '2026-11-19', caption: post.caption, image: jpeg, createdAt: '2026-11-19T06:01:00.000Z' })
  })

  it('replaces the day’s card when it is made again', async () => {
    const env = fakeEnv()
    await makeInstagramPost(env, issue, 'space', render())

    await makeInstagramPost(env, { ...issue, text: 'A fixed story.' }, 'health', render())

    expect(env.sqlite.prepare('SELECT COUNT(*) AS n FROM instagram_posts').get()).toEqual({ n: 1 })
    expect((await findInstagramPost(env.DB, '2026-11-19'))!.caption).toMatch(/^A fixed story\./)
  })

  it('saves nothing when the card cannot be drawn', async () => {
    const env = fakeEnv()

    await expect(makeInstagramPost(env, issue, null, async () => Promise.reject(new Error('no wasm')))).rejects.toThrow('no wasm')
    expect(env.sqlite.prepare('SELECT COUNT(*) AS n FROM instagram_posts').get()).toEqual({ n: 0 })
  })
})

describe('finding posts', () => {
  it('finds the latest, and the days either side of a date', async () => {
    const env = fakeEnv()
    const draw: RenderCard = async () => new Uint8Array([1])
    for (const date of ['2026-11-17', '2026-11-19', '2026-11-20']) await makeInstagramPost(env, { ...issue, date }, null, draw)

    expect((await findLatestInstagramPost(env.DB))!.date).toBe('2026-11-20')
    expect(await instagramNeighbours(env.DB, '2026-11-19')).toEqual({ previous: '2026-11-17', next: '2026-11-20' })
    expect(await instagramNeighbours(env.DB, '2026-11-17')).toEqual({ previous: null, next: '2026-11-19' })
    expect(await findInstagramPost(env.DB, '2026-11-18')).toBeNull()
  })
})

describe('topicFor', () => {
  const pick = (record: string | null) => {
    const env = fakeEnv()
    env.sqlite.prepare(`INSERT INTO picks (day, story_key, lane, title, total, reason, picked_at, record) VALUES ('2026-11-19', 'news:1', 'news', 't', 18, 'r', '2026-11-19T06:00:00Z', ?)`).run(record)
    return env
  }

  it("reads the topic from the day's pick", async () => {
    expect(await topicFor(pick(JSON.stringify({ topic: 'space' })).DB, '2026-11-19')).toBe('space')
  })

  it('is null when the pick has no record, no topic, a broken record, or there is no pick', async () => {
    expect(await topicFor(pick(null).DB, '2026-11-19')).toBeNull()
    expect(await topicFor(pick(JSON.stringify({ topic: null })).DB, '2026-11-19')).toBeNull()
    expect(await topicFor(pick('{not json').DB, '2026-11-19')).toBeNull()
    expect(await topicFor(pick(null).DB, '2026-11-20')).toBeNull()
  })
})
