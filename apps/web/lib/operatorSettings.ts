/**
 * Operator-managed runtime settings — the DB-backed layer that lets the
 * operator change the LLM provider (API key + base URL + model) from the admin
 * panel WITHOUT a redeploy or an env edit.
 *
 * Precedence (highest first): operator DB override → env (the existing default).
 * A fresh DB with no rows behaves exactly as before, so this is additive and
 * cannot regress the current env-only path.
 *
 * WHY an in-memory cache: llm-config.ts resolvers (`resolveLlmApiKey` etc.) are
 * SYNCHRONOUS and called from many sites, including the Firecrawl provider init
 * in enrichRunCandidates. Making them async would cascade through every caller.
 * Instead the overrides are loaded once into a module-level cache (the first
 * time a resolver needs them, or explicitly via `refreshLlmSettingsOverrides`)
 * and reloaded whenever the operator writes a setting. The cache is per-process;
 * in the single-web-worker prod deploy that is sufficient, and the write path
 * reloads it so the change takes effect on the next resolver call without a
 * restart.
 *
 * SECRET HANDLING: rows with `is_secret = true` (the LLM API key) are masked in
 * every read surface — `getOperatorSettingsForDisplay` returns a masked tail,
 * never the full value. The full value is read ONLY by the llm-config resolver
 * (in-process) and by the write path. This mirrors llm-config.ts, which already
 * keeps the key out of `resolveLlmProviderConfig()` so it never reaches logs.
 *
 * See migration 20260715120000_add_operator_settings.sql for the table + the
 * closed-set key constraint (only llm_api_key / llm_base_url / llm_model today).
 */

import { getPool } from './db-pool';

/** The operator-settable LLM keys, mirrored from the migration's CHECK. */
export const LLM_SETTING_KEYS = ['llm_api_key', 'llm_base_url', 'llm_model'] as const;
export type LlmSettingKey = (typeof LLM_SETTING_KEYS)[number];

/** Which keys are secrets (masked in display). */
const SECRET_KEYS = new Set<string>(['llm_api_key']);

/** A raw setting row as stored. */
export interface OperatorSettingRow {
  key: string;
  value: string;
  isSecret: boolean;
  updatedAt: string;
}

/** A setting as shown to the admin UI — secret values are masked. */
export interface OperatorSettingView {
  key: string;
  /** Masked for secrets; full value for non-secrets. */
  value: string;
  isSecret: boolean;
  /** True when a value is stored (false = unset, env default applies). */
  isSet: boolean;
  updatedAt: string;
}

// ─── In-memory override cache (read by llm-config resolvers) ─────────────────

interface LlmOverrides {
  apiKey: string | null;
  baseUrl: string | null;
  model: string | null;
}

let cachedOverrides: LlmOverrides | null = null;
let loadingPromise: Promise<LlmOverrides> | null = null;

/** The empty-state: no DB overrides, so env is the sole source. */
const EMPTY_OVERRIDES: LlmOverrides = { apiKey: null, baseUrl: null, model: null };

/**
 * Read the current LLM overrides (DB-stored, env-independent). Async because it
 * hits the DB; callers that need a synchronous value use the cache populated by
 * `ensureLlmOverridesLoaded`. Returns all-null when no pool / no rows / error —
 * env stays the fallback, so a failure here never breaks the app.
 */
export async function loadLlmSettingsOverrides(): Promise<LlmOverrides> {
  const pool = getPool();
  if (!pool) return EMPTY_OVERRIDES;

  try {
    const { rows } = await pool.query<{ key: string; value: string }>(
      `SELECT key, value FROM operator_settings WHERE key = ANY($1::text[])`,
      [[...LLM_SETTING_KEYS]],
    );
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    return {
      apiKey: byKey.get('llm_api_key') ?? null,
      baseUrl: byKey.get('llm_base_url') ?? null,
      model: byKey.get('llm_model') ?? null,
    };
  } catch {
    // Any DB error → fall back to env-only (the historical default). Never throw.
    return EMPTY_OVERRIDES;
  }
}

/**
 * Ensure the in-memory override cache is populated (idempotent; concurrent
 * callers share one load). Safe to call repeatedly — returns the cached value
 * once loaded. llm-config resolvers call this lazily, but the admin write path
 * and the app boot can prime it eagerly.
 */
export async function ensureLlmOverridesLoaded(): Promise<LlmOverrides> {
  if (cachedOverrides) return cachedOverrides;
  if (loadingPromise) return loadingPromise;
  loadingPromise = loadLlmSettingsOverrides().then((o) => {
    cachedOverrides = o;
    loadingPromise = null;
    return o;
  });
  return loadingPromise;
}

