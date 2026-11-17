import { describe, expect, it } from 'vitest'
import { fakeD1 } from './fake-d1'
import { addSignup, confirmSignup, CONFIRMATION_RESEND_MS, listConfirmed, markSuppressed, newToken, normaliseEmail, unsubscribe } from './signups'

const now = new Date('2026-11-17T06:00:00Z')
const later = (ms: number) => new Date(now.getTime() + ms)
const EMAIL = 'fake.reader@example.com'

const row = (sqlite: ReturnType<typeof fakeD1>['sqlite']) =>
  sqlite.prepare('SELECT * FROM signups').all() as { status: string; confirm_token: string; unsubscribe_token: string }[]

describe('normaliseEmail', () => {
  it('trims and lower-cases a valid address', () => {
    expect(normaliseEmail('  Fake.Reader@Example.COM ')).toBe(EMAIL)
  })

  it.each(['', 'nope', 'a@b', 'two@example.com,three@example.com', 'spaced out@example.com', '<x@example.com>'])('rejects %j', (raw) => {
    expect(normaliseEmail(raw)).toBeNull()
  })
})

describe('newToken', () => {
  it('makes a different 64 character hex token each time', () => {
    expect(newToken()).toMatch(/^[0-9a-f]{64}$/)
    expect(newToken()).not.toBe(newToken())
  })
})

describe('addSignup', () => {
  it('stores one pending row and asks for a confirmation', async () => {
    const { db, sqlite } = fakeD1()

    const added = await addSignup(db, EMAIL, now)

    expect(row(sqlite)).toMatchObject([{ email: EMAIL, status: 'pending', confirm_token: added?.confirmToken }])
  })

  it('keeps one row and sends nothing when the same address signs up again inside the window', async () => {
    const { db, sqlite } = fakeD1()
    await addSignup(db, EMAIL, now)

    expect(await addSignup(db, EMAIL, later(CONFIRMATION_RESEND_MS - 1))).toBeNull()
    expect(row(sqlite)).toHaveLength(1)
  })

  it('resends the same link to a pending address once the window has passed', async () => {
    const { db } = fakeD1()
    const first = await addSignup(db, EMAIL, now)

    expect(await addSignup(db, EMAIL, later(CONFIRMATION_RESEND_MS))).toEqual(first)
  })

  it('never emails or changes a confirmed address', async () => {
    const { db, sqlite } = fakeD1()
    const first = await addSignup(db, EMAIL, now)
    await confirmSignup(db, first!.confirmToken, now)

    expect(await addSignup(db, EMAIL, later(CONFIRMATION_RESEND_MS * 2))).toBeNull()
    expect(row(sqlite)).toMatchObject([{ status: 'confirmed' }])
  })

  it('lets an unsubscribed address back in through a fresh confirmation', async () => {
    const { db, sqlite } = fakeD1()
    const first = await addSignup(db, EMAIL, now)
    await confirmSignup(db, first!.confirmToken, now)
    const { unsubscribe_token: unsubscribeToken } = row(sqlite)[0]!
    await unsubscribe(db, unsubscribeToken, now)

    const again = await addSignup(db, EMAIL, later(CONFIRMATION_RESEND_MS))

    expect(again?.confirmToken).not.toBe(first!.confirmToken)
    expect(row(sqlite)).toMatchObject([{ status: 'pending', unsubscribe_token: unsubscribeToken }])
    expect(await confirmSignup(db, first!.confirmToken, now)).toBe(false)
    expect(await confirmSignup(db, again!.confirmToken, now)).toBe(true)
  })
})

describe('confirmSignup', () => {
  it('confirms a pending row and stays true when the link is used twice', async () => {
    const { db } = fakeD1()
    const { confirmToken } = (await addSignup(db, EMAIL, now))!

    expect(await confirmSignup(db, confirmToken, now)).toBe(true)
    expect(await confirmSignup(db, confirmToken, now)).toBe(true)
  })

  it('rejects unknown and malformed tokens', async () => {
    const { db } = fakeD1()
    await addSignup(db, EMAIL, now)

    expect(await confirmSignup(db, newToken(), now)).toBe(false)
    expect(await confirmSignup(db, "' OR 1=1 --", now)).toBe(false)
  })
})

describe('unsubscribe', () => {
  it('marks the row unsubscribed and cannot be undone by the old confirm link', async () => {
    const { db, sqlite } = fakeD1()
    const { confirmToken } = (await addSignup(db, EMAIL, now))!
    await confirmSignup(db, confirmToken, now)

    expect(await unsubscribe(db, row(sqlite)[0]!.unsubscribe_token, now)).toBe(true)
    expect(await confirmSignup(db, confirmToken, now)).toBe(false)
    expect(row(sqlite)).toMatchObject([{ status: 'unsubscribed', unsubscribed_at: now.toISOString() }])
  })

  it('rejects an unknown token', async () => {
    const { db } = fakeD1()

    expect(await unsubscribe(db, newToken(), now)).toBe(false)
  })
})

describe('listConfirmed', () => {
  it('lists only confirmed addresses that are not suppressed', async () => {
    const { db } = fakeD1()
    const tokens: string[] = []
    for (const name of ['pending', 'confirmed', 'bounced', 'gone']) {
      tokens.push((await addSignup(db, `fake.${name}@example.com`, now))!.confirmToken)
    }
    for (const token of tokens.slice(1)) await confirmSignup(db, token, now)
    const confirmed = await listConfirmed(db)
    await markSuppressed(db, [confirmed[1]!.id], now)
    await unsubscribe(db, confirmed[2]!.unsubscribeToken, now)

    expect(await listConfirmed(db)).toEqual([{ id: confirmed[0]!.id, email: 'fake.confirmed@example.com', unsubscribeToken: confirmed[0]!.unsubscribeToken }])
  })
})
