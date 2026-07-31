/** @jest-environment jsdom */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import YandexMetrika from "@/app/yandex-metrika";

jest.mock("next/script", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return function MockNextScript({ onReady, ...props }: React.ComponentProps<"script"> & { onReady?: () => void }) {
    React.useEffect(() => { onReady?.(); }, [onReady]);
    return <script {...props} />;
  };
});

const CONSENT_KEY = "rr_analytics_consent_v1";

describe("YandexMetrika consent", () => {
  const originalId = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;

  beforeEach(() => {
    window.localStorage.clear();
    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "12345678";
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    delete window.ym;
    if (originalId === undefined) delete process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
    else process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = originalId;
  });

  test("does not load the script before explicit opt-in", async () => {
    const { container, findByRole } = render(<YandexMetrika />);
    await findByRole("dialog", { name: "Настройки аналитики" });
    expect(container.querySelector("#yandex-metrika-loader")).toBeNull();
  });

  test("loads Metrika only after the user accepts", async () => {
    const ym = jest.fn();
    window.ym = ym;
    const { container, findByRole, getByRole } = render(<YandexMetrika />);
    await findByRole("dialog", { name: "Настройки аналитики" });
    fireEvent.click(getByRole("button", { name: "Разрешить аналитику" }));

    await waitFor(() => expect(container.querySelector("#yandex-metrika-loader")).not.toBeNull());
    expect(window.localStorage.getItem(CONSENT_KEY)).toBe("accepted");
    await waitFor(() => expect(ym).toHaveBeenCalledWith(12345678, "hit", "/", expect.any(Object)));
  });

  test("keeps analytics disabled after rejection", async () => {
    const { container, findByRole, getByRole } = render(<YandexMetrika />);
    await findByRole("dialog", { name: "Настройки аналитики" });
    fireEvent.click(getByRole("button", { name: "Только необходимые cookies" }));
    expect(window.localStorage.getItem(CONSENT_KEY)).toBe("rejected");
    expect(container.querySelector("#yandex-metrika-loader")).toBeNull();
  });

  test("renders nothing without a valid public counter id", () => {
    process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID = "invalid";
    const { container } = render(<YandexMetrika />);
    expect(container).toBeEmptyDOMElement();
  });
});
