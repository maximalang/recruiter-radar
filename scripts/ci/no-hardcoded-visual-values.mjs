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
const cssRadiusDeclaration = /border-radius\s*:\s*([^;}\n]+)/gi;
const jsRadiusDeclaration = /\bborderRadius\s*:\s*(?:"([^"]+)"|'([^']+)'|(\d+(?:\.\d+)?))/g;
const cssBoxShadowDeclaration = /box-shadow\s*:\s*([^;}\n]+)/gi;
const jsBoxShadowDeclaration = /\bboxShadow\s*:\s*(?:"([^"]+)"|'([^']+)')/g;
const textShadowDeclaration = /text-shadow\s*:\s*([^;}\n]+)/gi;
const dropShadow = /drop-shadow\s*\(/gi;
const localLength = /(?:^|[\s(,+-])\d*\.?\d+(?:px|rem|em)\b/i;

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

function matches(regex, content) {
  regex.lastIndex = 0;
  return [...content.matchAll(regex)];
}

const failures = [];
for (const file of sourceFiles(appRoot)) {
  const content = readFileSync(file, 'utf8');
  const label = relative(file);

  for (const token of new Set(content.match(bannedTokenNamespace) ?? [])) {
    failures.push(`${label}: banned token namespace ${token}`);
  }

  for (const match of matches(cssRadiusDeclaration, content)) {
    const value = match[1].trim();
    if (localLength.test(value)) failures.push(`${label}: local border-radius ${value}`);
  }
  for (const match of matches(jsRadiusDeclaration, content)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (/^\d+(?:\.\d+)?$/.test(value) ? Number(value) !== 0 : localLength.test(value)) {
      failures.push(`${label}: local borderRadius ${value}`);
    }
  }

  for (const match of matches(cssBoxShadowDeclaration, content)) {
    const value = match[1].trim();
    if (!value.startsWith('none') && !value.startsWith('var(--shadow-')) {
      failures.push(`${label}: local box-shadow ${value}`);
    }
  }
  for (const match of matches(jsBoxShadowDeclaration, content)) {
    const value = (match[1] ?? match[2] ?? '').trim();
    if (!value.startsWith('none') && !value.startsWith('var(--shadow-')) {
      failures.push(`${label}: local boxShadow ${value}`);
    }
  }
  for (const match of matches(textShadowDeclaration, content)) {
    const value = match[1].trim();
    if (!value.startsWith('none')) failures.push(`${label}: local text-shadow ${value}`);
  }
  if (dropShadow.test(content)) failures.push(`${label}: local drop-shadow filter`);
  dropShadow.lastIndex = 0;

  if (tokenSources.has(file)) continue;

  for (const literal of new Set(content.match(rawColorLiteral) ?? [])) {
    failures.push(`${label}: hardcoded color ${literal}`);
  }
}

if (failures.length) {
  console.error('Semantic visual contract failed. Components must use canonical color, radius, and shadow tokens.');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Semantic visual contract passed: canonical namespaces, colors, radii, and shadows only.');
