/** @jest-environment node */

import { readBoundedRequestText } from '@/lib/http/read-bounded-request-text'

describe('readBoundedRequestText', () => {
  it('rejects an oversized declared Content-Length before acquiring a body reader', async () => {
    const getReader = jest.fn()
    const request = {
      headers: new Headers({ 'content-length': '1025' }),
      body: { getReader },
    } as unknown as Request

    await expect(readBoundedRequestText(request, 1024)).resolves.toBeNull()
    expect(getReader).not.toHaveBeenCalled()
  })

  it('stops reading a chunked body as soon as the byte limit is exceeded', async () => {
    const encoder = new TextEncoder()
    const chunks = [encoder.encode('12345678'), encoder.encode('abcdefgh')]
    let index = 0
    const reader = {
      read: jest.fn(async () => {
        if (index >= chunks.length) {
          return { done: true as const, value: undefined }
        }
        const value = chunks[index]
        index += 1
        return { done: false as const, value }
      }),
      cancel: jest.fn().mockResolvedValue(undefined),
      releaseLock: jest.fn(),
    }
    const request = {
      headers: new Headers(),
      body: { getReader: () => reader },
    } as unknown as Request

    await expect(readBoundedRequestText(request, 12)).resolves.toBeNull()
    expect(reader.read).toHaveBeenCalledTimes(2)
    expect(reader.cancel).toHaveBeenCalledWith('payload_too_large')
    expect(reader.releaseLock).toHaveBeenCalledTimes(1)
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
