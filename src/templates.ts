export const NEWSLETTER_NAME = 'Feel good AI'
export const MAX_STORY_CHARS = 280
export const UNSUBSCRIBE_PLACEHOLDER = '{{unsubscribe_url}}'

const HOME_URL = 'https://build40for40.com'
const TIME_ZONE = 'Europe/London'

export type Stage = 'in_the_lab' | 'in_a_trial' | 'helping_people_now'

export interface NewsletterStory {
  text: string
  url: string
  stage?: Stage
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

const STAGE_LABELS: Record<Stage, string> = {
  in_the_lab: 'In the lab',
  in_a_trial: 'In a trial',
  helping_people_now: 'Helping people now',
}

const MUTED = 'color:#6b6861'

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function part(date: Date, options: Intl.DateTimeFormatOptions, type: Intl.DateTimeFormatPartTypes): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, ...options }).formatToParts(date)
  return parts.find((p) => p.type === type)?.value ?? ''
}

function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`
  return `${day}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`
}

export function issueSubject(date: Date): string {
  const day = Number(part(date, { day: 'numeric' }, 'day'))
  return `${part(date, { month: 'short' }, 'month')} ${ordinal(day)} - ${NEWSLETTER_NAME}`
}

function longDate(date: Date): string {
  return `${part(date, { weekday: 'long' }, 'weekday')} ${part(date, { day: 'numeric' }, 'day')} ${part(date, { month: 'long' }, 'month')}`
}

function sourceName(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '')
}

function checkStory(story: NewsletterStory, index: number): void {
  const length = [...story.text].length
  if (length === 0) throw new Error(`Story ${index + 1} has no text`)
  if (length > MAX_STORY_CHARS) throw new Error(`Story ${index + 1} is ${length} characters, the limit is ${MAX_STORY_CHARS}`)
  if (!/^https?:\/\//.test(story.url) || !URL.canParse(story.url)) throw new Error(`Story ${index + 1} has no usable source link`)
}

function shell(heading: string, body: string, footer: string): string {
  return `<div style="max-width:34rem;margin:0 auto;padding:24px 16px;font:16px/1.5 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1b1a">
<p style="margin:0;font-size:20px;font-weight:700">${NEWSLETTER_NAME}</p>
<p style="margin:0 0 24px;${MUTED}">${heading}</p>
${body}
<hr style="border:0;border-top:1px solid #dedad2;margin:32px 0 16px">
<div style="font-size:14px;${MUTED}">
${footer}
</div>
</div>`
}

function aboutHtml(signupUrl: string): string {
  return `<p style="margin:0 0 8px">${NEWSLETTER_NAME} is the <a href="${escapeHtml(signupUrl)}">Day 12 Build</a> of 40 for 40: 40 apps in 40 days, built live. See the rest at <a href="${HOME_URL}">build40for40.com</a>.</p>`
}

function aboutText(signupUrl: string): string {
  return `${NEWSLETTER_NAME} is the Day 12 Build of 40 for 40: 40 apps in 40 days, built live.\nDay 12 Build: ${signupUrl}\nThe rest: ${HOME_URL}`
}

export function renderNewsletter(stories: NewsletterStory[], date: Date, signupUrl: string): RenderedEmail {
  if (stories.length === 0) throw new Error('A newsletter needs at least one story')
  stories.forEach(checkStory)

  const htmlStories = stories
    .map((story) => {
      const source = `<a href="${escapeHtml(story.url)}">${escapeHtml(sourceName(story.url))}</a>`
      const meta = story.stage ? `${STAGE_LABELS[story.stage]} · ${source}` : source
      return `<p style="margin:0 0 4px">${escapeHtml(story.text)}</p>\n<p style="margin:0 0 24px;font-size:14px;${MUTED}">${meta}</p>`
    })
    .join('\n')

  const textStories = stories
    .map((story, index) => {
      const stage = story.stage ? `${STAGE_LABELS[story.stage]}. ` : ''
      return `${index + 1}. ${story.text}\n   ${stage}Source: ${story.url}`
    })
    .join('\n\n')

  return {
    subject: issueSubject(date),
    html: shell(longDate(date), htmlStories, `${aboutHtml(signupUrl)}\n<p style="margin:0"><a href="${UNSUBSCRIBE_PLACEHOLDER}">Unsubscribe</a></p>`),
    text: `${NEWSLETTER_NAME}\n${longDate(date)}\n\n${textStories}\n\n--\n${aboutText(signupUrl)}\nUnsubscribe: ${UNSUBSCRIBE_PLACEHOLDER}\n`,
  }
}

export function renderConfirmation(confirmUrl: string, signupUrl: string): RenderedEmail {
  const body = `<p style="margin:0 0 16px">Hello! Someone (hopefully you) asked for ${NEWSLETTER_NAME}, our daily handful of good news about AI.</p>
<p style="margin:0 0 16px"><a href="${escapeHtml(confirmUrl)}" style="font-weight:700">Yes, send me the good news</a></p>
<p style="margin:0">Not you? Ignore this and you won't hear from us again.</p>`

  return {
    subject: `Confirm your ${NEWSLETTER_NAME} sign-up`,
    html: shell('One quick thing before we start', body, aboutHtml(signupUrl)),
    text: `${NEWSLETTER_NAME}\n\nHello! Someone (hopefully you) asked for ${NEWSLETTER_NAME}, our daily handful of good news about AI.\n\nOpen this link to confirm and we'll start sending:\n${confirmUrl}\n\nNot you? Ignore this and you won't hear from us again.\n\n--\n${aboutText(signupUrl)}\n`,
  }
}
