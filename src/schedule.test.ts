import { describe, expect, it, vi } from 'vitest'
import { isPullTime, scheduledPull } from './schedule'
import type { Env, PullReport } from './types'

const CRON_HOURS_UTC = [5, 6]

const at = (day: string, hourUtc: number) => Date.parse(`${day}T0${hourUtc}:00:00Z`)

describe('isPullTime', () => {
  it.each([
    ['a winter day', '2026-11-17', 6],
    ['a summer day', '2026-07-01', 5],
    ['the day the clocks go forward', '2026-03-29', 5],
    ['the day the clocks go back', '2026-10-25', 6],
  ])('picks exactly one of the two crons on %s', (_, day, expectedHour) => {
    expect(CRON_HOURS_UTC.filter((hour) => isPullTime(at(day, hour)))).toEqual([expectedHour])
  })
})

const report: PullReport = {
  startedAt: '2026-07-01T05:00:00.000Z',
  sources: [
    { sourceId: 'sciencedaily-ai', fetched: 2, kept: 2, stored: 2 },
    { sourceId: 'physorg-ml-ai', fetched: 0, kept: 0, stored: 0, error: 'connection reset' },
  ],
  stored: 2,
}

const env = { PULL_TOKEN: 'x' } as Env
const fakeLog = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() })

describe('scheduledPull', () => {
  it('runs the pull at 06:00 London and logs the stored count and failed sources', async () => {
    const pull = vi.fn(async () => report)
    const log = fakeLog()

    await scheduledPull(at('2026-07-01', 5), env, pull, log)

    expect(pull).toHaveBeenCalledWith(env, new Date('2026-07-01T05:00:00Z'))
    expect(log.warn).toHaveBeenCalledWith({
      message: 'scheduled pull finished',
      stored: 2,
      failed: [{ sourceId: 'physorg-ml-ai', error: 'connection reset' }],
    })
  })

  it('skips the pull at any other hour in London', async () => {
    const pull = vi.fn(async () => report)

    await scheduledPull(at('2026-07-01', 6), env, pull, fakeLog())

    expect(pull).not.toHaveBeenCalled()
  })

  it('logs and rethrows when the pull fails', async () => {
    const log = fakeLog()

    await expect(scheduledPull(at('2026-11-17', 6), env, async () => Promise.reject(new Error('D1 is down')), log)).rejects.toThrow('D1 is down')
    expect(log.error).toHaveBeenCalledWith('scheduled pull failed: D1 is down')
  })
})
