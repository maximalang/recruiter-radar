/**
 * Admin user-management write operations — the functional counterpart to the
 * read-only getOperatorUsers() card.
 *
 * Per operator direction (2026-07-16: "в админке должно быть все понятно и
 * функционально"): the operator must be able to ACT on users from the panel, not
 * just view them. Three safe, auditable write actions:
 *   - activatePilotForUser   — grant/extend canonical 7-day admin access
 *   - pausePilotForUser      — revoke canonical admin access
 *   - setProfileActive       — toggle a client profile's is_active (digest on/off)
 *   - clearProfileTelegram   — unlink a profile's Telegram chat (delivery off)
 *
 * Safety contract (every item load-bearing):
 *   - These run ONLY behind the operator session gate (admin-actions re-checks
 *     readOperatorSession() before calling). This module itself does NO auth — it
 *     is the pure DB layer; the action layer is the boundary.
 *   - All writes are parameterized; userId/profileId are validated as numeric
 *     strings before any query (no injection, no string interpolation into SQL).
 *   - Each write touches ONE clearly-named column / row — it never edits
 *     total_score, confidence_gate, evidence, or billing rows. Admin access is
 *     recorded in entitlement_grants; it does NOT create a paid checkout order.
 *   - Activation is an atomic upsert guarded by the unique active user/source
 *     index, so concurrent operator actions cannot create overlapping grants.
 *   - Best-effort + explicit result: every function returns {ok, message} so the
 *     admin UI shows the outcome; a DB error never crashes the panel.
 */

import { getPool } from '../db-pool';
import { grantEntitlement, grantEntitlementUntil, revokeEntitlement } from '../entitlements';
import { revokeAllAuthSessions } from '../auth-v2/sessions';
import { requestAuthV2Login, shouldRequestAuthV2Login } from '../auth-v2/challenges';
import { requestAccountLogin } from '../account-auth';
import { COMPANY_SIZE_OPTIONS, INDUSTRY_OPTIONS, ROLE_OPTIONS } from '../clientProfileOptions';
import { logEvent, logError } from '../runtime';

/** Pilot duration granted by the admin (matches PILOT_ENTITLEMENT_DAYS = 7). */
const ADMIN_PILOT_DAYS = 7;

export interface AdminActionResult {
  ok: boolean;
  message: string;
}

/** Validate a user/profile id is a positive integer string (anti-injection). */
function isValidId(value: string): boolean {
  return /^\d+$/.test(value) && Number(value) > 0;
}

/** Resolve the canonical data owner for the account's deterministic active workspace. */
export async function resolveAdminDataOwnerId(userId: string, workspaceId?: string): Promise<string | null> {
  if (!isValidId(userId) || (workspaceId !== undefined && !isValidId(workspaceId))) return null;
  const pool = getPool();
  if (!pool) return null;
  const result = await pool.query<{ dataOwnerId: string; workspaceId: string | null; lastSessionAt: string | null }>(
    `SELECT
       COALESCE(workspace.bootstrap_user_id, account.id)::TEXT AS "dataOwnerId",
       workspace.id::TEXT AS "workspaceId",
       workspace."lastSessionAt"
     FROM users AS account
     LEFT JOIN LATERAL (
       SELECT ws.id, ws.bootstrap_user_id, session."lastSessionAt"
       FROM workspace_members AS member
       JOIN workspaces AS ws ON ws.id = member.workspace_id
       LEFT JOIN LATERAL (
         SELECT MAX(last_seen_at)::TEXT AS "lastSessionAt"
         FROM auth_sessions
         WHERE user_id = account.id
           AND workspace_id = ws.id
           AND revoked_at IS NULL
           AND idle_expires_at > NOW()
           AND absolute_expires_at > NOW()
       ) AS session ON TRUE
       WHERE member.user_id = account.id
         AND member.status = 'active'
         AND ws.status = 'active'
         AND ($2::BIGINT IS NULL OR ws.id = $2::BIGINT)
       ORDER BY session."lastSessionAt" DESC NULLS LAST, ws.id
       LIMIT 2
     ) AS workspace ON TRUE
     WHERE account.id = $1
       AND account.status = 'active'
     ORDER BY workspace."lastSessionAt" DESC NULLS LAST, workspace.id
     LIMIT 2`,
    [userId, workspaceId ?? null],
  );
  const first = result.rows[0];
  if (!first || (workspaceId && !first.workspaceId)) return null;
  if (workspaceId || first.lastSessionAt || result.rows.length === 1) return first.dataOwnerId;
  return null;
}

