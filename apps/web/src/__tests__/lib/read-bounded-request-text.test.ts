/** @jest-environment node */

import { readBoundedRequestText } from '@/lib/http/read-bounded-request-text'

describe('readBoundedRequestText', () => {
  it('rejects an oversized declared Content-Length before reading the body', async () => {
    let reads = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1
        controller.enqueue(new TextEncoder().encode('payload'))
        controller.close()
      },
    })
    const request = new Request('https://recruiter-radar.ru/test', {
      method: 'POST',
      body,
      duplex: 'half',
      headers: { 'content-length': '1025' },
    } as RequestInit & { duplex: 'half' })

    await expect(readBoundedRequestText(request, 1024)).resolves.toBeNull()
    expect(reads).toBe(0)
  })

  it('stops a chunked body as soon as the byte limit is exceeded', async () => {
    const encoder = new TextEncoder()
    let emitted = 0
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        emitted += 1
        controller.enqueue(encoder.encode('12345678'))
      },
      cancel() {
        cancelled = true
      },
    })
    const request = new Request('https://recruiter-radar.ru/test', {
      method: 'POST',
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    await expect(readBoundedRequestText(request, 12)).resolves.toBeNull()
    expect(emitted).toBe(2)
    expect(cancelled).toBe(true)
  })

  it('returns UTF-8 text when the body stays within the limit', async () => {
    const body = 'Радар: сигнал'
    const request = new Request('https://recruiter-radar.ru/test', {
      method: 'POST',
      body,
    })

    await expect(readBoundedRequestText(request, 1024)).resolves.toBe(body)
  })
})
