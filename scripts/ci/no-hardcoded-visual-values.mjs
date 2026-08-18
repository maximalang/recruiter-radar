import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const extensions = new Set(['.css', '.tsx', '.ts']);
const tokenSource = /(?:^|\/)(?:globals|product-visual-system)\.css$|tokens?/;
const rawColorLiteral = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)|\bhwb\([^)]*\)/g;

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function extension(path) {
  return path.slice(path.lastIndexOf('.'));
}

function literals(text) {
  return text.match(rawColorLiteral) ?? [];
}

function counts(values) {
  const result = new Map();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function readBaseFile(baseRef, path) {
  try {
    return git(['show', `${baseRef}:${path}`]);
  } catch {
    return '';
  }
}

const baseBranch = process.env.GITHUB_BASE_REF?.trim() || 'main';
const baseRef = `origin/${baseBranch}`;

try {
  git(['rev-parse', '--verify', baseRef]);
} catch {
  console.error(`Unable to resolve visual-contract base ref: ${baseRef}`);
  process.exit(1);
}

const changed = git(['diff', '--name-only', '--diff-filter=ACMR', `${baseRef}...HEAD`, '--', 'apps/web/app'])
  .split('\n')
  .map((path) => path.trim())
  .filter(Boolean)
  .filter((path) => extensions.has(extension(path)))
  .filter((path) => !tokenSource.test(path));

const failures = [];
for (const file of changed) {
  const currentCounts = counts(literals(readFileSync(file, 'utf8')));
  const baseCounts = counts(literals(readBaseFile(baseRef, file)));

  for (const [literal, count] of currentCounts) {
    const baselineCount = baseCounts.get(literal) ?? 0;
    if (count > baselineCount) {
      failures.push({ file, literal, added: count - baselineCount });
    }
  }
}

if (failures.length) {
  console.error('New hardcoded color literals detected outside semantic token sources:');
  for (const failure of failures) {
    console.error(`- ${failure.file}: ${failure.literal} (+${failure.added})`);
  }
  process.exit(1);
}

console.log(`Visual color contract passed for ${changed.length} changed UI source files.`);
