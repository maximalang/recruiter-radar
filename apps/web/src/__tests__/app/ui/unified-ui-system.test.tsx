/** @jest-environment jsdom */

import { render } from "@testing-library/react";

import { AuthShell } from "@/app/login/auth-shell";
import { InternalPageFrame } from "@/app/ui/internal-page";
import { PageFrame } from "@/app/ui/page-primitives";
import { ProductWorkspaceFrame } from "@/app/ui/product-workspace";

const NAVIGATION = [{ href: "/dashboard", label: "Дашборд", active: true }];

describe("Recruiter Radar unified UI system", () => {
  it("marks public, auth and product surfaces with one visual-system contract", () => {
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
      "recruiter-radar-v6",
    );
  });

  it("renders legacy internal pages through the same product workspace shell", () => {
    const { container } = render(
      <InternalPageFrame navItems={NAVIGATION}>Internal</InternalPageFrame>,
    );

    expect(container.firstElementChild).toHaveAttribute("data-product-workspace", "true");
    expect(container.querySelectorAll('[aria-label="Разделы кабинета"]')).toHaveLength(1);
  });
});
