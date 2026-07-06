"use server";

import { updateLeadFeedback } from "@/lib/leads-data";
import { getPool } from "@/lib/db";
import { getOwnerIdFromSession } from "@/lib/session";

/**
 * Verify the current session owns the given client profile.
 *
 * Checks that:
 * 1. The profile exists and is active
 * 2. The session ownerId matches the profile's owner_id
 *    OR the profile has no owner_id (pilot/anonymous — allowed for now)
 *
 * Returns true if access is granted, false otherwise.
 */
async function verifyProfileOwnership(clientProfileId: string): Promise<boolean> {
  const ownerId = await getOwnerIdFromSession();
  // No session → deny
  if (!ownerId) return false;

  const pool = getPool();
  if (!pool) return false;

  // Allow access if:
  // - profile has owner_id matching session ownerId, OR
  // - profile has no owner_id (pilot/anonymous — not yet claimed)
  const result = await pool.query<{ ok: boolean }>(
    `SELECT 1 AS ok FROM client_profiles
     WHERE id = $1
       AND (owner_id = $2 OR owner_id IS NULL)
       AND is_active = true
     LIMIT 1`,
    [clientProfileId, ownerId],
  );
  return result.rowCount === 1;
}

export async function updateLeadFeedbackAction(
  orgId: string,
  clientProfileId: string,
  feedbackStatus: string,
  feedbackNote?: string | null,
) {
  const isOwner = await verifyProfileOwnership(clientProfileId);
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

