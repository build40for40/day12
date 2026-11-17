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
})
