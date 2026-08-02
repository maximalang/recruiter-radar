/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import ScrollReveal from "../../../app/scroll-reveal";

describe("ScrollReveal", () => {
  it("renders important content immediately without client-side reveal logic", () => {
    render(<ScrollReveal><p>Важный контент</p></ScrollReveal>);

    expect(screen.getByText("Важный контент")).toBeVisible();
  });

  it("preserves semantic wrappers and caller-owned attributes", () => {
    render(
      <ScrollReveal
        as="section"
        id="evidence"
        className="evidence-section"
        style={{ color: "rgb(10, 20, 30)" }}
      >
        <h2>Доказательства</h2>
      </ScrollReveal>,
    );

    const section = document.querySelector("section#evidence");
    expect(section).not.toBeNull();
    expect(section).toHaveAttribute("id", "evidence");
    expect(section).toHaveClass("evidence-section");
    expect(section).toHaveStyle({ color: "rgb(10, 20, 30)" });
  });
});
