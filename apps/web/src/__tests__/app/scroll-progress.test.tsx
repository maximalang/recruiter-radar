/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from "@testing-library/react";

import ScrollProgress from "@/app/scroll-progress";

describe("landing scroll progress", () => {
  it("writes progress through CSS state and uses an instant reduced-motion return", () => {
    window.matchMedia = jest.fn().mockReturnValue({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });
    const scrollTo = jest.fn();
    Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
    Object.defineProperty(document.documentElement, "scrollTop", { configurable: true, value: 700 });
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: 1000 });
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    };

    render(<ScrollProgress />);
    act(() => fireEvent.scroll(window));

    const progress = screen.getByTestId("landing-scroll-progress");
    const top = screen.getByRole("button", { name: "Наверх" });
    expect(progress.style.getPropertyValue("--scroll-progress")).toBe("70%");
    expect(top).toHaveAttribute("data-visible", "true");
    fireEvent.click(top);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });
});
