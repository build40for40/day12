import { runPull } from './pull'
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

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (request.method !== 'POST' || pathname !== '/pull') return new Response('Not found', { status: 404 })
    if (!(await authorised(request, env))) return new Response('Unauthorised', { status: 401 })
    return Response.json(await runPull(env, new Date()))
  },
} satisfies ExportedHandler<Env>