/**
 * Activate (or extend) a 7-day pilot for a user.
 *
 * If the user already has an 'active' enrollment, extend its ends_at by
 * ADMIN_PILOT_DAYS from now (no duplicate, respects the unique-active-user
 * index). Otherwise insert a new 'active' enrollment. `activated_by='admin'` so
 * the audit trail distinguishes operator grants from self-service/system.
 */
export async function activatePilotForUser(userId: string): Promise<AdminActionResult> {
  if (!isValidId(userId)) return { ok: false, message: 'Некорректный id пользователя.' };
  const pool = getPool();
  if (!pool) return { ok: false, message: 'База данных недоступна.' };

  try {
    const granted = await grantEntitlement({
      userId,
      source: 'admin',
      plan: 'radar-admin-7',
      durationDays: ADMIN_PILOT_DAYS,
      features: ['dashboard', 'api', 'digest', 'delivery'],
    });
    if (!granted.changed) {
      return { ok: false, message: 'Активный аккаунт пользователя не найден.' };
    }
    logEvent('admin.pilot_activated', { userId, days: ADMIN_PILOT_DAYS });
    return { ok: true, message: `Доступ активирован минимум на ${ADMIN_PILOT_DAYS} дн.` };
  } catch (err) {
    logError('admin.pilot_activate_failed', err, { userId });
    return { ok: false, message: err instanceof Error ? err.message : 'Не удалось активировать пилот.' };
  }
}

export async function grantAccessForUser(
  userId: string,
  input: { durationDays?: number; expiresAt?: Date },
): Promise<AdminActionResult> {
  if (!isValidId(userId)) return { ok: false, message: 'Некорректный id пользователя.' };
  try {
    const features = ['dashboard', 'api', 'digest', 'delivery'] as const;
    const result = input.expiresAt
      ? await grantEntitlementUntil({ userId, source: 'admin', plan: 'radar-admin', expiresAt: input.expiresAt, features: [...features] })
      : await grantEntitlement({ userId, source: 'admin', plan: 'radar-admin', durationDays: input.durationDays ?? ADMIN_PILOT_DAYS, features: [...features] });
    if (!result.changed) return { ok: false, message: 'Активный аккаунт пользователя не найден.' };
    logEvent('admin.access_granted', { userId, durationDays: input.durationDays, expiresAt: input.expiresAt?.toISOString() });
    return { ok: true, message: 'Доступ выдан или продлён. Изменение сохранено в журнале.' };
  } catch (err) {
    logError('admin.access_grant_failed', err, { userId });
    return { ok: false, message: err instanceof Error ? err.message : 'Не удалось изменить доступ.' };
  }
}

export async function revokeUserSessions(userId: string): Promise<AdminActionResult> {
  if (!isValidId(userId)) return { ok: false, message: 'Некорректный id пользователя.' };
  const count = await revokeAllAuthSessions({ userId });
  if (count === null) return { ok: false, message: 'Не удалось отозвать сессии.' };
  logEvent('admin.user_sessions_revoked', { userId, count });
  return { ok: true, message: `Отозвано сессий: ${count}.` };
}

