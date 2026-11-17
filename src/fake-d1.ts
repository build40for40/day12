import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

export function fakeD1(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:')
  for (const file of readdirSync('migrations').sort()) sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'))
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    bind: (...args: SQLInputValue[]) => statement(sql, args),
    run: async () => ({ results: [], meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } }),
    all: async () => ({ results: sqlite.prepare(sql).all(...params), meta: { changes: 0 } }),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
  })
  const db = { prepare: (sql: string) => statement(sql) } as unknown as D1Database
  return { db, sqlite }
}
