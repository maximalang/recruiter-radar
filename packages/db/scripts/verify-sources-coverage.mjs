#!/usr/bin/env node

/**
 * Verify source coverage against required P1/P2/P3 tiers and readiness policies.
 * Ensures all required sources are present, runnable, and properly configured.
 */

import { validateSourceCoverageReport } from './source-registry.mjs';

console.log('Verifying source coverage...\n');

try {
  const report = validateSourceCoverageReport();

  // Print summary
  console.log('=== SOURCE COVERAGE REPORT ===');
  console.log(`Generated: ${report.timestamp}\n`);

  // P1 Coverage
  console.log('P1 - Core production-ready sources:');
  console.log(`  Required: ${report.requiredTiers.P1.sources.length} sources`);
  console.log(`  Present: ${report.coverageReport.P1.present.length}/${report.requiredTiers.P1.sources.length}`);
  console.log(`  Compliant: ${report.coverageReport.P1.compliant.length}/${report.coverageReport.P1.present.length}`);

  if (report.coverageReport.P1.missing.length > 0) {
    console.log(`  MISSING: ${report.coverageReport.P1.missing.join(', ')}`);
  }
  if (report.coverageReport.P1.nonCompliant.length > 0) {
    console.log('  NON-COMPLIANT:');
    report.coverageReport.P1.nonCompliant.forEach(item => {
      console.log(`    - ${item.source}: ${item.reason}`);
    });
  }
  console.log();

  // P2 Coverage
  console.log('P2 - Secondary sources with confidence gates:');
  console.log(`  Required: ${report.requiredTiers.P2.sources.length} sources`);
  console.log(`  Present: ${report.coverageReport.P2.present.length}/${report.requiredTiers.P2.sources.length}`);
  console.log(`  Compliant: ${report.coverageReport.P2.compliant.length}/${report.coverageReport.P2.present.length}`);

  if (report.coverageReport.P2.missing.length > 0) {
    console.log(`  MISSING: ${report.coverageReport.P2.missing.join(', ')}`);
  }
  if (report.coverageReport.P2.nonCompliant.length > 0) {
    console.log('  NON-COMPLIANT:');
    report.coverageReport.P2.nonCompliant.forEach(item => {
      console.log(`    - ${item.source}: ${item.reason}`);
    });
  }
  console.log();

  // P3 Coverage
  console.log('P3 - Context sources with supporting role:');
  console.log(`  Required: ${report.requiredTiers.P3.sources.length} sources`);
  console.log(`  Present: ${report.coverageReport.P3.present.length}/${report.requiredTiers.P3.sources.length}`);
  console.log(`  Compliant: ${report.coverageReport.P3.compliant.length}/${report.coverageReport.P3.present.length}`);

  if (report.coverageReport.P3.missing.length > 0) {
    console.log(`  MISSING: ${report.coverageReport.P3.missing.join(', ')}`);
  }
  if (report.coverageReport.P3.nonCompliant.length > 0) {
    console.log('  NON-COMPLIANT:');
    report.coverageReport.P3.nonCompliant.forEach(item => {
      console.log(`    - ${item.source}: ${item.reason}`);
    });
  }
  console.log();

  // Digest sources check
  console.log('=== DIGEST SOURCES STATUS ===');
  ['hh', 'career-pages'].forEach(sourceId => {
    const source = report.allSources.find(s => s.id === sourceId);
    if (source) {
      console.log(`${sourceId}: ${source.promotionStatus} (${source.leadEligibility})`);
    }
  });
  console.log();

  // Errors and warnings
  if (report.coverageReport.errors.length > 0) {
    console.log('=== ERRORS ===');
    report.coverageReport.errors.forEach(error => {
      console.log(`❌ ${error}`);
    });
    console.log();
  }

  if (report.coverageReport.warnings.length > 0) {
    console.log('=== WARNINGS ===');
    report.coverageReport.warnings.forEach(warning => {
      console.log(`⚠️  ${warning}`);
    });
    console.log();
  }

  // Final result
  console.log('=== RESULT ===');
  if (report.passed) {
    console.log('✅ Source coverage validation PASSED');
    console.log('   All required P1/P2/P3 sources are present and compliant.');
    process.exit(0);
  } else {
    console.log('❌ Source coverage validation FAILED');
    console.log('   Missing or non-compliant sources found.');
    process.exit(1);
  }
} catch (error) {
  console.error('Error verifying source coverage:', error.message);
  process.exit(1);
}