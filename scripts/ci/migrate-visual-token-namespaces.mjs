import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const roots = [
  path.resolve('apps/web/app'),
  path.resolve('apps/web/src/__tests__'),
  path.resolve('scripts/ci'),
];

const extensions = new Set(['.css', '.ts', '.tsx', '.mjs']);
const namespaceReplacements = [
  ['--rr-color-', '--color-'],
  ['--rr-font-', '--font-'],
  ['--rr-type-', '--type-'],
  ['--rr-space-', '--space-'],
  ['--rr-radius-', '--radius-'],
  ['--rr-shadow-', '--shadow-'],
  ['--rr-motion-', '--motion-'],
];

const exactTokenReplacements = new Map([
  ['--color-separator-default', '--color-separator'],
]);

const literalReplacements = new Map([
  ['#0f172a', 'var(--color-text-primary)'],
  ['#111827', 'var(--color-text-primary)'],
  ['#1f2937', 'var(--color-text-primary)'],
  ['#334155', 'var(--color-text-primary)'],
  ['#374151', 'var(--color-text-secondary)'],
  ['#475569', 'var(--color-text-secondary)'],
  ['#64748b', 'var(--color-text-tertiary)'],
  ['#667085', 'var(--color-text-tertiary)'],
  ['#6b7280', 'var(--color-text-tertiary)'],
  ['#94a3b8', 'var(--color-text-tertiary)'],
  ['#9ca3af', 'var(--color-text-tertiary)'],
  ['#cbd5e1', 'var(--color-separator-strong)'],
  ['#d1d5db', 'var(--color-separator)'],
  ['#e2e8f0', 'var(--color-separator)'],
  ['#e5e7eb', 'var(--color-separator)'],
  ['#f1f5f9', 'var(--color-surface-secondary)'],
  ['#f3f4f6', 'var(--color-surface-secondary)'],
  ['#f8fafc', 'var(--color-surface-primary)'],
  ['#991b1b', 'var(--color-destructive)'],
  ['#b91c1c', 'var(--color-destructive)'],
  ['#166534', 'var(--color-positive)'],
  ['#15803d', 'var(--color-positive)'],
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
