// Copies the prompts into the Worker, which can't read files at run time.
// Usage: npm run prompts, after any change to prompts/. A test fails while the copies differ.
import { readFileSync, writeFileSync } from 'node:fs'

const target = 'src/prompts.ts'
const score = readFileSync('prompts/score-story.md', 'utf8')
const editor = readFileSync('prompts/headline-editor.md', 'utf8')
const marker = '\n---\n'
if (!editor.includes(marker)) throw new Error('prompts/headline-editor.md has no --- line separating the notes from the prompt')

writeFileSync(
  target,
  '// Generated from prompts/ by npm run prompts. Edit the Markdown files, not this one.\n' +
    `export const SCORE_STORY_PROMPT = ${JSON.stringify(score)}\n` +
    `export const HEADLINE_EDITOR_PROMPT = ${JSON.stringify(editor.split(marker).slice(1).join(marker).trim())}\n`,
)
console.log(`wrote ${target}`)
