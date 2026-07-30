import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260728120000_add_auth_platform_v2_foundation.sql",
);
const rollbackPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260728120000_add_auth_platform_v2_foundation.down.sql",
);
const verifierPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "scripts",
  "verify-auth-v2-foundation.mjs",
);

describe("auth v2 foundation migration contract", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const rollback = readFileSync(rollbackPath, "utf8");
  const verifier = readFileSync(verifierPath, "utf8");
  const compact = migration.replace(/\s+/g, " ");

  test("adds a nullable normalized identity without rewriting legacy users", () => {
    expect(compact).toContain("ADD COLUMN IF NOT EXISTS email_normalized TEXT");
    expect(compact).toContain("ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'");
    expect(compact).toContain(
      "CREATE UNIQUE INDEX users_email_normalized_active_uidx",
    );
    expect(compact).toContain(
      "split_part(email_normalized, '@', 2) = LOWER(split_part(email_normalized, '@', 2))",
    );
    expect(migration).not.toMatch(/UPDATE\s+users\s+SET\s+email_normalized/i);
  });

  test("creates purpose-bound challenges without requiring a user row", () => {
    const challengeTable = compact.slice(
      compact.indexOf("CREATE TABLE auth_challenges"),
      compact.indexOf("CREATE TABLE auth_sessions"),
    );

    expect(challengeTable).toContain("CREATE TABLE auth_challenges");
    expect(challengeTable).toContain("email_normalized TEXT NOT NULL");
    expect(challengeTable).toContain("user_id BIGINT REFERENCES users(id)");
    expect(challengeTable).not.toContain(
      "user_id BIGINT NOT NULL REFERENCES users(id)",
    );
    expect(challengeTable).toContain("invalidated_at TIMESTAMPTZ");
    expect(challengeTable).toContain(
      "CREATE UNIQUE INDEX auth_challenges_active_identity_uidx",
    );
    expect(challengeTable).toContain("token_hash ~ '^[a-f0-9]{64}$'");
    expect(challengeTable).toContain(
      "WHEN purpose IN ('login', 'signup') THEN INTERVAL '15 minutes'",
    );
    expect(challengeTable).toContain("consumed_at >= created_at");
    expect(challengeTable).toContain("consumed_at <= expires_at");
    expect(challengeTable).toContain("invalidated_at >= created_at");
  });

  test("creates opaque revocable sessions with idle and absolute deadlines", () => {
    expect(compact).toContain("CREATE TABLE auth_sessions");
    expect(compact).toContain("token_hash CHAR(64) NOT NULL UNIQUE");
    expect(compact).toContain("idle_expires_at TIMESTAMPTZ NOT NULL");
    expect(compact).toContain("absolute_expires_at TIMESTAMPTZ NOT NULL");
    expect(compact).toContain("rotated_at TIMESTAMPTZ NOT NULL");
    expect(compact).toContain("revoked_at TIMESTAMPTZ");
    expect(compact).toContain("legacy_fingerprint_hash CHAR(64)");
    expect(compact).toContain(
      "idle_expires_at <= last_seen_at + INTERVAL '14 days'",
    );
    expect(compact).toContain(
      "absolute_expires_at <= created_at + INTERVAL '30 days'",
    );
    expect(compact).toContain("revoked_at >= created_at");
  });

  test("adds append-only redacted security events and atomic rate buckets", () => {
    const auditTable = compact.slice(
      compact.indexOf("CREATE TABLE auth_security_events"),
      compact.indexOf("CREATE TABLE auth_rate_limit_buckets"),
    );

    expect(compact).toContain("CREATE TABLE auth_security_events");
    expect(compact).toContain(
      "BEFORE UPDATE OR DELETE ON auth_security_events",
    );
    expect(compact).toContain(
      "CREATE FUNCTION auth_security_metadata_is_safe",
    );
    expect(compact).toContain(
      "CHECK (auth_security_metadata_is_safe(metadata))",
    );
    expect(compact).toContain(
      "WHEN 'source' THEN",
    );
    expect(compact).toContain(
      "text_value NOT IN ( 'web', 'email', 'passkey', 'legacy', 'system', 'db_verifier' )",
    );
    expect(compact).toContain(
      "WHEN 'reason_code' THEN",
    );
    expect(compact).toContain(
      "text_value !~ '^[a-z][a-z0-9_]{0,63}$'",
    );
    expect(compact).toContain(
      "CREATE UNIQUE INDEX auth_security_events_legacy_exchange_uidx",
    );
    expect(compact).toContain(
      "CREATE UNIQUE INDEX auth_security_events_legacy_revocation_uidx",
    );
    expect(compact).toContain(
      "event_type NOT IN ( 'legacy_session_migrated', 'legacy_session_revoked' ) OR subject_hash IS NOT NULL",
    );
    expect(compact).toContain(
      "BEFORE TRUNCATE ON auth_security_events",
    );
    expect(auditTable).toContain("user_id BIGINT,");
    expect(auditTable).toContain("session_id BIGINT,");
    expect(auditTable).not.toContain("ON DELETE SET NULL");
    expect(compact).toContain("CREATE TABLE auth_rate_limit_buckets");
    expect(compact).toContain("CREATE FUNCTION consume_auth_rate_limit");
    expect(compact).toContain("ON CONFLICT (bucket_scope, key_hash, window_started_at)");
    expect(compact).toContain(
      "UNIQUE (bucket_scope, key_hash, window_started_at)",
    );
    expect(compact).toContain("metadata JSONB NOT NULL DEFAULT '{}'::JSONB");
    expect(compact).toContain("created_at <= updated_at");
  });

  test("is atomic under the serialized migrator and has a guarded rollback", () => {
    expect(migration).not.toContain("BEGIN;");
    expect(migration).not.toContain("COMMIT;");
    expect(migration).toContain("SET LOCAL lock_timeout = '5s'");
    expect(rollback).toContain("auth v2 rollback refused");
    expect(rollback.indexOf("DROP TABLE IF EXISTS auth_rate_limit_buckets")).toBeLessThan(
      rollback.indexOf("DROP TABLE IF EXISTS auth_sessions"),
    );
    expect(rollback.indexOf("DROP TABLE IF EXISTS auth_sessions")).toBeLessThan(
      rollback.indexOf("ALTER TABLE users"),
    );
  });

  test("ships clean, legacy-upgrade, and down database cases", () => {
    expect(verifier).toContain("'clean'");
    expect(verifier).toContain("'upgrade'");
    expect(verifier).toContain("'down'");
    expect(verifier).toContain("account_login_challenges");
    expect(verifier).toContain("email_normalized");
    expect(verifier).toContain("auth_security_events");
    expect(verifier).toContain("Sensitive audit metadata was accepted.");
    expect(verifier).toContain("Legacy exchange fingerprint was accepted twice.");
    expect(verifier).toContain("Null legacy exchange fingerprint was accepted.");
    expect(verifier).toContain("Security event truncation was not rejected.");
    expect(verifier).toContain("Rate limit bucket was not atomically enforced.");
    expect(verifier).not.toContain("../../../.env");
  });
});
