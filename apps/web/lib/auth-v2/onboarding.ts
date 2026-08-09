import type { PoolClient } from "pg";

import {
  COMPANY_SIZE_OPTIONS,
  HIRING_MODE_OPTIONS,
  INDUSTRY_OPTIONS,
  ROLE_OPTIONS,
} from "../clientProfileOptions";
import { getClient, getPool } from "../db-pool";
import { logError } from "../runtime";
import { isAuthOnboardingV2EnabledForUser } from "./config";
import { acquireAuthOwnerWriteFence } from "./owner-write-fence";
import { readAuthV2SessionCookie } from "./session-cookie";
import { readAuthSession } from "./sessions";
import {
  requireWorkspace,
  type WorkspaceRole,
} from "./workspaces";

export const ONBOARDING_STEPS = ["agency", "profile", "market", "delivery", "complete"] as const;
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
  agencyWebsite?: string;
  teamRole?: OnboardingTeamRole;
  specialization?: string;
  roles?: string[];
  industries?: string[];
  companySizes?: string[];
  geography?: string[];
  hiringMode?: OnboardingHiringMode;
  deliveryChoice?: "telegram" | "email" | "later";
  deliveryEmail?: string;
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
  agencyWebsite: unknown;
  teamRole: unknown;
};

export type OnboardingProfileInput = {
  specialization: unknown;
  roles: readonly unknown[];
};

export type OnboardingMarketInput = {
  industries: readonly unknown[];
  companySizes: readonly unknown[];
  geography: unknown;
  hiringMode: unknown;
};

export type OnboardingDeliveryInput = {
  deliveryChoice: unknown;
  deliveryEmail: unknown;
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
      step: "market";
      intent: "next" | "back" | "skip";
      values: OnboardingMarketInput;
    }
  | {
      step: "delivery";
      intent: "next" | "back" | "skip";
      values: OnboardingDeliveryInput;
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
  profileCompanySizes: unknown;
  profileTargetCity: string | null;
  profileHiringMode: string | null;
  profileDeliveryEnabled: boolean | null;
  profileTelegramChatId: string | null;
  profileEmailDigestEnabled: boolean | null;
  profileDigestEmail: string | null;
};

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const POSITIVE_ID = /^[1-9]\d*$/;
const TEAM_ROLE_KEYS = new Set<string>(
  ONBOARDING_TEAM_ROLE_OPTIONS.map((option) => option.key),
);
const ROLE_KEYS = new Set(ROLE_OPTIONS.map((option) => option.key));
const INDUSTRY_KEYS = new Set(INDUSTRY_OPTIONS.map((option) => option.key));
const COMPANY_SIZE_KEYS = new Set(COMPANY_SIZE_OPTIONS.map((option) => option.key));
const HIRING_MODE_KEYS = new Set<string>(
  HIRING_MODE_OPTIONS.map((option) => option.key),
);
const DELIVERY_CHOICES = new Set(["telegram", "email", "later"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
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
): Required<Pick<OnboardingData, "fullName" | "agencyName" | "teamRole">> & Pick<OnboardingData, "agencyWebsite"> {
  const rawWebsite = normalizeSingleLine(input.agencyWebsite, { required: false, maxBytes: 500 });
  let agencyWebsite: string | undefined;
  if (rawWebsite) {
    try {
      const url = new URL(rawWebsite.includes("://") ? rawWebsite : `https://${rawWebsite}`);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) throw new Error();
      agencyWebsite = url.toString().replace(/\/$/u, '');
    } catch {
      throw new OnboardingValidationError();
    }
  }
  return {
    fullName: normalizeSingleLine(input.fullName, {
      required: true,
      maxBytes: 120,
    })!,
    agencyName: normalizeSingleLine(input.agencyName, {
      required: true,
      maxBytes: 160,
    })!,
    ...(agencyWebsite ? { agencyWebsite } : {}),
    teamRole: normalizeKnownKey<OnboardingTeamRole>(
      input.teamRole,
      TEAM_ROLE_KEYS,
    ),
  };
}

