import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import HomePage, { PreviewSection, PreviewSkeleton } from "@/app/page";
import { SurfaceCard } from "@/app/ui/page-primitives";
import {
  buildCheckoutHref,
  getPublicSampleDigestState,
  readPublicPreviewInput,
} from "@/lib/publicProduct";

jest.mock("@/lib/payments", () => ({
  getPaymentProviderSetupState: () => ({ configured: false }),
}));

jest.mock("@/lib/publicProduct", () => {
  const actual = jest.requireActual("@/lib/publicProduct");
  return {
    ...actual,
    getPublicSampleDigestState: jest.fn(),
  };
});

const mockGetPublicSampleDigestState = getPublicSampleDigestState as jest.MockedFunction<
  typeof getPublicSampleDigestState
>;

function collectElements(node: ReactNode, type: unknown): ReactElement<Record<string, any>>[] {
  const matches: ReactElement<Record<string, any>>[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement<Record<string, any>>(child)) return;
    if (child.type === type) matches.push(child);
    matches.push(...collectElements(child.props.children, type));
  });
  return matches;
}

function visibleText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  const parts: string[] = [];
  Children.forEach(node, (child) => {
    if (isValidElement<{ children?: ReactNode }>(child)) {
      parts.push(visibleText(child.props.children));
    } else if (typeof child === "string" || typeof child === "number") {
      parts.push(String(child));
    }
  });
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

describe("landing conversion final pass", () => {
  beforeEach(() => {
    mockGetPublicSampleDigestState.mockResolvedValue({
      isLive: true,
      isPersonalized: false,
      hasExactMatches: true,
      items: [],
    });
  });

  it("uses one responsive anchor-offset contract for sections and streamed preview anchors", async () => {
    const globalCss = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
    const landingCss = readFileSync(
      resolve(process.cwd(), "app/home-page-components.module.css"),
      "utf8",
    );
    const input = readPublicPreviewInput({});
    const preview = await PreviewSection({
      previewInput: input,
      hasPreview: false,
      checkoutHref: buildCheckoutHref(input),
    });
    const previewMarkup = [
      renderToStaticMarkup(preview),
      renderToStaticMarkup(<PreviewSkeleton />),
    ].join("");

    expect(globalCss).toContain("--landing-header-offset");
    expect(globalCss).toMatch(/scroll-padding-top:\s*var\(--landing-header-offset\)/);
    expect(globalCss).toMatch(/section\[id\][^{]*,\s*[^{]*\[data-scroll-anchor\]/);
    expect(previewMarkup.match(/data-scroll-anchor="true"/g)).toHaveLength(4);
    expect(landingCss).toMatch(/\.productProofSlot:empty\s*{\s*display:\s*none;/);
  });

  it("presents one radar product with honest period choices and no discount theatre", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const pageText = visibleText(page);
    const pricingProducts = collectElements(page, SurfaceCard)
      .filter((card) => card.props.className?.includes("pricingProduct"));

    expect(pricingProducts).toHaveLength(1);
    expect(pageText).toContain("Доступ к Recruiter Radar");
    expect(pageText).toContain("7 дней");
    expect(pageText).toContain("30 дней");
    expect(pageText).toContain("90 дней");
    expect(pageText).toContain("Месяц и квартал подключаются после короткой настройки профиля.");
    expect(pageText).not.toMatch(/скидк|экономи|зач[её]ркнут|осталось \d+ мест/i);
  });

  it("explains the post-payment path and the product fit before checkout", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const pageText = visibleText(page);

    expect(pageText).toContain("После оплаты");
    expect(pageText).toContain("Настройте профиль агентства — около 3–5 минут");
    expect(pageText).toContain("Подключите Telegram");
    expect(pageText).toContain("Первая выдача появится после ближайшего планового пересчёта.");
    expect(pageText).toContain("Recruiter Radar полезен, если");
    expect(pageText).toContain("Продукт не подойдёт, если вам нужны");
    expect(pageText).toContain("массовые автоматические рассылки");
    expect(pageText).toContain("личные контакты сотрудников");
  });
});
