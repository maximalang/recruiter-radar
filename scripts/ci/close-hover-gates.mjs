#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';

const appRoot = path.resolve('apps/web/app');
const hoverCapability = /\(\s*hover\s*:\s*(?:hover|none)\s*\)/i;

async function cssFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(absolute);
    return entry.name.endsWith('.css') ? [absolute] : [];
  }));
  return nested.flat();
}

function isCapabilityGated(rule) {
  let parent = rule.parent;
  while (parent) {
    if (parent.type === 'atrule' && parent.name === 'media' && hoverCapability.test(parent.params)) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

const changed = [];
for (const file of await cssFiles(appRoot)) {
  const before = await fs.readFile(file, 'utf8');
  const root = postcss.parse(before, { from: file });
  const hoverRules = [];

  root.walkRules((rule) => {
    if (!rule.selector?.includes(':hover') || isCapabilityGated(rule)) return;

    const selectors = postcss.list.comma(rule.selector);
    const hoverSelectors = selectors.filter((selector) => selector.includes(':hover'));
    const baseSelectors = selectors.filter((selector) => !selector.includes(':hover'));
    if (hoverSelectors.length === 0) return;

    const hoverClone = rule.clone({ selector: hoverSelectors.join(',\n') });
    hoverRules.push(hoverClone);

    if (baseSelectors.length > 0) {
      rule.selector = baseSelectors.join(',\n');
    } else {
      rule.remove();
    }
  });

  if (hoverRules.length === 0) continue;

  const media = postcss.atRule({
    name: 'media',
    params: '(hover: hover) and (pointer: fine)',
  });
  for (const rule of hoverRules) media.append(rule);
  root.append(media);

  const after = root.toString();
  if (after !== before) {
    await fs.writeFile(file, after, 'utf8');
    changed.push(path.relative(process.cwd(), file).replaceAll(path.sep, '/'));
  }
}

if (changed.length === 0) {
  console.log('No ungated hover selectors found.');
} else {
  console.log(`Capability-gated hover selectors in ${changed.length} files:`);
  for (const file of changed) console.log(`- ${file}`);
}
