import { londonDate, runDaily, type DailyOptions, type DailyResult } from './daily'
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

type Daily = (env: Env, options: DailyOptions) => Promise<DailyResult>

// The daily story: picked, written and emailed at 06:00 London, from the same two crons as the pull.
// It doesn't wait for the pull, because nothing scores the pulled stories into the backlog yet.
export async function scheduledDaily(scheduledTime: number, env: Env, daily: Daily = runDaily, log: Log = console): Promise<void> {
  if (!isPullTime(scheduledTime)) {
    log.log(`skipped daily story, not ${PULL_HOUR_LONDON}am in London`)
    return
  }
  const date = londonDate(scheduledTime)
  try {
    const result = await daily(env, { date })
    log.log({ message: 'daily story finished', date, status: result.status, storyId: result.storyId, report: result.report ?? null })
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown)
    log.error(`daily story failed for ${date}: ${message}`)
    throw thrown // fails the invocation, so it shows as an error in Cloudflare
  }
}
