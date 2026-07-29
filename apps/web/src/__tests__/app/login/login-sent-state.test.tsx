/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useActionState: () => [{
    ok: true,
    email: "owner@gmail.com",
    returnTo: "/dashboard",
    requestedAt: Date.now(),
  }, jest.fn(), false],
}));

jest.mock("@/app/login/actions", () => ({
  requestLoginAction: jest.fn(),
}));

import LoginForm from "@/app/login/login-form";

describe("login email-sent state", () => {
  test("replaces the form with complete, accessible next actions", () => {
    render(<LoginForm returnTo="/dashboard" />);

    expect(screen.getByRole("heading", { name: "Проверьте почту" })).toBeVisible();
    expect(screen.getByText("owner@gmail.com")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("15 минут");
    expect(screen.getByRole("link", { name: "Открыть почту" }))
      .toHaveAttribute("href", "https://mail.google.com/");
    expect(screen.getByRole("button", { name: /Отправить повторно через/ }))
      .toBeDisabled();
    expect(screen.getByRole("button", { name: "Указать другой email" }))
      .toBeEnabled();
    expect(screen.getByRole("link", { name: "Обратиться в поддержку" }))
      .toHaveAttribute("href", "/legal");
  });
});
