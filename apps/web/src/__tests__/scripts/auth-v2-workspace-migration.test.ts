import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260729120000_add_auth_workspaces.sql",
);
const rollbackPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "migrations",
  "20260729120000_add_auth_workspaces.down.sql",
);
const verifierPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "scripts",
  "verify-auth-v2-workspaces.mjs",
);

describe("auth v2 workspace foundation migration", () => {
  test("creates scoped workspace membership and invitation tables", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("CREATE TABLE workspaces");
    expect(migration).toContain("bootstrap_user_id");
    expect(migration).toContain("CREATE TABLE workspace_members");
    expect(migration).toContain("PRIMARY KEY (workspace_id, user_id)");
    expect(migration).toContain("CREATE TABLE workspace_invites");
    expect(migration).toContain("workspace_invites_role_check");
    expect(migration).not.toMatch(
      /workspace_invites_role_check[\s\S]{0,240}'owner'/,
    );
  });

  test("bootstraps one workspace atomically and guards session membership", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("ensure_auth_user_workspace");
    expect(migration).toContain("PG_ADVISORY_XACT_LOCK");
    expect(migration).toContain("auth_sessions_assign_workspace");
    expect(migration).toContain("auth_sessions_workspace_member_fkey");
    expect(migration).toContain("workspace_created");
    expect(migration).toContain("workspace_id, user_id");
  });

  test("ships a guarded reverse path and isolated concurrency verifier", () => {
    const rollback = readFileSync(rollbackPath, "utf8");
    const verifier = readFileSync(verifierPath, "utf8");

    expect(rollback).toContain("workspace rollback refused");
    expect(rollback).toContain("DROP TABLE workspace_invites");
    expect(rollback).toContain("DROP TABLE workspace_members");
    expect(rollback).toContain("DROP TABLE workspaces");
    expect(verifier).toContain("concurrent_workspace_bootstrap");
    expect(verifier).toContain("session_membership_guard");
    expect(verifier).toContain("challenge_consume_workspace");
    expect(verifier).toContain("workspace_reverse_guard");
  });
});
