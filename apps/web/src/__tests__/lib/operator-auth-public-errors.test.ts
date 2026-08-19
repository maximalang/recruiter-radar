jest.mock("next/headers", () => ({
  cookies: jest.fn(),
  headers: jest.fn(),
}));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { operatorLockedReason } from "@/lib/operator-auth";

describe("operator auth public errors", () => {
  test("does not expose the operator password environment variable name", () => {
    expect(operatorLockedReason("missing-config")).toBe(
      "Панель оператора не настроена. Обратитесь к администратору.",
    );
    expect(operatorLockedReason("missing-config")).not.toContain(
      "ADMIN_OPERATOR_PASSWORD",
    );
  });

  test("keeps the login action configuration error neutral", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/admin/admin-actions.ts"),
      "utf8",
    );
    const missingConfigBranch = source.match(
      /if \(!expected\) \{([\s\S]*?)\n  \}/,
    )?.[1] ?? "";

    expect(missingConfigBranch).toContain(
      "Панель оператора не настроена. Обратитесь к администратору.",
    );
    expect(missingConfigBranch).not.toContain("ADMIN_OPERATOR_PASSWORD");
  });
});
