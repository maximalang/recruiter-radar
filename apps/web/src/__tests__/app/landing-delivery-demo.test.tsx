/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";

import LandingDeliveryDemo from "@/app/landing-delivery-demo";

describe("LandingDeliveryDemo", () => {
  it("uses an accessible tabs pattern and supports arrow navigation", () => {
    render(<LandingDeliveryDemo />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(5);
    expect(screen.getByRole("tab", { name: "Telegram" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Telegram");

    fireEvent.keyDown(screen.getByRole("tab", { name: "Telegram" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Email" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Email" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Email" }), { key: "End" });
    expect(screen.getByRole("tab", { name: "Webhook" })).toHaveAttribute("aria-selected", "true");
  });

  it("exposes pressed feedback state and resets the demo", () => {
    render(<LandingDeliveryDemo />);

    const take = screen.getByRole("button", { name: "Беру в работу" });
    fireEvent.click(take);
    expect(take).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Будущая выдача");

    fireEvent.click(screen.getByRole("button", { name: "Сбросить пример" }));
    expect(take).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
