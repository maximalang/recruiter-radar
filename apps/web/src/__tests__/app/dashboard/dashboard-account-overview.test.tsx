/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import DashboardAccountOverview from "@/app/dashboard/dashboard-account-overview";

describe("DashboardAccountOverview", () => {
  it("turns account state into clear next actions", () => {
    render(
      <DashboardAccountOverview
        agencyName="Тестовое агентство"
        todayLeads={4}
        pendingReview={2}
        completionPercent={71}
        deliveryReady={false}
      />,
    );

    expect(screen.getByRole("heading", { name: /Тестовое агентство/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Открыть 4 компании/ })).toHaveAttribute("href", "/leads");
    expect(screen.getByRole("link", { name: /Проверить 2/ })).toHaveAttribute("href", "/review");
    expect(screen.getByRole("link", { name: /Настроить доставку/ })).toHaveAttribute("href", "/profile#delivery");
    expect(screen.getByText("71% готово")).toBeInTheDocument();
  });
});
