import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const cleanupScript = readFileSync(
  resolve(
    process.cwd(),
    "..",
    "..",
    "packages",
    "db",
    "scripts",
    "cleanup-auth-v2-challenges.mjs",
  ),
  "utf8",
);

describe("auth v2 challenge retention cleanup", () => {
  test("is dry-run by default and requires an explicit apply switch", () => {
    expect(cleanupScript).toContain("process.argv.includes('--apply')");
    expect(cleanupScript).toContain("? 'apply' : 'dry-run'");
    expect(cleanupScript).toContain("deleted: 0");
  });

  test("deletes only terminal retained rows in bounded locked batches", () => {
    expect(cleanupScript).toContain("AUTH_CHALLENGE_RETENTION_DAYS");
    expect(cleanupScript).toContain("FOR UPDATE SKIP LOCKED");
    expect(cleanupScript).toContain("AUTH_CHALLENGE_CLEANUP_MAX_BATCHES");
    expect(cleanupScript).toContain("COALESCE(consumed_at, invalidated_at, expires_at)");
    expect(cleanupScript).not.toMatch(/SELECT\s+email_normalized/i);
  });

  test("serializes scheduler runs and reports the full aggregate cleanup result", () => {
    expect(cleanupScript).toContain("pg_try_advisory_lock");
    expect(cleanupScript).toContain("pg_advisory_unlock");
    expect(cleanupScript).toContain("scanned");
    expect(cleanupScript).toContain("eligible");
    expect(cleanupScript).toContain("remaining");
    expect(cleanupScript).toContain("durationMs");
    expect(cleanupScript).toContain("lock_unavailable");
  });
});
