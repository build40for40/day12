import Anthropic from '@anthropic-ai/sdk'
import { HEADLINE_EDITOR_PROMPT } from './editor-prompt'

export const EDITOR_MODEL = 'claude-opus-5-5'
// X counts a link as 23 characters, so 255 characters of text, a space and the link fit in 280.
export const MAX_POST_TEXT = 255
const ATTEMPTS = 3

// The story record the headline editor reads. Field names match the backlog; see prompts/headline-editor.md.
export interface EditorRecord {
  headline: string
  what_happened: string
  why_its_good: string | null
  careful: string[]
  stage: string | null
  topic: string | null
  lane: 'good' | 'flip'
  bad_news?: string | null
  flip_kind?: string | null
  source_url: string
}

export interface EditorOutput {
  decision: 'keep' | 'rewrite' | 'write'
  post: string
  text_length: number
  place: string | null
  changes: string
  needs_from_source: string | null
}

export class EditorError extends Error {}

// The output section of the prompt, as a schema, so the reply is always this shape.
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: ['keep', 'rewrite', 'write'] },
    post: { type: 'string' },
    text_length: { type: 'integer' },
    place: { type: ['string', 'null'] },
    changes: { type: 'string' },
    needs_from_source: { type: ['string', 'null'] },
  },
  required: ['decision', 'post', 'text_length', 'place', 'changes', 'needs_from_source'],
  additionalProperties: false,
}

// Returns the post's text without the link, or the reason it can't be used.
export function checkPost(post: string, url: string): { text: string } | { problem: string } {
  const trimmed = post.trim()
  if (!trimmed.endsWith(url)) return { problem: 'the post does not end with the source link' }
  const text = trimmed.slice(0, -url.length).trim()
  if (!text) return { problem: 'the post has no text' }
  const length = [...text].length
  if (length > MAX_POST_TEXT) return { problem: `the text is ${length} characters, the limit is ${MAX_POST_TEXT}` }
  if (text.includes('#') || /https?:\/\//.test(text)) return { problem: 'the text has a hashtag or a second link' }
  return { text }
}

export type WritePost = (apiKey: string, record: EditorRecord) => Promise<{ text: string; output: EditorOutput }>

export function makeWritePost(fetchImpl?: typeof fetch): WritePost {
  return async (apiKey, record) => {
    const client = new Anthropic({ apiKey, ...(fetchImpl ? { fetch: fetchImpl } : {}) })
    const message = `Story record:\n${JSON.stringify(record, null, 2)}`
    let problem: string | null = null

    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const content = problem ? `${message}\n\nYour last answer was rejected: ${problem}. Fix that and answer again.` : message
      let response: Anthropic.Beta.Messages.BetaMessage
      try {
        // Server-side fallbacks: if the model declines, the API reruns the request on a fallback model in the same call.
        response = await client.beta.messages.create({
          model: EDITOR_MODEL,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
          system: HEADLINE_EDITOR_PROMPT,
          messages: [{ role: 'user', content }],
        })
      } catch (error) {
        if (error instanceof Anthropic.AuthenticationError) throw new EditorError('The Anthropic API rejected ANTHROPIC_API_KEY.')
        if (error instanceof Anthropic.RateLimitError) throw new EditorError('The Anthropic API is rate limiting this key.')
        if (error instanceof Anthropic.APIConnectionError) throw new EditorError('Could not reach the Anthropic API.')
        if (error instanceof Anthropic.APIError) throw new EditorError(`The Anthropic API answered ${error.status}: ${error.message}`)
        throw error
      }
      if (response.stop_reason === 'refusal') throw new EditorError('The model declined to write this story. Run another one by hand.')

      const reply = response.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
      let output: EditorOutput
      try {
        output = JSON.parse(reply) as EditorOutput
      } catch {
        problem = 'the answer was not the JSON object asked for'
        continue
      }
      const checked = checkPost(output.post, record.source_url)
      if ('text' in checked) return { text: checked.text, output }
      problem = checked.problem
    }
    throw new EditorError(`The headline editor failed ${ATTEMPTS} times. Last problem: ${problem}`)
  }
}
