/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  LandingMotionProvider,
  useLandingMotion,
} from "@/app/landing-motion/landing-motion-provider";
import LandingMotionPreference from "@/app/landing-motion/motion-preference";
import { LANDING_ANALYTICS_DOM_EVENT } from "@/lib/landing-analytics-contract";

function MotionProbe() {
  const motion = useLandingMotion();
  return <output data-testid="motion-probe">{`${motion.state}:${motion.paused}`}</output>;
}

function renderMotion(children: React.ReactNode) {
  return render(<LandingMotionProvider>{children}</LandingMotionProvider>);
}

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

  it("persists a user pause in sessionStorage", () => {
    const analyticsListener = jest.fn();
    window.addEventListener(LANDING_ANALYTICS_DOM_EVENT, analyticsListener);
    renderMotion(<LandingMotionPreference />);

    const control = screen.getByRole("button", { name: "Поставить движение на паузу" });
    fireEvent.click(control);

    expect(control).toHaveAttribute("aria-pressed", "true");
    expect(control).toHaveAccessibleName("Возобновить движение");
    expect(window.sessionStorage.getItem("landing-motion-preference")).toBe("paused");
    expect(document.documentElement).toHaveAttribute("data-landing-motion", "paused");
    expect(analyticsListener).toHaveBeenCalledTimes(1);
    window.removeEventListener(LANDING_ANALYTICS_DOM_EVENT, analyticsListener);
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

    renderMotion(<LandingMotionPreference />);

    const control = await screen.findByRole("button", {
      name: "Движение сокращено настройками системы",
    });
    await waitFor(() => {
      expect(control).toHaveAttribute("aria-pressed", "true");
      expect(document.documentElement).toHaveAttribute("data-landing-motion", "reduced");
    });
    expect(control).toBeDisabled();
  });

  it("exposes the stored preference to children on their first render", () => {
    window.sessionStorage.setItem("landing-motion-preference", "paused");

    renderMotion(<MotionProbe />);

    expect(screen.getByTestId("motion-probe")).toHaveTextContent("paused:true");
  });

  it("falls back to the system preference when storage access throws", () => {
    const storageSpy = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new DOMException("blocked");
      });

    expect(() => renderMotion(
      <>
        <MotionProbe />
        <LandingMotionPreference />
      </>,
    )).not.toThrow();
    expect(screen.getByTestId("motion-probe")).toHaveTextContent("running:false");

    storageSpy.mockRestore();
  });
});
