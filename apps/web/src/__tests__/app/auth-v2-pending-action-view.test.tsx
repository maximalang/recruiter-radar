/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from "@testing-library/react";

import { PendingAuthActionView } from "@/app/auth/pending-auth-action-view";

describe("auth v2 fragment action view", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    window.history.replaceState({}, "", "/auth/invite");
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test("clears a valid fragment before moving it to an HttpOnly cookie", async () => {
    window.history.replaceState(
      {},
      "",
      `/auth/invite#${"a".repeat(64)}`,
    );
    jest.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as Response);

    render(
      <PendingAuthActionView
        kind="workspace_invite"
        authenticated
        hasPending={false}
      />,
    );

    await act(async () => undefined);

    expect(window.location.hash).toBe("");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/invite/prepare",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: "a".repeat(64) }),
      }),
    );
    expect(await screen.findByRole("button", {
      name: "Принять приглашение",
    })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("a".repeat(64));
  });

  test("rejects a malformed fragment locally without sending it", async () => {
    window.history.replaceState({}, "", "/auth/change-email#invalid");

    render(
      <PendingAuthActionView
        kind="email_change"
        authenticated
        hasPending={false}
      />,
    );

    expect(await screen.findByText(/Ссылка недействительна/)).toBeInTheDocument();
    expect(window.location.hash).toBe("");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("keeps a prepared invite behind the login boundary", () => {
    render(
      <PendingAuthActionView
        kind="workspace_invite"
        authenticated={false}
        hasPending
      />,
    );

    expect(screen.getByRole("link", {
      name: "Войти и продолжить",
    })).toHaveAttribute("href", "/login?returnTo=/auth/invite");
    expect(screen.queryByRole("button", {
      name: "Принять приглашение",
    })).not.toBeInTheDocument();
  });

  test("requires an explicit click and renders a server-approved destination", async () => {
    jest.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        destination: "/settings/security?email=changed",
      }),
    } as Response);
    render(
      <PendingAuthActionView
        kind="email_change"
        authenticated
        hasPending
      />,
    );

    fireEvent.click(screen.getByRole("button", {
      name: "Подтвердить смену email",
    }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/email-change/confirm",
      expect.objectContaining({ method: "POST" }),
    );
    expect(await screen.findByRole("link", {
      name: "Продолжить",
    })).toHaveAttribute("href", "/settings/security?email=changed");
  });
});
