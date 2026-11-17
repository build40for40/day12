import { describe, expect, it } from 'vitest'
import { dailyRoute, dailyStatusRoute } from './runs'
import { fakeEnv } from './test-env'

const now = new Date('2026-11-18T09:00:00Z')
const post = (body?: unknown) => new Request('https://brief.example.com/daily', { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

describe('POST /daily', () => {
  it("starts today's run under the date, once", async () => {
    const env = fakeEnv()

    const first = await dailyRoute(post(), env, now)
    const second = await dailyRoute(post(), env, now)

    expect(first.status).toBe(202)
    expect(await first.json()).toMatchObject({ ok: true, id: '2026-11-18' })
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ error: 'already_started', status: 'queued' })
    expect(env.DAILY.instances.get('2026-11-18')!.params).toEqual({ date: '2026-11-18' })
  })

  it('starts a dry run under its own id, so it never blocks the real one', async () => {
    const env = fakeEnv()

    const response = await dailyRoute(post({ dry_run: true, leads: 1 }), env, now)

    const { id } = (await response.json()) as { id: string }
    expect(id).toMatch(/^dry-2026-11-18-[0-9a-f]{8}$/)
    expect(env.DAILY.instances.get(id)!.params).toEqual({ date: '2026-11-18', dryRun: true, leads: 1 })
    expect((await dailyRoute(post(), env, now)).status).toBe(202)
  })

  it('restarts a failed day from the pick, and nothing else', async () => {
    const env = fakeEnv()
    await dailyRoute(post(), env, now)

    expect((await dailyRoute(post({ restart: true }), env, now)).status).toBe(409)
    env.DAILY.instances.get('2026-11-18')!.status = { status: 'errored', error: { name: 'Error', message: 'boom' } }
    const restarted = await dailyRoute(post({ restart: true }), env, now)

    expect(restarted.status).toBe(202)
    expect(env.DAILY.instances.get('2026-11-18')!.restarts).toEqual([{ from: { name: 'pick' } }])
  })

  it('answers 400 for a body it cannot use', async () => {
    const env = fakeEnv()
    for (const body of ['not json', JSON.stringify({ leads: 13 }), JSON.stringify({ leads: 'all' })]) {
      const response = await dailyRoute(new Request('https://brief.example.com/daily', { method: 'POST', body }), env, now)
      expect(response.status).toBe(400)
    }
    expect(env.DAILY.instances.size).toBe(0)
  })
})

describe('GET /daily', () => {
  it("reports today's run with its error, and 404 for a run that doesn't exist", async () => {
    const env = fakeEnv()
    await dailyRoute(post(), env, now)
    env.DAILY.instances.get('2026-11-18')!.status = { status: 'errored', error: { name: 'Error', message: 'boom' } }

    const today = await dailyStatusRoute(new Request('https://brief.example.com/daily'), env, now)
    const missing = await dailyStatusRoute(new Request('https://brief.example.com/daily?id=2026-11-01'), env, now)

    expect(await today.json()).toEqual({ ok: true, id: '2026-11-18', status: 'errored', error: { name: 'Error', message: 'boom' } })
    expect(missing.status).toBe(404)
  })
})