/**
 * Force a reload of the override cache. Called by `setOperatorSetting` after a
 * write so the new value is visible to the synchronous resolvers on the next
 * call, without a process restart.
 */
export async function refreshLlmSettingsOverrides(): Promise<LlmOverrides> {
  cachedOverrides = null;
  return ensureLlmOverridesLoaded();
}

/**
 * Synchronous access to the cached overrides. Returns the empty state when the
 * cache has not been loaded yet — the llm-config resolvers then fall through to
 * env, which is the pre-feature behavior. This keeps resolvers synchronous AND
 * correct once the cache is primed (it is primed on first resolver use or at
 * boot by `ensureLlmOverridesLoaded`).
 */
export function getCachedLlmOverrides(): LlmOverrides {
  return cachedOverrides ?? EMPTY_OVERRIDES;
}

/** Test-only: reset the cache between tests. */
export function __resetLlmOverridesCacheForTests(): void {
  cachedOverrides = null;
  loadingPromise = null;
}

// ─── Read / write ────────────────────────────────────────────────────────────

/** Read a single setting's raw value (full, including secrets). In-process only. */
export async function getOperatorSetting(key: string): Promise<string | null> {
  const pool = getPool();
  if (!pool) return null;
  try {
    const { rows } = await pool.query<{ value: string }>(
      `SELECT value FROM operator_settings WHERE key = $1`,
      [key],
    );
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Read ALL settings for the admin display surface. Secret values are MASKED —
 * the full value never leaves this function for a secret row. Returns each known
 * key (even when unset, so the form shows the current effective env default).
 */
export async function getOperatorSettingsForDisplay(): Promise<OperatorSettingView[]> {
  const pool = getPool();
  const stored = new Map<string, OperatorSettingRow>();
  if (pool) {
    try {
      const { rows } = await pool.query<{ key: string; value: string; is_secret: boolean; updated_at: string }>(
        `SELECT key, value, is_secret, updated_at::TEXT AS updated_at FROM operator_settings`,
      );
      for (const r of rows) {
        stored.set(r.key, { key: r.key, value: r.value, isSecret: r.is_secret, updatedAt: r.updated_at });
      }
    } catch {
      // Fall through — return unset views so the panel still renders.
    }
  }

  return LLM_SETTING_KEYS.map((key) => {
    const row = stored.get(key);
    const isSecret = SECRET_KEYS.has(key);
    return {
      key,
      value: row ? (isSecret ? maskSecret(row.value) : row.value) : '',
      isSecret,
      isSet: Boolean(row),
      updatedAt: row?.updatedAt ?? '',
    };
  });
}

/**
 * Write (upsert) a setting. After a successful write, reloads the in-memory
 * override cache so the new value is live. Throws on DB error so the admin
 * action can surface the failure (the read path degrades; the write path must
 * be honest).
 */
export async function setOperatorSetting(key: string, value: string): Promise<void> {
  if (!LLM_SETTING_KEYS.includes(key as LlmSettingKey)) {
    throw new Error(`Unknown operator setting key: ${key}`);
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new Error('Значение не может быть пустым. Используйте «сбросить», чтобы вернуть значение из env.');
  }
  const pool = getPool();
  if (!pool) throw new Error('База данных недоступна.');

  const isSecret = SECRET_KEYS.has(key);
  await pool.query(
    `INSERT INTO operator_settings (key, value, is_secret, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           is_secret = EXCLUDED.is_secret,
           updated_at = NOW()`,
    [key, trimmed, isSecret],
  );

  // Make the new value visible to the synchronous resolvers immediately.
  await refreshLlmSettingsOverrides();
}

/** Remove a setting (clear the override → env default applies again). */
export async function clearOperatorSetting(key: string): Promise<void> {
  if (!LLM_SETTING_KEYS.includes(key as LlmSettingKey)) {
    throw new Error(`Unknown operator setting key: ${key}`);
  }
  const pool = getPool();
  if (!pool) throw new Error('База данных недоступна.');

  await pool.query(`DELETE FROM operator_settings WHERE key = $1`, [key]);
  await refreshLlmSettingsOverrides();
}

// ─── Secret masking ──────────────────────────────────────────────────────────

/**
 * Mask a secret for display: show only the last 4 chars, prefix with ••••.
 * Short secrets are fully masked. NEVER returns the full value.
 */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return `••••${value.slice(-4)}`;
}

/** True when a candidate value matches the stored secret (for "unchanged" skip). */
export function secretUnchanged(candidate: string, stored: string | null): boolean {
  if (!stored) return false;
  return candidate === stored;
}
