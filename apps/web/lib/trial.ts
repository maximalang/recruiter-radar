import { createHmac } from "node:crypto";
import type { PoolClient } from "pg";

import { getPool } from "./db-pool";

export const VERIFIED_TRIAL_DURATION_DAYS = 3;
export const VERIFIED_TRIAL_PLAN = "trial-3d";
export const VERIFIED_TRIAL_FEATURES = [
  "dashboard",
  "api",
  "digest",
  "delivery",
] as const;

type Queryable = Pick<PoolClient, "query">;

type TrialAccountRow = {
  id: string;
  emailNormalized: string;
  emailVerifiedAt: Date | string | null;
  telegramChatId: string | null;
  telegramVerifiedAt: Date | string | null;
};

type TrialGrantRow = {
  id: string;
  startsAt: Date | string;
  endsAt: Date | string;
};

export type TrialActivationResult =
  | {
      status: "activated";
      claimId: string;
      grantId: string;
      startsAt: string;
      endsAt: string;
    }
  | {
      status: "already_claimed";
      reason: "binding_or_account_has_trial";
    }
  | {
      status: "not_eligible";
      reason:
        | "account_unavailable"
        | "workspace_unavailable"
        | "email_unverified"
        | "telegram_unverified"
        | "profile_required";
    };

/**
 * Activates one exact three-day trial after both server-owned verifications
 * exist. The database claim and canonical entitlement are created in one
 * transaction, behind the same owner lock used by the profile trigger.
 */
