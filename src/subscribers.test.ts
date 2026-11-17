import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { normaliseEmail, subscribe } from './subscribers'

const now = new Date('2026-11-17T06:00:00Z')

function fakeD1(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync('migrations/0002_subscribers.sql', 'utf8'))
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    bind: (...args: SQLInputValue[]) => statement(sql, args),
    run: async () => ({ results: [], meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } }),
  })
  const db = { prepare: (sql: string) => statement(sql) } as unknown as D1Database
  return { db, sqlite }
}

describe('normaliseEmail', () => {
  it('trims and lowercases a valid address', () => {
    expect(normaliseEmail('  Fake.Reader@Example.COM ')).toBe('fake.reader@example.com')
  })

  it('rejects text that is not an email address', () => {
    expect(normaliseEmail('not an email')).toBeNull()
  })
})

describe('subscribe', () => {
  it('stores an address once when it signs up twice', async () => {
    const { db, sqlite } = fakeD1()

    await subscribe(db, 'fake.reader@example.com', now)
    await subscribe(db, 'fake.reader@example.com', now)

    expect(sqlite.prepare('SELECT email, created_at FROM subscribers').all()).toEqual([
      { email: 'fake.reader@example.com', created_at: '2026-11-17T06:00:00.000Z' },
    ])
  })
})
