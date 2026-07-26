/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from "@testing-library/react";

import LandingHeroInteractions from "@/app/landing-hero-interactions";
import LandingHowItWorks from "@/app/landing-how-it-works";
import { LandingMotionProvider } from "@/app/landing-motion/landing-motion-provider";
import {
  LANDING_RADAR_SIGNAL_EVENT,
  type LandingRadarSignalDetail,
} from "@/app/landing-radar-signal";
import LandingSourceArchitecture from "@/app/landing-source-architecture";

describe("landing product interactions", () => {
  it("selects how-it-works stages with pointer and keyboard", () => {
    render(<LandingHowItWorks />);

    const profile = screen.getByRole("button", { name: /Настраиваем профиль/ });
    const signal = screen.getByRole("button", { name: /Находим и проверяем сигнал/ });
    expect(profile).toHaveAttribute("aria-pressed", "true");

    fireEvent.mouseEnter(signal);
    expect(signal).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("how-it-works-flow")).toHaveAttribute("data-active-step", "2");

    fireEvent.keyDown(signal, { key: "ArrowRight" });
    const delivery = screen.getByRole("button", { name: /Доставляем приоритет/ });
    expect(delivery).toHaveFocus();
    expect(delivery).toHaveAttribute("aria-pressed", "true");
  });

  it("highlights source roles while keeping excluded sources explicit", () => {
    render(<LandingSourceArchitecture />);

    const origin = screen.getByRole("button", { name: /Создаёт сигнал/ });
    const verification = screen.getByRole("button", { name: /Подтверждает/ });
    expect(origin).toHaveAttribute("aria-pressed", "true");

    fireEvent.focus(verification);
    expect(verification).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("source-flow")).toHaveAttribute("data-active-layer", "2");
    expect(screen.getAllByText(/исключены из production-выдачи/i)).toHaveLength(2);
  });

  it("maps a radar signal to evidence, score confirmation and one FIUR meter", () => {
    jest.useFakeTimers();
    render(
      <LandingMotionProvider>
        <section data-landing-hero>
          <div data-hero-tilt />
          <div data-hero-evidence-index="0" />
          <div data-hero-evidence-index="1" />
          <div data-hero-evidence-index="2" />
          <div data-hero-score-track />
          <div data-hero-fiur-index="0" />
          <div data-hero-fiur-index="1" />
          <div data-hero-fiur-index="2" />
          <LandingHeroInteractions />
        </section>
      </LandingMotionProvider>,
    );

    act(() => {
      window.dispatchEvent(new CustomEvent<LandingRadarSignalDetail>(
        LANDING_RADAR_SIGNAL_EVENT,
        { detail: { index: 1 } },
      ));
    });

    expect(document.querySelector('[data-hero-evidence-index="1"]')).toHaveAttribute(
      "data-signal-active",
      "true",
    );
    expect(document.querySelector("[data-hero-score-track]")).toHaveAttribute(
      "data-confirmation-pulse",
      "true",
    );
    expect(document.querySelector('[data-hero-fiur-index="1"]')).toHaveAttribute(
      "data-signal-active",
      "true",
    );

    act(() => jest.advanceTimersByTime(900));
    expect(document.querySelector("[data-hero-score-track]")).not.toHaveAttribute(
      "data-confirmation-pulse",
    );
    jest.useRealTimers();
  });
});
