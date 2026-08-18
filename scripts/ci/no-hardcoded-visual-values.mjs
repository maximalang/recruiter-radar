import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['apps/web/app', 'apps/web/components'];
const extensions = new Set(['.css', '.tsx', '.ts']);
const tokenPath = /product-visual-system\.css|tokens?/;

const ignore = new Set(['node_modules', '.next']);

// Only inspect visual declarations. Generic numbers in business logic,
// copy, ids and accessibility attributes are valid.
const forbidden = [
  /(?:color|background(?:-color)?|border(?:-color)?|box-shadow)\s*:\s*[^;]*(?:#[0-9a-fA-F]{3,8}|rgba?\()/,
  /(?:margin|padding|gap|font-size|line-height|border-radius|border-width|width|height)\s*:\s*[^;]*\b\d+(?:px|rem|em)\b/,
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (ignore.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const failures = [];
for (const root of roots) {
  try {
    for (const file of walk(root)) {
      if (tokenPath.test(file)) continue;
      if (!extensions.has(file.slice(file.lastIndexOf('.')))) continue;
      const text = readFileSync(file, 'utf8');
      if (forbidden.some((pattern) => pattern.test(text))) failures.push(file);
    }
  } catch {}
}

if (failures.length) {
  console.error('Hardcoded visual values detected outside token sources:');
  for (const file of failures) console.error(`- ${file}`);
  process.exit(1);
}
