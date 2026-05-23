#!/usr/bin/env node

import { readFileSync } from 'fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSources } from './source-registry.mjs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));

console.log('🧪 Simple Confidence Test\n');

const sources = listSources();
console.log('Found sources:', sources.length);

const p2Sources = sources.filter(s => s.priority === 'P2' && s.leadEligibility === 'confidence-gated-evidence');
console.log('P2 confidence-gated sources:', p2Sources.length);

p2Sources.forEach(source => {
  console.log(`\n=== Testing ${source.id} ===`);

  try {
    const fixturePath = resolve(scriptDir, './confidence-fixtures', `${source.id}-confidence-fixture.json`);
    const content = readFileSync(fixturePath, 'utf8');
    const records = JSON.parse(content);

    console.log(`✅ Loaded ${records.length} records`);

    // Test 1: Org Identity
    let hasIdentity = 0;
    records.forEach(rec => {
      const hasDomain = rec.companyDomain && rec.companyDomain.includes('.');
      const hasInn = rec.inn && rec.inn.length === 10;
      if (hasDomain || hasInn) hasIdentity++;
    });

    const identityScore = hasIdentity / records.length;
    console.log(`🔍 Org Identity: ${identityScore.toFixed(2)} (${hasIdentity}/${records.length})`);

    // Test 2: Freshness
    const now = new Date();
    const freshThreshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    let fresh = 0;

    records.forEach(rec => {
      const pubDate = new Date(rec.published_at);
      if (pubDate >= freshThreshold) fresh++;
    });

    const freshnessScore = fresh / records.length;
    console.log(`⏰ Freshness: ${freshnessScore.toFixed(2)} (${fresh}/${records.length})`);

    // Overall
    const passed = identityScore >= 0.7 && freshnessScore >= 0.8;
    console.log(`📊 Result: ${passed ? '✅ PASSED' : '❌ FAILED'}`);

  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
});

console.log('\n✅ Simple confidence test completed');