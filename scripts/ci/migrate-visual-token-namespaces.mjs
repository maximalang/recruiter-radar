import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const roots = [
  path.resolve('apps/web/app'),
  path.resolve('apps/web/src/__tests__'),
  path.resolve('scripts/ci'),
];

const extensions = new Set(['.css', '.ts', '.tsx', '.mjs']);
const namespaceReplacements = [
  ['--color-', '--color-'],
  ['--font-', '--font-'],
  ['--type-', '--type-'],
  ['--space-', '--space-'],
  ['--radius-', '--radius-'],
  ['--shadow-', '--shadow-'],
  ['--motion-', '--motion-'],
];

const exactTokenReplacements = new Map([
  ['--color-separator', '--color-separator'],
]);

const literalReplacements = new Map([
  ['var(--color-text-primary)', 'var(--color-text-primary)'],
  ['var(--color-text-primary)', 'var(--color-text-primary)'],
  ['var(--color-text-primary)', 'var(--color-text-primary)'],
  ['var(--color-text-primary)', 'var(--color-text-primary)'],
  ['var(--color-text-secondary)', 'var(--color-text-secondary)'],
  ['var(--color-text-secondary)', 'var(--color-text-secondary)'],
  ['var(--color-text-tertiary)', 'var(--color-text-tertiary)'],
  ['var(--color-text-tertiary)', 'var(--color-text-tertiary)'],
  ['var(--color-text-tertiary)', 'var(--color-text-tertiary)'],
  ['var(--color-text-tertiary)', 'var(--color-text-tertiary)'],
  ['var(--color-text-tertiary)', 'var(--color-text-tertiary)'],
  ['var(--color-separator-strong)', 'var(--color-separator-strong)'],
  ['var(--color-separator)', 'var(--color-separator)'],
  ['var(--color-separator)', 'var(--color-separator)'],
  ['var(--color-separator)', 'var(--color-separator)'],
  ['var(--color-surface-secondary)', 'var(--color-surface-secondary)'],
  ['var(--color-surface-secondary)', 'var(--color-surface-secondary)'],
  ['var(--color-surface-primary)', 'var(--color-surface-primary)'],
  ['var(--color-destructive)', 'var(--color-destructive)'],
  ['var(--color-destructive)', 'var(--color-destructive)'],
  ['var(--color-positive)', 'var(--color-positive)'],
  ['var(--color-positive)', 'var(--color-positive)'],
]);

function filesUnder(root) {
  if (!statSync(root).isDirectory()) return [root];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(absolute) : [absolute];
  });
}

function migrate(content, file) {
  let next = content;
  for (const [from, to] of namespaceReplacements) next = next.replaceAll(from, to);
  for (const [from, to] of exactTokenReplacements) next = next.replaceAll(from, to);

  // The old globals file temporarily aliased semantic names back to the rr names.
  // After namespace replacement those aliases become self-references; remove them.
  next = next.replace(/^\s*(--[a-z0-9-]+):\s*var\(\1\);\s*\n?/gim, '');

  // Remove legacy slate/status literals from components. Token source files are the
  // only place where palette literals may live.
  if (!file.endsWith(`${path.sep}globals.css`)) {
    for (const [literal, token] of literalReplacements) {
      next = next.replaceAll(literal, token).replaceAll(literal.toUpperCase(), token);
    }
  }

  return next;
}

let changed = 0;
for (const root of roots) {
  for (const file of filesUnder(root)) {
    if (!extensions.has(path.extname(file))) continue;
    const before = readFileSync(file, 'utf8');
    const after = migrate(before, file);
    if (after === before) continue;
    writeFileSync(file, after);
    changed += 1;
  }
}

console.log(`Migrated semantic visual tokens in ${changed} files.`);
