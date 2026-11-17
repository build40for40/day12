import type { StandIn } from './bank'
import type { Issue } from './publish'
import { sourceName, STAGE_LABELS, type Stage } from './templates'

interface LandingStory {
  date: string
  line: string
  place: string | null
  url: string | null
  stage: Stage | null
}

// Shown only when today has no issue and the bank has nothing ready.
const FALLBACK: Omit<LandingStory, 'date'> = {
  line: 'Dublin is piloting an AI flood warning that, in tests on past storms, flagged some floods 13 hours early.',
  place: 'Dublin, Ireland',
  url: 'https://www.thejournal.ie/dublin-ai-flood-warning-system-7227372-Nov2026/',
  stage: 'in_a_trial',
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

// "2026-11-18" becomes "18 November 2026". The issue date is already the London day.
function longDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${isoDate}T12:00:00Z`))
}

export interface LandingView {
  // The issue to show. Without one, the page shows a stand-in dated today.
  issue?: Issue | null
  // The London day, and the bank story standing in until that day's issue goes out.
  today?: string
  standIn?: StandIn | null
  // A date someone asked for that has no issue.
  missingDate?: string
  // Links to the issues either side, as dates, under the page's base path.
  days?: { basePath: string; previous: string | null; next: string | null }
}

function storyFor(view: LandingView): LandingStory {
  if (view.missingDate) return { date: longDate(view.missingDate), line: `No story went out on ${longDate(view.missingDate)}.`, place: null, url: null, stage: null }
  if (view.issue) return { date: longDate(view.issue.date), line: view.issue.text, place: view.issue.place, url: view.issue.url, stage: view.issue.stage }
  const date = view.today ? longDate(view.today) : ''
  return view.standIn ? { date, line: view.standIn.title, place: null, url: view.standIn.url, stage: view.standIn.stage } : { date, ...FALLBACK }
}

function daysNav(days: LandingView['days']): string {
  if (!days || (!days.previous && !days.next)) return ''
  const link = (date: string, label: string, rel: string) =>
    `<a href="${escapeHtml(`${days.basePath}?date=${date}`)}" rel="${rel}">${label}</a>`
  const previous = days.previous ? link(days.previous, '&larr; Earlier', 'prev') : '<span></span>'
  const next = days.next ? link(days.next, 'Later &rarr;', 'next') : '<span></span>'
  return `\n    <nav class="days" aria-label="Other days">${previous}${next}</nav>`
}

const styles = `
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  padding: 14px;
  background: #D9D6CE;
  color: #1C1B19;
  font-family: 'EB Garamond', Georgia, 'Times New Roman', serif;
}
a { color: inherit; }
a:hover { color: #55524B; }
:focus-visible { outline: 2px solid #1C1B19; outline-offset: 3px; }
.sheet {
  max-width: 560px;
  min-height: calc(100vh - 28px);
  min-height: calc(100svh - 28px);
  margin: 0 auto;
  padding: 30px 28px 26px;
  background: #F6F4EE;
  box-shadow: 0 1px 2px rgba(28, 27, 25, 0.25);
  display: flex;
  flex-direction: column;
}
.masthead {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: 4px 16px;
  font-size: 17px;
}
.masthead h1 { margin: 0; font-size: inherit; font-weight: 400; font-style: italic; }
.story { margin-top: clamp(72px, 16vh, 150px); }
.story p { margin: 0; font-size: clamp(31px, 8.6vw, 40px); line-height: 1.2; letter-spacing: -0.005em; }
.story hr { width: 40px; margin: 26px 0; border: 0; border-top: 1px solid #1C1B19; }
.story .place, .story .source { font-size: 17px; font-style: italic; }
.story .source { margin-top: 4px; }
.days { margin-top: 40px; display: flex; justify-content: space-between; gap: 16px; font-size: 16px; font-style: italic; }
.join { margin-top: clamp(64px, 14vh, 130px); display: flex; flex-direction: column; gap: 28px; }
.join .pitch { margin: 0; font-size: 22px; line-height: 1.35; }
.join form { display: flex; flex-direction: column; gap: 18px; }
.join label { display: block; font-size: 16px; font-style: italic; }
.join input[type='email'] {
  width: 100%;
  height: 48px;
  padding: 0;
  font: inherit;
  font-size: 22px;
  color: inherit;
  background: transparent;
  border: 0;
  border-bottom: 1px solid #1C1B19;
  border-radius: 0;
}
.join input[type='email']::placeholder { color: #6B675F; }
.join input[type='email']:focus-visible { outline: 0; border-bottom-width: 2px; }
.join button {
  height: 54px;
  font: inherit;
  font-size: 20px;
  font-weight: 500;
  color: #F6F4EE;
  background: #1C1B19;
  border: 0;
  border-radius: 0;
  cursor: pointer;
}
.join button:hover { background: #3A3833; }
.join .small { margin: 0; font-size: 16px; line-height: 1.4; }
.join .error { margin: 0; font-size: 17px; font-style: italic; }
.join .joined { margin: 0; font-size: 28px; line-height: 1.25; }
.join .joined:focus { outline: 0; }
.join button:disabled { opacity: 0.6; cursor: progress; }
[hidden] { display: none !important; }
footer { margin-top: auto; padding-top: 48px; font-size: 15px; }
`

const signupScript = `
const form = document.querySelector('.join form')
const error = document.getElementById('email-error')
const email = document.getElementById('email')
const button = form.querySelector('button')
const messages = {
  invalid_email: "That email doesn't look right. Check it and try again.",
  other: "We couldn't sign you up just now. Try again in a minute.",
}
form.addEventListener('submit', async (event) => {
  event.preventDefault()
  error.hidden = true
  email.removeAttribute('aria-invalid')
  button.disabled = true
  let problem = 'other'
  try {
    const response = await fetch(form.action, { method: 'POST', body: new URLSearchParams({ email: email.value }) })
    const result = await response.json()
    if (result.ok) {
      // Close the phone keyboard before the form goes, or the page stays shifted up and the top gets clipped
      email.blur()
      form.hidden = true
      const joined = document.querySelector('.join .joined')
      joined.hidden = false
      joined.focus({ preventScroll: true })
      requestAnimationFrame(() => joined.scrollIntoView({ block: 'nearest' }))
      return
    }
    if (result.error === 'invalid_email') problem = 'invalid_email'
  } catch {}
  button.disabled = false
  error.textContent = messages[problem]
  error.hidden = false
  if (problem === 'invalid_email') email.setAttribute('aria-invalid', 'true')
})
`

function sourceLine(url: string, stage: Stage | null): string {
  const link = `<a href="${escapeHtml(url)}">${escapeHtml(sourceName(url))}</a>`
  return stage ? `${STAGE_LABELS[stage]} · ${link}` : link
}

export function renderLanding(signupsPath: string, view: LandingView = {}): string {
  const story = storyFor(view)
  const details = [
    story.place ? `<div class="place">${escapeHtml(story.place)}</div>` : '',
    story.url ? `<div class="source">${sourceLine(story.url, story.stage)}</div>` : '',
  ].filter(Boolean)
  const place = details.length ? `\n      <hr>\n      ${details.join('\n      ')}` : ''
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feel good AI stories</title>
<meta name="description" content="Daily positive AI news you can read in 10 seconds.">
<meta property="og:title" content="Feel good AI stories">
<meta property="og:description" content="Daily positive AI news you can read in 10 seconds.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap">
<style>${styles}</style>
</head>
<body>
  <main class="sheet">
    <header class="masthead">
      <h1>Feel good AI stories</h1>
      <div>${escapeHtml(story.date)}</div>
    </header>
    <article class="story">
      <p>${escapeHtml(story.line)}</p>${place}
    </article>${daysNav(view.days)}
    <section class="join">
      <p class="pitch">Daily positive AI news you can read in 10 seconds</p>
      <form method="post" action="${signupsPath}">
        <div>
          <label for="email">Your email</label>
          <input id="email" name="email" type="email" required autocomplete="email" placeholder="you@example.com" aria-describedby="email-error">
        </div>
        <p class="error" id="email-error" role="alert" hidden></p>
        <button type="submit">Send me tomorrow's story</button>
        <p class="small">Free. 6am UK time. Leave whenever you like.</p>
      </form>
      <p class="joined" role="status" tabindex="-1" hidden>Check your inbox. One click to confirm and you're in.</p>
    </section>
    <footer>Day 12 of <a href="https://build40for40.com">40 for 40</a></footer>
  </main>
  <script>${signupScript}</script>
</body>
</html>
`
}
