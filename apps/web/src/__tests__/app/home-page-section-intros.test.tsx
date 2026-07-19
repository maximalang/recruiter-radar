import { Children, isValidElement, type ReactNode } from "react";
import Link from "next/link";

import HomePage, { PreviewSection } from "@/app/page";
import { NoticeBox, SectionIntro } from "@/app/ui/page-primitives";
import {
  buildCheckoutHref,
  getPublicSampleDigestState,
  hasPublicPreviewInput,
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

function collectElements(node: ReactNode, type: unknown): React.ReactElement[] {
  const matches: React.ReactElement[] = [];

  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === type) matches.push(child);
    matches.push(...collectElements(child.props.children, type));
  });

  return matches;
}

function readVisibleText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);

  const parts: string[] = [];
  Children.forEach(node, (child) => {
    if (isValidElement(child)) parts.push(readVisibleText(child.props.children));
    else if (typeof child === "string" || typeof child === "number") parts.push(String(child));
  });
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

describe("landing section hierarchy", () => {
  beforeEach(() => {
    mockGetPublicSampleDigestState.mockResolvedValue({
      isLive: true,
      isPersonalized: false,
      hasExactMatches: true,
      items: [],
    });
  });

  it("uses the brand-accent eyebrow on every public landing section", async () => {
    // The live preview is now an async <PreviewSection> behind a <Suspense>
    // boundary (the home page is `force-dynamic` and the digest query blocked
    // the whole render — see page.tsx). HomePage's static tree no longer
    // contains the preview's children, so we render both halves and combine:
    // HomePage renders Проблема / Как работает / Проверка сигнала / Тарифы /
    // Перед запуском (5 SectionIntros), PreviewSection renders Пример результата
    // (1) — six total. The duplicate "Что внутри" block must not return.
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const preview = await PreviewSection({
      previewInput: readPublicPreviewInput({}),
      hasPreview: false,
      checkoutHref: buildCheckoutHref(readPublicPreviewInput({})),
    });
    const sectionIntros = [
      ...collectElements(page, SectionIntro),
      ...collectElements(preview, SectionIntro),
    ];

    expect(sectionIntros).toHaveLength(6);
    expect(sectionIntros.every((section) => section.props.accent === true)).toBe(true);
    expect(sectionIntros.map((section) => section.props.eyebrow)).toEqual([
      "Проблема",
      "Как работает",
      "Проверка сигнала",
      "Тарифы",
      "Перед запуском",
      "Пример результата",
    ]);
  });

  it("labels the resilient fallback as demo instead of personalized live data", async () => {
    mockGetPublicSampleDigestState.mockResolvedValueOnce({
      isLive: false,
      isPersonalized: false,
      hasExactMatches: true,
      items: [],
    });

    const input = readPublicPreviewInput({ specialization: "инженерный подбор" });
    const preview = await PreviewSection({
      previewInput: input,
      hasPreview: hasPublicPreviewInput(input),
      checkoutHref: buildCheckoutHref(input),
    });
    const previewText = readVisibleText(preview);
    const notices = collectElements(preview, NoticeBox);
    const previewIntro = collectElements(preview, SectionIntro)
      .find((section) => section.props.eyebrow === "Пример результата");

    expect(previewText).toContain("Демо радара");
    expect(previewText).not.toContain("Радар для вашего профиля");
    expect(notices.some((notice) => notice.props.title === "Показываем демо-карточки")).toBe(true);
    expect(previewText).toContain("Запустить актуальный радар");
    expect(previewIntro?.props.description).toBe(
      "Задайте город и специализацию. Сейчас можно оценить структуру карточек; актуальная выдача появится здесь после восстановления источника.",
    );
  });

  it("keeps filter submit and reset actions anchored to the preview", async () => {
    const input = readPublicPreviewInput({ specialization: "инженерный подбор" });
    const preview = await PreviewSection({
      previewInput: input,
      hasPreview: hasPublicPreviewInput(input),
      checkoutHref: buildCheckoutHref(input),
    });
    const forms = collectElements(preview, "form");
    const links = collectElements(preview, Link);
    const resetLink = links.find((link) => readVisibleText(link) === "Сбросить");

    expect(forms).toHaveLength(1);
    expect(forms[0].props.action).toBe("/#preview");
    expect(resetLink?.props.href).toBe("/#preview");
  });

  it("constrains the public profile fields before submission", async () => {
    const input = readPublicPreviewInput({});
    const preview = await PreviewSection({
      previewInput: input,
      hasPreview: hasPublicPreviewInput(input),
      checkoutHref: buildCheckoutHref(input),
    });
    const inputs = collectElements(preview, "input");
    const specialization = inputs.find((input) => input.props.name === "specialization");
    const targetCity = inputs.find((input) => input.props.name === "targetCity");

    expect(specialization?.props.maxLength).toBe(160);
    expect(targetCity?.props.maxLength).toBe(120);
  });
});
