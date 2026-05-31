#!/usr/bin/env node

/**
 * Verify source live configuration status.
 * Checks which sources have proper environment setup for live mode.
 */

import { listSources } from './source-registry.mjs';

console.log('Verifying source live configuration...\n');

try {
  const sources = listSources();
  const results = {
    productionReady: [],
    providerRequired: [],
    snapshotOnly: [],
    missingEnv: [],
    blockers: []
  };

  // Check each source
  sources.forEach(source => {
    if (source.status !== 'active') return;

    const envCheck = checkSourceEnvironment(source);

    if (envCheck.productionReady) {
      results.productionReady.push({
        id: source.id,
        modes: envCheck.modes
      });
    } else if (envCheck.providerRequired) {
      results.providerRequired.push({
        id: source.id,
        requiredEnv: envCheck.requiredEnv
      });
    } else if (envCheck.snapshotOnly) {
      results.snapshotOnly.push({
        id: source.id,
        envVar: envCheck.envVar
      });
    } else {
      results.missingEnv.push({
        id: source.id,
        requiredEnv: envCheck.requiredEnv
      });
    }

    if (envCheck.blockers.length > 0) {
      results.blockers.push({
        id: source.id,
        blockers: envCheck.blockers
      });
    }
  });

  // Print results
  console.log('=== SOURCE LIVE CONFIG VERIFICATION ===');
  console.log(`Generated: ${new Date().toISOString()}\n`);

  console.log('✅ PRODUCTION READY (live-public/file):');
  if (results.productionReady.length > 0) {
    results.productionReady.forEach(source => {
      console.log(`   ${source.id}: ${source.modes.join(', ')}`);
    });
  } else {
    console.log('   None');
  }
  console.log();

  console.log('🔐 PROVIDER REQUIRED (provider-token):');
  if (results.providerRequired.length > 0) {
    results.providerRequired.forEach(source => {
      console.log(`   ${source.id}: requires ${source.requiredEnv.join(', ')}`);
    });
  } else {
    console.log('   None');
  }
  console.log();

  console.log('📁 SNAPSHOT ONLY (file mode available):');
  if (results.snapshotOnly.length > 0) {
    results.snapshotOnly.forEach(source => {
      console.log(`   ${source.id}: use ${source.envVar} for snapshots`);
    });
  } else {
    console.log('   None');
  }
  console.log();

  console.log('❌ MISSING ENVIRONMENT SETUP:');
  if (results.missingEnv.length > 0) {
    results.missingEnv.forEach(source => {
      console.log(`   ${source.id}: needs ${source.requiredEnv.join(', ')}`);
    });
  } else {
    console.log('   All sources have environment setup');
  }
  console.log();

  console.log('⚠️  PRODUCTION BLOCKERS:');
  if (results.blockers.length > 0) {
    results.blockers.forEach(source => {
      console.log(`   ${source.id}:`);
      source.blockers.forEach(blocker => {
        console.log(`     - ${blocker}`);
      });
    });
  } else {
    console.log('   No blockers found');
  }
  console.log();

  // Summary
  console.log('=== SUMMARY ===');
  console.log(`Total sources checked: ${sources.length}`);
  console.log(`Production ready: ${results.productionReady.length}`);
  console.log(`Provider required: ${results.providerRequired.length}`);
  console.log(`Snapshot only: ${results.snapshotOnly.length}`);
  console.log(`Missing env: ${results.missingEnv.length}`);
  console.log(`With blockers: ${results.blockers.length}`);

  // Check for launch readiness
  const launchReady = results.productionReady.length >= 2; // At least HH and career-pages
  console.log(`\nLaunch ready: ${launchReady ? 'YES' : 'NO'}`);

  if (launchReady) {
    console.log('\n✅ Sources are ready for controlled live operation.');
    process.exit(0);
  } else {
    console.log('\n❌ Sources need environment setup before launch.');
    console.log('\nNext steps:');
    if (results.missingEnv.length > 0) {
      console.log('- Set up required environment variables');
    }
    if (results.providerRequired.length > 0) {
      console.log('- Configure provider tokens for required sources');
    }
    process.exit(1);
  }
} catch (error) {
  console.error('Error verifying source live config:', error.message);
  process.exit(1);
}

