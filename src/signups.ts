export const CONFIRMATION_RESEND_MS = 24 * 3_600_000

const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/
const TOKEN = /^[0-9a-f]{64}$/
// D1 allows at most 100 bound parameters per statement.
const ID_CHUNK = 90

export interface Subscriber {
  id: number
  email: string
  unsubscribeToken: string
}

export function normaliseEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  return email.length <= 254 && EMAIL.test(email) ? email : null
}

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function isToken(value: string | null): value is string {
  return value !== null && TOKEN.test(value)
}

export async function addSignup(db: D1Database, email: string, now: Date): Promise<{ confirmToken: string } | null> {
  const at = now.toISOString()
  const cutoff = new Date(now.getTime() - CONFIRMATION_RESEND_MS).toISOString()
  const row = await db
    .prepare(
      `INSERT INTO signups (email, status, confirm_token, unsubscribe_token, created_at, confirmation_sent_at)
        VALUES (?, 'pending', ?, ?, ?, ?)
        ON CONFLICT (email) DO UPDATE SET
          status = 'pending',
          confirm_token = CASE WHEN signups.status = 'unsubscribed' THEN excluded.confirm_token ELSE signups.confirm_token END,
          confirmation_sent_at = excluded.confirmation_sent_at
        WHERE signups.status != 'confirmed'
          AND (signups.confirmation_sent_at IS NULL OR signups.confirmation_sent_at <= ?)
        RETURNING confirm_token`,
    )
    .bind(email, newToken(), newToken(), at, at, cutoff)
    .first<{ confirm_token: string }>()
  return row ? { confirmToken: row.confirm_token } : null
}

export async function releaseConfirmation(db: D1Database, confirmToken: string): Promise<void> {
  await db
    .prepare("UPDATE signups SET confirmation_sent_at = NULL WHERE confirm_token = ? AND status = 'pending'")
    .bind(confirmToken)
    .run()
}

export async function confirmSignup(db: D1Database, token: string, now: Date): Promise<boolean> {
  if (!isToken(token)) return false
  await db
    .prepare("UPDATE signups SET status = 'confirmed', confirmed_at = ? WHERE confirm_token = ? AND status = 'pending'")
    .bind(now.toISOString(), token)
    .run()
  const row = await db.prepare('SELECT status FROM signups WHERE confirm_token = ?').bind(token).first<{ status: string }>()
  return row?.status === 'confirmed'
}

export async function unsubscribe(db: D1Database, token: string, now: Date): Promise<boolean> {
  if (!isToken(token)) return false
  await db
    .prepare("UPDATE signups SET status = 'unsubscribed', unsubscribed_at = ? WHERE unsubscribe_token = ? AND status != 'unsubscribed'")
    .bind(now.toISOString(), token)
    .run()
  const row = await db.prepare('SELECT status FROM signups WHERE unsubscribe_token = ?').bind(token).first<{ status: string }>()
  return row?.status === 'unsubscribed'
}

export async function listConfirmed(db: D1Database): Promise<Subscriber[]> {
  const { results } = await db
    .prepare(
      `SELECT id, email, unsubscribe_token AS unsubscribeToken FROM signups
        WHERE status = 'confirmed' AND suppressed_at IS NULL ORDER BY id`,
    )
    .all<Subscriber>()
  return results
}

export async function markSuppressed(db: D1Database, ids: number[], now: Date): Promise<void> {
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const group = ids.slice(i, i + ID_CHUNK)
    await db
      .prepare(`UPDATE signups SET suppressed_at = ? WHERE suppressed_at IS NULL AND id IN (${group.map(() => '?').join(', ')})`)
      .bind(now.toISOString(), ...group)
      .run()
  }
}
