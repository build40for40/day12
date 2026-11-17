// Copies the headline editor prompt into the Worker, which can't read files at run time.
// Usage: npm run prompt, after any change to prompts/headline-editor.md. A test fails if the two differ.
import { readFileSync, writeFileSync } from 'node:fs'

const source = 'prompts/headline-editor.md'
const target = 'src/editor-prompt.ts'

const text = readFileSync(source, 'utf8')
const marker = '\n---\n'
if (!text.includes(marker)) throw new Error(`${source} has no --- line separating the notes from the prompt`)
const prompt = text.split(marker).slice(1).join(marker).trim()

writeFileSync(
  target,
  `// Generated from ${source} by npm run prompt. Edit the Markdown file, not this one.\n` +
    `export const HEADLINE_EDITOR_PROMPT = ${JSON.stringify(prompt)}\n`,
)
console.log(`wrote ${target} (${prompt.length} characters)`)
