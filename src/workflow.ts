import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { runDaily, type DailySummary } from './daily'
import type { DailyParams, Env } from './types'

export class DailyWorkflow extends WorkflowEntrypoint<Env, DailyParams> {
  async run(event: WorkflowEvent<DailyParams>, step: WorkflowStep): Promise<DailySummary> {
    return runDaily(this.env, event.payload, step)
  }
}
