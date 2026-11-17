import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HEADLINE_EDITOR_PROMPT, SCORE_STORY_PROMPT } from './prompts'

describe('the prompt copies', () => {
  it('match prompts/ (run npm run prompts after editing them)', () => {
    const editor = readFileSync('prompts/headline-editor.md', 'utf8')
    expect(SCORE_STORY_PROMPT).toBe(readFileSync('prompts/score-story.md', 'utf8'))
    expect(HEADLINE_EDITOR_PROMPT).toBe(editor.split('\n---\n').slice(1).join('\n---\n').trim())
  })
})
