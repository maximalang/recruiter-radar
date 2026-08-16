type SessionState = {
  id: string
  createdAt: number
  lastSeenAt: number
}

const sessions = new Map<string, SessionState>()
const SESSION_TTL = 1000 * 60 * 30

export function getOrCreateTimewebMcpSession(id?: string) {
  const now = Date.now()
  const key = id?.trim() || crypto.randomUUID()
  const existing = sessions.get(key)

  if (existing && now - existing.lastSeenAt < SESSION_TTL) {
    existing.lastSeenAt = now
    return existing
  }

  const session = { id: key, createdAt: now, lastSeenAt: now }
  sessions.set(key, session)
  return session
}

export function recoverTimewebMcpSession(id: string) {
  const session = sessions.get(id)
  if (!session) return null
  if (Date.now() - session.lastSeenAt > SESSION_TTL) {
    sessions.delete(id)
    return null
  }
  session.lastSeenAt = Date.now()
  return session
}
