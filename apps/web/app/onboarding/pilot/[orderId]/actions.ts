"use server";

import {
  completePilotOrderOnboarding,
  confirmPilotOrderProfile,
  sendPilotOrderTestDigest
} from "../../../../lib/payments";
import { VALID_INDUSTRIES, VALID_COMPANY_SIZES, VALID_ROLES } from "../../../../lib/clientProfiles";
import {
  buildMarketProfileDraftFromPreset,
  getMarketProfilePresetById,
  resolveMarketProfilePresetId
} from "../../../../lib/marketProfilePresets";
import { getSession } from "../../../../lib/auth-v2/authorization";

function readRequiredText(formData: FormData, key: string): string {
  const value = formData.get(key);

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing ${key}.`);
  }

  return value.trim();
}

function readOptionalText(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function readOptionalStringList(formData: FormData, key: string): string[] {
  const value = formData.get(key);

  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function readCheckboxGroup(formData: FormData, key: string, allowed?: ReadonlySet<string>): string[] {
  const values = formData.getAll(key);

  return values
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v !== "" && (allowed === undefined || allowed.has(v)));
}

function readOptionalNumber(formData: FormData, key: string): number | null {
  const value = formData.get(key);

  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function requireBillingAccess(): Promise<{
  workspaceId: string;
  entitlementOwnerId: string;
}> {
  const session = await getSession({ permission: "billing:manage" });
  if (!session?.workspaceId) throw new Error("Workspace billing access is required.");
  return {
    workspaceId: session.workspaceId,
    entitlementOwnerId: session.dataOwnerId,
  };
}

export async function confirmPilotProfileAction(expectedOrderId: string, formData: FormData) {
  const formOrderId = readRequiredText(formData, "orderId");

  if (formOrderId !== expectedOrderId) {
    throw new Error("Order mismatch.");
  }

  const access = await requireBillingAccess();

  // D2 market-profile preset: the picker submits its canonical id as a radio
  // value. Resolve + validate against the registry (unknown/"custom" → null),
  // then use the preset criteria ONLY as fallbacks for fields the submission
  // left empty — user-entered values always win («критерии можно изменить в
  // любой момент»). remoteFriendly stays pure form truth: an unchecked box is
  // indistinguishable from a deliberate uncheck, so no preset fallback there.
  const marketProfilePreset = resolveMarketProfilePresetId(
    readOptionalText(formData, "marketProfilePreset")
  );
  const preset = marketProfilePreset ? getMarketProfilePresetById(marketProfilePreset) : null;
  const presetDraft = preset ? buildMarketProfileDraftFromPreset(preset) : null;

  const specialization =
    readOptionalText(formData, "specialization") ?? presetDraft?.specialization ?? null;
  const includeKeywords = readOptionalStringList(formData, "includeKeywords");
  const roles = readCheckboxGroup(formData, "roles", VALID_ROLES);
  const industries = readCheckboxGroup(formData, "industries", VALID_INDUSTRIES);

  await confirmPilotOrderProfile({
    orderId: expectedOrderId,
    agencyName: readRequiredText(formData, "agencyName"),
    targetCity: readOptionalText(formData, "targetCity"),
    specialization,
    includeKeywords: includeKeywords.length > 0
      ? includeKeywords
      : presetDraft?.includeKeywords ?? [],
    excludeKeywords: readOptionalStringList(formData, "excludeKeywords"),
    industries: industries.length > 0 ? industries : presetDraft?.industries ?? [],
    companySizes: readCheckboxGroup(formData, "companySizes", VALID_COMPANY_SIZES),
    dailyDigestLimit: readOptionalNumber(formData, "dailyDigestLimit"),
    contactPolicy: readOptionalText(formData, "contactPolicy") as 'corporate_only' | 'no_personal' | 'unrestricted' | null,
    roles: roles.length > 0 ? roles : presetDraft?.roles ?? [],
    excludedIndustries: readCheckboxGroup(formData, "excludedIndustries", VALID_INDUSTRIES),
    excludedLocations: readOptionalStringList(formData, "excludedLocations"),
    remoteFriendly: formData.get("remoteFriendly") === "on",
    marketProfilePreset,
    ...access,
  });
}

export async function sendPilotTestDigestAction(expectedOrderId: string, formData: FormData) {
  const formOrderId = readRequiredText(formData, "orderId");

  if (formOrderId !== expectedOrderId) {
    throw new Error("Order mismatch.");
  }

  const access = await requireBillingAccess();

  await sendPilotOrderTestDigest(expectedOrderId, access);
}

export async function completePilotOnboardingAction(expectedOrderId: string, formData: FormData) {
  const formOrderId = readRequiredText(formData, "orderId");

  if (formOrderId !== expectedOrderId) {
    throw new Error("Order mismatch.");
  }

  const access = await requireBillingAccess();

  await completePilotOrderOnboarding(expectedOrderId, access);
}
