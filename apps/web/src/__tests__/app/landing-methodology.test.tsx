/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";

import LandingMethodology from "@/app/landing-methodology";

describe("LandingMethodology", () => {
  it("starts with the first check selected and changes only after user input", () => {
    render(<LandingMethodology />);

    const fit = screen.getByRole("button", { name: /Соответствие/ });
    const intent = screen.getByRole("button", { name: /Намерение/ });
    expect(fit).toHaveAttribute("aria-pressed", "true");
    expect(intent).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(intent);

    expect(fit).toHaveAttribute("aria-pressed", "false");
    expect(intent).toHaveAttribute("aria-pressed", "true");
  });

  it("announces a short status after manual selection", () => {
    render(<LandingMethodology />);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole("button", { name: /Доступность/ }));

    expect(screen.getByRole("status")).toHaveTextContent("Проверка 4 из 4: Доступность");
    expect(screen.getByRole("button", { name: /Доступность/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("does not autoplay or require viewport observers", () => {
    render(<LandingMethodology />);

    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.getByText("4 проверки · без чёрного ящика")).toBeVisible();
  });
});
