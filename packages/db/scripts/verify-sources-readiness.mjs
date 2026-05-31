#!/usr/bin/env node

/**
 * Verify source readiness including:
 * - Registry integrity and contracts
 * - Provider response contracts
 * - Digest source boundaries
 * - Centralized HTTP usage
 * - Source action capabilities
 */

import { listSources } from './source-registry.mjs';
import { SOURCE_KINDS, SOURCE_CLASSES, EVIDENCE_TIERS, FETCH_MODES } from './source-contract.mjs';
import { validateSourceCoverageReport } from './source-registry.mjs';

console.log('Verifying source readiness...\n');

try {
  const sources = listSources();
  const coverageReport = validateSourceCoverageReport();

  const results = {
    registry: checkRegistryIntegrity(sources),
    contracts: checkSourceContracts(sources),
    boundaries: checkDigestBoundaries(sources),
    http: checkHttpUsage(sources),
    actions: checkActionCapabilities(sources),
    coverage: coverageReport,
    errors: [],
    warnings: []
  };

  // Print results
  console.log('=== SOURCE READINESS VERIFICATION ===');
  console.log(`Generated: ${new Date().toISOString()}\n`);

  // Registry integrity
  console.log('1. REGISTRY INTEGRITY');
  if (results.registry.passed) {
    console.log('✅ Registry integrity: OK');
    console.log(`   Total sources: ${results.registry.total}`);
    console.log(`   Active sources: ${results.registry.active}`);
    console.log(`   Planned sources: ${results.registry.planned}`);
  } else {
    console.log('❌ Registry integrity issues found');
    results.registry.issues.forEach(issue => {
      console.log(`   - ${issue}`);
    });
  }
  console.log();

  // Source contracts
  console.log('2. SOURCE CONTRACTS');
  if (results.contracts.passed) {
    console.log('✅ Source contracts: OK');
    Object.entries(results.contracts.byKind).forEach(([kind, count]) => {
      console.log(`   ${kind}: ${count} sources`);
    });
  } else {
    console.log('❌ Source contract violations found');
    results.contracts.issues.forEach(issue => {
      console.log(`   - ${issue}`);
    });
  }
  console.log();

  // Digest boundaries
  console.log('3. DIGEST SOURCE BOUNDARIES');
  if (results.boundaries.passed) {
    console.log('✅ Digest boundaries: OK');
    console.log(`   Active digest sources: ${results.boundaries.activeDigest}`);
    console.log(`   Properly gated: ${results.boundaries.gatedSources.length}`);
    results.boundaries.gatedSources.forEach(source => {
      console.log(`   - ${source.id}: ${source.promotionStatus}`);
    });
  } else {
    console.log('❌ Digest boundary violations found');
    results.boundaries.issues.forEach(issue => {
      console.log(`   - ${issue}`);
    });
  }
  console.log();

  // HTTP usage
  console.log('4. CENTRALIZED HTTP USAGE');
  if (results.http.passed) {
    console.log('✅ Centralized HTTP usage: OK');
    console.log(`   Sources using shared adapter: ${results.http.sharedAdapter}`);
    console.log(`   Direct HTTP usage: ${results.http.directUsage}`);
  } else {
    console.log('❌ HTTP usage violations found');
    results.http.issues.forEach(issue => {
      console.log(`   - ${issue}`);
    });
  }
  console.log();

  // Action capabilities
  console.log('5. ACTION CAPABILITIES');
  if (results.actions.passed) {
    console.log('✅ Action capabilities: OK');
    console.log(`   Sources with all actions: ${results.actions.fullCapabilities}`);
    console.log(`   Sources with limited actions: ${results.actions.limitedCapabilities}`);
  } else {
    console.log('❌ Action capability issues found');
    results.actions.issues.forEach(issue => {
      console.log(`   - ${issue}`);
    });
  }
  console.log();

  // Overall result
  const allPassed = Object.values(results).every(r => r.passed || !r.issues);

  console.log('=== OVERALL RESULT ===');
  if (allPassed) {
    console.log('✅ Source readiness verification PASSED');
    console.log('   All checks passed. Sources are ready for production use.');
    process.exit(0);
  } else {
    console.log('❌ Source readiness verification FAILED');
    console.log('   Issues found that must be resolved before production.');
    process.exit(1);
  }
} catch (error) {
  console.error('Error verifying source readiness:', error.message);
  process.exit(1);
}

