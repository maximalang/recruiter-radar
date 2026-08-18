import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve('apps/web/app');
const extensions = new Set(['.css', '.tsx', '.ts']);
const tokenSources = new Set([
  path.resolve('apps/web/app/globals.css'),
  path.resolve('apps/web/app/product-visual-system.css'),
]);
const rawColorLiteral = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)|\bhwb\([^)]*\)/g;
const bannedTokenNamespace = /--(?:c|rr)-[a-z0-9-]+/gi;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return extensions.has(path.extname(entry.name)) ? [absolute] : [];
  });
}

function relative(file) {
  return path.relative(process.cwd(), file).replaceAll(path.sep, '/');
}

const failures = [];
for (const file of sourceFiles(appRoot)) {
  const content = readFileSync(file, 'utf8');

  for (const token of new Set(content.match(bannedTokenNamespace) ?? [])) {
    failures.push(`${relative(file)}: banned token namespace ${token}`);
  }

  if (tokenSources.has(file)) continue;

  for (const literal of new Set(content.match(rawColorLiteral) ?? [])) {
    failures.push(`${relative(file)}: hardcoded color ${literal}`);
  }
}

if (failures.length) {
  console.error('Semantic visual contract failed. Components must use canonical tokens; palette literals belong only in token sources.');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Semantic visual contract passed: no --c-*/--rr-* tokens and no component-level color literals.');
