import { describe, expect, it } from 'vitest'
import { cardTree, storySize, type CardContent, type CardNode } from './card'

const base: CardContent = { dateLabel: '19 November 2026', text: 'A fake story about AI.', place: 'Nowhere, Earth', stage: 'in_a_trial', source: 'example.org' }

// Every string on the card, in order, so a test can say what a reader would see.
function words(node: CardNode | string): string[] {
  if (typeof node === 'string') return node ? [node] : []
  const { children } = node.props
  return (Array.isArray(children) ? children : [children]).flatMap(words)
}

describe('storySize', () => {
  it('shrinks the type as the story grows, and never below 54', () => {
    expect([10, 110, 111, 170, 171, 230, 231, 280].map((n) => storySize('x'.repeat(n)))).toEqual([78, 78, 68, 68, 60, 60, 54, 54])
  })

  it('counts a letter outside the basic range as one character', () => {
    expect(storySize('Ł'.repeat(110))).toBe(78)
  })
})

describe('cardTree', () => {
  it('shows the name, date, story, place, stage, source and the way to subscribe', () => {
    expect(words(cardTree(base))).toEqual([
      'Feel good AI',
      '19 November 2026',
      'A fake story about AI.',
      'Nowhere, Earth',
      'In a trial · example.org',
      'A hopeful AI story, every morning.',
      'build40for40.com/feel-good',
    ])
  })

  it('leaves out the place and the stage when the story has neither', () => {
    const shown = words(cardTree({ ...base, place: null, stage: null }))

    expect(shown).not.toContain('Nowhere, Earth')
    expect(shown).toContain('example.org')
  })

  it('is a square', () => {
    expect(cardTree(base).props.style).toMatchObject({ width: 1080, height: 1080 })
  })
})
