/** @jest-environment jsdom */

import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import RootLayout from "@/app/layout";
import YandexMetrika, { getYandexCookieDomainAttributes } from "@/app/yandex-metrika";
import { sendLandingEvent } from "@/app/landing-analytics";
import { ANALYTICS_SETTINGS_OPEN_EVENT } from "@/lib/analytics-consent";

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
    global.fetch = jest.fn().mockResolvedValue({ status: 204 }) as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    delete window.ym;
    delete (window as unknown as Record<string, unknown>).disableYaCounter12345678;
    if (originalId === undefined) delete process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
    else process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = originalId;
  });

  it("renders no analytics controls without a valid counter", () => {
    delete process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
    const { container, rerender } = render(<YandexMetrika />);
    expect(container.querySelector("#yandex-metrika-loader")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Необязательная аналитика" })).toBeNull();

    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "not-a-counter";
    rerender(<YandexMetrika />);
    expect(container.querySelector("#yandex-metrika-loader")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Необязательная аналитика" })).toBeNull();
  });

  it("does not load Metrika until the user grants analytics consent", async () => {
    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "12345678";
    const { container } = render(<YandexMetrika />);

    await screen.findByRole("dialog", { name: "Необязательная аналитика" });
    expect(container.querySelector("#yandex-metrika-loader")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Отклонить необязательные" }));
    expect(container.querySelector("#yandex-metrika-loader")).toBeNull();
    expect(screen.queryByRole("button", { name: "Изменить настройки cookies" })).toBeNull();
    expect(window.localStorage.getItem("rr_analytics_consent")).toContain('"analytics":false');
    expect(window.localStorage.getItem("rr_analytics_consent")).toContain('"policyVersion":2');
  });

  it("reopens settings from the footer event without a floating control", async () => {
    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "12345678";
    render(<YandexMetrika />);
    await screen.findByRole("dialog", { name: "Необязательная аналитика" });
    fireEvent.click(screen.getByRole("button", { name: "Отклонить необязательные" }));
    expect(screen.queryByRole("dialog", { name: "Необязательная аналитика" })).toBeNull();

    act(() => window.dispatchEvent(new Event(ANALYTICS_SETTINGS_OPEN_EVENT)));
    await screen.findByRole("dialog", { name: "Необязательная аналитика" });
  });

  it("loads the official tag and emits one query-free pageview after consent", async () => {
    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "12345678";
    const ym = jest.fn();
    window.ym = ym;
    const { container } = render(<YandexMetrika />);

    await screen.findByRole("dialog", { name: "Необязательная аналитика" });
    fireEvent.click(screen.getByRole("button", { name: "Принять аналитику" }));

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
    expect(window.localStorage.getItem("rr_analytics_consent")).toContain('"analytics":true');
  });

  it("destructs and disables an initialized counter when consent is revoked", async () => {
    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "12345678";
    const ym = jest.fn();
    window.ym = ym;
    document.cookie = "_ym_uid=test; Path=/";
    const { container } = render(<YandexMetrika />);

    await screen.findByRole("dialog", { name: "Необязательная аналитика" });
    fireEvent.click(screen.getByRole("button", { name: "Принять аналитику" }));
    await waitFor(() => expect(container.querySelector("#yandex-metrika-loader")).not.toBeNull());
    act(() => window.dispatchEvent(new Event(ANALYTICS_SETTINGS_OPEN_EVENT)));
    fireEvent.click(await screen.findByRole("button", { name: "Отклонить необязательные" }));

    expect(ym).toHaveBeenCalledWith(12345678, "destruct");
    expect((window as unknown as Record<string, unknown>).disableYaCounter12345678).toBe(true);
    expect(container.querySelector("#yandex-metrika-loader")).toBeNull();
    expect(document.cookie).not.toContain("_ym_uid=");
  });

  it("expires both host and parent-domain Yandex identifiers", () => {
    expect(getYandexCookieDomainAttributes("www.recruiter-radar.ru")).toEqual([
      "; Domain=www.recruiter-radar.ru",
      "; Domain=.www.recruiter-radar.ru",
      "; Domain=recruiter-radar.ru",
      "; Domain=.recruiter-radar.ru",
    ]);
    expect(getYandexCookieDomainAttributes("127.0.0.1")).toEqual([]);
  });

  it("asks again when a stored choice is older than fourteen months", async () => {
    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "12345678";
    window.localStorage.setItem("rr_analytics_consent", JSON.stringify({
      analytics: true,
      policyVersion: 2,
      updatedAt: "2024-01-01T00:00:00.000Z",
    }));

    const { container } = render(<YandexMetrika />);
    await screen.findByRole("dialog", { name: "Необязательная аналитика" });
    expect(container.querySelector("#yandex-metrika-loader")).toBeNull();
    expect(window.localStorage.getItem("rr_analytics_consent")).toBeNull();
    sendLandingEvent({ name: "landing_viewed" });
    expect(global.fetch).not.toHaveBeenCalled();
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
