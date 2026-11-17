import { describe, expect, it } from 'vitest'
import { SCORE_STORY_PROMPT } from './prompts'
import { makeScoreLead, SCORER_MODEL, ScoringError } from './scorer'
import type { UnscoredCandidate } from './scores'

const lead: UnscoredCandidate = {
  id: 7, title: 'A fake lead', summary: 'Fake.', url: 'https://example.com/lead', publisher: null, publishedAt: null,
  sourceId: 'fake', tier: 'lead', pulledAt: '2026-11-18T06:00:00Z',
}

const verdict = {
  gate: 'pass', reason: 'Checked.', lane: 'good', published: '2026-11-17', company_claim: false, primary_url: 'https://example.org/paper',
  topic: 'health', stage: 'in_a_trial', scores: { mass_appeal: 3, real_person_or_place: 2, stage: 2, surprise: 1 },
  story: { headline: 'H', what_happened: 'W', why_its_good: 'G', careful: [], sources: [] },
}

const fetchedBlock = (url: string) => ({
  type: 'web_fetch_tool_result', tool_use_id: 'srvtoolu_1',
  content: { type: 'web_fetch_result', url, content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'Fake page.' } } },
})

// A stand-in for the Anthropic API that answers each request with the next reply and records what it was sent.
function fakeApi(replies: { stop_reason: string; content: unknown[] }[]) {
  const requests: Record<string, any>[] = []
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)))
    const reply = replies[requests.length - 1]!
    return Response.json({ id: 'msg_fake', type: 'message', role: 'assistant', model: SCORER_MODEL, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, ...reply })
  }) as typeof fetch
  return { requests, fetchImpl }
}

describe('makeScoreLead', () => {
  it('researches with web search and fetch, resumes a paused turn, and totals a pass with the fetched evidence', async () => {
    const api = fakeApi([
      { stop_reason: 'pause_turn', content: [fetchedBlock('https://example.org/paper')] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: `\`\`\`json\n${JSON.stringify(verdict)}\n\`\`\`` }] },
    ])

    const result = await makeScoreLead(api.fetchImpl)(lead, 'fake-key', '2026-11-18')

    expect(result).toMatchObject({ id: 7, gate: 'pass', total: 9 + 4 + 4 + 1, story: { sources: ['https://example.org/paper'] } })
    expect(api.requests[0]).toMatchObject({ model: 'claude-opus-5-5', tools: [{ type: 'web_search_20250305' }, { type: 'web_fetch_20250910' }] })
    expect(api.requests[0]!.system.startsWith(SCORE_STORY_PROMPT)).toBe(true)
    expect(JSON.parse(api.requests[0]!.messages[0].content)).toEqual({ today: '2026-11-18', lead })
    expect(api.requests[1]!.messages.at(-1)).toMatchObject({ role: 'assistant' })
  })

  it('refuses a pass whose evidence was never fetched', async () => {
    const api = fakeApi([{ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(verdict) }] }])

    await expect(makeScoreLead(api.fetchImpl)(lead, 'fake-key', '2026-11-18')).rejects.toThrow(ScoringError)
  })
})
