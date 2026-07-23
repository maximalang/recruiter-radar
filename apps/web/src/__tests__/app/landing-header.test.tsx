/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";

import LandingHeader from "@/app/landing-header";

describe("landing header accessibility", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("offers a clear activation path without hiding account access", () => {
    render(<LandingHeader activationHref="/checkout?plan=pilot" />);

    expect(screen.getByRole("link", { name: "Попробовать неделю" })).toHaveAttribute(
      "href",
      "/checkout?plan=pilot",
    );

    expect(screen.getByRole("link", { name: "Войти" })).toHaveAttribute(
      "href",
      "/dashboard",
    );

    expect(screen.getByRole("link", { name: "Проверка" })).toHaveAttribute(
      "href",
      "#quality",
    );
  });

  it("closes the mobile menu with Escape and restores focus to the trigger", () => {
    render(<LandingHeader activationHref="/checkout?plan=pilot" />);

    const trigger = screen.getByRole("button", { name: "Открыть меню" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("closes the mobile menu on an outside pointer interaction", () => {
    render(
      <div>
        <LandingHeader activationHref="/checkout?plan=pilot" />
        <button type="button">Вне меню</button>
      </div>,
    );

    const trigger = screen.getByRole("button", { name: "Открыть меню" });
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Вне меню" }));

    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
