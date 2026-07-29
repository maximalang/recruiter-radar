export type AuthEnvironment = Readonly<Record<string, string | undefined>>;

export type AuthV2Flags = {
  platform: boolean;
  workspaces: boolean;
  onboarding: boolean;
  passkeys: boolean;
  legacySessionMigration: boolean;
};

export type AuthWorkspaceV2RolloutPolicy = {
  enabled: boolean;
  global: boolean;
  canaryUserIds: readonly string[];
};

const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");
const POSITIVE_DECIMAL = /^[1-9]\d*$/;

function enabled(value: string | undefined): boolean {
  return value === "true";
}

function isPositivePostgresBigint(value: string): boolean {
  if (!POSITIVE_DECIMAL.test(value)) return false;
  try {
    return BigInt(value) <= MAX_POSTGRES_BIGINT;
  } catch {
    return false;
  }
}

export function parseCanaryUserIds(
  value: string | undefined,
): ReadonlySet<string> | null {
  if (value === undefined || value === "") return new Set();

  const entries = value.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => !isPositivePostgresBigint(entry))) return null;
  return new Set(entries);
}

export function getAuthV2Flags(
  env: AuthEnvironment = process.env,
): AuthV2Flags {
  const platform = enabled(env.AUTH_PLATFORM_V2_ENABLED);
  const workspaces = platform && enabled(env.AUTH_WORKSPACES_V2_ENABLED);

  return {
    platform,
    workspaces,
    onboarding: workspaces && enabled(env.AUTH_ONBOARDING_V2_ENABLED),
    passkeys: platform && enabled(env.AUTH_PASSKEYS_ENABLED),
    legacySessionMigration:
      platform && enabled(env.AUTH_LEGACY_SESSION_MIGRATION_ENABLED),
  };
}

export function isAuthPlatformV2EnabledForUser(
  userId: string | null | undefined,
  env: AuthEnvironment = process.env,
): boolean {
  if (getAuthV2Flags(env).platform) return true;
  if (!userId || !isPositivePostgresBigint(userId)) return false;

  const canaryIds = parseCanaryUserIds(env.AUTH_V2_CANARY_USER_IDS);
  return canaryIds?.has(userId) === true;
}

export function isAuthWorkspacesV2EnabledForUser(
  userId: string | null | undefined,
  env: AuthEnvironment = process.env,
): boolean {
  const policy = getAuthWorkspacesV2RolloutPolicy(env);
  return (
    policy.enabled
    && (
      policy.global
      || (userId !== null
        && userId !== undefined
        && policy.canaryUserIds.includes(userId))
    )
  );
}

export function isAuthOnboardingV2EnabledForUser(
  userId: string | null | undefined,
  env: AuthEnvironment = process.env,
): boolean {
  return (
    enabled(env.AUTH_ONBOARDING_V2_ENABLED)
    && isAuthWorkspacesV2EnabledForUser(userId, env)
  );
}

export function isAuthPasskeysEnabledForUser(
  userId: string | null | undefined,
  env: AuthEnvironment = process.env,
): boolean {
  return (
    enabled(env.AUTH_PASSKEYS_ENABLED)
    && isAuthPlatformV2EnabledForUser(userId, env)
  );
}

export function isAuthPasskeyLoginAvailable(
  env: AuthEnvironment = process.env,
): boolean {
  if (!enabled(env.AUTH_PASSKEYS_ENABLED)) return false;
  if (getAuthV2Flags(env).platform) return true;
  const canaryIds = parseCanaryUserIds(env.AUTH_V2_CANARY_USER_IDS);
  return canaryIds !== null && canaryIds.size > 0;
}

export function getAuthWorkspacesV2RolloutPolicy(
  env: AuthEnvironment = process.env,
): AuthWorkspaceV2RolloutPolicy {
  const canaryIds = parseCanaryUserIds(env.AUTH_V2_CANARY_USER_IDS);
  return {
    enabled: enabled(env.AUTH_WORKSPACES_V2_ENABLED),
    global: enabled(env.AUTH_PLATFORM_V2_ENABLED),
    canaryUserIds: canaryIds === null ? [] : [...canaryIds],
  };
}

export function isAuthV2SessionReadEnabledForUser(
  userId: string | null | undefined,
  env: AuthEnvironment = process.env,
): boolean {
  return (
    isAuthPlatformV2EnabledForUser(userId, env)
    || enabled(env.AUTH_V2_SESSION_ROLLBACK_COMPAT_ENABLED)
  );
}

export function shouldRunAuthV2SessionRefresh(
  env: AuthEnvironment = process.env,
): boolean {
  if (
    getAuthV2Flags(env).platform
    || enabled(env.AUTH_V2_SESSION_ROLLBACK_COMPAT_ENABLED)
    || enabled(env.AUTH_LEGACY_SESSION_MIGRATION_ENABLED)
  ) {
    return true;
  }
  const canaryIds = parseCanaryUserIds(env.AUTH_V2_CANARY_USER_IDS);
  return canaryIds !== null && canaryIds.size > 0;
}

export function isLegacySessionMigrationWindowOpen(
  env: AuthEnvironment = process.env,
  now = new Date(),
): boolean {
  if (!enabled(env.AUTH_LEGACY_SESSION_MIGRATION_ENABLED)) return false;
  if (!Number.isFinite(now.getTime())) return false;

  const rawDeadline = env.AUTH_LEGACY_SESSION_MIGRATION_DEADLINE?.trim() ?? "";
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(
    rawDeadline,
  );
  if (!match) return false;

  const [, year, month, day, hour, minute, second] = match;
  const deadlineMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  if (!Number.isFinite(deadlineMs)) return false;

  const canonical = new Date(deadlineMs).toISOString().replace(".000Z", "Z");
  return canonical === rawDeadline && deadlineMs > now.getTime();
}
