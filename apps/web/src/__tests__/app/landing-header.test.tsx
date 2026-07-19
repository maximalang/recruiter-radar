/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import LandingHeader from "@/app/landing-header";

describe("landing header accessibility", () => {
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
});
