"use server";

import { revalidatePath } from "next/cache";

import {
  getClientProfileByOwnerId,
  saveClientProfile,
  VALID_INDUSTRIES,
  VALID_COMPANY_SIZES,
  VALID_ROLES,
  normalizeContactPolicy,
} from "../../../lib/clientProfiles";
import { saveDeliveryPreferencesByOwnerId } from "../../../lib/deliveryPreferences";
import { readOwnerSession } from "../../../lib/session";

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
  if (typeof value !== "string") return [];
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function readCheckboxGroup(formData: FormData, key: string, allowed: ReadonlySet<string>): string[] {
  return formData
    .getAll(key)
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v !== "" && allowed.has(v));
}

function readOptionalNumber(formData: FormData, key: string): number | null {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type SaveProfileResult = { ok: true } | { ok: false; error: string };

/**
 * Persist edits from the /settings/profile page.
 *
 * Anti-IDOR boundary: the target profile is resolved ONLY from the authenticated
 * session owner via getClientProfileByOwnerId. No profileId is ever read from the
 * form, so a forged id cannot redirect the write to someone else's profile. The
 * saved id is the one we just loaded under owner scope.
 */
export async function saveSettingsProfileAction(
  _prev: SaveProfileResult | null,
  formData: FormData
): Promise<SaveProfileResult> {
  const ownerId = await readOwnerSession();
  if (!ownerId) {
    return { ok: false, error: "Требуется вход в аккаунт." };
  }

  const existing = await getClientProfileByOwnerId(ownerId);
  if (!existing) {
    return { ok: false, error: "Профиль не найден. Сначала активируйте пилот." };
  }

  try {
    await saveClientProfile({
      id: existing.id,
      agencyName: readRequiredText(formData, "agencyName"),
      // Preserve the linked Telegram chat — it is managed elsewhere, not on this page.
      telegramChatId: existing.telegramChatId,
      targetCity: readOptionalText(formData, "targetCity"),
      specialization: readOptionalText(formData, "specialization"),
      includeKeywords: readOptionalStringList(formData, "includeKeywords"),
      excludeKeywords: readOptionalStringList(formData, "excludeKeywords"),
      industries: readCheckboxGroup(formData, "industries", VALID_INDUSTRIES),
      companySizes: readCheckboxGroup(formData, "companySizes", VALID_COMPANY_SIZES),
      dailyDigestLimit: readOptionalNumber(formData, "dailyDigestLimit"),
      isActive: existing.isActive,
      contactPolicy: normalizeContactPolicy(formData.get("contactPolicy")),
      roles: readCheckboxGroup(formData, "roles", VALID_ROLES),
      excludedIndustries: readCheckboxGroup(formData, "excludedIndustries", VALID_INDUSTRIES),
      excludedLocations: readOptionalStringList(formData, "excludedLocations"),
      remoteFriendly: formData.get("remoteFriendly") === "on",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Не удалось сохранить профиль.";
    return { ok: false, error: message };
  }

  revalidatePath("/settings/profile");
  return { ok: true };
}

export type SaveDeliveryResult = { ok: true } | { ok: false; error: string };

/**
 * Persist delivery-channel preferences (web-push + email digest) from the
 * /settings/profile page.
 *
 * Anti-IDOR boundary: writes are scoped to the authenticated session owner via
 * saveDeliveryPreferencesByOwnerId — no profileId is read from the form. Channel
 * invariants (email requires a valid address) are enforced in the repository and
 * surfaced here as Russian copy.
 */
export async function saveDeliveryPreferencesAction(
  _prev: SaveDeliveryResult | null,
  formData: FormData
): Promise<SaveDeliveryResult> {
  const ownerId = await readOwnerSession();
  if (!ownerId) {
    return { ok: false, error: "Требуется вход в аккаунт." };
  }

  const result = await saveDeliveryPreferencesByOwnerId({
    ownerId,
    webPushEnabled: formData.get("webPushEnabled") === "on",
    emailDigestEnabled: formData.get("emailDigestEnabled") === "on",
    digestEmail: readOptionalText(formData, "digestEmail"),
  });

  if (!result.ok) {
    const message =
      result.reason === "invalid_email"
        ? "Укажите корректный email."
        : result.reason === "email_required"
          ? "Чтобы включить email-дайджест, укажите адрес."
          : result.reason === "not_found"
            ? "Профиль не найден. Сначала активируйте пилот."
            : "Не удалось сохранить настройки доставки.";
    return { ok: false, error: message };
  }

  revalidatePath("/settings/profile");
  return { ok: true };
}
