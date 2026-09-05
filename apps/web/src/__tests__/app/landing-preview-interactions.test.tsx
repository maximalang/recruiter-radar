/** @jest-environment jsdom */

import { act, render, waitFor } from "@testing-library/react";

import LandingPreviewInteractions from "@/app/landing-preview-interactions";

describe("LandingPreviewInteractions", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("does not claim a personalized generation merely by mounting", () => {
    const listener = jest.fn();
    window.addEventListener("landing:analytics", listener);

    const { unmount } = render(<LandingPreviewInteractions />);

    expect(listener).not.toHaveBeenCalled();
    unmount();
    window.removeEventListener("landing:analytics", listener);
  });

  it("restores a deep-link anchor after the static preview results become ready", async () => {
    window.history.replaceState({}, "", "/#scene-evidence");
    const scrollIntoView = jest.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    window.requestAnimationFrame = (callback) => {
      callback(0);
      return 1;
    };
    window.cancelAnimationFrame = jest.fn();

    const { container, unmount } = render(
      <div>
        <div data-preview-results><div data-preview-results-skeleton /></div>
        <section id="scene-evidence">Evidence</section>
        <LandingPreviewInteractions />
      </div>,
    );

    expect(scrollIntoView).not.toHaveBeenCalled();
    const readyResults = document.createElement("div");
    readyResults.setAttribute("data-preview-results-ready", "");
    act(() => {
      container.querySelector("[data-preview-results]")?.appendChild(readyResults);
    });

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    });

    unmount();
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: originalScrollIntoView,
      });
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    }
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("does not restore anchors at or above the preview results", () => {
    window.history.replaceState({}, "", "/#scene-workspace");
    const scrollIntoView = jest.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    const { unmount } = render(
      <div>
        <div data-preview-results><div data-preview-results-ready /></div>
        <section id="scene-workspace">Static story</section>
        <LandingPreviewInteractions />
      </div>,
    );

    expect(scrollIntoView).not.toHaveBeenCalled();
    unmount();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: originalScrollIntoView,
    });
  });
});
