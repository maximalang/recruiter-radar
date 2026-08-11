/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import { AuthShell } from "@/app/login/auth-shell";
import { InternalPageFrame } from "@/app/ui/internal-page";
import { PageFrame } from "@/app/ui/page-primitives";
import { ProductWorkspaceFrame } from "@/app/ui/product-workspace";

const NAVIGATION = [{ href: "/dashboard", label: "Дашборд", active: true }];

describe("Recruiter Radar unified UI system", () => {
  it("marks every surface with its active visual-system contract", () => {
    const publicView = render(<PageFrame>Public</PageFrame>);
    expect(publicView.container.firstElementChild).toHaveAttribute(
      "data-ui-system",
      "recruiter-radar-v6",
    );
    publicView.unmount();

    const authView = render(<AuthShell>Auth</AuthShell>);
    expect(authView.container.firstElementChild).toHaveAttribute(
      "data-ui-system",
      "recruiter-radar-v6",
    );
    authView.unmount();

    const workspaceView = render(
      <ProductWorkspaceFrame navItems={NAVIGATION}>Workspace</ProductWorkspaceFrame>,
    );
    expect(workspaceView.container.firstElementChild).toHaveAttribute(
      "data-ui-system",
      "recruiter-radar-v7",
    );
  });

  it("renders legacy internal pages through the same product workspace shell", () => {
    const { container } = render(
      <InternalPageFrame navItems={NAVIGATION}>Internal</InternalPageFrame>,
    );

    expect(container.firstElementChild).toHaveAttribute("data-product-workspace", "true");
    expect(container.querySelectorAll('[aria-label="Разделы кабинета"]')).toHaveLength(1);
  });

  it("keeps product navigation and legal access compact without claiming unknown runtime status", () => {
    render(
      <ProductWorkspaceFrame
        navItems={[
          { href: "/dashboard", label: "Дашборд", active: true },
          { href: "/leads", label: "Лиды" },
          { href: "/review", label: "Проверка" },
          { href: "/profile", label: "Профиль" },
          { href: "/settings", label: "Настройки" },
        ]}
      >
        Workspace
      </ProductWorkspaceFrame>,
    );

    expect(screen.queryByText("Радар активен")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "К содержанию" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(screen.getByRole("navigation", { name: "Мобильная навигация" })).toBeInTheDocument();
    expect(screen.getByText("Ещё")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo", { name: "Служебные ссылки" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Поддержка" })).toHaveAttribute(
      "href",
      "mailto:support@recruiter-radar.ru",
    );
    expect(screen.queryByRole("navigation", { name: "Продукт" })).not.toBeInTheDocument();
  });

  it("exposes semantic motion state without changing navigation semantics", () => {
    const { container } = render(
      <ProductWorkspaceFrame
        navItems={[
          { href: "/dashboard", label: "Dashboard", active: true },
          { href: "/leads", label: "Leads" },
          { href: "/review", label: "Review" },
          { href: "/profile", label: "Profile" },
          { href: "/settings", label: "Settings" },
        ]}
      >
        Workspace
      </ProductWorkspaceFrame>,
    );

    const currentLinks = container.querySelectorAll('a[aria-current="page"]');
    expect(currentLinks).toHaveLength(2);
    currentLinks.forEach((link) => {
      expect(link).toHaveAttribute("data-motion-interactive");
      expect(link.querySelector('[data-motion-icon="navigation"]')).toHaveAttribute(
        "data-motion-state",
        "active",
      );
    });

    const idleLinks = container.querySelectorAll('a[href="/leads"]');
    expect(idleLinks).toHaveLength(2);
    idleLinks.forEach((link) => {
      expect(link.querySelector('[data-motion-icon="navigation"]')).toHaveAttribute(
        "data-motion-state",
        "idle",
      );
    });

    const mobileMore = container.querySelector("details");
    expect(mobileMore).toHaveAttribute("data-motion-disclosure");
    expect(mobileMore?.querySelector("summary")).toHaveAttribute("data-motion-interactive");
    expect(mobileMore?.querySelector('[data-motion-icon="disclosure"]')).not.toBeNull();
  });
});
