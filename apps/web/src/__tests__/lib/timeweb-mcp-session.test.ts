import {
  clearTimewebSession,
  getTimewebSession,
  saveTimewebSession,
  shouldRecoverTimewebSession,
} from '@/lib/timeweb-mcp-session'

describe('timeweb mcp session lifecycle', () => {
  it('stores and retrieves active sessions', () => {
    saveTimewebSession('test-client', 'session-123')

    expect(getTimewebSession('test-client')).toBe('session-123')

    clearTimewebSession('test-client')
    expect(getTimewebSession('test-client')).toBeNull()
  })

  it('detects recoverable upstream session failures', () => {
    expect(shouldRecoverTimewebSession(410)).toBe(true)
    expect(shouldRecoverTimewebSession(409, 'invalid session')).toBe(true)
    expect(shouldRecoverTimewebSession(500, 'internal error')).toBe(false)
  })
})
