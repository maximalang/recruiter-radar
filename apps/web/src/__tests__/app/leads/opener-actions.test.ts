/**
 * D3 opener-draft server-action tests — the full lead → draft → confirm flow
 * with mocked auth and model (CI-safe), plus the authorization boundary.
 *
 * Contract under test:
 *   - generate: session(leads:write) + dashboard entitlement + owner-scoped
 *     lead read + profile-ownership re-check + per-org quota → ONE provider
 *     call → a persisted StoredOpenerDraft (status 'draft').
 *   - confirm: ONLY flips status/confirmedAt — the model is never called again
 *     and no network/send path exists in the action layer.
 *   - edits after confirm reset the confirmation (status → 'draft').
 *   - contactPolicy is taken from the owning client profile and passed to the
 *     prompt input (corporate_only is the fail-safe default).
 *   - every access failure fails closed before any provider/store call.
 */

import { getSession } from "@/lib/auth-v2/authorization";
import { hasFeatureAccess } from "@/lib/entitlements";
import { getLeadDetail } from "@/lib/leads-data";
import { getClientProfileById } from "@/lib/clientProfiles";
import { getPool } from "@/lib/db-pool";
import { draftOpener } from "@/lib/ai/opener/openerDraftProvider";
import { tryConsumeOpenerDraftQuota } from "@/lib/ai/opener/openerDraftRateLimit";
import {
  confirmOpenerDraftAction,
  generateOpenerDraftAction,
  saveOpenerDraftEditsAction,
} from "@/app/leads/[id]/opener-actions";
import type { StoredOpenerDraft } from "@/lib/ai/opener/openerDraftStore";

