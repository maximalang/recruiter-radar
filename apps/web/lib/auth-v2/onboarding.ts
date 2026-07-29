import type { PoolClient } from "pg";

import {
  HIRING_MODE_OPTIONS,
  INDUSTRY_OPTIONS,
  ROLE_OPTIONS,
} from "../clientProfileOptions";
import { getClient, getPool } from "../db-pool";
import { logError } from "../runtime";
import { isAuthOnboardingV2EnabledForUser } from "./config";
import { readAuthV2SessionCookie } from "./session-cookie";
import { readAuthSession } from "./sessions";
import {
  requireWorkspace,
  type WorkspaceRole,
} from "./workspaces";

export const ONBOARDING_STEPS = ["agency", "profile", "complete"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type OnboardingStatus = "not_started" | "in_progress" | "completed";

export const ONBOARDING_TEAM_ROLE_OPTIONS = [
  { key: "founder", label: "Основатель или партнёр" },
  { key: "leader", label: "Руководитель практики" },
  { key: "recruiter", label: "Рекрутер" },
  { key: "analyst", label: "Аналитик или ресёрчер" },
  { key: "other", label: "Другая роль" },
] as const;

export type OnboardingTeamRole =
  (typeof ONBOARDING_TEAM_ROLE_OPTIONS)[number]["key"];
export type OnboardingHiringMode =
  (typeof HIRING_MODE_OPTIONS)[number]["key"];

export type OnboardingData = {
  fullName?: string;
  agencyName?: string;
  teamRole?: OnboardingTeamRole;
  specialization?: string;
  roles?: string[];
  industries?: string[];
  geography?: string[];
  hiringMode?: OnboardingHiringMode;
};

export type OnboardingContext = {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceRole: WorkspaceRole;
  sessionId: string;
};

export type OnboardingSnapshot = {
  status: OnboardingStatus;
  step: OnboardingStep;
  data: OnboardingData;
  workspaceName: string;
  workspaceRole: WorkspaceRole;
};

export type OnboardingDbClient = Pick<PoolClient, "query">;

export type OnboardingAgencyInput = {
  fullName: unknown;
  agencyName: unknown;
  teamRole: unknown;
};

export type OnboardingProfileInput = {
  specialization: unknown;
  roles: readonly unknown[];
  industries: readonly unknown[];
  geography: unknown;
  hiringMode: unknown;
};

export type OnboardingSubmission =
  | {
      step: "agency";
      intent: "next";
      values: OnboardingAgencyInput;
    }
  | {
      step: "profile";
      intent: "next" | "back" | "skip";
      values: OnboardingProfileInput;
    }
  | {
      step: "complete";
      intent: "back" | "finish";
      values: Record<string, never>;
    };

type LockedOnboardingRow = {
  onboardingStatus: string;
  onboardingStep: string | null;
  onboardingData: unknown;
  workspaceRole: string;
  workspaceName: string;
};

type SnapshotRow = LockedOnboardingRow & {
  fullName: string | null;
  displayName: string | null;
  profileAgencyName: string | null;
  profileSpecialization: string | null;
  profileRoles: unknown;
  profileIndustries: unknown;
  profileTargetCity: string | null;
  profileHiringMode: string | null;
};

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const POSITIVE_ID = /^[1-9]\d*$/;
const TEAM_ROLE_KEYS = new Set<string>(
  ONBOARDING_TEAM_ROLE_OPTIONS.map((option) => option.key),
);
const ROLE_KEYS = new Set(ROLE_OPTIONS.map((option) => option.key));
const INDUSTRY_KEYS = new Set(INDUSTRY_OPTIONS.map((option) => option.key));
const HIRING_MODE_KEYS = new Set<string>(
  HIRING_MODE_OPTIONS.map((option) => option.key),
);
const WORKSPACE_ROLES = new Set<WorkspaceRole>([
  "owner",
  "admin",
  "recruiter",
  "viewer",
  "billing",
]);

export class OnboardingValidationError extends Error {
  constructor(message = "Onboarding input is invalid.") {
    super(message);
    this.name = "OnboardingValidationError";
  }
}

export class OnboardingAccessError extends Error {
  constructor(message = "Active onboarding workspace access is required.") {
    super(message);
    this.name = "OnboardingAccessError";
  }
}

function normalizeSingleLine(
  value: unknown,
  options: { required: boolean; maxBytes: number },
): string | undefined {
  if ((value === null || value === undefined) && !options.required) {
    return undefined;
  }
  if (typeof value !== "string" || CONTROL_CHARACTERS.test(value)) {
    throw new OnboardingValidationError();
  }
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!normalized) {
    if (options.required) throw new OnboardingValidationError();
    return undefined;
  }
  if (Buffer.byteLength(normalized, "utf8") > options.maxBytes) {
    throw new OnboardingValidationError();
  }
  return normalized;
}

