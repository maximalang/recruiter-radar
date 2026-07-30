/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import {
  OnboardingView,
  type OnboardingViewSnapshot,
} from "@/app/onboarding/page";

jest.mock("@/app/onboarding/actions", () => ({
  saveOnboardingAction: jest.fn(),
}));

const baseSnapshot: OnboardingViewSnapshot = {
  status: "in_progress",
  step: "agency",
  data: {},
  workspaceName: "Workspace 42",
  workspaceRole: "owner",
};

describe("auth v2 onboarding view", () => {
  test("renders a semantic three-step progress indicator and labeled agency form", () => {
    render(<OnboardingView snapshot={baseSnapshot} />);

    expect(screen.getByRole("heading", {
      level: 1,
      name: "Настроим радар под вашу практику",
    })).toBeInTheDocument();
    expect(screen.getByLabelText("Прогресс настройки")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByLabelText("Ваше имя")).toHaveAttribute(
      "autocomplete",
      "name",
    );
    expect(screen.getByLabelText("Название агентства или команды"))
      .toBeRequired();
    expect(screen.getByRole("button", { name: "Продолжить" }))
      .toBeInTheDocument();
  });

  test("renders only minimal profile choices and a back action on step two", () => {
    render(<OnboardingView snapshot={{
      ...baseSnapshot,
      step: "profile",
      data: {
        fullName: "Анна Смирнова",
        agencyName: "North Star",
        teamRole: "leader",
      },
    }} />);

    expect(screen.getByRole("heading", {
      level: 2,
      name: "Кого и где вы нанимаете",
    })).toBeInTheDocument();
    expect(screen.getByLabelText("Специализация")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Роли" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Отрасли" })).toBeInTheDocument();
    expect(screen.getByLabelText("География")).toBeInTheDocument();
    expect(screen.getByLabelText("Тип подбора")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Назад" })).toHaveAttribute(
      "value",
      "back",
    );
  });

  test("summarizes readiness without promising immediate delivery", () => {
    render(<OnboardingView snapshot={{
      ...baseSnapshot,
      step: "complete",
      data: {
        fullName: "Анна Смирнова",
        agencyName: "North Star",
        teamRole: "leader",
        specialization: "Product и Data",
        roles: ["data"],
        industries: ["it"],
        geography: ["Москва"],
        hiringMode: "specialist",
      },
    }} />);

    expect(screen.getByRole("heading", {
      level: 2,
      name: "Основа радара готова",
    })).toBeInTheDocument();
    expect(screen.getByText(/доставка включается отдельно/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Перейти в кабинет" }))
      .toBeInTheDocument();
  });
});
