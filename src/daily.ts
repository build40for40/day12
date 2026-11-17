import type { WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import evergreen from '../data/evergreen.json'
import { permanentFailure } from './anthropic'
import { dailyPick, londonDay, refillBank } from './bank'
import { EditorError, makeWritePost, type EditorRecord, type WritePost } from './editor'
import type { NewsletterReport } from './emails'
import { findIssue, publish } from './publish'
import { runPull } from './pull'
import { makeScoreLead, ScoringError, type RawVerdict, type ScoreLead } from './scorer'
import { findUnscored, listUnscored, saveVerdicts } from './scores'
import type { Stage } from './templates'
import type { DailyParams, Env, FetchLike, PullReport, StoryRecord } from './types'

export const MAX_LEADS = 12
const SCORING_AT_ONCE = 3
const MAX_PLACE = 80
const STAGES: Stage[] = ['in_the_lab', 'in_a_trial', 'helping_people_now']

const QUICK: WorkflowStepConfig = { retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' }, timeout: '2 minutes' }
const PULL: WorkflowStepConfig = { retries: { limit: 1, delay: '1 minute' }, timeout: '5 minutes' }
// Each attempt pays for a fresh round of web research, so a lead gets one more try and then waits for tomorrow.
const SCORE: WorkflowStepConfig = { retries: { limit: 1, delay: '1 minute' }, timeout: '15 minutes' }
const WRITE: WorkflowStepConfig = { retries: { limit: 2, delay: '1 minute', backoff: 'exponential' }, timeout: '15 minutes' }
// A send that failed part way, or timed out after Postmark took it, could reach people twice, so a person decides.
const PUBLISH: WorkflowStepConfig = { retries: { limit: 0, delay: 0 }, timeout: '5 minutes' }

const DRAFT_LINES = new Map(evergreen.stories.flatMap((story): [string, string][] => ('line' in story && story.line ? [[story.id, story.line]] : [])))

type Log = Pick<Console, 'log' | 'warn' | 'error'>

export interface DailyDeps {
  pull?: (env: Env, now: Date) => Promise<PullReport>
  scoreLead?: ScoreLead
  writePost?: WritePost
  fetchImpl?: FetchLike
  log?: Log
}

export interface LeadResult {
  id: number
  outcome: 'saved' | 'previewed' | 'rejected' | 'deferred' | 'gone'
  gate?: string
  total?: number
  reason?: string
}

export interface DailySummary {
  date: string
  dryRun: boolean
  status: 'already_sent' | 'published' | 'preview'
  storyId?: string
  pull?: { stored: number; failedSources: string[] } | 'failed' | 'skipped'
  leads?: LeadResult[]
  pick?: { status: string; storyKey: string; title: string; reason: string }
  post?: { text: string; url: string; place: string | null; decision: string; changes: string }
  report?: NewsletterReport
  preview?: { subject: string; text: string }
  refilled?: number
}

const reason = (error: unknown) => (error instanceof Error ? error.message.split('\n')[0]! : String(error))

// The pick dates itself by the London day of the time it's given. A run restarted on a later day still picks for its own date.
const momentOn = (date: string) => (londonDay(new Date()) === date ? new Date() : new Date(`${date}T12:00:00Z`))

function editorRecord(record: StoryRecord, url: string): EditorRecord {
  const draft = DRAFT_LINES.get(record.id)
  return {
    headline: record.headline,
    what_happened: record.whatHappened,
    why_its_good: record.whyItsGood,
    careful: record.careful,
    stage: record.stage,
    topic: record.topic,
    lane: record.lane,
    source_url: url,
    ...(record.lane === 'flip' ? { bad_news: record.badNews ?? null, flip_kind: record.flipKind ?? null } : {}),
    ...(draft ? { draft_line: draft } : {}),
  }
}

async function scoreLeads(env: Env, apiKey: string, params: DailyParams, step: WorkflowStep, deps: DailyDeps, log: Log): Promise<LeadResult[]> {
  const limit = Math.min(params.leads ?? MAX_LEADS, MAX_LEADS)
  if (limit < 1) return []
  let ids: number[]
  try {
    ids = await step.do('find new leads', QUICK, async () => (await listUnscored(env.DB, new Date(), limit)).map((lead) => lead.id))
  } catch (error) {
    log.error(`daily ${params.date}: could not list new leads, so none were scored: ${reason(error)}`)
    return []
  }

  const score = deps.scoreLead ?? makeScoreLead()
  // Logged where it happens, because the code between steps runs again whenever the Workflow resumes.
  const deferred = (id: number, why: string, outcome: LeadResult['outcome'] = 'deferred'): LeadResult => {
    log.warn(`daily ${params.date}: lead ${id} ${outcome}, it stays unscored: ${why}`)
    return { id, outcome, reason: why }
  }
  const scoreOne = async (id: number): Promise<LeadResult> => {
    try {
      return await step.do(`score lead ${id}`, SCORE, async (): Promise<LeadResult> => {
        const lead = await findUnscored(env.DB, id)
        if (!lead) return { id, outcome: 'gone' }
        let verdict: RawVerdict
        try {
          verdict = await score(lead, apiKey, params.date)
        } catch (error) {
          if (error instanceof ScoringError || permanentFailure(error)) return deferred(id, reason(error))
          throw error
        }
        const result = { id, gate: verdict.gate, ...(typeof verdict.total === 'number' ? { total: verdict.total } : {}) }
        if (params.dryRun) return { ...result, outcome: 'previewed' }
        const { saved } = await saveVerdicts(env.DB, { verdicts: [verdict] }, new Date())
        return saved ? { ...result, outcome: 'saved' } : { ...deferred(id, 'the Worker refused the verdict', 'rejected'), ...result }
      })
    } catch (error) {
      return deferred(id, reason(error))
    }
  }

  const results: LeadResult[] = []
  for (let start = 0; start < ids.length; start += SCORING_AT_ONCE) {
    results.push(...(await Promise.all(ids.slice(start, start + SCORING_AT_ONCE).map(scoreOne))))
  }
  return results
}

/**
 * The day's run, in order: pull the sources, score the new leads, pick the story, write the post, email it.
 * Each step is a Workflow step, so a crash resumes after the last finished step. A failed pull or a lead that
 * can't be scored doesn't stop the day, because the bank can still supply a story. Anything from the pick on
 * that fails stops the run, which then shows as errored in Cloudflare. A dry run writes nothing to the
 * database and sends nothing: it skips the pull, previews the verdicts, the pick and the email.
 */
export async function runDaily(env: Env, params: DailyParams, step: WorkflowStep, deps: DailyDeps = {}): Promise<DailySummary> {
  const log = deps.log ?? console
  const at = { stage: 'check today is not sent' }
  try {
    const summary = await sequence(env, params, step, deps, log, at)
    const { preview: _, post: __, ...rest } = summary
    log.log({ message: 'daily run finished', ...rest })
    return summary
  } catch (error) {
    log.error(`daily ${params.date}${params.dryRun ? ' (dry run)' : ''} stopped at ${at.stage}: ${reason(error)}`)
    throw error
  }
}

async function sequence(env: Env, params: DailyParams, step: WorkflowStep, deps: DailyDeps, log: Log, at: { stage: string }): Promise<DailySummary> {
  const { date } = params
  const dryRun = params.dryRun === true

  if (!dryRun) {
    const sent = await step.do('check today is not sent', QUICK, async () => (await findIssue(env.DB, date))?.storyId ?? null)
    if (sent) return { date, dryRun, status: 'already_sent', storyId: sent }
  }

  let pull: DailySummary['pull'] = 'skipped'
  if (!dryRun) {
    try {
      pull = await step.do('pull', PULL, async () => {
        const report = await (deps.pull ?? runPull)(env, new Date())
        return { stored: report.stored, failedSources: report.sources.filter((s) => s.error !== undefined).map((s) => s.sourceId) }
      })
    } catch (error) {
      log.error(`daily ${date}: the pull failed, going on with the leads already stored: ${reason(error)}`)
      pull = 'failed'
    }
  }

  // Checked before the pick, so a run that can't finish doesn't use up a story.
  at.stage = 'the secrets check'
  const apiKey = env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set, so nothing can score or write the post. Set the Worker secret, then restart the run.')
  if (!dryRun && !env.POSTMARK_SERVER_TOKEN) throw new Error('POSTMARK_SERVER_TOKEN is not set, so the email cannot go out.')

  const leads = params.story ? [] : await scoreLeads(env, apiKey, params, step, deps, log)

  at.stage = 'pick'
  const picked = await step.do('pick', QUICK, async () => {
    const result = await dailyPick(env.DB, momentOn(date), { dryRun, ...(params.story ? { story: params.story } : {}) })
    if (result.status === 'nothing_to_run') {
      throw new NonRetryableError(params.story ? `No banked story called ${params.story}.` : 'Nothing to run: no news story scores 16 or more and the bank is empty.')
    }
    const { pick, record } = result
    if (!record) throw new NonRetryableError(`The pick for ${date} (${pick.storyKey}) has no story record any more.`)
    if (params.story && pick.storyKey !== `evergreen:${params.story}`) throw new NonRetryableError(`${date} is already picked: ${pick.title}.`)
    if (!record.sourceUrl) throw new NonRetryableError(`${record.id} has no link a reader can use. Re-source it first.`)
    return { status: result.status, storyKey: pick.storyKey, title: pick.title, reason: pick.reason, record, url: record.sourceUrl }
  })
  const { record, url, ...pick } = picked

  at.stage = 'write'
  const write = deps.writePost ?? makeWritePost()
  const written = await step.do('write', WRITE, async () => {
    try {
      const { text, output } = await write(apiKey, editorRecord(record, url))
      const place = output.place?.trim() ? [...output.place.trim()].slice(0, MAX_PLACE).join('') : null
      return { text, url, place, decision: output.decision, changes: output.changes }
    } catch (error) {
      if (error instanceof EditorError) throw new NonRetryableError(error.message)
      throw error
    }
  })

  at.stage = 'publish'
  const stage = STAGES.find((known) => known === record.stage)
  const sent = await step.do('publish', PUBLISH, async () => {
    const story = { id: record.id, headline: record.headline, text: written.text, url, ...(stage ? { stage } : {}), ...(written.place ? { place: written.place } : {}) }
    const result = await publish(env, { date, story, dryRun, force: false }, deps.fetchImpl)
    switch (result.status) {
      case 'preview':
        return { status: 'preview' as const, preview: { subject: result.subject, text: result.text } }
      case 'already_published':
        return { status: 'already_sent' as const, storyId: result.issue.storyId }
      case 'published':
        return { status: 'published' as const, storyId: result.issue.storyId, report: result.report }
      case 'failed':
        throw new NonRetryableError(`The email didn't go out: ${result.report.failed} failed, none sent. The date is free again, so restart the run.`)
    }
  })

  let refilled = 0
  if (sent.status === 'published') {
    try {
      refilled = await step.do('refill the bank', QUICK, () => refillBank(env.DB, new Date()))
    } catch (error) {
      log.error(`daily ${date}: the email went out but the bank refill failed: ${reason(error)}`)
    }
  }

  return { date, dryRun, pull, leads, pick, post: written, refilled, ...sent }
}
