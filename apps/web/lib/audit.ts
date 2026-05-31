// Audit Logging System
// Tracks all user actions with context and IP addresses

import { getPool } from './db';
import { logEvent } from './runtime';

export type AuditMetadata = Record<string, unknown> & {
  ipAddress?: string | null;
  userAgent?: string | null;
  source?: string;
  error?: string;
  timestamp?: string;
};

export interface AuditLogEntry {
  id?: number;
  userId?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  oldValues?: unknown;
  newValues?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  timestamp?: Date;
  metadata?: AuditMetadata;
}

export interface AuditEvent {
  action: string;
  resourceType?: string;
  resourceId?: string;
  userId?: string | null;
  changes?: {
    before?: unknown;
    after?: unknown;
  };
  metadata?: AuditMetadata;
}

export class AuditLogger {
  private static instance: AuditLogger;

  static getInstance(): AuditLogger {
    if (!AuditLogger.instance) {
      AuditLogger.instance = new AuditLogger();
    }
    return AuditLogger.instance;
  }

  async log(event: AuditEvent): Promise<void> {
    try {
      const pool = getPool();
      if (!pool) {
        console.warn('Audit log: Database not available');
        return;
      }

      const { userId, action, resourceType, resourceId, changes, metadata } = event;

      await pool.query(`
        INSERT INTO audit_logs (
          user_id,
          action,
          resource_type,
          resource_id,
          old_values,
          new_values,
          ip_address,
          user_agent,
          created_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          NOW()
        )
      `, [
        userId,
        action,
        resourceType,
        resourceId,
        changes?.before ? JSON.stringify(changes.before) : null,
        changes?.after ? JSON.stringify(changes.after) : null,
        metadata?.ipAddress,
        metadata?.userAgent
      ]);

      // Also log to application logs for debugging
      logEvent('AUDIT_LOG', {
        action,
        resourceType,
        userId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Failed to write audit log:', error);
      // Don't fail the application audit logging fails
    }
  }

  // Convenience methods for common actions
  async logCreate(resourceType: string, resourceId: string, userId: string, newData: unknown, metadata?: AuditMetadata): Promise<void> {
    await this.log({
      action: 'create',
      resourceType,
      resourceId,
      userId,
      changes: { after: newData },
      metadata
    });
  }

  async logUpdate(resourceType: string, resourceId: string, userId: string, oldData: unknown, newData: unknown, metadata?: AuditMetadata): Promise<void> {
    await this.log({
      action: 'update',
      resourceType,
      resourceId,
      userId,
      changes: { before: oldData, after: newData },
      metadata
    });
  }

  async logDelete(resourceType: string, resourceId: string, userId: string, oldData: unknown, metadata?: AuditMetadata): Promise<void> {
    await this.log({
      action: 'delete',
      resourceType,
      resourceId,
      userId,
      changes: { before: oldData },
      metadata
    });
  }

  async logView(resourceType: string, resourceId: string, userId: string, metadata?: AuditMetadata): Promise<void> {
    await this.log({
      action: 'view',
      resourceType,
      resourceId,
      userId,
      metadata
    });
  }

  async logPermissionChange(userId: string, targetUserId: string, oldRoles: string[], newRoles: string[], metadata?: AuditMetadata): Promise<void> {
    await this.log({
      action: 'permission_change',
      resourceType: 'user',
      resourceId: targetUserId,
      userId,
      changes: {
        before: { roles: oldRoles },
        after: { roles: newRoles }
      },
      metadata
    });
  }

  async logClientProfileUpdate(clientProfileId: string, userId: string, oldData: unknown, newData: unknown, metadata?: AuditMetadata): Promise<void> {
    await this.logUpdate('client_profile', clientProfileId, userId, oldData, newData, metadata);
  }

  async logDigestRun(digestRunId: string, clientProfileId: string, userId: string, metadata?: AuditMetadata): Promise<void> {
    await this.log({
      action: 'digest_run',
      resourceType: 'digest_run',
      resourceId: digestRunId,
      userId,
      metadata: {
        clientProfileId,
        ...metadata
      }
    });
  }

  async logDigestFeedback(candidateId: string, action: string, userId: string, metadata?: AuditMetadata): Promise<void> {
    await this.log({
      action: 'digest_feedback',
      resourceType: 'digest_candidate',
      resourceId: candidateId.toString(),
      userId,
      metadata: {
        feedbackAction: action,
        ...metadata
      }
    });
  }
}

// Decorator for automatic audit logging
export function Auditable(action?: string, resourceType?: string) {
  return function (_target: unknown, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      const audit = AuditLogger.getInstance();
      const userId = getCurrentUserId();

      // Extract resource ID if possible
      let resourceId: string | undefined;
      const first = args[0];
      if (first && typeof first === 'object' && 'id' in first) {
        const idValue = (first as { id: unknown }).id;
        resourceId = typeof idValue === 'string' ? idValue : String(idValue);
      } else if (typeof first === 'string') {
        resourceId = first;
      }

      const metadata = {
        ipAddress: getClientIP(),
        userAgent: getUserAgent(),
        source: 'web_api'
      };

      try {
        // Execute original method
        const result = await originalMethod.apply(this, args);

        // Log successful operation
        await audit.log({
          action: action || propertyKey,
          resourceType,
          resourceId,
          userId,
          metadata
        });

        return result;
      } catch (error) {
        // Log failed operation
        await audit.log({
          action: `${action || propertyKey}_failed`,
          resourceType,
          resourceId,
          userId,
          metadata: {
            ...metadata,
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
          }
        });

        throw error;
      }
    };

    return descriptor;
  };
}

// Get current user ID from context
function getCurrentUserId(): string | null {
  // This would normally get user from session/context
  return null;
}

// Get client IP from request
function getClientIP(): string | null {
  // This would normally get IP from request
  return null;
}

// Get user agent from request
function getUserAgent(): string | null {
  // This would normally get UA from request
  return null;
}

// Query helper for audit logs
export async function getAuditLogs(options: {
  userId?: string;
  action?: string;
  resourceType?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
} = {}) {
  const pool = getPool();
  if (!pool) {
    throw new Error('Database not available');
  }

  let query = `
    SELECT
      al.id,
      al.user_id,
      al.action,
      al.resource_type,
      al.resource_id,
      al.old_values,
      al.new_values,
      al.ip_address,
      al.user_agent,
      al.created_at,
      u.email as user_email
    FROM audit_logs al
    LEFT JOIN users u ON al.user_id::TEXT = u.id::TEXT
    WHERE 1=1
  `;

  const params: (string | Date | number)[] = [];
  let paramIndex = 1;

  if (options.userId) {
    query += ` AND al.user_id = $${paramIndex}`;
    params.push(options.userId);
    paramIndex++;
  }

  if (options.action) {
    query += ` AND al.action = $${paramIndex}`;
    params.push(options.action);
    paramIndex++;
  }

  if (options.resourceType) {
    query += ` AND al.resource_type = $${paramIndex}`;
    params.push(options.resourceType);
    paramIndex++;
  }

  if (options.startDate) {
    query += ` AND al.created_at >= $${paramIndex}`;
    params.push(options.startDate);
    paramIndex++;
  }

  if (options.endDate) {
    query += ` AND al.created_at <= $${paramIndex}`;
    params.push(options.endDate);
    paramIndex++;
  }

  query += ` ORDER BY al.created_at DESC`;

  if (options.limit) {
    query += ` LIMIT $${paramIndex}`;
    params.push(options.limit);
    paramIndex++;
  }

  if (options.offset) {
    query += ` OFFSET $${paramIndex}`;
    params.push(options.offset);
  }

  const result = await pool.query(query, params);
  return result.rows;
}