"use server";

import { revalidatePath } from "next/cache";

import { ingestAllPrimarySources, ingestSource, isNoActiveProfiles, type IngestResult } from "@/lib/lead-discovery/source-ingest";
import { writeOperatorSession, clearOperatorSession, readOperatorSession } from "@/lib/operator-auth";

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

