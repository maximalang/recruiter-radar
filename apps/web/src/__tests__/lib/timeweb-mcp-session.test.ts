/** @jest-environment node */

import {
  TimewebMcpSessionManager,
  type TimewebMcpSession,
  type TimewebMcpSessionStore,
} from '@/lib/timeweb-mcp-session'

class MemoryPersistentStore implements TimewebMcpSessionStore {
  readonly rows = new Map<string, TimewebMcpSession>()

  async findOwned(id: string, subject: string) {
    const row = this.rows.get(id)
    return row && row.subject === subject ? clone(row) : null
  }

  async save(session: TimewebMcpSession) {
    const existing = this.rows.get(session.id)
    if (existing && existing.subject !== session.subject) {
      throw new Error('session owner mismatch')
    }
    const persisted = existing
      ? {
          ...clone(existing),
          protocolVersion: session.protocolVersion,
          lastSeenAt: new Date(session.lastSeenAt),
          expiresAt: new Date(session.expiresAt),
        }
      : clone(session)
    this.rows.set(session.id, persisted)
    return clone(persisted)
  }

  async setUpstreamSession(
    id: string,
    subject: string,
    upstreamSessionId: string | null,
    lastSeenAt: Date,
    expiresAt: Date,
  ) {
    const existing = this.rows.get(id)
    if (!existing || existing.subject !== subject) throw new Error('missing owned session')
    const persisted = {
      ...clone(existing),
      upstreamSessionId,
      lastSeenAt: new Date(lastSeenAt),
      expiresAt: new Date(expiresAt),
    }
    this.rows.set(id, persisted)
    return clone(persisted)
  }

  async markRecovered(id: string, subject: string, lastSeenAt: Date, expiresAt: Date) {
    const existing = this.rows.get(id)
    if (!existing || existing.subject !== subject) throw new Error('missing owned session')
    const persisted = {
      ...clone(existing),
      upstreamSessionId: null,
      recoveryCount: existing.recoveryCount + 1,
      lastSeenAt: new Date(lastSeenAt),
      expiresAt: new Date(expiresAt),
    }
    this.rows.set(id, persisted)
    return clone(persisted)
  }

  async delete(id: string, subject: string) {
    const existing = this.rows.get(id)
    if (existing?.subject === subject) this.rows.delete(id)
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

describe('Timeweb MCP persistent multi-session lifecycle', () => {
  it('creates independent local sessions for the same subject', async () => {
    const store = new MemoryPersistentStore()
    const manager = new TimewebMcpSessionManager(store, 60_000)
    const now = new Date('2026-08-17T10:00:00.000Z')

    const first = await manager.createSession('rr_owner', '2025-06-18', now)
    const second = await manager.createSession('rr_owner', '2025-06-18', now)

    expect(first.id).not.toBe(second.id)
    expect((await manager.findOwnedSession(first.id, 'rr_owner', now))?.id).toBe(first.id)
    expect((await manager.findOwnedSession(second.id, 'rr_owner', now))?.id).toBe(second.id)
    expect(store.rows.size).toBe(2)
  })

  it('restores an exact persistent session after a manager/runtime restart', async () => {
    const store = new MemoryPersistentStore()
    const firstManager = new TimewebMcpSessionManager(store, 60_000)
    const now = new Date('2026-08-17T10:00:00.000Z')
    const session = await firstManager.createSession('rr_owner', '2025-06-18', now)
    await firstManager.setUpstreamSession(session, 'upstream-session-1', now)

    const restartedManager = new TimewebMcpSessionManager(store, 60_000)
    const restored = await restartedManager.findOwnedSession(
      session.id,
      'rr_owner',
      new Date(now.getTime() + 10_000),
    )

    expect(restored?.id).toBe(session.id)
    expect(restored?.upstreamSessionId).toBe('upstream-session-1')
  })

  it('rejects cross-subject access instead of falling back by subject', async () => {
    const store = new MemoryPersistentStore()
    const manager = new TimewebMcpSessionManager(store, 60_000)
    const now = new Date('2026-08-17T10:00:00.000Z')
    const owner = await manager.createSession('rr_owner', '2025-06-18', now)

    await expect(manager.findOwnedSession(owner.id, 'rr_other', now)).resolves.toBeNull()
    expect(await manager.findOwnedSession(owner.id, 'rr_owner', now)).not.toBeNull()
  })

  it('recovers only the requested session and leaves a sibling session unchanged', async () => {
    const store = new MemoryPersistentStore()
    const manager = new TimewebMcpSessionManager(store, 60_000)
    const now = new Date('2026-08-17T10:00:00.000Z')
    const first = await manager.createSession('rr_owner', '2025-06-18', now)
    const second = await manager.createSession('rr_owner', '2025-06-18', now)
    await manager.setUpstreamSession(first, 'upstream-a', now)
    await manager.setUpstreamSession(second, 'upstream-b', now)

    await manager.markRecovered(first, new Date(now.getTime() + 500))

    const persistedFirst = await manager.findOwnedSession(first.id, 'rr_owner', now)
    const persistedSecond = await manager.findOwnedSession(second.id, 'rr_owner', now)
    expect(persistedFirst?.recoveryCount).toBe(1)
    expect(persistedFirst?.upstreamSessionId).toBeNull()
    expect(persistedSecond?.recoveryCount).toBe(0)
    expect(persistedSecond?.upstreamSessionId).toBe('upstream-b')
  })

  it('deletes only the selected local session', async () => {
    const store = new MemoryPersistentStore()
    const manager = new TimewebMcpSessionManager(store, 60_000)
    const now = new Date('2026-08-17T10:00:00.000Z')
    const first = await manager.createSession('rr_owner', '2025-06-18', now)
    const second = await manager.createSession('rr_owner', '2025-06-18', now)

    await manager.clear(first)

    await expect(manager.findOwnedSession(first.id, 'rr_owner', now)).resolves.toBeNull()
    expect((await manager.findOwnedSession(second.id, 'rr_owner', now))?.id).toBe(second.id)
  })

  it('does not let a stale touch overwrite recovered upstream state', async () => {
    const store = new MemoryPersistentStore()
    const manager = new TimewebMcpSessionManager(store, 60_000)
    const now = new Date('2026-08-17T10:00:00.000Z')
    const session = await manager.createSession('rr_owner', '2025-06-18', now)
    await manager.setUpstreamSession(session, 'upstream-old', now)

    const stale = clone(session)
    await manager.markRecovered(session, new Date(now.getTime() + 100))
    await manager.setUpstreamSession(session, 'upstream-new', new Date(now.getTime() + 200))
    await manager.touch(stale, new Date(now.getTime() + 300))

    expect(stale.upstreamSessionId).toBe('upstream-new')
    expect(stale.recoveryCount).toBe(1)
  })

  it('expires and deletes only the exact session', async () => {
    const store = new MemoryPersistentStore()
    const manager = new TimewebMcpSessionManager(store, 1_000)
    const now = new Date('2026-08-17T10:00:00.000Z')
    const first = await manager.createSession('rr_owner', '2025-06-18', now)
    const second = await manager.createSession('rr_owner', '2025-06-18', new Date(now.getTime() + 500))

    await expect(
      manager.findOwnedSession(first.id, 'rr_owner', new Date(now.getTime() + 1_001)),
    ).resolves.toBeNull()
    expect(
      (await manager.findOwnedSession(second.id, 'rr_owner', new Date(now.getTime() + 1_001)))?.id,
    ).toBe(second.id)
  })
})
