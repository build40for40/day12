import { describe, expect, it } from 'vitest'
import { confirm, signup, signupPreflight, unsubscribeForm, unsubscribeNow } from './routes'
import { fakeEnv } from './test-env'
import type { Env, FetchLike } from './types'

const now = new Date('2026-11-17T06:00:00Z')
const BASE = 'https://brief.example.com'

function postmark(answer: () => Response = () => Response.json({ ErrorCode: 0 })): { sent: { To: string; TextBody: string }[]; fetchImpl: FetchLike } {
  const sent: { To: string; TextBody: string }[] = []
  return {
    sent,
    fetchImpl: async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)))
      return answer()
    },
  }
}

async function post(env: Env, fetchImpl: FetchLike, init: RequestInit, at = now): Promise<Response> {
  const work: Promise<unknown>[] = []
  const response = await signup(new Request(`${BASE}/signups`, { method: 'POST', ...init }), env, (p) => work.push(p), fetchImpl, at)
  await Promise.all(work)
  return response
}

const json = (email: string, origin?: string): RequestInit => ({
  headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
  body: JSON.stringify({ email }),
})

const rows = (env: ReturnType<typeof fakeEnv>) =>
  env.sqlite.prepare('SELECT email, status, confirm_token, unsubscribe_token, confirmation_sent_at FROM signups').all() as Record<string, string>[]

describe('POST /signups', () => {
  it('stores a JSON signup as pending and emails the confirm link', async () => {
    const env = fakeEnv()
    const { sent, fetchImpl } = postmark()

    const response = await post(env, fetchImpl, json(' Fake.Reader@Example.com '))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(rows(env)).toMatchObject([{ email: 'fake.reader@example.com', status: 'pending' }])
    expect(sent).toHaveLength(1)
    expect(sent[0]!.TextBody).toContain(`${BASE}/confirm?token=${rows(env)[0]!.confirm_token}`)
  })

  it('accepts a form-encoded signup', async () => {
    const env = fakeEnv()
    const { fetchImpl } = postmark()

    const response = await post(env, fetchImpl, { body: new URLSearchParams({ email: 'fake.reader@example.com' }) })

    expect(response.status).toBe(200)
    expect(rows(env)).toHaveLength(1)
  })

  it('answers a repeat signup exactly like the first and sends no second email', async () => {
    const env = fakeEnv()
    const { sent, fetchImpl } = postmark()
    const first = await post(env, fetchImpl, json('fake.reader@example.com'))

    const second = await post(env, fetchImpl, json('fake.reader@example.com'))

    expect([second.status, await second.text()]).toEqual([first.status, await first.text()])
    expect([...second.headers]).toEqual([...first.headers])
    expect(sent).toHaveLength(1)
    expect(rows(env)).toHaveLength(1)
  })

  it.each([json('not-an-email'), { headers: { 'Content-Type': 'application/json' }, body: '{' }, { body: 'x'.repeat(5000) }])(
    'rejects a bad request with 400 and stores nothing',
    async (init) => {
      const env = fakeEnv()
      const { sent, fetchImpl } = postmark()

      const response = await post(env, fetchImpl, init)

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ ok: false, error: 'invalid_email' })
      expect(rows(env)).toEqual([])
      expect(sent).toEqual([])
    },
  )

  it('still answers ok when Postmark fails, and lets the address try again straight away', async () => {
    const env = fakeEnv()
    const broken = postmark(() => Response.json({ ErrorCode: 10 }, { status: 401 }))
    const working = postmark()

    const response = await post(env, broken.fetchImpl, json('fake.reader@example.com'))
    await post(env, working.fetchImpl, json('fake.reader@example.com'))

    expect(await response.json()).toEqual({ ok: true })
    expect(working.sent).toHaveLength(1)
  })

  it('answers 503 and stores nothing when the Postmark token is not set', async () => {
    const env = { ...fakeEnv(), POSTMARK_SERVER_TOKEN: '' }

    const response = await post(env, postmark().fetchImpl, json('fake.reader@example.com'))

    expect(response.status).toBe(503)
    expect(rows(env)).toEqual([])
  })

  it('allows CORS for the configured origin only', async () => {
    const env = fakeEnv()
    const { fetchImpl } = postmark()

    const allowed = await post(env, fetchImpl, json('fake.one@example.com', 'https://site.example.com'))
    const other = await post(env, fetchImpl, json('fake.two@example.com', 'https://elsewhere.example.com'))

    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://site.example.com')
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

describe('OPTIONS /signups', () => {
  const preflight = (env: Env, origin: string) =>
    signupPreflight(new Request(`${BASE}/signups`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } }), env)

  it('answers the preflight for the configured origin', () => {
    const response = preflight(fakeEnv(), 'https://site.example.com')

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://site.example.com')
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type')
  })

  it('falls back to build40for40.com when no origin is configured and refuses others', () => {
    const env = { ...fakeEnv(), ALLOWED_ORIGIN: '' }

    expect(preflight(env, 'https://build40for40.com').headers.get('Access-Control-Allow-Origin')).toBe('https://build40for40.com')
    expect(preflight(env, 'https://site.example.com').headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

describe('confirm and unsubscribe', () => {
  async function signedUp() {
    const env = fakeEnv()
    await post(env, postmark().fetchImpl, json('fake.reader@example.com'))
    return { env, ...rows(env)[0]! } as { env: ReturnType<typeof fakeEnv>; confirm_token: string; unsubscribe_token: string }
  }

  it('GET /confirm confirms the row and says so', async () => {
    const { env, confirm_token } = await signedUp()

    const response = await confirm(new Request(`${BASE}/confirm?token=${confirm_token}`), env, now)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/html')
    expect(await response.text()).toContain("You're in!")
    expect(rows(env)).toMatchObject([{ status: 'confirmed' }])
  })

  it('GET /confirm with a bad token changes nothing', async () => {
    const { env } = await signedUp()

    const response = await confirm(new Request(`${BASE}/confirm?token=nope`), env, now)

    expect(response.status).toBe(404)
    expect(rows(env)).toMatchObject([{ status: 'pending' }])
  })

  it('GET /unsubscribe shows a button that posts and changes nothing', async () => {
    const { env, confirm_token, unsubscribe_token } = await signedUp()
    await confirm(new Request(`${BASE}/confirm?token=${confirm_token}`), env, now)

    const response = unsubscribeForm(new Request(`${BASE}/unsubscribe?token=${unsubscribe_token}`))

    expect(await response.text()).toContain(`<form method="post" action="/unsubscribe?token=${unsubscribe_token}">`)
    expect(rows(env)).toMatchObject([{ status: 'confirmed' }])
  })

  it('GET /unsubscribe never echoes a malformed token into the page', async () => {
    const response = unsubscribeForm(new Request(`${BASE}/unsubscribe?token=%22%3E%3Cscript%3E`))

    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('<script>')
  })

  it('POST /unsubscribe unsubscribes, as the one-click target does', async () => {
    const { env, confirm_token, unsubscribe_token } = await signedUp()
    await confirm(new Request(`${BASE}/confirm?token=${confirm_token}`), env, now)

    const response = await unsubscribeNow(
      new Request(`${BASE}/unsubscribe?token=${unsubscribe_token}`, { method: 'POST', body: new URLSearchParams({ 'List-Unsubscribe': 'One-Click' }) }),
      env,
      now,
    )

    expect(response.status).toBe(200)
    expect(rows(env)).toMatchObject([{ status: 'unsubscribed' }])
  })
})
