"use server";

import {
  completePilotOrderOnboarding,
  confirmPilotOrderProfile,
  sendPilotOrderTestDigest
} from "../../../../lib/payments";

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

function readOptionalNumber(formData: FormData, key: string): number | null {
  const value = formData.get(key);

  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function confirmPilotProfileAction(expectedOrderId: string, formData: FormData) {
  const formOrderId = readRequiredText(formData, "orderId");

  if (formOrderId !== expectedOrderId) {
    throw new Error("Order mismatch.");
  }

  await confirmPilotOrderProfile({
    orderId: expectedOrderId,
    agencyName: readRequiredText(formData, "agencyName"),
    targetCity: readOptionalText(formData, "targetCity"),
    specialization: readOptionalText(formData, "specialization"),
    includeKeywords: readOptionalStringList(formData, "includeKeywords"),
    excludeKeywords: readOptionalStringList(formData, "excludeKeywords"),
    dailyDigestLimit: readOptionalNumber(formData, "dailyDigestLimit")
  });
}

export async function sendPilotTestDigestAction(expectedOrderId: string, formData: FormData) {
  const formOrderId = readRequiredText(formData, "orderId");

  if (formOrderId !== expectedOrderId) {
    throw new Error("Order mismatch.");
  }

  await sendPilotOrderTestDigest(expectedOrderId);
}

export async function completePilotOnboardingAction(expectedOrderId: string, formData: FormData) {
  const formOrderId = readRequiredText(formData, "orderId");

  if (formOrderId !== expectedOrderId) {
    throw new Error("Order mismatch.");
  }

  await completePilotOrderOnboarding(expectedOrderId);
}
