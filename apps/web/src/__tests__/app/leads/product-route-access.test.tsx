/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@/lib/auth-v2/authorization", () => ({
  getSession: jest.fn(),
}));
jest.mock("@/lib/entitlements", () => ({
  getEffectiveEntitlement: jest.fn(),
}));
jest.mock("@/lib/clientProfiles", () => ({
  getClientProfileById: jest.fn(),
  listClientProfiles: jest.fn(),
  resolveHiringMode: jest.fn(() => "specialist"),
}));
jest.mock("@/lib/leads-data", () => ({
  getLeadDetail: jest.fn(),
  formatLawfulContactPath: jest.fn(),
  extractPayloadFields: jest.fn(),
}));

import LeadDetailPage from "@/app/leads/[id]/page";
import ReviewPage from "@/app/review/page";
import DashboardError from "@/app/dashboard/error";
import LeadsError from "@/app/leads/error";
import ReviewError from "@/app/review/error";
import { getSession } from "@/lib/auth-v2/authorization";
import { getEffectiveEntitlement } from "@/lib/entitlements";
import { getLeadDetail } from "@/lib/leads-data";
import { listClientProfiles } from "@/lib/clientProfiles";
import type { EffectiveEntitlement } from "@/lib/entitlements";

const activeEntitlement: EffectiveEntitlement = {
  status: "active",
  source: "admin",
  plan: "radar-admin",
  startsAt: "2026-08-09T00:00:00.000Z",
  expiresAt: null,
  features: ["dashboard", "api"],
  activeSources: ["admin"],
};

describe("premium product route access states", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getSession).mockResolvedValue({
      dataOwnerId: "42",
      workspaceId: "9",
    } as never);
    jest.mocked(getEffectiveEntitlement).mockResolvedValue(activeEntitlement);
  });

  test("lead detail asks an unauthenticated visitor to sign in without probing the lead", async () => {
    jest.mocked(getSession).mockResolvedValue(null);

    render(await LeadDetailPage({ params: Promise.resolve({ id: "99" }) }));

    expect(screen.getByText("Нужен вход в аккаунт")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Войти" })).toHaveAttribute("href", "/login?returnTo=/leads/99");
    expect(getLeadDetail).not.toHaveBeenCalled();
  });

  test("lead detail checks canonical entitlement before reading a lead", async () => {
    jest.mocked(getEffectiveEntitlement).mockResolvedValue({
      status: "inactive",
      source: null,
      plan: null,
      startsAt: null,
      expiresAt: null,
      features: [],
      activeSources: [],
      reason: "no_active_entitlement",
    });

    render(await LeadDetailPage({ params: Promise.resolve({ id: "99" }) }));

    expect(screen.getByText("Нужен активный доступ")).toBeInTheDocument();
    expect(getLeadDetail).not.toHaveBeenCalled();
  });

  test("lead detail reports a data failure instead of a false not-found state", async () => {
    jest.mocked(getLeadDetail).mockRejectedValue(new Error("database unavailable"));

    render(await LeadDetailPage({ params: Promise.resolve({ id: "99" }) }));

    expect(screen.getByText("Не удалось загрузить компанию")).toBeInTheDocument();
    expect(screen.queryByText("Компания не найдена")).not.toBeInTheDocument();
  });

  test("review asks an unauthenticated visitor to sign in instead of showing no profiles", async () => {
    jest.mocked(getSession).mockResolvedValue(null);

    render(await ReviewPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Нужен вход в аккаунт")).toBeInTheDocument();
    expect(screen.queryByText("Нет клиентских профилей")).not.toBeInTheDocument();
    expect(listClientProfiles).not.toHaveBeenCalled();
  });

  test("review checks canonical entitlement before reading profiles", async () => {
    jest.mocked(getEffectiveEntitlement).mockResolvedValue({
      status: "inactive",
      source: null,
      plan: null,
      startsAt: null,
      expiresAt: null,
      features: [],
      activeSources: [],
      reason: "no_active_entitlement",
    });

    render(await ReviewPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Нужен активный доступ")).toBeInTheDocument();
    expect(listClientProfiles).not.toHaveBeenCalled();
  });

  test("review reports a profile data failure instead of a false empty state", async () => {
    jest.mocked(listClientProfiles).mockRejectedValue(new Error("database unavailable"));

    render(await ReviewPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Не удалось загрузить профили радара")).toBeInTheDocument();
    expect(screen.queryByText("Нет клиентских профилей")).not.toBeInTheDocument();
  });
});

describe("premium product route error boundaries", () => {
  test.each([
    ["dashboard", DashboardError],
    ["leads", LeadsError],
    ["review", ReviewError],
  ])("%s boundary offers an actual retry action", (_route, Boundary) => {
    const reset = jest.fn();
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

    render(<Boundary error={Object.assign(new Error("boom"), { digest: "test-digest" })} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));

    expect(reset).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
