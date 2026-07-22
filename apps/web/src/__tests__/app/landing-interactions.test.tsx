/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";

import LandingHeroDemo from "@/app/landing-hero-demo";
import { ProductScrollytelling, SourceLayerExplorer } from "@/app/landing-product-story";
import { MethodPipeline, TelegramDeliveryDemo } from "@/app/landing-quality-demo";

describe("landing product interactions", () => {
  beforeEach(() => {
    window.matchMedia = jest.fn().mockReturnValue({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });
  });

  it("renders the hero demo at its final readable score without JavaScript-only copy", () => {
    render(<LandingHeroDemo />);

    expect(screen.getByLabelText("Как Recruiter Radar оценивает компанию")).toHaveTextContent("87/100");
    expect(screen.getByText("Сигнал найма").closest("div")).toHaveAttribute("data-hero-target", "signal");
    expect(screen.getByText("Доказательства").closest("div")).toHaveAttribute("data-hero-target", "evidence");
    expect(screen.getByText("Следующий шаг").closest("div")).toHaveAttribute("data-hero-target", "next-step");
  });

  it("allows the product story and data layers to be changed with real buttons", () => {
    render(<ProductScrollytelling />);
    fireEvent.click(screen.getByRole("button", { name: /03 · Проверка/ }));
    expect(screen.getByRole("button", { name: /03 · Проверка/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Порог доверия");

    render(<SourceLayerExplorer />);
    fireEvent.click(screen.getByRole("button", { name: /Подтверждает компанию/ }));
    expect(screen.getByRole("button", { name: /Подтверждает компанию/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("status").at(-1)).toHaveTextContent("Компания подтверждена");
  });

  it("stops the methodology on user choice and exposes Telegram feedback as local pressed state", () => {
    render(<MethodPipeline />);
    fireEvent.click(screen.getByRole("button", { name: "Порог доверия" }));
    expect(screen.getByRole("button", { name: "Порог доверия" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Сигнал допускается только/)).toBeVisible();

    render(<TelegramDeliveryDemo />);
    fireEvent.click(screen.getByRole("button", { name: "Не подходит" }));
    expect(screen.getByRole("button", { name: "Не подходит" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Похожие сигналы будут понижены")).toBeVisible();
    expect(screen.getByText("Интерактивный пример")).toBeVisible();
  });
});
