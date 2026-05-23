#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'fs';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));

console.log('🚀 Simple Mega-List Test\n');

// Check mock data
const mockDataPath = resolve(scriptDir, './mega-list-fixtures/mock-jobs.json');
console.log('Mock data path:', mockDataPath);

try {
  const mockData = require(mockDataPath);
  console.log(`✅ Loaded mock data: ${mockData.length} jobs`);

  mockData.forEach(job => {
    console.log(`  - ${job.job_title} at ${job.company_name} (${job.company_domain})`);
  });

} catch (error) {
  console.log('❌ No mock data found');
  console.log('Creating mock data...');

  // Create mock data
  const mockJobs = [
    {
      id: 'mock-1',
      job_title: 'Senior Software Engineer',
      company_name: 'TechCorp',
      company_domain: 'techcorp.example',
      location: 'San Francisco',
      salary: '150000-200000',
      published_at: new Date().toISOString(),
    },
    {
      id: 'mock-2',
      job_title: 'Product Manager',
      company_name: 'Innovate Inc',
      company_domain: 'innovate.example',
      location: 'New York',
      salary: '120000-160000',
      published_at: new Date().toISOString(),
    },
  ];

  writeFileSync(mockDataPath, JSON.stringify(mockJobs, null, 2));

  console.log('✅ Mock data created');
}

console.log('\n✅ Simple test completed');