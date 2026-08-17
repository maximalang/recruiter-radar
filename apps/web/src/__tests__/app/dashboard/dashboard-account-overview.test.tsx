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
    expect(screen.getByRole("link", { name: /Компании 4/ })).toHaveAttribute("href", "/leads");
    expect(screen.getByRole("link", { name: /На проверке 2/ })).toHaveAttribute("href", "/review");
    expect(screen.getByRole("link", { name: /Профиль радара 71%/ })).toHaveAttribute("href", "/settings/radar");
    expect(screen.getByRole("link", { name: /Доставка настроить/ })).toHaveAttribute("href", "/settings/delivery");
  });
});