export function normalizeOnboardingProfileInput(
  input: OnboardingProfileInput,
): Required<Pick<OnboardingData, "specialization" | "roles">> {
  return {
    specialization: normalizeSingleLine(input.specialization, {
      required: false,
      maxBytes: 240,
    }) ?? "",
    roles: normalizeKnownList(input.roles, ROLE_KEYS, ROLE_OPTIONS.length),
  };
}

export function normalizeOnboardingMarketInput(
  input: OnboardingMarketInput,
): Required<Pick<OnboardingData, "industries" | "companySizes" | "geography" | "hiringMode">> {
  return {
    industries: normalizeKnownList(input.industries, INDUSTRY_KEYS, INDUSTRY_OPTIONS.length),
    companySizes: normalizeKnownList(input.companySizes, COMPANY_SIZE_KEYS, COMPANY_SIZE_OPTIONS.length),
    geography: normalizeGeography(input.geography),
    hiringMode: normalizeKnownKey<OnboardingHiringMode>(input.hiringMode, HIRING_MODE_KEYS),
  };
}

export function normalizeOnboardingDeliveryInput(input: OnboardingDeliveryInput): {
  deliveryChoice: "telegram" | "email" | "later";
  deliveryEmail?: string;
} {
  const deliveryChoice = normalizeKnownKey<"telegram" | "email" | "later">(
    input.deliveryChoice,
    DELIVERY_CHOICES,
  );
  const deliveryEmail = normalizeSingleLine(input.deliveryEmail, { required: false, maxBytes: 320 });
  if (deliveryChoice === "email" && (!deliveryEmail || !EMAIL_PATTERN.test(deliveryEmail))) {
    throw new OnboardingValidationError();
  }
  return { deliveryChoice, ...(deliveryEmail ? { deliveryEmail: deliveryEmail.toLocaleLowerCase("ru-RU") } : {}) };
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
  const agencyWebsite = safeSingleLine(value.agencyWebsite, 500);
  const specialization = safeSingleLine(value.specialization, 240);
  const roles = safeKnownList(value.roles, ROLE_KEYS, ROLE_OPTIONS.length);
  const industries = safeKnownList(
    value.industries,
    INDUSTRY_KEYS,
    INDUSTRY_OPTIONS.length,
  );
  const companySizes = safeKnownList(
    value.companySizes,
    COMPANY_SIZE_KEYS,
    COMPANY_SIZE_OPTIONS.length,
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
  const deliveryChoice = typeof value.deliveryChoice === "string" && DELIVERY_CHOICES.has(value.deliveryChoice)
    ? value.deliveryChoice as "telegram" | "email" | "later"
    : undefined;
  const deliveryEmail = safeSingleLine(value.deliveryEmail, 320);

  return {
    ...(fullName ? { fullName } : {}),
    ...(agencyName ? { agencyName } : {}),
    ...(agencyWebsite ? { agencyWebsite } : {}),
    ...(teamRole ? { teamRole } : {}),
    ...(specialization ? { specialization } : {}),
    ...(roles ? { roles } : {}),
    ...(industries ? { industries } : {}),
    ...(companySizes ? { companySizes } : {}),
    ...(geography ? { geography } : {}),
    ...(hiringMode ? { hiringMode } : {}),
    ...(deliveryChoice ? { deliveryChoice } : {}),
    ...(deliveryEmail && EMAIL_PATTERN.test(deliveryEmail) ? { deliveryEmail: deliveryEmail.toLocaleLowerCase("ru-RU") } : {}),
  };
}

function normalizeStep(value: unknown, status: unknown): OnboardingStep {
  if (status === "completed") return "complete";
  if (status !== "in_progress") return "agency";
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
         profile.company_sizes AS "profileCompanySizes",
         profile.target_city AS "profileTargetCity",
         profile.hiring_mode AS "profileHiringMode"
         ,profile.delivery_enabled AS "profileDeliveryEnabled"
         ,profile.telegram_chat_id::TEXT AS "profileTelegramChatId"
         ,profile.email_digest_enabled AS "profileEmailDigestEnabled"
         ,profile.digest_email AS "profileDigestEmail"
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
    const fallbackCompanySizes = safeKnownList(
      row.profileCompanySizes,
      COMPANY_SIZE_KEYS,
      COMPANY_SIZE_OPTIONS.length,
    );
    const fallbackHiringMode =
      row.profileHiringMode && HIRING_MODE_KEYS.has(row.profileHiringMode)
        ? row.profileHiringMode as OnboardingHiringMode
        : undefined;
    const fallbackDeliveryChoice = row.profileEmailDigestEnabled && row.profileDigestEmail
      ? "email" as const
      : row.profileTelegramChatId
        ? "telegram" as const
        : row.profileDeliveryEnabled === false
          ? "later" as const
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
        ...(fallbackCompanySizes ? { companySizes: fallbackCompanySizes } : {}),
        ...(fallbackGeography ? { geography: fallbackGeography } : {}),
        ...(fallbackHiringMode ? { hiringMode: fallbackHiringMode } : {}),
        ...(fallbackDeliveryChoice ? { deliveryChoice: fallbackDeliveryChoice } : {}),
        ...(row.profileDigestEmail && EMAIL_PATTERN.test(row.profileDigestEmail) ? { deliveryEmail: row.profileDigestEmail } : {}),
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
  syncDelivery: boolean;
  preserveOptionalProfile: boolean;
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
      syncDelivery: false,
      preserveOptionalProfile: false,
      recordCompletion: false,
    };
  }

  if (submission.step === "profile") {
    if (submission.intent === "skip") {
      return {
        data: existing,
        status: "in_progress",
        step: "market",
        syncProfile: false,
        syncDelivery: false,
        preserveOptionalProfile: false,
        recordCompletion: false,
      };
    }
    const profile = normalizeOnboardingProfileInput(submission.values);
    return {
      data: {
        ...existing,
        specialization: profile.specialization || undefined,
        roles: profile.roles,
      },
      status: "in_progress",
      step: submission.intent === "back" ? "agency" : "market",
      syncProfile: false,
      syncDelivery: false,
      preserveOptionalProfile: false,
      recordCompletion: false,
    };
  }

  if (submission.step === "market") {
    if (submission.intent === "back") {
      return { data: existing, status: "in_progress", step: "profile", syncProfile: false, syncDelivery: false, preserveOptionalProfile: false, recordCompletion: false };
    }
    const market = submission.intent === "skip"
      ? {
          industries: existing.industries ?? [],
          companySizes: existing.companySizes ?? [],
          geography: existing.geography ?? [],
          hiringMode: existing.hiringMode ?? "auto" as OnboardingHiringMode,
        }
      : normalizeOnboardingMarketInput(submission.values);
    return {
      data: { ...existing, ...market },
      status: "in_progress",
      step: "delivery",
      syncProfile: true,
      syncDelivery: false,
      preserveOptionalProfile: submission.intent === "skip",
      recordCompletion: false,
    };
  }


  if (submission.step === "delivery") {
    if (submission.intent === "back") {
      return { data: existing, status: "in_progress", step: "market", syncProfile: false, syncDelivery: false, preserveOptionalProfile: false, recordCompletion: false };
    }
    const delivery = submission.intent === "skip"
      ? { deliveryChoice: "later" as const }
      : normalizeOnboardingDeliveryInput(submission.values);
    return {
      data: { ...existing, ...delivery },
      status: "in_progress",
      step: "complete",
      syncProfile: false,
      syncDelivery: true,
      preserveOptionalProfile: false,
      recordCompletion: false,
    };
  }

  if (submission.intent === "back") {
    return {
      data: existing,
      status: "in_progress",
      step: "delivery",
      syncProfile: false,
      syncDelivery: false,
      preserveOptionalProfile: false,
      recordCompletion: false,
    };
  }
  if (submission.intent !== "finish") throw new OnboardingValidationError();
  return {
    data: existing,
    status: "completed",
    step: "complete",
    syncProfile: false,
    syncDelivery: false,
    preserveOptionalProfile: false,
    recordCompletion: true,
  };
}

