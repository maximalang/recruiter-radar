export async function readBoundedRequestText(
  request: Request,
  maximumBytes: number,
): Promise<string | null> {
  const contentLength = request.headers.get('content-length')
  if (contentLength && /^\d+$/.test(contentLength)) {
    const declaredBytes = Number(contentLength)
    if (Number.isSafeInteger(declaredBytes) && declaredBytes > maximumBytes) {
      return null
    }
  }

  if (!request.body) return ''

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maximumBytes) {
        await reader.cancel('payload_too_large').catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}
