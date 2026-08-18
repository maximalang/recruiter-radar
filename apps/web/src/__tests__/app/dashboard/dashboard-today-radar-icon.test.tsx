/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import DashboardTodayRadar from "@/app/dashboard/dashboard-today-radar";
import type { LeadItem } from "@/lib/leads-data";

const oneSignalLead = {
  id: "lead-1",
  orgId: "org-1",
  clientProfileId: "profile-1",
  orgName: "Ромашка",
  score: 320,
  confidenceGate: "A",
  vacanciesCount: 1,
  distinctVacancyNamesCount: 1,
  latestPublishedAt: "2026-08-17T09:00:00.000Z",
  reasons: [],
  structuredReasons: [],
  whyNow: "Открыта новая роль",
  lawfulContactPath: "career-page",
  negativeSignals: [],
  opener: "",
  feedbackStatus: null,
  suppressedUntil: null,
  createdAt: "2026-08-17T09:00:00.000Z",
  sourceFamilies: ["career-pages"],
  evidenceTitles: ["Backend"],
  locationNames: ["Москва"],
  hasAiHint: false,
  isForeignEmployer: false,
  foreignMatchedDomain: null,
  reviewStatus: "auto_approved",
} as unknown as LeadItem;

describe("DashboardTodayRadar radar icon", () => {
  it("uses the concentric radar glyph for the first-scan empty state", () => {
    const { container } = render(
      <DashboardTodayRadar topLeads={[]} pendingReview={0} lastRunAt={null} />,
    );

    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon?.querySelectorAll("circle")).toHaveLength(3);
    expect(icon?.querySelectorAll("path")).toHaveLength(0);
    expect(icon?.querySelector('circle[r="0.6"]')).toHaveAttribute("fill", "currentColor");
  });

  it("keeps the first-run empty state truthful and links to the radar profile", () => {
    render(<DashboardTodayRadar topLeads={[]} pendingReview={0} lastRunAt={null} />);
    expect(screen.getByText(/первое сканирование ещё не завершено/i)).toBeTruthy();
    const link = screen.getByText(/проверить профиль радара/i).closest("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/settings/radar");
    expect(screen.getByRole("heading", { name: "Рабочий контур" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /На проверке 0/ })).toHaveAttribute("href", "/review");
  });

  it("uses shared Russian grammar for proof counts in the priority working set", () => {
    render(
      <DashboardTodayRadar
        topLeads={[oneSignalLead]}
        pendingReview={0}
        lastRunAt="2026-08-17T10:00:00.000Z"
      />,
    );

    const row = screen.getByText(/1 источник/).closest("a");
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent("1 подтверждение");
    expect(row).toHaveTextContent("1 источник");
    expect(row).toHaveTextContent("1 вакансия");
    expect(row).not.toHaveTextContent("1 подтверждений");
    expect(row).not.toHaveTextContent("1 вакансий");
  });
});
