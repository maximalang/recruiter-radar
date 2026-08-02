import { getSession } from '@/lib/auth-v2/authorization'
import { logEvent } from '@/lib/runtime'
import {
  hasWorkspacePermission,
  WORKSPACE_PERMISSIONS,
  type WorkspacePermission,
  type WorkspaceRole,
} from '@/lib/auth-v2/workspaces'
import { isOpportunityWorkspaceContextEnabledForContext } from './config'

export interface OpportunityAuthorizationContext {
  dataOwnerId: string
  workspaceId: string | null
  actorUserId: string
  actorRole: WorkspaceRole | null
  permissions: readonly WorkspacePermission[]
  authMode: 'auth_v2' | 'auth_v2_compat' | 'legacy'
}

export interface OpportunityDataAccessContext {
  ownerId: string
  workspaceId: string | null
  actorUserId: string
  actorWorkspaceId: string | null
  actorRoleSnapshot: WorkspaceRole | null
  authMode: 'auth_v2' | 'legacy'
}

export async function getOpportunityAuthorizationContext(
  permission: WorkspacePermission,
): Promise<OpportunityAuthorizationContext | null> {
  const authorization = await getSession({ permission })
  if (!authorization) {
    logEvent('opportunity.authorization_rejected', { permission })
    return null
  }
  const role = authorization.role

  return {
    dataOwnerId: authorization.dataOwnerId,
    workspaceId: authorization.workspaceId,
    actorUserId: authorization.userId,
    actorRole: role,
    permissions: role
      ? WORKSPACE_PERMISSIONS.filter((candidate) =>
          hasWorkspacePermission(role, candidate),
        )
      : WORKSPACE_PERMISSIONS,
    authMode: authorization.mode,
  }
}

export function getOpportunityDataAccessContext(
  context: OpportunityAuthorizationContext,
  env: Readonly<Record<string, string | undefined>> = process.env,
): OpportunityDataAccessContext | null {
  if (!isOpportunityWorkspaceContextEnabledForContext(context, env)) {
    return {
      ownerId: context.dataOwnerId,
      workspaceId: null,
      actorUserId: context.dataOwnerId,
      actorWorkspaceId: null,
      actorRoleSnapshot: null,
      authMode: 'legacy',
    }
  }

  if (
    context.authMode !== 'auth_v2' ||
    context.workspaceId == null ||
    context.actorRole == null
  ) {
    return null
  }

  return {
    ownerId: context.dataOwnerId,
    workspaceId: context.workspaceId,
    actorUserId: context.actorUserId,
    actorWorkspaceId: context.workspaceId,
    actorRoleSnapshot: context.actorRole,
    authMode: 'auth_v2',
  }
}
