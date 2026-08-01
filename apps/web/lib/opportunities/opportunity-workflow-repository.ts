import type { Pool, PoolClient } from 'pg'

import type { WorkspaceRole } from '@/lib/auth-v2/workspaces'
import { getClient, getPool } from '@/lib/db-pool'
import { hashCanonicalJson } from './canonical-hash'
import {
  canApplyOpportunityWorkflowPatch,
  normalizeOpportunityWorkflowPatch,
  type OpportunityNextActionType,
  type OpportunityWorkflowPatch,
  type OpportunityWorkflowPriority,
} from './opportunity-workflow-domain'

export interface OpportunityWorkflowState {
  assignedToUserId: string | null
  nextActionType: OpportunityNextActionType | null
  nextActionDueAt: string | null
  workflowPriority: OpportunityWorkflowPriority
  internalNote: string | null
  lastEventId: string | null
  updatedAt: string | null
}

export interface OpportunityWorkflowUpdateResult {
  state: OpportunityWorkflowState
  event: {
    id: string
    recordedAt: string
    changedFields: OpportunityWorkflowField[]
  }
  idempotent: boolean
}

export interface OpportunityWorkflowAssignee {
  userId: string
  displayName: string
  role: Extract<WorkspaceRole, 'owner' | 'admin' | 'recruiter'>
}

export type OpportunityWorkflowField =
  | 'assignedToUserId'
  | 'nextActionType'
  | 'nextActionDueAt'
  | 'workflowPriority'
  | 'internalNote'

export class OpportunityWorkflowIdempotencyConflictError extends Error {
  readonly code = 'workflow_idempotency_conflict'

  constructor() {
    super('Workflow idempotency key was reused with another payload.')
    this.name = 'OpportunityWorkflowIdempotencyConflictError'
  }
}

export class OpportunityWorkflowAccessError extends Error {
  readonly code = 'workflow_access_denied'

  constructor() {
    super('The actor cannot update this opportunity workflow.')
    this.name = 'OpportunityWorkflowAccessError'
  }
}

export class OpportunityWorkflowAssigneeError extends Error {
  readonly code = 'workflow_assignee_unavailable'

  constructor() {
    super('The assignee is not an active writable workspace member.')
    this.name = 'OpportunityWorkflowAssigneeError'
  }
}

export class OpportunityWorkflowNoChangeError extends Error {
  readonly code = 'workflow_no_change'

  constructor() {
    super('The workflow patch does not change current state.')
    this.name = 'OpportunityWorkflowNoChangeError'
  }
}

export class OpportunityWorkflowNextActionRequiredError extends Error {
  readonly code = 'workflow_next_action_required'

  constructor() {
    super('A due date requires a next action type.')
    this.name = 'OpportunityWorkflowNextActionRequiredError'
  }
}

export class OpportunityWorkflowIdempotencyKeyError extends Error {
  readonly code = 'workflow_idempotency_key_invalid'

  constructor() {
    super('A printable idempotency key of at most 160 characters is required.')
    this.name = 'OpportunityWorkflowIdempotencyKeyError'
  }
}

type ClientProvider = () => Promise<PoolClient | null>

type WorkflowRow = OpportunityWorkflowState & {
  opportunityId: string
}

type ReplayRow = {
  eventId: string
  payloadHash: string
  opportunityId: string
  assignedToUserId: string | null
  nextActionType: OpportunityNextActionType | null
  nextActionDueAt: string | null
  workflowPriority: OpportunityWorkflowPriority
  internalNote: string | null
  changedFields: OpportunityWorkflowField[]
  recordedAt: string
}

const WORKFLOW_FIELD_ORDER: readonly OpportunityWorkflowField[] = [
  'assignedToUserId',
  'nextActionType',
  'nextActionDueAt',
  'workflowPriority',
  'internalNote',
]
const WRITABLE_ROLES = new Set<WorkspaceRole>(['owner', 'admin', 'recruiter'])
const POSITIVE_ID_PATTERN = /^[1-9]\d*$/
const MAX_POSTGRES_BIGINT = BigInt('9223372036854775807')

