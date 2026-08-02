import { NextRequest, NextResponse } from 'next/server'

import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
  type OpportunityAuthorizationContext,
} from '@/lib/opportunities/authorization'
import { isOpportunityCrmBridgeEnabledForContext } from '@/lib/opportunities/config'
import {
  CrmIntegrationValidationError,
  normalizeCrmIntegrationInput,
} from '@/lib/opportunities/crm-integration-domain'
import {
  createCrmIntegration,
  CrmIntegrationAccessError,
} from '@/lib/opportunities/crm-integration-repository'
import { logError, logEvent } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 16 * 1024

export async function POST(request: NextRequest) {
  const authorization = await getOpportunityAuthorizationContext('workspace:update')
  if (!isBridgeApiEnabled(authorization)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!authorization) {
    return NextResponse.json({ error: 'authentication_required' }, { status: 401 })
  }
  const access = getOpportunityDataAccessContext(authorization)
  if (!access || access.authMode !== 'auth_v2' || access.workspaceId == null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  let integration
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'payload_too_large' }, { status: 400 })
    }
    integration = normalizeCrmIntegrationInput(JSON.parse(raw) as unknown)
  } catch (error) {
    if (error instanceof CrmIntegrationValidationError) {
      return NextResponse.json({ error: error.code }, { status: 400 })
    }
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  try {
    const result = await createCrmIntegration({
      workspaceId: access.workspaceId,
      actorUserId: access.actorUserId,
      integration,
    })
    logEvent('opportunity_crm.integration_created', {
      workspaceId: access.workspaceId,
      provider: integration.provider,
      integrationsCreated: 1,
    })
    return NextResponse.json(result, {
      status: 201,
      headers: secretResponseHeaders(),
    })
  } catch (error) {
    if (error instanceof CrmIntegrationAccessError) {
      return NextResponse.json({ error: error.code }, { status: 403 })
    }
    logError('opportunity_crm.integration_create_failed', error, {
      workspaceId: access.workspaceId,
      provider: integration.provider,
    })
    return NextResponse.json({ error: 'crm_integration_failed' }, { status: 500 })
  }
}

function isBridgeApiEnabled(context: OpportunityAuthorizationContext | null) {
  return isOpportunityCrmBridgeEnabledForContext(context ?? {
    dataOwnerId: null,
    workspaceId: null,
  })
}

function secretResponseHeaders() {
  return {
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  }
}
