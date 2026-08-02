import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { resolveAuditScriptPath } from "./landing-audit-path.mjs";

test("resolves a Windows file URL without duplicating the drive prefix", () => {
  const scriptUrl = pathToFileURL("C:\\workspace\\apps\\web\\scripts\\run-landing-production-audit.mjs");

  assert.equal(
    resolveAuditScriptPath(scriptUrl.href),
    "C:\\workspace\\apps\\web\\scripts\\verify-landing-production.mjs",
  );
});
