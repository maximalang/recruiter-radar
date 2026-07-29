import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260729130000_add_auth_account_security_and_team.sql",
);
const rollbackPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260729130000_add_auth_account_security_and_team.down.sql",
);

describe("auth v2 account security and team migration", () => {
  test("adds only privacy-safe session presentation fields", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("ADD COLUMN browser_label TEXT");
    expect(sql).toContain("ADD COLUMN environment_label TEXT");
    expect(sql).not.toMatch(/ADD COLUMN (?:raw_)?ip(?:_address)?\b/i);
    expect(sql).not.toMatch(/ADD COLUMN user_agent\b/i);
  });

  test("records deletion lifecycle without inventing a retention duration", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("CREATE TABLE account_deletion_requests");
    expect(sql).toContain("purge_after TIMESTAMPTZ");
    expect(sql).toContain("retention_policy_key TEXT");
    expect(sql).not.toMatch(/INTERVAL '\d+ days'/i);
  });

  test("extends invite delivery and append-only team audit contracts", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("ADD COLUMN send_status TEXT");
    expect(sql).toContain("'membership_role_changed'");
    expect(sql).toContain("'membership_removed'");
    expect(sql).toContain("'ownership_transferred'");
    expect(sql).toContain("ADD COLUMN target_user_id BIGINT");
  });

  test("provides a rollback for every additive schema object", () => {
    const sql = readFileSync(rollbackPath, "utf8");

    expect(sql).toContain(
      "while account deletion requests exist",
    );
    expect(sql).toContain("target_user_id IS NOT NULL");
    expect(sql).toContain("DROP TABLE account_deletion_requests");
    expect(sql).toContain("DROP COLUMN IF EXISTS browser_label");
    expect(sql).toContain("DROP COLUMN IF EXISTS environment_label");
    expect(sql).toContain("DROP COLUMN IF EXISTS send_status");
    expect(sql).toContain("DROP COLUMN IF EXISTS target_user_id");
  });
});
