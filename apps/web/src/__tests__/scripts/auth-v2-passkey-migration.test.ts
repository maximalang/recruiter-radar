import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260729132000_add_auth_passkeys.sql",
);
const rollbackPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260729132000_add_auth_passkeys.down.sql",
);

describe("auth v2 passkey migration", () => {
  test("stores only public credential material with bounded metadata", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("CREATE TABLE user_passkeys");
    expect(sql).toContain("credential_id TEXT NOT NULL UNIQUE");
    expect(sql).toContain("public_key BYTEA NOT NULL");
    expect(sql).toContain("counter BIGINT NOT NULL DEFAULT 0");
    expect(sql).toContain("backup_eligible BOOLEAN NOT NULL");
    expect(sql).toContain("backed_up BOOLEAN NOT NULL");
    expect(sql).toContain("device_type IN ('singleDevice', 'multiDevice')");
    expect(sql).toContain(
      "transports <@ ARRAY['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']::TEXT[]",
    );
    expect(sql).not.toMatch(/\bprivate_key\b/i);
  });

  test("allows identity-free challenges only for passkey authentication", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("ALTER COLUMN email_normalized DROP NOT NULL");
    expect(sql).toContain("OR purpose = 'passkey_authentication'");
    expect(sql).toContain("WHERE email_normalized IS NOT NULL");
  });

  test("refuses destructive rollback while credentials still exist", () => {
    const sql = readFileSync(rollbackPath, "utf8");

    expect(sql).toContain(
      "LOCK TABLE user_passkeys IN ACCESS EXCLUSIVE MODE",
    );
    expect(sql).toContain("IF EXISTS (SELECT 1 FROM user_passkeys LIMIT 1)");
    expect(sql).toContain("refusing to drop non-empty user_passkeys");
    expect(sql).toContain("ALTER COLUMN email_normalized SET NOT NULL");
    expect(sql).toContain("DROP TABLE user_passkeys");
  });
});
