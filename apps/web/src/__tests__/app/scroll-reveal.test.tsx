/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import ScrollReveal from "../../../app/scroll-reveal";

describe("ScrollReveal", () => {
  beforeEach(() => {
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 2_000,
      top: 2_000,
      right: 100,
      bottom: 2_100,
      left: 0,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it("keeps content visible when the intersection callback has not fired", () => {
    render(<ScrollReveal><p>Важный контент</p></ScrollReveal>);

    expect(screen.getByText("Важный контент").parentElement).toHaveStyle({
      opacity: "1",
      transform: "none",
    });
  });
});
