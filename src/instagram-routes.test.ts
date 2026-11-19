import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from './index'
import { makeInstagramPost, type RenderCard } from './instagram'
import { instagramImage, instagramMake, instagramPage } from './instagram-routes'
import type { Issue } from './publish'
import { fakeEnv } from './test-env'

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16])
const render: RenderCard = async () => JPEG
const at = (path: string) => new Request(`https://site.example.com/feel-good${path}`) as Request<unknown, IncomingRequestCfProperties>
const issue = (date: string, text = `A fake story for ${date}.`): Issue => ({ date, storyId: `s-${date}`, headline: null, text, url: 'https://www.example.org/fake', stage: null, place: null, createdAt: `${date}T06:00:00Z` })

function setup() {
  const env = { ...fakeEnv(), PUBLIC_BASE_URL: 'https://site.example.com/feel-good' }
  const addIssue = (date: string) =>
    env.sqlite.prepare(`INSERT INTO issues (date, story_id, text, url, created_at) VALUES (?, ?, ?, 'https://www.example.org/fake', ?)`).run(date, `s-${date}`, `A fake story for ${date}.`, `${date}T06:00:00Z`)
  const addPost = (date: string, text?: string) => makeInstagramPost(env, issue(date, text), 'science', render)
  return { env, addIssue, addPost }
}

describe('Instagram routes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-19T09:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('the page', () => {
    it("shows today's card with a download link under the base path, and the caption to copy", async () => {
      const { env, addPost } = setup()
      await addPost('2026-11-19', 'A story with <tags> & more.')

      const response = await instagramPage(at('/instagram'), env)
      const html = await response.text()

      expect(response.status).toBe(200)
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(html).toContain('<img class="card" src="/feel-good/instagram.jpg?date=2026-11-19"')
      expect(html).toContain('href="/feel-good/instagram.jpg?date=2026-11-19" download="feel-good-ai-2026-11-19.jpg"')
      expect(html).toContain('A story with &lt;tags&gt; &amp; more.')
      expect(html).toContain('#FeelGoodAI #GoodNews #AI #Science #Research')
      expect(html).toContain('19 November 2026')
      expect(html).not.toContain("isn't ready yet")
    })

    it("shows the latest card with a note when today's is not made yet", async () => {
      const { env, addPost } = setup()
      await addPost('2026-11-17')

      const html = await (await instagramPage(at('/instagram'), env)).text()

      expect(html).toContain("Today's card isn't ready yet")
      expect(html).toContain('from 17 November 2026')
      expect(html).toContain('instagram.jpg?date=2026-11-17')
    })

    it('shows the card for ?date= with links to the days either side', async () => {
      const { env, addPost } = setup()
      for (const date of ['2026-11-17', '2026-11-18', '2026-11-19']) await addPost(date)

      const html = await (await instagramPage(at('/instagram?date=2026-11-18'), env)).text()

      expect(html).toContain('instagram.jpg?date=2026-11-18')
      expect(html).toContain('href="/feel-good/instagram?date=2026-11-17" rel="prev"')
      expect(html).toContain('href="/feel-good/instagram?date=2026-11-19" rel="next"')
    })

    it('says so, with a 404, when nothing has been made, or the date has no card, or is not a date', async () => {
      const { env, addPost } = setup()
      const none = await instagramPage(at('/instagram'), env)
      expect(none.status).toBe(404)
      expect(await none.text()).toContain('No Instagram post has been made yet.')

      await addPost('2026-11-17')
      const missing = await instagramPage(at('/instagram?date=2026-11-16'), env)
      expect(missing.status).toBe(404)
      expect(await missing.text()).toContain('No Instagram post was made for 16 November 2026.')
      expect((await instagramPage(at('/instagram?date=nope'), env)).status).toBe(404)
    })
  })

  describe('the image', () => {
    it("serves today's JPEG, or the one for ?date=", async () => {
      const { env, addPost } = setup()
      await addPost('2026-11-18')
      await addPost('2026-11-19')

      const today = await instagramImage(at('/instagram.jpg'), env)
      const earlier = await instagramImage(at('/instagram.jpg?date=2026-11-18'), env)

      expect(today.status).toBe(200)
      expect(today.headers.get('Content-Type')).toBe('image/jpeg')
      expect(today.headers.get('Content-Disposition')).toBe('inline; filename="feel-good-ai-2026-11-19.jpg"')
      expect(new Uint8Array(await today.arrayBuffer())).toEqual(JPEG)
      expect(earlier.headers.get('Content-Disposition')).toContain('2026-11-18')
    })

    it('is a 404 when there is no card for the day or the date is not one', async () => {
      const { env } = setup()
      expect((await instagramImage(at('/instagram.jpg'), env)).status).toBe(404)
      expect((await instagramImage(at('/instagram.jpg?date=2026-02-30x'), env)).status).toBe(404)
    })
  })

  describe('making a card by hand', () => {
    it('draws the card for the date from its issue and says how big it is', async () => {
      const { env, addIssue } = setup()
      addIssue('2026-11-19')
      env.sqlite.prepare(`INSERT INTO picks (day, story_key, lane, title, total, reason, picked_at, record) VALUES ('2026-11-19', 'news:1', 'news', 't', 18, 'r', '', ?)`).run(JSON.stringify({ topic: 'space' }))

      const response = await instagramMake(new Request('https://site.example.com/instagram', { method: 'POST' }), env, render)
      const body = (await response.json()) as { ok: boolean; date: string; bytes: number; caption: string }

      expect(body).toMatchObject({ ok: true, date: '2026-11-19', bytes: JPEG.length })
      expect(body.caption).toContain('#Space #Astronomy')
    })

    it('answers 404 with no issue for the date, 400 for a bad date, and 500 when the drawing fails', async () => {
      const { env, addIssue } = setup()
      const post = (query: string, draw: RenderCard = render) => instagramMake(new Request(`https://site.example.com/instagram${query}`, { method: 'POST' }), env, draw)

      expect((await post('')).status).toBe(404)
      expect((await post('?date=soon')).status).toBe(400)
      addIssue('2026-11-19')
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const failed = await post('', async () => Promise.reject(new Error('no wasm')))
      expect(failed.status).toBe(500)
      expect(await failed.json()).toEqual({ ok: false, error: 'render_failed' })
    })
  })

  describe('through the Worker', () => {
    it('serves the page and the image to anyone, and routes under the base path', async () => {
      const { env, addPost } = setup()
      await addPost('2026-11-19')

      expect((await worker.fetch(at('/instagram'), env, {} as ExecutionContext)).status).toBe(200)
      expect((await worker.fetch(at('/instagram.jpg'), env, {} as ExecutionContext)).headers.get('Content-Type')).toBe('image/jpeg')
    })

    it('only lets the token holder make a card', async () => {
      const { env, addIssue } = setup()
      addIssue('2026-11-19')

      const response = await worker.fetch(new Request('https://site.example.com/feel-good/instagram', { method: 'POST' }), env, {} as ExecutionContext)

      expect(response.status).toBe(401)
      expect(env.sqlite.prepare('SELECT COUNT(*) AS n FROM instagram_posts').get()).toEqual({ n: 0 })
    })
  })
})
