import { Children, isValidElement, type ReactNode } from "react";

import RootLayout from "@/app/layout";
import YandexMetrika from "@/app/yandex-metrika";

function containsElementType(node: ReactNode, type: unknown): boolean {
  let found = false;
  Children.forEach(node, (child) => {
    if (!isValidElement<{ children?: ReactNode }>(child) || found) return;
    if (child.type === type) {
      found = true;
      return;
    }
    found = containsElementType(child.props.children, type);
  });
  return found;
}

describe("YandexMetrika", () => {
  const originalId = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;

  afterEach(() => {
    if (originalId === undefined) delete process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
    else process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = originalId;
  });

  it("renders nothing when the public counter id is missing or invalid", () => {
    delete process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
    expect(YandexMetrika()).toBeNull();

    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "not-a-counter";
    expect(YandexMetrika()).toBeNull();
  });

  it("loads the official tag only for a numeric counter id", () => {
    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "12345678";
    const script = YandexMetrika();
    const initialization = script?.props.children as string;

    expect(initialization).toContain("https://mc.yandex.ru/metrika/tag.js");
    expect(initialization).toContain("12345678");
  });

  it("mounts Metrika in the root layout shared by checkout and onboarding", () => {
    const layout = RootLayout({ children: <main data-route-content /> });

    expect(containsElementType(layout, YandexMetrika)).toBe(true);
  });
});