export async function activateVerifiedTrial(input: {
  userId: string | number;
  workspaceId: string | number;
  now?: Date;
}): Promise<TrialActivationResult> {
  const userId = normalizePositiveId(input.userId, "user");
  const workspaceId = normalizePositiveId(input.workspaceId, "workspace");
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Invalid trial activation timestamp.");
  }

  const secret = getTrialAntiAbuseSecret();
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SELECT rr_trial_profile_owner_lock($1)", [userId]);

    const accountResult = await client.query<TrialAccountRow>(
      `SELECT
         id::TEXT AS id,
         COALESCE(email_normalized, LOWER(email)) AS "emailNormalized",
         email_verified_at AS "emailVerifiedAt",
         telegram_chat_id::TEXT AS "telegramChatId",
         telegram_verified_at AS "telegramVerifiedAt"
       FROM users
       WHERE id = $1
         AND status = 'active'
       FOR UPDATE`,
      [userId],
    );
    if (accountResult.rowCount !== 1) {
      return await rollbackWithResult(client, {
        status: "not_eligible",
        reason: "account_unavailable",
      });
    }

    const account = accountResult.rows[0];
    if (!account.emailVerifiedAt) {
      return await rollbackWithResult(client, {
        status: "not_eligible",
        reason: "email_unverified",
      });
    }
    if (!account.telegramChatId || !account.telegramVerifiedAt) {
      return await rollbackWithResult(client, {
        status: "not_eligible",
        reason: "telegram_unverified",
      });
    }

    const workspaceResult = await client.query(
      `SELECT 1
       FROM workspace_members AS membership
       JOIN workspaces AS workspace
         ON workspace.id = membership.workspace_id
       WHERE membership.workspace_id = $1
         AND membership.user_id = $2
         AND membership.status = 'active'
         AND workspace.status = 'active'
         AND workspace.deleted_at IS NULL`,
      [workspaceId, userId],
    );
    if (workspaceResult.rowCount !== 1) {
      return await rollbackWithResult(client, {
        status: "not_eligible",
        reason: "workspace_unavailable",
      });
    }

    const profileResult = await client.query<{ id: string }>(
      `SELECT id::TEXT AS id
       FROM client_profiles
       WHERE owner_id = $1
         AND workspace_id = $2
         AND is_active = TRUE
       ORDER BY id
       LIMIT 2
       FOR UPDATE`,
      [userId, workspaceId],
    );
    if (profileResult.rowCount !== 1) {
      return await rollbackWithResult(client, {
        status: "not_eligible",
        reason: "profile_required",
      });
    }

    const emailBindingHash = hmacBinding(secret, `email:${account.emailNormalized}`);
    const telegramBindingHash = hmacBinding(secret, `telegram:${account.telegramChatId}`);
    const bindingHash = hmacBinding(
      secret,
      `binding:${account.emailNormalized}\u0000${account.telegramChatId}`,
    );

    const existingClaim = await client.query(
      `SELECT id
       FROM trial_claims
       WHERE user_id = $1
          OR binding_hash = $2
          OR email_binding_hash = $3
          OR telegram_binding_hash = $4
       ORDER BY id
       LIMIT 1
       FOR UPDATE`,
      [userId, bindingHash, emailBindingHash, telegramBindingHash],
    );
    if (existingClaim.rowCount !== 0) {
      return await rollbackWithResult(client, {
        status: "already_claimed",
        reason: "binding_or_account_has_trial",
      });
    }

    const existingGrant = await client.query(
      `SELECT id
       FROM entitlement_grants
       WHERE entitlement_owner_id = $1
         AND workspace_id = $2
         AND source = 'trial'
       ORDER BY id DESC
       LIMIT 1
       FOR UPDATE`,
      [userId, workspaceId],
    );
    if (existingGrant.rowCount !== 0) {
      return await rollbackWithResult(client, {
        status: "already_claimed",
        reason: "binding_or_account_has_trial",
      });
    }

    const timestamp = now.toISOString();
    const grantResult = await client.query<TrialGrantRow>(
      `INSERT INTO entitlement_grants (
         user_id,
         workspace_id,
         entitlement_owner_id,
         source,
         plan_code,
         features,
         starts_at,
         ends_at
       )
       VALUES (
         $1,
         $2,
         $1,
         'trial',
         $3,
         $4::TEXT[],
         $5::TIMESTAMPTZ,
         $5::TIMESTAMPTZ + INTERVAL '3 days'
       )
       RETURNING
         id::TEXT AS id,
         starts_at AS "startsAt",
         ends_at AS "endsAt"`,
      [userId, workspaceId, VERIFIED_TRIAL_PLAN, [...VERIFIED_TRIAL_FEATURES], timestamp],
    );
    if (grantResult.rowCount !== 1) {
      throw new Error("Failed to create the verified trial entitlement.");
    }

    const claimResult = await client.query<{ id: string }>(
      `INSERT INTO trial_claims (
         user_id,
         workspace_id,
         client_profile_id,
         entitlement_grant_id,
         email_binding_hash,
         telegram_binding_hash,
         binding_hash,
         status,
         activated_at,
         expires_at
       )
       VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7,
         'active',
         $8::TIMESTAMPTZ,
         $8::TIMESTAMPTZ + INTERVAL '3 days'
       )
       RETURNING id::TEXT AS id`,
      [
        userId,
        workspaceId,
        profileResult.rows[0].id,
        grantResult.rows[0].id,
        emailBindingHash,
        telegramBindingHash,
        bindingHash,
        timestamp,
      ],
    );
    if (claimResult.rowCount !== 1) {
      throw new Error("Failed to create the verified trial claim.");
    }

    await client.query("COMMIT");
    transactionOpen = false;
    return {
      status: "activated",
      claimId: claimResult.rows[0].id,
      grantId: grantResult.rows[0].id,
      startsAt: toIsoString(grantResult.rows[0].startsAt),
      endsAt: toIsoString(grantResult.rows[0].endsAt),
    };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    if (isUniqueViolation(error, "trial_claims_binding_hash_uidx")
      || isUniqueViolation(error, "trial_claims_email_binding_hash_uidx")
      || isUniqueViolation(error, "trial_claims_telegram_binding_hash_uidx")
      || isUniqueViolation(error, "trial_claims_user_uidx")) {
      return {
        status: "already_claimed",
        reason: "binding_or_account_has_trial",
      };
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Closes the claim before account-deletion scrubbing may mutate the profile. */
export async function closeTrialClaimsForAccountDeletion(
  db: Queryable,
  userId: string | number,
  now: Date,
): Promise<void> {
  const normalizedUserId = normalizePositiveId(userId, "user");
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid deletion timestamp.");
  const timestamp = now.toISOString();
  await db.query("SELECT rr_trial_profile_owner_lock($1)", [normalizedUserId]);
  await db.query(
    `UPDATE trial_claims
     SET status = 'closed',
         closed_at = COALESCE(closed_at, $2::TIMESTAMPTZ),
         updated_at = $2::TIMESTAMPTZ
     WHERE user_id = $1
       AND status = 'active'`,
    [normalizedUserId, timestamp],
  );
  await db.query(
    `UPDATE entitlement_grants
     SET status = 'revoked',
         revoked_at = COALESCE(revoked_at, $2::TIMESTAMPTZ),
         updated_at = $2::TIMESTAMPTZ
     WHERE user_id = $1
       AND source = 'trial'
       AND status = 'active'`,
    [normalizedUserId, timestamp],
  );
}

export function isTrialProfileImmutableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Record<string, unknown>;
  return candidate.code === "42501"
    && candidate.constraint === "client_profiles_trial_immutable_guard";
}

async function rollbackWithResult<T>(
  client: Pick<PoolClient, "query">,
  result: T,
): Promise<T> {
  await client.query("ROLLBACK");
  return result;
}

function getTrialAntiAbuseSecret(): string {
  const secret = process.env.TRIAL_ANTI_ABUSE_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("TRIAL_ANTI_ABUSE_SECRET is not configured with sufficient entropy.");
  }
  return secret;
}

function hmacBinding(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

function normalizePositiveId(value: string | number, label: string): string {
  const normalized = String(value);
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`Invalid ${label} id.`);
  }
  return normalized;
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Record<string, unknown>;
  return candidate.code === "23505" && candidate.constraint === constraint;
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid trial timestamp.");
  return date.toISOString();
}
