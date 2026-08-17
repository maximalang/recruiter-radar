/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import SettingsDocumentSummary from "@/app/settings/settings-overview";

describe("SettingsDocumentSummary", () => {
  it("summarizes profile and delivery readiness without duplicating forms", () => {
    render(
      <SettingsDocumentSummary
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

    expect(screen.getByText("86%")).toBeInTheDocument();
    expect(screen.getByText("Каждый день, 09:00")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Доставка настроена" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Изменить профиль/ })).toHaveAttribute("href", "/settings/radar");
    expect(screen.getByRole("link", { name: /Настроить доставку/ })).toHaveAttribute("href", "/settings/delivery");
    expect(screen.getByRole("navigation", { name: "Разделы настроек" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^Доступ и оплата/ }).some((link) => link.getAttribute("href") === "/settings/access")).toBe(true);
    expect(screen.getAllByRole("link", { name: /^Команда/ }).some((link) => link.getAttribute("href") === "/settings/team")).toBe(true);
    expect(screen.getAllByRole("link", { name: /^Безопасность/ }).some((link) => link.getAttribute("href") === "/settings/security")).toBe(true);
  });

  it("does not claim delivery is ready when no channel is connected", () => {
    render(
      <SettingsDocumentSummary
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

    expect(screen.getByRole("heading", { name: "Нужен канал доставки" })).toBeInTheDocument();
    expect(screen.getByText("Подключите хотя бы один канал и задайте расписание получения радара.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Команда/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Безопасность/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Доступ и оплата/ })).toBeNull();
  });
});
