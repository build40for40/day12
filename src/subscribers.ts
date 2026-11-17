const MAX_EMAIL_LENGTH = 254
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normaliseEmail(input: string): string | null {
  const email = input.trim().toLowerCase()
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_SHAPE.test(email)) return null
  return email
}

export async function subscribe(db: D1Database, email: string, now: Date): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO subscribers (email, created_at) VALUES (?, ?)')
    .bind(email, now.toISOString())
    .run()
}
