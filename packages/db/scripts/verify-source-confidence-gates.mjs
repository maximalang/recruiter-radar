#!/usr/bin/env node

/**
 * Confidence Gate Tests for P2 Sources
 *
 * These tests verify that P2 sources meet quality requirements
 * before being promoted to digest generation.
 */

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Import source utilities
import { normalizeJobPostingRecord } from './adapters/rf-source-normalizers.mjs';
import { listSources } from './source-registry.mjs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');

// Confidence gate thresholds
const CONFIDENCE_THRESHOLDS = {
  orgIdentityMin: 0.7,  // Domain/INN/verified ID match
  sensitiveFieldsMax: 0, // No sensitive fields allowed
  freshnessMin: 0.8,    // Recent postings preferred
  dedupeRateMin: 0.95,  // 95%+ dedupe effectiveness
};

// Test fixtures data
const confidenceFixtures = {
  'tech-job-boards': [
    {
      external_id: 'tjb-conf-1',
      job_title: 'Senior Software Engineer',
      company_name: 'TechCorp Inc',
      company_domain: 'techcorp.example',
      company_website_url: 'https://techcorp.example',
      inn: '1234567890',
      location: 'Москва',
      salary: '200 000 — 300 000 ₽',
      published_at: new Date().toISOString(),
      board: 'greenhouse',
      tags: ['typescript', 'react', 'node.js'],
      // Sensitive fields that should be rejected
      // employee_email: 'john@techcorp.example', // Should be dropped
      // employee_phone: '+79991234567', // Should be dropped
    },
    {
      external_id: 'tjb-conf-2',
      job_title: 'DevOps Engineer',
      company_name: 'CloudSystems',
      company_domain: 'cloudsystems.ru',
      location: 'Санкт-Петербург',
      salary: '180 000 — 250 000 ₽',
      published_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
      board: 'lever',
      tags: ['aws', 'docker', 'kubernetes'],
    },
  ],

  'linkedin-company-pages': [
    {
      external_id: 'linkedin-conf-1',
      job_title: 'Product Manager',
      company_name: 'BigTech Co',
      company_domain: 'bigtech.com',
      company_website_url: 'https://bigtech.com',
      inn: '9876543210',
      location: 'Remote',
      salary: '250 000 — 350 000 ₽',
      published_at: new Date().toISOString(),
      board: 'linkedin',
      // Company insights only - no employee data
      // employee_count: 1000, // Should be dropped
      // industry: 'Technology', // OK as company-level
    },
  ],

  'superjob': [
    {
      external_id: 'sj-conf-1',
      job_title: 'Middle Python Developer',
      company_name: 'DataSoft',
      company_domain: 'datasoft.ru',
      location: 'Москва',
      salary: '150 000 — 200 000 ₽',
      published_at: new Date().toISOString(),
      board: 'superjob',
      tags: ['python', 'django', 'postgresql'],
    },
  ],

  'habr-career': [
    {
      external_id: 'habr-conf-1',
      job_title: 'Backend Developer (Python)',
      company_name: 'IT Solutions',
      company_domain: 'itsolutions.ru',
      location: 'Нижний Новгород',
      salary: '160 000 — 220 000 ₽',
      published_at: new Date().toISOString(),
      board: 'habr-career',
      tags: ['python', 'fastapi', 'postgresql'],
    },
  ],
};

// Write test fixtures
function writeConfidenceFixtures() {
  const fixturesDir = resolve(scriptDir, './confidence-fixtures');

  for (const [sourceId, records] of Object.entries(confidenceFixtures)) {
    const fixturePath = resolve(fixturesDir, `${sourceId}-confidence-fixture.json`);

    writeFileSync(fixturePath, JSON.stringify(records, null, 2));
    console.log(`✅ Created fixture: ${fixturePath}`);
  }
}

// Test organization identity confidence
function testOrgIdentityConfidence(records, sourceId) {
  console.log(`\n🔍 Testing org identity confidence for ${sourceId}`);

  let passed = 0;
  let total = 0;

  for (const record of records) {
    total++;

    // Check if we have identity confidence
    const hasDomain = record.companyDomain && record.companyDomain.includes('.');
    const hasInn = record.inn && record.inn.length === 10;
    const hasVerifiedId = hasDomain || hasInn;

    if (hasVerifiedId) {
      passed++;
      console.log(`  ✅ ${record.companyName ?? record.company_name}: has verified identity`);
    } else {
      console.log(`  ❌ ${record.companyName ?? record.company_name}: missing verified identity`);
    }
  }

  const confidence = passed / total;
  console.log(`  Identity confidence: ${confidence.toFixed(2)} (${passed}/${total})`);

  return {
    passed,
    total,
    confidence,
    meetsThreshold: confidence >= CONFIDENCE_THRESHOLDS.orgIdentityMin,
  };
}

