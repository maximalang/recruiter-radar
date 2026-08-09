import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";

import CheckoutPage from "@/app/checkout/page";
import { InternalBackLink, InternalPageFrame } from "@/app/ui/internal-page";

jest.mock("@/lib/account-auth", () => ({
  getAccountById: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/payments", () => ({
  startCheckoutOrder: jest.fn(),
}));

jest.mock("@/lib/auth-v2/authorization", () => ({
  getAuthorizedUserId: jest.fn().mockResolvedValue(null),
}));

function collectElements(node: ReactNode, type: unknown): ReactElement<Record<string, any>>[] {
  const matches: ReactElement<Record<string, any>>[] = [];

  Children.forEach(node, (child) => {
    if (!isValidElement<Record<string, any>>(child)) return;
    if (child.type === type) matches.push(child);
    matches.push(...collectElements(child.props.children, type));
  });

  return matches;
}

describe("checkout navigation", () => {
  it("keeps checkout navigation targets touch-safe without an off-canvas skip link", () => {
    const appRoot = path.resolve(process.cwd(), "app");
    const checkoutStyles = readFileSync(path.join(appRoot, "checkout/checkout.module.css"), "utf8");
    const internalStyles = readFileSync(path.join(appRoot, "ui/internal-page.module.css"), "utf8");

    expect(checkoutStyles).toMatch(/\.documentLinks a\s*\{[\s\S]*?min-height:\s*44px;/);
    expect(internalStyles).toMatch(/\.internalPageBackLink\s*\{[\s\S]*?min-height:\s*44px;/);
    expect(internalStyles).not.toContain("left: -9999px");
    expect(internalStyles).toMatch(/\.skipLink\s*\{[\s\S]*?transform:\s*translateY\(-100%\);/);
  });

  it("keeps checkout outside the product workspace navigation", async () => {
    const page = await CheckoutPage({
      searchParams: Promise.resolve({ plan: "weekly" }),
    });

    expect(page.type).toBe(InternalPageFrame);
    expect(page.props.navItems).toBeUndefined();
  });

  it("returns to the landing preview when the user edits radar parameters", async () => {
    const page = await CheckoutPage({
      searchParams: Promise.resolve({
        specialization: "инженерный подбор",
        targetCity: "Москва",
        plan: "monthly",
      }),
    });
    const [backLink] = collectElements(page, InternalBackLink);
    const url = new URL(backLink.props.href, "https://radar.example");

    expect(url.pathname).toBe("/");
    expect(url.hash).toBe("#preview");
    expect(url.searchParams.get("specialization")).toBe("инженерный подбор");
    expect(url.searchParams.get("targetCity")).toBe("Москва");
    expect(url.searchParams.has("plan")).toBe(false);
  });
});
