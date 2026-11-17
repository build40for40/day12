import { INACTIVE_RECIPIENT, sendBatch, sendEmail, type PostmarkMessage, type SendResult } from './postmark'
import { listConfirmed, markSuppressed } from './signups'
import { NEWSLETTER_NAME, renderConfirmation, UNSUBSCRIBE_PLACEHOLDER } from './templates'
import type { Env, FetchLike } from './types'

export interface Newsletter {
  subject: string
  html: string
  text: string
}

export interface NewsletterReport {
  sent: number
  failed: number
  suppressed: number
}

const defaultFetch: FetchLike = (input, init) => fetch(input, init)

export function publicUrl(env: Env): string {
  return env.PUBLIC_BASE_URL.replace(/\/+$/, '')
}

function link(env: Env, path: string, token: string): string {
  return `${publicUrl(env)}${path}?token=${token}`
}

function sender(env: Env): string {
  return `${NEWSLETTER_NAME} <${env.EMAIL_FROM}>`
}

function withUnsubscribe(body: string, url: string, footer: string): string {
  return body.includes(UNSUBSCRIBE_PLACEHOLDER) ? body.replaceAll(UNSUBSCRIBE_PLACEHOLDER, url) : body + footer
}

export async function sendConfirmation(env: Env, email: string, confirmToken: string, fetchImpl: FetchLike = defaultFetch): Promise<SendResult> {
  const rendered = renderConfirmation(link(env, '/confirm', confirmToken), publicUrl(env))
  return sendEmail(
    env.POSTMARK_SERVER_TOKEN,
    {
      from: sender(env),
      to: email,
      subject: rendered.subject,
      textBody: rendered.text,
      htmlBody: rendered.html,
      messageStream: env.POSTMARK_TRANSACTIONAL_STREAM,
    },
    fetchImpl,
  )
}

export async function sendNewsletter(env: Env, newsletter: Newsletter, fetchImpl: FetchLike = defaultFetch, now = new Date()): Promise<NewsletterReport> {
  const subscribers = await listConfirmed(env.DB)
  const messages = subscribers.map((subscriber): PostmarkMessage => {
    const url = link(env, '/unsubscribe', subscriber.unsubscribeToken)
    return {
      from: sender(env),
      to: subscriber.email,
      subject: newsletter.subject,
      htmlBody: withUnsubscribe(newsletter.html, url, `<p><a href="${url}">Unsubscribe</a></p>`),
      textBody: withUnsubscribe(newsletter.text, url, `\n\nUnsubscribe: ${url}\n`),
      messageStream: env.POSTMARK_BROADCAST_STREAM,
      headers: { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }
  })

  const results = await sendBatch(env.POSTMARK_SERVER_TOKEN, messages, fetchImpl)
  const inactive = subscribers.filter((_, index) => results[index]?.errorCode === INACTIVE_RECIPIENT).map((s) => s.id)
  await markSuppressed(env.DB, inactive, now)

  const sent = results.filter((result) => result.ok).length
  return { sent, failed: results.length - sent, suppressed: inactive.length }
}
