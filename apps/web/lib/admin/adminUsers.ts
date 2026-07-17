/**
 * Admin user-management write operations — the functional counterpart to the
 * read-only getOperatorUsers() card.
 *
 * Per operator direction (2026-07-16: "в админке должно быть все понятно и
 * функционально"): the operator must be able to ACT on users from the panel, not
 * just view them. Three safe, auditable write actions:
 *   - activatePilotForUser   — grant/extend a 7-day pilot enrollment (active)
 *   - pausePilotForUser      — mark the user's latest pilot enrollment 'canceled'
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
 *     total_score, confidence_gate, evidence, or billing rows. Pilot activation
 *     inserts into pilot_enrollments (the entitlement surface the digest cron
 *     already reads); it does NOT create a paid checkout order.
 *   - Pilot activation respects the unique-active-user index: an existing 'active'
 *   enrollment is extended rather than duplicated, so the admin cannot create two
 *     overlapping active pilots.
 *   - Best-effort + explicit result: every function returns {ok, message} so the
 *     admin UI shows the outcome; a DB error never crashes the panel.
 */

import { getPool } from '../db-pool';
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
    // Extend an existing active enrollment first (no duplicate).
    const extended = await pool.query(
      `UPDATE pilot_enrollments
          SET ends_at = NOW() + ($1 || ' days')::interval,
              updated_at = NOW()
        WHERE user_id = $2
          AND status = 'active'
          AND ends_at IS NOT NULL
          AND ends_at > NOW()`,
      [String(ADMIN_PILOT_DAYS), userId],
    );
    if ((extended.rowCount ?? 0) > 0) {
      logEvent('admin.pilot_extended', { userId, days: ADMIN_PILOT_DAYS });
      return { ok: true, message: `Пилот продлён на ${ADMIN_PILOT_DAYS} дн.` };
    }

    // No active enrollment to extend — insert a new one. Mark any prior
    // 'requested' enrollment as 'active' if present (the self-service request
    // path), otherwise insert fresh.
    const claimed = await pool.query(
      `UPDATE pilot_enrollments
          SET status = 'active',
              starts_at = NOW(),
              ends_at = NOW() + ($1 || ' days')::interval,
              activated_by = 'admin',
              updated_at = NOW()
        WHERE user_id = $2
          AND status = 'requested'`,
      [String(ADMIN_PILOT_DAYS), userId],
    );
    if ((claimed.rowCount ?? 0) > 0) {
      logEvent('admin.pilot_activated_from_request', { userId, days: ADMIN_PILOT_DAYS });
      return { ok: true, message: `Пилот активирован на ${ADMIN_PILOT_DAYS} дн. (по заявке).` };
    }

    await pool.query(
      `INSERT INTO pilot_enrollments (user_id, status, starts_at, ends_at, activated_by)
       VALUES ($1, 'active', NOW(), NOW() + ($2 || ' days')::interval, 'admin')`,
      [userId, String(ADMIN_PILOT_DAYS)],
    );
    logEvent('admin.pilot_activated', { userId, days: ADMIN_PILOT_DAYS });
    return { ok: true, message: `Пилот активирован на ${ADMIN_PILOT_DAYS} дн.` };
  } catch (err) {
    logError('admin.pilot_activate_failed', err, { userId });
    return { ok: false, message: err instanceof Error ? err.message : 'Не удалось активировать пилот.' };
  }
}

/**
 * Pause a user's pilot — mark their latest enrollment 'canceled' so the digest
 * cron's entitlement check stops delivering for them. Does NOT delete history;
 * the enrollment row stays for audit. Re-activating via activatePilotForUser
 * creates a new 'active' enrollment.
 */
export async function pausePilotForUser(userId: string): Promise<AdminActionResult> {
  if (!isValidId(userId)) return { ok: false, message: 'Некорректный id пользователя.' };
  const pool = getPool();
  if (!pool) return { ok: false, message: 'База данных недоступна.' };

  try {
    const result = await pool.query(
      `UPDATE pilot_enrollments
          SET status = 'canceled',
              updated_at = NOW()
        WHERE user_id = $1
          AND status = 'active'`,
      [userId],
    );
    if ((result.rowCount ?? 0) === 0) {
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
