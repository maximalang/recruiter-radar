"use server";

import {
  completePilotOrderOnboarding,
  confirmPilotOrderProfile,
  sendPilotOrderTestDigest
} from "../../../../lib/payments";
import { VALID_INDUSTRIES, VALID_COMPANY_SIZES } from "../../../../lib/clientProfiles";
import { readOwnerSession } from "../../../../lib/session";

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

async function requireOwnerId(): Promise<string> {
  const ownerId = await readOwnerSession();
  if (!ownerId) throw new Error("Owner identification is required.");
  return ownerId;
}

export async function confirmPilotProfileAction(expectedOrderId: string, formData: FormData) {
  const formOrderId = readRequiredText(formData, "orderId");

  if (formOrderId !== expectedOrderId) {
    throw new Error("Order mismatch.");
  }

  const ownerId = await requireOwnerId();

  await confirmPilotOrderProfile({
    orderId: expectedOrderId,
    agencyName: readRequiredText(formData, "agencyName"),
    targetCity: readOptionalText(formData, "targetCity"),
    specialization: readOptionalText(formData, "specialization"),
    includeKeywords: readOptionalStringList(formData, "includeKeywords"),
    excludeKeywords: readOptionalStringList(formData, "excludeKeywords"),
    industries: readCheckboxGroup(formData, "industries", VALID_INDUSTRIES),
    companySizes: readCheckboxGroup(formData, "companySizes", VALID_COMPANY_SIZES),
    dailyDigestLimit: readOptionalNumber(formData, "dailyDigestLimit"),
    ownerId
  });
}

export async function sendPilotTestDigestAction(expectedOrderId: string, formData: FormData) {
  const formOrderId = readRequiredText(formData, "orderId");

  if (formOrderId !== expectedOrderId) {
    throw new Error("Order mismatch.");
  }

  const ownerId = await requireOwnerId();

  await sendPilotOrderTestDigest(expectedOrderId, { ownerId });
}

export async function completePilotOnboardingAction(expectedOrderId: string, formData: FormData) {
  const formOrderId = readRequiredText(formData, "orderId");

  if (formOrderId !== expectedOrderId) {
    throw new Error("Order mismatch.");
  }

  const ownerId = await requireOwnerId();

  await completePilotOrderOnboarding(expectedOrderId, { ownerId });
}
