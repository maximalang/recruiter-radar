import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "..", "..");

describe("auth v2 account and team operational contracts", () => {
  test("isolated database runner migrates a disposable database and runs real core integration tests", async () => {
    const runner = await readProjectFile(
      "packages/db/scripts/run-auth-v2-account-team-db-tests.mjs",
    );
    const integrationTest = await readProjectFile(
      "apps/web/src/__tests__/lib/auth-v2-account-team-db.test.ts",
    );
    const packageJson = JSON.parse(
      await readProjectFile("package.json"),
    ) as { scripts?: Record<string, string> };

    expect(runner).toContain("auth_v2_test_account_team_");
    expect(runner).toContain("CREATE DATABASE");
    expect(runner).toContain("DROP DATABASE IF EXISTS");
    expect(runner).toContain("WITH (FORCE)");
    expect(runner).toContain("migrate.mjs");
    expect(runner).toContain("AUTH_V2_ACCOUNT_TEAM_DB_TEST");
    expect(runner).toContain("AUTH_EMAIL_TRANSPORT");
    expect(runner).toContain("AUTH_EMAIL_TEST_OUTBOX_PATH");
    expect(runner).toContain("auth-v2-account-team-db.test.ts");
    expect(integrationTest).toContain("Promise.all");
    expect(integrationTest).toContain("email_mismatch");
    expect(integrationTest).toContain("ownership_transfer_required");
    expect(integrationTest).toContain("auth_security_events");
    expect(packageJson.scripts?.["test:auth-v2:account-team:db"]).toBe(
      "node packages/db/scripts/run-auth-v2-account-team-db-tests.mjs",
    );
  });

  test("account purge is due-only, bounded, dry-run by default, and preserves ledgers", async () => {
    const purge = await readProjectFile(
      "packages/db/scripts/purge-auth-v2-accounts.mjs",
    );
    const packageJson = JSON.parse(
      await readProjectFile("package.json"),
    ) as { scripts?: Record<string, string> };

    expect(purge).toContain("const apply = args.has('--apply')");
    expect(purge).toContain("status = 'pending'");
    expect(purge).toContain("purge_after <= NOW()");
    expect(purge).toContain("account.status = 'deletion_pending'");
    expect(purge).toContain("FOR UPDATE OF request SKIP LOCKED");
    expect(purge).toContain("deleted.invalid");
    expect(purge).toContain('email_normalized AS "emailNormalized"');
    expect(purge).toContain("LOWER(email_normalized) = LOWER($3)");
    expect(purge).toContain("DELETE FROM web_push_subscriptions");
    expect(purge).toContain("status = 'completed'");
    expect(purge).not.toMatch(/DELETE\s+FROM\s+(auth_security_events|billing_events|subscriptions)/i);
    expect(purge).not.toMatch(/INTERVAL\s+'[0-9]+\s+days?'/i);
    expect(packageJson.scripts?.["auth-v2:accounts:purge"]).toBe(
      "node packages/db/scripts/purge-auth-v2-accounts.mjs",
    );
  });

  test("browser gate uses a disposable database and deterministic outbox for responsive account/team flows", async () => {
    const runner = await readProjectFile(
      "packages/db/scripts/run-auth-v2-account-team-e2e.mjs",
    );
    const nextConfig = await readProjectFile("apps/web/next.config.ts");
    const packageJson = JSON.parse(
      await readProjectFile("package.json"),
    ) as { scripts?: Record<string, string> };

    expect(runner).toContain("auth_v2_e2e_account_team_");
    expect(runner).toContain("CREATE DATABASE");
    expect(runner).toContain("DROP DATABASE IF EXISTS");
    expect(runner).toContain("AUTH_EMAIL_TRANSPORT");
    expect(runner).toContain("AUTH_V2_E2E_DIST_DIR");
    expect(runner).toContain("AUTH_V2_E2E_TSCONFIG");
    expect(runner).toContain("--experimental-https");
    expect(runner).toContain("ignoreHTTPSErrors: true");
    expect(nextConfig).toContain("AUTH_V2_E2E_DIST_DIR");
    expect(nextConfig).toContain("AUTH_V2_E2E_TSCONFIG");
    expect(nextConfig).toContain(".next-auth-v2-e2e-");
    expect(nextConfig).toContain("devIndicators:");
    expect(runner).toContain("chromium.launch");
    expect(runner).toContain("width: 390");
    expect(runner).toContain("width: 1440");
    expect(runner).toContain("consoleFindings");
    expect(runner).toContain("document.documentElement.scrollWidth");
    expect(runner).toContain("ariaSnapshot");
    expect(runner).toContain("/settings/security");
    expect(runner).toContain("/settings/team");
    expect(runner).toContain("/auth/invite#");
    expect(runner).toContain("/auth/change-email#");
    expect(runner).toContain("email_mismatch");
    expect(packageJson.scripts?.["test:auth-v2:account-team:e2e"]).toBe(
      "node packages/db/scripts/run-auth-v2-account-team-e2e.mjs",
    );
  });
});

async function readProjectFile(pathname: string): Promise<string> {
  return readFile(resolve(root, pathname), "utf8");
}