function normalizeKnownKey<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
): T {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new OnboardingValidationError();
  }
  return value as T;
}

function normalizeKnownList(
  values: readonly unknown[],
  allowed: ReadonlySet<string>,
  maxItems: number,
): string[] {
  if (!Array.isArray(values) || values.length > maxItems * 2) {
    throw new OnboardingValidationError();
  }
  const normalized: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !allowed.has(value)) {
      throw new OnboardingValidationError();
    }
    if (!normalized.includes(value)) normalized.push(value);
  }
  if (normalized.length > maxItems) throw new OnboardingValidationError();
  return normalized;
}

function normalizeGeography(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 900) {
    throw new OnboardingValidationError();
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const rawPart of value.split(/[,;\n]+/u)) {
    const part = normalizeSingleLine(rawPart, {
      required: false,
      maxBytes: 80,
    });
    if (!part) continue;
    const key = part.toLocaleLowerCase("ru-RU");
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(part);
    }
  }
  if (normalized.length > 10) throw new OnboardingValidationError();
  return normalized;
}

export function normalizeOnboardingAgencyInput(
  input: OnboardingAgencyInput,
): Required<Pick<OnboardingData, "fullName" | "agencyName" | "teamRole">> {
  return {
    fullName: normalizeSingleLine(input.fullName, {
      required: true,
      maxBytes: 120,
    })!,
    agencyName: normalizeSingleLine(input.agencyName, {
      required: true,
      maxBytes: 160,
    })!,
    teamRole: normalizeKnownKey<OnboardingTeamRole>(
      input.teamRole,
      TEAM_ROLE_KEYS,
    ),
  };
}

export function normalizeOnboardingProfileInput(
  input: OnboardingProfileInput,
): Required<
  Pick<
    OnboardingData,
    "specialization" | "roles" | "industries" | "geography" | "hiringMode"
  >
