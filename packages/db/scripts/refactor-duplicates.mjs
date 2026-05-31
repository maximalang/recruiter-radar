#!/usr/bin/env node

/**
 * Script to refactor duplicate code across source scripts
 * Replaces common functions with shared utilities
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// List of files to check for duplicates
const TARGET_FILES = [
  'packages/db/scripts/source-career-pages.mjs',
  'packages/db/scripts/source-linkedin-company-pages.mjs',
  'packages/db/scripts/source-tech-job-boards.mjs',
  'packages/db/scripts/source-rabota-rossii.mjs',
  'packages/db/scripts/adapters/rf-source-runtime.mjs'
];

// Function to analyze a file for duplicates
function analyzeFile(filePath) {
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, 'utf8');
  const duplicates = [];

  // Check for loadEnvFile
  if (content.includes('function loadEnvFile(')) {
    duplicates.push('loadEnvFile');
  }

  // Check for normalizeDomain
  if (content.includes('function normalizeDomain(')) {
    duplicates.push('normalizeDomain');
  }

  // Check for normalizeInn
  if (content.includes('function normalizeInn(')) {
    duplicates.push('normalizeInn');
  }

  // Check for normalizeOgrn
  if (content.includes('function normalizeOgrn(')) {
    duplicates.push('normalizeOgrn');
  }

  // Check for CLI pattern
  if (content.includes('export async function run')) {
    duplicates.push('CLI function');
  }

  return duplicates.length > 0 ? { file: filePath, duplicates } : null;
}

// Main function
function main() {
  console.log('Analyzing files for duplicate code...\n');

  let totalFiles = 0;
  let filesWithDuplicates = 0;

  TARGET_FILES.forEach(filePath => {
    totalFiles++;
    const analysis = analyzeFile(filePath);

    if (analysis) {
      console.log(`❌ ${filePath}:`);
      analysis.duplicates.forEach(dup => console.log(`  - ${dup}`));
      filesWithDuplicates++;
    } else {
      console.log(`✅ ${filePath}: No duplicates found`);
    }
  });

  console.log(`\nAnalysis complete:`);
  console.log(`Files checked: ${totalFiles}`);
  console.log(`Files with duplicates: ${filesWithDuplicates}`);

  if (filesWithDuplicates > 0) {
    console.log('\nNext steps:');
    console.log('1. Update imports to use ./lib/common-utils.mjs');
    console.log('2. Remove duplicate function definitions');
    console.log('3. Replace function calls with imported versions');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}