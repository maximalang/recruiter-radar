import { NextResponse } from 'next/server'

import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'
import { isOpportunityCrmBridgeEnabledForContext } from '@/lib/opportunities/config'
import {
  CrmIntegrationAccessError,
  revokeCrmCredential,
} from '@/lib/opportunities/crm-integration-repository'
import { logError, logEvent } from '@/lib/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(
  _request: Request,
  context: {
    params: Promise<{
      integrationReference: string
      credentialReference: string
    }>
  },
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
  const { integrationReference, credentialReference } = await context.params

  try {
    const revoked = await revokeCrmCredential({
      workspaceId: access.workspaceId,
      actorUserId: access.actorUserId,
      integrationReference,
      credentialReference,
    })
    if (!revoked) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    logEvent('opportunity_crm.credential_revoked', {
      workspaceId: access.workspaceId,
      credentialsRevoked: 1,
    })
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof CrmIntegrationAccessError) {
      return NextResponse.json({ error: error.code }, { status: 403 })
    }
    logError('opportunity_crm.credential_revoke_failed', error, {
      workspaceId: access.workspaceId,
    })
    return NextResponse.json({ error: 'crm_credential_revoke_failed' }, {
      status: 500,
    })
  }
}
