import { describe, expect, it } from 'vitest'
import worker from './index'
import { fakeEnv } from './test-env'

describe('GET /', () => {
  it('serves the landing page with a form that posts to the signups route under the base path', async () => {
    const env = { ...fakeEnv(), PUBLIC_BASE_URL: 'https://site.example.com/feel-good' }

    const response = await worker.fetch(new Request('https://site.example.com/feel-good'), env, {} as ExecutionContext)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/html')
    expect(await response.text()).toContain('action="/feel-good/signups"')
  })

  it('shows the fallback story before anything is published, then the latest issue', async () => {
    const env = { ...fakeEnv(), PUBLIC_BASE_URL: 'https://site.example.com/feel-good' }
    const page = async () => (await worker.fetch(new Request('https://site.example.com/feel-good'), env, {} as ExecutionContext)).text()

    expect(await page()).toContain('Dublin is piloting an AI flood warning')

    const insert = env.sqlite.prepare(
      `INSERT INTO issues (date, story_id, text, url, stage, place, created_at) VALUES (?, ?, ?, ?, 'in_a_trial', ?, '2026-11-18T06:00:00Z')`,
    )
    insert.run('2026-11-17', 'older', 'An older story.', 'https://example.org/older', null)
    insert.run('2026-11-18', 'eagles', 'AI cameras slow turbines when eagles fly near <fast>.', 'https://example.org/eagles', 'Wyoming, USA')
    const html = await page()

    expect(html).toContain('18 November 2026')
    expect(html).toContain('AI cameras slow turbines when eagles fly near &lt;fast&gt;.')
    expect(html).toContain('<div class="place">Wyoming, USA</div>')
    expect(html).toContain('<div class="source">In a trial · <a href="https://example.org/eagles">example.org</a></div>')
    expect(html).not.toContain('Dublin is piloting')
    expect(html).not.toContain('An older story.')
  })

  it('shows a past day at ?date= with links to the days either side', async () => {
    const env = { ...fakeEnv(), PUBLIC_BASE_URL: 'https://site.example.com/feel-good' }
    const insert = env.sqlite.prepare(
      `INSERT INTO issues (date, story_id, text, url, place, created_at) VALUES (?, ?, ?, 'https://example.org/x', NULL, '2026-11-17T06:00:00Z')`,
    )
    insert.run('2026-11-15', 'a', 'Story of the fifteenth.')
    insert.run('2026-11-16', 'b', 'Story of the sixteenth.')
    insert.run('2026-11-17', 'c', 'Story of the seventeenth.')
    const get = (query: string) => worker.fetch(new Request(`https://site.example.com/feel-good${query}`), env, {} as ExecutionContext)

    const middle = await get('?date=2026-11-16')
    const html = await middle.text()
    expect(middle.status).toBe(200)
    expect(html).toContain('Story of the sixteenth.')
    expect(html).toContain('16 November 2026')
    expect(html).toContain('href="/feel-good?date=2026-11-15" rel="prev"')
    expect(html).toContain('href="/feel-good?date=2026-11-17" rel="next"')

    const latest = await (await get('')).text()
    expect(latest).toContain('Story of the seventeenth.')
    expect(latest).toContain('rel="prev"')
    expect(latest).not.toContain('rel="next"')

    const first = await (await get('?date=2026-11-15')).text()
    expect(first).not.toContain('rel="prev"')
  })

  it('answers 404 for a day with no story or a date that is not a date', async () => {
    const env = { ...fakeEnv(), PUBLIC_BASE_URL: 'https://site.example.com/feel-good' }
    env.sqlite
      .prepare(`INSERT INTO issues (date, story_id, text, url, created_at) VALUES ('2026-11-16', 'b', 'Story of the sixteenth.', 'https://example.org/x', '2026-11-16T06:00:00Z')`)
      .run()
    const get = (query: string) => worker.fetch(new Request(`https://site.example.com/feel-good${query}`), env, {} as ExecutionContext)

    const gap = await get('?date=2026-11-10')
    expect(gap.status).toBe(404)
    const html = await gap.text()
    expect(html).toContain('No story went out on 10 November 2026.')
    expect(html).toContain('href="/feel-good?date=2026-11-16" rel="next"')

    const nonsense = await get('?date=<script>')
    expect(nonsense.status).toBe(404)
    expect(await nonsense.text()).not.toContain('<script>"')
  })

  it('leaves out the place line when the issue has none', async () => {
    const env = { ...fakeEnv(), PUBLIC_BASE_URL: 'https://site.example.com/feel-good' }
    env.sqlite
      .prepare(`INSERT INTO issues (date, story_id, text, url, created_at) VALUES ('2026-11-18', 'x', 'No place here.', 'https://example.org/x', '2026-11-18T06:00:00Z')`)
      .run()

    const html = await (await worker.fetch(new Request('https://site.example.com/feel-good'), env, {} as ExecutionContext)).text()

    expect(html).toContain('No place here.')
    expect(html).not.toContain('class="place"')
  })
})
