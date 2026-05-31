#!/usr/bin/env node

/**
 * Mega-List Integration Verification
 *
 * Tests API-mega-list provider integration compliance
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testProvider } from './mega-list-provider.mjs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));

// Test fixtures
const testFixtures = {
  providers: [
    {
      id: 'all-jobs-scraper',
      name: 'All Jobs Scraper',
      testParams: {
        search: 'software engineer',
        testCompany: 'microsoft.com',
      },
      requiredEnv: ['ALLJOBS_API_KEY'],
    },
    {
      id: 'builtwith',
      name: 'BuiltWith',
      testParams: {
        testCompany: 'amazon.com',
      },
      requiredEnv: ['BUILTWITH_API_KEY'],
    },
    {
      id: 'wellfound',
      name: 'Wellfound',
      testParams: {
        search: 'product manager',
      },
      requiredEnv: ['WELLFOUND_API_KEY'],
    },
    {
      id: 'mock-provider',
      name: 'Mock Provider (for testing)',
      testParams: {
        search: 'engineer',
        testCompany: 'example.com',
      },
      requiredEnv: [], // No API key needed for mock
    },
  ],
};

// Create mock provider data for testing
function createMockProviderData() {
  const mockDir = resolve(scriptDir, './mega-list-fixtures');

  const mockJobs = [
    {
      id: 'mock-1',
      job_title: 'Senior Software Engineer',
      company_name: 'TechCorp',
      company_domain: 'techcorp.example',
      location: 'San Francisco',
      salary: '150000-200000',
      published_at: new Date().toISOString(),
      job_url: 'https://example.com/job/1',
    },
    {
      id: 'mock-2',
      job_title: 'Product Manager',
      company_name: 'Innovate Inc',
      company_domain: 'innovate.example',
      location: 'New York',
      salary: '120000-160000',
      published_at: new Date().toISOString(),
      job_url: 'https://example.com/job/2',
    },
  ];

  writeFileSync(resolve(mockDir, 'mock-jobs.json'), JSON.stringify(mockJobs, null, 2));
}

// Check environment setup
function checkEnvironment(provider) {
  const missingEnv = provider.requiredEnv.filter(env => !process.env[env]);

  if (missingEnv.length > 0) {
    console.log(`❌ Missing env vars: ${missingEnv.join(', ')}`);
    console.log(`   Set these in your .env file to test this provider`);
    return false;
  }

  console.log(`✅ Environment OK`);
  return true;
}

// Run provider tests
async function runProviderTests() {
  console.log('🚀 Mega-List Integration Verification\n');

  const results = {};

  for (const provider of testFixtures.providers) {
    console.log(`\n=== Testing ${provider.name} ===`);

    // Check environment
    if (!checkEnvironment(provider)) {
      results[provider.id] = { status: 'skipped', reason: 'missing_env' };
      continue;
    }

    // Run test
    const startTime = Date.now();
    const success = await testProvider(provider.id, provider.testParams);
    const duration = Date.now() - startTime;

    results[provider.id] = {
      status: success ? 'passed' : 'failed',
      duration,
      name: provider.name,
    };

    if (success) {
      console.log(`✅ ${provider.name} test completed in ${duration}ms`);
    } else {
      console.log(`❌ ${provider.name} test failed`);
    }
  }

  // Summary report
  console.log('\n📊 Test Summary');
  console.log('=' .repeat(50));

  let passedCount = 0;
  let totalCount = Object.keys(results).length;

  for (const [providerId, result] of Object.entries(results)) {
    const status = result.status === 'passed' ? '✅' :
                   result.status === 'failed' ? '❌' : '⚠️';
    const statusText = result.status === 'passed' ? 'PASSED' :
                      result.status === 'failed' ? 'FAILED' : 'SKIPPED';
    const duration = result.duration ? ` (${result.duration}ms)` : '';

    console.log(`${status} ${result.name}: ${statusText}${duration}`);

    if (result.status === 'passed') {
      passedCount++;
    }
  }

  console.log(`\nOverall: ${passedCount}/${totalCount} providers passed`);

  // Recommendations
  console.log('\n💡 Next Steps');
  console.log('-' .repeat(40));
  if (passedCount < totalCount) {
    console.log('1. Set up API keys for missing providers');
    console.log('2. Review provider documentation');
    console.log('3. Check rate limiting settings');
  }

  if (passedCount === totalCount) {
    console.log('🎉 All providers ready for production integration!');
  } else {
    console.log('⚠️  Some providers need configuration before use');
  }

  // Save results
  const reportPath = resolve(scriptDir, './mega-list-test-report.json');
  writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    results,
    summary: {
      total: totalCount,
      passed: passedCount,
      failed: totalCount - passedCount,
    },
  }, null, 2));

  console.log(`\n📄 Full report saved to: ${reportPath}`);
}

// Export for external use
export function runSingleProviderTest(providerId) {
  // Implementation for testing single provider
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // Create mock data if running for the first time
  if (!existsSync(resolve(scriptDir, './mega-list-fixtures'))) {
    createMockProviderData();
  }

  runProviderTests().catch(console.error);
}