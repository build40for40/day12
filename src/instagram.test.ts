import { describe, expect, it, vi } from 'vitest'
import { buildCaption, cardContent, findInstagramPost, findLatestInstagramPost, fromBase64, instagramNeighbours, makeInstagramPost, signupAddress, toBase64, type RenderCard } from './instagram'
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
  it('is one line inviting people to sign up, with the address as they would type it', () => {
    expect(buildCaption('https://build40for40.com/feel-good')).toBe('Sign up for a daily feel good AI email at: build40for40.com/feel-good')
  })

  it('has no link, no hashtags and no story, since the card carries the story', () => {
    const caption = buildCaption('https://brief.example.com/')

    expect(caption).toBe('Sign up for a daily feel good AI email at: brief.example.com')
    expect(caption).not.toMatch(/https?:\/\/|#|\n/)
  })
})

describe('signupAddress', () => {
  it('drops the scheme and trailing slashes only', () => {
    expect(signupAddress('https://build40for40.com/feel-good/')).toBe('build40for40.com/feel-good')
    expect(signupAddress('http://localhost:8787')).toBe('localhost:8787')
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

    const post = await makeInstagramPost(env, issue, draw, new Date('2026-11-19T06:01:00Z'))

    expect(draw).toHaveBeenCalledWith(cardContent(issue))
    expect(post.caption).toBe('Sign up for a daily feel good AI email at: brief.example.com')
    expect(await findInstagramPost(env.DB, '2026-11-19')).toEqual({ date: '2026-11-19', caption: post.caption, image: jpeg, createdAt: '2026-11-19T06:01:00.000Z' })
  })

  it('replaces the day’s card when it is made again', async () => {
    const env = fakeEnv()
    await makeInstagramPost(env, issue, render())
    const second = Uint8Array.from([9, 9, 9])

    await makeInstagramPost(env, issue, async () => second)

    expect(env.sqlite.prepare('SELECT COUNT(*) AS n FROM instagram_posts').get()).toEqual({ n: 1 })
    expect((await findInstagramPost(env.DB, '2026-11-19'))!.image).toEqual(second)
  })

  it('saves nothing when the card cannot be drawn', async () => {
    const env = fakeEnv()

    await expect(makeInstagramPost(env, issue, async () => Promise.reject(new Error('no wasm')))).rejects.toThrow('no wasm')
    expect(env.sqlite.prepare('SELECT COUNT(*) AS n FROM instagram_posts').get()).toEqual({ n: 0 })
  })
})

describe('finding posts', () => {
  it('finds the latest, and the days either side of a date', async () => {
    const env = fakeEnv()
    const draw: RenderCard = async () => new Uint8Array([1])
    for (const date of ['2026-11-17', '2026-11-19', '2026-11-20']) await makeInstagramPost(env, { ...issue, date }, draw)

    expect((await findLatestInstagramPost(env.DB))!.date).toBe('2026-11-20')
    expect(await instagramNeighbours(env.DB, '2026-11-19')).toEqual({ previous: '2026-11-17', next: '2026-11-20' })
    expect(await instagramNeighbours(env.DB, '2026-11-17')).toEqual({ previous: null, next: '2026-11-19' })
    expect(await findInstagramPost(env.DB, '2026-11-18')).toBeNull()
  })
})
