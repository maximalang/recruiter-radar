import { NextRequest, NextResponse } from 'next/server'

import { readBoundedRequestText } from '@/lib/http/read-bounded-request-text'
import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
  type OpportunityAuthorizationContext,
} from '@/lib/opportunities/authorization'
import { isOpportunityWorkflowV1EnabledForContext } from '@/lib/opportunities/config'
import {
  normalizeOpportunityWorkflowPatch,
  OpportunityWorkflowValidationError,
} from '@/lib/opportunities/opportunity-workflow-domain'
import {
  OpportunityWorkflowAccessError,
  OpportunityWorkflowAssigneeError,
  OpportunityWorkflowIdempotencyConflictError,
  OpportunityWorkflowIdempotencyKeyError,
  OpportunityWorkflowNextActionRequiredError,
  OpportunityWorkflowNoChangeError,
  updateOpportunityWorkflow,
} from '@/lib/opportunities/opportunity-workflow-repository'
import { logError } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 8 * 1024
const MAX_POSTGRES_BIGINT = BigInt('9223372036854775807')

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await getOpportunityAuthorizationContext(
    'opportunities:write',
  )
  if (!isWorkflowApiEnabled(authorization)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!authorization) {
    return NextResponse.json({ error: 'authentication_required' }, { status: 401 })
  }
  const access = getOpportunityDataAccessContext(authorization)
  if (
    !access ||
    access.authMode !== 'auth_v2' ||
    access.workspaceId == null ||
    access.actorRoleSnapshot == null
  ) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const { id } = await context.params
  if (!isPositivePostgresId(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? ''
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: 'workflow_idempotency_key_invalid' },
      { status: 400 },
    )
  }

  let patch
  try {
    const raw = await readBoundedRequestText(request, MAX_BODY_BYTES)
    if (raw === null) {
      return NextResponse.json({ error: 'payload_too_large' }, { status: 400 })
    }
    patch = normalizeOpportunityWorkflowPatch(JSON.parse(raw) as unknown)
  } catch (error) {
    if (error instanceof OpportunityWorkflowValidationError) {
      return NextResponse.json({ error: error.code }, { status: 400 })
    }
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  try {
    const result = await updateOpportunityWorkflow({
      ownerId: access.ownerId,
      workspaceId: access.workspaceId,
      opportunityId: id,
      actorUserId: access.actorUserId,
      actorRole: access.actorRoleSnapshot,
      idempotencyKey,
      patch,
    })
    if (!result) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    return NextResponse.json({
      idempotent: result.idempotent,
      event: {
        recordedAt: result.event.recordedAt,
        changedFields: result.event.changedFields,
      },
      state: {
        assignedToUserId: result.state.assignedToUserId,
        nextActionType: result.state.nextActionType,
        nextActionDueAt: result.state.nextActionDueAt,
        workflowPriority: result.state.workflowPriority,
        internalNote: result.state.internalNote,
        updatedAt: result.state.updatedAt,
      },
    }, { status: result.idempotent ? 200 : 201 })
  } catch (error) {
    if (
      error instanceof OpportunityWorkflowValidationError ||
      error instanceof OpportunityWorkflowAssigneeError ||
      error instanceof OpportunityWorkflowIdempotencyKeyError
    ) {
      return NextResponse.json({ error: error.code }, { status: 400 })
    }
    if (error instanceof OpportunityWorkflowAccessError) {
      return NextResponse.json({ error: error.code }, { status: 403 })
    }
    if (
      error instanceof OpportunityWorkflowIdempotencyConflictError ||
      error instanceof OpportunityWorkflowNextActionRequiredError ||
      error instanceof OpportunityWorkflowNoChangeError
    ) {
      return NextResponse.json({ error: error.code }, { status: 409 })
    }
    logError('opportunity_workflow.api.update_failed', error, {
      ownerId: access.ownerId,
      workspaceId: access.workspaceId,
      opportunityId: id,
      actorUserId: access.actorUserId,
    })
    return NextResponse.json(
      { error: 'opportunity_workflow_failed' },
      { status: 500 },
    )
  }
}

function isWorkflowApiEnabled(
  context: OpportunityAuthorizationContext | null,
): boolean {
  return isOpportunityWorkflowV1EnabledForContext(context ?? {
    dataOwnerId: null,
    workspaceId: null,
  })
}

function isPositivePostgresId(value: string): boolean {
  if (!/^[1-9]\d*$/.test(value)) return false
  try {
    return BigInt(value) <= MAX_POSTGRES_BIGINT
  } catch {
    return false
  }
}
