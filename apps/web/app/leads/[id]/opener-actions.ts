"use server";

/**
 * D3 draft-opener server actions — lead → draft → confirm, manual send only.
 *
 * Three actions, all behind the canonical lead-write authorization used by
 * ./actions.ts (session with leads:write + dashboard entitlement + profile
 * ownership + owner-scoped candidate read):
 *
 *   generateOpenerDraftAction  — quota-gated single LLM call via the standard
 *                                provider seam; persists an attributed draft.
 *   saveOpenerDraftEditsAction — persists operator edits; editing after
 *                                confirmation RESETS the confirmation.
 *   confirmOpenerDraftAction   — flips status to 'confirmed' + stamps the
 *                                confirmation time. It NEVER sends anything:
 *                                the only "send" in the product is a manual
 *                                clipboard copy in the UI (auto-send is a hard
 *                                boundary.ts prohibition).
 *
 * Nothing here touches score/gate/evidence columns; the store writes only
 * digest_candidates.ai_opener_draft.
 */

import { getPool } from "@/lib/db-pool";
import { getSession } from "@/lib/auth-v2/authorization";
import { hasFeatureAccess } from "@/lib/entitlements";
import { getLeadDetail, type LeadDetail } from "@/lib/leads-data";
import { getClientProfileById } from "@/lib/clientProfiles";
import { deriveRoleNames } from "@/lib/leads/lead-quality";
import { draftOpener, MAX_OPENER_DRAFT_CHARS } from "@/lib/ai/opener/openerDraftProvider";
import { tryConsumeOpenerDraftQuota } from "@/lib/ai/opener/openerDraftRateLimit";
import {
  applyOpenerDraftConfirmation,
  applyOpenerDraftEdits,
  persistGeneratedOpenerDraft,
  toStoredOpenerDraft,
  type StoredOpenerDraft,
} from "@/lib/ai/opener/openerDraftStore";

/**
 * Verify the current session owns the given client profile — the same
 * ownership/activeness check ./actions.ts performs for lead feedback (kept
 * verbatim so the D3 actions cannot drift from the canonical boundary).
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

/** Session + dashboard entitlement gate (mirrors ./actions.ts). */
async function authorizeLeadWrite(): Promise<{ ownerId: string; workspaceId: string }> {
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
  return { ownerId, workspaceId: authorization.workspaceId };
}

/**
 * Owner-scoped candidate check: getLeadDetail returns the lead ONLY when its
 * client profile is owned by the session owner (cp.owner_id predicate), so a
 * foreign candidate id yields null and never reaches the AI/store layers.
 * Also re-verifies the profile↔workspace binding like the canonical action.
 */
async function loadOwnedLead(
  candidateId: string,
  ownerId: string,
  workspaceId: string,
): Promise<LeadDetail> {
  const lead = await getLeadDetail({ candidateId, ownerId });
  if (!lead) {
    throw new Error("Access denied: lead not found for this owner.");
  }
  const isOwner = await verifyProfileOwnership(lead.clientProfileId, ownerId, workspaceId);
  if (!isOwner) {
    throw new Error("Access denied: ownership check failed for this client profile.");
  }
  return lead;
}

/**
 * Generate (or regenerate) the AI opener draft for a lead.
 *
 * Order: authorize → owner-scoped lead read → contactPolicy from the owning
 * profile → per-org quota (cost rule, mirrors enrichment) → ONE provider call
 * → persist to ai_opener_draft only. A failed generation still consumes the
 * quota window (same trade-off as the enrichment cost guard: bounded spend
 * beats retry loops).
 */
export async function generateOpenerDraftAction(
  candidateId: string,
): Promise<StoredOpenerDraft> {
  const { ownerId, workspaceId } = await authorizeLeadWrite();
  const lead = await loadOwnedLead(candidateId, ownerId, workspaceId);

  const profile = await getClientProfileById(lead.clientProfileId, ownerId).catch(() => null);
  const contactPolicy =
    profile?.contactPolicy === "no_personal" || profile?.contactPolicy === "unrestricted"
      ? profile.contactPolicy
      : "corporate_only";

  const roleNames = deriveRoleNames({
    evidenceTitles: lead.evidenceTitles,
    aiRoleTitles: lead.aiEnrichment?.detectedRoles?.map((role) => role.title) ?? null,
  });

  const quota = await tryConsumeOpenerDraftQuota(String(lead.orgId));
  if (!quota.allowed) {
    throw new Error("Генерация доступна не чаще одного раза в 15 минут на компанию. Попробуйте позже.");
  }

  const result = await draftOpener(
    {
      orgName: lead.orgName,
      reasons: lead.reasons,
      roleNames,
      contactPolicy,
    },
    { orgId: String(lead.orgId) },
  );
  if (!result.available || !result.data) {
    throw new Error("ИИ-черновик сейчас недоступен. Попробуйте позже.");
  }

  const stored = toStoredOpenerDraft({
    draft: result.data.draft,
    provider: result.provider,
    model: result.data.model,
    promptVersion: result.data.promptVersion,
    traceId: result.data.traceId,
  });
  if (!stored) {
    throw new Error("ИИ-черновик сейчас недоступен. Попробуйте позже.");
  }

  const updatedRows = await persistGeneratedOpenerDraft({
    candidateId: lead.id,
    draft: stored,
  });
  if (updatedRows === 0) {
    throw new Error("Не удалось сохранить черновик. Обновите страницу и попробуйте снова.");
  }
  return stored;
}

/**
 * Save an operator edit of the draft text. Editing resets a previous
 * confirmation (status → 'draft') so the copied text always equals the text
 * the human last confirmed.
 */
export async function saveOpenerDraftEditsAction(
  candidateId: string,
  text: string,
): Promise<StoredOpenerDraft> {
  const { ownerId, workspaceId } = await authorizeLeadWrite();
  await loadOwnedLead(candidateId, ownerId, workspaceId);

  if (typeof text !== "string") {
    throw new Error("Некорректный текст черновика.");
  }
  const normalized = text.trim();
  if (normalized.length === 0) {
    throw new Error("Текст черновика не может быть пустым.");
  }
  if (normalized.length > MAX_OPENER_DRAFT_CHARS) {
    throw new Error(`Текст длиннее ${MAX_OPENER_DRAFT_CHARS} символов — сократите черновик.`);
  }

  const updated = await applyOpenerDraftEdits({
    candidateId,
    currentText: normalized,
  });
  if (!updated) {
    throw new Error("Черновик не найден. Сначала сгенерируйте его.");
  }
  return updated;
}

/**
 * Record the human confirmation of the current draft text. Confirmation ONLY
 * flips status/confirmedAt — no provider call, no message leaves the product.
 * The UI exposes a manual clipboard copy for confirmed drafts; sending remains
 * entirely outside the product (boundary.ts `auto-send` prohibition).
 */
export async function confirmOpenerDraftAction(
  candidateId: string,
): Promise<StoredOpenerDraft> {
  const { ownerId, workspaceId } = await authorizeLeadWrite();
  await loadOwnedLead(candidateId, ownerId, workspaceId);

  const updated = await applyOpenerDraftConfirmation({ candidateId });
  if (!updated) {
    throw new Error("Черновик не найден. Сначала сгенерируйте его.");
  }
  return updated;
}
