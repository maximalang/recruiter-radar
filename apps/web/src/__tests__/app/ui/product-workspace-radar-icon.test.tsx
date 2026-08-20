/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import { ProductWorkspaceFrame } from "@/app/ui/product-workspace";
import { buildAccountNavigation } from "@/app/ui/account-navigation";

describe("ProductWorkspace final navigation shell", () => {
  it("keeps desktop navigation textual and exposes the four stable product modes", () => {
    const { container } = render(
      <ProductWorkspaceFrame navItems={buildAccountNavigation("radar")}>
        Workspace
      </ProductWorkspaceFrame>,
    );

    const primary = screen.getByRole("navigation", { name: "Основные разделы" });
    expect(primary).toHaveTextContent("Сегодня");
    expect(primary).toHaveTextContent("Компании");
    expect(primary).toHaveTextContent("Ситуации");
    expect(primary).toHaveTextContent("Радар");
    expect(primary.querySelectorAll("svg")).toHaveLength(0);

    const radarLink = primary.querySelector('a[href="/opportunities/radar"]');
    expect(radarLink).toHaveAttribute("aria-current", "page");
    expect(container.querySelector("aside")).toBeNull();
  });

  it("keeps all four core modes plus More in mobile navigation", () => {
    render(
      <ProductWorkspaceFrame navItems={buildAccountNavigation("leads")}>
        Workspace
      </ProductWorkspaceFrame>,
    );

    const mobile = screen.getByRole("navigation", { name: "Мобильная навигация" });
    expect(mobile).toHaveTextContent("Сегодня");
    expect(mobile).toHaveTextContent("Компании");
    expect(mobile).toHaveTextContent("Ситуации");
    expect(mobile).toHaveTextContent("Радар");
    expect(mobile).toHaveTextContent("Ещё");
    expect(mobile.querySelectorAll(':scope > a')).toHaveLength(4);
    expect(mobile.querySelector('a[href="/leads"]')).toHaveAttribute("aria-current", "page");
  });
});
