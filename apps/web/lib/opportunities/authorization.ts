import { getSession } from '@/lib/auth-v2/authorization'
import {
  hasWorkspacePermission,
  WORKSPACE_PERMISSIONS,
  type WorkspacePermission,
  type WorkspaceRole,
} from '@/lib/auth-v2/workspaces'

export interface OpportunityAuthorizationContext {
  dataOwnerId: string
  workspaceId: string | null
  actorUserId: string
  actorRole: WorkspaceRole | null
  permissions: readonly WorkspacePermission[]
  authMode: 'auth_v2' | 'auth_v2_compat' | 'legacy'
}

export async function getOpportunityAuthorizationContext(
  permission: WorkspacePermission,
): Promise<OpportunityAuthorizationContext | null> {
  const authorization = await getSession({ permission })
  if (!authorization) return null
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