export async function sendUserLoginLink(
  userId: string,
  returnTo: '/dashboard' | '/onboarding',
): Promise<AdminActionResult> {
  if (!isValidId(userId)) return { ok: false, message: 'Некорректный id пользователя.' };
  const pool = getPool();
  if (!pool) return { ok: false, message: 'База данных недоступна.' };
  try {
    const account = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1 AND status = 'active' LIMIT 1`,
      [userId],
    );
    const email = account.rows[0]?.email;
    if (!email) return { ok: false, message: 'Активный аккаунт не найден.' };
    const result = await shouldRequestAuthV2Login(email)
      ? await requestAuthV2Login({ email, returnTo, clientAddress: 'operator-console', userAgent: null })
      : await requestAccountLogin({ email, returnTo, sourceKey: 'operator-console' });
    if (!result.ok) return { ok: false, message: result.error };
    if (result.delivery !== 'sent') {
      return { ok: false, message: 'Запрос подавлен защитой от повторов. Попробуйте позже.' };
    }
    logEvent('admin.user_login_link_sent', { userId, returnTo });
    return { ok: true, message: returnTo === '/onboarding' ? 'Ссылка для продолжения onboarding отправлена.' : 'Ссылка для входа отправлена.' };
  } catch (err) {
    logError('admin.user_login_link_failed', err, { userId, returnTo });
    return { ok: false, message: 'Не удалось отправить ссылку. Проверьте email provider.' };
  }
}

export type AdminClientProfileInput = {
  agencyName: string;
  specialization: string | null;
  targetCity: string | null;
  roles: string[];
  industries: string[];
  companySizes: string[];
  dailyDigestLimit: number;
  hiringIntentMin: number | null;
  signalFreshnessDays: number | null;
  minOpenRoles: number | null;
};

export async function updateClientSettingsForUser(
  userId: string,
  input: AdminClientProfileInput,
): Promise<AdminActionResult> {
  if (!isValidId(userId)) return { ok: false, message: 'Некорректный id пользователя.' };
  const agencyName = cleanText(input.agencyName, 160);
  const specialization = cleanOptionalText(input.specialization, 240);
  const targetCity = cleanOptionalText(input.targetCity, 500);
  const roles = validateOptions(input.roles, ROLE_OPTIONS.map((item) => item.key));
  const industries = validateOptions(input.industries, INDUSTRY_OPTIONS.map((item) => item.key));
  const companySizes = validateOptions(input.companySizes, COMPANY_SIZE_OPTIONS.map((item) => item.key));
  if (!agencyName || !roles || !industries || !companySizes
    || !Number.isInteger(input.dailyDigestLimit) || input.dailyDigestLimit < 1 || input.dailyDigestLimit > 50
    || !validNullableRange(input.hiringIntentMin, 0, 4)
    || !validNullableRange(input.signalFreshnessDays, 1, 365)
    || !validNullableRange(input.minOpenRoles, 0, 10_000)) {
    return { ok: false, message: 'Проверьте настройки профиля.' };
  }
  const pool = getPool();
  if (!pool) return { ok: false, message: 'База данных недоступна.' };
  try {
    const result = await pool.query(
      `UPDATE client_profiles
       SET agency_name = $2, specialization = $3, target_city = $4,
           roles = $5::TEXT[], industries = $6::JSONB, company_sizes = $7::JSONB,
           daily_digest_limit = $8, hiring_intent_min = $9,
           signal_freshness_days = $10, min_open_roles = $11, updated_at = NOW()
       WHERE owner_id = $1`,
      [userId, agencyName, specialization, targetCity, roles, JSON.stringify(industries), JSON.stringify(companySizes), input.dailyDigestLimit, input.hiringIntentMin, input.signalFreshnessDays, input.minOpenRoles],
    );
    if ((result.rowCount ?? 0) !== 1) return { ok: false, message: 'Профиль пользователя не найден.' };
    logEvent('admin.client_profile_updated', { userId });
    return { ok: true, message: 'Настройки клиента сохранены.' };
  } catch (err) {
    logError('admin.client_profile_update_failed', err, { userId });
    return { ok: false, message: 'Не удалось сохранить настройки клиента.' };
  }
}

function cleanText(value: string, max: number): string | null {
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  return normalized && Buffer.byteLength(normalized, 'utf8') <= max ? normalized : null;
}
function cleanOptionalText(value: string | null, max: number): string | null {
  if (!value?.trim()) return null;
  return cleanText(value, max);
}
function validateOptions(values: string[], allowedValues: readonly string[]): string[] | null {
  const allowed = new Set(allowedValues);
  if (!Array.isArray(values) || values.length > allowed.size) return null;
  return [...new Set(values)].every((value) => allowed.has(value)) ? [...new Set(values)] : null;
}
function validNullableRange(value: number | null, min: number, max: number): boolean {
  return value === null || (Number.isFinite(value) && value >= min && value <= max);
}

/**
 * Revoke a user's active admin grant. Does NOT delete history; the grant remains
 * in the audit ledger. Re-activating creates a new active grant.
 */
export async function pausePilotForUser(userId: string): Promise<AdminActionResult> {
  if (!isValidId(userId)) return { ok: false, message: 'Некорректный id пользователя.' };
  const pool = getPool();
  if (!pool) return { ok: false, message: 'База данных недоступна.' };

  try {
    const result = await revokeEntitlement({ userId, source: 'admin' });
    if (!result.changed) {
      return { ok: false, message: 'Активного пилота нет — нечего приостановить.' };
    }
    logEvent('admin.pilot_paused', { userId });
    return { ok: true, message: 'Пилот приостановлен. Доставка выключена.' };
  } catch (err) {
    logError('admin.pilot_pause_failed', err, { userId });
    return { ok: false, message: err instanceof Error ? err.message : 'Не удалось приостановить пилот.' };
  }
}

/**
 * Toggle a client profile's is_active. An inactive profile is skipped by the
 * digest cron (no leads gathered/delivered for it). Resolves the profile by
 * owner_id = userId so the admin acts on the user's own profile.
 */
export async function setProfileActive(
  userId: string,
  active: boolean,
): Promise<AdminActionResult> {
  if (!isValidId(userId)) return { ok: false, message: 'Некорректный id пользователя.' };
  const pool = getPool();
  if (!pool) return { ok: false, message: 'База данных недоступна.' };

  try {
    const result = await pool.query(
      `UPDATE client_profiles
          SET is_active = $1,
              updated_at = NOW()
        WHERE owner_id = $2`,
      [active, userId],
    );
    if ((result.rowCount ?? 0) === 0) {
      return { ok: false, message: 'У пользователя нет профиля.' };
    }
    logEvent('admin.profile_active_toggled', { userId, active });
    return {
      ok: true,
      message: active ? 'Профиль включён. Дайджест возобновлён.' : 'Профиль приостановлен.',
    };
  } catch (err) {
    logError('admin.profile_active_failed', err, { userId, active });
    return { ok: false, message: err instanceof Error ? err.message : 'Не удалось изменить профиль.' };
  }
}

/**
 * Unlink a profile's Telegram chat — clears telegram_chat_id so delivery stops
 * going to that chat. Resolves the profile by owner_id = userId.
 */
export async function clearProfileTelegram(userId: string): Promise<AdminActionResult> {
  if (!isValidId(userId)) return { ok: false, message: 'Некорректный id пользователя.' };
  const pool = getPool();
  if (!pool) return { ok: false, message: 'База данных недоступна.' };

  try {
    const result = await pool.query(
      `UPDATE client_profiles
          SET telegram_chat_id = NULL,
              updated_at = NOW()
        WHERE owner_id = $1
          AND telegram_chat_id IS NOT NULL`,
      [userId],
    );
    if ((result.rowCount ?? 0) === 0) {
      return { ok: false, message: 'Telegram не привязан к профилю.' };
    }
    logEvent('admin.profile_telegram_cleared', { userId });
    return { ok: true, message: 'Telegram отвязан. Доставка в этот чат выключена.' };
  } catch (err) {
    logError('admin.profile_telegram_clear_failed', err, { userId });
    return { ok: false, message: err instanceof Error ? err.message : 'Не удалось отвязать Telegram.' };
  }
}
