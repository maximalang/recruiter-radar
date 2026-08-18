import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const landingRoot = path.resolve('apps/web/app/landing');

const replacements = new Map([
  ['var(--slate-950, var(--color-text-primary))', 'var(--color-text-primary)'],
  ['var(--signal-deep, var(--color-signal))', 'var(--color-signal-hover)'],
  ['var(--slate-950)', 'var(--color-text-primary)'],
  ['var(--slate-900)', 'var(--color-text-primary)'],
  ['var(--slate-850)', 'var(--color-text-primary)'],
  ['var(--slate-800)', 'var(--color-text-primary)'],
  ['var(--paper-soft)', 'var(--color-surface-secondary)'],
  ['var(--paper-strong)', 'var(--color-surface-primary)'],
  ['var(--paper)', 'var(--color-canvas)'],
  ['var(--ink)', 'var(--color-text-primary)'],
  ['var(--muted-dark)', 'var(--color-text-secondary)'],
  ['var(--muted-light)', 'var(--color-text-secondary)'],
  ['var(--line-dark)', 'var(--color-separator)'],
  ['var(--line-light)', 'var(--color-separator)'],
  ['var(--signal-strong)', 'var(--color-signal)'],
  ['var(--signal-deep)', 'var(--color-signal-hover)'],
  ['var(--signal-soft)', 'var(--color-signal-soft)'],
  ['var(--signal)', 'var(--color-signal)'],
  ['var(--copper)', 'var(--color-copper)'],
  ['var(--warning)', 'var(--color-warning)'],
]);

const obsoleteDeclaration = /^[ \t]*--(?:slate-(?:950|900|850|800)|paper(?:-soft|-strong)?|ink|muted-(?:dark|light)|line-(?:dark|light)|signal(?:-strong|-deep|-soft)?|copper|warning)[ \t]*:[^;]+;[ \t]*\r?\n?/gim;

let changed = 0;
for (const entry of readdirSync(landingRoot, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.css')) continue;
  const file = path.join(landingRoot, entry.name);
  const before = readFileSync(file, 'utf8');
  let after = before.replace(obsoleteDeclaration, '');
  for (const [from, to] of replacements) after = after.replaceAll(from, to);
  if (after === before) continue;
  writeFileSync(file, after);
  changed += 1;
}

console.log(`Migrated landing semantic aliases in ${changed} CSS files.`);
