import { bankHealth, dailyPick, refillBank } from './bank'
import { runPull } from './pull'
import { confirmForm, confirmNow, routePath, signup, signupPreflight, unsubscribeForm, unsubscribeNow } from './routes'
import { scheduledPull } from './schedule'
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

async function bank(request: Request, env: Env): Promise<Response> {
  if (!(await authorised(request, env))) return new Response('Unauthorised', { status: 401 })
  return Response.json(await bankHealth(env.DB))
}

export default {
  async fetch(request, env, ctx) {
    const pathname = routePath(new URL(request.url).pathname, env.PUBLIC_BASE_URL)
    switch (`${request.method} ${pathname}`) {
      case 'POST /pull':
        return pull(request, env)
      case 'POST /pick':
        return pick(request, env)
      case 'GET /bank':
        return bank(request, env)
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
  },
} satisfies ExportedHandler<Env>
