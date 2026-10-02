/**
 * D2 market-profile presets — scan wiring.
 *
 * Proves the preset is NOT UI decoration: criteria seeded from the
 * «Инженерный подбор» preset travel the real scan-parameter path —
 * ClientProfile-shaped input → query-planner v2 (the same mapping the
 * query-planner-v2 job performs from client_profiles rows) → per-source
 * queryEnv consumed by the ingest adapters (HH_SEARCH_TEXT /
 * SUPERJOB_KEYWORD / RABOTA_ROSSII_SEARCH_TEXT).
 *
 * Also pins the editability promise («критерии можно изменить в любой
 * момент»): user-entered criteria win; the preset never re-injects its own
 * terms over an explicit edit.
 */
import {
  buildMarketProfileDraftFromPreset,
  getMarketProfilePresetById,
} from '@/lib/marketProfilePresets';
import {
  buildProfileScopedQueryPlans,
  type QueryPlannerV2ProfileInput,
} from '@/lib/lead-discovery/query-planner-v2';

function plannerInputFromPresetSeed(
  presetId: 'engineering-hiring' | 'finance-software',
  overrides: Partial<QueryPlannerV2ProfileInput> = {},
): QueryPlannerV2ProfileInput {
  const preset = getMarketProfilePresetById(presetId);
  if (!preset) throw new Error(`preset not found: ${presetId}`);
  const draft = buildMarketProfileDraftFromPreset(preset);
  return {
    workspaceId: '11',
    ownerId: '22',
    clientProfileId: '33',
    profileSnapshotHash: 'a'.repeat(64),
    roles: draft.roles,
    industries: draft.industries,
    excludedIndustries: [],
    includeKeywords: draft.includeKeywords,
    excludeKeywords: [],
    specialization: draft.specialization,
    targetCity: null,
    preferredRegions: [],
    excludedLocations: [],
    targetSeniorities: [],
    remoteFriendly: draft.remoteFriendly,
    dailyDigestLimit: 10,
    feedbackEvents: [],
    historicalYield: {
      fetchedRecords: null,
      uniqueEvents: null,
      uniqueCompanies: null,
      episodes: null,
      qualifiedOpportunities: null,
      accepted: null,
      contacted: null,
      replied: null,
      meetings: null,
    },
    ...overrides,
  };
}

describe('market-profile preset → scan parameters (query planner v2)', () => {
  it('builds ready plans for every source and both preset role families', () => {
    const plans = buildProfileScopedQueryPlans({
      profiles: [plannerInputFromPresetSeed('engineering-hiring')],
    });
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) {
      expect(plan.status).toBe('ready');
    }
    const sources = new Set(plans.map((plan) => plan.source));
    expect(sources.has('hh')).toBe(true);
    expect(sources.has('superjob')).toBe(true);
    expect(sources.has('rabota-rossii')).toBe(true);
    const roleFamilies = new Set(plans.map((plan) => plan.roleFamily));
    expect(roleFamilies.has('it-engineering')).toBe(true);
    expect(roleFamilies.has('data')).toBe(true);
  });

  it('the persisted preset niche and demand signals reach every source search text', () => {
    const plans = buildProfileScopedQueryPlans({
      profiles: [plannerInputFromPresetSeed('engineering-hiring')],
    });
    const bySource = new Map(plans.map((plan) => [plan.source, plan]));
    const hhText = (bySource.get('hh')?.queryEnv.HH_SEARCH_TEXT ?? '').toLowerCase();
    const superjobText = (bySource.get('superjob')?.queryEnv.SUPERJOB_KEYWORD ?? '').toLowerCase();
    const rrText = (
      bySource.get('rabota-rossii')?.queryEnv.RABOTA_ROSSII_SEARCH_TEXT ?? ''
    ).toLowerCase();

    for (const text of [hhText, superjobText, rrText]) {
      // ниша (specialization → includeKeywords path)
      expect(text).toContain('инженерный подбор');
      // признаки спроса (demand signals → includeKeywords)
      expect(text).toContain('расширение производства');
      expect(text).toContain('новая площадка');
      // роли (role family keywords)
      expect(text).toContain('инженер');
    }
  });

  it('preset geography maps to federal coverage incl. remote (demo: «ниша, роли, география»)', () => {
    const plans = buildProfileScopedQueryPlans({
      profiles: [plannerInputFromPresetSeed('engineering-hiring')],
    });
    const hhPlan = plans.find((plan) => plan.source === 'hh');
    expect(hhPlan).toBeDefined();
    expect(hhPlan?.region.resolution).toBe('federal');
    expect(hhPlan?.region.displayName).toBe('Россия');
    expect(hhPlan?.region.remoteRelation).toBe('remote_anywhere');
    expect(hhPlan?.queryEnv.HH_AREA).toBe('113');
  });

  it('records the niche in plan specializations and keeps demand signals in the keyword cluster', () => {
    const plans = buildProfileScopedQueryPlans({
      profiles: [plannerInputFromPresetSeed('engineering-hiring')],
    });
    const engineeringPlan = plans.find((plan) => plan.roleFamily === 'it-engineering');
    expect(engineeringPlan?.specializations).toContain('инженерный подбор');
    const cluster = (engineeringPlan?.keywordCluster ?? []).map((term) => term.toLowerCase());
    expect(cluster).toContain('инженерный подбор');
    expect(cluster).toContain('конструктор');
    expect(cluster).toContain('расширение производства');
  });

  it('the finance-software preset wires the same way (landing watch-list)', () => {
    const plans = buildProfileScopedQueryPlans({
      profiles: [plannerInputFromPresetSeed('finance-software')],
    });
    const hhText = (
      plans.find((plan) => plan.source === 'hh')?.queryEnv.HH_SEARCH_TEXT ?? ''
    ).toLowerCase();
    expect(hhText).toContain('финансовый софт');
    expect(hhText).toContain('финтех');
    expect(hhText).toContain('интеграция');
    const roleFamilies = new Set(plans.map((plan) => plan.roleFamily));
    expect(roleFamilies.has('sales')).toBe(true);
    expect(roleFamilies.has('finance')).toBe(true);
  });

  it('user edits win: custom criteria replace preset terms instead of re-injecting them', () => {
    const plans = buildProfileScopedQueryPlans({
      profiles: [
        plannerInputFromPresetSeed('engineering-hiring', {
          specialization: 'Своя ниша',
          includeKeywords: ['своя фраза'],
          roles: ['sales'],
        }),
      ],
    });
    const hhText = (
      plans.find((plan) => plan.source === 'hh')?.queryEnv.HH_SEARCH_TEXT ?? ''
    ).toLowerCase();
    expect(hhText).toContain('своя ниша');
    expect(hhText).toContain('своя фраза');
    expect(hhText).toContain('менеджер по продажам');
    expect(hhText).not.toContain('расширение производства');
    expect(hhText).not.toContain('инженерный подбор');
    const roleFamilies = new Set(plans.map((plan) => plan.roleFamily));
    expect(roleFamilies.has('it-engineering')).toBe(false);
    expect(roleFamilies.has('sales')).toBe(true);
  });
});
