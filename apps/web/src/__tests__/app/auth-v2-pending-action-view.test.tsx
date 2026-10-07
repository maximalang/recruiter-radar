/** @jest-environment jsdom */

import { StrictMode } from "react";

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

  test("survives StrictMode effect replay after clearing the fragment", async () => {
    window.history.replaceState(
      {},
      "",
      `/auth/change-email#${"b".repeat(64)}`,
    );
    let resolvePrepare: ((response: Response) => void) | undefined;
    const prepare = new Promise<Response>((resolve) => {
      resolvePrepare = resolve;
    });
    jest.mocked(global.fetch).mockReturnValue(prepare);

    render(
      <StrictMode>
        <PendingAuthActionView
          kind="email_change"
          authenticated
          hasPending={false}
        />
      </StrictMode>,
    );

    await act(async () => {
      resolvePrepare?.({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response);
      await prepare;
    });

    expect(window.location.hash).toBe("");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", {
      name: "Подтвердить смену email",
    })).toBeInTheDocument();
    expect(screen.queryByText(/Ссылка недействительна/)).not.toBeInTheDocument();
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

  // next 16.3 router re-renders replay mount effects after cleanup
  // (vercel/next.js issue 62561). Fragment consumption must stay idempotent:
  // a replay observes an already-cleared hash and must not downgrade a
  // successful prepare to a fail-closed error.
  test("keeps a valid email-change fragment ready across effect cleanup/replay", async () => {
    window.history.replaceState(
      {},
      "",
      `/auth/change-email#${"b".repeat(64)}`,
    );
    jest.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as Response);

    render(
      <StrictMode>
        <PendingAuthActionView
          kind="email_change"
          authenticated
          hasPending={false}
        />
      </StrictMode>,
    );

    await act(async () => undefined);

    expect(window.location.hash).toBe("");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/email-change/prepare",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: "b".repeat(64) }),
      }),
    );
    expect(screen.queryByText(/Ссылка недействительна/)).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Подтвердить смену email" }),
    ).toBeEnabled();
  });

  test("keeps a valid workspace-invite fragment ready across effect cleanup/replay", async () => {
    window.history.replaceState(
      {},
      "",
      `/auth/invite#${"c".repeat(64)}`,
    );
    jest.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as Response);

    render(
      <StrictMode>
        <PendingAuthActionView
          kind="workspace_invite"
          authenticated
          hasPending={false}
        />
      </StrictMode>,
    );

    await act(async () => undefined);

    expect(window.location.hash).toBe("");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/invite/prepare",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: "c".repeat(64) }),
      }),
    );
    expect(screen.queryByText(/Ссылка недействительна/)).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Принять приглашение" }),
    ).toBeEnabled();
  });

  test("replay still fails closed when the server rejects the token", async () => {
    window.history.replaceState(
      {},
      "",
      `/auth/change-email#${"d".repeat(64)}`,
    );
    jest.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, code: "invalid" }),
    } as Response);

    render(
      <StrictMode>
        <PendingAuthActionView
          kind="email_change"
          authenticated
          hasPending={false}
        />
      </StrictMode>,
    );

    await act(async () => undefined);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Ссылка недействительна/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Подтвердить смену email" }),
    ).not.toBeInTheDocument();
  });

  test("remount without a fragment fails closed and never reuses a consumed token", async () => {
    window.history.replaceState(
      {},
      "",
      `/auth/change-email#${"e".repeat(64)}`,
    );
    jest.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as Response);

    const first = render(
      <PendingAuthActionView
        kind="email_change"
        authenticated
        hasPending={false}
      />,
    );

    await act(async () => undefined);

    expect(
      await screen.findByRole("button", { name: "Подтвердить смену email" }),
    ).toBeEnabled();

    first.unmount();

    // Client-side navigation back to the same route without the fragment:
    // the consumed token must not survive in any long-lived state.
    window.history.replaceState({}, "", "/auth/change-email");

    render(
      <PendingAuthActionView
        kind="email_change"
        authenticated
        hasPending={false}
      />,
    );

    await act(async () => undefined);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Ссылка недействительна/)).toBeInTheDocument();
  });
});
