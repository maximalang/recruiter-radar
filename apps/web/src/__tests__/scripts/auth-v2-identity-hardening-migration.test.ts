import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260730100000_harden_auth_email_identity.sql",
);
const rollbackPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260730100000_harden_auth_email_identity.down.sql",
);
const preflightPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "scripts",
  "preflight-auth-v2.mjs",
);
const verifierPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "scripts",
  "verify-auth-v2-identity.mjs",
);

describe("auth v2 identity hardening migration", () => {
  const migration = readFileSync(migrationPath, "utf8").replace(/\s+/g, " ");
  const rollback = readFileSync(rollbackPath, "utf8").replace(/\s+/g, " ");
  const preflight = readFileSync(preflightPath, "utf8").replace(/\s+/g, " ");
  const verifier = readFileSync(verifierPath, "utf8").replace(/\s+/g, " ");

  test("replaces folded local-part identity with an exact canonical index", () => {
    expect(migration).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS users_auth_v2_identity_active_uidx",
    );
    expect(migration).toContain("DROP INDEX IF EXISTS users_email_uidx");
    expect(migration).toContain(
      "split_part(COALESCE(email_normalized, email), '@', 1)",
    );
    expect(migration).toContain(
      "users_auth_v2_identity_consistency_check",
    );
  });

  test("hardens already-installed issuance and consumption functions", () => {
    expect(migration).toContain("pg_get_functiondef");
    expect(migration).toContain("insecure_match_count = 1");
    expect(migration).toContain("insecure_match_count = 2");
    expect(migration).toContain("EXECUTE hardened_definition");
    expect(migration).toContain(
      "split_part(locked_challenge.email_normalized, '@', 1)",
    );
  });

  test("refuses an unsafe reverse migration with live identity data", () => {
    expect(rollback).toContain(
      "auth email identity hardening rollback refused",
    );
    expect(rollback).toContain("case-distinct mailboxes exist");
    expect(rollback).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS users_email_uidx",
    );
  });

  test("blocks global enablement while verified legacy identities remain", () => {
    expect(preflight).toContain(
      "'activeAccountsWithoutNormalizedIdentity'",
    );
    expect(preflight).toContain("WHEN $2::BOOLEAN THEN COUNT(*)::INTEGER");
    expect(preflight).toContain(
      "process.env.AUTH_PLATFORM_V2_ENABLED === 'true'",
    );
    expect(preflight).toContain("'legacyFoldedIdentityIndexPresent'");
    expect(preflight).toContain("'canonicalIdentityIndexMissing'");
  });

  test("ships a real case-distinct PostgreSQL regression", () => {
    expect(verifier).toContain("case_distinct_signup");
    expect(verifier).toContain("exact_legacy_login");
    expect(verifier).toContain("stored_delivery_mailbox");
    expect(verifier).toContain("global_preflight_legacy_identity_gate");
    expect(verifier).toContain("clean_down_upgrade_chain");
    expect(verifier).toContain("installed_function_rewrite");
    expect(verifier).toContain("legacy_lower_index_removed");
    expect(verifier).toContain("live_rollback_refused");
  });
});
