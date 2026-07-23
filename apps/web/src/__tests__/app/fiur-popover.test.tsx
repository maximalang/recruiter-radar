/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";

import FiurPopover from "@/app/fiur-popover";

describe("FiurPopover", () => {
  it("opens for tap and closes with Escape", () => {
    render(
      <FiurPopover
        label="Соответствие"
        secondaryLabel="Fit"
        description="Насколько компания совпадает с профилем."
      />,
    );

    const trigger = screen.getByRole("button", { name: "Что означает «Соответствие»" });
    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip")).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes after an outside pointer interaction", () => {
    render(
      <div>
        <FiurPopover label="Актуальность" secondaryLabel="Urgency" description="Свежесть сигнала." />
        <button type="button">Снаружи</button>
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Что означает «Актуальность»" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Снаружи" }));

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("stays open when a pointer click follows hover", () => {
    render(<FiurPopover label="Fit" secondaryLabel="Fit" description="Profile match." />);

    const trigger = screen.getByRole("button");
    fireEvent.mouseEnter(trigger.parentElement!);
    fireEvent.click(trigger);

    expect(screen.getByRole("tooltip")).toBeVisible();
  });
});
