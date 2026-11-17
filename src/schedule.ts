import { londonDay } from './bank'
import { startDay } from './runs'
import type { Env } from './types'

const RUN_HOUR_LONDON = 6

const londonHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hourCycle: 'h23' })

export function isRunTime(scheduledTime: number): boolean {
  return Number(londonHour.format(scheduledTime)) === RUN_HOUR_LONDON
}

type Log = Pick<Console, 'log' | 'warn' | 'error'>

/** The 06:00 London cron starts the day's Workflow run. A date that already has a run is left alone. */
export async function scheduledDaily(scheduledTime: number, env: Env, log: Log = console): Promise<void> {
  if (!isRunTime(scheduledTime)) {
    log.log(`skipped the daily run, not ${RUN_HOUR_LONDON}am in London`)
    return
  }
  const date = londonDay(new Date(scheduledTime))
  try {
    const run = await startDay(env.DAILY, { date })
    if (run.started) log.log({ message: 'daily run started', id: run.id })
    else log.warn({ message: 'daily run already exists, not starting another', id: run.id, status: run.status })
  } catch (thrown) {
    log.error(`could not start the daily run for ${date}: ${thrown instanceof Error ? thrown.message : String(thrown)}`)
    throw thrown
  }
}
