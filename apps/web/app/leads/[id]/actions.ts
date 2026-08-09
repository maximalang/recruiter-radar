"use server";

import { updateLeadFeedback } from "@/lib/leads-data";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/auth-v2/authorization";
import { hasFeatureAccess } from "@/lib/entitlements";

/**
 * Verify the current session owns the given client profile.
 *
 * Checks that:
 * 1. The profile exists and is active
 * 2. The session ownerId matches the profile's owner_id
 *
 * Returns true if access is granted, false otherwise.
 */
async function verifyProfileOwnership(
  clientProfileId: string,
  ownerId: string,
  workspaceId: string,
): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;

  const result = await pool.query<{ ok: boolean }>(
    `SELECT 1 AS ok FROM client_profiles
     WHERE id = $1
       AND owner_id = $2
       AND workspace_id = $3
       AND is_active = true
     LIMIT 1`,
    [clientProfileId, ownerId, workspaceId],
  );
  return result.rowCount === 1;
}

export async function updateLeadFeedbackAction(
  orgId: string,
  clientProfileId: string,
  feedbackStatus: string,
  feedbackNote?: string | null,
) {
  const authorization = await getSession({ permission: "leads:write" });
  if (!authorization?.workspaceId) {
    throw new Error("Access denied: active session required.");
  }
  const ownerId = authorization.dataOwnerId;

  const hasDashboardAccess = await hasFeatureAccess(ownerId, "dashboard", {
    workspaceId: authorization.workspaceId,
  }).catch(() => false);
  if (!hasDashboardAccess) {
    throw new Error("Access denied: active dashboard entitlement required.");
  }

  const isOwner = await verifyProfileOwnership(clientProfileId, ownerId, authorization.workspaceId);
  if (!isOwner) {
    throw new Error("Access denied: ownership check failed for this client profile.");
  }

  const result = await updateLeadFeedback({
    orgId,
    clientProfileId,
    feedbackStatus,
    feedbackNote,
  });

  if (!result.ok) {
    throw new Error(result.error);
  }

  return result.data;
}

