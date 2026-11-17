import { bankHealth, dailyPick, londonDay, refillBank, standInFor } from './bank'
import { dailyRoute } from './daily'
import { renderLanding, type LandingView } from './landing'
import { findIssue, findNeighbours, issuesRoute, latestIssueRoute, publishRoute } from './publish'
import { runPull } from './pull'
import { listUnscored, saveVerdicts } from './scores'
import { confirmForm, confirmNow, routePath, signup, signupPreflight, unsubscribeForm, unsubscribeNow } from './routes'
import { scheduledDaily, scheduledPull } from './schedule'
import type { Env } from './types'

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

async function tokensMatch(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(given), digest(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

async function authorised(request: Request, env: Env): Promise<boolean> {
  if (!env.PULL_TOKEN) return false
  const header = request.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  return tokensMatch(token, env.PULL_TOKEN)
}

async function pull(request: Request, env: Env): Promise<Response> {
  if (!(await authorised(request, env))) return new Response('Unauthorised', { status: 401 })
  return Response.json(await runPull(env, new Date()))
}

async function pick(request: Request, env: Env): Promise<Response> {
  if (!(await authorised(request, env))) return new Response('Unauthorised', { status: 401 })
  const dryRun = new URL(request.url).searchParams.get('dry') === '1'
  const now = new Date()
  const story = new URL(request.url).searchParams.get('story') ?? undefined
  const result = await dailyPick(env.DB, now, { dryRun, ...(story ? { story } : {}) })
  const refilled = dryRun ? 0 : await refillBank(env.DB, now)
  return Response.json({ ...result, refilled, bank: await bankHealth(env.DB) })
}

// Runs the day's story by hand, or previews it. Same token as /pull.
async function daily(request: Request, env: Env): Promise<Response> {
  if (!(await authorised(request, env))) return new Response('Unauthorised', { status: 401 })
  return dailyRoute(request, env)
}

// scripts/score.ts reads the stories it hasn't scored yet and writes its verdicts back. Same token as /pull.
async function unscored(request: Request, env: Env): Promise<Response> {
  if (!(await authorised(request, env))) return new Response('Unauthorised', { status: 401 })
  const limit = Number(new URL(request.url).searchParams.get('limit') ?? '300')
  return Response.json({ candidates: await listUnscored(env.DB, new Date(), Number.isFinite(limit) ? limit : 300) })
}

async function scores(request: Request, env: Env): Promise<Response> {
  if (!(await authorised(request, env))) return new Response('Unauthorised', { status: 401 })
  const body: unknown = await request.json().catch(() => null)
  if (body === null) return Response.json({ ok: false, error: 'bad_json' }, { status: 400 })
  return Response.json({ ok: true, ...(await saveVerdicts(env.DB, body, new Date())) })
}

async function bank(request: Request, env: Env): Promise<Response> {
  if (!(await authorised(request, env))) return new Response('Unauthorised', { status: 401 })
  return Response.json(await bankHealth(env.DB))
}

// The daily run posts the day's story here. It uses the same token as /pull.
async function publishIssue(request: Request, env: Env): Promise<Response> {
  if (!(await authorised(request, env))) return new Response('Unauthorised', { status: 401 })
  return publishRoute(request, env)
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// The page shows today's story, or the one for ?date=YYYY-MM-DD, with links to the days either side.
// Until today's issue goes out, a bank story stands in, so the page changes every day regardless.
async function landing(request: Request, env: Env): Promise<Response> {
  const base = URL.canParse(env.PUBLIC_BASE_URL) ? new URL(env.PUBLIC_BASE_URL).pathname.replace(/\/+$/, '') : ''
  const signups = `${base}/signups`
  const page = (html: string, status = 200) =>
    new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } })
  // The trailing slash matters: the route for the bare base path doesn't match once a query string is added.
  const daysAround = async (date: string): Promise<LandingView['days']> => ({ basePath: `${base}/`, ...(await findNeighbours(env.DB, date)) })
  const todayView = async (): Promise<LandingView> => {
    const today = londonDay(new Date())
    const issue = await findIssue(env.DB, today)
    return { issue, today, standIn: issue ? null : await standInFor(env.DB, today), days: await daysAround(today) }
  }

  const asked = new URL(request.url).searchParams.get('date')
  if (asked === null) return page(renderLanding(signups, await todayView()))
  if (!ISO_DATE.test(asked) || Number.isNaN(Date.parse(asked))) return page(renderLanding(signups, await todayView()), 404)
  const issue = await findIssue(env.DB, asked)
  const days = await daysAround(asked)
  return issue ? page(renderLanding(signups, { issue, days })) : page(renderLanding(signups, { missingDate: asked, days }), 404)
}

export default {
  async fetch(request, env, ctx) {
    const pathname = routePath(new URL(request.url).pathname, env.PUBLIC_BASE_URL)
    switch (`${request.method} ${pathname}`) {
      case 'GET /':
        return landing(request, env)
      case 'POST /pull':
        return pull(request, env)
      case 'POST /publish':
        return publishIssue(request, env)
      case 'GET /issues':
        return issuesRoute(request, env)
      case 'GET /issues/latest':
        return latestIssueRoute(request, env)
      case 'POST /daily':
        return daily(request, env)
      case 'POST /pick':
        return pick(request, env)
      case 'GET /bank':
        return bank(request, env)
      case 'GET /candidates/unscored':
        return unscored(request, env)
      case 'POST /candidates/scores':
        return scores(request, env)
      case 'OPTIONS /signups':
        return signupPreflight(request, env)
      case 'POST /signups':
        return signup(request, env, (work) => ctx.waitUntil(work))
      case 'GET /confirm':
        return confirmForm(request)
      case 'POST /confirm':
        return confirmNow(request, env)
      case 'GET /unsubscribe':
        return unsubscribeForm(request)
      case 'POST /unsubscribe':
        return unsubscribeNow(request, env)
      default:
        return new Response('Not found', { status: 404 })
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(scheduledPull(controller.scheduledTime, env))
    ctx.waitUntil(scheduledDaily(controller.scheduledTime, env))
  },
} satisfies ExportedHandler<Env>