jest.mock("@/lib/db-pool", () => ({ getPool: jest.fn() }));
jest.mock("@/lib/auth-v2/authorization", () => ({ getSession: jest.fn() }));
jest.mock("@/lib/entitlements", () => ({ hasFeatureAccess: jest.fn() }));
jest.mock("@/lib/leads-data", () => ({ getLeadDetail: jest.fn() }));
jest.mock("@/lib/clientProfiles", () => ({ getClientProfileById: jest.fn() }));
jest.mock("@/lib/ai/opener/openerDraftProvider", () => ({
  draftOpener: jest.fn(),
  MAX_OPENER_DRAFT_CHARS: 450,
}));
jest.mock("@/lib/ai/opener/openerDraftRateLimit", () => ({
  tryConsumeOpenerDraftQuota: jest.fn(),
}));
jest.mock("@/lib/runtime", () => ({ logEvent: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const mockGetSession = jest.mocked(getSession);
const mockHasFeatureAccess = jest.mocked(hasFeatureAccess);
const mockGetLeadDetail = jest.mocked(getLeadDetail);
const mockGetClientProfileById = jest.mocked(getClientProfileById);
const mockGetPool = jest.mocked(getPool);
const mockDraftOpener = jest.mocked(draftOpener);
const mockQuota = jest.mocked(tryConsumeOpenerDraftQuota);

const GENERATED_TEXT = "Здравствуйте! По ООО Ромашка видно, что идёт активный найм. Предлагаю короткий созвон на 10-15 минут.";

const leadFixture = {
  id: "55",
  orgId: "9",
  clientProfileId: "7",
  orgName: "ООО Ромашка",
  reasons: ["У компании несколько активных вакансий одновременно"],
  evidenceTitles: ["Backend-разработчик", "QA-инженер"],
  aiEnrichment: null,
};

function generatedEnvelope() {
  return {
    available: true,
    capability: "draft-opener",
    provider: "codexoid",
    confidence: "medium",
    data: {
      draft: GENERATED_TEXT,
      model: "codexoid/test-model",
      traceId: "trace-1",
      promptVersion: "opener-draft-v1",
      tokensUsed: 33,
    },
  } as never;
}

/**
 * SQL-routing pool mock: ownership SELECT, non-RETURNING persist UPDATE,
 * RETURNING lifecycle UPDATEs (edits/confirm) with server-side merge applied
 * in JS so the flow sees realistic round-tripped state.
 */
function installPool(state: { draft: StoredOpenerDraft | null }) {
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    const text = String(sql);
    if (text.includes("FROM client_profiles")) {
      return { rows: [{ ok: true }], rowCount: 1 };
    }
    if (text.includes("UPDATE digest_candidates") && text.includes("$1::jsonb")) {
      state.draft = JSON.parse(String(params?.[0])) as StoredOpenerDraft;
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("UPDATE digest_candidates") && text.includes("RETURNING")) {
      if (!state.draft) return { rows: [], rowCount: 0 };
      if (text.includes("'status', 'confirmed'")) {
        state.draft = { ...state.draft, status: "confirmed", confirmedAt: String(params?.[0]) };
      } else {
        state.draft = {
          ...state.draft,
          currentText: String(params?.[0]),
          status: "draft",
          editedAt: String(params?.[1]),
          confirmedAt: null,
        };
      }
      return { rows: [{ ai_opener_draft: state.draft }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  mockGetPool.mockReturnValue({ query } as never);
  return query;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({ dataOwnerId: "42", workspaceId: "9" } as never);
  mockHasFeatureAccess.mockResolvedValue(true);
  mockGetLeadDetail.mockResolvedValue(leadFixture as never);
  mockGetClientProfileById.mockResolvedValue({ contactPolicy: "corporate_only" } as never);
  mockQuota.mockResolvedValue({ allowed: true });
  mockDraftOpener.mockResolvedValue(generatedEnvelope());
  installPool({ draft: null });
});

describe("generateOpenerDraftAction — lead → draft", () => {
  it("persists an attributed draft from one provider call, owner-scoped", async () => {
    const stored = await generateOpenerDraftAction("55");

    expect(mockGetLeadDetail).toHaveBeenCalledWith({ candidateId: "55", ownerId: "42" });
    expect(mockQuota).toHaveBeenCalledWith("9");
    expect(mockDraftOpener).toHaveBeenCalledTimes(1);
    const [hookInput, callOptions] = mockDraftOpener.mock.calls[0];
    expect(hookInput.orgName).toBe("ООО Ромашка");
    expect(hookInput.reasons).toEqual(leadFixture.reasons);
    expect(hookInput.contactPolicy).toBe("corporate_only");
    expect(Array.isArray(hookInput.roleNames)).toBe(true);
    expect((callOptions as { orgId?: string }).orgId).toBe("9");

    expect(stored.status).toBe("draft");
    expect(stored.currentText).toBe(GENERATED_TEXT);
    expect(stored.schemaVersion).toBe(1);
    expect(stored.provider).toBe("codexoid");
    expect(stored.model).toBe("codexoid/test-model");
    expect(stored.promptVersion).toBe("opener-draft-v1");
    expect(stored.traceId).toBe("trace-1");
    expect(stored.editedAt).toBeNull();
    expect(stored.confirmedAt).toBeNull();
  });

  it("passes a non-default contactPolicy from the owning profile", async () => {
    mockGetClientProfileById.mockResolvedValue({ contactPolicy: "no_personal" } as never);
    await generateOpenerDraftAction("55");
    expect(mockDraftOpener.mock.calls[0][0].contactPolicy).toBe("no_personal");
  });

  it("fails closed to corporate_only when the profile cannot be read", async () => {
    mockGetClientProfileById.mockRejectedValue(new Error("db down"));
    await generateOpenerDraftAction("55");
    expect(mockDraftOpener.mock.calls[0][0].contactPolicy).toBe("corporate_only");
  });

  it("blocks generation when the per-org quota window is closed (no provider call)", async () => {
    mockQuota.mockResolvedValue({ allowed: false, retryAtMs: Date.now() + 60_000 });
    await expect(generateOpenerDraftAction("55")).rejects.toThrow(/15 минут/);
    expect(mockDraftOpener).not.toHaveBeenCalled();
  });

  it("surfaces a degraded provider as a user-facing error and writes nothing", async () => {
    mockDraftOpener.mockResolvedValue({
      available: false,
      capability: "draft-opener",
      provider: "codexoid",
      confidence: "low",
      data: null,
      note: "llm_not_configured",
    } as never);
    const query = installPool({ draft: null });
    await expect(generateOpenerDraftAction("55")).rejects.toThrow("недоступен");
    const updateCalls = query.mock.calls.filter(([sql]) => String(sql).includes("UPDATE"));
    expect(updateCalls).toHaveLength(0);
  });
});

describe("confirm + edits — manual-send-only lifecycle", () => {
  it("lead → draft → confirm: confirm never calls the model or any send path", async () => {
    await generateOpenerDraftAction("55");
    const confirmed = await confirmOpenerDraftAction("55");

    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmedAt).toBeTruthy();
    expect(confirmed.currentText).toBe(GENERATED_TEXT);
    // Exactly one model call for the whole flow (the generation); confirmation
    // is a pure state flip, and the action layer performs no fetch at all.
    expect(mockDraftOpener).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("editing after confirmation resets status → draft and confirmedAt → null", async () => {
    await generateOpenerDraftAction("55");
    await confirmOpenerDraftAction("55");

    const edited = await saveOpenerDraftEditsAction("55", "Отредактированный текст");
    expect(edited.status).toBe("draft");
    expect(edited.confirmedAt).toBeNull();
    expect(edited.currentText).toBe("Отредактированный текст");
    expect(edited.editedAt).toBeTruthy();
    // The original AI text is preserved for attribution.
    expect(edited.draft).toBe(GENERATED_TEXT);
  });

  it("rejects empty and over-long edits before touching the store", async () => {
    await generateOpenerDraftAction("55");
    await expect(saveOpenerDraftEditsAction("55", "   ")).rejects.toThrow("не может быть пустым");
    await expect(saveOpenerDraftEditsAction("55", "x".repeat(451))).rejects.toThrow(/450/);
  });

  it("edits/confirm without a generated draft fail with a clear error", async () => {
    await expect(saveOpenerDraftEditsAction("55", "текст")).rejects.toThrow("Черновик не найден");
    await expect(confirmOpenerDraftAction("55")).rejects.toThrow("Черновик не найден");
  });
});

describe("authorization boundary (fails closed before any AI/store work)", () => {
  it("denies without an active session", async () => {
    mockGetSession.mockResolvedValue(null);
    await expect(generateOpenerDraftAction("55")).rejects.toThrow("active session required");
    expect(mockDraftOpener).not.toHaveBeenCalled();
  });

  it("denies without the dashboard entitlement", async () => {
    mockHasFeatureAccess.mockResolvedValue(false);
    await expect(generateOpenerDraftAction("55")).rejects.toThrow("dashboard entitlement");
    expect(mockHasFeatureAccess).toHaveBeenCalledWith("42", "dashboard", { workspaceId: "9" });
    expect(mockDraftOpener).not.toHaveBeenCalled();
  });

  it("denies a lead that is not owned by the session owner", async () => {
    mockGetLeadDetail.mockResolvedValue(null);
    await expect(confirmOpenerDraftAction("55")).rejects.toThrow("lead not found for this owner");
    await expect(saveOpenerDraftEditsAction("55", "текст")).rejects.toThrow("lead not found for this owner");
    await expect(generateOpenerDraftAction("55")).rejects.toThrow("lead not found for this owner");
    expect(mockDraftOpener).not.toHaveBeenCalled();
  });

  it("denies when the profile↔workspace ownership check fails", async () => {
    const query = jest.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [], rowCount: 0 }));
    mockGetPool.mockReturnValue({ query } as never);
    await expect(generateOpenerDraftAction("55")).rejects.toThrow("ownership check failed");
    expect(query.mock.calls[0][1]).toEqual(["7", "42", "9"]);
    expect(mockDraftOpener).not.toHaveBeenCalled();
  });
});
