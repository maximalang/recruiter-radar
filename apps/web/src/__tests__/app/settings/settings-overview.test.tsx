/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import SettingsOverview from "@/app/settings/settings-overview";

describe("SettingsOverview", () => {
  it("summarizes profile and delivery readiness without duplicating forms", () => {
    render(
      <SettingsOverview
        agencyName="Команда"
        completionPercent={86}
        deliveryEnabled
        deliverySchedule="Каждый день, 09:00"
        telegramConnected={false}
        emailEnabled
        webPushEnabled={false}
      />,
    );

    expect(screen.getAllByText("86% готово")).toHaveLength(2);
    expect(screen.getByText("Каждый день, 09:00")).toBeInTheDocument();
    expect(screen.getByText("Telegram не подключён")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Изменить профиль/ })).toHaveAttribute("href", "/profile#agency");
    expect(screen.getByRole("link", { name: /Настроить каналы/ })).toHaveAttribute("href", "/profile#delivery");
  });
});
