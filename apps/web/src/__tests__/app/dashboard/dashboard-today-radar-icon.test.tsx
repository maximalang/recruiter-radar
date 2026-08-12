/** @jest-environment jsdom */

import { render } from "@testing-library/react";

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
});
