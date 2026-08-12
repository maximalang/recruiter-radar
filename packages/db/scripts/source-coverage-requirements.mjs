export const SOURCE_COVERAGE_TIERS = Object.freeze({
  P1: Object.freeze({
    description: 'Core production-ready sources for MVP',
    required: true,
    sources: ['hh', 'rabota-rossii', 'career-pages', 'greenhouse', 'lever', 'ashby', 'recruitee', 'workable', 'smartrecruiters', 'egrul-fns', 'transparent-business-fns', 'fedresurs'],
    leadEligibilityRequirements: {
      hh: 'digest-lead-originating',
      'rabota-rossii': 'confidence-gated-evidence',
      'career-pages': 'digest-lead-originating',
      'greenhouse': 'digest-lead-originating',
      'lever': 'digest-lead-originating',
      'ashby': 'digest-lead-originating',
      'recruitee': 'digest-lead-originating',
      'workable': 'digest-lead-originating',
      'smartrecruiters': 'digest-lead-originating',
      'egrul-fns': 'enrichment-only',
      'transparent-business-fns': 'enrichment-only',
      'fedresurs': 'context-only'
    }
  }),
  P2: Object.freeze({
    description: 'Secondary sources with confidence gates',
    required: true,
    sources: ['company-site', 'funding-business-signals', 'linkedin-company-pages', 'tech-job-boards', 'superjob', 'habr-career'],
    leadEligibilityRequirements: {
      'company-site': 'enrichment-only',
      'funding-business-signals': 'context-only',
      'linkedin-company-pages': 'confidence-gated-evidence',
      'tech-job-boards': 'confidence-gated-evidence',
      'superjob': 'confidence-gated-evidence',
      'habr-career': 'confidence-gated-evidence'
    }
  }),
  P3: Object.freeze({
    description: 'Context sources with supporting role',
    required: true,
    sources: ['company-newsrooms', 'industry-media', 'regional-job-boards', 'fns-open-data', 'government-procurement', 'cbr-registry', 'rosstat-open-data', 'rospatent-open-data'],
    leadEligibilityRequirements: {
      'company-newsrooms': 'context-only',
      'industry-media': 'context-only',
      'regional-job-boards': 'confidence-gated-evidence',
      'fns-open-data': 'context-only',
      'government-procurement': 'context-only',
      'cbr-registry': 'context-only',
      'rosstat-open-data': 'context-only',
      'rospatent-open-data': 'context-only'
    }
  })
});

export const DIGEST_SOURCES = Object.freeze(['hh', 'career-pages', 'greenhouse', 'lever', 'ashby', 'recruitee', 'workable', 'rabota-rossii', 'superjob']);

export const PROMOTION_STATUSES = Object.freeze({
  'digest-allowed': 'Allowed in digest selection',
  'digest-allowed-with-confidence-gate': 'Allowed with confidence gate validation',
  'blocked-from-digest-pending-confidence-tests': 'Blocked until confidence tests pass',
  'never-lead-originating': 'Never creates leads, context only',
  'supporting-evidence-only': 'Only supports existing evidence'
});

export function validateSourceCoverage(sources) {
  const results = {
    P1: { present: [], missing: [], compliant: [], nonCompliant: [] },
    P2: { present: [], missing: [], compliant: [], nonCompliant: [] },
    P3: { present: [], missing: [], compliant: [], nonCompliant: [] },
    errors: [],
    warnings: []
  };

  // Check each required source
  for (const [tier, config] of Object.entries(SOURCE_COVERAGE_TIERS)) {
    for (const sourceId of config.sources) {
      const source = sources.find(s => s.id === sourceId);

      if (!source) {
        results[tier].missing.push(sourceId);
        results.errors.push(`Missing required ${tier} source: ${sourceId}`);
        continue;
      }

      results[tier].present.push(sourceId);

      const readiness = source.readiness;
      if (!readiness) {
        results[tier].nonCompliant.push({
          source: sourceId,
          reason: 'Missing explicit readiness contract'
        });
        results.errors.push(`${sourceId} readiness contract is missing`);
      } else if (readiness.implementation !== 'implemented') {
        results[tier].nonCompliant.push({
          source: sourceId,
          reason: `Readiness implementation is ${readiness.implementation}`
        });
        results.errors.push(`${sourceId} readiness implementation is ${readiness.implementation}`);
      } else if (readiness.contract !== 'tested') {
        results[tier].nonCompliant.push({
          source: sourceId,
          reason: `Readiness contract is ${readiness.contract}`
        });
        results.errors.push(`${sourceId} readiness contract is ${readiness.contract}`);
      }

      // Check lead eligibility match
      const expectedEligibility = config.leadEligibilityRequirements[sourceId];
      if (expectedEligibility && source.leadEligibility !== expectedEligibility) {
        results[tier].nonCompliant.push({
          source: sourceId,
          reason: `Lead eligibility mismatch: expected ${expectedEligibility}, got ${source.leadEligibility}`
        });
        results.errors.push(`${sourceId} lead eligibility mismatch`);
      }

      if (!results[tier].nonCompliant.find(n => n.source === sourceId)) {
        results[tier].compliant.push(sourceId);
      }
    }
  }

  // Check digest sources are properly gated
  for (const sourceId of DIGEST_SOURCES) {
    const source = sources.find(s => s.id === sourceId);
    if (source && source.promotionStatus !== 'digest-allowed') {
      results.warnings.push(`Digest source ${sourceId} should have promotionStatus 'digest-allowed'`);
    }
  }

  return results;
}
