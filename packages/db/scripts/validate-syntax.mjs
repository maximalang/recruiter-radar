import { readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));

function collectMjsFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];

  for (const entry of entries) {
    const full = resolve(dir, entry);
    const stat = statSync(full);

    if (stat.isDirectory()) {
      files.push(...collectMjsFiles(full));
    } else if (entry.endsWith('.mjs')) {
      files.push(full);
    }
  }

  return files;
}

const files = collectMjsFiles(scriptDir);
let failed = 0;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'pipe' });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim();
    console.error(`FAIL: ${file}`);

    if (stderr) {
      console.error(stderr);
    }

    failed += 1;
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed syntax check.`);
  process.exit(1);
}

console.log(`OK: ${files.length} .mjs files passed syntax check.`);
