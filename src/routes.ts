import { sendConfirmation } from './emails'
import { readText } from './fetchers/http'
import { brokenLinkPage, confirmedPage, confirmPage, unsubscribedPage, unsubscribePage } from './pages'
import { addSignup, confirmSignup, isToken, normaliseEmail, releaseConfirmation, unsubscribe } from './signups'
import type { Env, FetchLike } from './types'

const DEFAULT_ALLOWED_ORIGIN = 'https://build40for40.com'
const MAX_SIGNUP_BYTES = 4096

type Defer = (work: Promise<unknown>) => void

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN
  const headers: Record<string, string> = { Vary: 'Origin' }
  if (request.headers.get('Origin') === allowed) headers['Access-Control-Allow-Origin'] = allowed
  return headers
}

async function readEmail(request: Request): Promise<string | null> {
  const text = await readText(new Response(request.body, { headers: request.headers }), MAX_SIGNUP_BYTES)
  const type = request.headers.get('Content-Type') ?? ''
  if (type.includes('application/json')) {
    const body: unknown = JSON.parse(text)
    const email = (body as { email?: unknown } | null)?.email
    return typeof email === 'string' ? email : null
  }
  return new URLSearchParams(text).get('email')
}

async function confirmByEmail(env: Env, email: string, confirmToken: string, fetchImpl?: FetchLike): Promise<void> {
  const result = await sendConfirmation(env, email, confirmToken, fetchImpl).catch(() => ({ ok: false, errorCode: null }))
  if (result.ok) return
  console.error(`confirmation email failed, Postmark error code ${result.errorCode}`)
  await releaseConfirmation(env.DB, confirmToken)
}

export function signupPreflight(request: Request, env: Env): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(request, env),
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  })
}

export async function signup(request: Request, env: Env, defer: Defer, fetchImpl?: FetchLike, now = new Date()): Promise<Response> {
  const headers = corsHeaders(request, env)
  if (!env.POSTMARK_SERVER_TOKEN) return Response.json({ ok: false, error: 'not_configured' }, { status: 503, headers })

  const email = normaliseEmail((await readEmail(request).catch(() => null)) ?? '')
  if (!email) return Response.json({ ok: false, error: 'invalid_email' }, { status: 400, headers })

  const added = await addSignup(env.DB, email, now)
  if (added) defer(confirmByEmail(env, email, added.confirmToken, fetchImpl))
  return Response.json({ ok: true }, { headers })
}

export function routePath(pathname: string, publicBaseUrl: string): string {
  const base = URL.canParse(publicBaseUrl) ? new URL(publicBaseUrl).pathname.replace(/\/+$/, '') : ''
  if (base && (pathname === base || pathname.startsWith(`${base}/`))) return pathname.slice(base.length) || '/'
  return pathname
}

export function confirmForm(request: Request): Response {
  const token = new URL(request.url).searchParams.get('token')
  return isToken(token) ? confirmPage() : brokenLinkPage()
}

export async function confirmNow(request: Request, env: Env, now = new Date()): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? ''
  return (await confirmSignup(env.DB, token, now)) ? confirmedPage() : brokenLinkPage()
}

export function unsubscribeForm(request: Request): Response {
  const token = new URL(request.url).searchParams.get('token')
  return isToken(token) ? unsubscribePage() : brokenLinkPage()
}

export async function unsubscribeNow(request: Request, env: Env, now = new Date()): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? ''
  return (await unsubscribe(env.DB, token, now)) ? unsubscribedPage() : brokenLinkPage()
}
