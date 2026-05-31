#!/usr/bin/env node

/**
 * Bulk refactoring script to replace duplicate code with shared utilities
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Files to refactor
const TARGET_FILES = [
  'packages/db/scripts/source-career-pages.mjs',
  'packages/db/scripts/source-linkedin-company-pages.mjs',
  'packages/db/scripts/source-tech-job-boards.mjs',
  'packages/db/scripts/source-rabota-rossii.mjs',
  'packages/db/scripts/adapters/rf-source-runtime.mjs'
];

// Function to refactor a specific file
function refactorFile(filePath) {
  if (!existsSync(filePath)) return false;

  let content = readFileSync(filePath, 'utf8');
  let changed = false;

  // Replace duplicate loadEnvFile imports and remove function
  if (!content.includes("import { loadEnvFile } from './lib/common-utils.mjs'")) {
    // Add import
    const importIndex = content.lastIndexOf('import');
    const newlineAfterImport = content.indexOf('\n', importIndex);

    if (newlineAfterImport !== -1) {
      content = content.slice(0, newlineAfterImport + 1) +
                   "import { loadEnvFile } from './lib/common-utils.mjs';\n" +
                   content.slice(newlineAfterImport + 1);
      changed = true;
    }
  }

  // Remove duplicate loadEnvFile function
  const loadEnvFileStart = content.indexOf('export function loadEnvFile(');
  if (loadEnvFileStart !== -1) {
    const loadEnvFileEnd = content.indexOf('}\n', loadEnvFileStart);
    if (loadEnvFileEnd !== -1) {
      content = content.slice(0, loadEnvFileStart) + '// loadEnvFile moved to ./lib/common-utils.mjs\n' + content.slice(loadEnvFileEnd + 1);
      changed = true;
    }
  }

  // Replace duplicate normalizeDomain function
  const normalizeDomainStart = content.indexOf('export function normalizeDomain(');
  if (normalizeDomainStart !== -1) {
    const normalizeDomainEnd = content.indexOf('}\n', normalizeDomainStart);
    if (normalizeDomainEnd !== -1) {
      content = content.slice(0, normalizeDomainStart) + '// normalizeDomain moved to ./lib/common-utils.mjs\n' + content.slice(normalizeDomainEnd + 1);
      changed = true;
    }
  }

  // Replace CLI runner pattern
  if (content.includes('export async function run') && !content.includes('runScriptCli')) {
    // Find the CLI function name
    const cliFuncMatch = content.match('export async function run(\\w+)');
    if (cliFuncMatch) {
      const funcName = cliFuncMatch[1];
      const oldPattern = `await run${funcName}();`;
      const newPattern = `await runScriptCli('source-${funcName.replace(/([A-Z])/g, '-$1').toLowerCase()}', run${funcName});`;

      content = content.replace(oldPattern, newPattern);
      changed = true;
    }
  }

  if (changed) {
    // Clean up extra newlines
    content = content.replace(/\n{3,}/g, '\n\n');
    writeFileSync(filePath, content);
    return true;
  }

  return false;
}

// Main function
function main() {
  console.log('Starting bulk refactoring...\n');

  let refactoredFiles = 0;
  TARGET_FILES.forEach(filePath => {
    if (refactorFile(filePath)) {
      console.log(`✓ Refactored: ${filePath}`);
      refactoredFiles++;
    } else {
      console.log(`- No changes needed: ${filePath}`);
    }
  });

  console.log(`\nRefactoring complete:`);
  console.log(`Files refactored: ${refactoredFiles}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}