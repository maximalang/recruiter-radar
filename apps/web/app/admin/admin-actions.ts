"use server";

import { revalidatePath } from "next/cache";

import { ingestAllPrimarySources, ingestSource, isNoActiveProfiles, type IngestResult } from "@/lib/lead-discovery/source-ingest";
import { writeOperatorSession, clearOperatorSession, readOperatorSession } from "@/lib/operator-auth";
import { setOperatorSetting, clearOperatorSetting, LLM_SETTING_KEYS, type LlmSettingKey } from "@/lib/operatorSettings";
import {
  activatePilotForUser,
  pausePilotForUser,
  setProfileActive,
  clearProfileTelegram,
} from "@/lib/admin/adminUsers";

/**
 * Server actions for the /admin panel.
 *
 * Auth model: loginOperator() verifies the operator password against
 * ADMIN_OPERATOR_PASSWORD (set on the server) and writes a signed session
 * cookie (rr_op). Mutating actions (runIngest) require an active operator
 * session — the ingest form only renders when a session exists, and we
 * re-check the session inside the action as the auth boundary.
 */

type IngestState = {
  ok: boolean;
  message: string;
  results?: Array<{ source: string; success: boolean; fetched?: number; upserted?: number; error?: string }>;
  summary?: { total: number; succeeded: number; failed: number; fetchedTotal: number; upsertedTotal: number };
};

type LoginState = { ok: boolean; error: string | null };

function constantTimeCompare(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) ?? 0) ^ (b.charCodeAt(i) ?? 0);
  }
  return diff === 0;
}

export async function loginOperator(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  const expected = (process.env.ADMIN_OPERATOR_PASSWORD ?? "").trim();

  if (!expected) {
    return { ok: false, error: "ADMIN_OPERATOR_PASSWORD не задан на сервере." };
  }
  if (!password) {
    return { ok: false, error: "Введите пароль оператора." };
  }

  if (!constantTimeCompare(password, expected)) {
    return { ok: false, error: "Неверный пароль." };
  }

  await writeOperatorSession();
  revalidatePath("/admin");
  return { ok: true, error: null };
}

export async function logoutOperator(): Promise<void> {
  await clearOperatorSession();
  revalidatePath("/admin");
}

