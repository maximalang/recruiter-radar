import { Children, isValidElement, type ReactNode } from "react";
import Link from "next/link";

import HomePage from "@/app/page";
import { NoticeBox, SectionIntro } from "@/app/ui/page-primitives";
import { getPublicSampleDigestState } from "@/lib/publicProduct";

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
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const sectionIntros = collectElements(page, SectionIntro);

    expect(sectionIntros).toHaveLength(7);
    expect(sectionIntros.every((section) => section.props.accent === true)).toBe(true);
  });

  it("labels the resilient fallback as demo instead of personalized live data", async () => {
    mockGetPublicSampleDigestState.mockResolvedValueOnce({
      isLive: false,
      isPersonalized: false,
      hasExactMatches: true,
      items: [],
    });

    const page = await HomePage({
      searchParams: Promise.resolve({ specialization: "инженерный подбор" }),
    });
    const pageText = readVisibleText(page);
    const notices = collectElements(page, NoticeBox);
    const previewIntro = collectElements(page, SectionIntro)
      .find((section) => section.props.eyebrow === "Пример результата");

    expect(pageText).toContain("Демо радара");
    expect(pageText).not.toContain("Радар для вашего профиля");
    expect(notices.some((notice) => notice.props.title === "Показываем демо-карточки")).toBe(true);
    expect(pageText).toContain("Запустить актуальный радар");
    expect(pageText).toContain("В рабочем радаре компании, даты и источники берутся из актуальных открытых данных.");
    expect(pageText).not.toContain("Реальные компании, даты и источники приходят в радаре выше");
    expect(previewIntro?.props.description).toBe(
      "Задайте город и специализацию. Сейчас можно оценить структуру карточек; актуальная выдача появится здесь после восстановления источника.",
    );
  });

  it("keeps filter submit and reset actions anchored to the preview", async () => {
    const page = await HomePage({
      searchParams: Promise.resolve({ specialization: "инженерный подбор" }),
    });
    const forms = collectElements(page, "form");
    const links = collectElements(page, Link);
    const resetLink = links.find((link) => readVisibleText(link) === "Сбросить");

    expect(forms).toHaveLength(1);
    expect(forms[0].props.action).toBe("/#preview");
    expect(resetLink?.props.href).toBe("/#preview");
  });

  it("constrains the public profile fields before submission", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const inputs = collectElements(page, "input");
    const specialization = inputs.find((input) => input.props.name === "specialization");
    const targetCity = inputs.find((input) => input.props.name === "targetCity");

    expect(specialization?.props.maxLength).toBe(160);
    expect(targetCity?.props.maxLength).toBe(120);
  });
});
