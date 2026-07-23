/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";

import LandingPreviewInteractions from "@/app/landing-preview-interactions";

describe("LandingPreviewInteractions", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("does not claim a personalized generation merely by mounting", () => {
    const listener = jest.fn();
    window.addEventListener("landing:analytics", listener);

    const { unmount } = render(<LandingPreviewInteractions />);

    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ name: "preview_generated" }),
    }));
    unmount();
    window.removeEventListener("landing:analytics", listener);
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

  it("handles a preview form replaced by a server-component navigation", () => {
    const { container } = render(
      <div data-preview-section-content>
        <form data-preview-form aria-busy="false">
          <button type="submit" data-preview-submit>
            <span data-preview-submit-label>Submit preview</span>
            <span data-preview-submit-status hidden>Loading preview</span>
          </button>
        </form>
        <LandingPreviewInteractions />
      </div>,
    );

    const initialForm = container.querySelector<HTMLFormElement>("[data-preview-form]");
    const replacementForm = document.createElement("form");
    replacementForm.setAttribute("data-preview-form", "");
    replacementForm.setAttribute("aria-busy", "false");
    replacementForm.innerHTML = `
      <button type="submit" data-preview-submit>
        <span data-preview-submit-label>Submit replacement</span>
        <span data-preview-submit-status hidden>Loading replacement</span>
      </button>
    `;
    initialForm?.replaceWith(replacementForm);

    fireEvent.submit(replacementForm);

    expect(replacementForm).toHaveAttribute("aria-busy", "true");
    expect(replacementForm.querySelector("[data-preview-submit]")).toBeDisabled();
  });
});
