import { getPool } from "@/lib/db-pool";
import {
  loadOnboardingSnapshot,
  saveOnboardingProgress,
  type OnboardingContext,
} from "@/lib/auth-v2/onboarding";

const describeDatabase =
  process.env.AUTH_V2_ONBOARDING_DB_TEST === "true" ? describe : describe.skip;

describeDatabase("auth v2 onboarding PostgreSQL integration", () => {
  const pool = getPool();
  let owner: OnboardingContext;
  let recruiter: OnboardingContext;

  beforeAll(async () => {
    if (!pool) throw new Error("DATABASE_URL is required.");
    const database = await pool.query<{ name: string }>(
      "SELECT CURRENT_DATABASE() AS name",
    );
    if (!/^auth_v2_test_onboarding_[a-z0-9_]+$/.test(
      database.rows[0]?.name ?? "",
    )) {
      throw new Error(
        "Refusing to run outside auth_v2_test_onboarding_<suffix>.",
      );
    }

    owner = await createFixture("owner");
    recruiter = await createFixture("recruiter", owner.workspaceId);
  });

  afterAll(async () => {
    await pool?.end();
  });

  test("persists every step, resumes it, and upserts one owner profile", async () => {
    await saveOnboardingProgress(owner, {
      step: "agency",
      intent: "next",
      values: {
        fullName: "Анна Смирнова",
        agencyName: "North Star",
        teamRole: "leader",
      },
    });
    await expect(loadOnboardingSnapshot(owner)).resolves.toMatchObject({
      status: "in_progress",
      step: "profile",
      data: {
        fullName: "Анна Смирнова",
        agencyName: "North Star",
      },
    });

    await Promise.all([
      saveOnboardingProgress(owner, {
        step: "profile",
        intent: "next",
        values: {
          specialization: "Product и Data",
          roles: ["data", "product"],
          industries: ["it"],
          geography: "Москва, Санкт-Петербург",
          hiringMode: "specialist",
        },
      }),
      saveOnboardingProgress(owner, {
        step: "profile",
        intent: "next",
        values: {
          specialization: "Product и Data",
          roles: ["data", "product"],
          industries: ["it"],
          geography: "Москва, Санкт-Петербург",
          hiringMode: "specialist",
        },
      }),
    ]);

    const profile = await pool!.query<{
      count: number;
      workspaceId: string;
      contactPolicy: string;
    }>(
      `SELECT
         COUNT(*)::INTEGER AS count,
         MIN(workspace_id)::TEXT AS "workspaceId",
         MIN(contact_policy::TEXT) AS "contactPolicy"
       FROM client_profiles
       WHERE owner_id = $1`,
      [owner.userId],
    );
    expect(profile.rows[0]).toEqual({
      count: 1,
      workspaceId: owner.workspaceId,
      contactPolicy: "corporate_only",
    });

    await Promise.all([
      saveOnboardingProgress(owner, {
        step: "complete",
        intent: "finish",
        values: {},
      }),
      saveOnboardingProgress(owner, {
        step: "complete",
        intent: "finish",
        values: {},
      }),
    ]);
    await expect(loadOnboardingSnapshot(owner)).resolves.toMatchObject({
      status: "completed",
      step: "complete",
    });
    const audit = await pool!.query<{ count: number }>(
      `SELECT COUNT(*)::INTEGER AS count
       FROM auth_security_events
       WHERE event_type = 'onboarding_completed'
         AND user_id = $1
         AND workspace_id = $2`,
      [owner.userId, owner.workspaceId],
    );
    expect(audit.rows[0]?.count).toBe(1);
  });

  test("does not let a non-owner member create or overwrite a team profile", async () => {
    const workspaceBefore = await pool!.query<{ name: string }>(
      "SELECT name FROM workspaces WHERE id = $1",
      [recruiter.workspaceId],
    );
    await saveOnboardingProgress(recruiter, {
      step: "agency",
      intent: "next",
      values: {
        fullName: "Иван Петров",
        agencyName: "Forged Agency",
        teamRole: "recruiter",
      },
    });
    await saveOnboardingProgress(recruiter, {
      step: "profile",
      intent: "next",
      values: {
        specialization: "Forged",
        roles: ["sales"],
        industries: ["retail"],
        geography: "Казань",
        hiringMode: "volume",
      },
    });

    const profile = await pool!.query<{ count: number }>(
      `SELECT COUNT(*)::INTEGER AS count
       FROM client_profiles
       WHERE owner_id = $1`,
      [recruiter.userId],
    );
    expect(profile.rows[0]?.count).toBe(0);
    const workspaceAfter = await pool!.query<{ name: string }>(
      "SELECT name FROM workspaces WHERE id = $1",
      [recruiter.workspaceId],
    );
    expect(workspaceAfter.rows[0]?.name).toBe(workspaceBefore.rows[0]?.name);
  });

  test("rejects direct completion before required persisted steps", async () => {
    const freshOwner = await createFixture("owner");

    await expect(saveOnboardingProgress(freshOwner, {
      step: "complete",
      intent: "finish",
      values: {},
    })).rejects.toMatchObject({ name: "OnboardingValidationError" });

    const state = await pool!.query<{
      status: string;
      step: string | null;
      eventCount: number;
    }>(
      `SELECT
         account.onboarding_status AS status,
         account.onboarding_step AS step,
         (
           SELECT COUNT(*)::INTEGER
           FROM auth_security_events AS event
           WHERE event.event_type = 'onboarding_completed'
             AND event.user_id = account.id
         ) AS "eventCount"
       FROM users AS account
       WHERE account.id = $1`,
      [freshOwner.userId],
    );
    expect(state.rows[0]).toEqual({
      status: "not_started",
      step: null,
      eventCount: 0,
    });
  });

  test("owner agency save renames workspace and profile skip preserves canonical fields", async () => {
    const existingOwner = await createFixture("owner");
    await pool!.query(
      `INSERT INTO client_profiles (
         owner_id,
         workspace_id,
         agency_name,
         target_city,
         specialization,
         industries,
         roles,
         contact_policy,
         hiring_mode,
         updated_at
       )
       VALUES (
         $1,
         $2,
         'Legacy Agency',
         'Москва',
         'Executive search',
         '["finance"]'::JSONB,
         ARRAY['executive']::TEXT[],
         'corporate_only',
         'specialist',
         NOW()
       )`,
      [existingOwner.userId, existingOwner.workspaceId],
    );

    await expect(saveOnboardingProgress(existingOwner, {
      step: "agency",
      intent: "next",
      values: {
        fullName: "Ольга Иванова",
        agencyName: "North Star",
        teamRole: "founder",
      },
    })).resolves.toMatchObject({
      workspaceName: "North Star",
      step: "profile",
    });
    await saveOnboardingProgress(existingOwner, {
      step: "profile",
      intent: "skip",
      values: {
        specialization: null,
        roles: [],
        industries: [],
        geography: null,
        hiringMode: "auto",
      },
    });

    const persisted = await pool!.query<{
      workspaceName: string;
      agencyName: string;
      targetCity: string | null;
      specialization: string | null;
      industries: string[];
      roles: string[];
      hiringMode: string;
    }>(
      `SELECT
         workspace.name AS "workspaceName",
         profile.agency_name AS "agencyName",
         profile.target_city AS "targetCity",
         profile.specialization,
         profile.industries,
         profile.roles,
         profile.hiring_mode AS "hiringMode"
       FROM client_profiles AS profile
       JOIN workspaces AS workspace
         ON workspace.id = profile.workspace_id
       WHERE profile.owner_id = $1`,
      [existingOwner.userId],
    );
    expect(persisted.rows[0]).toEqual({
      workspaceName: "North Star",
      agencyName: "North Star",
      targetCity: "Москва",
      specialization: "Executive search",
      industries: ["finance"],
      roles: ["executive"],
      hiringMode: "specialist",
    });
  });

  async function createFixture(
    role: "owner" | "recruiter",
    existingWorkspaceId?: string,
  ): Promise<OnboardingContext> {
    const suffix = `${role}-${Date.now()}-${Math.random()}`;
    const user = await pool!.query<{ id: string }>(
      `INSERT INTO users (
         email,
         email_normalized,
         email_verified_at,
         created_at,
         updated_at
       )
       VALUES ($1, $1, NOW(), NOW(), NOW())
       RETURNING id::TEXT AS id`,
      [`onboarding-${suffix}@example.invalid`],
    );
    const userId = user.rows[0]!.id;
    let workspaceId = existingWorkspaceId;
    if (!workspaceId) {
      const workspace = await pool!.query<{ id: string }>(
        "SELECT ensure_auth_user_workspace($1)::TEXT AS id",
        [userId],
      );
      workspaceId = workspace.rows[0]!.id;
    } else {
      await pool!.query(
        `INSERT INTO workspace_members (
           workspace_id,
           user_id,
           role,
           status,
           joined_at,
           updated_at
         )
         VALUES ($1, $2, $3, 'active', NOW(), NOW())`,
        [workspaceId, userId, role],
      );
    }
    const session = await pool!.query<{ id: string }>(
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
         ENCODE(DIGEST($3, 'sha256'), 'hex'),
         'magic_link',
         NOW(),
         NOW(),
         NOW() + INTERVAL '14 days',
         NOW() + INTERVAL '30 days',
         NOW(),
         NOW()
       )
       RETURNING id::TEXT AS id`,
      [userId, workspaceId, suffix],
    );
    const workspace = await pool!.query<{ name: string }>(
      "SELECT name FROM workspaces WHERE id = $1",
      [workspaceId],
    );
    return {
      userId,
      workspaceId,
      workspaceName: workspace.rows[0]!.name,
      workspaceRole: role,
      sessionId: session.rows[0]!.id,
    };
  }
});
