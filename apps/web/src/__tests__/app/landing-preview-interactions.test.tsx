/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";

import LandingPreviewInteractions from "@/app/landing-preview-interactions";

describe("LandingPreviewInteractions", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("mounts with the real preview and blocks duplicate form submissions", () => {
    render(
      <div data-preview-section-content>
        <form data-preview-form aria-busy="false">
          <button type="submit" data-preview-submit>
            <span data-preview-submit-label>Посмотреть компании</span>
            <span data-preview-submit-status hidden>Радар анализирует сигналы…</span>
          </button>
        </form>
        <div data-preview-results />
        <LandingPreviewInteractions />
      </div>,
    );

    const form = screen.getByRole("button", { name: "Посмотреть компании" }).closest("form");
    const submit = screen.getByRole("button", { name: "Посмотреть компании" });

    expect(form).toHaveAttribute("aria-busy", "false");
    fireEvent.submit(form!);

    expect(form).toHaveAttribute("aria-busy", "true");
    expect(submit).toBeDisabled();
    expect(screen.getByText("Радар анализирует сигналы…")).not.toHaveAttribute("hidden");

    const duplicate = new Event("submit", { bubbles: true, cancelable: true });
    form?.dispatchEvent(duplicate);
    expect(duplicate.defaultPrevented).toBe(true);
  });

  it("restores the form after a persisted pageshow navigation", () => {
    render(
      <div data-preview-section-content>
        <form data-preview-form aria-busy="true">
          <button type="submit" data-preview-submit disabled>
            <span data-preview-submit-label hidden>Посмотреть компании</span>
            <span data-preview-submit-status>Радар анализирует сигналы…</span>
          </button>
        </form>
        <LandingPreviewInteractions />
      </div>,
    );

    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));

    expect(screen.getByRole("button", { name: "Посмотреть компании" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Посмотреть компании" }).closest("form"))
      .toHaveAttribute("aria-busy", "false");
  });
});
