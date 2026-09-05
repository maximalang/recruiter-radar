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

jest.mock("@/lib/payment-readiness", () => ({
  buildPaymentReadinessReport: jest.fn(() => ({ selfServeCheckoutReady: false })),
}));

jest.mock("@/lib/auth-v2/authorization", () => ({
  getSession: jest.fn().mockResolvedValue(null),
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

function collectText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!isValidElement<Record<string, any>>(node)) return "";
  return [node.props.title, node.props.text, ...Children.toArray(node.props.children)]
    .map(collectText)
    .join(" ");
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

  it("does not promise a working payment provider when checkout is not ready", async () => {
    const page = await CheckoutPage({
      searchParams: Promise.resolve({ plan: "weekly" }),
    });

    const text = collectText(page);
    expect(text).toContain("Онлайн-оплата пока недоступна");
    expect(text).not.toContain("Карта и CVC вводятся");
  });

  it("returns to the landing example from checkout", async () => {
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
    expect(url.hash).toBe("#preview-configurator");
    expect(url.searchParams.get("specialization")).toBe("инженерный подбор");
    expect(url.searchParams.get("targetCity")).toBe("Москва");
    expect(url.searchParams.has("plan")).toBe(false);
  });
});
