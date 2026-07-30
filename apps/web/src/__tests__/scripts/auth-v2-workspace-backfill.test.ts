import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryPath = resolve(process.cwd(), "..", "..");
const migrationPath = resolve(
  repositoryPath,
  "packages",
  "db",
  "migrations",
  "20260729121000_add_auth_workspace_tenant_context.sql",
);
const indexMigrationPath = resolve(
  repositoryPath,
  "packages",
  "db",
  "migrations",
  "20260729121100_add_auth_workspace_tenant_indexes.sql",
);
const guardMigrationPath = resolve(
  repositoryPath,
  "packages",
  "db",
  "migrations",
  "20260729121200_add_auth_workspace_tenant_guards.sql",
);
const migratorPath = resolve(
  repositoryPath,
  "packages",
  "db",
  "scripts",
  "migrate.mjs",
);
const rollbackPath = resolve(
  repositoryPath,
  "packages",
  "db",
  "migrations",
  "20260729121000_add_auth_workspace_tenant_context.down.sql",
);
const preflightPath = resolve(
  repositoryPath,
  "packages",
  "db",
  "scripts",
  "preflight-auth-v2-workspaces.mjs",
);
const backfillPath = resolve(
  repositoryPath,
  "packages",
  "db",
  "scripts",
  "backfill-auth-v2-workspaces.mjs",
);
const verifyPath = resolve(
  repositoryPath,
  "packages",
  "db",
  "scripts",
  "verify-auth-v2-workspace-backfill.mjs",
);

describe("auth v2 workspace tenant-context migration", () => {
  test("builds tenant indexes concurrently through the bounded migrator path", () => {
    const indexMigration = readFileSync(indexMigrationPath, "utf8");
    const transactionalMigrations = [
      migrationPath,
      guardMigrationPath,
    ].map((path) => readFileSync(path, "utf8"));
    const migrator = readFileSync(migratorPath, "utf8");

    expect(indexMigration).toContain("-- migrate:concurrent-indexes");
    expect(indexMigration).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
    expect(indexMigration.match(/CREATE (?:UNIQUE )?INDEX CONCURRENTLY/g))
      .toHaveLength(17);
    expect(migrator).toContain("parseConcurrentIndexMigration");
    expect(migrator).toContain("DROP INDEX CONCURRENTLY");
    expect(migrator).toContain("SET lock_timeout");
    expect(migrator).toContain("SET statement_timeout");
    for (const migration of transactionalMigrations) {
      expect(migration).not.toMatch(/^\s*(?:BEGIN|COMMIT)\s*;/im);
      expect(migration).toContain("SET LOCAL lock_timeout");
      expect(migration).toContain("SET LOCAL statement_timeout");
    }
  });

  test("adds authoritative nullable workspace context without rewriting ledgers", () => {
    const migration = [
      migrationPath,
      indexMigrationPath,
      guardMigrationPath,
    ].map((path) => readFileSync(path, "utf8")).join("\n");

    for (const table of [
      "client_profiles",
      "subscriptions",
      "checkout_orders",
      "pilot_enrollments",
      "leads",
      "deliveries",
      "user_search_preferences",
      "notification_provider_accounts",
      "opportunities",
    ]) {
      expect(migration).toMatch(
        new RegExp(`ALTER TABLE ${table}[\\s\\S]{0,160}workspace_id BIGINT`),
      );
    }
    expect(migration).toContain("auth_workspace_resolve_user");
    expect(migration).toContain("auth_workspace_resolve_profile");
    expect(migration).toContain("auth_workspace_resolve_lead");
    expect(migration).toContain("DEFERRABLE INITIALLY IMMEDIATE");
    expect(migration).not.toMatch(
      /UPDATE\s+(opportunity_outcome_events|auth_security_events)/i,
    );
  });

  test("ships read-only preflight and explicit resumable apply tooling", () => {
    const preflight = readFileSync(preflightPath, "utf8");
    const backfill = readFileSync(backfillPath, "utf8");
    const verify = readFileSync(verifyPath, "utf8");

    expect(preflight).toContain("BEGIN TRANSACTION READ ONLY");
    expect(preflight).toContain("blockingViolations");
    expect(preflight).toContain("workspaceNulls");
    expect(preflight).not.toContain("SELECT email");

    expect(backfill).toContain("--apply");
    expect(backfill).toContain("dryRun");
    expect(backfill).toContain("batchSize");
    expect(backfill).toContain("backfill_auth_workspace_user");
    expect(backfill).toContain("FOR UPDATE OF app_user SKIP LOCKED");

    expect(verify).toContain("rowCountParity");
    expect(verify).toContain("workspaceParity");
    expect(verify).toContain("crossWorkspaceGuards");
    expect(verify).toContain("idempotentRerun");
    expect(verify).toContain("SELECT 'authSessions'");
    expect(verify).toContain("'authUserChallenges'");
    expect(verify).toContain("WHERE user_id IS NOT NULL");
  });

  test("keeps rollback guarded and legacy ownership authoritative during rollout", () => {
    const migration = [
      migrationPath,
      indexMigrationPath,
      guardMigrationPath,
    ].map((path) => readFileSync(path, "utf8")).join("\n");
    const rollback = readFileSync(rollbackPath, "utf8");

    expect(migration).toContain("workspace_id BIGINT");
    expect(migration).not.toMatch(/workspace_id BIGINT NOT NULL/i);
    expect(rollback).toContain("workspace tenant-context rollback refused");
    expect(rollback).toContain("DROP COLUMN workspace_id");
    expect(rollback).not.toMatch(/DROP COLUMN (owner_id|user_id)/i);
  });
});
