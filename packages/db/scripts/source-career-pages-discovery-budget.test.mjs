import assert from 'node:assert/strict';
import test from 'node:test';

import { discoverCareerPageTargetsFromSeeds } from './source-career-pages.mjs';

test('bounds DB-native career discovery and returns the safely completed partial result', async () => {
  const times = [0, 20, 40];
  const probed = [];
  const result = await discoverCareerPageTargetsFromSeeds([
    { orgId: 1 }, { orgId: 2 }, { orgId: 3 },
  ], {
    budgetMs: 30,
    now: () => times.shift() ?? 40,
    probe: async (seed) => {
      probed.push(seed.orgId);
      return {
        targets: [{ id: `target-${seed.orgId}`, adapter: 'generic', source_url: `https://company-${seed.orgId}.example/careers` }],
        attemptedUrls: [],
        sameDomainCareerPageUrl: null,
        notes: [],
      };
    },
  });

  assert.deepEqual(probed, [1, 2]);
  assert.equal(result.targets.length, 2);
  assert.deepEqual(result.summary, {
    seedsTotal: 3,
    seedsConsidered: 2,
    targetsResolved: 2,
    unresolvedSeeds: 0,
    budgetExhausted: true,
  });
});
