import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import worker from './index'
import type { Env } from './types'

function fakeEnv(): { env: Env; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync('migrations/0002_subscribers.sql', 'utf8'))
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    bind: (...args: SQLInputValue[]) => statement(sql, args),
    run: async () => ({ results: [], meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } }),
  })
  const DB = { prepare: (sql: string) => statement(sql) } as unknown as D1Database
  return { env: { DB, PULL_TOKEN: 'fake-token' }, sqlite }
}

const signUp = (fields: Record<string, string>): Parameters<typeof worker.fetch>[0] =>
  new Request('https://example.test/feel-good/subscribe', { method: 'POST', body: new URLSearchParams(fields) })

const emails = (sqlite: DatabaseSync) => sqlite.prepare('SELECT email FROM subscribers').all()

describe('GET /feel-good', () => {
  it('serves the landing page with the signup form', async () => {
    const response = await worker.fetch(new Request('https://example.test/feel-good'), fakeEnv().env)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/html')
    expect(await response.text()).toContain('action="/feel-good/subscribe"')
  })
})

describe('POST /feel-good/subscribe', () => {
  it('stores the email and redirects to the confirmation', async () => {
    const { env, sqlite } = fakeEnv()

    const response = await worker.fetch(signUp({ email: ' Fake.Reader@example.com' }), env)

    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('https://example.test/feel-good?joined=1')
    expect(emails(sqlite)).toEqual([{ email: 'fake.reader@example.com' }])
  })

  it('sends an invalid email back to the form without storing it', async () => {
    const { env, sqlite } = fakeEnv()

    const response = await worker.fetch(signUp({ email: 'not an email' }), env)

    expect(response.headers.get('Location')).toBe('https://example.test/feel-good?error=email')
    expect(emails(sqlite)).toEqual([])
  })

  it('stores nothing when the hidden field is filled in', async () => {
    const { env, sqlite } = fakeEnv()

    await worker.fetch(signUp({ email: 'fake.bot@example.com', website: 'https://example.test' }), env)

    expect(emails(sqlite)).toEqual([])
  })
})
