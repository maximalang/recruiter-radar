#!/usr/bin/env node

import { readFileSync } from 'fs';
import { join } from 'path';

// Load .env file
const envPath = join(process.cwd(), '.env');
const envContent = readFileSync(envPath, 'utf8');
const hhUserAgent = envContent.match(/^HH_USER_AGENT=(.+)$/m)?.[1];

if (hhUserAgent) {
  console.log('✅ HH_USER_AGENT is set in .env file');
  console.log(`   Value: ${hhUserAgent}`);

  if (hhUserAgent.includes('Recruiter-Radar')) {
    console.log('✅ Contains proper app identity');
  } else {
    console.log('⚠️  Recommended: Use format "AppName/Version (URL; contact@email)"');
  }
} else {
  console.log('❌ HH_USER_AGENT is not set in .env file');
}

console.log('\n📋 Next steps:');
console.log('1. For production: Register at https://hh.ru/dev/oauth');
console.log('2. Use real client ID in HH_USER_AGENT');
console.log('3. Run: npm run verify:sources:live-config');
