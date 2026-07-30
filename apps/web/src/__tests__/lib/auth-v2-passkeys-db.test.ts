jest.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: jest.fn(),
  generateRegistrationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
}));
jest.mock("@/lib/email/transport", () => ({
  sendEmail: jest.fn(async () => ({ ok: true })),
}));

import { verifyAuthenticationResponse } from "@simplewebauthn/server";

import { getPool } from "@/lib/db-pool";
import {
  beginPasskeyRegistration,
  finishPasskeyAuthentication,
  hashPasskeyChallenge,
} from "@/lib/auth-v2/passkeys";

const enabled = process.env.AUTH_V2_PASSKEY_DB_TEST === "true";
const describeDatabase = enabled ? describe : describe.skip;
const mockVerifyAuthentication = jest.mocked(verifyAuthenticationResponse);
const credentialId = "credential-db-test";
let userId = "";
let workspaceId = "";

function response(challenge: string, id = credentialId) {
  return {
    id,
    rawId: id,
    type: "public-key",
    clientExtensionResults: {},
    response: {
      authenticatorData: "authenticator-data",
      clientDataJSON: Buffer.from(JSON.stringify({
        challenge,
        origin: "https://radar.example",
        type: "webauthn.get",
      })).toString("base64url"),
      signature: "signature",
      userHandle: null,
    },
  } as never;
}

