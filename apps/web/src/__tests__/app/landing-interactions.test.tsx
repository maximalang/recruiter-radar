/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from "@testing-library/react";

import LandingHeroDemo from "@/app/landing-hero-demo";
import LandingMotionControl from "@/app/landing-motion-control";
import { ProductScrollytelling, SourceLayerExplorer } from "@/app/landing-product-story";
import { FiurGlossary, MethodPipeline, TelegramDeliveryDemo } from "@/app/landing-quality-demo";

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

  it("switches delivery channels as an ARIA tablist and resets demo feedback", () => {
    render(<TelegramDeliveryDemo />);

    const telegram = screen.getByRole("tab", { name: "Telegram" });
    const email = screen.getByRole("tab", { name: "Email" });
    expect(telegram).toHaveAttribute("aria-selected", "true");

    fireEvent.click(email);
    expect(email).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Email");

    fireEvent.keyDown(email, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Web push" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: "Беру в работу" }));
    fireEvent.click(screen.getByRole("button", { name: "Сбросить выбор" }));
    expect(screen.getByRole("button", { name: "Беру в работу" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/Контур обратной связи/)).toBeVisible();
  });

  it("opens FIUR explanations for pointer and keyboard users and closes them on Escape", () => {
    render(<FiurGlossary />);

    const fit = screen.getByRole("button", { name: /Соответствие · Fit/ });
    act(() => fit.focus());
    expect(fit).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("tooltip")).toHaveTextContent("профилем агентства");

    fireEvent.keyDown(fit, { key: "Escape" });
    expect(fit).toHaveAttribute("aria-expanded", "false");
    expect(fit).toHaveFocus();

    fireEvent.click(fit);
    expect(fit).toHaveAttribute("aria-expanded", "true");
  });

  it("persists the explicit motion pause choice for the current session", () => {
    window.matchMedia = jest.fn().mockReturnValue({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });
    render(<LandingMotionControl />);

    const pause = screen.getByRole("button", { name: "Приостановить анимацию" });
    fireEvent.click(pause);

    expect(screen.getByRole("button", { name: "Возобновить анимацию" })).toHaveAttribute("aria-pressed", "true");
    expect(window.sessionStorage.getItem("rr:landing-motion-paused")).toBe("1");
    expect(document.documentElement).toHaveAttribute("data-landing-motion", "paused");
  });
});
