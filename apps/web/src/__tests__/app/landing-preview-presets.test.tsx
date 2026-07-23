/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";

import LandingPreviewPresets from "@/app/landing-preview-presets";

describe("LandingPreviewPresets", () => {
  it("exposes the selected profile as an accessible radio option", () => {
    render(
      <LandingPreviewPresets
        options={[
          { label: "Инженерный подбор · Москва", href: "/?specialization=engineering", selected: true },
          { label: "IT-подбор · удалённо", href: "/?specialization=it", selected: false },
        ]}
      />,
    );

    expect(screen.getByRole("radiogroup", { name: "Готовые профили радара" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Инженерный подбор · Москва" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("selects the next preset with ArrowRight and keeps the URL shareable", () => {
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function clickWithoutNavigation() {
        this.focus();
      });
    render(
      <LandingPreviewPresets
        options={[
          { label: "Москва", href: "/?specialization=engineering#preview-results", selected: true },
          { label: "Удалённо", href: "/?specialization=it#preview-results", selected: false },
        ]}
      />,
    );

    const first = screen.getByRole("radio", { name: "Москва" });
    fireEvent.keyDown(first, { key: "ArrowRight" });

    expect(screen.getByRole("radio", { name: "Удалённо" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Удалённо" })).toHaveFocus();
    expect(click).toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Удалённо" })).toHaveAttribute(
      "href",
      "/?specialization=it#preview-results",
    );
    click.mockRestore();
  });
});
