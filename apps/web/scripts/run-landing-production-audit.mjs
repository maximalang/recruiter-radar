import { spawn } from "node:child_process";
import process from "node:process";

import { resolveAuditScriptPath } from "./landing-audit-path.mjs";

const auditScript = resolveAuditScriptPath(import.meta.url);
const reviewCaptureScript = new URL("./capture-landing-review.mjs", import.meta.url).pathname;
const maxAttempts = 2;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });

    let output = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolve({
        code: code ?? 1,
        signal,
        output,
      });
    });
  });
}

const reviewCapture = await runScript(reviewCaptureScript);
if (reviewCapture.code !== 0) {
  if (reviewCapture.signal) {
    process.stderr.write(`Landing review capture stopped by ${reviewCapture.signal}.\n`);
  }
  process.exit(reviewCapture.code);
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const result = await runScript(auditScript);
  if (result.code === 0) process.exit(0);

  const abortedNavigation = result.output.includes("net::ERR_ABORTED");
  const canRetry = abortedNavigation && attempt < maxAttempts;
  if (!canRetry) {
    if (result.signal) {
      process.stderr.write(`Landing production audit stopped by ${result.signal}.\n`);
    }
    process.exit(result.code);
  }

  process.stderr.write(
    `Landing production audit navigation was aborted; retrying the complete audit (${attempt + 1}/${maxAttempts}).\n`,
  );
  await wait(500);
}

process.exit(1);
