import { spawn } from "node:child_process";
import { readdir, rename } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { resolveAuditScriptPath } from "./landing-audit-path.mjs";

const auditScript = resolveAuditScriptPath(import.meta.url);
const reviewCaptureScript = new URL("./capture-landing-review.mjs", import.meta.url).pathname;
const accessibilityAuditScript = new URL("./verify-landing-accessibility.mjs", import.meta.url).pathname;
const keyboardAuditScript = new URL("./verify-landing-keyboard.mjs", import.meta.url).pathname;
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

function readScreenshotDirectory(output) {
  const match = output.match(/"screenshotDirectory":\s*("(?:\\.|[^"\\])*")/);
  if (match) return JSON.parse(match[1]);
  return process.env.LANDING_SCREENSHOT_DIR ?? null;
}

async function labelProductionScreenshotStates(output) {
  const screenshotDirectory = readScreenshotDirectory(output);
  if (!screenshotDirectory) {
    throw new Error("Landing production audit did not report its screenshot directory");
  }

  const files = await readdir(screenshotDirectory);
  const desktopDefault = files.find((fileName) => /^desktop-1440x900-full-\d+px\.png$/.test(fileName));
  const mobileExpanded = files.find((fileName) => /^mobile-390x844-full-\d+px\.png$/.test(fileName));
  if (!desktopDefault || !mobileExpanded) {
    throw new Error(`Landing production screenshot state labeling failed: ${JSON.stringify(files)}`);
  }

  await rename(
    path.join(screenshotDirectory, desktopDefault),
    path.join(screenshotDirectory, desktopDefault.replace("-full-", "-full-default-")),
  );
  await rename(
    path.join(screenshotDirectory, mobileExpanded),
    path.join(screenshotDirectory, mobileExpanded.replace("-full-", "-full-expanded-")),
  );
}

const reviewCapture = await runScript(reviewCaptureScript);
if (reviewCapture.code !== 0) {
  if (reviewCapture.signal) {
    process.stderr.write(`Landing review capture stopped by ${reviewCapture.signal}.\n`);
  }
  process.exit(reviewCapture.code);
}

let productionAuditPassed = false;
let productionAuditOutput = "";
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const result = await runScript(auditScript);
  productionAuditOutput = result.output;
  if (result.code === 0) {
    productionAuditPassed = true;
    break;
  }

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

if (!productionAuditPassed) process.exit(1);
await labelProductionScreenshotStates(productionAuditOutput);

const accessibilityAudit = await runScript(accessibilityAuditScript);
if (accessibilityAudit.code !== 0) {
  if (accessibilityAudit.signal) {
    process.stderr.write(`Landing accessibility audit stopped by ${accessibilityAudit.signal}.\n`);
  }
  process.exit(accessibilityAudit.code);
}

const keyboardAudit = await runScript(keyboardAuditScript);
if (keyboardAudit.code !== 0) {
  if (keyboardAudit.signal) {
    process.stderr.write(`Landing keyboard audit stopped by ${keyboardAudit.signal}.\n`);
  }
  process.exit(keyboardAudit.code);
}

process.exit(0);
