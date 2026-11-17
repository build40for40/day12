import { describe, expect, it } from 'vitest'
import { issueSubject, renderConfirmation, renderNewsletter, type NewsletterStory } from './templates'

const date = new Date('2026-11-17T06:00:00Z')
const SIGNUP = 'https://site.example.com/feel-good'
const story: NewsletterStory = { text: 'A made-up robot <helped> a fake farmer & friends.', url: 'https://www.example.com/story?a=1&b=2', stage: 'in_a_trial' }

describe('issueSubject', () => {
  it('puts the short date first, with an ordinal', () => {
    expect(issueSubject(date)).toBe('Nov 17th - Feel good AI')
    expect(issueSubject(new Date('2026-12-01T06:00:00Z'))).toBe('Dec 1st - Feel good AI')
    expect(issueSubject(new Date('2026-12-22T06:00:00Z'))).toBe('Dec 22nd - Feel good AI')
    expect(issueSubject(new Date('2026-12-13T06:00:00Z'))).toBe('Dec 13th - Feel good AI')
  })

  it('uses the date in London, not UTC', () => {
    expect(issueSubject(new Date('2026-06-30T23:30:00Z'))).toBe('Jul 1st - Feel good AI')
  })
})

describe('renderNewsletter', () => {
  it('renders each story with its stage and source, escaped, in html and text', () => {
    const email = renderNewsletter([story], date, SIGNUP)

    expect(email.subject).toBe('Nov 17th - Feel good AI')
    expect(email.html).toContain('Tuesday 17 November')
    expect(email.html).toContain('A made-up robot &lt;helped&gt; a fake farmer &amp; friends.')
    expect(email.html).toContain('In a trial · <a href="https://www.example.com/story?a=1&amp;b=2">example.com</a>')
    expect(email.text).toContain('1. A made-up robot <helped> a fake farmer & friends.\n   In a trial. Source: https://www.example.com/story?a=1&b=2')
  })

  it('ends with a subscribe link for forwarded copies and the home link, leaving unsubscribe to Postmark', () => {
    const email = renderNewsletter([story], date, SIGNUP)

    expect(email.html).toContain(`Was this forwarded to you? <a href="${SIGNUP}">Subscribe here</a>.`)
    expect(email.html).toContain('<a href="https://build40for40.com">build40for40.com</a>')
    expect(email.text).toContain(`Was this forwarded to you? Subscribe here: ${SIGNUP}\nhttps://build40for40.com`)
    expect(email.html.toLowerCase()).not.toContain('unsubscribe')
    expect(email.text.toLowerCase()).not.toContain('unsubscribe')
  })

  it('refuses a story over 280 characters, a missing link and an empty issue', () => {
    expect(() => renderNewsletter([{ ...story, text: 'x'.repeat(281) }], date, SIGNUP)).toThrow('281 characters')
    expect(() => renderNewsletter([{ ...story, text: 'x'.repeat(280) }], date, SIGNUP)).not.toThrow()
    expect(() => renderNewsletter([{ ...story, url: 'javascript:alert(1)' }], date, SIGNUP)).toThrow('source link')
    expect(() => renderNewsletter([], date, SIGNUP)).toThrow('at least one story')
  })
})

describe('renderConfirmation', () => {
  it('carries the confirm link and the home link, with no subscribe prompt', () => {
    const email = renderConfirmation('https://site.example.com/feel-good/confirm?token=abc')

    expect(email.subject).toBe('Confirm your Feel good AI sign-up')
    expect(email.html).toContain('<a href="https://site.example.com/feel-good/confirm?token=abc"')
    expect(email.text).toContain('https://site.example.com/feel-good/confirm?token=abc')
    expect(email.html).toContain('<a href="https://build40for40.com">build40for40.com</a>')
    expect(email.html).not.toContain('Subscribe here')
  })
})