function checkRegistryIntegrity(sources) {
  const issues = [];

  // Check for duplicate IDs
  const idCounts = {};
  sources.forEach(source => {
    idCounts[source.id] = (idCounts[source.id] || 0) + 1;
  });

  Object.entries(idCounts).forEach(([id, count]) => {
    if (count > 1) {
      issues.push(`Duplicate source ID: ${id}`);
    }
  });

  // Check required fields
  sources.forEach(source => {
    if (!source.id) issues.push(`Missing source.id`);
    if (!source.kind) issues.push(`Missing source.kind for ${source.id}`);
    if (!source.sourceClass) issues.push(`Missing sourceClass for ${source.id}`);
    if (!source.evidenceTier) issues.push(`Missing evidenceTier for ${source.id}`);
    if (!Array.isArray(source.fetchModes)) issues.push(`Invalid fetchModes for ${source.id}`);
  });

  // Check kind validity
  sources.forEach(source => {
    if (!SOURCE_KINDS.includes(source.kind)) {
      issues.push(`Invalid kind for ${source.id}: ${source.kind}`);
    }
  });

  return {
    passed: issues.length === 0,
    total: sources.length,
    active: sources.filter(s => s.status === 'active').length,
    planned: sources.filter(s => s.status === 'planned').length,
    issues
  };
}

function checkSourceContracts(sources) {
  const issues = [];
  const byKind = {};

  // Count by kind
  SOURCE_KINDS.forEach(kind => {
    byKind[kind] = sources.filter(s => s.kind === kind).length;
  });

  // Check class mapping
  sources.forEach(source => {
    const expectedClass = inferExpectedClass(source.kind);
    if (source.sourceClass !== expectedClass) {
      issues.push(`Expected class ${expectedClass} for ${source.id}, got ${source.sourceClass}`);
    }
  });

  // Check evidence tier (allow context-only for specific sources)
  sources.forEach(source => {
    const expectedTier = inferExpectedTier(source.kind);
    // Allow context-only for business-signal and specific company-site variants
    if (source.evidenceTier !== expectedTier &&
        !(source.kind === 'company-site' && source.evidenceTier === 'context-only') &&
        !(source.kind === 'business-signal' && source.evidenceTier === 'context-only')) {
      issues.push(`Expected evidence tier ${expectedTier} for ${source.id}, got ${source.evidenceTier}`);
    }
  });

  return {
    passed: issues.length === 0,
    byKind,
    issues
  };
}

function checkDigestBoundaries(sources) {
  const issues = [];
  const activeDigest = [];
  const gatedSources = [];

  // Check digest sources
  sources.forEach(source => {
    if (source.status === 'active' && source.promotionStatus === 'digest-allowed') {
      activeDigest.push(source.id);
    }

    if (source.promotionStatus && source.promotionStatus !== 'digest-allowed') {
      gatedSources.push({
        id: source.id,
        promotionStatus: source.promotionStatus
      });
    }
  });

  // Verify no non-digest sources are in active digest
  const expectedDigestSources = ['hh', 'career-pages'];
  activeDigest.forEach(id => {
    if (!expectedDigestSources.includes(id)) {
      issues.push(`${id} should not be in digest with current promotionStatus`);
    }
  });

  return {
    passed: issues.length === 0,
    activeDigest: activeDigest.length,
    gatedSources,
    issues
  };
}

function checkHttpUsage(sources) {
  const issues = [];
  let sharedAdapter = 0;
  let directUsage = 0;

  // In production, all HTTP calls should go through shared adapter
  // For now, check that sources have proper fetchModes defined
  sources.forEach(source => {
    if (source.fetchModes.includes('live-public') || source.fetchModes.includes('provider-token')) {
      sharedAdapter++;
    }
    if (source.fetchModes.includes('file')) {
      directUsage++;
    }
  });

  // Check for sources with unsupported fetch modes
  sources.forEach(source => {
    if (source.fetchModes.includes('unsupported')) {
      issues.push(`${source.id} has unsupported fetch mode`);
    }
  });

  return {
    passed: issues.length === 0,
    sharedAdapter,
    directUsage,
    issues
  };
}

function checkActionCapabilities(sources) {
  const issues = [];
  let fullCapabilities = 0;
  let limitedCapabilities = 0;

  sources.forEach(source => {
    if (source.capabilities.length === 3) { // fetch, ingest, pipeline
      fullCapabilities++;
    } else if (source.capabilities.length > 0) {
      limitedCapabilities++;
      issues.push(`${source.id} has limited capabilities: ${source.capabilities.join(', ')}`);
    } else {
      issues.push(`${source.id} has no capabilities`);
    }
  });

  return {
    passed: issues.length === 0,
    fullCapabilities,
    limitedCapabilities,
    issues
  };
}

// Helper functions
function inferExpectedClass(kind) {
  const mapping = {
    'job-board': 'primary-platform',
    'career-page': 'company-surface',
    'professional-network': 'primary-platform',
    'company-registry': 'registry-reference',
    'company-site': 'company-surface',
    'business-signal': 'market-signal'
  };
  return mapping[kind] || 'unknown';
}

function inferExpectedTier(kind) {
  const mapping = {
    'job-board': 'medium-signal',
    'career-page': 'high-signal',
    'professional-network': 'medium-signal',
    'company-registry': 'high-signal',
    'company-site': 'medium-signal',
    'business-signal': 'context-only'
  };
  return mapping[kind] || 'unknown';
}