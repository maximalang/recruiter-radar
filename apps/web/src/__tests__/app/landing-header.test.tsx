/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";

import LandingHeader from "@/app/landing-header";

describe("landing header accessibility", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  function renderHeader(children?: React.ReactNode) {
    return render(
      <>
        <LandingHeader previewHref="#preview-configurator" />
        {children}
      </>,
    );
  }

  it("offers one clear activation path without hiding account access", () => {
    renderHeader();

    const activation = screen.getAllByRole("link", { name: "Проверить свою нишу" })[0];
    expect(activation).toHaveAttribute("href", "#preview-configurator");
    expect(activation).toHaveAttribute("data-analytics-event", "preview_started");
    expect(activation).toHaveAttribute("data-analytics-context", "header");
    expect(screen.getAllByRole("link", { name: "Войти" })[0]).toHaveAttribute("href", "/login");
    expect(screen.getAllByRole("link", { name: "Доказательства" })[0]).toHaveAttribute(
      "href",
      "#quality",
    );
    expect(screen.getAllByRole("link", { name: "Для агентств" })[0]).toHaveAttribute(
      "href",
      "#for-agencies",
    );
  });

  it("closes the mobile menu with Escape and restores focus to the trigger", () => {
    renderHeader();

    const trigger = screen.getByRole("button", { name: "Открыть меню" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("closes the mobile menu on an outside pointer interaction", () => {
    renderHeader(<button type="button">Вне меню</button>);

    const trigger = screen.getByRole("button", { name: "Открыть меню" });
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Вне меню" }));

    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
