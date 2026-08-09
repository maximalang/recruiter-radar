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
        authSecurityEnabled
      />,
    );

    expect(screen.getAllByText("86% готово")).toHaveLength(2);
    expect(screen.getByText("Каждый день, 09:00")).toBeInTheDocument();
    expect(screen.getByText("Telegram не подключён")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Изменить профиль/ })).toHaveAttribute("href", "/settings/radar#agency");
    expect(screen.getByRole("link", { name: /Настроить каналы/ })).toHaveAttribute("href", "/settings/delivery");
    expect(screen.getByRole("link", { name: /^Доступ и оплата/ })).toHaveAttribute("href", "/settings/access");
    expect(screen.getByRole("link", { name: /^Аккаунт/ })).toHaveAttribute("href", "/settings/account");
    expect(screen.getByRole("link", { name: /^Безопасность/ })).toHaveAttribute(
      "href",
      "/settings/security",
    );
    expect(screen.getByRole("link", { name: /^Команда/ })).toHaveAttribute(
      "href",
      "/settings/team",
    );
  });
  it("does not claim delivery is ready when no channel is connected", () => {
    render(
      <SettingsOverview
        agencyName="Команда"
        completionPercent={50}
        deliveryEnabled
        deliverySchedule="Каждый день, 09:00"
        telegramConnected={false}
        emailEnabled={false}
        webPushEnabled={false}
        authSecurityEnabled={false}
      />,
    );

    expect(screen.getByText("Доставка ожидает канал")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Безопасность/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Команда/ })).toBeNull();
  });
});