function checkSourceEnvironment(source) {
  const result = {
    productionReady: false,
    providerRequired: false,
    snapshotOnly: false,
    missingEnv: [],
    requiredEnv: [],
    blockers: [],
    modes: []
  };

  // Check environment based on source ID
  switch (source.id) {
    case 'hh':
      if (process.env.HH_USER_AGENT) {
        result.productionReady = true;
        result.modes = ['live-public'];
        if (process.env.HH_SEARCH_TEXT) result.modes.push('custom-search');
      } else {
        result.requiredEnv = ['HH_USER_AGENT'];
        result.blockers.push('HH_USER_AGENT must identify a real registered app/contact');
      }
      break;

    case 'rabota-rossii':
      if (process.env.RABOTA_ROSSII_SEARCH_TEXT || !process.env.DATABASE_URL) {
        result.productionReady = true;
        result.modes = ['live-public'];
      }
      break;

    case 'career-pages':
      if (process.env.CAREER_PAGES_TARGETS_FILE ||
          process.env.CAREER_PAGES_INPUT_FILE ||
          process.env.DATABASE_URL) {
        result.productionReady = true;
        result.modes = ['live-public', 'file'];
      }
      break;

    case 'egrul-fns':
      if (process.env.EGRUL_FNS_INNS || process.env.EGRUL_FNS_PROVIDER_API_URL) {
        result.productionReady = true;
        result.modes = ['live-public', 'provider-token'];
      } else {
        result.snapshotOnly = true;
        result.envVar = 'EGRUL_FNS_INPUT_FILE';
      }
      break;

    case 'company-site':
      if (process.env.COMPANY_SITE_TARGETS_FILE) {
        result.productionReady = true;
        result.modes = ['live-public'];
      } else {
        result.snapshotOnly = true;
        result.envVar = 'COMPANY_SITE_INPUT_FILE';
      }
      break;

    case 'funding-business-signals':
      if (process.env.FUNDING_SIGNALS_GDELT_QUERIES || process.env.FUNDING_SIGNALS_PROVIDER_API_URL) {
        result.productionReady = true;
        result.modes = ['live-public', 'provider-token'];
      } else {
        result.snapshotOnly = true;
        result.envVar = 'FUNDING_SIGNALS_INPUT_FILE';
      }
      break;

    case 'linkedin-company-pages':
      result.providerRequired = true;
      result.requiredEnv = ['LINKEDIN_PROVIDER_API_URL', 'LINKEDIN_PROVIDER_API_TOKEN'];
      break;

    case 'tech-job-boards':
      if (process.env.TECH_JOB_BOARDS_GREENHOUSE_TOKENS ||
          process.env.TECH_JOB_BOARDS_LEVER_SLUGS ||
          process.env.TECH_JOB_BOARDS_PROVIDER_API_URL) {
        result.productionReady = true;
        result.modes = ['live-public', 'provider-token'];
      } else {
        result.snapshotOnly = true;
        result.envVar = 'TECH_JOB_BOARDS_INPUT_FILE';
      }
      break;

    case 'superjob':
      if (process.env.SUPERJOB_PROVIDER_API_URL && process.env.SUPERJOB_API_APP_ID) {
        result.productionReady = true;
        result.modes = ['provider-token'];
      } else {
        result.providerRequired = true;
        result.requiredEnv = ['SUPERJOB_PROVIDER_API_URL', 'SUPERJOB_API_APP_ID'];
      }
      break;

    case 'habr-career':
      if (process.env.HABR_CAREER_PROVIDER_API_URL && process.env.HABR_CAREER_PROVIDER_API_TOKEN) {
        result.productionReady = true;
        result.modes = ['provider-token'];
      } else {
        result.providerRequired = true;
        result.requiredEnv = ['HABR_CAREER_PROVIDER_API_URL', 'HABR_CAREER_PROVIDER_API_TOKEN'];
      }
      break;

    case 'company-newsrooms':
      if (process.env.COMPANY_NEWSROOMS_TARGETS_FILE) {
        result.productionReady = true;
        result.modes = ['live-public'];
      } else if (process.env.COMPANY_NEWSROOMS_INPUT_FILE) {
        result.snapshotOnly = true;
        result.envVar = 'COMPANY_NEWSROOMS_INPUT_FILE';
      } else {
        result.providerRequired = true;
        result.requiredEnv = ['COMPANY_NEWSROOMS_PROVIDER_API_URL', 'COMPANY_NEWSROOMS_PROVIDER_API_TOKEN'];
      }
      break;

    case 'industry-media':
      result.providerRequired = true;
      result.requiredEnv = ['INDUSTRY_MEDIA_PROVIDER_API_URL', 'INDUSTRY_MEDIA_PROVIDER_API_TOKEN'];
      break;

    case 'regional-job-boards':
      result.providerRequired = true;
      result.requiredEnv = ['REGIONAL_JOB_BOARDS_PROVIDER_API_URL', 'REGIONAL_JOB_BOARDS_PROVIDER_API_TOKEN'];
      break;

    case 'transparent-business-fns':
      result.providerRequired = true;
      result.requiredEnv = ['TRANSPARENT_BUSINESS_FNS_PROVIDER_API_URL', 'TRANSPARENT_BUSINESS_FNS_PROVIDER_API_TOKEN'];
      break;

    case 'fedresurs':
      result.providerRequired = true;
      result.requiredEnv = ['FEDRESURS_PROVIDER_API_URL', 'FEDRESURS_PROVIDER_API_TOKEN'];
      break;

    default:
      // File mode is always available
      result.snapshotOnly = true;
      result.envVar = `${source.id.toUpperCase()}_INPUT_FILE`;
  }

  return result;
}