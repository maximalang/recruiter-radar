/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import {
  OnboardingView,
  type OnboardingViewSnapshot,
} from "@/app/onboarding/onboarding-page-content";

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
  test("renders a semantic four-step progress indicator and labeled agency form", () => {
    render(<OnboardingView snapshot={baseSnapshot} />);

    expect(screen.getByRole("heading", {
      level: 1,
      name: "Настроим радар под вашу практику",
    })).toBeInTheDocument();
    expect(screen.getByLabelText("Прогресс настройки")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByLabelText("Ваше имя")).toHaveAttribute(
      "autocomplete",
      "name",
    );
    expect(screen.getByLabelText("Название агентства или команды"))
      .toBeRequired();
    expect(screen.getByRole("button", { name: "Продолжить" }))
      .toBeInTheDocument();
  });

  test("offers an explicit delivery setup step without pretending Telegram is connected", () => {
    render(<OnboardingView snapshot={{
      ...baseSnapshot,
      step: "delivery",
      data: { fullName: "Анна", agencyName: "North Star", teamRole: "leader" },
    }} />);

    expect(screen.getByRole("heading", { level: 2, name: "Как получать новые возможности" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Telegram/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/Email для дайджеста/)).toHaveAttribute("type", "email");
    expect(screen.getByText(/доставка останется выключенной/i)).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Назад" })).toHaveAttribute(
      "value",
      "back",
    );
  });

  test("keeps market targeting in a separate third step", () => {
    render(<OnboardingView snapshot={{ ...baseSnapshot, step: "market", data: { fullName: "Анна", agencyName: "North Star", teamRole: "leader" } }} />);
    expect(screen.getByRole("heading", { level: 2, name: "Где искать клиентов" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Отрасли" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Размер компаний" })).toBeInTheDocument();
    expect(screen.getByLabelText("Россия и регионы")).toBeInTheDocument();
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
    expect(screen.getByText(/Доставка работает только при активном доступе/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Перейти в кабинет" }))
      .toBeInTheDocument();
  });
});
