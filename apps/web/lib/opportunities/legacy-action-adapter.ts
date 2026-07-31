import type { WorkspaceRole } from '@/lib/auth-v2/workspaces'

import { clampOpportunitySnoozeDays } from './config'
import {
  validateOutcomeInput,
  type DismissedReasonCode,
  type OpportunityContactPathType,
  type OpportunityOutcomeChannel,
  type OpportunityOutcomeInput,
} from './outcome-domain'
import {
  recordOpportunityOutcome,
  type RecordOutcomeResult,
} from './outcome-repository'
import type { OpportunityAction } from './repository'

export interface LegacyOpportunityActionInput {
  ownerId: string | number
  workspaceId?: string | number | null
  opportunityId: string | number
  action: OpportunityAction
  actionKey: string
  note?: string | null
  snoozeDays?: number
  reasonCode?: DismissedReasonCode | null
  channel?: OpportunityOutcomeChannel | null
  contactPathType?: OpportunityContactPathType | null
  contactReference?: string | null
  occurredAt?: string
  actorUserId?: string | number | null
  actorWorkspaceId?: string | number | null
  actorRoleSnapshot?: WorkspaceRole | null
  authMode?: 'auth_v2' | 'auth_v2_compat' | 'legacy'
}

export interface LegacyOutcomeCommand {
  payload: Omit<OpportunityOutcomeInput, 'snoozedUntil'>
  idempotencyPayload:
    | OpportunityOutcomeInput
    | Omit<OpportunityOutcomeInput, 'occurredAt' | 'snoozedUntil'>
}

export function toLegacyOutcomeCommand(
  input: Pick<
    LegacyOpportunityActionInput,
    | 'action'
    | 'actionKey'
    | 'note'
    | 'snoozeDays'
    | 'reasonCode'
    | 'channel'
    | 'contactPathType'
    | 'contactReference'
    | 'occurredAt'
  >,
): LegacyOutcomeCommand {
  const validatedPayload = validateOutcomeInput({
    eventType: input.action,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    reasonCode: input.action === 'dismissed' ? input.reasonCode ?? null : null,
    reasonNote: input.action === 'dismissed' ? input.note ?? null : null,
    channel: input.action === 'contacted' ? input.channel ?? 'other' : null,
    contactPathType:
      input.action === 'contacted' ? input.contactPathType ?? null : null,
    contactReference:
      input.action === 'contacted' ? input.contactReference ?? null : null,
    snoozeDays:
      input.action === 'snoozed'
        ? clampOpportunitySnoozeDays(input.snoozeDays)
        : null,
    snoozedUntil: null,
    revertsEventId: null,
    valueMinor: null,
    currency: null,
    metadata: { source: 'legacy_action' },
    idempotencyKey: input.actionKey,
  })
  const { snoozedUntil: _snoozedUntil, ...payload } = validatedPayload
  const {
    occurredAt: _occurredAt,
    snoozedUntil: _idempotencySnoozedUntil,
    ...idempotencyPayload
  } = validatedPayload
  return {
    payload,
    idempotencyPayload: input.occurredAt === undefined
      ? idempotencyPayload
      : validatedPayload,
  }
}

export async function recordLegacyOpportunityAction(
  input: LegacyOpportunityActionInput,
): Promise<RecordOutcomeResult | null> {
  const command = toLegacyOutcomeCommand(input)
  return recordOpportunityOutcome({
    ownerId: input.ownerId,
    workspaceId: input.workspaceId,
    opportunityId: input.opportunityId,
    actorType: 'user',
    actorUserId: input.actorUserId ?? input.ownerId,
    actorWorkspaceId: input.actorWorkspaceId,
    actorRoleSnapshot: input.actorRoleSnapshot,
    authMode: input.authMode,
    payload: command.payload,
    idempotencyPayload: command.idempotencyPayload,
  })
}