export async function runIngest(_prev: IngestState, formData: FormData): Promise<IngestState> {
  // Auth boundary: the mutating ingest action requires an active operator session.
  const hasSession = await readOperatorSession();
  if (!hasSession) {
    return { ok: false, message: "Сессия оператора истекла. Перезайдите в панель." };
  }

  const mode = String(formData.get("mode") ?? "all");
  const single = String(formData.get("source") ?? "").trim();

  try {
    let results: IngestResult[];
    if (mode === "single" && single) {
      results = [await ingestSource(single as never, undefined)];
    } else {
      const all = await ingestAllPrimarySources(undefined);
      if (isNoActiveProfiles(all)) {
        return {
          ok: false,
          message: `Нет активных профилей для инжеста. ${all.hint ?? ""}`.trim(),
        };
      }
      results = all;
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.length - succeeded;
    const fetchedTotal = results.reduce((sum, r) => sum + (r.fetchedCount ?? 0), 0);
    const upsertedTotal = results.reduce((sum, r) => sum + (r.upsertedCount ?? 0), 0);

    return {
      ok: failed === 0,
      message:
        results.length === 0
          ? "Инжест завершился без результатов."
          : `Готово: ${succeeded} успешно, ${failed} с ошибкой. Получено ${fetchedTotal}, записано ${upsertedTotal}.`,
      results: results.map((r) => ({
        source: String(r.source),
        success: r.success,
        fetched: r.fetchedCount,
        upserted: r.upsertedCount,
        error: r.error,
      })),
      summary: { total: results.length, succeeded, failed, fetchedTotal, upsertedTotal },
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Ошибка инжеста.",
    };
  }
}

// ─── LLM provider config (operator-managed, runtime) ────────────────────────

type LlmConfigState = {
  ok: boolean;
  message: string;
};

/**
 * Save one LLM provider setting (key + value) from the admin panel.
 *
 * Auth: requires an active operator session (same boundary as runIngest).
 * The API key is stored in the operator_settings table with is_secret=true and
 * is masked in every read surface; it is never logged. Writing reloads the
 * in-memory override cache (see operatorSettings.refreshLlmSettingsOverrides)
 * so the new provider takes effect on the next resolver call without a restart.
 *
 * SECURITY: the key is validated against the closed set LLM_SETTING_KEYS
 * (enforced in setOperatorSetting AND the DB CHECK constraint), so an arbitrary
 * row cannot be injected to influence the app. Values are trimmed; an empty
 * value is rejected (use clearLlmConfig to revert to env).
 */
export async function saveLlmConfig(_prev: LlmConfigState, formData: FormData): Promise<LlmConfigState> {
  const hasSession = await readOperatorSession();
  if (!hasSession) {
    return { ok: false, message: "Сессия оператора истекла. Перезайдите в панель." };
  }

  const rawKey = String(formData.get("key") ?? "").trim();
  const value = String(formData.get("value") ?? "");
  if (!LLM_SETTING_KEYS.includes(rawKey as LlmSettingKey)) {
    return { ok: false, message: "Неизвестный параметр. Допустимы только llm_api_key, llm_base_url, llm_model." };
  }

  // The API-key field ships a masked placeholder when the operator did not edit
  // it (the form pre-fills "••••xxxx"). Reject a masked/unchanged submission so
  // we never overwrite the real key with mask dots.
  if (rawKey === "llm_api_key" && value.startsWith("••••")) {
    return { ok: false, message: "API-ключ не изменён — введите новое значение или используйте сброс." };
  }

  try {
    await setOperatorSetting(rawKey, value);
    revalidatePath("/admin");
    return { ok: true, message: `Параметр «${rawKey}» сохранён. Провайдер обновлён без редеплоя.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Не удалось сохранить параметр." };
  }
}

/**
 * Clear one LLM setting's override so the env default applies again.
 * Auth: operator session required (same boundary).
 */
export async function clearLlmConfig(_prev: LlmConfigState, formData: FormData): Promise<LlmConfigState> {
  const hasSession = await readOperatorSession();
  if (!hasSession) {
    return { ok: false, message: "Сессия оператора истекла. Перезайдите в панель." };
  }

  const rawKey = String(formData.get("key") ?? "").trim();
  if (!LLM_SETTING_KEYS.includes(rawKey as LlmSettingKey)) {
    return { ok: false, message: "Неизвестный параметр." };
  }

  try {
    await clearOperatorSetting(rawKey);
    revalidatePath("/admin");
    return { ok: true, message: `Параметр «${rawKey}» сброшен. Возвращает значение из env.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Не удалось сбросить параметр." };
  }
}

// ─── User management (operator write-actions) ───────────────────────────────

type UserActionState = { ok: boolean; message: string };

/**
 * Shared guard for the user-management actions: require an active operator
 * session and a valid user id, then delegate to the adminUsers DB layer.
 * Returns the state to render next to the action button.
 */
async function withOperatorSession<T extends UserActionState>(
  formData: FormData,
  run: (userId: string) => Promise<T>,
): Promise<T> {
  const hasSession = await readOperatorSession();
  if (!hasSession) {
    return { ok: false, message: "Сессия оператора истекла. Перезайдите в панель." } as T;
  }
  const userId = String(formData.get("userId") ?? "").trim();
  if (!/^\d+$/.test(userId) || Number(userId) <= 0) {
    return { ok: false, message: "Некорректный id пользователя." } as T;
  }
  try {
    const result = await run(userId);
    revalidatePath("/admin");
    return result;
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Действие не выполнено." } as T;
  }
}

export async function adminActivatePilot(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  return withOperatorSession(formData, (userId) => activatePilotForUser(userId));
}

export async function adminPausePilot(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  return withOperatorSession(formData, (userId) => pausePilotForUser(userId));
}

export async function adminPauseProfile(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  return withOperatorSession(formData, (userId) => setProfileActive(userId, false));
}

export async function adminResumeProfile(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  return withOperatorSession(formData, (userId) => setProfileActive(userId, true));
}

export async function adminClearTelegram(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  return withOperatorSession(formData, (userId) => clearProfileTelegram(userId));
}

