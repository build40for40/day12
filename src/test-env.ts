import { fakeD1 } from './fake-d1'
import type { Env } from './types'

export function fakeEnv(): Env & { sqlite: ReturnType<typeof fakeD1>['sqlite'] } {
  const { db, sqlite } = fakeD1()
  return {
    DB: db,
    sqlite,
    PULL_TOKEN: 'x',
    POSTMARK_SERVER_TOKEN: 'fake-token',
    EMAIL_FROM: 'fake.sender@example.com',
    PUBLIC_BASE_URL: 'https://brief.example.com/',
    ALLOWED_ORIGIN: 'https://site.example.com',
    POSTMARK_TRANSACTIONAL_STREAM: 'outbound',
    POSTMARK_BROADCAST_STREAM: 'broadcast',
  }
}
