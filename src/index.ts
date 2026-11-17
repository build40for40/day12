import { LANDING_PATH, type LandingState, renderLanding, SUBSCRIBE_PATH } from './landing'
import { runPull } from './pull'
import { normaliseEmail, subscribe } from './subscribers'
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

function landingState(url: URL): LandingState {
  if (url.searchParams.has('joined')) return 'joined'
  if (url.searchParams.get('error') === 'email') return 'invalid_email'
  return 'form'
}

function landing(url: URL): Response {
  return new Response(renderLanding(landingState(url)), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

function backToLanding(url: URL, query: string): Response {
  return new Response(null, { status: 303, headers: { Location: new URL(`${LANDING_PATH}?${query}`, url).toString() } })
}

async function signUp(request: Request, env: Env, url: URL): Promise<Response> {
  const fields = await request.formData()
  if (fields.get('website')) return backToLanding(url, 'joined=1')
  const given = fields.get('email')
  const email = typeof given === 'string' ? normaliseEmail(given) : null
  if (!email) return backToLanding(url, 'error=email')
  await subscribe(env.DB, email, new Date())
  return backToLanding(url, 'joined=1')
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const pathname = url.pathname.replace(/\/$/, '')
    if (request.method === 'GET' && pathname === LANDING_PATH) return landing(url)
    if (request.method === 'POST' && pathname === SUBSCRIBE_PATH) return signUp(request, env, url)
    if (request.method !== 'POST' || pathname !== '/pull') return new Response('Not found', { status: 404 })
    if (!(await authorised(request, env))) return new Response('Unauthorised', { status: 401 })
    return Response.json(await runPull(env, new Date()))
  },
} satisfies ExportedHandler<Env>
