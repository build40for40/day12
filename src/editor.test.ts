import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkPost, EDITOR_MODEL, EditorError, makeWritePost, type EditorRecord } from './editor'
import { HEADLINE_EDITOR_PROMPT } from './editor-prompt'

const record: EditorRecord = {
  headline: 'Dublin starts an AI flood warning pilot',
  what_happened: 'Dublin City Council is starting a pilot of an AI flood warning.',
  why_its_good: 'It gives the council time to prepare.',
  careful: ['The pilot is only starting.'],
  stage: 'in_a_trial',
  topic: 'climate_and_nature',
  lane: 'good',
  source_url: 'https://example.org/dublin',
}

// A stand-in for the Anthropic API that records each request and answers with the given replies in turn.
function fakeApi(replies: unknown[], status = 200) {
  const requests: Record<string, unknown>[] = []
  const headers: Headers[] = []
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)))
    headers.push(new Headers(init?.headers))
    const reply = replies[Math.min(requests.length - 1, replies.length - 1)]
    if (status !== 200) return Response.json({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } }, { status })
    return Response.json({
      id: 'msg_fake',
      type: 'message',
      role: 'assistant',
      model: EDITOR_MODEL,
      content: [{ type: 'text', text: typeof reply === 'string' ? reply : JSON.stringify(reply) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    })
  }) as typeof fetch
  return { requests, headers, fetchImpl }
}

const answer = (post: string) => ({ decision: 'write', post, text_length: 10, place: 'Dublin, Ireland', changes: 'Wrote it.', needs_from_source: null })

describe('makeWritePost', () => {
  it('asks the current Opus with the prompt, a JSON schema and fallbacks, and returns the text', async () => {
    const api = fakeApi([answer('Dublin starts piloting an AI flood warning. https://example.org/dublin')])

    const result = await makeWritePost(api.fetchImpl)('fake-key', record)

    expect(result.text).toBe('Dublin starts piloting an AI flood warning.')
    expect(result.output.place).toBe('Dublin, Ireland')
    const sent = api.requests[0]!
    expect(sent).toMatchObject({ model: 'claude-opus-5-5', system: HEADLINE_EDITOR_PROMPT, fallbacks: 'default', output_config: { effort: 'medium', format: { type: 'json_schema' } } })
    expect(api.headers[0]!.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01')
    expect(api.headers[0]!.get('authorization')).toBe('Bearer fake-key')
  })

  it('asks again with the reason when a post breaks the rules', async () => {
    const api = fakeApi([answer(`${'x'.repeat(300)} https://example.org/dublin`), answer('Fine now. https://example.org/dublin')])

    const result = await makeWritePost(api.fetchImpl)('fake-key', record)

    expect(result.text).toBe('Fine now.')
    expect(JSON.stringify(api.requests[1])).toContain('the text is 300 characters')
  })

  it('stops with a plain reason when the key is rejected', async () => {
    const api = fakeApi([], 401)
    await expect(makeWritePost(api.fetchImpl)('bad-key', record)).rejects.toThrow(EditorError)
  })
})

describe('checkPost', () => {
  const url = 'https://example.com/a'
  it('accepts a good post and rejects long text, hashtags, extra links and a missing link', () => {
    expect(checkPost(`Fine words. ${url}`, url)).toEqual({ text: 'Fine words.' })
    for (const post of [`${'x'.repeat(256)} ${url}`, `Good #AI ${url}`, `See https://other.example ${url}`, 'No link at all']) {
      expect(checkPost(post, url)).toHaveProperty('problem')
    }
  })
})

describe('the prompt copy', () => {
  it('matches prompts/headline-editor.md (run npm run prompt after editing it)', () => {
    const markdown = readFileSync('prompts/headline-editor.md', 'utf8')
    expect(HEADLINE_EDITOR_PROMPT).toBe(markdown.split('\n---\n').slice(1).join('\n---\n').trim())
  })
})
