import { isPasskeyCeremonyCancellation } from "@/lib/auth-v2/passkey-client";

function namedError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

describe("auth v2 passkey browser errors", () => {
  test.each(["AbortError", "NotAllowedError"])(
    "treats %s as an expected user cancellation",
    (name) => {
      expect(isPasskeyCeremonyCancellation(namedError(name))).toBe(true);
    },
  );

  test("does not hide real failures as cancellations", () => {
    expect(isPasskeyCeremonyCancellation(new Error("network failed"))).toBe(
      false,
    );
    expect(isPasskeyCeremonyCancellation("AbortError")).toBe(false);
    expect(isPasskeyCeremonyCancellation(null)).toBe(false);
  });
});
