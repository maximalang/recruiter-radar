/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import LandingHeader from "@/app/landing-header";

describe("landing header accessibility", () => {
  it("keeps the compact mobile login label available to assistive technology", () => {
    render(<LandingHeader />);

    const compactLabel = screen.getByText("Войти", { selector: "span" });

    expect(compactLabel).not.toHaveAttribute("aria-hidden");
  });
});
