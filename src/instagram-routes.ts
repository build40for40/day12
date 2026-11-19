import { londonDay } from './bank'
import { findInstagramPost, findLatestInstagramPost, instagramNeighbours, makeInstagramPost, type InstagramPost, type RenderCard } from './instagram'
import { longDate } from './landing'
import { findIssue } from './publish'
import type { Env } from './types'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
// The cards are public once made, since the story is already on the website, but there's no reason for a search engine to list them.
const NOT_LISTED = { 'X-Robots-Tag': 'noindex, nofollow' }

const validDate = (value: string | null): value is string => value !== null && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

const basePathOf = (env: Pick<Env, 'PUBLIC_BASE_URL'>) => (URL.canParse(env.PUBLIC_BASE_URL) ? new URL(env.PUBLIC_BASE_URL).pathname.replace(/\/+$/, '') : '')

const styles = `
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; padding: 14px; background: #D9D6CE; color: #1C1B19; font-family: 'EB Garamond', Georgia, 'Times New Roman', serif; }
a { color: inherit; }
:focus-visible { outline: 2px solid #1C1B19; outline-offset: 3px; }
.sheet { max-width: 560px; margin: 0 auto; padding: 30px 28px 26px; background: #F6F4EE; box-shadow: 0 1px 2px rgba(28, 27, 25, 0.25); }
.masthead { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 4px 16px; font-size: 17px; }
.masthead h1 { margin: 0; font-size: inherit; font-weight: 400; font-style: italic; }
.note { margin: 24px 0 0; font-size: 17px; font-style: italic; }
.card { display: block; width: 100%; height: auto; margin-top: 28px; box-shadow: 0 1px 2px rgba(28, 27, 25, 0.25); }
.actions { margin-top: 22px; display: flex; flex-direction: column; gap: 12px; }
.button { display: block; width: 100%; height: 54px; line-height: 54px; text-align: center; font: inherit; font-size: 20px; font-weight: 500; color: #F6F4EE; background: #1C1B19; border: 0; border-radius: 0; text-decoration: none; cursor: pointer; }
.button.quiet { color: #1C1B19; background: transparent; border: 1px solid #1C1B19; }
label { display: block; margin-top: 34px; font-size: 16px; font-style: italic; }
textarea { display: block; width: 100%; height: 330px; margin-top: 8px; padding: 12px; font: inherit; font-size: 18px; line-height: 1.4; color: inherit; background: transparent; border: 1px solid #1C1B19; border-radius: 0; resize: vertical; }
.days { margin-top: 36px; display: flex; justify-content: space-between; gap: 16px; font-size: 16px; font-style: italic; }
`

const copyScript = `
const box = document.getElementById('caption')
const button = document.getElementById('copy')
button.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(box.value) } catch { box.select(); document.execCommand('copy') }
  button.textContent = 'Copied'
  setTimeout(() => { button.textContent = 'Copy caption' }, 2000)
})
`

interface PageView {
  basePath: string
  post: InstagramPost | null
  /** Set when the page was asked for one day and shows another. */
  note?: string
  days?: { previous: string | null; next: string | null }
}

