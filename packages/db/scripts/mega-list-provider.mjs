#!/usr/bin/env node

/**
 * API-Mega-List Provider Integration
 *
 * Integrates with job aggregation APIs while maintaining compliance:
 * - All Jobs Scraper (LinkedIn, Indeed, Glassdoor)
 * - BuiltWith-style company tech stack
 * - Compliant field filtering
 */

import { fetchJson } from './adapters/source-http.mjs';
import { normalizeJobPostingRecord } from './adapters/rf-source-normalizers.mjs';
import { getDedupeService } from './dedupe-service.mjs';

// Provider configurations
const PROVIDERS = {
  'all-jobs-scraper': {
    name: 'All Jobs Scraper',
    baseUrl: 'https://api.alljobs scraper.com/v1',
    endpoints: {
      search: '/jobs/search',
      company: '/companies/{domain}',
    },
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    // Required config
    required: {
      API_KEY: 'ALLJOBS_API_KEY',
      RATE_LIMIT: 100, // requests per minute
    },
    // Field filtering rules
    fieldWhitelist: [
      'job_title',
      'company_name',
      'company_domain',
      'company_website_url',
      'location',
      'salary',
      'employment_type',
      'published_at',
      'job_url',
      'tags',
      'company_size',
      'industry',
    ],
    fieldBlacklist: [
      'employee_email',
      'employee_phone',
      'personal_email',
      'phone_number',
      'employee_name',
      'employee_title',
      'employee_department',
      'direct_report',
      'linkedin_profile',
      'resume_url',
    ],
  },
  'builtwith': {
    name: 'BuiltWith Company Data',
    baseUrl: 'https://api.builtwith.com/free',
    endpoints: {
      company: '/company lookup',
    },
    headers: {
      'Accept': 'application/json',
    },
    required: {
      API_KEY: 'BUILTWITH_API_KEY',
    },
    fieldWhitelist: [
      'company_name',
      'company_domain',
      'technology_stack',
      'primary_category',
      'traffic_rank',
      'founding_year',
    ],
  },
  'wellfound': {
    name: 'Wellfound (ex-YC)',
    baseUrl: 'https://api.wellfound.com/api/v1',
    endpoints: {
      companies: '/companies',
      jobs: '/companies/{id}/jobs',
    },
    headers: {
      'Accept': 'application/json',
      'Authorization': 'Bearer {API_KEY}',
    },
    required: {
      API_KEY: 'WELLFOUND_API_KEY',
    },
    fieldWhitelist: [
      'job_title',
      'company_name',
      'company_domain',
      'location',
      'salary_min',
      'salary_max',
      'currency',
      'job_type',
      'created_at',
    ],
  },
};

// Compliance checks
export function checkCompliance(records, providerId) {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  const issues = [];
  const sanitizedRecords = [];

  for (const record of records) {
    const sanitized = { ...record };
    let hasIssues = false;

    // Check blacklisted fields
    for (const field of provider.fieldBlacklist) {
      if (record[field] !== undefined) {
        issues.push(`Blacklisted field found: ${field}`);
        delete sanitized[field];
        hasIssues = true;
      }
    }

    // Validate required fields
    const requiredFields = ['job_title', 'company_name'];
    for (const field of requiredFields) {
      if (!record[field]) {
        issues.push(`Missing required field: ${field}`);
        hasIssues = true;
      }
    }

    if (!hasIssues) {
      sanitizedRecords.push(sanitized);
    } else {
      console.warn(`⚠️  Record sanitized due to compliance issues`);
    }
  }

  return {
    sanitizedRecords,
    issues,
    compliant: issues.length === 0,
  };
}

