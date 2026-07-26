/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";

import LandingDetailsInteractions from "@/app/landing-details-interactions";

describe("LandingDetailsInteractions", () => {
  it("cleans inline height styles after an opening animation", () => {
    let finishAnimation: (() => void) | undefined;
    const animation = {
      cancel: jest.fn(),
      onfinish: null as (() => void) | null,
      oncancel: null as (() => void) | null,
    };
    Element.prototype.animate = jest.fn(() => {
      finishAnimation = () => animation.onfinish?.();
      return animation as unknown as Animation;
    });

    render(
      <div data-landing-details-root>
        <details data-animated-details>
          <summary>Подробнее</summary>
          <div>Содержимое</div>
        </details>
        <LandingDetailsInteractions />
      </div>,
    );

    fireEvent.click(screen.getByText("Подробнее"));
    expect(screen.getByText("Подробнее").closest("details")).toHaveAttribute("open");

    finishAnimation?.();

    const details = screen.getByText("Подробнее").closest("details")!;
    expect(details.style.height).toBe("");
    expect(details.style.overflow).toBe("");
  });
});
