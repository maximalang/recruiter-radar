/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

import { LeadsList } from "@/app/leads/leads-page-content";

function renderEmptyState(overrides: Partial<ComponentProps<typeof LeadsList>> = {}) {
  render(
    <LeadsList
      leads={[]}
      fitPreviewFor={() => null}
      hiringModeFor={() => "specialist"}
      hasActiveProfile
      hasAnyProfile
      lastRunAt="2026-08-09T08:00:00.000Z"
      narrowProfile={false}
      workingSet={false}
      {...overrides}
    />,
  );
}

describe("opportunities empty states", () => {
  test("distinguishes a saved inactive profile from an account with no profile", () => {
    renderEmptyState({ hasActiveProfile: false, hasAnyProfile: true, lastRunAt: null });
    expect(screen.getByText("Профиль Radar приостановлен")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Включить профиль Radar" })).toHaveAttribute("href", "/settings/radar");
  });

  test("distinguishes the first run from a completed run with no matches", () => {
    const { unmount } = render(
      <LeadsList leads={[]} fitPreviewFor={() => null} hiringModeFor={() => "specialist"} hasActiveProfile hasAnyProfile lastRunAt={null} narrowProfile={false} workingSet={false} />,
    );
    expect(screen.getByText("Первый запуск Radar ещё не завершён")).toBeInTheDocument();
    unmount();

    renderEmptyState();
    expect(screen.getByText("Подходящих компаний пока нет")).toBeInTheDocument();
  });
});
