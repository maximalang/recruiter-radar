import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260825120000_add_verified_trial_profile_guard.sql",
);
const rollbackPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260825120000_add_verified_trial_profile_guard.down.sql",
);

describe("verified trial profile guard migration", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const compact = migration.replace(/\s+/g, " ");
  const rollback = readFileSync(rollbackPath, "utf8");

  test("stores only hashed anti-abuse bindings and fixes the trial window at three days", () => {
    expect(migration).toContain("CREATE TABLE trial_claims");
    expect(migration).toContain("email_binding_hash CHAR(64)");
    expect(migration).toContain("telegram_binding_hash CHAR(64)");
    expect(migration).toContain("binding_hash CHAR(64)");
    expect(migration).toContain("expires_at = activated_at + INTERVAL '3 days'");
    expect(migration).not.toMatch(/email TEXT|telegram_chat_id TEXT|raw_.*binding/i);
    expect(compact).toContain("ADD COLUMN IF NOT EXISTS telegram_verified_at TIMESTAMPTZ");
  });

  test("serializes every profile mutation and fails closed during an active claim", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION rr_trial_profile_owner_lock");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION rr_trial_profile_immutability_guard");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OR DELETE ON client_profiles");
    expect(migration).toContain("client_profiles_trial_immutable_guard");
    expect(migration).toContain("USING ERRCODE = '42501'");
    expect(migration).toContain("trial_claims_binding_hash_uidx");
    expect(migration).toContain("trial_claims_email_binding_hash_uidx");
    expect(migration).toContain("trial_claims_telegram_binding_hash_uidx");
    expect(migration).toContain("trial_claims_user_uidx");
  });

  test("rollback removes the trigger, functions, claim table, and verification marker", () => {
    expect(rollback).toContain("DROP TRIGGER IF EXISTS client_profiles_trial_immutable_guard");
    expect(rollback).toContain("DROP FUNCTION IF EXISTS rr_trial_profile_immutability_guard");
    expect(rollback).toContain("verified trial rollback refused while claim audit rows exist");
    expect(rollback).toContain("DROP TABLE IF EXISTS trial_claims");
    expect(rollback).toContain("DROP COLUMN IF EXISTS telegram_verified_at");
  });
});
