import {
  OnboardingValidationError,
  normalizeOnboardingAgencyInput,
  normalizeOnboardingMarketInput,
  normalizeOnboardingProfileInput,
  normalizeOnboardingDeliveryInput,
  saveOnboardingProgress,
  type OnboardingContext,
  type OnboardingDbClient,
  type OnboardingSubmission,
} from "@/lib/auth-v2/onboarding";

const ownerContext: OnboardingContext = {
  userId: "42",
  workspaceId: "9",
  workspaceName: "Workspace 42",
  workspaceRole: "owner",
  sessionId: "77",
};

function createDb(
  lockedRow: Record<string, unknown>,
): { db: OnboardingDbClient; query: jest.Mock } {
  const query = jest.fn(async (sqlValue: unknown, params?: unknown[]) => {
    const sql = String(sqlValue);
    if (sql.includes("FOR UPDATE OF account, membership, workspace")) {
      return { rows: [lockedRow], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO client_profiles")) {
      return { rows: [{ id: "5" }], rowCount: 1 };
    }
    if (sql.includes("UPDATE workspaces")) {
      return { rows: [{ name: params?.[1] }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  return { db: { query } as OnboardingDbClient, query };
}

describe("auth v2 onboarding input boundaries", () => {
  test("normalizes the required agency step without accepting hidden fields", () => {
    expect(normalizeOnboardingAgencyInput({
      fullName: "  Анна   Смирнова ",
      agencyName: "  North Star  ",
      agencyWebsite: null,
      teamRole: "leader",
    })).toEqual({
      fullName: "Анна Смирнова",
      agencyName: "North Star",
      teamRole: "leader",
    });
  });

  test("rejects invalid role keys and control characters", () => {
    expect(() => normalizeOnboardingAgencyInput({
      fullName: "Анна\nСмирнова",
      agencyName: "North Star",
      agencyWebsite: null,
      teamRole: "owner",
    })).toThrow(OnboardingValidationError);

    expect(() => normalizeOnboardingProfileInput({
      specialization: "Product и Data",
      roles: ["data", "forged-role"],
    })).toThrow(OnboardingValidationError);
  });

  test("normalizes specialization and role choices", () => {
    expect(normalizeOnboardingProfileInput({
      specialization: "  Product   и Data ",
      roles: ["data", "product", "data"],
    })).toEqual({
      specialization: "Product и Data",
      roles: ["data", "product"],
    });
  });

  test("accepts omitted optional specialization", () => {
    expect(normalizeOnboardingProfileInput({
      specialization: null,
      roles: [],
    })).toEqual({
      specialization: "",
      roles: [],
    });
  });

  test("deduplicates bounded market choices and geography", () => {
    expect(normalizeOnboardingMarketInput({
      industries: ["it", "finance", "it"], companySizes: ["small", "small"],
      geography: " Москва, Санкт-Петербург\nМосква ", hiringMode: "specialist",
    })).toEqual({ industries: ["it", "finance"], companySizes: ["small"], geography: ["Москва", "Санкт-Петербург"], hiringMode: "specialist" });
  });

  test("requires a valid destination only for email delivery", () => {
    expect(normalizeOnboardingDeliveryInput({ deliveryChoice: "email", deliveryEmail: " Team@Agency.ru " })).toEqual({
      deliveryChoice: "email",
      deliveryEmail: "team@agency.ru",
    });
    expect(() => normalizeOnboardingDeliveryInput({ deliveryChoice: "email", deliveryEmail: "not-an-email" })).toThrow(OnboardingValidationError);
    expect(normalizeOnboardingDeliveryInput({ deliveryChoice: "later", deliveryEmail: null })).toEqual({ deliveryChoice: "later" });
  });
});

describe("auth v2 onboarding persistence", () => {
  test("rejects forged completion before the persisted flow reaches the final step", async () => {
    const { db, query } = createDb({
      onboardingStatus: "not_started",
      onboardingStep: null,
      onboardingData: {},
      workspaceRole: "owner",
      workspaceName: "Workspace 42",
    });

    await expect(saveOnboardingProgress(ownerContext, {
      step: "market",
      intent: "finish",
      values: {},
    } as unknown as OnboardingSubmission, db)).rejects.toBeInstanceOf(OnboardingValidationError);

    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("onboarding_completed"))).toBe(false);
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("UPDATE users"))).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  test("persists an owner's agency name as the canonical workspace name", async () => {
    const { db, query } = createDb({
      onboardingStatus: "not_started",
      onboardingStep: null,
      onboardingData: {},
      workspaceRole: "owner",
      workspaceName: "Workspace 42",
    });

    await expect(saveOnboardingProgress(ownerContext, {
      step: "agency",
      intent: "next",
      values: {
        fullName: "Анна Смирнова",
        agencyName: "North Star",
        agencyWebsite: null,
        teamRole: "leader",
      },
    }, db)).resolves.toMatchObject({
      workspaceName: "North Star",
      step: "profile",
    });

    const workspaceUpdate = query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE workspaces"));
    expect(workspaceUpdate?.[1]).toEqual(["9", "North Star"]);
  });

  test("locks and scopes an owner save to the authenticated user and workspace", async () => {
    const { db, query } = createDb({
      onboardingStatus: "in_progress",
      onboardingStep: "market",
      onboardingData: {
        fullName: "Анна Смирнова",
        agencyName: "North Star",
        teamRole: "leader",
      },
      workspaceRole: "owner",
      workspaceName: "Workspace 42",
    });

    await expect(saveOnboardingProgress(ownerContext, {
      step: "market",
      intent: "next",
      values: {
        industries: ["it"],
        companySizes: ["small"],
        geography: "Москва",
        hiringMode: "specialist",
      },
    }, db)).resolves.toMatchObject({
      status: "in_progress",
      step: "delivery",
    });

    expect(query.mock.calls[0]?.[0]).toBe("BEGIN");
    expect(String(query.mock.calls[1]?.[0])).toContain(
      "pg_advisory_xact_lock_shared",
    );
    expect(query.mock.calls[1]?.[1]).toEqual(["auth-owner-scoped-writes"]);
    const lockCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("FOR UPDATE OF account, membership, workspace"));
    expect(lockCall?.[1]).toEqual(["42", "9"]);

    const profileCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO client_profiles"));
    expect(String(profileCall?.[0])).toContain("owner_id");
    expect(String(profileCall?.[0])).toContain("workspace_id");
    expect(String(profileCall?.[0])).toContain(
      "client_profiles.workspace_id = EXCLUDED.workspace_id",
    );
    expect(profileCall?.[1]).toEqual(expect.arrayContaining(["42", "9"]));
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  test("market skip creates missing owner profile without erasing canonical optional fields", async () => {
    const { db, query } = createDb({
      onboardingStatus: "in_progress",
      onboardingStep: "market",
      onboardingData: {
        fullName: "Анна Смирнова",
        agencyName: "North Star",
        teamRole: "leader",
      },
      workspaceRole: "owner",
      workspaceName: "Workspace 42",
    });

    await saveOnboardingProgress(ownerContext, {
      step: "market",
      intent: "skip",
      values: { industries: [], companySizes: [], geography: null, hiringMode: "auto" },
    }, db);

    const profileCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO client_profiles"));
    expect(String(profileCall?.[0])).toContain(
      "CASE WHEN $10 THEN client_profiles.specialization",
    );
    expect(profileCall?.[1]?.at(-1)).toBe(true);
  });

  test("persists an explicit delivery choice before completion", async () => {
    const { db, query } = createDb({
      onboardingStatus: "in_progress",
      onboardingStep: "delivery",
      onboardingData: { fullName: "Анна Смирнова", agencyName: "North Star", teamRole: "leader" },
      workspaceRole: "owner",
      workspaceName: "North Star",
    });

    await expect(saveOnboardingProgress(ownerContext, {
      step: "delivery",
      intent: "next",
      values: { deliveryChoice: "email", deliveryEmail: "team@agency.ru" },
    }, db)).resolves.toMatchObject({ step: "complete", data: { deliveryChoice: "email", deliveryEmail: "team@agency.ru" } });

    const deliveryCall = query.mock.calls.find(([sql]) => String(sql).includes("SET delivery_enabled"));
    expect(deliveryCall?.[1]).toEqual(["42", "9", true, true, "team@agency.ru"]);
  });

  test("never mutates a team profile for a non-owner member", async () => {
    const recruiterContext: OnboardingContext = {
      ...ownerContext,
      workspaceRole: "recruiter",
    };
    const { db, query } = createDb({
      onboardingStatus: "in_progress",
      onboardingStep: "profile",
      onboardingData: {
        fullName: "Анна Смирнова",
        agencyName: "North Star",
        teamRole: "recruiter",
      },
      workspaceRole: "recruiter",
      workspaceName: "North Star",
    });

    await saveOnboardingProgress(recruiterContext, {
      step: "profile",
      intent: "next",
      values: {
        specialization: "",
        roles: [],
      },
    }, db);

    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("INSERT INTO client_profiles"))).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  test("records completion once inside the same transaction", async () => {
    const { db, query } = createDb({
      onboardingStatus: "in_progress",
      onboardingStep: "complete",
      onboardingData: {
        fullName: "Анна Смирнова",
        agencyName: "North Star",
        teamRole: "leader",
      },
      workspaceRole: "owner",
      workspaceName: "North Star",
    });

    await saveOnboardingProgress(ownerContext, {
      step: "complete",
      intent: "finish",
      values: {},
    }, db);

    const auditCalls = query.mock.calls.filter(([sql]) =>
      String(sql).includes("onboarding_completed"));
    expect(auditCalls).toHaveLength(1);
    expect(String(auditCalls[0]?.[0])).toContain("NOT EXISTS");
  });

  test("does not reopen a completed flow from a stale form", async () => {
    const { db, query } = createDb({
      onboardingStatus: "completed",
      onboardingStep: "complete",
      onboardingData: {
        fullName: "Анна Смирнова",
        agencyName: "North Star",
        teamRole: "leader",
      },
      workspaceRole: "owner",
      workspaceName: "North Star",
    });

    await expect(saveOnboardingProgress(ownerContext, {
      step: "agency",
      intent: "next",
      values: {
        fullName: "Stale Name",
        agencyName: "Stale Agency",
        agencyWebsite: null,
        teamRole: "other",
      },
    }, db)).resolves.toMatchObject({
      status: "completed",
      step: "complete",
      data: {
        fullName: "Анна Смирнова",
        agencyName: "North Star",
      },
    });

    const updateCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE users"));
    expect(updateCall?.[1]?.[1]).toBe("completed");
    expect(updateCall?.[1]?.[2]).toBe("complete");
  });
});
