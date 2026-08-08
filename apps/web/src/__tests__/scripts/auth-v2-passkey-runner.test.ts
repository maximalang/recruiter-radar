import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const runnerPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "scripts",
  "run-auth-v2-passkey-e2e.mjs",
);
const databaseRunnerPath = resolve(
  process.cwd(),
  "..",
  "..",
  "packages",
  "db",
  "scripts",
  "run-auth-v2-passkey-db-tests.mjs",
);
const nextConfigPath = resolve(process.cwd(), "next.config.ts");

describe("auth v2 passkey E2E isolation", () => {
  test("uses the process-scoped dist and tsconfig names accepted by Next config", () => {
    const runner = readFileSync(runnerPath, "utf8");
    const nextConfig = readFileSync(nextConfigPath, "utf8");

    expect(runner).toContain(
      "`.next-auth-v2-e2e-${process.pid}`",
    );
    expect(runner).toContain(
      "`.auth-v2-e2e-tsconfig-${process.pid}.json`",
    );
    expect(nextConfig).toContain(
      "/^\\.next-auth-v2-e2e-[1-9]\\d*$/.test(requestedE2eDistDir)",
    );
    expect(nextConfig).toContain(
      "/^\\.auth-v2-e2e-tsconfig-[1-9]\\d*\\.json$/.test(requestedE2eTsconfig)",
    );
    expect(runner).toContain("await restoreNextEnv()");
    expect(runner).toContain("await rm(e2eDistDirectory");
    expect(runner).toContain("await rm(e2eTsconfigPath");
  });

  test("requires explicit confirmation before using an administrative database", () => {
    for (const runnerPathToCheck of [runnerPath, databaseRunnerPath]) {
      const runner = readFileSync(runnerPathToCheck, "utf8");
      expect(runner).toContain(
        "process.env.AUTH_V2_DISPOSABLE_DB_CONFIRMED !== 'true'",
      );
      expect(runner).toContain(
        "AUTH_V2_DISPOSABLE_DB_CONFIRMED=true is required",
      );
    }
  });

  test("waits for client session hydration before starting WebAuthn registration", () => {
    const runner = readFileSync(runnerPath, "utf8");

    expect(runner).toContain("const clientSessionReady = page.waitForResponse");
    expect(runner).toContain("/api/auth/session/refresh");
    expect(runner).toContain("await clientSessionReady");
  });
});
