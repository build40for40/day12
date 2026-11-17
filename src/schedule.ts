import { runPull } from './pull'
import type { Env, PullReport } from './types'

const PULL_HOUR_LONDON = 6

const londonHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hourCycle: 'h23' })

export function isPullTime(scheduledTime: number): boolean {
  return Number(londonHour.format(scheduledTime)) === PULL_HOUR_LONDON
}

type Pull = (env: Env, now: Date) => Promise<PullReport>
type Log = Pick<Console, 'log' | 'warn' | 'error'>

export async function scheduledPull(scheduledTime: number, env: Env, pull: Pull = runPull, log: Log = console): Promise<void> {
  if (!isPullTime(scheduledTime)) {
    log.log(`skipped pull, not ${PULL_HOUR_LONDON}am in London`)
    return
  }

  let report: PullReport
  try {
    report = await pull(env, new Date(scheduledTime))
  } catch (thrown) {
    log.error(`scheduled pull failed: ${thrown instanceof Error ? thrown.message : String(thrown)}`)
    throw thrown
  }

  const failed = report.sources.filter((s) => s.error !== undefined).map(({ sourceId, error }) => ({ sourceId, error }))
  const summary = { message: 'scheduled pull finished', stored: report.stored, failed }
  if (failed.length > 0) log.warn(summary)
  else log.log(summary)
}