describeDatabase("auth v2 passkeys PostgreSQL integration", () => {
  beforeAll(async () => {
    const pool = getPool();
    if (!pool) throw new Error("DATABASE_URL is required.");
    const account = await pool.query<{ id: string }>(
      `INSERT INTO users (
         email,
         email_normalized,
         email_verified_at,
         onboarding_status,
         created_at,
         updated_at
       )
       VALUES (
         'passkey-owner@example.invalid',
         'passkey-owner@example.invalid',
         NOW(),
         'completed',
         NOW(),
         NOW()
       )
       RETURNING id::TEXT AS id`,
    );
    userId = account.rows[0].id;
    const workspace = await pool.query<{ id: string }>(
      "SELECT ensure_auth_user_workspace($1)::TEXT AS id",
      [userId],
    );
    workspaceId = workspace.rows[0].id;
    await pool.query(
      `INSERT INTO user_passkeys (
         user_id,
         credential_id,
         public_key,
         counter,
         transports,
         device_type,
         backed_up,
         backup_eligible,
         name
       )
       VALUES (
         $1,
         $2,
         $3,
         0,
         ARRAY['internal'],
         'singleDevice',
         FALSE,
         FALSE,
         'Database key'
       )`,
      [userId, credentialId, Buffer.from([1, 2, 3])],
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyAuthentication.mockImplementation(async (options) => {
      const clientData = JSON.parse(
        Buffer.from(
          options.response.response.clientDataJSON,
          "base64url",
        ).toString("utf8"),
      ) as { challenge: string };
      if (
        typeof options.expectedChallenge !== "function"
        || !await options.expectedChallenge(clientData.challenge)
      ) {
        throw new Error("challenge mismatch");
      }
      expect(options.expectedOrigin).toBe("https://radar.example");
      expect(options.expectedRPID).toBe("radar.example");
      expect(options.requireUserVerification).toBe(true);
      if (options.credential.counter > 0) {
        throw new Error("counter rollback");
      }
      return {
        verified: true,
        authenticationInfo: {
          credentialID: credentialId,
          newCounter: 1,
          userVerified: true,
          credentialDeviceType: "multiDevice",
          credentialBackedUp: true,
        },
      } as never;
    });
  });

  afterAll(async () => {
    await getPool()?.end();
  });

  test("enforces credential, backup, and challenge schema invariants", async () => {
    const pool = getPool();
    if (!pool) throw new Error("DATABASE_URL is required.");

    await expect(pool.query(
      `INSERT INTO user_passkeys (
         user_id,
         credential_id,
         public_key,
         counter,
         device_type,
         backed_up,
         backup_eligible,
         name
       )
       VALUES ($1, $2, $3, 0, 'singleDevice', FALSE, FALSE, 'Duplicate')`,
      [userId, credentialId, Buffer.from([4])],
    )).rejects.toMatchObject({ code: "23505" });

    await expect(pool.query(
      `INSERT INTO user_passkeys (
         user_id,
         credential_id,
         public_key,
         counter,
         device_type,
         backed_up,
         backup_eligible,
         name
       )
       VALUES ($1, 'invalid-backup', $2, 0, 'singleDevice', TRUE, FALSE, 'Bad')`,
      [userId, Buffer.from([4])],
    )).rejects.toMatchObject({ code: "23514" });

    await expect(pool.query(
      `INSERT INTO user_passkeys (
         user_id,
         credential_id,
         public_key,
         counter,
         transports,
         device_type,
         backed_up,
         backup_eligible,
         name
       )
       VALUES (
         $1,
         'invalid-transport',
         $2,
         0,
         ARRAY['carrier-pigeon'],
         'singleDevice',
         FALSE,
         FALSE,
         'Bad transport'
       )`,
      [userId, Buffer.from([4])],
    )).rejects.toMatchObject({ code: "23514" });

    await expect(pool.query(
      `INSERT INTO auth_challenges (
         purpose,
         email_normalized,
         token_hash,
         return_to,
         send_status,
         expires_at
       )
       VALUES (
         'login',
         NULL,
         $1,
         '/dashboard',
         'suppressed',
         NOW() + INTERVAL '5 minutes'
       )`,
      [hashPasskeyChallenge("not-a-passkey-challenge")],
    )).rejects.toMatchObject({ code: "23514" });
  });

  test("has one counter winner, persists backup state, and rejects challenge replay", async () => {
    const pool = getPool();
    if (!pool) throw new Error("DATABASE_URL is required.");
    const challengeA = "database-authentication-challenge-a";
    const challengeB = "database-authentication-challenge-b";
    const previousSession = await pool.query<{ id: string }>(
      `INSERT INTO auth_sessions (
         user_id,
         workspace_id,
         token_hash,
         auth_method,
         created_at,
         last_seen_at,
         idle_expires_at,
         absolute_expires_at,
         rotated_at,
         last_authenticated_at
       )
       VALUES (
         $1,
         $2,
         $3,
         'magic_link',
         NOW(),
         NOW(),
         NOW() + INTERVAL '14 days',
         NOW() + INTERVAL '30 days',
         NOW(),
         NOW()
       )
       RETURNING id::TEXT AS id`,
      [
        userId,
        workspaceId,
        hashPasskeyChallenge("previous-browser-session-token"),
      ],
    );
    const replaceSession = {
      id: previousSession.rows[0].id,
      userId,
    };
    await insertChallenge(challengeA);
    await insertChallenge(challengeB);

    const results = await Promise.all([
      finishPasskeyAuthentication({
        response: response(challengeA),
        clientAddress: "203.0.113.8",
        replaceSession,
      }),
      finishPasskeyAuthentication({
        response: response(challengeB),
        clientAddress: "203.0.113.8",
        replaceSession,
      }),
    ]);
    const successful = results.filter((result) => result.ok);
    const denied = results.filter((result) => !result.ok);
    expect(successful).toHaveLength(1);
    expect(denied).toEqual([
      expect.objectContaining({ ok: false, code: "verification_failed" }),
    ]);

    const passkey = await pool.query<{
      counter: string;
      deviceType: string;
      backedUp: boolean;
      backupEligible: boolean;
    }>(
      `SELECT
         counter::TEXT AS counter,
         device_type AS "deviceType",
         backed_up AS "backedUp",
         backup_eligible AS "backupEligible"
       FROM user_passkeys
       WHERE credential_id = $1`,
      [credentialId],
    );
    expect(passkey.rows[0]).toEqual({
      counter: "1",
      deviceType: "multiDevice",
      backedUp: true,
      backupEligible: true,
    });

    const sessions = await pool.query<{
      count: number;
      allWorkspaceScoped: boolean;
      allMembershipsActive: boolean;
    }>(
      `SELECT
         COUNT(*)::INTEGER AS count,
         BOOL_AND(session.workspace_id IS NOT NULL) AS "allWorkspaceScoped",
         BOOL_AND(EXISTS (
           SELECT 1
           FROM workspace_members AS membership
           WHERE membership.workspace_id = session.workspace_id
             AND membership.user_id = session.user_id
             AND membership.status = 'active'
         )) AS "allMembershipsActive"
       FROM auth_sessions AS session
       WHERE session.user_id = $1
         AND session.auth_method = 'passkey'`,
      [userId],
    );
    expect(sessions.rows[0]).toEqual({
      count: 1,
      allWorkspaceScoped: true,
      allMembershipsActive: true,
    });

    const replacement = await pool.query<{
      revoked: boolean;
      reason: string | null;
      eventCount: number;
    }>(
      `SELECT
         session.revoked_at IS NOT NULL AS revoked,
         session.revoke_reason AS reason,
         (
           SELECT COUNT(*)::INTEGER
           FROM auth_security_events AS event
           WHERE event.session_id = session.id
             AND event.event_type = 'session_revoked'
             AND event.metadata->>'reason_code' = 'security_action'
         ) AS "eventCount"
       FROM auth_sessions AS session
       WHERE session.id = $1`,
      [replaceSession.id],
    );
    expect(replacement.rows[0]).toEqual({
      revoked: true,
      reason: "security_action",
      eventCount: 1,
    });

    const winningChallenge = successful[0].ok
      ? successful[0].session.id
        ? (
          results[0].ok ? challengeA : challengeB
        )
        : challengeA
      : challengeA;
    await expect(finishPasskeyAuthentication({
      response: response(winningChallenge),
      clientAddress: "203.0.113.8",
    })).resolves.toEqual({ ok: false, code: "challenge_replayed" });

    const challengeRows = await pool.query<{
      challengeHash: string;
      consumed: boolean;
      invalidated: boolean;
    }>(
      `SELECT
         token_hash AS "challengeHash",
         consumed_at IS NOT NULL AS consumed,
         invalidated_at IS NOT NULL AS invalidated
       FROM auth_challenges
       WHERE token_hash = ANY($1::TEXT[])
       ORDER BY token_hash`,
      [[
        hashPasskeyChallenge(challengeA),
        hashPasskeyChallenge(challengeB),
      ]],
    );
    expect(challengeRows.rows).toHaveLength(2);
    expect(challengeRows.rows.filter((row) => row.consumed)).toHaveLength(1);
    expect(challengeRows.rows.filter((row) => row.invalidated)).toHaveLength(1);
    expect(challengeRows.rows.every((row) => (
      row.challengeHash !== challengeA && row.challengeHash !== challengeB
    ))).toBe(true);

    const events = await pool.query<{ eventType: string; count: number }>(
      `SELECT
         event_type AS "eventType",
         COUNT(*)::INTEGER AS count
       FROM auth_security_events
       WHERE user_id = $1
         AND event_type IN (
           'login_succeeded',
           'session_created'
         )
       GROUP BY event_type`,
      [userId],
    );
    const counts = new Map(events.rows.map((row) => [row.eventType, row.count]));
    expect(counts.get("login_succeeded")).toBe(1);
    expect(counts.get("session_created")).toBe(1);
    const replayEvent = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::INTEGER AS count
       FROM auth_security_events
       WHERE event_type = 'challenge_replayed'
         AND subject_hash = $1`,
      [hashPasskeyChallenge(winningChallenge)],
    );
    expect(replayEvent.rows[0].count).toBe(1);
  });

  test("audits an unknown credential without binding the event to a user", async () => {
    const challenge = `unknown-${Date.now()}`;
    const pool = getPool();
    if (!pool) throw new Error("DATABASE_URL is required.");
    await insertChallenge(challenge);

    await expect(finishPasskeyAuthentication({
      response: response(challenge, "unknown-credential-db-test"),
      clientAddress: "203.0.113.20",
      now: new Date(),
    })).resolves.toEqual({
      ok: false,
      code: "verification_failed",
    });

    const event = await pool.query<{
      userId: string | null;
      outcome: string;
      reasonCode: string;
    }>(
      `SELECT
         user_id::TEXT AS "userId",
         outcome,
         metadata->>'reason_code' AS "reasonCode"
       FROM auth_security_events
       WHERE event_type = 'login_failed'
         AND subject_hash = $1`,
      [hashPasskeyChallenge(challenge)],
    );
    expect(event.rows).toEqual([{
      userId: null,
      outcome: "denied",
      reasonCode: "passkey_verification_failed",
    }]);
    expect(mockVerifyAuthentication).not.toHaveBeenCalled();
  });

  test("persists verification rate limits across unknown-challenge denials", async () => {
    const clientAddress = "203.0.113.99";
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await expect(finishPasskeyAuthentication({
        response: response(`missing-challenge-${attempt}`),
        clientAddress,
      })).resolves.toEqual({
        ok: false,
        code: "challenge_invalid",
      });
    }
    await expect(finishPasskeyAuthentication({
      response: response("missing-challenge-11"),
      clientAddress,
    })).resolves.toEqual({
      ok: false,
      code: "rate_limited",
    });
    expect(mockVerifyAuthentication).not.toHaveBeenCalled();
  });

  test("refuses to issue registration options after the per-user passkey cap", async () => {
    const pool = getPool();
    if (!pool) throw new Error("DATABASE_URL is required.");
    const actionNow = new Date();
    await pool.query(
      `INSERT INTO user_passkeys (
         user_id,
         credential_id,
         public_key,
         counter,
         transports,
         device_type,
         backed_up,
         backup_eligible,
         name
       )
       SELECT
         $1,
         'cap-credential-' || ordinal::TEXT,
         DECODE('01', 'hex'),
         0,
         ARRAY['internal'],
         'singleDevice',
         FALSE,
         FALSE,
         'Cap key ' || ordinal::TEXT
       FROM GENERATE_SERIES(1, 19) AS ordinal`,
      [userId],
    );
    const session = await pool.query<{ id: string }>(
      `INSERT INTO auth_sessions (
         user_id,
         workspace_id,
         token_hash,
         auth_method,
         created_at,
         last_seen_at,
         idle_expires_at,
         absolute_expires_at,
         rotated_at,
         last_authenticated_at
       )
       VALUES (
         $1,
         $2,
         $3,
         'magic_link',
         $4::TIMESTAMPTZ,
         $4::TIMESTAMPTZ,
         $4::TIMESTAMPTZ + INTERVAL '14 days',
         $4::TIMESTAMPTZ + INTERVAL '30 days',
         $4::TIMESTAMPTZ,
         $4::TIMESTAMPTZ
       )
       RETURNING id::TEXT AS id`,
      [
        userId,
        workspaceId,
        hashPasskeyChallenge("registration-cap-session-token"),
        actionNow,
      ],
    );

    await expect(beginPasskeyRegistration({
      session: {
        id: session.rows[0].id,
        userId,
        workspaceId,
        lastAuthenticatedAt: actionNow,
      } as never,
      now: actionNow,
    })).resolves.toBeNull();

    const counts = await pool.query<{ count: number; challengeCount: number }>(
      `SELECT
         (SELECT COUNT(*)::INTEGER FROM user_passkeys WHERE user_id = $1)
           AS count,
         (
           SELECT COUNT(*)::INTEGER
           FROM auth_challenges
           WHERE user_id = $1
             AND purpose = 'passkey_registration'
             AND created_at >= $2
         ) AS "challengeCount"`,
      [userId, actionNow],
    );
    expect(counts.rows[0]).toEqual({
      count: 20,
      challengeCount: 0,
    });
  });
});

async function insertChallenge(challenge: string): Promise<void> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is required.");
  await pool.query(
    `INSERT INTO auth_challenges (
       purpose,
       email_normalized,
       user_id,
       workspace_id,
       token_hash,
       return_to,
       send_status,
       expires_at
     )
     VALUES (
       'passkey_authentication',
       NULL,
       NULL,
       NULL,
       $1,
       '/dashboard',
       'suppressed',
       NOW() + INTERVAL '5 minutes'
     )`,
    [hashPasskeyChallenge(challenge)],
  );
}
