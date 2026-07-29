import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryPath = resolve(process.cwd(), "..", "..");
const migrationPath = resolve(
  repositoryPath,
  "packages",
  "db",
  "migrations",
  "20260729122000_add_auth_workspace_session_switch.sql",
);
const rollbackPath = resolve(
  repositoryPath,
  "packages",
  "db",
  "migrations",
  "20260729122000_add_auth_workspace_session_switch.down.sql",
);
const verifierPath = resolve(
  repositoryPath,
  "packages",
  "db",
  "scripts",
  "verify-auth-v2-workspace-sessions.mjs",
);

describe("auth v2 workspace session migration", () => {
  test("changes workspace only for active memberships and the current token", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("change_auth_session_workspace");
    expect(migration).toContain("session.token_hash = input_current_token_hash");
    expect(migration).not.toContain("session.previous_token_hash = input_current_token_hash");
    expect(migration).toContain("membership.status = 'active'");
    expect(migration).toContain("workspace.status = 'active'");
    expect(migration).toContain("previous_token_hash = NULL");
    expect(migration).toContain("'workspace_switched'");
  });

  test("ships a reverse path and a concurrency/isolation verifier", () => {
    const rollback = readFileSync(rollbackPath, "utf8");
    const verifier = readFileSync(verifierPath, "utf8");

    expect(rollback).toContain("DROP FUNCTION change_auth_session_workspace");
    expect(verifier).toContain("workspace_switch_single_winner");
    expect(verifier).toContain("workspace_switch_rotates_token");
    expect(verifier).toContain("inactive_membership_revokes_session");
    expect(verifier).toContain("foreign_workspace_rejected");
    expect(verifier).toContain("Promise.all");
  });
});
