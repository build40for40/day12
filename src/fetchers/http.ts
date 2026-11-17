export const MAX_BODY_BYTES = 2_000_000

export async function readText(response: Response, maxBytes = MAX_BODY_BYTES): Promise<string> {
  const declared = Number(response.headers.get('Content-Length'))
  if (declared > maxBytes) {
    await response.body?.cancel()
    throw new Error(`response of ${declared} bytes is over the ${maxBytes} byte limit`)
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new Error(`response is over the ${maxBytes} byte limit`)
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}
