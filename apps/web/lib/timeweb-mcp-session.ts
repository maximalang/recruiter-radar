import { randomUUID } from 'node:crypto'

import { getPool } from './db-pool'

export const TIMEWEB_MCP_SESSION_TTL_MS = 12 * 60 * 60 * 1000

export type TimewebMcpSession = {
  id: string
  subject: string
  upstreamSessionId: string | null
  protocolVersion: string
  createdAt: Date
  lastSeenAt: Date
  expiresAt: Date
  recoveryCount: number
}

export interface TimewebMcpSessionStore {
  findById(id: string): Promise<TimewebMcpSession | null>
  findBySubject(subject: string): Promise<TimewebMcpSession | null>
  save(session: TimewebMcpSession): Promise<void>
  delete(id: string): Promise<void>
}

export class TimewebMcpSessionManager {
  constructor(
    private readonly store: TimewebMcpSessionStore,
    private readonly ttlMs = TIMEWEB_MCP_SESSION_TTL_MS,
  ) {}

  async getOrCreate(subject: string, requestedId?: string | null, protocolVersion = '2025-03-26', now = new Date()) {
    let session = requestedId ? await this.store.findById(requestedId) : null
    if (session && session.subject !== subject) session = null
    if (!session) session = await this.store.findBySubject(subject)

    if (session && session.expiresAt.getTime() > now.getTime()) {
      session.lastSeenAt = now
      session.expiresAt = new Date(now.getTime() + this.ttlMs)
      session.protocolVersion = protocolVersion || session.protocolVersion
      await this.store.save(session)
      return { session, created: false }
    }

    if (session) await this.store.delete(session.id)
    const created: TimewebMcpSession = {
      id: randomUUID(),
      subject,
      upstreamSessionId: null,
      protocolVersion: protocolVersion || '2025-03-26',
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + this.ttlMs),
      recoveryCount: 0,
    }
    await this.store.save(created)
    return { session: created, created: true }
  }

  async touch(session: TimewebMcpSession, now = new Date()) {
    session.lastSeenAt = now
    session.expiresAt = new Date(now.getTime() + this.ttlMs)
    await this.store.save(session)
    return session
  }

  async setUpstreamSession(session: TimewebMcpSession, upstreamSessionId: string | null, now = new Date()) {
    session.upstreamSessionId = sanitizeUpstreamSessionId(upstreamSessionId)
    return this.touch(session, now)
  }

  async markRecovered(session: TimewebMcpSession, now = new Date()) {
    session.upstreamSessionId = null
    session.recoveryCount += 1
    return this.touch(session, now)
  }

  async clear(session: TimewebMcpSession) {
    await this.store.delete(session.id)
  }
}

class PostgresTimewebMcpSessionStore implements TimewebMcpSessionStore {
  async findById(id: string) {
    if (!isUuid(id)) return null
    const { rows } = await getPool().query('SELECT * FROM timeweb_mcp_sessions WHERE session_id = $1 LIMIT 1', [id])
    return rows[0] ? fromRow(rows[0]) : null
  }

  async findBySubject(subject: string) {
    const { rows } = await getPool().query('SELECT * FROM timeweb_mcp_sessions WHERE subject = $1 LIMIT 1', [subject])
    return rows[0] ? fromRow(rows[0]) : null
  }

  async save(session: TimewebMcpSession) {
    await getPool().query(`
      INSERT INTO timeweb_mcp_sessions (
        session_id, subject, upstream_session_id, protocol_version,
        created_at, last_seen_at, expires_at, recovery_count
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (subject) DO UPDATE SET
        session_id = EXCLUDED.session_id,
        upstream_session_id = EXCLUDED.upstream_session_id,
        protocol_version = EXCLUDED.protocol_version,
        last_seen_at = EXCLUDED.last_seen_at,
        expires_at = EXCLUDED.expires_at,
        recovery_count = EXCLUDED.recovery_count
    `, [
      session.id,
      session.subject,
      session.upstreamSessionId,
      session.protocolVersion,
      session.createdAt,
      session.lastSeenAt,
      session.expiresAt,
      session.recoveryCount,
    ])
  }

  async delete(id: string) {
    if (!isUuid(id)) return
    await getPool().query('DELETE FROM timeweb_mcp_sessions WHERE session_id = $1', [id])
  }
}

export const timewebMcpSessionManager = new TimewebMcpSessionManager(new PostgresTimewebMcpSessionStore())

function fromRow(row: Record<string, unknown>): TimewebMcpSession {
  return {
    id: String(row.session_id),
    subject: String(row.subject),
    upstreamSessionId: row.upstream_session_id ? String(row.upstream_session_id) : null,
    protocolVersion: String(row.protocol_version),
    createdAt: new Date(String(row.created_at)),
    lastSeenAt: new Date(String(row.last_seen_at)),
    expiresAt: new Date(String(row.expires_at)),
    recoveryCount: Number(row.recovery_count ?? 0),
  }
}

function sanitizeUpstreamSessionId(value: string | null): string | null {
  const candidate = value?.trim() ?? ''
  return /^[A-Za-z0-9._~+\/-]{1,256}$/.test(candidate) ? candidate : null
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
