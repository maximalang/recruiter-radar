/** @jest-environment jsdom */

import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    delete window.ym;
    if (originalId === undefined) delete process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
    else process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = originalId;
  });

  it("renders nothing when the public counter id is missing or invalid", async () => {
    delete process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
    const { container, rerender } = render(<YandexMetrika />);
    expect(container.querySelector("#yandex-metrika-loader")).toBeNull();
    expect(container.querySelector("[data-analytics-consent]")).toBeNull();

    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "not-a-counter";
    rerender(<YandexMetrika />);
    expect(container.querySelector("#yandex-metrika-loader")).toBeNull();
  });

  it("does not load Metrika until the user grants analytics consent", async () => {
    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "12345678";
    const { container } = render(<YandexMetrika />);

    await screen.findByRole("dialog", { name: "Необязательная аналитика" });
    expect(container.querySelector("#yandex-metrika-loader")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Только необходимые" }));
    expect(container.querySelector("#yandex-metrika-loader")).toBeNull();
    const settingsButton = screen.getByRole("button", { name: "Изменить настройки cookies" });
    expect(settingsButton).toHaveAttribute("title", "Cookies");
    expect(settingsButton).not.toHaveAttribute("style");
    expect(window.localStorage.getItem("rr_analytics_consent_v1")).toContain('"value":"denied"');
  });

  it("loads the official tag and emits one query-free pageview after consent", async () => {
    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "12345678";
    const ym = jest.fn();
    window.ym = ym;
    const { container } = render(<YandexMetrika />);

    await screen.findByRole("dialog", { name: "Необязательная аналитика" });
    fireEvent.click(screen.getByRole("button", { name: "Разрешить аналитику" }));

    const loader = await waitFor(() => {
      const node = container.querySelector("#yandex-metrika-loader");
      expect(node).not.toBeNull();
      return node;
    });
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
    expect(ym.mock.calls.filter((call) => call[1] === "hit")).toHaveLength(1);
    expect(window.localStorage.getItem("rr_analytics_consent_v1")).toContain('"value":"granted"');
  });

  it("asks again when a stored choice is older than fourteen months", async () => {
    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "12345678";
    window.localStorage.setItem("rr_analytics_consent_v1", JSON.stringify({
      value: "granted",
      decidedAt: "2024-01-01T00:00:00.000Z",
    }));

    const { container } = render(<YandexMetrika />);
    await screen.findByRole("dialog", { name: "Необязательная аналитика" });
    expect(container.querySelector("#yandex-metrika-loader")).toBeNull();
    expect(window.localStorage.getItem("rr_analytics_consent_v1")).toBeNull();
  });

  it("does not mount Metrika globally or on routes with customer data", () => {
    const layout = RootLayout({ children: <main data-route-content /> });

    expect(containsElementType(layout, YandexMetrika)).toBe(false);

    const landing = readFileSync(resolve(process.cwd(), "app/home-page-content.tsx"), "utf8");
    const checkout = readFileSync(resolve(process.cwd(), "app/checkout/page.tsx"), "utf8");
    const onboarding = readFileSync(
      resolve(process.cwd(), "app/onboarding/pilot/[orderId]/page.tsx"),
      "utf8",
    );
    expect(landing).toContain("<YandexMetrika");
    expect(checkout).not.toContain("YandexMetrika");
    expect(onboarding).not.toContain("YandexMetrika");
  });
});
