import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { purgeOld, saveNew } from './store'
import type { Candidate } from './types'

const now = new Date('2026-11-17T06:00:00Z')

function fakeD1(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync('migrations/0001_init.sql', 'utf8'))
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    bind: (...args: SQLInputValue[]) => statement(sql, args),
    run: async () => ({ results: [], meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } }),
    all: async () => ({ results: sqlite.prepare(sql).all(...params), meta: { changes: 0 } }),
    sql,
  })
  type Fake = ReturnType<typeof statement>
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: Fake[]) =>
      Promise.all(statements.map((s) => (/^\s*SELECT/i.test(s.sql) ? s.all() : s.run()))),
  } as unknown as D1Database
  return { db, sqlite }
}

function candidate(url: string, titleKey: string): Candidate {
  return {
    url,
    title: 'A fake robot story',
    summary: '',
    publishedAt: null,
    sourceId: 'fake',
    tier: 'lead',
    urlKey: url.replace('https://', ''),
    titleKey,
  }
}

const count = (sqlite: DatabaseSync, table: string) =>
  Number((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n)

describe('saveNew', () => {
  it('skips a new url whose title_key is already in seen', async () => {
    const { db } = fakeD1()
    await saveNew(db, [candidate('https://example.test/first', 'robot plants trees')], now)

    const stored = await saveNew(db, [candidate('https://example.test/syndicated-copy', 'robot plants trees')], now)

    expect(stored).toEqual([])
  })
})

describe('purgeOld', () => {
  it('deletes candidates pulled over 30 days ago and keeps their seen rows', async () => {
    const { db, sqlite } = fakeD1()
    await saveNew(db, [candidate('https://example.test/old', 'old story')], new Date(now.getTime() - 31 * 86_400_000))
    await saveNew(db, [candidate('https://example.test/new', 'new story')], now)

    await purgeOld(db, now)

    expect(sqlite.prepare('SELECT url FROM candidates').all()).toEqual([{ url: 'https://example.test/new' }])
    expect(count(sqlite, 'seen')).toBe(2)
  })
})
