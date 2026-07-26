import { readFile } from "node:fs/promises";

const CRITICAL_APPLICATION_ERROR_PATTERNS = [
  /LANDING_ANALYTICS_RATE_LIMIT_SALT is required/,
  /\bUnhandled\b/i,
  /\buncaughtException\b/i,
  /\bunhandledRejection\b/i,
  /^\s*⨯\s+(?:Error\b|\[Error:)/,
  /\bTypeError:/,
  /\bReferenceError:/,
];

export function findProductionServerLogErrors(logContents) {
  return logContents
    .split(/\r?\n/)
    .filter((line) =>
      CRITICAL_APPLICATION_ERROR_PATTERNS.some((pattern) => pattern.test(line)),
    );
}

async function main() {
  const logPath = process.argv[2]?.trim();
  if (!logPath) {
    console.error(
      "Usage: node scripts/verify-production-server-log.mjs <server-log-path>",
    );
    process.exitCode = 1;
    return;
  }

  let logContents;
  try {
    logContents = await readFile(logPath, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Cannot read production server log: ${reason}`);
    process.exitCode = 1;
    return;
  }

  const criticalLines = findProductionServerLogErrors(logContents);
  if (criticalLines.length > 0) {
    console.error("Critical application errors found in production server log:");
    for (const line of criticalLines) {
      console.error(line);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Production server log is clean.");
}

await main();
