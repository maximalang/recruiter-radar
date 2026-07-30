import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "..", "..");
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
) as { scripts: Record<string, string> };
const script = (name: string) => readFileSync(
  resolve(root, "packages", "db", "scripts", name),
  "utf8",
);

describe("Auth v2 rollout operations", () => {
  test("exposes the complete production-safe command surface", () => {
    expect(packageJson.scripts).toEqual(expect.objectContaining({
      "auth-v2:preflight":
        "node packages/db/scripts/preflight-auth-v2.mjs",
      "auth-v2:verify-db":
        "node packages/db/scripts/verify-auth-v2-db.mjs",
      "auth-v2:backfill":
        "node packages/db/scripts/backfill-auth-v2-workspaces.mjs",
      "auth-v2:verify-backfill":
        "node packages/db/scripts/verify-auth-v2-workspace-backfill.mjs",
      "auth-v2:session-report":
        "node packages/db/scripts/report-auth-v2-sessions.mjs",
      "auth-v2:canary":
        "node packages/db/scripts/check-auth-v2-canary.mjs",
      "test:auth-v2:tenancy:db":
        "node packages/db/scripts/run-auth-v2-tenancy-db-tests.mjs",
      "test:auth-v2:core:db":
        "node packages/db/scripts/run-auth-v2-core-db-tests.mjs",
    }));
  });

  test("keeps preflight, verification, reporting, and canary commands read-only and aggregate", () => {
    for (const file of [
      "preflight-auth-v2.mjs",
      "verify-auth-v2-db.mjs",
      "report-auth-v2-sessions.mjs",
      "check-auth-v2-canary.mjs",
    ]) {
      const source = script(file);
      expect(source).toContain("BEGIN TRANSACTION READ ONLY");
      expect(source).not.toMatch(/console\.(?:log|error)\([^)]*(?:email|token|ip)/i);
    }
    expect(script("check-auth-v2-canary.mjs")).toContain("--user-id=");
    expect(script("report-auth-v2-sessions.mjs")).toContain("alerts");
    expect(script("report-auth-v2-sessions.mjs")).toContain(
      "process.exitCode = 1",
    );
  });

  test("runs tenancy verifiers only against correctly named disposable databases", () => {
    const source = script("run-auth-v2-tenancy-db-tests.mjs");
    expect(source).toContain("AUTH_V2_DISPOSABLE_DB_CONFIRMED");
    expect(source).toContain("AUTH_V2_DB_TEST_ISOLATED");
    expect(source).toContain("auth_v2_test_workspace_tenancy_");
    expect(source).toContain("auth_v2_test_workspace_sessions_");
    expect(source).toContain("verify-auth-v2-workspace-tenancy.mjs");
    expect(source).toContain("verify-auth-v2-workspace-sessions.mjs");
  });

  test("adds the seven required auth-specific CI matrix gates", () => {
    const workflow = readFileSync(
      resolve(root, ".github", "workflows", "test.yml"),
      "utf8",
    );
    for (const gate of [
      "unit",
      "postgresql",
      "migration-upgrade",
      "tenancy-isolation",
      "e2e",
      "accessibility",
      "security-smoke",
    ]) {
      expect(workflow).toContain(`gate: ${gate}`);
    }
    expect(workflow).toContain("AUTH_V2_DISPOSABLE_DB_CONFIRMED: 'true'");
    expect(workflow).toContain("npm run test:auth-v2:core:db");
    expect(workflow).toContain("npm run test:auth-v2:tenancy:db");
    expect(workflow).not.toContain("npm run test:auth-v2:workspaces:db\n");
    expect(workflow).not.toContain(
      "npm run test:auth-v2:workspace-sessions:db\n",
    );
  });

  test("runs every core database verifier in an isolated disposable database", () => {
    const source = script("run-auth-v2-core-db-tests.mjs");
    expect(source).toContain("AUTH_V2_DISPOSABLE_DB_CONFIRMED");
    expect(source).toContain("AUTH_V2_DB_TEST_ISOLATED");
    expect(source).toContain("DROP DATABASE IF EXISTS");
    for (const verifier of [
      "verify-auth-v2-foundation.mjs",
      "verify-auth-v2-challenges.mjs",
      "verify-auth-v2-consumption.mjs",
      "verify-auth-v2-sessions.mjs",
      "verify-auth-v2-legacy-exchange.mjs",
      "verify-auth-v2-rollback.mjs",
      "verify-auth-v2-identity.mjs",
    ]) {
      expect(source).toContain(verifier);
    }
    for (const verificationCase of [
      "AUTH_V2_DB_CASE: 'clean'",
      "AUTH_V2_DB_CASE: 'upgrade'",
      "AUTH_V2_DB_CASE: 'down'",
      "AUTH_V2_ROLLBACK_CASE: 'clean'",
      "AUTH_V2_ROLLBACK_CASE: 'guard'",
    ]) {
      expect(source).toContain(verificationCase);
    }
  });

  test("documents fail-closed rollout, rollback, and deliverability ownership", () => {
    const runbook = readFileSync(
      resolve(root, "docs", "auth-v2-rollout-runbook.md"),
      "utf8",
    );
    expect(runbook).toContain("AUTH_PLATFORM_V2_ENABLED=false");
    expect(runbook).toContain("AUTH_V2_CANARY_USER_IDS");
    expect(runbook).toContain("AUTH_TRUSTED_PROXY_HEADER=x-real-ip");
    expect(runbook).toContain("trustedClientAddressNotReady: 0");
    expect(runbook).toContain("configure-caddy-real-ip.sh");
    expect(runbook).toContain("rollback");
    expect(runbook).toContain("deliverability");
    expect(runbook).toContain("do not create");

    const preflight = script("preflight-auth-v2.mjs");
    expect(preflight).toContain("trustedClientAddressNotReady");
    expect(preflight).toContain("AUTH_TRUSTED_PROXY_HEADER");
    expect(preflight).toContain("AUTH_TRUSTED_PROXY_HOPS");
  });
});
