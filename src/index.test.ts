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
    expect(html).not.toContain('Dublin is piloting')
    expect(html).not.toContain('An older story.')
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
