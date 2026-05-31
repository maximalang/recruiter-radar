#!/usr/bin/env node

/**
 * Dedupe Metrics Verification
 *
 * Checks and reports on duplicate detection effectiveness
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDedupeService } from './dedupe-service.mjs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');

console.log('🔍 Dedupe Metrics Verification\n');

// Load dedupe service
const dedupe = getDedupeService();

// Get quality report
const report = dedupe.getQualityReport();

console.log('📊 Quality Report');
console.log('=' .repeat(40));
console.log(`Total signals processed: ${report.totalSignals}`);
console.log(`Duplicates detected: ${report.duplicatesDetected}`);
console.log(`Unique signals: ${report.uniqueSignals}`);
console.log(`Duplicate rate: ${report.effectiveness}`);
console.log(`Suppressions: ${report.suppressionRate.toFixed(2)}`);

// Export detailed stats
const stats = dedupe.exportStats();

console.log('\n📈 By Source');
console.log('-' .repeat(40));
for (const [source, data] of Object.entries(stats.bySource)) {
  console.log(`${source}: ${data.count} suppressions`);
  if (data.reasons) {
    console.log('  Reasons:');
    for (const [reason, count] of Object.entries(data.reasons)) {
      console.log(`    ${reason}: ${count}`);
    }
  }
}

console.log('\n🎯 By Reason');
console.log('-' .repeat(40));
for (const [reason, data] of Object.entries(stats.byReason)) {
  console.log(`${reason}: ${data.count} from ${data.sources.size} sources`);
}

// Daily trend
console.log('\n📅 Daily Trend (last 7 days)');
console.log('-' .repeat(40));
stats.dailyTrend.forEach(day => {
  const bar = '█'.repeat(Math.min(day.suppressions / 2, 20));
  console.log(`${day.date}: ${day.suppressions.toString().padStart(3)} ${bar}`);
});

// Health check
console.log('\n🏥 Health Check');
console.log('-' .repeat(40));

const issues = [];
if (report.duplicateRate > 0.3) {
  issues.push('High duplicate rate detected (>30%)');
}
if (report.suppressionRate > 0.5) {
  issues.push('High suppression rate (>50%)');
}
if (report.totalSignals === 0) {
  issues.push('No signals processed yet');
}

if (issues.length === 0) {
  console.log('✅ No issues detected');
} else {
  console.log('⚠️ Issues found:');
  issues.forEach(issue => console.log(`  - ${issue}`));
}

console.log('\n💡 Recommendations');
console.log('-' .repeat(40));
if (report.duplicateRate > 0.3) {
  console.log('- Review normalization rules for source data');
  console.log('- Consider adjusting entity matching threshold');
}
if (report.suppressionRate > 0.5) {
  console.log('- Check feedback handling logic');
  console.log('- Review suppression aging policy');
}
if (report.totalSignals < 100) {
  console.log('- More data needed for accurate metrics');
}

console.log('\n✅ Dedupe metrics verification completed');