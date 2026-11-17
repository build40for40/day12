import { describe, expect, it } from 'vitest'
import { readText } from './http'

function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part))
      controller.close()
    },
  })
}

describe('readText', () => {
  it('returns the body when it is under the limit', async () => {
    expect(await readText(new Response(streamOf('<rss>', 'fake</rss>')), 100)).toBe('<rss>fake</rss>')
  })

  it('rejects a declared Content-Length over the limit without reading', async () => {
    const response = new Response('tiny', { headers: { 'Content-Length': '5000' } })
    await expect(readText(response, 100)).rejects.toThrow('over the 100 byte limit')
  })

  it('stops reading a stream once it passes the limit', async () => {
    const response = new Response(streamOf('x'.repeat(60), 'x'.repeat(60)))
    await expect(readText(response, 100)).rejects.toThrow('over the 100 byte limit')
  })
})
