import type { Pool, PoolClient } from 'pg'

import {
  buildDigestFeedbackActionPlan,
  DEFAULT_BADFIT_SUPPRESSION_DAYS,
  DIGEST_FEEDBACK_ACTIONS,
  isDigestFeedbackAction,
  updateDigestOrgStateFeedbackCore,
} from './digestFeedbackCore.mjs'
import { getPool } from './db-pool'
import {
  getSuppressionScopeSnapshot,
  recordClientOrgSuppression,
} from './orgSuppression'

export {
  buildDigestFeedbackActionPlan,
  DEFAULT_BADFIT_SUPPRESSION_DAYS,
  DIGEST_FEEDBACK_ACTIONS,
  isDigestFeedbackAction,
}

export type DigestFeedbackAction =
  | 'accepted'
  | 'badfit'
  | 'dismissed'
  | 'snooze'
  | 'contacted'
  | 'replied'
  | 'meeting'
  | 'won'

export type DigestFeedbackInput = {
  clientProfileId: string | number
  orgId?: string | number | null
  digestCandidateId?: string | number | null
  action: DigestFeedbackAction
  note?: string | null
  snoozeDays?: number | null
  suppressionDays?: number | null
}

export type DigestOrgStateRow = {
  clientProfileId: string
  orgId: string
  feedbackStatus: string
  feedbackAt: string | null
  feedbackNote: string | null
  cooldownUntil: string | null
  suppressedUntil: string | null
  lastDigestCandidateId: string | null
  lastDigestRunId: string | null
  updatedAt: string
}

type DigestFeedbackDbClient = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>

type DigestFeedbackCoreDb = DigestFeedbackDbClient & {
  getSuppressionScope: (orgId: string | number) => ReturnType<typeof getSuppressionScopeSnapshot>
  recordSuppression: (input: Parameters<typeof recordClientOrgSuppression>[1]) => ReturnType<typeof recordClientOrgSuppression>
}

/**
 * Applies feedback and ER-scoped suppression atomically.
 *
 * When `db` is supplied, its caller owns the surrounding transaction (Telegram
 * webhook paths already do this). Without `db`, this boundary acquires a shared
 * pool client and creates the transaction itself.
 */
export async function updateDigestOrgStateFeedback(
  input: DigestFeedbackInput,
  db?: DigestFeedbackDbClient,
): Promise<DigestOrgStateRow> {
  if (db) {
    return updateDigestOrgStateFeedbackCore(input, bindSuppressionStore(db)) as Promise<DigestOrgStateRow>
  }

  const pool = getPool()
  if (!pool) {
    throw new Error('DATABASE_URL is not set.')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const state = await updateDigestOrgStateFeedbackCore(
      input,
      bindSuppressionStore(client),
    ) as DigestOrgStateRow
    await client.query('COMMIT')
    return state
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

function bindSuppressionStore(db: DigestFeedbackDbClient): DigestFeedbackCoreDb {
  return Object.assign(db, {
    getSuppressionScope: (orgId: string | number) => getSuppressionScopeSnapshot(db, orgId),
    recordSuppression: (input: Parameters<typeof recordClientOrgSuppression>[1]) =>
      recordClientOrgSuppression(db, input),
  })
}
