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
  save(session: TimewebMcpSession): Promise<TimewebMcpSession>
  setUpstreamSession(
    subject: string,
    upstreamSessionId: string | null,
    lastSeenAt: Date,
    expiresAt: Date,
  ): Promise<TimewebMcpSession>
  markRecovered(subject: string, lastSeenAt: Date, expiresAt: Date): Promise<TimewebMcpSession>
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
      const persisted = await this.store.save(session)
      syncSession(session, persisted)
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
    const persisted = await this.store.save(created)
    return { session: persisted, created: persisted.id === created.id }
  }

  async touch(session: TimewebMcpSession, now = new Date()) {
    session.lastSeenAt = now
    session.expiresAt = new Date(now.getTime() + this.ttlMs)
    const persisted = await this.store.save(session)
    syncSession(session, persisted)
    return session
  }

  async setUpstreamSession(session: TimewebMcpSession, upstreamSessionId: string | null, now = new Date()) {
    const persisted = await this.store.setUpstreamSession(
      session.subject,
      sanitizeUpstreamSessionId(upstreamSessionId),
      now,
      new Date(now.getTime() + this.ttlMs),
    )
    syncSession(session, persisted)
    return session
  }

  async markRecovered(session: TimewebMcpSession, now = new Date()) {
    const persisted = await this.store.markRecovered(
      session.subject,
      now,
      new Date(now.getTime() + this.ttlMs),
    )
    syncSession(session, persisted)
    return session
  }

  async clear(session: TimewebMcpSession) {
    await this.store.delete(session.id)
  }
}

class PostgresTimewebMcpSessionStore implements TimewebMcpSessionStore {
  async findById(id: string) {
    if (!isUuid(id)) return null
    const { rows } = await requirePool().query('SELECT * FROM timeweb_mcp_sessions WHERE session_id = $1 LIMIT 1', [id])
    return rows[0] ? fromRow(rows[0]) : null
  }

  async findBySubject(subject: string) {
    const { rows } = await requirePool().query('SELECT * FROM timeweb_mcp_sessions WHERE subject = $1 LIMIT 1', [subject])
    return rows[0] ? fromRow(rows[0]) : null
  }

  async save(session: TimewebMcpSession) {
    const { rows } = await requirePool().query(`
      INSERT INTO timeweb_mcp_sessions (
        session_id, subject, upstream_session_id, protocol_version,
        created_at, last_seen_at, expires_at, recovery_count
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (subject) DO UPDATE SET
        protocol_version = EXCLUDED.protocol_version,
        last_seen_at = EXCLUDED.last_seen_at,
        expires_at = EXCLUDED.expires_at
      RETURNING *
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
    if (!rows[0]) throw new Error('failed to persist Timeweb MCP session')
    return fromRow(rows[0])
  }

  async setUpstreamSession(subject: string, upstreamSessionId: string | null, lastSeenAt: Date, expiresAt: Date) {
    const { rows } = await requirePool().query(`
      UPDATE timeweb_mcp_sessions
      SET upstream_session_id = $2, last_seen_at = $3, expires_at = $4
      WHERE subject = $1
      RETURNING *
    `, [subject, upstreamSessionId, lastSeenAt, expiresAt])
    if (!rows[0]) throw new Error('Timeweb MCP session disappeared while setting upstream session')
    return fromRow(rows[0])
  }

  async markRecovered(subject: string, lastSeenAt: Date, expiresAt: Date) {
    const { rows } = await requirePool().query(`
      UPDATE timeweb_mcp_sessions
      SET upstream_session_id = NULL,
          recovery_count = recovery_count + 1,
          last_seen_at = $2,
          expires_at = $3
      WHERE subject = $1
      RETURNING *
    `, [subject, lastSeenAt, expiresAt])
    if (!rows[0]) throw new Error('Timeweb MCP session disappeared while recording recovery')
    return fromRow(rows[0])
  }

  async delete(id: string) {
    if (!isUuid(id)) return
    await requirePool().query('DELETE FROM timeweb_mcp_sessions WHERE session_id = $1', [id])
  }
}

export const timewebMcpSessionManager = new TimewebMcpSessionManager(new PostgresTimewebMcpSessionStore())

function requirePool() {
  const pool = getPool()
  if (!pool) throw new Error('DATABASE_URL is required for persistent Timeweb MCP sessions')
  return pool
}

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

function syncSession(target: TimewebMcpSession, source: TimewebMcpSession) {
  target.id = source.id
  target.subject = source.subject
  target.upstreamSessionId = source.upstreamSessionId
  target.protocolVersion = source.protocolVersion
  target.createdAt = source.createdAt
  target.lastSeenAt = source.lastSeenAt
  target.expiresAt = source.expiresAt
  target.recoveryCount = source.recoveryCount
}

function sanitizeUpstreamSessionId(value: string | null): string | null {
  const candidate = value?.trim() ?? ''
  return /^[A-Za-z0-9._~+\/-]{1,256}$/.test(candidate) ? candidate : null
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
