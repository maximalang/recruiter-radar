import { Pool, type PoolClient } from 'pg'

import { getPool as getSharedPool } from './db-pool'
import {
  DEFAULT_BADFIT_SUPPRESSION_DAYS,
  DIGEST_FEEDBACK_ACTIONS,
  buildDigestFeedbackActionPlan,
  isDigestFeedbackAction,
  updateDigestOrgStateFeedbackCore,
} from './digestFeedbackCore.mjs'
import type {
  DigestFeedbackAction as CoreDigestFeedbackAction,
  DigestFeedbackActionPlan as CoreDigestFeedbackActionPlan,
  DigestFeedbackInput,
  DigestOrgStateRow,
} from './digestFeedbackCore.mjs'

export {
  DEFAULT_BADFIT_SUPPRESSION_DAYS,
  DIGEST_FEEDBACK_ACTIONS,
  buildDigestFeedbackActionPlan,
  isDigestFeedbackAction,
}

export type DigestFeedbackAction = CoreDigestFeedbackAction
export type DigestFeedbackActionPlan = CoreDigestFeedbackActionPlan

type DigestFeedbackDbClient = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>

/**
 * Typed application boundary around the runtime-neutral ESM mutation core.
 * Next.js callers may omit `db` and use the shared pool; DB-backed verifiers
 * pass a transaction client directly to the same core implementation.
 */
export async function updateDigestOrgStateFeedback(
  input: DigestFeedbackInput,
  db?: DigestFeedbackDbClient,
): Promise<DigestOrgStateRow> {
  const pool = db ?? getSharedPool()

  if (!pool) {
    throw new Error('DATABASE_URL is not set.')
  }

  return updateDigestOrgStateFeedbackCore(
    input,
    pool as unknown as { query: (...args: any[]) => Promise<any> },
  )
}
