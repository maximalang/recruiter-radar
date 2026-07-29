import {
  OnboardingValidationError,
  normalizeOnboardingAgencyInput,
  normalizeOnboardingProfileInput,
  saveOnboardingProgress,
  type OnboardingContext,
  type OnboardingDbClient,
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
  const query = jest.fn(async (sqlValue: unknown) => {
    const sql = String(sqlValue);
    if (sql.includes("FOR UPDATE OF account, membership, workspace")) {
      return { rows: [lockedRow], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO client_profiles")) {
      return { rows: [{ id: "5" }], rowCount: 1 };
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
      teamRole: "owner",
    })).toThrow(OnboardingValidationError);

    expect(() => normalizeOnboardingProfileInput({
      specialization: "Product и Data",
      roles: ["data", "forged-role"],
      industries: ["it"],
      geography: "Москва",
      hiringMode: "specialist",
    })).toThrow(OnboardingValidationError);
  });

  test("deduplicates bounded geography and canonical option lists", () => {
    expect(normalizeOnboardingProfileInput({
      specialization: "  Product   и Data ",
      roles: ["data", "product", "data"],
      industries: ["it", "finance", "it"],
      geography: " Москва, Санкт-Петербург\nМосква ",
      hiringMode: "specialist",
    })).toEqual({
      specialization: "Product и Data",
      roles: ["data", "product"],
      industries: ["it", "finance"],
      geography: ["Москва", "Санкт-Петербург"],
      hiringMode: "specialist",
    });
  });

  test("accepts omitted optional profile text and geography", () => {
    expect(normalizeOnboardingProfileInput({
      specialization: null,
      roles: [],
      industries: [],
      geography: null,
      hiringMode: "auto",
    })).toEqual({
      specialization: "",
      roles: [],
      industries: [],
      geography: [],
      hiringMode: "auto",
    });
  });
});

describe("auth v2 onboarding persistence", () => {
  test("locks and scopes an owner save to the authenticated user and workspace", async () => {
    const { db, query } = createDb({
      onboardingStatus: "in_progress",
      onboardingStep: "profile",
      onboardingData: {
        fullName: "Анна Смирнова",
        agencyName: "North Star",
        teamRole: "leader",
      },
      workspaceRole: "owner",
      workspaceName: "Workspace 42",
    });

    await expect(saveOnboardingProgress(ownerContext, {
      step: "profile",
      intent: "next",
      values: {
        specialization: "Product и Data",
        roles: ["data"],
        industries: ["it"],
        geography: "Москва",
        hiringMode: "specialist",
      },
    }, db)).resolves.toMatchObject({
      status: "in_progress",
      step: "complete",
    });

    expect(query.mock.calls[0]?.[0]).toBe("BEGIN");
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
        industries: [],
        geography: "",
        hiringMode: "auto",
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
