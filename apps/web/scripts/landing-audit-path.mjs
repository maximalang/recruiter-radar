import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveAuditScriptPath(importMetaUrl) {
  return join(dirname(fileURLToPath(importMetaUrl)), "verify-landing-production.mjs");
}