> {
  return {
    specialization: normalizeSingleLine(input.specialization, {
      required: false,
      maxBytes: 240,
    }) ?? "",
    roles: normalizeKnownList(input.roles, ROLE_KEYS, ROLE_OPTIONS.length),
    industries: normalizeKnownList(
      input.industries,
      INDUSTRY_KEYS,
      INDUSTRY_OPTIONS.length,
    ),
    geography: normalizeGeography(input.geography),
    hiringMode: normalizeKnownKey<OnboardingHiringMode>(
      input.hiringMode,
      HIRING_MODE_KEYS,
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeSingleLine(
  value: unknown,
  maxBytes: number,
): string | undefined {
  try {
    return normalizeSingleLine(value, { required: false, maxBytes });
  } catch {
    return undefined;
  }
}

function safeKnownList(
  value: unknown,
  allowed: ReadonlySet<string>,
  maxItems: number,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  try {
    return normalizeKnownList(value, allowed, maxItems);
  } catch {
    return undefined;
  }
}

function normalizePersistedData(value: unknown): OnboardingData {
  if (!isRecord(value)) return {};
  const fullName = safeSingleLine(value.fullName, 120);
  const agencyName = safeSingleLine(value.agencyName, 160);
  const specialization = safeSingleLine(value.specialization, 240);
  const roles = safeKnownList(value.roles, ROLE_KEYS, ROLE_OPTIONS.length);
  const industries = safeKnownList(
    value.industries,
    INDUSTRY_KEYS,
    INDUSTRY_OPTIONS.length,
  );
  const geography = Array.isArray(value.geography)
    ? value.geography.flatMap((entry) => {
        const item = safeSingleLine(entry, 80);
        return item ? [item] : [];
      }).slice(0, 10)
    : undefined;
  const teamRole =
    typeof value.teamRole === "string" && TEAM_ROLE_KEYS.has(value.teamRole)
      ? value.teamRole as OnboardingTeamRole
      : undefined;
  const hiringMode =
    typeof value.hiringMode === "string"
      && HIRING_MODE_KEYS.has(value.hiringMode)
      ? value.hiringMode as OnboardingHiringMode
      : undefined;

  return {
    ...(fullName ? { fullName } : {}),
    ...(agencyName ? { agencyName } : {}),
    ...(teamRole ? { teamRole } : {}),
    ...(specialization ? { specialization } : {}),
    ...(roles ? { roles } : {}),
    ...(industries ? { industries } : {}),
    ...(geography ? { geography } : {}),
    ...(hiringMode ? { hiringMode } : {}),
  };
}

function normalizeStep(value: unknown, status: unknown): OnboardingStep {
  if (status === "completed") return "complete";
  return typeof value === "string"
    && (ONBOARDING_STEPS as readonly string[]).includes(value)
    ? value as OnboardingStep
    : "agency";
}

function normalizeStatus(value: unknown): OnboardingStatus {
  return value === "in_progress" || value === "completed"
    ? value
    : "not_started";
}

function normalizeWorkspaceRole(value: unknown): WorkspaceRole | null {
  return typeof value === "string" && WORKSPACE_ROLES.has(value as WorkspaceRole)
    ? value as WorkspaceRole
    : null;
}

function validContext(context: OnboardingContext): boolean {
  return (
    POSITIVE_ID.test(context.userId)
    && POSITIVE_ID.test(context.workspaceId)
    && POSITIVE_ID.test(context.sessionId)
    && normalizeWorkspaceRole(context.workspaceRole) !== null
  );
}

export async function readOnboardingContext(): Promise<OnboardingContext | null> {
  const token = await readAuthV2SessionCookie().catch(() => null);
  if (!token) return null;
  const session = await readAuthSession(token);
  if (
    !session
    || session.rotationDue
    || !session.workspaceId
    || !isAuthOnboardingV2EnabledForUser(session.userId)
  ) {
    return null;
  }
  try {
    const workspace = await requireWorkspace({
      userId: session.userId,
      workspaceId: session.workspaceId,
    });
    return {
      userId: session.userId,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceRole: workspace.role,
      sessionId: session.id,
    };
  } catch {
    return null;
  }
}

export async function loadOnboardingSnapshot(
  context: OnboardingContext,
  db?: OnboardingDbClient,
): Promise<OnboardingSnapshot> {
  if (!validContext(context)) throw new OnboardingAccessError();
  const pool = db ?? getPool();
  if (!pool) throw new OnboardingAccessError();

  try {
    const result = await pool.query<SnapshotRow>(
      `SELECT
         account.onboarding_status AS "onboardingStatus",
         account.onboarding_step AS "onboardingStep",
         account.onboarding_data AS "onboardingData",
         account.full_name AS "fullName",
         account.display_name AS "displayName",
         membership.role AS "workspaceRole",
         workspace.name AS "workspaceName",
         profile.agency_name AS "profileAgencyName",
         profile.specialization AS "profileSpecialization",
         profile.roles AS "profileRoles",
         profile.industries AS "profileIndustries",
         profile.target_city AS "profileTargetCity",
         profile.hiring_mode AS "profileHiringMode"
       FROM users AS account
       JOIN workspace_members AS membership
         ON membership.user_id = account.id
        AND membership.workspace_id = $2
        AND membership.status = 'active'
       JOIN workspaces AS workspace
         ON workspace.id = membership.workspace_id
        AND workspace.status = 'active'
        AND workspace.deleted_at IS NULL
       LEFT JOIN client_profiles AS profile
         ON profile.owner_id = account.id
        AND (
          profile.workspace_id = workspace.id
          OR profile.workspace_id IS NULL
        )
       WHERE account.id = $1
         AND account.status = 'active'
       LIMIT 1`,
      [context.userId, context.workspaceId],
    );
    const row = result.rows[0];
    const workspaceRole = normalizeWorkspaceRole(row?.workspaceRole);
    if (!row || !workspaceRole) throw new OnboardingAccessError();

    const persisted = normalizePersistedData(row.onboardingData);
    const fallbackRoles = safeKnownList(
      row.profileRoles,
      ROLE_KEYS,
      ROLE_OPTIONS.length,
    );
    const fallbackIndustries = safeKnownList(
      row.profileIndustries,
      INDUSTRY_KEYS,
      INDUSTRY_OPTIONS.length,
    );
    const fallbackHiringMode =
      row.profileHiringMode && HIRING_MODE_KEYS.has(row.profileHiringMode)
        ? row.profileHiringMode as OnboardingHiringMode
        : undefined;
    let fallbackGeography: string[] | undefined;
    try {
      fallbackGeography = row.profileTargetCity
        ? normalizeGeography(row.profileTargetCity)
        : undefined;
    } catch {
      fallbackGeography = undefined;
    }

    return {
      status: normalizeStatus(row.onboardingStatus),
      step: normalizeStep(row.onboardingStep, row.onboardingStatus),
      workspaceName: row.workspaceName,
      workspaceRole,
      data: {
        ...(safeSingleLine(row.fullName ?? row.displayName, 120)
          ? { fullName: safeSingleLine(row.fullName ?? row.displayName, 120) }
          : {}),
        ...(safeSingleLine(row.profileAgencyName ?? row.workspaceName, 160)
          ? {
              agencyName: safeSingleLine(
                row.profileAgencyName ?? row.workspaceName,
                160,
              ),
            }
          : {}),
        ...(safeSingleLine(row.profileSpecialization, 240)
          ? {
              specialization: safeSingleLine(
                row.profileSpecialization,
                240,
              ),
            }
          : {}),
        ...(fallbackRoles ? { roles: fallbackRoles } : {}),
        ...(fallbackIndustries ? { industries: fallbackIndustries } : {}),
        ...(fallbackGeography ? { geography: fallbackGeography } : {}),
        ...(fallbackHiringMode ? { hiringMode: fallbackHiringMode } : {}),
        ...persisted,
      },
    };
  } catch (error) {
    if (!(error instanceof OnboardingAccessError)) {
      logError("auth_v2.onboarding_read_failed", error);
    }
    throw error;
  }
}

function mergeSubmission(
  existing: OnboardingData,
  submission: OnboardingSubmission,
): {
  data: OnboardingData;
  status: OnboardingStatus;
  step: OnboardingStep;
  syncProfile: boolean;
  recordCompletion: boolean;
} {
  if (submission.step === "agency") {
    if (submission.intent !== "next") throw new OnboardingValidationError();
    return {
      data: {
        ...existing,
        ...normalizeOnboardingAgencyInput(submission.values),
      },
      status: "in_progress",
      step: "profile",
      syncProfile: false,
      recordCompletion: false,
    };
  }

  if (submission.step === "profile") {
    if (submission.intent === "skip") {
      return {
        data: existing,
        status: "in_progress",
        step: "complete",
        syncProfile: true,
        recordCompletion: false,
      };
    }
    const profile = normalizeOnboardingProfileInput(submission.values);
    return {
      data: {
        ...existing,
        specialization: profile.specialization || undefined,
        roles: profile.roles,
        industries: profile.industries,
        geography: profile.geography,
        hiringMode: profile.hiringMode,
      },
      status: "in_progress",
      step: submission.intent === "back" ? "agency" : "complete",
      syncProfile: submission.intent === "next",
      recordCompletion: false,
    };
  }

  if (submission.intent === "back") {
    return {
      data: existing,
      status: "in_progress",
      step: "profile",
      syncProfile: false,
      recordCompletion: false,
    };
  }
  if (submission.intent !== "finish") throw new OnboardingValidationError();
  return {
    data: existing,
    status: "completed",
    step: "complete",
    syncProfile: false,
    recordCompletion: true,
  };
}

async function syncOwnerProfile(
  db: OnboardingDbClient,
  context: OnboardingContext,
  workspaceName: string,
  data: OnboardingData,
): Promise<void> {
  const agencyName = data.agencyName ?? workspaceName;
  const result = await db.query<{ id: string }>(
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
       $3,
       $4,
       $5,
       $6::JSONB,
       $7::TEXT[],
       'corporate_only',
       $8,
       NOW()
     )
     ON CONFLICT (owner_id) WHERE owner_id IS NOT NULL
     DO UPDATE SET
       workspace_id = EXCLUDED.workspace_id,
       agency_name = EXCLUDED.agency_name,
       target_city = EXCLUDED.target_city,
       specialization = EXCLUDED.specialization,
       industries = EXCLUDED.industries,
       roles = EXCLUDED.roles,
       contact_policy = 'corporate_only',
       hiring_mode = EXCLUDED.hiring_mode,
       updated_at = NOW()
     WHERE client_profiles.workspace_id = EXCLUDED.workspace_id
        OR client_profiles.workspace_id IS NULL
     RETURNING id::TEXT AS id`,
    [
      context.userId,
      context.workspaceId,
      agencyName,
      data.geography?.join(", ") || null,
      data.specialization || null,
      JSON.stringify(data.industries ?? []),
      data.roles ?? [],
      data.hiringMode ?? "auto",
    ],
  );
  if (result.rowCount !== 1) throw new OnboardingAccessError();
}

async function rollbackQuietly(db: OnboardingDbClient): Promise<void> {
  await db.query("ROLLBACK").catch(() => undefined);
}

export async function saveOnboardingProgress(
  context: OnboardingContext,
  submission: OnboardingSubmission,
  injectedDb?: OnboardingDbClient,
): Promise<OnboardingSnapshot> {
  if (!validContext(context)) throw new OnboardingAccessError();
  const acquired = injectedDb ? null : await getClient();
  const db = injectedDb ?? acquired;
  if (!db) throw new OnboardingAccessError();

  try {
    await db.query("BEGIN");
    const locked = await db.query<LockedOnboardingRow>(
      `SELECT
         account.onboarding_status AS "onboardingStatus",
         account.onboarding_step AS "onboardingStep",
         account.onboarding_data AS "onboardingData",
         membership.role AS "workspaceRole",
         workspace.name AS "workspaceName"
       FROM users AS account
       JOIN workspace_members AS membership
         ON membership.user_id = account.id
        AND membership.workspace_id = $2
        AND membership.status = 'active'
       JOIN workspaces AS workspace
         ON workspace.id = membership.workspace_id
        AND workspace.status = 'active'
        AND workspace.deleted_at IS NULL
       WHERE account.id = $1
         AND account.status = 'active'
       FOR UPDATE OF account, membership, workspace`,
      [context.userId, context.workspaceId],
    );
    const row = locked.rows[0];
    const currentRole = normalizeWorkspaceRole(row?.workspaceRole);
    if (!row || !currentRole) throw new OnboardingAccessError();

    const existingData = normalizePersistedData(row.onboardingData);
    const merged = normalizeStatus(row.onboardingStatus) === "completed"
      ? {
          data: existingData,
          status: "completed" as const,
          step: "complete" as const,
          syncProfile: false,
          recordCompletion: false,
        }
      : mergeSubmission(existingData, submission);
    await db.query(
      `UPDATE users
       SET
         full_name = COALESCE($4, full_name),
         display_name = COALESCE($4, display_name),
         onboarding_status = $2,
         onboarding_step = $3,
         onboarding_data = $5::JSONB,
         updated_at = NOW()
       WHERE id = $1`,
      [
        context.userId,
        merged.status,
        merged.step,
        merged.data.fullName ?? null,
        JSON.stringify(merged.data),
      ],
    );

    if (merged.syncProfile && currentRole === "owner") {
      await syncOwnerProfile(
        db,
        context,
        row.workspaceName,
        merged.data,
      );
    }

    if (merged.recordCompletion) {
      await db.query(
        `INSERT INTO auth_security_events (
           event_type,
           user_id,
           workspace_id,
           session_id,
           metadata
         )
         SELECT
           'onboarding_completed',
           $1,
           $2,
           $3,
           JSONB_BUILD_OBJECT('onboarding_step', 'complete')
         WHERE NOT EXISTS (
           SELECT 1
           FROM auth_security_events
           WHERE event_type = 'onboarding_completed'
             AND user_id = $1
             AND workspace_id = $2
         )`,
        [context.userId, context.workspaceId, context.sessionId],
      );
    }

    await db.query("COMMIT");
    return {
      status: merged.status,
      step: merged.step,
      data: merged.data,
      workspaceName: row.workspaceName,
      workspaceRole: currentRole,
    };
  } catch (error) {
    await rollbackQuietly(db);
    if (
      !(error instanceof OnboardingValidationError)
      && !(error instanceof OnboardingAccessError)
    ) {
      logError("auth_v2.onboarding_save_failed", error);
    }
    throw error;
  } finally {
    acquired?.release();
  }
}
