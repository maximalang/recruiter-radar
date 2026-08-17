/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import DashboardTodayRadar from "@/app/dashboard/dashboard-today-radar";

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
  });
});
