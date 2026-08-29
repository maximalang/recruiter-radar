export const DIGEST_FEEDBACK_ACTIONS: readonly [
  'accepted',
  'badfit',
  'dismissed',
  'snooze',
  'contacted',
  'replied',
  'meeting',
  'won',
]

export type DigestFeedbackAction = (typeof DIGEST_FEEDBACK_ACTIONS)[number]

export type DigestFeedbackActionPlan = {
  feedbackStatus: string
  cooldownSql: string
  suppressedSql: string
  cooldownUpdateSql: string
  suppressedUpdateSql: string
  extraParams: unknown[]
}

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

export const DEFAULT_BADFIT_SUPPRESSION_DAYS: number

export function clampSuppressionDays(value?: number | null): number

export function isDigestFeedbackAction(value: unknown): value is DigestFeedbackAction

export function buildDigestFeedbackActionPlan(input: {
  action: DigestFeedbackAction
  snoozeDays?: number | null
  suppressionDays?: number | null
  paramOffset?: number
}): DigestFeedbackActionPlan

export function updateDigestOrgStateFeedbackCore(
  input: DigestFeedbackInput,
  db: { query: (...args: any[]) => Promise<any> },
): Promise<DigestOrgStateRow>