export function renderInstagramPage({ basePath, post, note, days }: PageView): string {
  const nav = (date: string, label: string, rel: string) => `<a href="${escapeHtml(`${basePath}/instagram?date=${date}`)}" rel="${rel}">${label}</a>`
  const daysNav =
    days && (days.previous || days.next)
      ? `<nav class="days" aria-label="Other days">${days.previous ? nav(days.previous, '&larr; Earlier', 'prev') : '<span></span>'}${days.next ? nav(days.next, 'Later &rarr;', 'next') : '<span></span>'}</nav>`
      : ''
  const noteHtml = note ? `<p class="note">${escapeHtml(note)}</p>` : ''

  let body: string
  if (post) {
    const image = `${basePath}/instagram.jpg?date=${post.date}`
    body = `${noteHtml}
    <img class="card" src="${escapeHtml(image)}" width="1080" height="1080" alt="The Instagram card for ${escapeHtml(longDate(post.date))}">
    <div class="actions">
      <a class="button" href="${escapeHtml(image)}" download="feel-good-ai-${post.date}.jpg">Download image</a>
      <button class="button quiet" id="copy" type="button">Copy caption</button>
    </div>
    <label for="caption">Caption</label>
    <textarea id="caption" readonly>${escapeHtml(post.caption)}</textarea>${daysNav}
    <script>${copyScript}</script>`
  } else {
    body = `${noteHtml || '<p class="note">No Instagram post has been made yet.</p>'}${daysNav}`
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Instagram post - Feel good AI</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet">
<style>${styles}</style>
</head>
<body>
  <main class="sheet">
    <header class="masthead"><h1>Feel good AI</h1><span>${post ? escapeHtml(longDate(post.date)) : 'Instagram post'}</span></header>
    ${body}
  </main>
</body>
</html>`
}

/** The page for the day's card: the image, a download button, and the caption to copy. Shows the latest card when today's isn't made yet. */
export async function instagramPage(request: Request, env: Env, now = new Date()): Promise<Response> {
  const basePath = basePathOf(env)
  const html = (page: string, status = 200) =>
    new Response(page, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...NOT_LISTED } })
  const asked = new URL(request.url).searchParams.get('date')

  if (asked !== null) {
    if (!validDate(asked)) return html(renderInstagramPage({ basePath, post: null, note: 'That is not a date.' }), 404)
    const post = await findInstagramPost(env.DB, asked)
    const days = await instagramNeighbours(env.DB, asked)
    return post ? html(renderInstagramPage({ basePath, post, days })) : html(renderInstagramPage({ basePath, post: null, note: `No Instagram post was made for ${longDate(asked)}.`, days }), 404)
  }

  const today = londonDay(now)
  const todays = await findInstagramPost(env.DB, today)
  const post = todays ?? (await findLatestInstagramPost(env.DB))
  if (!post) return html(renderInstagramPage({ basePath, post: null }), 404)
  const note = todays ? undefined : `Today's card isn't ready yet. This is the latest one, from ${longDate(post.date)}.`
  return html(renderInstagramPage({ basePath, post, ...(note ? { note } : {}), days: await instagramNeighbours(env.DB, post.date) }))
}

/** The card itself, as a JPEG: today's, or the one for ?date=YYYY-MM-DD. */
export async function instagramImage(request: Request, env: Env, now = new Date()): Promise<Response> {
  const asked = new URL(request.url).searchParams.get('date')
  if (asked !== null && !validDate(asked)) return new Response('Not found', { status: 404, headers: NOT_LISTED })
  const post = asked !== null ? await findInstagramPost(env.DB, asked) : await findInstagramPost(env.DB, londonDay(now))
  if (!post) return new Response('Not found', { status: 404, headers: NOT_LISTED })
  return new Response(post.image, {
    headers: { 'Content-Type': 'image/jpeg', 'Content-Disposition': `inline; filename="feel-good-ai-${post.date}.jpg"`, 'Cache-Control': 'public, max-age=300', ...NOT_LISTED },
  })
}

/** Makes the card for a day that has an issue, or makes it again. For a card the daily run missed, and for trying a design change. */
export async function instagramMake(request: Request, env: Env, render: RenderCard, now = new Date()): Promise<Response> {
  const asked = new URL(request.url).searchParams.get('date') ?? londonDay(now)
  if (!validDate(asked)) return Response.json({ ok: false, error: 'bad_date' }, { status: 400 })
  const issue = await findIssue(env.DB, asked)
  if (!issue) return Response.json({ ok: false, error: 'no_issue', date: asked }, { status: 404 })
  try {
    const post = await makeInstagramPost(env, issue, render, now)
    return Response.json({ ok: true, date: post.date, bytes: post.image.length, caption: post.caption })
  } catch (error) {
    console.error(`instagram card failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    return Response.json({ ok: false, error: 'render_failed' }, { status: 500 })
  }
}