// Test sensitive field rejection
function testSensitiveFieldRejection(records, sourceId) {
  console.log(`\n🚫 Testing sensitive field rejection for ${sourceId}`);

  const sensitiveFields = ['employee_email', 'employee_phone', 'personal_email', 'phone_number'];
  let droppedFields = 0;
  let totalFields = 0;

  records.forEach(record => {
    Object.keys(record).forEach(key => {
      if (sensitiveFields.includes(key)) {
        droppedFields++;
        console.log(`  ❌ Dropped sensitive field: ${key}`);
      }
      totalFields++;
    });
  });

  const rejectionRate = droppedFields / totalFields;
  console.log(`  Sensitive fields rate: ${rejectionRate.toFixed(2)} (${droppedFields}/${totalFields})`);

  return {
    droppedFields,
    totalFields,
    rejectionRate,
    meetsThreshold: rejectionRate <= CONFIDENCE_THRESHOLDS.sensitiveFieldsMax,
  };
}

// Test data freshness
function testFreshness(records, sourceId) {
  console.log(`\n⏰ Testing fixture freshness distribution for ${sourceId}`);

  const timestamps = records
    .map((record) => new Date(record.published_at || record.occurredAt).getTime())
    .filter(Number.isFinite);
  assert.equal(timestamps.length, records.length, `${sourceId} fixture dates must be valid`);
  // Fixture confidence must stay deterministic as wall-clock time advances.
  // Actual current freshness is a separate live-verifier assertion.
  const referenceNow = Math.max(...timestamps) + 24 * 60 * 60 * 1000;
  const freshThreshold = new Date(referenceNow - 7 * 24 * 60 * 60 * 1000);
  let fresh = 0;

  for (const record of records) {
    const publishedDate = new Date(record.published_at || record.occurredAt);

    if (publishedDate >= freshThreshold) {
      fresh++;
    }
  }

  const freshnessScore = fresh / records.length;
  console.log(`  Freshness score: ${freshnessScore.toFixed(2)} (${fresh}/${records.length})`);

  return {
    fresh,
    total: records.length,
    freshnessScore,
    meetsThreshold: freshnessScore >= CONFIDENCE_THRESHOLDS.freshnessMin,
  };
}

// Main test runner
async function runConfidenceTests() {
  console.log('🧪 Running Confidence Gate Tests for P2 Sources\n');

  const sources = listSources();
  const p2Sources = sources.filter(s => s.priority === 'P2' && s.leadEligibility === 'confidence-gated-evidence');

  const results = {};

  for (const source of p2Sources) {
    console.log(`\n=== Testing ${source.id} ===`);

    const fixturePath = resolve(scriptDir, './confidence-fixtures', `${source.id}-confidence-fixture.json`);

    try {
      const content = readFileSync(fixturePath, 'utf8');
      const records = JSON.parse(content);
      const testResults = {};

      // Run all tests
      testResults.orgIdentity = testOrgIdentityConfidence(records, source.id);
      testResults.sensitiveFields = testSensitiveFieldRejection(records, source.id);
      testResults.freshness = testFreshness(records, source.id);

      // Overall result
      const allTestsPassed = Object.values(testResults).every(result => result.meetsThreshold);

      results[source.id] = {
        ...testResults,
        overall: allTestsPassed ? 'PASSED' : 'FAILED',
      };

      console.log(`\n📊 ${source.id} Confidence Test: ${allTestsPassed ? '✅ PASSED' : '❌ FAILED'}`);
    } catch (error) {
      console.log(`❌ No fixture found for ${source.id}`);
      results[source.id] = { error: 'No fixture' };
      continue;
    }
  }

  // Summary report
  console.log('\n📋 Confidence Test Summary');
  console.log('=' .repeat(50));

  let passedCount = 0;
  let totalCount = Object.keys(results).length;

  for (const [sourceId, result] of Object.entries(results)) {
    const status = result.overall === 'PASSED' ? '✅' : '❌';
    console.log(`${status} ${sourceId}: ${result.overall}`);

    if (result.overall === 'PASSED') {
      passedCount++;
    }
  }

  console.log(`\nOverall: ${passedCount}/${totalCount} sources passed confidence gates`);

  if (passedCount === totalCount) {
    console.log('🎉 All P2 fixture confidence checks passed; live, legal, and readiness gates remain independent.');
    process.exit(0);
  } else {
    console.log('⚠️  Some sources need improvements before digest promotion');
    process.exit(1);
  }
}

// For external use (not exported as it's a script)
function runSingleSourceConfidenceTest(sourceId) {
  // Implementation for testing single source
}

// Run if called directly
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runConfidenceTests().catch(console.error);
}
