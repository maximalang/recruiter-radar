import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260730101000_add_legacy_session_revocation.sql",
);
const rollbackPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260730101000_add_legacy_session_revocation.down.sql",
);

describe("legacy session logout revocation migration", () => {
  const migration = readFileSync(migrationPath, "utf8").replace(/\s+/g, " ");
  const rollback = readFileSync(rollbackPath, "utf8").replace(/\s+/g, " ");

  test("adds a purpose-specific append-only fingerprint ledger", () => {
    expect(migration).toContain("'legacy_session_revoked'");
    expect(migration).toContain(
      "auth_security_events_legacy_revocation_uidx",
    );
    expect(migration).toContain(
      "event_type NOT IN ( 'legacy_session_migrated', 'legacy_session_revoked' )",
    );
  });

  test("refuses rollback after a legacy logout was recorded", () => {
    expect(rollback).toContain("WHERE event_type = 'legacy_session_revoked'");
    expect(rollback).toContain(
      "legacy session revocation rollback refused",
    );
  });
});
