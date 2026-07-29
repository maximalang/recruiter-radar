import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { PoolClient } from "pg";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { decodeClientDataJSON } from "@simplewebauthn/server/helpers";

import { getClient, getPool } from "../db-pool";
import { sendEmail } from "../email/transport";
import { logError, logWarn } from "../runtime";
import {
  type AuthEnvironment,
  isAuthPasskeyLoginAvailable,
  isAuthPasskeysEnabledForUser,
} from "./config";
import { hashAuthRateLimitBoundary } from "./rate-limits";
import { sanitizeAuthReturnTo } from "./security";
import {
  isRecentAuthentication,
  type AuthSession,
} from "./sessions";
import {
  isAuthSessionEnvironment,
  type AuthSessionEnvironment,
} from "./session-environment";
import {
  renderAuthEmail,
  type AuthEmailTemplateName,
} from "./email-templates";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const POSITIVE_ID_PATTERN = /^[1-9]\d*$/;
const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,1024}$/;
const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");
const MAX_AUTHENTICATOR_COUNTER = 4_294_967_295;
const MAX_PASSKEYS_PER_USER = 20;
const TRANSPORTS = new Set<AuthenticatorTransportFuture>([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
]);

export type PasskeyConfiguration = {
  origin: string;
  rpID: string;
  rpName: "Recruiter Radar";
};

export type UserPasskey = {
  id: string;
  name: string;
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  backupEligible: boolean;
  transports: AuthenticatorTransportFuture[];
  createdAt: Date;
  lastUsedAt: Date | null;
};

type RegistrationResult =
  | { ok: true; passkey: UserPasskey }
  | {
    ok: false;
    code:
      | "challenge_expired"
      | "challenge_invalid"
      | "challenge_replayed"
      | "credential_exists"
      | "invalid_name"
      | "rate_limited"
      | "reauth_required"
      | "unavailable"
      | "verification_failed";
  };

type AuthenticationResult =
  | {
    ok: true;
    userId: string;
    onboardingRequired: boolean;
    returnTo: string;
    session: { id: string; token: string };
  }
  | {
    ok: false;
    code:
      | "challenge_expired"
      | "challenge_invalid"
      | "challenge_replayed"
      | "rate_limited"
      | "unavailable"
      | "verification_failed";
  };

type ChallengeRow = {
  challengeId: string;
  challengeHash: string;
  returnTo?: string;
  expiresAt: Date;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
};

type CredentialRow = {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: Buffer;
  counter: string;
  transports: string[];
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  onboardingStatus: string;
  email: string;
  displayName: string | null;
};

function validId(value: string): boolean {
  if (!POSITIVE_ID_PATTERN.test(value)) return false;
  try {
    return BigInt(value) <= MAX_POSTGRES_BIGINT;
  } catch {
    return false;
  }
}

function validCredentialId(value: unknown): value is string {
  return typeof value === "string" && CREDENTIAL_ID_PATTERN.test(value);
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").trim();
  if (
    Buffer.byteLength(name, "utf8") < 1
    || Buffer.byteLength(name, "utf8") > 80
    || /[\u0000-\u001f\u007f]/u.test(name)
  ) {
    return null;
  }
  return name;
}

function normalizeTransports(
  values: readonly string[] | undefined,
): AuthenticatorTransportFuture[] {
  return [...new Set(values?.filter(
    (value): value is AuthenticatorTransportFuture =>
      TRANSPORTS.has(value as AuthenticatorTransportFuture),
  ) ?? [])];
}

function requestHashes(input: {
  clientAddress?: string | null;
  userAgent?: string | null;
}): { requestIpHash: string | null; userAgentHash: string | null } {
  return {
    requestIpHash:
      input.clientAddress && input.clientAddress !== "unknown"
        ? hashAuthRateLimitBoundary("ip", input.clientAddress)
        : null,
    userAgentHash: input.userAgent
      ? hashAuthRateLimitBoundary("user-agent", input.userAgent.slice(0, 512))
      : null,
  };
}

function responseChallenge(
  response: RegistrationResponseJSON | AuthenticationResponseJSON,
): string | null {
  try {
    const challenge = decodeClientDataJSON(
      response.response.clientDataJSON,
    ).challenge;
    return typeof challenge === "string" && challenge.length <= 2048
      ? challenge
      : null;
  } catch {
    return null;
  }
}

async function sendPasskeySecurityNotice(input: {
  template: Extract<
    AuthEmailTemplateName,
    "new_login" | "passkey_added" | "passkey_removed"
  >;
  email: string;
  displayName: string | null;
  deviceLabel: string | null;
}): Promise<void> {
  try {
    const message = renderAuthEmail({
      template: input.template,
      recipientName: input.displayName,
      deviceLabel: input.deviceLabel,
    });
    const delivery = await sendEmail({ ...message, to: input.email });
    if (!delivery.ok) {
      logWarn("auth_v2.passkey_security_notice_not_sent", {
        reasonCode: delivery.reason,
        template: input.template,
      });
    }
  } catch {
    logWarn("auth_v2.passkey_security_notice_not_sent", {
      reasonCode: "unexpected_error",
      template: input.template,
    });
  }
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}

