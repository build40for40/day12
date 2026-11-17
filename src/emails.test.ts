import { describe, expect, it } from 'vitest'
import { sendConfirmation, sendNewsletter } from './emails'
import { addSignup, confirmSignup, listConfirmed } from './signups'
import { fakeEnv } from './test-env'
import type { Env, FetchLike } from './types'

const now = new Date('2026-11-17T06:00:00Z')

interface Sent {
  To: string
  HtmlBody: string
  TextBody: string
  MessageStream: string
  Headers: { Name: string; Value: string }[]
}

async function subscribe(env: Env, email: string): Promise<void> {
  const added = await addSignup(env.DB, email, now)
  await confirmSignup(env.DB, added!.confirmToken, now)
}

describe('sendConfirmation', () => {
  it('sends the confirm link through the transactional stream', async () => {
    const bodies: Sent[] = []
    const fetchImpl: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({ ErrorCode: 0 })
    }

    await sendConfirmation(fakeEnv(), 'fake.reader@example.com', 'abc123', fetchImpl)

    expect(bodies[0]).toMatchObject({ To: 'fake.reader@example.com', MessageStream: 'outbound' })
    expect(bodies[0]!.TextBody).toContain('https://brief.example.com/confirm?token=abc123')
    expect(bodies[0]!.HtmlBody).toContain('https://brief.example.com/confirm?token=abc123')
  })
})

describe('sendNewsletter', () => {
  it('sends each confirmed subscriber their own unsubscribe link and one-click headers on the broadcast stream', async () => {
    const env = fakeEnv()
    await subscribe(env, 'fake.one@example.com')
    await subscribe(env, 'fake.two@example.com')
    await addSignup(env.DB, 'fake.pending@example.com', now)
    const sent: Sent[] = []
    const fetchImpl: FetchLike = async (_url, init) => {
      const batch = JSON.parse(String(init?.body)) as Sent[]
      sent.push(...batch)
      return Response.json(batch.map(() => ({ ErrorCode: 0 })))
    }

    const report = await sendNewsletter(env, { subject: 'Fake brief', html: '<p>News</p><a href="{{unsubscribe_url}}">Leave</a>', text: 'News' }, fetchImpl, now)

    expect(report).toEqual({ sent: 2, failed: 0, suppressed: 0 })
    expect(sent.map((message) => message.To)).toEqual(['fake.one@example.com', 'fake.two@example.com'])
    const subscribers = await listConfirmed(env.DB)
    sent.forEach((message, index) => {
      const url = `https://brief.example.com/unsubscribe?token=${subscribers[index]!.unsubscribeToken}`
      expect(message.MessageStream).toBe('broadcast')
      expect(message.HtmlBody).toBe(`<p>News</p><a href="${url}">Leave</a>`)
      expect(message.TextBody).toBe(`News\n\nUnsubscribe: ${url}\n`)
      expect(message.Headers).toEqual([
        { Name: 'List-Unsubscribe', Value: `<${url}>` },
        { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
      ])
    })
  })

  it('counts a refused recipient as failed, sends the rest, and stops sending to an inactive one', async () => {
    const env = fakeEnv()
    await subscribe(env, 'fake.one@example.com')
    await subscribe(env, 'fake.bounced@example.com')
    await subscribe(env, 'fake.three@example.com')
    const fetchImpl: FetchLike = async () => Response.json([{ ErrorCode: 0 }, { ErrorCode: 406 }, { ErrorCode: 0 }])

    const report = await sendNewsletter(env, { subject: 'Fake brief', html: '<p>News</p>', text: 'News' }, fetchImpl, now)

    expect(report).toEqual({ sent: 2, failed: 1, suppressed: 1 })
    expect((await listConfirmed(env.DB)).map((s) => s.email)).toEqual(['fake.one@example.com', 'fake.three@example.com'])
  })

  it('reports everyone as failed when Postmark is down, without throwing', async () => {
    const env = fakeEnv()
    await subscribe(env, 'fake.one@example.com')
    const fetchImpl: FetchLike = async () => {
      throw new Error('connection reset')
    }

    expect(await sendNewsletter(env, { subject: 'Fake brief', html: '<p>News</p>', text: 'News' }, fetchImpl, now)).toEqual({ sent: 0, failed: 1, suppressed: 0 })
  })
})
