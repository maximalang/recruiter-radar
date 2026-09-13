#!/usr/bin/env node
/**
 * Recomputes SHA-256 for every archived legal document snapshot and rewrites
 * manifest.json. Run after adding a new revision snapshot:
 *
 *   node apps/web/scripts/hash-legal-archive.mjs
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const archiveDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../lib/legal/archive");
const documentsDir = path.join(archiveDir, "documents");
const manifestPath = path.join(archiveDir, "manifest.json");

const files = (await readdir(documentsDir)).filter((name) => name.endsWith(".md")).sort();
if (files.length === 0) {
  console.error("No archived snapshots found in", documentsDir);
  process.exit(1);
}

const entries = {};
for (const name of files) {
  const content = await readFile(path.join(documentsDir, name));
  entries[name] = createHash("sha256").update(content).digest("hex");
}

const manifest = {
  comment: "SHA-256 of apps/web/lib/legal/archive/documents/*.md. Regenerate with: node apps/web/scripts/hash-legal-archive.mjs",
  algorithm: "sha256",
  entries,
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`manifest.json updated with ${Object.keys(entries).length} snapshot hash(es).`);