async function resolveDatabaseNow(
  client: PoolClient,
  applicationNow: Date,
): Promise<Date> {
  const result = await client.query<{ now: Date }>(
    `SELECT GREATEST(
       $1::TIMESTAMPTZ,
       clock_timestamp()
     ) AS now`,
    [applicationNow],
  );
  return result.rows[0]?.now ?? applicationNow;
}

async function recordChallengeReplay(
  client: PoolClient,
  input: {
    challengeHash: string;
    userId?: string | null;
    reasonCode: "consumed" | "invalidated";
    now: Date;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO auth_security_events (
       event_type,
       outcome,
       user_id,
       subject_hash,
       metadata,
       created_at
     )
     VALUES (
       'challenge_replayed',
       'denied',
       $2,
       $1,
       JSONB_BUILD_OBJECT('reason_code', $3::TEXT),
       $4
     )
     ON CONFLICT (subject_hash)
       WHERE event_type = 'challenge_replayed'
         AND subject_hash IS NOT NULL
       DO NOTHING`,
    [
      input.challengeHash,
      input.userId ?? null,
      input.reasonCode,
      input.now,
    ],
  );
}

function activeChallengeFailure(
  row: ChallengeRow,
  now: Date,
): "challenge_expired" | "challenge_replayed" | null {
  if (row.consumedAt || row.invalidatedAt) return "challenge_replayed";
  if (row.expiresAt.getTime() <= now.getTime()) return "challenge_expired";
  return null;
}

export function getPasskeyConfiguration(
  env: AuthEnvironment = process.env,
): PasskeyConfiguration | null {
  const rawOrigin = env.AUTH_SITE_URL?.trim()
    ?? (env.NODE_ENV === "production" ? "" : "http://localhost:3000");
  if (!rawOrigin) return null;
  try {
    const url = new URL(rawOrigin);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (
      url.origin !== rawOrigin
      || url.username
      || url.password
      || (url.protocol !== "https:" && !local)
    ) {
      return null;
    }
    const configuredRPID = env.AUTH_PASSKEY_RP_ID?.trim() || url.hostname;
    if (configuredRPID !== url.hostname) return null;
    return {
      origin: url.origin,
      rpID: configuredRPID,
      rpName: "Recruiter Radar",
    };
  } catch {
    return null;
  }
}

export function hashPasskeyChallenge(challenge: string): string {
  return createHash("sha256").update(challenge).digest("hex");
}

export function matchesPasskeyChallengeHash(
  challenge: string,
  expectedHash: string,
): boolean {
  if (!HASH_PATTERN.test(expectedHash)) return false;
  const actual = Buffer.from(hashPasskeyChallenge(challenge), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return timingSafeEqual(actual, expected);
}

export async function beginPasskeyRegistration(input: {
  session: AuthSession;
  clientAddress?: string | null;
  userAgent?: string | null;
  now?: Date;
  env?: AuthEnvironment;
}): Promise<PublicKeyCredentialCreationOptionsJSON | null> {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  const configuration = getPasskeyConfiguration(env);
  if (
    !configuration
    || !validId(input.session.id)
    || !validId(input.session.userId)
    || !validId(input.session.workspaceId ?? "")
    || !Number.isFinite(now.getTime())
    || !isAuthPasskeysEnabledForUser(input.session.userId, env)
    || !isRecentAuthentication(input.session, now)
  ) {
    return null;
  }

  const client = await getClient();
  if (!client) return null;
  try {
    const rateLimit = await client.query<{ allowed: boolean }>(
      `SELECT consume_auth_rate_limit(
         'passkey_verify',
         $1,
         600,
         10,
         $2
       ) AS allowed`,
      [
        hashAuthRateLimitBoundary(
          "passkey-registration-start-user",
          input.session.userId,
        ),
        now,
      ],
    );
    if (!rateLimit.rows[0]?.allowed) return null;

    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`passkey-registration:${input.session.userId}`],
    );
    const account = await client.query<{
      email: string;
      displayName: string | null;
    }>(
      `SELECT
         account.email_normalized AS email,
         account.full_name AS "displayName"
       FROM auth_sessions AS session
       JOIN users AS account ON account.id = session.user_id
       WHERE session.id = $1
         AND session.user_id = $2
         AND session.workspace_id = $3
         AND session.revoked_at IS NULL
         AND session.idle_expires_at > $4
         AND session.absolute_expires_at > $4
         AND session.last_authenticated_at >= $4 - INTERVAL '10 minutes'
         AND account.status = 'active'
         AND account.email_verified_at IS NOT NULL
         AND account.email_normalized IS NOT NULL
       FOR UPDATE OF session, account`,
      [
        input.session.id,
        input.session.userId,
        input.session.workspaceId,
        now,
      ],
    );
    const identity = account.rows[0];
    if (!identity) {
      await rollbackQuietly(client);
      return null;
    }
    const existing = await client.query<{
      credentialId: string;
      transports: string[];
    }>(
      `SELECT
         credential_id AS "credentialId",
         transports
       FROM user_passkeys
       WHERE user_id = $1
       ORDER BY id
       LIMIT $2`,
      [input.session.userId, MAX_PASSKEYS_PER_USER],
    );
    if (existing.rows.length >= MAX_PASSKEYS_PER_USER) {
      await client.query("COMMIT");
      return null;
    }
    const challenge = randomBytes(32).toString("base64url");
    const options = await generateRegistrationOptions({
      rpName: configuration.rpName,
      rpID: configuration.rpID,
      userName: identity.email,
      userDisplayName: identity.displayName ?? identity.email,
      userID: createHash("sha256")
        .update(`recruiter-radar-passkey-user:${input.session.userId}`)
        .digest(),
      challenge,
      timeout: CHALLENGE_TTL_MS,
      attestationType: "none",
      excludeCredentials: existing.rows.map((credential) => ({
        id: credential.credentialId,
        transports: normalizeTransports(credential.transports),
      })),
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
    });
    const hashes = requestHashes(input);
    await client.query(
      `WITH invalidated AS (
         UPDATE auth_challenges
         SET invalidated_at = $3
         WHERE purpose = 'passkey_registration'
           AND user_id = $1
           AND consumed_at IS NULL
           AND invalidated_at IS NULL
         RETURNING id
       )
       INSERT INTO auth_challenges (
         purpose,
         email_normalized,
         user_id,
         workspace_id,
         token_hash,
         return_to,
         send_status,
         request_ip_hash,
         user_agent_hash,
         expires_at,
         created_at
       )
       VALUES (
         'passkey_registration',
         $2,
         $1,
         $4,
         $5,
         '/settings/security',
         'suppressed',
         $6,
         $7,
         $3 + INTERVAL '5 minutes',
         $3
       )`,
      [
        input.session.userId,
        identity.email,
        now,
        input.session.workspaceId,
        hashPasskeyChallenge(options.challenge),
        hashes.requestIpHash,
        hashes.userAgentHash,
      ],
    );
    await client.query("COMMIT");
    return options;
  } catch (error) {
    await rollbackQuietly(client);
    logError("auth_v2.passkey_registration_start_failed", error);
    return null;
  } finally {
    client.release();
  }
}

export async function finishPasskeyRegistration(input: {
  session: AuthSession;
  response: RegistrationResponseJSON;
  name: unknown;
  now?: Date;
  env?: AuthEnvironment;
}): Promise<RegistrationResult> {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  const name = normalizeName(input.name);
  if (!name) return { ok: false, code: "invalid_name" };
  const configuration = getPasskeyConfiguration(env);
  if (
    !configuration
    || !validId(input.session.id)
    || !validId(input.session.userId)
    || !validId(input.session.workspaceId ?? "")
    || !Number.isFinite(now.getTime())
    || !isAuthPasskeysEnabledForUser(input.session.userId, env)
  ) {
    return { ok: false, code: "unavailable" };
  }
  if (!isRecentAuthentication(input.session, now)) {
    return { ok: false, code: "reauth_required" };
  }
  const challenge = responseChallenge(input.response);
  if (!challenge) return { ok: false, code: "challenge_invalid" };
  const challengeHash = hashPasskeyChallenge(challenge);

  const client = await getClient();
  if (!client) return { ok: false, code: "unavailable" };
  try {
    const rateLimit = await client.query<{ allowed: boolean }>(
      `SELECT consume_auth_rate_limit(
         'passkey_verify',
         $1,
         600,
         20,
         $2
       ) AS allowed`,
      [
        hashAuthRateLimitBoundary(
          "passkey-registration-verify-user",
          input.session.userId,
        ),
        now,
      ],
    );
    if (!rateLimit.rows[0]?.allowed) {
      return { ok: false, code: "rate_limited" };
    }

    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`passkey-registration:${input.session.userId}`],
    );
    const actionNow = await resolveDatabaseNow(client, now);
    const eligibility = await client.query<{ allowed: boolean }>(
      `SELECT COUNT(*) < $1 AS allowed
       FROM user_passkeys
       WHERE user_id = $2`,
      [MAX_PASSKEYS_PER_USER, input.session.userId],
    );
    if (!eligibility.rows[0]?.allowed) {
      await client.query("COMMIT");
      return { ok: false, code: "rate_limited" };
    }
    const challengeResult = await client.query<ChallengeRow>(
      `SELECT
         challenge.id::TEXT AS "challengeId",
         challenge.token_hash AS "challengeHash",
         challenge.expires_at AS "expiresAt",
         challenge.consumed_at AS "consumedAt",
         challenge.invalidated_at AS "invalidatedAt"
       FROM auth_challenges AS challenge
       WHERE challenge.token_hash = $1
         AND challenge.purpose = 'passkey_registration'
         AND challenge.user_id = $2
         AND challenge.workspace_id = $3
       LIMIT 1
       FOR UPDATE`,
      [
        challengeHash,
        input.session.userId,
        input.session.workspaceId,
      ],
    );
    const storedChallenge = challengeResult.rows[0];
    if (!storedChallenge) {
      await rollbackQuietly(client);
      return { ok: false, code: "challenge_invalid" };
    }
    const challengeFailure = activeChallengeFailure(storedChallenge, actionNow);
    if (challengeFailure === "challenge_replayed") {
      await recordChallengeReplay(client, {
        challengeHash,
        userId: input.session.userId,
        reasonCode: storedChallenge.consumedAt ? "consumed" : "invalidated",
        now: actionNow,
      });
      await client.query("COMMIT");
      return { ok: false, code: challengeFailure };
    }
    if (challengeFailure === "challenge_expired") {
      await client.query(
        `UPDATE auth_challenges
         SET invalidated_at = $2
         WHERE id = $1
           AND consumed_at IS NULL
           AND invalidated_at IS NULL`,
        [storedChallenge.challengeId, actionNow],
      );
      await client.query("COMMIT");
      return { ok: false, code: challengeFailure };
    }

    const activeSession = await client.query<{
      email: string;
      displayName: string | null;
    }>(
      `SELECT
         account.email,
         account.full_name AS "displayName"
       FROM auth_sessions AS session
       JOIN users AS account ON account.id = session.user_id
       WHERE session.id = $1
         AND session.user_id = $2
         AND session.workspace_id = $3
         AND session.revoked_at IS NULL
         AND session.idle_expires_at > $4
         AND session.absolute_expires_at > $4
         AND session.last_authenticated_at >= $4 - INTERVAL '10 minutes'
         AND account.status = 'active'
         AND account.email_verified_at IS NOT NULL
       FOR UPDATE OF session, account`,
      [
        input.session.id,
        input.session.userId,
        input.session.workspaceId,
        actionNow,
      ],
    );
    const activeAccount = activeSession.rows[0];
    if (!activeAccount) {
      await rollbackQuietly(client);
      return { ok: false, code: "reauth_required" };
    }

    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response: input.response,
        expectedChallenge: (candidate) =>
          matchesPasskeyChallengeHash(candidate, storedChallenge.challengeHash),
        expectedOrigin: configuration.origin,
        expectedRPID: configuration.rpID,
        expectedType: "webauthn.create",
        requireUserPresence: true,
        requireUserVerification: true,
      });
    } catch {
      verification = { verified: false };
    }
    if (!verification.verified) {
      await client.query(
        `UPDATE auth_challenges
         SET invalidated_at = $2
         WHERE id = $1`,
        [storedChallenge.challengeId, actionNow],
      );
      await client.query("COMMIT");
      logWarn("auth_v2.passkey_registration_denied", {
        reasonCode: "verification_failed",
      });
      return { ok: false, code: "verification_failed" };
    }

    const credential = verification.registrationInfo.credential;
    if (
      !validCredentialId(credential.id)
      || !Number.isSafeInteger(credential.counter)
      || credential.counter < 0
      || credential.counter > MAX_AUTHENTICATOR_COUNTER
      || credential.publicKey.byteLength < 1
      || credential.publicKey.byteLength > 8192
    ) {
      await rollbackQuietly(client);
      return { ok: false, code: "verification_failed" };
    }
    const deviceType = verification.registrationInfo.credentialDeviceType;
    const backedUp = verification.registrationInfo.credentialBackedUp;
    const backupEligible = deviceType === "multiDevice";
    const transports = normalizeTransports(
      credential.transports ?? input.response.response.transports,
    );
    const inserted = await client.query<UserPasskey>(
      `WITH created AS (
         INSERT INTO user_passkeys (
           user_id,
           credential_id,
           public_key,
           counter,
           transports,
           device_type,
           backed_up,
           backup_eligible,
           name,
           created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (credential_id) DO NOTHING
         RETURNING *
       ),
       recorded AS (
         INSERT INTO auth_security_events (
           event_type,
           user_id,
           workspace_id,
           session_id,
           metadata,
           created_at
         )
         SELECT
           'passkey_added',
           $1::BIGINT,
           $11::BIGINT,
           $12::BIGINT,
           JSONB_BUILD_OBJECT(
             'device_type',
             CASE created.device_type
               WHEN 'singleDevice' THEN 'single_device'
               ELSE 'multi_device'
             END,
             'backed_up',
             created.backed_up
           ),
           $10
         FROM created
         RETURNING id
       ),
       consumed AS (
         UPDATE auth_challenges
         SET consumed_at = $10
         WHERE id = $13
           AND consumed_at IS NULL
           AND invalidated_at IS NULL
           AND EXISTS (SELECT 1 FROM created)
         RETURNING id
       )
       SELECT
         created.id::TEXT AS id,
         created.name,
         created.device_type AS "deviceType",
         created.backed_up AS "backedUp",
         created.backup_eligible AS "backupEligible",
         created.transports,
         created.created_at AS "createdAt",
         created.last_used_at AS "lastUsedAt"
       FROM created
       WHERE EXISTS (SELECT 1 FROM recorded)
         AND EXISTS (SELECT 1 FROM consumed)`,
      [
        input.session.userId,
        credential.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        transports,
        deviceType,
        backedUp,
        backupEligible,
        name,
        actionNow,
        input.session.workspaceId,
        input.session.id,
        storedChallenge.challengeId,
      ],
    );
    const passkey = inserted.rows[0];
    if (!passkey) {
      await client.query(
        `UPDATE auth_challenges
         SET invalidated_at = $2
         WHERE id = $1
           AND consumed_at IS NULL
           AND invalidated_at IS NULL`,
        [storedChallenge.challengeId, actionNow],
      );
      await client.query("COMMIT");
      return { ok: false, code: "credential_exists" };
    }
    await client.query("COMMIT");
    await sendPasskeySecurityNotice({
      template: "passkey_added",
      email: activeAccount.email,
      displayName: activeAccount.displayName,
      deviceLabel: passkey.name,
    });
    return { ok: true, passkey };
  } catch (error) {
    await rollbackQuietly(client);
    logError("auth_v2.passkey_registration_finish_failed", error);
    return { ok: false, code: "unavailable" };
  } finally {
    client.release();
  }
}

export async function beginPasskeyAuthentication(input: {
  returnTo?: unknown;
  clientAddress?: string | null;
  userAgent?: string | null;
  now?: Date;
  env?: AuthEnvironment;
}): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  const configuration = getPasskeyConfiguration(env);
  if (
    !configuration
    || !Number.isFinite(now.getTime())
    || !isAuthPasskeyLoginAvailable(env)
  ) {
    return null;
  }
  const client = await getClient();
  if (!client) return null;
  const hashes = requestHashes(input);
  try {
    const rateLimit = await client.query<{ allowed: boolean }>(
      `SELECT (
         consume_auth_rate_limit('global', $1, 60, 100, $3)
         AND (
           $2::TEXT IS NULL
           OR consume_auth_rate_limit('trusted_ip_hash', $2, 900, 20, $3)
         )
       ) AS allowed`,
      [
        hashAuthRateLimitBoundary("passkey-start-global", "authentication"),
        hashes.requestIpHash,
        now,
      ],
    );
    if (!rateLimit.rows[0]?.allowed) return null;

    await client.query("BEGIN");
    const options = await generateAuthenticationOptions({
      rpID: configuration.rpID,
      userVerification: "required",
    });
    await client.query(
      `INSERT INTO auth_challenges (
         purpose,
         email_normalized,
         user_id,
         workspace_id,
         token_hash,
         return_to,
         send_status,
         request_ip_hash,
         user_agent_hash,
         expires_at,
         created_at
       )
       VALUES (
         'passkey_authentication',
         NULL,
         NULL,
         NULL,
         $1,
         $2,
         'suppressed',
         $3,
         $4,
         $5::TIMESTAMPTZ + INTERVAL '5 minutes',
         $5::TIMESTAMPTZ
       )`,
      [
        hashPasskeyChallenge(options.challenge),
        sanitizeAuthReturnTo(input.returnTo),
        hashes.requestIpHash,
        hashes.userAgentHash,
        now,
      ],
    );
    await client.query("COMMIT");
    return options;
  } catch (error) {
    await rollbackQuietly(client);
    logError("auth_v2.passkey_authentication_start_failed", error);
    return null;
  } finally {
    client.release();
  }
}

export async function finishPasskeyAuthentication(input: {
  response: AuthenticationResponseJSON;
  clientAddress?: string | null;
  userAgent?: string | null;
  sessionEnvironment?: AuthSessionEnvironment | null;
  replaceSession?: { id: string; userId: string } | null;
  now?: Date;
  env?: AuthEnvironment;
}): Promise<AuthenticationResult> {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  const configuration = getPasskeyConfiguration(env);
  const challenge = responseChallenge(input.response);
  if (
    !configuration
    || !challenge
    || !validCredentialId(input.response.id)
    || !Number.isFinite(now.getTime())
    || !isAuthPasskeyLoginAvailable(env)
    || (
      input.sessionEnvironment !== null
      && input.sessionEnvironment !== undefined
      && !isAuthSessionEnvironment(input.sessionEnvironment)
    )
    || (
      input.replaceSession !== null
      && input.replaceSession !== undefined
      && (
        !validId(input.replaceSession.id)
        || !validId(input.replaceSession.userId)
      )
    )
  ) {
    return { ok: false, code: "challenge_invalid" };
  }
  const challengeHash = hashPasskeyChallenge(challenge);
  const hashes = requestHashes(input);
  const client = await getClient();
  if (!client) return { ok: false, code: "unavailable" };
  try {
    const rateLimit = await client.query<{ allowed: boolean }>(
      `SELECT (
         consume_auth_rate_limit(
           'global',
           $1,
           900,
           500,
           $3
         )
         AND (
           $2::TEXT IS NULL
           OR consume_auth_rate_limit(
             'passkey_verify',
             $2,
             900,
             10,
             $3
           )
         )
       ) AS allowed`,
      [
        hashAuthRateLimitBoundary("passkey-verify-global", "authentication"),
        hashes.requestIpHash,
        now,
      ],
    );
    if (!rateLimit.rows[0]?.allowed) {
      return { ok: false, code: "rate_limited" };
    }

    await client.query("BEGIN");
    const actionNow = await resolveDatabaseNow(client, now);
    const challengeResult = await client.query<ChallengeRow>(
      `SELECT
         challenge.id::TEXT AS "challengeId",
         challenge.token_hash AS "challengeHash",
         challenge.return_to AS "returnTo",
         challenge.expires_at AS "expiresAt",
         challenge.consumed_at AS "consumedAt",
         challenge.invalidated_at AS "invalidatedAt"
       FROM auth_challenges AS challenge
       WHERE challenge.token_hash = $1
         AND challenge.purpose = 'passkey_authentication'
       LIMIT 1
       FOR UPDATE`,
      [challengeHash],
    );
    const storedChallenge = challengeResult.rows[0];
    if (!storedChallenge) {
      await rollbackQuietly(client);
      return { ok: false, code: "challenge_invalid" };
    }
    const challengeFailure = activeChallengeFailure(storedChallenge, actionNow);
    if (challengeFailure === "challenge_replayed") {
      await recordChallengeReplay(client, {
        challengeHash,
        reasonCode: storedChallenge.consumedAt ? "consumed" : "invalidated",
        now: actionNow,
      });
      await client.query("COMMIT");
      return { ok: false, code: challengeFailure };
    }
    if (challengeFailure === "challenge_expired") {
      await client.query(
        `UPDATE auth_challenges
         SET invalidated_at = $2
         WHERE id = $1
           AND consumed_at IS NULL
           AND invalidated_at IS NULL`,
        [storedChallenge.challengeId, actionNow],
      );
      await client.query("COMMIT");
      return { ok: false, code: challengeFailure };
    }

    const credentialResult = await client.query<CredentialRow>(
      `SELECT
         passkey.id::TEXT AS id,
         passkey.user_id::TEXT AS "userId",
         passkey.credential_id AS "credentialId",
         passkey.public_key AS "publicKey",
         passkey.counter::TEXT AS counter,
         passkey.transports,
         passkey.device_type AS "deviceType",
         passkey.backed_up AS "backedUp",
         account.onboarding_status AS "onboardingStatus",
         account.email,
         account.full_name AS "displayName"
       FROM user_passkeys AS passkey
       JOIN users AS account ON account.id = passkey.user_id
       WHERE passkey.credential_id = $1
         AND account.status = 'active'
         AND account.email_verified_at IS NOT NULL
       LIMIT 1
       FOR UPDATE OF passkey, account`,
      [input.response.id],
    );
    const credential = credentialResult.rows[0];
    const currentCounter = credential ? Number(credential.counter) : NaN;
    if (
      !credential
      || !validId(credential.userId)
      || !Number.isSafeInteger(currentCounter)
      || currentCounter < 0
      || currentCounter > MAX_AUTHENTICATOR_COUNTER
      || !isAuthPasskeysEnabledForUser(credential.userId, env)
    ) {
      await client.query(
        `WITH invalidated AS (
           UPDATE auth_challenges
           SET invalidated_at = $2
           WHERE id = $1
           RETURNING id
         )
         INSERT INTO auth_security_events (
           event_type,
           outcome,
           user_id,
           subject_hash,
           metadata,
           created_at
         )
         SELECT
           'login_failed',
           'denied',
           $3::BIGINT,
           $4,
           JSONB_BUILD_OBJECT(
             'reason_code',
             'passkey_verification_failed'
           ),
           $2
         WHERE EXISTS (SELECT 1 FROM invalidated)`,
        [
          storedChallenge.challengeId,
          actionNow,
          credential && validId(credential.userId)
            ? credential.userId
            : null,
          challengeHash,
        ],
      );
      await client.query("COMMIT");
      return { ok: false, code: "verification_failed" };
    }

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response: input.response,
        expectedChallenge: (candidate) =>
          matchesPasskeyChallengeHash(candidate, storedChallenge.challengeHash),
        expectedOrigin: configuration.origin,
        expectedRPID: configuration.rpID,
        expectedType: "webauthn.get",
        credential: {
          id: credential.credentialId,
          publicKey: new Uint8Array(credential.publicKey),
          counter: currentCounter,
          transports: normalizeTransports(credential.transports),
        },
        requireUserVerification: true,
      });
    } catch {
      verification = {
        verified: false,
        authenticationInfo: {} as never,
      };
    }
    const authenticationInfo = verification.authenticationInfo;
    if (
      !verification.verified
      || authenticationInfo.credentialID !== credential.credentialId
      || !Number.isSafeInteger(authenticationInfo.newCounter)
      || authenticationInfo.newCounter < 0
      || authenticationInfo.newCounter > MAX_AUTHENTICATOR_COUNTER
    ) {
      await client.query(
        `WITH invalidated AS (
           UPDATE auth_challenges
           SET invalidated_at = $2
           WHERE id = $1
           RETURNING id
         )
         INSERT INTO auth_security_events (
           event_type,
           outcome,
           user_id,
           subject_hash,
           metadata,
           created_at
         )
         SELECT
           'login_failed',
           'denied',
           $3,
           $4,
           JSONB_BUILD_OBJECT('reason_code', 'passkey_verification_failed'),
           $2
         WHERE EXISTS (SELECT 1 FROM invalidated)`,
        [
          storedChallenge.challengeId,
          actionNow,
          credential.userId,
          challengeHash,
        ],
      );
      await client.query("COMMIT");
      logWarn("auth_v2.passkey_authentication_denied", {
        reasonCode: "verification_failed",
      });
      return { ok: false, code: "verification_failed" };
    }

    const nextToken = randomBytes(32).toString("hex");
    const nextTokenHash = createHash("sha256").update(nextToken).digest("hex");
    const deviceType = authenticationInfo.credentialDeviceType;
    const backedUp = authenticationInfo.credentialBackedUp;
    const backupEligible = deviceType === "multiDevice";
    const updated = await client.query<{ sessionId: string }>(
      `WITH updated_passkey AS (
         UPDATE user_passkeys
         SET
           counter = $2,
           device_type = $3,
           backed_up = $4,
           backup_eligible = $5,
           last_used_at = GREATEST($6, created_at)
         WHERE id = $1
           AND counter = $7
         RETURNING user_id
       ),
       authenticated_account AS (
         UPDATE users AS account
         SET
           last_authenticated_at = $6,
           updated_at = $6
         FROM updated_passkey
         WHERE account.id = updated_passkey.user_id
           AND account.status = 'active'
           AND account.email_verified_at IS NOT NULL
         RETURNING account.id
       ),
       created_session AS (
         INSERT INTO auth_sessions (
           user_id,
           workspace_id,
           token_hash,
           auth_method,
           request_ip_hash,
           user_agent_hash,
           device_label,
           browser_label,
           environment_label,
           created_at,
           last_seen_at,
           idle_expires_at,
           absolute_expires_at,
           rotated_at,
           last_authenticated_at
         )
         SELECT
           authenticated_account.id,
           NULL,
           $8,
           'passkey',
           $9,
           $10,
           $11,
           $12,
           $13,
           $6,
           $6,
           $6 + INTERVAL '14 days',
           $6 + INTERVAL '30 days',
           $6,
           $6
         FROM authenticated_account
         RETURNING id, user_id, workspace_id
       ),
       revoked_previous AS (
         UPDATE auth_sessions AS previous_session
         SET
           revoked_at = GREATEST(previous_session.created_at, $6),
           revoke_reason = 'security_action'
         WHERE previous_session.id = $15::BIGINT
           AND previous_session.user_id = $16::BIGINT
           AND previous_session.revoked_at IS NULL
           AND EXISTS (SELECT 1 FROM created_session)
         RETURNING previous_session.*
       ),
       recorded_previous AS (
         INSERT INTO auth_security_events (
           event_type,
           user_id,
           workspace_id,
           session_id,
           request_ip_hash,
           user_agent_hash,
           metadata,
           created_at
         )
         SELECT
           'session_revoked',
           revoked_previous.user_id,
           revoked_previous.workspace_id,
           revoked_previous.id,
           revoked_previous.request_ip_hash,
           revoked_previous.user_agent_hash,
           JSONB_BUILD_OBJECT(
             'reason_code',
             'security_action',
             'revoke_scope',
             'current'
           ),
           revoked_previous.revoked_at
         FROM revoked_previous
         RETURNING id
       ),
       consumed AS (
         UPDATE auth_challenges
         SET consumed_at = $6
         WHERE id = $14
           AND consumed_at IS NULL
           AND invalidated_at IS NULL
           AND EXISTS (SELECT 1 FROM created_session)
         RETURNING id
       ),
       recorded AS (
         INSERT INTO auth_security_events (
           event_type,
           user_id,
           workspace_id,
           session_id,
           request_ip_hash,
           user_agent_hash,
           metadata,
           created_at
         )
         SELECT
           event.event_type,
           created_session.user_id,
           created_session.workspace_id,
           created_session.id,
           $9,
           $10,
           event.metadata,
           $6
         FROM created_session
         CROSS JOIN (
           VALUES
             (
               'login_succeeded'::TEXT,
               JSONB_BUILD_OBJECT('method', 'passkey')
             ),
             (
               'session_created'::TEXT,
               JSONB_BUILD_OBJECT('method', 'passkey')
             )
         ) AS event(event_type, metadata)
         WHERE EXISTS (SELECT 1 FROM consumed)
         RETURNING id
       )
       SELECT created_session.id::TEXT AS "sessionId"
       FROM created_session
       WHERE EXISTS (SELECT 1 FROM consumed)
         AND (SELECT COUNT(*) FROM recorded) = 2
         AND (
           SELECT COUNT(*) FROM recorded_previous
         ) = (
           SELECT COUNT(*) FROM revoked_previous
         )`,
      [
        credential.id,
        authenticationInfo.newCounter,
        deviceType,
        backedUp,
        backupEligible,
        actionNow,
        currentCounter,
        nextTokenHash,
        hashes.requestIpHash,
        hashes.userAgentHash,
        input.sessionEnvironment?.deviceLabel ?? null,
        input.sessionEnvironment?.browserLabel ?? null,
        input.sessionEnvironment?.environmentLabel ?? null,
        storedChallenge.challengeId,
        input.replaceSession?.id ?? null,
        input.replaceSession?.userId ?? null,
      ],
    );
    const sessionId = updated.rows[0]?.sessionId;
    if (!sessionId) {
      await rollbackQuietly(client);
      return { ok: false, code: "verification_failed" };
    }
    await client.query("COMMIT");
    await sendPasskeySecurityNotice({
      template: "new_login",
      email: credential.email,
      displayName: credential.displayName,
      deviceLabel: [
        input.sessionEnvironment?.browserLabel,
        input.sessionEnvironment?.environmentLabel,
      ].filter(Boolean).join(" · ")
        || input.sessionEnvironment?.deviceLabel
        || null,
    });
    return {
      ok: true,
      userId: credential.userId,
      onboardingRequired: credential.onboardingStatus !== "completed",
      returnTo: sanitizeAuthReturnTo(storedChallenge.returnTo),
      session: { id: sessionId, token: nextToken },
    };
  } catch (error) {
    await rollbackQuietly(client);
    logError("auth_v2.passkey_authentication_finish_failed", error);
    return { ok: false, code: "unavailable" };
  } finally {
    client.release();
  }
}

export async function listUserPasskeys(userId: string): Promise<UserPasskey[]> {
  if (!validId(userId)) return [];
  const pool = getPool();
  if (!pool) return [];
  try {
    const result = await pool.query<UserPasskey>(
      `SELECT
         passkey.id::TEXT AS id,
         passkey.name,
         passkey.device_type AS "deviceType",
         passkey.backed_up AS "backedUp",
         passkey.backup_eligible AS "backupEligible",
         passkey.transports,
         passkey.created_at AS "createdAt",
         passkey.last_used_at AS "lastUsedAt"
       FROM user_passkeys AS passkey
       JOIN users AS account ON account.id = passkey.user_id
       WHERE passkey.user_id = $1
         AND account.status = 'active'
         AND account.email_verified_at IS NOT NULL
       ORDER BY
         passkey.last_used_at DESC NULLS LAST,
         passkey.created_at DESC,
         passkey.id DESC`,
      [userId],
    );
    return result.rows.map((row) => ({
      ...row,
      transports: normalizeTransports(row.transports),
    }));
  } catch (error) {
    logError("auth_v2.passkey_list_failed", error);
    return [];
  }
}

export async function renameUserPasskey(input: {
  userId: string;
  passkeyId: string;
  name: unknown;
  env?: AuthEnvironment;
}): Promise<boolean> {
  const name = normalizeName(input.name);
  if (
    !validId(input.userId)
    || !validId(input.passkeyId)
    || !name
    || !isAuthPasskeysEnabledForUser(input.userId, input.env)
  ) {
    return false;
  }
  const pool = getPool();
  if (!pool) return false;
  try {
    const result = await pool.query(
      `UPDATE user_passkeys AS passkey
       SET name = $3
       FROM users AS account
       WHERE passkey.id = $1
         AND passkey.user_id = $2
         AND account.id = passkey.user_id
         AND account.status = 'active'
         AND account.email_verified_at IS NOT NULL`,
      [input.passkeyId, input.userId, name],
    );
    return result.rowCount === 1;
  } catch (error) {
    logError("auth_v2.passkey_rename_failed", error);
    return false;
  }
}

export async function removeUserPasskey(input: {
  session: AuthSession;
  passkeyId: string;
  now?: Date;
  env?: AuthEnvironment;
}): Promise<"removed" | "reauth_required" | "unavailable"> {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  if (
    !validId(input.session.userId)
    || !validId(input.session.id)
    || !validId(input.session.workspaceId ?? "")
    || !validId(input.passkeyId)
    || !isAuthPasskeysEnabledForUser(input.session.userId, env)
    || !isRecentAuthentication(input.session, now)
  ) {
    return isRecentAuthentication(input.session, now)
      ? "unavailable"
      : "reauth_required";
  }
  const client = await getClient();
  if (!client) return "unavailable";
  try {
    await client.query("BEGIN");
    const removed = await client.query<{
      id: string;
      name: string;
      email: string;
      displayName: string | null;
    }>(
      `WITH active_account AS (
          SELECT
            account.id,
            account.email,
            account.full_name AS "displayName"
         FROM users AS account
         JOIN auth_sessions AS session ON session.user_id = account.id
         WHERE account.id = $1
           AND account.status = 'active'
           AND account.email_verified_at IS NOT NULL
           AND session.id = $2
           AND session.workspace_id = $3
           AND session.revoked_at IS NULL
           AND session.idle_expires_at > $5
           AND session.absolute_expires_at > $5
           AND session.last_authenticated_at >= $5 - INTERVAL '10 minutes'
         FOR UPDATE OF account, session
       ),
       removed AS (
         DELETE FROM user_passkeys AS passkey
         USING active_account
         WHERE passkey.id = $4
           AND passkey.user_id = active_account.id
          RETURNING passkey.id, passkey.user_id, passkey.name
       ),
       recorded AS (
         INSERT INTO auth_security_events (
           event_type,
           user_id,
           workspace_id,
           session_id,
           metadata,
           created_at
         )
         SELECT
           'passkey_removed',
           removed.user_id,
           $3,
           $2,
           JSONB_BUILD_OBJECT('reason_code', 'user_requested'),
           $5
         FROM removed
         RETURNING id
       )
        SELECT
          removed.id::TEXT AS id,
          removed.name,
          active_account.email,
          active_account."displayName"
        FROM removed
        JOIN active_account ON active_account.id = removed.user_id
        WHERE EXISTS (SELECT 1 FROM recorded)`,
      [
        input.session.userId,
        input.session.id,
        input.session.workspaceId,
        input.passkeyId,
        now,
      ],
    );
    await client.query("COMMIT");
    const passkey = removed.rows[0];
    if (!passkey) return "unavailable";
    await sendPasskeySecurityNotice({
      template: "passkey_removed",
      email: passkey.email,
      displayName: passkey.displayName,
      deviceLabel: passkey.name,
    });
    return "removed";
  } catch (error) {
    await rollbackQuietly(client);
    logError("auth_v2.passkey_remove_failed", error);
    return "unavailable";
  } finally {
    client.release();
  }
}
