/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import LandingMotionPreference from "@/app/landing-motion/motion-preference";

describe("LandingMotionPreference", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    document.documentElement.removeAttribute("data-landing-motion");
    jest.mocked(window.matchMedia).mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
  });

  it("persists a user pause in sessionStorage", async () => {
    render(<LandingMotionPreference />);

    const control = screen.getByRole("button", { name: "Поставить движение на паузу" });
    fireEvent.click(control);

    expect(control).toHaveAttribute("aria-pressed", "true");
    expect(control).toHaveAccessibleName("Возобновить движение");
    expect(window.sessionStorage.getItem("landing-motion-preference")).toBe("paused");
    expect(document.documentElement).toHaveAttribute("data-landing-motion", "paused");
  });

  it("gives reduced motion priority over a running session preference", async () => {
    window.sessionStorage.setItem("landing-motion-preference", "running");
    jest.mocked(window.matchMedia).mockImplementation((query) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    render(<LandingMotionPreference />);

    const control = await screen.findByRole("button", { name: "Движение сокращено настройками системы" });
    await waitFor(() => {
      expect(control).toHaveAttribute("aria-pressed", "true");
      expect(document.documentElement).toHaveAttribute("data-landing-motion", "reduced");
    });
    expect(control).toBeDisabled();
  });
});