async function syncOwnerDelivery(db: OnboardingDbClient, context: OnboardingContext, data: OnboardingData): Promise<void> {
  const choice = data.deliveryChoice ?? "later";
  const result = await db.query(
    `UPDATE client_profiles
     SET delivery_enabled = $3,
         email_digest_enabled = $4,
         digest_email = CASE WHEN $4 THEN $5 ELSE digest_email END,
         updated_at = NOW()
     WHERE owner_id = $1
       AND (workspace_id = $2 OR workspace_id IS NULL)`,
    [
      context.userId,
      context.workspaceId,
      choice !== "later",
      choice === "email",
      choice === "email" ? data.deliveryEmail ?? null : null,
    ],
  );
  if ((result.rowCount ?? 0) !== 1) throw new OnboardingAccessError();
}

async function syncOwnerProfile(
  db: OnboardingDbClient,
  context: OnboardingContext,
  workspaceName: string,
  data: OnboardingData,
  preserveOptionalProfile: boolean,
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
       company_sizes,
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
       $7::JSONB,
       $8::TEXT[],
       'corporate_only',
       $9,
       NOW()
     )
     ON CONFLICT (owner_id) WHERE owner_id IS NOT NULL
     DO UPDATE SET
       workspace_id = EXCLUDED.workspace_id,
       agency_name = EXCLUDED.agency_name,
       target_city = CASE
         WHEN $10 THEN client_profiles.target_city
         ELSE EXCLUDED.target_city
       END,
       specialization = CASE WHEN $10 THEN client_profiles.specialization
         ELSE EXCLUDED.specialization
       END,
       industries = CASE
         WHEN $10 THEN client_profiles.industries
         ELSE EXCLUDED.industries
       END,
       company_sizes = CASE
         WHEN $10 THEN client_profiles.company_sizes
         ELSE EXCLUDED.company_sizes
       END,
       roles = CASE
         WHEN $10 THEN client_profiles.roles
         ELSE EXCLUDED.roles
       END,
       contact_policy = 'corporate_only',
       hiring_mode = CASE
         WHEN $10 THEN client_profiles.hiring_mode
         ELSE EXCLUDED.hiring_mode
       END,
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
      JSON.stringify(data.companySizes ?? []),
      data.roles ?? [],
      data.hiringMode ?? "auto",
      preserveOptionalProfile,
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
    await acquireAuthOwnerWriteFence(db);
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
    const currentStatus = normalizeStatus(row.onboardingStatus);
    const currentStep = normalizeStep(row.onboardingStep, currentStatus);
    const submissionStepIndex = ONBOARDING_STEPS.indexOf(submission.step);
    const currentStepIndex = ONBOARDING_STEPS.indexOf(currentStep);
    if (
      currentStatus !== "completed"
      && (
        submissionStepIndex < 0
        || submissionStepIndex > currentStepIndex
      )
    ) {
      throw new OnboardingValidationError();
    }
    if (
      currentStatus !== "completed"
      && currentStep !== "agency"
      && (
        !existingData.fullName
        || !existingData.agencyName
        || !existingData.teamRole
      )
    ) {
      throw new OnboardingValidationError();
    }
    const merged =
      currentStatus === "completed"
      || submissionStepIndex < currentStepIndex
      ? {
          data: existingData,
          status: currentStatus,
          step: currentStep,
          syncProfile: false,
          syncDelivery: false,
          preserveOptionalProfile: false,
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

    let workspaceName = row.workspaceName;
    if (
      currentRole === "owner"
      && submission.step === "agency"
      && submissionStepIndex === currentStepIndex
      && merged.data.agencyName
    ) {
      const renamed = await db.query<{ name: string }>(
        `UPDATE workspaces
         SET name = $2, updated_at = NOW()
         WHERE id = $1
           AND status = 'active'
           AND deleted_at IS NULL
         RETURNING name`,
        [context.workspaceId, merged.data.agencyName],
      );
      if (renamed.rowCount !== 1 || !renamed.rows[0]?.name) {
        throw new OnboardingAccessError();
      }
      workspaceName = renamed.rows[0].name;
    }

    if (merged.syncProfile && currentRole === "owner") {
      await syncOwnerProfile(
        db,
        context,
        workspaceName,
        merged.data,
        merged.preserveOptionalProfile,
      );
    }

    if (merged.syncDelivery && currentRole === "owner") {
      await syncOwnerDelivery(db, context, merged.data);
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
      workspaceName,
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
