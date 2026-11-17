import type { FetchLike } from './types'

const API = 'https://api.postmarkapp.com'
const REQUEST_TIMEOUT_MS = 15_000

export const BATCH_LIMIT = 500
export const INACTIVE_RECIPIENT = 406

export interface PostmarkMessage {
  from: string
  to: string
  subject: string
  htmlBody?: string
  textBody?: string
  messageStream: string
  headers?: Record<string, string>
}

export interface SendResult {
  ok: boolean
  errorCode: number | null
}

interface PostmarkResponse {
  ErrorCode?: number
}

function toBody(message: PostmarkMessage): Record<string, unknown> {
  return {
    From: message.from,
    To: message.to,
    Subject: message.subject,
    HtmlBody: message.htmlBody,
    TextBody: message.textBody,
    MessageStream: message.messageStream,
    Headers: Object.entries(message.headers ?? {}).map(([Name, Value]) => ({ Name, Value })),
  }
}

async function post(path: string, token: string, body: unknown, fetchImpl: FetchLike): Promise<unknown> {
  const response = await fetchImpl(`${API}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': token },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const parsed: unknown = await response.json().catch(() => null)
  if (!response.ok && (parsed === null || Array.isArray(parsed))) throw new Error(`Postmark answered ${response.status}`)
  return parsed
}

function toResult(entry: unknown): SendResult {
  const code = (entry as PostmarkResponse | null)?.ErrorCode
  return typeof code === 'number' ? { ok: code === 0, errorCode: code } : { ok: false, errorCode: null }
}

export async function sendEmail(token: string, message: PostmarkMessage, fetchImpl: FetchLike): Promise<SendResult> {
  return toResult(await post('/email', token, toBody(message), fetchImpl))
}

export async function sendBatch(token: string, messages: PostmarkMessage[], fetchImpl: FetchLike): Promise<SendResult[]> {
  const results: SendResult[] = []
  for (let i = 0; i < messages.length; i += BATCH_LIMIT) {
    const group = messages.slice(i, i + BATCH_LIMIT)
    const answer = await post('/email/batch', token, group.map(toBody), fetchImpl).catch(() => null)
    const entries = Array.isArray(answer) ? answer : []
    const whole = Array.isArray(answer) ? null : toResult(answer)
    group.forEach((_, index) => results.push(whole ?? toResult(entries[index])))
  }
  return results
}
