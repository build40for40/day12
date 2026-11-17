import { describe, expect, it } from 'vitest'
import { BATCH_LIMIT, sendBatch, sendEmail, type PostmarkMessage } from './postmark'
import type { FetchLike } from './types'

interface Call {
  url: string
  headers: Record<string, string>
  body: unknown
}

function recorder(respond: (call: Call, index: number) => Response): { calls: Call[]; fetchImpl: FetchLike } {
  const calls: Call[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    const call = { url, headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) }
    calls.push(call)
    return respond(call, calls.length - 1)
  }
  return { calls, fetchImpl }
}

const message = (n: number): PostmarkMessage => ({
  from: 'fake.sender@example.com',
  to: `fake.reader.${n}@example.com`,
  subject: 'A fake subject',
  textBody: 'Fake body',
  messageStream: 'broadcast',
  headers: { 'List-Unsubscribe': '<https://example.com/unsubscribe?token=fake>' },
})

const okFor = (call: Call) => Response.json((call.body as unknown[]).map(() => ({ ErrorCode: 0, Message: 'OK' })))

describe('sendEmail', () => {
  it('posts one message to the email endpoint with the server token and stream', async () => {
    const { calls, fetchImpl } = recorder(() => Response.json({ ErrorCode: 0, Message: 'OK' }))

    const result = await sendEmail('fake-token', message(1), fetchImpl)

    expect(result).toEqual({ ok: true, errorCode: 0 })
    expect(calls[0]).toMatchObject({
      url: 'https://api.postmarkapp.com/email',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': 'fake-token' },
      body: {
        From: 'fake.sender@example.com',
        To: 'fake.reader.1@example.com',
        Subject: 'A fake subject',
        TextBody: 'Fake body',
        MessageStream: 'broadcast',
        Headers: [{ Name: 'List-Unsubscribe', Value: '<https://example.com/unsubscribe?token=fake>' }],
      },
    })
  })

  it('reports the Postmark error code when the message is refused', async () => {
    const { fetchImpl } = recorder(() => Response.json({ ErrorCode: 300, Message: 'Invalid' }, { status: 422 }))

    expect(await sendEmail('fake-token', message(1), fetchImpl)).toEqual({ ok: false, errorCode: 300 })
  })
})

describe('sendBatch', () => {
  it('splits into calls of at most 500 and keeps results in order', async () => {
    const { calls, fetchImpl } = recorder(okFor)
    const messages = Array.from({ length: BATCH_LIMIT + 1 }, (_, n) => message(n))

    const results = await sendBatch('fake-token', messages, fetchImpl)

    expect(calls.map((call) => [call.url, (call.body as unknown[]).length])).toEqual([
      ['https://api.postmarkapp.com/email/batch', 500],
      ['https://api.postmarkapp.com/email/batch', 1],
    ])
    expect(results).toHaveLength(501)
    expect(results.every((result) => result.ok)).toBe(true)
  })

  it('reports each refused message on its own inside a 200 answer', async () => {
    const { fetchImpl } = recorder(() => Response.json([{ ErrorCode: 0, Message: 'OK' }, { ErrorCode: 406, Message: 'Inactive' }]))

    expect(await sendBatch('fake-token', [message(1), message(2)], fetchImpl)).toEqual([
      { ok: true, errorCode: 0 },
      { ok: false, errorCode: 406 },
    ])
  })

  it('fails only the batch that breaks and still sends the next one', async () => {
    const { fetchImpl } = recorder((call, index) => {
      if (index === 0) throw new Error('connection reset')
      return okFor(call)
    })
    const messages = Array.from({ length: BATCH_LIMIT + 2 }, (_, n) => message(n))

    const results = await sendBatch('fake-token', messages, fetchImpl)

    expect(results.filter((result) => !result.ok)).toHaveLength(500)
    expect(results.slice(BATCH_LIMIT)).toEqual([{ ok: true, errorCode: 0 }, { ok: true, errorCode: 0 }])
  })

  it('fails the whole batch with the error code when the token is rejected', async () => {
    const { fetchImpl } = recorder(() => Response.json({ ErrorCode: 10, Message: 'Bad token' }, { status: 401 }))

    expect(await sendBatch('fake-token', [message(1), message(2)], fetchImpl)).toEqual([
      { ok: false, errorCode: 10 },
      { ok: false, errorCode: 10 },
    ])
  })
})
