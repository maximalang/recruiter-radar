/** @jest-environment node */

import {
  TimewebMcpSessionManager,
  type TimewebMcpSession,
  type TimewebMcpSessionStore,
} from '@/lib/timeweb-mcp-session'

class MemoryPersistentStore implements TimewebMcpSessionStore {
  private readonly rows = new Map<string, TimewebMcpSession>()

  async findById(id: string) {
    const row = [...this.rows.values()].find((item) => item.id === id)
    return row ? clone(row) : null
  }

  async findBySubject(subject: string) {
    const row = this.rows.get(subject)
    return row ? clone(row) : null
  }

  async save(session: TimewebMcpSession) {
    this.rows.set(session.subject, clone(session))
  }

  async delete(id: string) {
    for (const [subject, session] of this.rows) {
      if (session.id === id) this.rows.delete(subject)
    }
  }
}

function clone(session: TimewebMcpSession): TimewebMcpSession {
  return {
    ...session,
    createdAt: new Date(session.createdAt),
    lastSeenAt: new Date(session.lastSeenAt),
    expiresAt: new Date(session.expiresAt),
  }
}

describe('Timeweb MCP persistent session lifecycle', () => {
  it('recovers the same subject session across manager restarts and chats', async () => {
    const store = new MemoryPersistentStore()
    const firstManager = new TimewebMcpSessionManager(store, 60_000)
    const now = new Date('2026-08-16T10:00:00.000Z')
    const first = await firstManager.getOrCreate('rr_owner', null, '2025-03-26', now)
    await firstManager.setUpstreamSession(first.session, 'upstream-session-1', now)

    const restartedManager = new TimewebMcpSessionManager(store, 60_000)
    const recovered = await restartedManager.getOrCreate(
      'rr_owner',
      null,
      '2025-03-26',
      new Date(now.getTime() + 10_000),
    )

    expect(recovered.created).toBe(false)
    expect(recovered.session.id).toBe(first.session.id)
    expect(recovered.session.upstreamSessionId).toBe('upstream-session-1')
  })

  it('expires stale sessions and creates a fresh fenced local session', async () => {
    const store = new MemoryPersistentStore()
    const manager = new TimewebMcpSessionManager(store, 1_000)
    const now = new Date('2026-08-16T10:00:00.000Z')
    const first = await manager.getOrCreate('rr_owner', null, '2025-03-26', now)
    const next = await manager.getOrCreate('rr_owner', first.session.id, '2025-03-26', new Date(now.getTime() + 1_001))

    expect(next.created).toBe(true)
    expect(next.session.id).not.toBe(first.session.id)
    expect(next.session.upstreamSessionId).toBeNull()
  })

  it('clears an expired upstream session and records one recovery', async () => {
    const store = new MemoryPersistentStore()
    const manager = new TimewebMcpSessionManager(store, 60_000)
    const now = new Date('2026-08-16T10:00:00.000Z')
    const { session } = await manager.getOrCreate('rr_owner', null, '2025-03-26', now)
    await manager.setUpstreamSession(session, 'upstream-session-1', now)
    await manager.markRecovered(session, new Date(now.getTime() + 500))

    expect(session.upstreamSessionId).toBeNull()
    expect(session.recoveryCount).toBe(1)
    const persisted = await store.findBySubject('rr_owner')
    expect(persisted?.recoveryCount).toBe(1)
  })

  it('refuses to reuse another subject session id', async () => {
    const store = new MemoryPersistentStore()
    const manager = new TimewebMcpSessionManager(store, 60_000)
    const now = new Date('2026-08-16T10:00:00.000Z')
    const owner = await manager.getOrCreate('rr_owner', null, '2025-03-26', now)
    const other = await manager.getOrCreate('other_subject', owner.session.id, '2025-03-26', now)
    expect(other.session.subject).toBe('other_subject')
    expect(other.session.id).not.toBe(owner.session.id)
  })
})
