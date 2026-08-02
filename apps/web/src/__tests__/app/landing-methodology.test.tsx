/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import LandingMethodology from "@/app/landing-methodology";

describe("LandingMethodology", () => {
  it("shows all four score dimensions without interaction", () => {
    render(<LandingMethodology />);

    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("Fit")).toBeVisible();
    expect(screen.getByText("Intent")).toBeVisible();
    expect(screen.getByText("Urgency")).toBeVisible();
    expect(screen.getByText("Reachability")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps the scoring limitation explicit", () => {
    render(<LandingMethodology />);

    expect(screen.getByText(/Сильный итоговый балл не скрывает слабые места/)).toBeVisible();
    expect(screen.getByText(/не попадает в клиентскую выдачу/)).toBeVisible();
  });
});