// Fetch jobs from provider
export async function fetchFromProvider(providerId, params = {}) {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  // Check required config
  for (const [key, envVar] of Object.entries(provider.required)) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required config: ${envVar}`);
    }
  }

  const dedupe = getDedupeService();
  const results = [];
  const page = params.page || 1;
  const limit = params.limit || 100;

  try {
    // Build request URL
    const url = new URL(provider.endpoints.search, provider.baseUrl);
    url.searchParams.set('page', page);
    url.searchParams.set('limit', limit);

    // Add search params
    if (params.search) url.searchParams.set('q', params.search);
    if (params.location) url.searchParams.set('location', params.location);
    if (params.company) url.searchParams.set('company', params.company);

    // Add headers
    const headers = { ...provider.headers };
    if (provider.required.API_KEY) {
      headers['Authorization'] = headers['Authorization']?.replace('{API_KEY}', process.env[provider.required.API_KEY]);
    }

    // Make request
    const response = await fetchJson(url, {
      sourceName: `mega-list-${providerId}`,
      headers,
    });

    // Process and filter records
    const records = Array.isArray(response.jobs) ? response.jobs :
                   Array.isArray(response.results) ? response.results :
                   [];

    console.log(`📥 Fetched ${records.length} records from ${provider.name}`);

    // Check compliance
    const compliance = checkCompliance(records, providerId);

    if (!compliance.compliant) {
      console.warn(`⚠️  Compliance issues found: ${compliance.issues.length}`);
      compliance.issues.forEach(issue => console.warn(`  - ${issue}`));
    }

    // Normalize and dedupe
    for (const record of compliance.sanitizedRecords) {
      // Normalize record
      const normalized = normalizeJobPostingRecord(record, {
        fetchedAt: new Date().toISOString(),
        sourceId: `mega-list-${providerId}`,
        lineNumber: results.length + 1,
      });

      if (normalized && !dedupe.isDuplicate(normalized)) {
        results.push(normalized);
      }
    }

    console.log(`✅ Added ${results.length} unique records`);

    return {
      success: true,
      providerId,
      page,
      totalPages: response.total_pages || 1,
      totalResults: response.total || results.length,
      records: results,
      compliance: {
        checked: records.length,
        passed: compliance.sanitizedRecords.length,
        issues: compliance.issues,
      },
    };

  } catch (error) {
    console.error(`❌ Failed to fetch from ${provider.name}: ${error.message}`);
    return {
      success: false,
      providerId,
      error: error.message,
    };
  }
}

// Company enrichment from provider
export async function enrichCompany(domain, providerId = 'builtwith') {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  try {
    const url = new URL(provider.endpoints.company, provider.baseUrl);
    url.searchParams.set('domain', domain);

    const headers = { ...provider.headers };
    if (provider.required.API_KEY) {
      headers['Authorization'] = headers['Authorization']?.replace('{API_KEY}', process.env[provider.required.API_KEY]);
    }

    const response = await fetchJson(url, {
      sourceName: `mega-list-company-${providerId}`,
      headers,
    });

    // Filter fields
    const filtered = {};
    for (const [key, value] of Object.entries(response)) {
      if (provider.fieldWhitelist.includes(key)) {
        filtered[key] = value;
      }
    }

    return {
      success: true,
      domain,
      data: filtered,
    };

  } catch (error) {
    return {
      success: false,
      domain,
      error: error.message,
    };
  }
}

// Batch processing
export async function processProviderBatch(providerId, companies) {
  const results = [];
  const batchSize = 5; // API rate limiting
  const delay = 1000; // 1 second between batches

  for (let i = 0; i < companies.length; i += batchSize) {
    const batch = companies.slice(i, i + batchSize);
    console.log(`🔄 Processing batch ${Math.floor(i/batchSize) + 1}: ${batch.length} companies`);

    const batchPromises = batch.map(async (company) => {
      const result = await enrichCompany(company.domain, providerId);
      return result;
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Rate limiting
    if (i + batchSize < companies.length) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return results;
}

// Provider test runner
export async function testProvider(providerId, testParams = {}) {
  console.log(`🧪 Testing provider: ${PROVIDERS[providerId]?.name || providerId}\n`);

  try {
    // Test basic search
    const searchResult = await fetchFromProvider(providerId, {
      search: testParams.search || 'engineer',
      limit: 5,
    });

    if (!searchResult.success) {
      throw new Error(`Provider test failed: ${searchResult.error}`);
    }

    console.log(`✅ Basic search: ${searchResult.records.length} records found`);

    // Test compliance
    if (searchResult.compliance.issues.length > 0) {
      console.warn(`⚠️  Compliance needs attention`);
    }

    // Test company enrichment if available
    if (testParams.testCompany && PROVIDERS[providerId].endpoints.company) {
      console.log(`\n🏢 Testing company enrichment...`);
      const companyResult = await enrichCompany(testParams.testCompany, providerId);

      if (companyResult.success) {
        console.log(`✅ Company enriched: ${Object.keys(companyResult.data).length} fields`);
      } else {
        console.warn(`⚠️  Company enrichment failed: ${companyResult.error}`);
      }
    }

    console.log('\n🎉 Provider test completed successfully');
    return true;

  } catch (error) {
    console.error(`❌ Provider test failed: ${error.message}`);
    return false;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const providerId = process.argv[2] || 'all-jobs-scraper';
  const testParams = {
    search: process.argv[3] || 'developer',
    testCompany: process.argv[4] || 'google.com',
  };

  testProvider(providerId, testParams)
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}