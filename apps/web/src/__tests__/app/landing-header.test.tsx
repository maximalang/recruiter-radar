/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import LandingHeader from "@/app/landing-header";

describe("landing header accessibility", () => {
  it("offers the required navigation and a clear activation path", () => {
    render(<LandingHeader activationHref="/checkout?plan=pilot" />);

    expect(screen.getAllByRole("link", { name: "Собрать мой радар" })[0]).toHaveAttribute(
      "href",
      "/checkout?plan=pilot",
    );

    expect(screen.getAllByRole("link", { name: "Войти" })[0]).toHaveAttribute(
      "href",
      "/dashboard",
    );

    expect(screen.getAllByRole("link", { name: "Пример радара" })[0]).toHaveAttribute(
      "href",
      "#preview",
    );

    expect(screen.getAllByRole("link", { name: "Методология" })[0]).toHaveAttribute(
      "href",
      "#quality",
    );

    expect(screen.getAllByRole("link", { name: "Стоимость" })[0]).toHaveAttribute(
      "href",
      "#pricing",
    );
  });

  it("keeps the full navigation available in a native mobile disclosure", () => {
    render(<LandingHeader activationHref="/checkout?plan=pilot" />);

    const menuSummary = screen.getByText("Меню").closest("summary");

    expect(menuSummary).not.toBeNull();
    expect(screen.getAllByRole("link", { name: "Войти" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Как работает" })).toHaveLength(2);
  });
});
