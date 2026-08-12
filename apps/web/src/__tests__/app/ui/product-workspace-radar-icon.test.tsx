/** @jest-environment jsdom */

import { render } from "@testing-library/react";

import { ProductWorkspaceFrame } from "@/app/ui/product-workspace";

describe("ProductWorkspace radar navigation icon", () => {
  it("uses the minimalist concentric-circle glyph for the Radar settings route", () => {
    const { container } = render(
      <ProductWorkspaceFrame
        navItems={[{ href: "/settings/radar", label: "Радар", active: true }]}
      >
        Workspace
      </ProductWorkspaceFrame>,
    );

    const radarLink = container.querySelector('aside a[href="/settings/radar"]');
    expect(radarLink).not.toBeNull();

    const icon = radarLink?.querySelector('[data-motion-icon="navigation"] svg');
    expect(icon).not.toBeNull();
    expect(icon?.querySelectorAll("circle")).toHaveLength(3);
    expect(icon?.querySelectorAll("path")).toHaveLength(0);
    expect(icon?.querySelector('circle[r="0.6"]')).toHaveAttribute("fill", "currentColor");
  });
});
