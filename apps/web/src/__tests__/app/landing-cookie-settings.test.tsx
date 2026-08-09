import { SiteFooter } from "@/app/ui/site-footer";
import LandingPage from "@/app/landing/landing-page";

const props = {
  previewInput: {
    specialization: "",
    targetCity: "",
    includeKeywords: "",
    excludeKeywords: "",
    dailyDigestLimit: 10,
  },
  hasPreview: false,
  checkoutHref: "/checkout",
  paymentConfigured: true,
  faqItems: [],
};

describe("landing cookie settings availability", () => {
  const originalId = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;

  afterEach(() => {
    if (originalId === undefined) delete process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
    else process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = originalId;
  });

  it.each([
    [undefined, false],
    ["invalid", false],
    ["12345678", true],
  ])("passes analytics availability %p to the footer", (counterId, expected) => {
    if (counterId === undefined) delete process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
    else process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = counterId;

    const footer = findElementByType(LandingPage(props), SiteFooter);
    expect(footer?.props.showCookieSettings).toBe(expected);
  });
});

function findElementByType(node: unknown, type: unknown): { props: Record<string, unknown> } | null {
  if (!node || typeof node !== "object") return null;
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === type) return { props: element.props ?? {} };
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElementByType(child, type);
    if (found) return found;
  }
  return null;
}
