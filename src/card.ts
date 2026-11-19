import { NEWSLETTER_NAME, STAGE_LABELS, type Stage } from './templates'

export const CARD_SIZE = 1080
export const CARD_FONT = 'EB Garamond'
// Satori falls back along this list one letter at a time, so names like "Łódź" draw from the second font.
export const CARD_FONT_EXT = 'EB Garamond Ext'
const FONT_FAMILY = `${CARD_FONT}, ${CARD_FONT_EXT}`

// The look of the website and the emails: warm paper, ink, and one serif.
const PAPER = '#F6F4EE'
const INK = '#1C1B19'
const MUTED = '#6B675F'

export interface CardContent {
  /** The date as it reads on the card, like "19 November 2026". */
  dateLabel: string
  text: string
  place: string | null
  stage: Stage | null
  /** The source's host name, like "nature.com". */
  source: string
}

type Style = Record<string, string | number>
// The element shape Satori reads, the same as React's but without needing React.
export interface CardNode {
  type: 'div'
  props: { style: Style; children: CardNode | string | Array<CardNode | string> }
}

const el = (style: Style, ...children: Array<CardNode | string>): CardNode => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0]! : children },
})

// Longer stories get smaller type, so every story fills the card about the same and none runs off it.
export function storySize(text: string): number {
  const length = [...text].length
  if (length <= 110) return 78
  if (length <= 170) return 68
  if (length <= 230) return 60
  return 54
}

/**
 * The card as a Satori element tree. The side margins are wide on purpose: Instagram crops a square
 * to a taller shape in the profile grid, and nothing that matters should sit in the strip it cuts.
 */
export function cardTree(card: CardContent): CardNode {
  const meta = [card.stage ? STAGE_LABELS[card.stage] : null, card.source].filter((part): part is string => part !== null).join(' · ')
  const story = el(
    { flexDirection: 'column', flexGrow: 1, justifyContent: 'center' },
    el({ fontSize: storySize(card.text), lineHeight: 1.2, letterSpacing: '-0.005em' }, card.text),
    el({ width: 56, height: 2, backgroundColor: INK, margin: '48px 0 36px' }, ''),
    ...(card.place ? [el({ fontSize: 34, fontStyle: 'italic' }, card.place)] : []),
    el({ fontSize: 30, fontStyle: 'italic', color: MUTED, marginTop: card.place ? 6 : 0 }, meta),
  )

  return el(
    { width: CARD_SIZE, height: CARD_SIZE, flexDirection: 'column', padding: '104px 130px 96px', backgroundColor: PAPER, color: INK, fontFamily: FONT_FAMILY },
    el({ justifyContent: 'space-between', alignItems: 'baseline' }, el({ fontSize: 42, fontStyle: 'italic' }, NEWSLETTER_NAME), el({ fontSize: 30, color: MUTED }, card.dateLabel)),
    story,
    el(
      { flexDirection: 'column', borderTop: `1px solid ${INK}`, paddingTop: 28 },
      el({ fontSize: 32, fontStyle: 'italic' }, 'A hopeful AI story, every morning.'),
      el({ fontSize: 32, marginTop: 4 }, 'build40for40.com/feel-good'),
    ),
  )
}
