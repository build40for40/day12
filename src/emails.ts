import { INACTIVE_RECIPIENT, sendBatch, sendEmail, type PostmarkMessage, type SendResult } from './postmark'
import { listConfirmed, markSuppressed } from './signups'
import type { Env, FetchLike } from './types'

export const UNSUBSCRIBE_PLACEHOLDER = '{{unsubscribe_url}}'

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

function link(env: Env, path: string, token: string): string {
  return `${env.PUBLIC_BASE_URL.replace(/\/+$/, '')}${path}?token=${token}`
}

function withUnsubscribe(body: string, url: string, footer: string): string {
  return body.includes(UNSUBSCRIBE_PLACEHOLDER) ? body.replaceAll(UNSUBSCRIBE_PLACEHOLDER, url) : body + footer
}

export async function sendConfirmation(env: Env, email: string, confirmToken: string, fetchImpl: FetchLike = defaultFetch): Promise<SendResult> {
  const url = link(env, '/confirm', confirmToken)
  return sendEmail(
    env.POSTMARK_SERVER_TOKEN,
    {
      from: env.EMAIL_FROM,
      to: email,
      subject: 'One tap to confirm your daily dose of good news',
      textBody: `Hello!\n\nSomeone (hopefully you) asked for our daily brief of hopeful AI stories. Tap this link to confirm and we'll start sending:\n\n${url}\n\nNot you? Ignore this email and you won't hear from us again.\n`,
      htmlBody: `<p>Hello!</p><p>Someone (hopefully you) asked for our daily brief of hopeful AI stories. Tap the link to confirm and we'll start sending.</p><p><a href="${url}">Yes, send me the good news</a></p><p>Not you? Ignore this email and you won't hear from us again.</p>`,
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
      from: env.EMAIL_FROM,
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
