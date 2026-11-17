import { describe, expect, it, vi } from 'vitest'
import { isRunTime, scheduledDaily } from './schedule'
import { fakeEnv } from './test-env'

const CRON_HOURS_UTC = [5, 6]

const at = (day: string, hourUtc: number) => Date.parse(`${day}T0${hourUtc}:00:00Z`)

describe('isRunTime', () => {
  it.each([
    ['a winter day', '2026-11-17', 6],
    ['a summer day', '2026-07-01', 5],
    ['the day the clocks go forward', '2026-03-29', 5],
    ['the day the clocks go back', '2026-10-25', 6],
  ])('picks exactly one of the two crons on %s', (_, day, expectedHour) => {
    expect(CRON_HOURS_UTC.filter((hour) => isRunTime(at(day, hour)))).toEqual([expectedHour])
  })
})

const fakeLog = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() })

describe('scheduledDaily', () => {
  it('starts one run named after the London date at 06:00 London, and skips the other cron', async () => {
    const env = fakeEnv()

    await scheduledDaily(at('2026-07-01', 5), env, fakeLog())
    await scheduledDaily(at('2026-07-01', 6), env, fakeLog())

    expect([...env.DAILY.instances.values()].map((i) => [i.id, i.params])).toEqual([['2026-07-01', { date: '2026-07-01' }]])
  })

  it('leaves a date that already has a run alone, whatever state it is in', async () => {
    const env = fakeEnv()
    const log = fakeLog()
    await scheduledDaily(at('2026-11-17', 6), env, log)
    env.DAILY.instances.get('2026-11-17')!.status = { status: 'errored', error: { name: 'Error', message: 'boom' } }

    await scheduledDaily(at('2026-11-17', 6), env, log)

    expect(env.DAILY.instances.size).toBe(1)
    expect(env.DAILY.instances.get('2026-11-17')!.restarts).toEqual([])
    expect(log.warn).toHaveBeenCalledWith({ message: 'daily run already exists, not starting another', id: '2026-11-17', status: 'errored' })
  })

  it('logs and rethrows when the run cannot be started, so the cron shows as failed', async () => {
    const env = fakeEnv()
    env.DAILY.create = async () => Promise.reject(new Error('Workflows is down'))
    const log = fakeLog()

    await expect(scheduledDaily(at('2026-11-17', 6), env, log)).rejects.toThrow('Workflows is down')
    expect(log.error).toHaveBeenCalledWith('could not start the daily run for 2026-11-17: Workflows is down')
  })
})
