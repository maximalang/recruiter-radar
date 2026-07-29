const get = jest.fn();
const set = jest.fn();

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => ({ get, set })),
}));

import {
  clearPendingAuthActionToken,
  hasPendingAuthActionToken,
  readPendingAuthActionToken,
  writePendingAuthActionToken,
} from "@/lib/auth-v2/pending-action-cookie";

describe("auth v2 pending action cookies", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("stores only a valid opaque token in a hardened host cookie", async () => {
    await writePendingAuthActionToken("workspace_invite", "a".repeat(64));

    expect(set).toHaveBeenCalledWith(
      "__Host-rr_workspace_invite",
      "a".repeat(64),
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 24 * 60 * 60,
      }),
    );
  });

  test("rejects malformed tokens before writing a cookie", async () => {
    await expect(
      writePendingAuthActionToken("email_change", "not-a-token"),
    ).rejects.toThrow("opaque token");
    expect(set).not.toHaveBeenCalled();
  });

  test("reads only canonical token values and reports pending state", async () => {
    get.mockReturnValue({ value: "b".repeat(64) });

    await expect(readPendingAuthActionToken("email_change")).resolves.toBe(
      "b".repeat(64),
    );
    await expect(hasPendingAuthActionToken("email_change")).resolves.toBe(true);

    get.mockReturnValue({ value: "B".repeat(64) });
    await expect(readPendingAuthActionToken("email_change")).resolves.toBeNull();
  });

  test("clears the selected cookie without touching another action", async () => {
    await clearPendingAuthActionToken("email_change");

    expect(set).toHaveBeenCalledWith(
      "__Host-rr_email_change",
      "",
      expect.objectContaining({ maxAge: 0 }),
    );
    expect(set).not.toHaveBeenCalledWith(
      "__Host-rr_workspace_invite",
      expect.anything(),
      expect.anything(),
    );
  });
});
