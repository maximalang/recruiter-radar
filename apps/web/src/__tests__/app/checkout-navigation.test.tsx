import { Children, isValidElement, type ReactNode } from "react";

import CheckoutPage from "@/app/checkout/page";
import { InternalBackLink } from "@/app/ui/internal-page";

jest.mock("@/lib/account-auth", () => ({
  getAccountById: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/payments", () => ({
  startCheckoutOrder: jest.fn(),
}));

jest.mock("@/lib/session", () => ({
  readOwnerSession: jest.fn().mockResolvedValue(null),
}));

function collectElements(node: ReactNode, type: unknown): React.ReactElement[] {
  const matches: React.ReactElement[] = [];

  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === type) matches.push(child);
    matches.push(...collectElements(child.props.children, type));
  });

  return matches;
}

describe("checkout navigation", () => {
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
