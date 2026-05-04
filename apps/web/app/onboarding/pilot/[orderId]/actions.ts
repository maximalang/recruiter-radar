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

export async function confirmPilotProfileAction(formData: FormData) {
  await confirmPilotOrderProfile({
    orderId: readRequiredText(formData, "orderId"),
    agencyName: readRequiredText(formData, "agencyName"),
    targetCity: readOptionalText(formData, "targetCity"),
    specialization: readOptionalText(formData, "specialization"),
    includeKeywords: readOptionalStringList(formData, "includeKeywords"),
    excludeKeywords: readOptionalStringList(formData, "excludeKeywords"),
    dailyDigestLimit: readOptionalNumber(formData, "dailyDigestLimit")
  });
}

export async function sendPilotTestDigestAction(formData: FormData) {
  await sendPilotOrderTestDigest(readRequiredText(formData, "orderId"));
}

export async function completePilotOnboardingAction(formData: FormData) {
  await completePilotOrderOnboarding(readRequiredText(formData, "orderId"));
}
