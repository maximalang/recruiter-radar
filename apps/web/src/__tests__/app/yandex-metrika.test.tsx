/** @jest-environment jsdom */

import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, waitFor } from "@testing-library/react";

import RootLayout from "@/app/layout";
import YandexMetrika from "@/app/yandex-metrika";

jest.mock("next/script", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return function MockNextScript({
    onReady,
    ...props
  }: ComponentProps<"script"> & { onReady?: () => void }) {
    React.useEffect(() => {
      onReady?.();
    }, [onReady]);
    return <script {...props} />;
  };
});

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
    cleanup();
    delete window.ym;
    if (originalId === undefined) delete process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
    else process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = originalId;
  });

  it("renders nothing when the public counter id is missing or invalid", () => {
    delete process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
    const { container, rerender } = render(<YandexMetrika pathname="/" />);
    expect(container.querySelector("#yandex-metrika-loader")).toBeNull();

    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "not-a-counter";
    rerender(<YandexMetrika pathname="/" />);
    expect(container.querySelector("#yandex-metrika-loader")).toBeNull();
  });

  it("loads the official tag and emits explicit query-free SPA pageviews", async () => {
    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "12345678";
    const ym = jest.fn();
    window.ym = ym;
    const { container, rerender } = render(<YandexMetrika pathname="/" />);
    const loader = container.querySelector("#yandex-metrika-loader");
    const initialization = loader?.textContent ?? "";

    expect(initialization).toContain("https://mc.yandex.ru/metrika/tag.js");
    expect(initialization).toContain("12345678");
    expect(initialization).toContain("defer:true");
    expect(initialization).toContain("clickmap:false");
    expect(initialization).toContain("trackLinks:false");
    expect(initialization).toContain("webvisor:false");
    expect(initialization).not.toContain("window.location");
    expect(initialization).not.toContain("location.search");

    await waitFor(() => expect(ym).toHaveBeenCalledWith(
      12345678,
      "hit",
      "/",
      expect.objectContaining({ title: expect.any(String) }),
    ));
    rerender(<YandexMetrika pathname="/checkout" />);
    rerender(<YandexMetrika pathname="/" />);

    await waitFor(() => {
      const pageviews = ym.mock.calls
        .filter((call) => call[1] === "hit")
        .map((call) => call[2]);
      expect(pageviews).toEqual(["/", "/checkout", "/"]);
    });
  });

  it("does not mount Metrika globally and scopes it to public funnel routes", () => {
    const layout = RootLayout({ children: <main data-route-content /> });

    expect(containsElementType(layout, YandexMetrika)).toBe(false);

    const landing = readFileSync(resolve(process.cwd(), "app/page.tsx"), "utf8");
    const checkout = readFileSync(resolve(process.cwd(), "app/checkout/page.tsx"), "utf8");
    const onboarding = readFileSync(
      resolve(process.cwd(), "app/onboarding/pilot/[orderId]/page.tsx"),
      "utf8",
    );
    expect(landing).toContain('<YandexMetrika pathname="/"');
    expect(checkout).toContain('<YandexMetrika pathname="/checkout"');
    expect(onboarding).toContain('<YandexMetrika pathname="/onboarding"');
  });
});
