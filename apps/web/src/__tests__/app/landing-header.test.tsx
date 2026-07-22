/** @jest-environment jsdom */

import { act, fireEvent, render, screen, within } from "@testing-library/react";

import LandingHeader from "@/app/landing-header";

describe("landing header accessibility", () => {
  it("offers the required navigation and a clear activation path", () => {
    render(<LandingHeader />);

    expect(screen.getAllByRole("link", { name: "Собрать мой радар" })[0]).toHaveAttribute(
      "href",
      "#preview-configurator",
    );

    expect(screen.getAllByRole("link", { name: "Войти" })[0]).toHaveAttribute(
      "href",
      "/dashboard",
    );

    expect(screen.getAllByRole("link", { name: "Пример радара" })[0]).toHaveAttribute(
      "href",
      "#preview-configurator",
    );

    expect(screen.getAllByRole("link", { name: "Методология" })[0]).toHaveAttribute(
      "href",
      "#quality",
    );

    expect(screen.getAllByRole("link", { name: "Стоимость" })[0]).toHaveAttribute(
      "href",
      "#pricing",
    );
  });

  it("keeps the full navigation available in a native mobile disclosure", () => {
    render(<LandingHeader />);

    const menuSummary = screen.getByText("Меню").closest("summary");

    expect(menuSummary).not.toBeNull();
    expect(menuSummary).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByRole("link", { name: "Войти" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Как работает" })).toHaveLength(2);
  });

  it("closes the mobile disclosure after choosing a destination", () => {
    render(<LandingHeader />);

    const mobileNav = screen.getByRole("navigation", { name: "Мобильная навигация" });
    const disclosure = mobileNav.closest("details");
    if (!disclosure) throw new Error("Mobile navigation disclosure is missing");
    disclosure.open = true;
    fireEvent(disclosure, new Event("toggle"));
    expect(screen.getByText("Меню").closest("summary")).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(within(mobileNav).getByRole("link", { name: "Стоимость" }));

    expect(disclosure).not.toHaveAttribute("open");
  });

  it("marks the section currently intersecting the reading band", () => {
    let callback: IntersectionObserverCallback = () => undefined;
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: jest.fn((nextCallback: IntersectionObserverCallback) => {
        callback = nextCallback;
        return { observe: jest.fn(), disconnect: jest.fn(), unobserve: jest.fn() };
      }),
    });

    render(<><LandingHeader /><section id="quality">Методология</section></>);
    const section = document.getElementById("quality");
    if (!section) throw new Error("Quality section missing");
    act(() => callback([{ isIntersecting: true, intersectionRatio: 0.8, target: section } as IntersectionObserverEntry], {} as IntersectionObserver));

    expect(screen.getAllByRole("link", { name: "Методология" })[0]).toHaveAttribute("aria-current", "location");
  });
});
