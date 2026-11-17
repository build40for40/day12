import { londonDay } from './bank'
import { MAX_LEADS } from './daily'
import type { DailyParams, Env } from './types'

const MAX_BODY_CHARS = 4096
const INSTANCE_ID = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/

export interface StartedRun {
  id: string
  started: boolean
  status: InstanceStatus['status']
}

/** Starts the real run for a date, with the date as the Workflow instance id, so a date can only ever have one. */
export async function startDay(workflow: Workflow<DailyParams>, params: DailyParams): Promise<StartedRun> {
  try {
    const instance = await workflow.create({ id: params.date, params })
    return { id: instance.id, started: true, status: 'queued' }
  } catch (error) {
    const existing = await workflow.get(params.date).catch(() => null)
    if (!existing) throw error
    return { id: params.date, started: false, status: (await existing.status()).status }
  }
}

function readBody(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return {}
  if (raw.length > MAX_BODY_CHARS) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// A restart keeps the steps before the pick, so the leads already scored aren't paid for again.
async function restartDay(workflow: Workflow<DailyParams>, date: string): Promise<Response> {
  const instance = await workflow.get(date).catch(() => null)
  if (!instance) return Response.json({ ok: false, error: 'not_started', id: date }, { status: 404 })
  const { status } = await instance.status()
  if (status !== 'errored' && status !== 'terminated') return Response.json({ ok: false, error: 'not_failed', id: date, status }, { status: 409 })
  await instance.restart({ from: { name: 'pick' } }).catch(() => instance.restart())
  return Response.json({ ok: true, id: date, status: 'restarted' }, { status: 202 })
}

/**
 * POST /daily runs today's sequence by hand. Body, all optional: `dry_run` previews it with nothing written or sent,
 * `story` runs a banked story by slug instead of the pick, `leads` scores at most that many new leads,
 * `restart` reruns a failed day from the pick.
 */
export async function dailyRoute(request: Request, env: Env, now = new Date()): Promise<Response> {
  const body = readBody(await request.text())
  if (!body) return Response.json({ ok: false, error: 'bad_json' }, { status: 400 })
  const date = londonDay(now)
  const dryRun = body.dry_run === true
  const story = typeof body.story === 'string' && body.story.trim() ? body.story.trim() : undefined
  const leads = body.leads
  if (leads !== undefined && (!Number.isInteger(leads) || (leads as number) < 0 || (leads as number) > MAX_LEADS)) {
    return Response.json({ ok: false, error: 'bad_leads' }, { status: 400 })
  }

  if (body.restart === true) return dryRun ? Response.json({ ok: false, error: 'restart_is_not_a_dry_run' }, { status: 400 }) : restartDay(env.DAILY, date)

  const params: DailyParams = { date, ...(dryRun ? { dryRun } : {}), ...(story ? { story } : {}), ...(leads !== undefined ? { leads: leads as number } : {}) }
  if (dryRun) {
    const instance = await env.DAILY.create({ id: `dry-${date}-${crypto.randomUUID().slice(0, 8)}`, params })
    return Response.json({ ok: true, id: instance.id, status: 'queued' }, { status: 202 })
  }
  const run = await startDay(env.DAILY, params)
  if (!run.started) return Response.json({ ok: false, error: 'already_started', id: run.id, status: run.status }, { status: 409 })
  return Response.json({ ok: true, id: run.id, status: run.status }, { status: 202 })
}

/** GET /daily?id=... reports a run's status, its error if it failed and its summary once it finished. Today's real run by default. */
export async function dailyStatusRoute(request: Request, env: Env, now = new Date()): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id') ?? londonDay(now)
  if (!INSTANCE_ID.test(id)) return Response.json({ ok: false, error: 'bad_id' }, { status: 400 })
  const instance = await env.DAILY.get(id).catch(() => null)
  if (!instance) return Response.json({ ok: false, error: 'not_found', id }, { status: 404 })
  const { status, error, output } = await instance.status()
  return Response.json({ ok: true, id, status, ...(error ? { error } : {}), ...(output !== undefined ? { output } : {}) })
}
