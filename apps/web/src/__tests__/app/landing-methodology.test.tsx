/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from "@testing-library/react";

import LandingMethodology from "@/app/landing-methodology";

describe("LandingMethodology", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("uses a restrained 1300 ms cycle and stops after interaction", () => {
    render(<LandingMethodology />);

    expect(screen.getByRole("button", { name: /Соответствие/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    act(() => jest.advanceTimersByTime(1300));
    expect(screen.getByRole("button", { name: /Намерение/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.mouseEnter(screen.getByTestId("landing-methodology"));
    act(() => jest.advanceTimersByTime(2600));
    expect(screen.getByRole("button", { name: /Намерение/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("announces only a short status after manual selection", () => {
    render(<LandingMethodology />);

    fireEvent.click(screen.getByRole("button", { name: /Доступность/ }));

    expect(screen.getByRole("status")).toHaveTextContent("Этап 4 из 4: Доступность");
    expect(screen.getByRole("button", { name: /Доступность/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