export async function listOpportunityWorkflowAssignees(
  workspaceIdInput: string | number,
  db: Pick<Pool, 'query'> | null = getPool(),
): Promise<OpportunityWorkflowAssignee[]> {
  const workspaceId = positiveId(workspaceIdInput)
  if (!workspaceId) throw new OpportunityWorkflowAccessError()
  if (!db) throw new Error('DATABASE_URL is not set.')

  const result = await db.query<OpportunityWorkflowAssignee>(
    `SELECT
       membership.user_id::TEXT AS "userId",
       COALESCE(
         NULLIF(BTRIM(account.display_name), ''),
         NULLIF(BTRIM(account.full_name), ''),
         'Участник ' || membership.user_id::TEXT
       ) AS "displayName",
       membership.role
     FROM workspace_members membership
     JOIN users account ON account.id = membership.user_id
     WHERE membership.workspace_id = $1
       AND membership.status = 'active'
       AND membership.role IN ('owner', 'admin', 'recruiter')
       AND account.status = 'active'
     ORDER BY
       CASE membership.role
         WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2
       END,
       LOWER(COALESCE(account.display_name, account.full_name, '')),
       membership.user_id`,
    [workspaceId],
  )
  return result.rows
}

export async function updateOpportunityWorkflow(
  input: {
    ownerId: string | number
    workspaceId: string | number
    opportunityId: string | number
    actorUserId: string | number
    actorRole: WorkspaceRole
    idempotencyKey: string
    patch: OpportunityWorkflowPatch
  },
  provideClient: ClientProvider = getClient,
): Promise<OpportunityWorkflowUpdateResult | null> {
  const ownerId = positiveId(input.ownerId)
  const workspaceId = positiveId(input.workspaceId)
  const opportunityId = positiveId(input.opportunityId)
  const actorUserId = positiveId(input.actorUserId)
  if (!ownerId || !workspaceId || !opportunityId || !actorUserId) {
    throw new OpportunityWorkflowAccessError()
  }
  if (!WRITABLE_ROLES.has(input.actorRole)) {
    throw new OpportunityWorkflowAccessError()
  }
  const idempotencyKey = input.idempotencyKey.trim()
  if (
    !idempotencyKey ||
    idempotencyKey.length > 160 ||
    !/^[\x21-\x7E]+$/.test(idempotencyKey)
  ) {
    throw new OpportunityWorkflowIdempotencyKeyError()
  }
  const patch = normalizeOpportunityWorkflowPatch(input.patch)
  const payloadHash = hashCanonicalJson({ opportunityId, patch })

  const client = await provideClient()
  if (!client) throw new Error('DATABASE_URL is not set.')
  try {
    await client.query('BEGIN')
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtextextended($1::TEXT, 0)
       )`,
      [`opportunity-workflow:${ownerId}:${workspaceId}:${idempotencyKey}`],
    )

    const replay = await findReplay(
      client,
      ownerId,
      workspaceId,
      idempotencyKey,
    )
    if (replay) {
      const replayActor = await findActiveMember(
        client,
        workspaceId,
        actorUserId,
      )
      if (!replayActor || replayActor.role !== input.actorRole) {
        throw new OpportunityWorkflowAccessError()
      }
      if (
        replay.payloadHash !== payloadHash ||
        replay.opportunityId !== opportunityId
      ) {
        throw new OpportunityWorkflowIdempotencyConflictError()
      }
      await client.query('COMMIT')
      return replayResult(replay)
    }

    const current = await lockOpportunity(
      client,
      ownerId,
      workspaceId,
      opportunityId,
    )
    if (!current) {
      await client.query('ROLLBACK')
      return null
    }

    const actor = await findActiveMember(client, workspaceId, actorUserId)
    if (!actor || actor.role !== input.actorRole) {
      throw new OpportunityWorkflowAccessError()
    }

    const target = mergeWorkflowState(current, patch)
    const assignmentChanged =
      target.assignedToUserId !== current.assignedToUserId
    if (!canApplyOpportunityWorkflowPatch({
      actorRole: input.actorRole,
      actorUserId,
      currentAssigneeUserId: current.assignedToUserId,
      targetAssigneeUserId: target.assignedToUserId,
      assignmentChanged,
    })) {
      throw new OpportunityWorkflowAccessError()
    }
    if (assignmentChanged && target.assignedToUserId !== null) {
      const assignee = target.assignedToUserId === actorUserId
        ? actor
        : await findActiveMember(client, workspaceId, target.assignedToUserId)
      if (!assignee || !WRITABLE_ROLES.has(assignee.role)) {
        throw new OpportunityWorkflowAssigneeError()
      }
    }

    const changedFields = changedWorkflowFields(current, target)
    if (changedFields.length === 0) {
      throw new OpportunityWorkflowNoChangeError()
    }

    const inserted = await client.query<{ id: string; recordedAt: string }>(
      `INSERT INTO opportunity_workflow_events (
         owner_id, workspace_id, opportunity_id,
         actor_user_id, actor_workspace_id, actor_role_snapshot,
         assigned_to_user_id, next_action_type, next_action_due_at,
         workflow_priority, internal_note, changed_fields,
         idempotency_key, payload_hash
       )
       VALUES (
         $1, $2, $3,
         $4, $2, $5,
         $6, $7, $8::timestamptz,
         $9, $10, $11::text[],
         $12, $13
       )
       RETURNING id::TEXT AS id, recorded_at::TEXT AS "recordedAt"`,
      [
        ownerId,
        workspaceId,
        opportunityId,
        actorUserId,
        input.actorRole,
        target.assignedToUserId,
        target.nextActionType,
        target.nextActionDueAt,
        target.workflowPriority,
        target.internalNote,
        changedFields,
        idempotencyKey,
        payloadHash,
      ],
    )
    const event = inserted.rows[0]
    if (!event) throw new Error('Workflow event insert returned no row.')

    const projected = await client.query<OpportunityWorkflowState>(
      `INSERT INTO opportunity_workflow_state (
         owner_id, workspace_id, opportunity_id,
         assigned_to_user_id, next_action_type, next_action_due_at,
         workflow_priority, internal_note, last_event_id, updated_at
       )
       VALUES (
         $1, $2, $3,
         $4, $5, $6::timestamptz,
         $7, $8, $9, NOW()
       )
       ON CONFLICT (owner_id, workspace_id, opportunity_id)
       DO UPDATE SET
         assigned_to_user_id = EXCLUDED.assigned_to_user_id,
         next_action_type = EXCLUDED.next_action_type,
         next_action_due_at = EXCLUDED.next_action_due_at,
         workflow_priority = EXCLUDED.workflow_priority,
         internal_note = EXCLUDED.internal_note,
         last_event_id = EXCLUDED.last_event_id,
         updated_at = NOW()
       RETURNING
         assigned_to_user_id::TEXT AS "assignedToUserId",
         next_action_type AS "nextActionType",
         next_action_due_at::TEXT AS "nextActionDueAt",
         workflow_priority AS "workflowPriority",
         internal_note AS "internalNote",
         last_event_id::TEXT AS "lastEventId",
         updated_at::TEXT AS "updatedAt"`,
      [
        ownerId,
        workspaceId,
        opportunityId,
        target.assignedToUserId,
        target.nextActionType,
        target.nextActionDueAt,
        target.workflowPriority,
        target.internalNote,
        event.id,
      ],
    )
    const state = projected.rows[0]
    if (!state) throw new Error('Workflow state projection returned no row.')

    await client.query('COMMIT')
    return {
      state,
      event: {
        id: event.id,
        recordedAt: event.recordedAt,
        changedFields,
      },
      idempotent: false,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function findReplay(
  client: PoolClient,
  ownerId: string,
  workspaceId: string,
  idempotencyKey: string,
): Promise<ReplayRow | null> {
  const result = await client.query<ReplayRow>(
    `SELECT
       id::TEXT AS "eventId",
       payload_hash AS "payloadHash",
       opportunity_id::TEXT AS "opportunityId",
       assigned_to_user_id::TEXT AS "assignedToUserId",
       next_action_type AS "nextActionType",
       next_action_due_at::TEXT AS "nextActionDueAt",
       workflow_priority AS "workflowPriority",
       internal_note AS "internalNote",
       changed_fields AS "changedFields",
       recorded_at::TEXT AS "recordedAt"
     FROM opportunity_workflow_events
     WHERE owner_id = $1
       AND workspace_id = $2
       AND idempotency_key = $3
     LIMIT 1`,
    [ownerId, workspaceId, idempotencyKey],
  )
  return result.rows[0] ?? null
}

async function lockOpportunity(
  client: PoolClient,
  ownerId: string,
  workspaceId: string,
  opportunityId: string,
): Promise<WorkflowRow | null> {
  const result = await client.query<WorkflowRow>(
    `SELECT
       opportunity.id::TEXT AS "opportunityId",
       state.assigned_to_user_id::TEXT AS "assignedToUserId",
       state.next_action_type AS "nextActionType",
       state.next_action_due_at::TEXT AS "nextActionDueAt",
       COALESCE(state.workflow_priority, 'normal') AS "workflowPriority",
       state.internal_note AS "internalNote",
       state.last_event_id::TEXT AS "lastEventId",
       state.updated_at::TEXT AS "updatedAt"
     FROM opportunities opportunity
     LEFT JOIN opportunity_workflow_state state
       ON state.owner_id = opportunity.owner_id
      AND state.workspace_id = opportunity.workspace_id
      AND state.opportunity_id = opportunity.id
     WHERE opportunity.id = $1
       AND opportunity.owner_id = $2
       AND opportunity.workspace_id = $3
       AND opportunity.superseded_at IS NULL
     LIMIT 1
     FOR UPDATE OF opportunity`,
    [opportunityId, ownerId, workspaceId],
  )
  return result.rows[0] ?? null
}

async function findActiveMember(
  client: PoolClient,
  workspaceId: string,
  userId: string,
): Promise<{ userId: string; role: WorkspaceRole } | null> {
  const result = await client.query<{ userId: string; role: WorkspaceRole }>(
    `SELECT
       membership.user_id::TEXT AS "userId",
       membership.role
     FROM workspace_members membership
     WHERE membership.workspace_id = $1
       AND membership.user_id = $2
       AND membership.status = 'active'
     LIMIT 1
     FOR SHARE`,
    [workspaceId, userId],
  )
  return result.rows[0] ?? null
}

function mergeWorkflowState(
  current: WorkflowRow,
  patch: OpportunityWorkflowPatch,
): OpportunityWorkflowState {
  const nextActionType = hasOwn(patch, 'nextActionType')
    ? patch.nextActionType ?? null
    : current.nextActionType
  let nextActionDueAt = hasOwn(patch, 'nextActionDueAt')
    ? patch.nextActionDueAt ?? null
    : current.nextActionDueAt
  if (hasOwn(patch, 'nextActionType') && nextActionType === null) {
    nextActionDueAt = null
  }
  if (nextActionDueAt !== null && nextActionType === null) {
    throw new OpportunityWorkflowNextActionRequiredError()
  }
  return {
    assignedToUserId: hasOwn(patch, 'assignedToUserId')
      ? patch.assignedToUserId ?? null
      : current.assignedToUserId,
    nextActionType,
    nextActionDueAt,
    workflowPriority: hasOwn(patch, 'workflowPriority')
      ? patch.workflowPriority ?? 'normal'
      : current.workflowPriority,
    internalNote: hasOwn(patch, 'internalNote')
      ? patch.internalNote ?? null
      : current.internalNote,
    lastEventId: current.lastEventId,
    updatedAt: current.updatedAt,
  }
}

function changedWorkflowFields(
  current: OpportunityWorkflowState,
  target: OpportunityWorkflowState,
): OpportunityWorkflowField[] {
  return WORKFLOW_FIELD_ORDER.filter((field) => current[field] !== target[field])
}

function replayResult(replay: ReplayRow): OpportunityWorkflowUpdateResult {
  return {
    state: {
      assignedToUserId: replay.assignedToUserId,
      nextActionType: replay.nextActionType,
      nextActionDueAt: replay.nextActionDueAt,
      workflowPriority: replay.workflowPriority,
      internalNote: replay.internalNote,
      lastEventId: replay.eventId,
      updatedAt: replay.recordedAt,
    },
    event: {
      id: replay.eventId,
      recordedAt: replay.recordedAt,
      changedFields: replay.changedFields,
    },
    idempotent: true,
  }
}

function positiveId(value: string | number): string | null {
  const normalized = String(value)
  if (!POSITIVE_ID_PATTERN.test(normalized)) return null
  try {
    return BigInt(normalized) <= MAX_POSTGRES_BIGINT ? normalized : null
  } catch {
    return null
  }
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}
