jest.mock("next/headers", () => ({
  headers: jest.fn(),
}));
jest.mock("next/navigation", () => ({
  redirect: jest.fn(),
}));
jest.mock("@/lib/auth-v2/onboarding", () => {
  const actual = jest.requireActual("@/lib/auth-v2/onboarding");
  return {
    ...actual,
    readOnboardingContext: jest.fn(),
    saveOnboardingProgress: jest.fn(),
  };
});

import { saveOnboardingAction } from "@/app/onboarding/actions";
import {
  readOnboardingContext,
  saveOnboardingProgress,
  type OnboardingContext,
} from "@/lib/auth-v2/onboarding";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

const mockHeaders = jest.mocked(headers);
const mockRedirect = jest.mocked(redirect);
const mockReadContext = jest.mocked(readOnboardingContext);
const mockSave = jest.mocked(saveOnboardingProgress);

const context: OnboardingContext = {
  userId: "42",
  workspaceId: "9",
  workspaceName: "North Star",
  workspaceRole: "owner",
  sessionId: "77",
};

describe("auth v2 onboarding server action", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_SITE_URL = "https://radar.example";
    mockHeaders.mockResolvedValue(new Headers({
      Origin: "https://radar.example",
      "Sec-Fetch-Site": "same-origin",
    }) as never);
    mockReadContext.mockResolvedValue(context);
    mockSave.mockResolvedValue({
      status: "in_progress",
      step: "delivery",
      data: {},
      workspaceName: "North Star",
      workspaceRole: "owner",
    });
  });

  afterAll(() => {
    delete process.env.AUTH_SITE_URL;
  });

  test("derives tenant context server-side and accepts only canonical fields", async () => {
    const formData = new FormData();
    formData.set("step", "profile");
    formData.set("intent", "next");
    formData.set("specialization", "Product и Data");
    formData.append("roles", "data");
    formData.append("industries", "it");
    formData.set("geography", "Москва");
    formData.set("hiringMode", "specialist");
    formData.set("workspaceId", "999");
    formData.set("profileId", "888");

    await saveOnboardingAction(formData);

    expect(mockSave).toHaveBeenCalledWith(context, {
      step: "profile",
      intent: "next",
      values: {
        specialization: "Product и Data",
        roles: ["data"],
      },
    });
    expect(mockRedirect).toHaveBeenLastCalledWith("/onboarding");
  });

  test("rejects a cross-origin request before reading the session", async () => {
    mockHeaders.mockResolvedValue(new Headers({
      Origin: "https://attacker.example",
    }) as never);
    mockRedirect.mockImplementationOnce(() => {
      throw new Error("redirected");
    });

    await expect(saveOnboardingAction(new FormData()))
      .rejects.toThrow("redirected");

    expect(mockRedirect).toHaveBeenCalledWith("/onboarding?error=request");
    expect(mockReadContext).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  test("separates market targeting from specialization fields", async () => {
    const formData = new FormData();
    formData.set("step", "market"); formData.set("intent", "next");
    formData.append("industries", "it"); formData.append("companySizes", "small");
    formData.set("geography", "Москва"); formData.set("hiringMode", "specialist");
    await saveOnboardingAction(formData);
    expect(mockSave).toHaveBeenCalledWith(context, { step: "market", intent: "next", values: { industries: ["it"], companySizes: ["small"], geography: "Москва", hiringMode: "specialist" } });
  });

  test("accepts only the delivery channel fields", async () => {
    const formData = new FormData();
    formData.set("step", "delivery");
    formData.set("intent", "next");
    formData.set("deliveryChoice", "email");
    formData.set("deliveryEmail", "team@agency.ru");
    formData.set("telegramChatId", "forged");

    await saveOnboardingAction(formData);

    expect(mockSave).toHaveBeenCalledWith(context, {
      step: "delivery",
      intent: "next",
      values: { deliveryChoice: "email", deliveryEmail: "team@agency.ru" },
    });
  });

  test("fails closed for a forged step or intent", async () => {
    const formData = new FormData();
    formData.set("step", "profile");
    formData.set("intent", "delete");

    await saveOnboardingAction(formData);

    expect(mockSave).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith("/onboarding?error=invalid");
  });

  test("redirects a completed flow to the dashboard", async () => {
    mockSave.mockResolvedValue({
      status: "completed",
      step: "complete",
      data: {},
      workspaceName: "North Star",
      workspaceRole: "owner",
    });
    const formData = new FormData();
    formData.set("step", "complete");
    formData.set("intent", "finish");

    await saveOnboardingAction(formData);

    expect(mockRedirect).toHaveBeenLastCalledWith(
      "/dashboard?onboarding=complete",
    );
  });
});
