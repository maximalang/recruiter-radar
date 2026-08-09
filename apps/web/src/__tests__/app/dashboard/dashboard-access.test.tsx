/** @jest-environment jsdom */

import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";

jest.mock("@/lib/account-auth", () => ({ getAccountById: jest.fn() }));
jest.mock("@/lib/auth-v2/authorization", () => ({ getSession: jest.fn() }));
jest.mock("@/lib/clientProfiles", () => ({ getClientProfileByOwnerId: jest.fn() }));
jest.mock("@/lib/dashboard-data", () => ({ getDashboardTodayRadar: jest.fn() }));
jest.mock("@/lib/deliveryPreferences", () => ({ getDeliveryPreferencesByOwnerId: jest.fn() }));
jest.mock("@/lib/entitlements", () => ({ getEffectiveEntitlement: jest.fn() }));
jest.mock("@/app/dashboard/dashboard-account-overview", () => ({
  __esModule: true,
  default: () => <section>account overview</section>,
}));
jest.mock("@/app/dashboard/dashboard-today-radar", () => ({
  __esModule: true,
  default: () => <section>today radar</section>,
}));
jest.mock("@/app/ui/product-workspace", () => ({
  ProductWorkspaceFrame: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  ProductWorkspaceHeader: ({ title, subtitle }: { title: string; subtitle: string }) => <header>{title} {subtitle}</header>,
}));
jest.mock("@/app/ui/internal-page", () => ({
  EmptyState: ({ title, text, action }: { title: string; text: string; action?: { href: string; label: string } }) => <section>{title} {text} {action ? <a href={action.href}>{action.label}</a> : null}</section>,
  ErrorState: ({ title, description, action }: { title: string; description: string; action?: { href: string; label: string } }) => <section>{title} {description} {action ? <a href={action.href}>{action.label}</a> : null}</section>,
}));

import DashboardPage from "@/app/dashboard/page";
import { getAccountById } from "@/lib/account-auth";
import { getSession } from "@/lib/auth-v2/authorization";
import { getClientProfileByOwnerId } from "@/lib/clientProfiles";
import { getEffectiveEntitlement } from "@/lib/entitlements";
import { getDashboardTodayRadar } from "@/lib/dashboard-data";
import { getDeliveryPreferencesByOwnerId } from "@/lib/deliveryPreferences";

describe("dashboard canonical access states", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getSession).mockResolvedValue({ userId: "84", dataOwnerId: "42", workspaceId: "ws-1" } as never);
    jest.mocked(getAccountById).mockResolvedValue({ id: "84" } as never);
    jest.mocked(getDashboardTodayRadar).mockResolvedValue({ topLeads: [], pendingReview: 0, hiringModeByProfileId: {}, lastRunAt: null });
    jest.mocked(getDeliveryPreferencesByOwnerId).mockResolvedValue(null);
  });

  test("denies premium dashboard before loading tenant product data", async () => {
    jest.mocked(getEffectiveEntitlement).mockResolvedValue({ status: "inactive", features: [], activeSources: [], source: null, plan: null, startsAt: null, expiresAt: null, reason: "no_active_entitlement" });
    const page = await DashboardPage();
    render(page);
    expect(screen.getByText(/Нужен активный доступ/)).toBeInTheDocument();
    expect(getEffectiveEntitlement).toHaveBeenCalledWith("42", { workspaceId: "ws-1" });
    expect(getClientProfileByOwnerId).not.toHaveBeenCalled();
  });

  test("routes an entitled account without a profile into onboarding", async () => {
    jest.mocked(getEffectiveEntitlement).mockResolvedValue({ status: "active", source: "admin", plan: "radar-admin", startsAt: "2026-08-09T00:00:00.000Z", expiresAt: null, features: ["dashboard"], activeSources: ["admin"] });
    jest.mocked(getClientProfileByOwnerId).mockResolvedValue(null);
    const page = await DashboardPage();
    render(page);
    expect(screen.getByText(/Радар ещё не настроен/)).toBeInTheDocument();
    expect(screen.getByText(/четыре коротких шага/)).toBeInTheDocument();
  });

  test("does not present an account lookup failure as an expired session", async () => {
    jest.mocked(getAccountById).mockRejectedValue(new Error("database unavailable"));

    const page = await DashboardPage();
    render(page);

    expect(screen.getByText(/Не удалось загрузить аккаунт/)).toBeInTheDocument();
    expect(screen.queryByText(/Нужен вход в аккаунт/)).not.toBeInTheDocument();
  });

  test("does not present a profile lookup failure as unfinished onboarding", async () => {
    jest.mocked(getEffectiveEntitlement).mockResolvedValue({ status: "active", source: "admin", plan: "radar-admin", startsAt: "2026-08-09T00:00:00.000Z", expiresAt: null, features: ["dashboard"], activeSources: ["admin"] });
    jest.mocked(getClientProfileByOwnerId).mockRejectedValue(new Error("database unavailable"));

    const page = await DashboardPage();
    render(page);

    expect(screen.getByText(/Не удалось загрузить профиль Radar/)).toBeInTheDocument();
    expect(screen.queryByText(/Радар ещё не настроен/)).not.toBeInTheDocument();
  });

  test("surfaces unavailable delivery settings without hiding available radar results", async () => {
    jest.mocked(getEffectiveEntitlement).mockResolvedValue({ status: "active", source: "admin", plan: "radar-admin", startsAt: "2026-08-09T00:00:00.000Z", expiresAt: null, features: ["dashboard"], activeSources: ["admin"] });
    jest.mocked(getClientProfileByOwnerId).mockResolvedValue({ id: "7", isActive: true } as never);
    jest.mocked(getDeliveryPreferencesByOwnerId).mockRejectedValue(new Error("database unavailable"));

    const page = await DashboardPage();
    render(page);

    expect(screen.getByText(/Не удалось проверить готовность доставки/)).toBeInTheDocument();
    expect(screen.getByText("today radar")).toBeInTheDocument();
    expect(screen.queryByText("account overview")).not.toBeInTheDocument();
  });

  test("links a radar data failure to the canonical radar settings route", async () => {
    jest.mocked(getEffectiveEntitlement).mockResolvedValue({ status: "active", source: "admin", plan: "radar-admin", startsAt: "2026-08-09T00:00:00.000Z", expiresAt: null, features: ["dashboard"], activeSources: ["admin"] });
    jest.mocked(getClientProfileByOwnerId).mockResolvedValue({
      id: "7",
      isActive: true,
      roles: [],
      industries: [],
      targetCity: null,
      remoteFriendly: false,
      companySizes: [],
      hiringIntentMin: 0,
      hiringMode: "auto",
    } as never);
    jest.mocked(getDashboardTodayRadar).mockRejectedValue(new Error("database unavailable"));

    const page = await DashboardPage();
    render(page);

    expect(screen.getByRole("link", { name: "Проверить настройки Radar" })).toHaveAttribute("href", "/settings/radar");
  });
});
