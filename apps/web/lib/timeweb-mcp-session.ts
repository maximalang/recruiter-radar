type SessionState = {
  sessionId: string | null
  updatedAt: number
}

const sessions = new Map<string, SessionState>()

const SESSION_MAX_AGE_MS = 30 * 60 * 1000

export function getTimewebSession(key: string): string | null {
  const state = sessions.get(key)
  if (!state) return null

  if (Date.now() - state.updatedAt > SESSION_MAX_AGE_MS) {
    sessions.delete(key)
    return null
  }

  return state.sessionId
}

export function saveTimewebSession(key: string, sessionId: string | null) {
  if (!sessionId) return

  sessions.set(key, {
    sessionId,
    updatedAt: Date.now(),
  })
}

export function clearTimewebSession(key: string) {
  sessions.delete(key)
}

export function shouldRecoverTimewebSession(status: number, body?: string) {
  if ([404, 409, 410, 440].includes(status)) return true

  return Boolean(body?.includes('session') && body.includes('invalid'))
}
