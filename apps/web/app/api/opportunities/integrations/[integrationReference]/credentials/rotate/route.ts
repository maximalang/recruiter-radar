import { NextResponse } from 'next/server'

import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'
import { isOpportunityCrmBridgeEnabledForContext } from '@/lib/opportunities/config'
import {
  CrmIntegrationAccessError,
  rotateCrmCredential,
} from '@/lib/opportunities/crm-integration-repository'
import { logError, logEvent } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _request: Request,
  context: { params: Promise<{ integrationReference: string }> },
) {
  const authorization = await getOpportunityAuthorizationContext('workspace:update')
  if (!isOpportunityCrmBridgeEnabledForContext(authorization ?? {
    dataOwnerId: null, workspaceId: null,
  })) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!authorization) {
    return NextResponse.json({ error: 'authentication_required' }, { status: 401 })
  }
  const access = getOpportunityDataAccessContext(authorization)
  if (!access || access.authMode !== 'auth_v2' || access.workspaceId == null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const { integrationReference } = await context.params

  try {
    const result = await rotateCrmCredential({
      workspaceId: access.workspaceId,
      actorUserId: access.actorUserId,
      integrationReference,
    })
    if (!result) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    logEvent('opportunity_crm.credential_rotated', {
      workspaceId: access.workspaceId,
      credentialsRotated: 1,
    })
    return NextResponse.json(result, {
      status: 201,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    if (error instanceof CrmIntegrationAccessError) {
      return NextResponse.json({ error: error.code }, { status: 403 })
    }
    logError('opportunity_crm.credential_rotate_failed', error, {
      workspaceId: access.workspaceId,
    })
    return NextResponse.json({ error: 'crm_credential_rotation_failed' }, {
      status: 500,
    })
  }
}
