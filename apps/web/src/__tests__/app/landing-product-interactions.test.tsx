/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import LandingHowItWorks from "@/app/landing-how-it-works";

describe("landing product explanation", () => {
  it("explains the workflow as four visible, ordered steps", () => {
    render(<LandingHowItWorks />);

    const flow = screen.getByTestId("how-it-works-flow");
    expect(flow.tagName).toBe("OL");
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByRole("heading", { name: "Собираем сигналы найма" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Объединяем факты по компании" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Рассчитываем приоритет" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Показываем следующий шаг" })).toBeVisible();
  });

  it("does not require pointer, keyboard or canvas interaction to understand the process", () => {
    render(<LandingHowItWorks />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(document.querySelector("canvas")).not.toBeInTheDocument();
    expect(screen.getByText(/корпоративный контакт/)).toBeVisible();
  });
});
