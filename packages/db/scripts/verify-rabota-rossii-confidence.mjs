#!/usr/bin/env node

/**
 * Rabota Rossii (trudvsem opendata) — LIVE-DATA confidence verifier.
 *
 * Governance: source-registry.mjs `rabota-rossii` policy requires
 *   "RF query matrix, salary/region/freshness assertions, and HH dedupe checks
 *    must pass before digest promotion."
 * (promotionStatus: 'blocked-from-digest-pending-confidence-tests')
 *
 * This is NOT the offline smoke test (verify-rabota-rossii-smoke.mjs mocks fetch).
 * This script hits the real public API and asserts the normalization contract
 * against real records, then — if DATABASE_URL is set — checks HH-overlap dedupe
 * via org_source_refs.source_key collisions.
 *
 * It MUST be able to fail: contract violations throw, and a failed-check tally
 * drives a non-zero exit. Network access is opt-in (RABOTA_ROSSII_LIVE=1) so CI
 * without egress reports SKIPPED rather than a false pass.
 *
 * Exit codes:
 *   0 = all executed checks passed
 *   1 = at least one check failed
 *   2 = could not run (live disabled, or API unreachable) — neither pass nor fail
 */

import assert from 'node:assert/strict';

import pg from 'pg';

import { resolveRabotaRossiiLiveInput } from './source-rabota-rossii.mjs';

const { Client } = pg;

const LIVE_ENABLED = process.env.RABOTA_ROSSII_LIVE === '1';
const DATABASE_URL = process.env.DATABASE_URL?.trim() || null;

// Valid freshness buckets emitted by classifyVacancyFreshness().
const FRESHNESS_BUCKETS = new Set(['fresh-3d', 'fresh-7d', 'active-30d', 'stale-30d-plus', 'unknown']);

// Region codes per trudvsem OKTMO-style prefixes used elsewhere in the codebase.
// Each matrix row asserts the *expected* canonical region the normalizer should
// resolve for that geography — this is the "RF query matrix" the policy requires.
const QUERY_MATRIX = [
  { label: 'moscow', searchText: 'инженер', regionCode: '7700000000000', expectRegion: 'moscow' },
  { label: 'spb', searchText: 'разработчик', regionCode: '7800000000000', expectRegion: 'saint-petersburg' },
  { label: 'federal', searchText: 'менеджер', regionCode: null, expectRegion: null },
];

const failures = [];

function check(label, fn) {
  try {
    fn();
    console.log(`  ✅ ${label}`);
    return true;
  } catch (error) {
    failures.push({ label, message: error?.message ?? String(error) });
    console.log(`  ❌ ${label}: ${error?.message ?? error}`);
    return false;
  }
}

function finish(extra = {}) {
  const status = failures.length === 0 ? 'PASSED' : 'FAILED';
  console.log('\n' + '='.repeat(56));
  console.log(JSON.stringify({
    ok: failures.length === 0,
    source: 'rabota-rossii',
    mode: 'live-data-confidence',
    status,
    failedChecks: failures,
    ...extra,
  }, null, 2));
  process.exit(failures.length === 0 ? 0 : 1);
}

if (!LIVE_ENABLED) {
  console.log('⏭️  SKIPPED: live confidence checks are opt-in.');
  console.log('   Set RABOTA_ROSSII_LIVE=1 to hit opendata.trudvsem.ru.');
  console.log('   (Optional) Set DATABASE_URL to also run HH-overlap dedupe checks.');
  process.exit(2);
}

console.log('🌐 Rabota Rossii LIVE confidence verifier\n');

// ---------------------------------------------------------------------------
// 1) RF query matrix + salary / region / freshness assertions on real data.
// ---------------------------------------------------------------------------

/** @type {Array<{record: any, row: typeof QUERY_MATRIX[number]}>} */
const allNormalized = [];
let totalReceived = 0;

for (const row of QUERY_MATRIX) {
  console.log(`\n=== Matrix row: ${row.label} (text="${row.searchText}", region=${row.regionCode ?? 'any'}) ===`);

  let liveInput;
  try {
    liveInput = await resolveRabotaRossiiLiveInput({
      searchText: row.searchText,
      regionCode: row.regionCode,
      offset: 0,
      limit: 25,
    });
  } catch (error) {
    console.log(`  ⚠️  API unreachable for "${row.label}": ${error?.message ?? error}`);
    // A network failure is "could not run", not a contract failure. If *every*
    // row is unreachable we exit 2 below; a single flaky row should not mask a
    // genuine pass on the others, but we record it so it is visible.
    continue;
  }

  check(`${row.label}: live provider is trudvsem-opendata`, () => {
    assert.equal(liveInput.inputMode, 'live-public');
    assert.equal(liveInput.liveProvider, 'trudvsem-opendata');
  });

  totalReceived += liveInput.recordsReceived ?? 0;
  const records = liveInput.normalizedRecords ?? [];
  console.log(`  → received ${liveInput.recordsReceived ?? 0}, normalized ${records.length}, apiTotal ${liveInput.apiTotal ?? 'n/a'}`);

  for (const record of records) {
    allNormalized.push({ record, row });
  }
}

if (allNormalized.length === 0) {
  console.log('\n⚠️  No normalized records from any matrix row — cannot assert contract.');
  console.log('   Treating as "could not run" (exit 2), not a false pass.');
  process.exit(2);
}

console.log(`\n=== Contract assertions over ${allNormalized.length} live records ===`);

// Freshness: every record must carry a known bucket, and a live feed should be
// dominated by recent postings (>= 60% within active-30d window). Stale-heavy
// output is a real signal the source is not digest-worthy → must be able to fail.
check('freshness: every record uses a known bucket', () => {
  for (const { record } of allNormalized) {
    const bucket = record.payload?.vacancy_freshness;
    assert.ok(
      FRESHNESS_BUCKETS.has(bucket),
      `unexpected freshness bucket "${bucket}" for ${record.signalExternalId}`,
    );
  }
});

// Freshness gate (digest-promotion contract). The product freshness model
// (lib/scoring/lead-freshness.ts) decays >14d postings to 0.4 weight and treats
// active-30d as the outer usefulness bound. For a source to clear the gate its
// live feed must be majority-usable: >=60% inside active-30d. Empirically the
// trudvsem opendata feed fails this (≈72% stale-30d-plus on a Москва/СПб/
// федеральные matrix) — which is *why* the source is blocked-from-digest. This
// check is intended to keep failing until the source's recency improves or its
// fetch is filtered to recent postings; do not relax the threshold to make it
// green.
const ACTIVE_30D_MIN_RATIO = 0.6;
check(`freshness: >=${ACTIVE_30D_MIN_RATIO * 100}% of live records are within active-30d`, () => {
  const recent = allNormalized.filter(({ record }) =>
    ['fresh-3d', 'fresh-7d', 'active-30d'].includes(record.payload?.vacancy_freshness));
  const ratio = recent.length / allNormalized.length;
  assert.ok(
    ratio >= ACTIVE_30D_MIN_RATIO,
    `only ${(ratio * 100).toFixed(0)}% within active-30d (${recent.length}/${allNormalized.length}) — source skews stale, stays blocked-from-digest`,
  );
});

// Region: canonicalization must never be empty-string, and where the matrix row
// pinned a region code, at least one record must resolve to the expected canonical
// region (the API may return adjacent areas, so we assert presence, not purity).
check('region: canonical value is non-empty or null (never "")', () => {
  for (const { record } of allNormalized) {
    const canonical = record.payload?.region_canonical;
    assert.ok(
      canonical === null || (typeof canonical === 'string' && canonical.length > 0),
      `empty region_canonical for ${record.signalExternalId}`,
    );
  }
});

for (const row of QUERY_MATRIX) {
  if (!row.expectRegion) continue;
  const rowRecords = allNormalized.filter((entry) => entry.row.label === row.label);
  if (rowRecords.length === 0) continue;
  check(`region: "${row.label}" yields at least one ${row.expectRegion} record`, () => {
    const matched = rowRecords.some(({ record }) => record.payload?.region_canonical === row.expectRegion);
    assert.ok(matched, `no record resolved to ${row.expectRegion} (got: ${[...new Set(rowRecords.map((e) => e.record.payload?.region_canonical))].join(', ')})`);
  });
}

// Salary: when a salary is present it must be parsed to RUB with sane bounds and
// min <= max. Absence is allowed (many RF postings omit salary), but a present
// salary that parses to garbage is a contract violation.
check('salary: parsed RUB values are coherent (currency RUB, min<=max, in-range)', () => {
  for (const { record } of allNormalized) {
    const min = record.payload?.salary_rub_min;
    const max = record.payload?.salary_rub_max;
    const currency = record.payload?.salary_currency;

    if (min === null && max === null) continue; // salary not provided — allowed

    assert.equal(currency, 'RUB', `non-RUB currency "${currency}" for ${record.signalExternalId}`);

    for (const value of [min, max]) {
      if (value === null) continue;
      assert.ok(Number.isFinite(value) && value > 0, `non-positive salary ${value} for ${record.signalExternalId}`);
      // Monthly RUB sanity envelope: 5k floor, 5M ceiling.
      assert.ok(value >= 5000 && value <= 5_000_000, `salary ${value} out of sane RUB range for ${record.signalExternalId}`);
    }

    if (min !== null && max !== null) {
      assert.ok(min <= max, `salary min ${min} > max ${max} for ${record.signalExternalId}`);
    }
  }
});

// Identity / evidence boundary: the platform domain must never become company
// identity, and every record must carry a usable primarySourceKey.
check('identity: every record has a primarySourceKey, none is the platform domain', () => {
  for (const { record } of allNormalized) {
    assert.ok(record.primarySourceKey, `missing primarySourceKey for ${record.signalExternalId}`);
    assert.notEqual(record.primarySourceKey, 'domain:trudvsem.ru', 'platform domain leaked as company identity');
    assert.notEqual(record.companyDomain, 'trudvsem.ru', 'platform domain leaked as companyDomain');
  }
});

// Privacy: source-level personal contact fields must never survive into payload.
check('privacy: no personal contact fields in payload', () => {
  for (const { record } of allNormalized) {
    for (const banned of ['email', 'contact_person', 'phone', 'contact_email']) {
      assert.equal(record.payload?.[banned], undefined, `payload leaked "${banned}" for ${record.signalExternalId}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 2) HH-overlap dedupe (requires DATABASE_URL).
//    RF identity collides with an existing HH org iff they share a source_key
//    (inn:/ogrn:/domain:) — that is the cross-source dedupe contract.
// ---------------------------------------------------------------------------

let dedupeReport = { ran: false };

if (!DATABASE_URL) {
  console.log('\n⏭️  HH-overlap dedupe skipped (no DATABASE_URL).');
} else {
  console.log('\n=== HH-overlap dedupe (org_source_refs) ===');

  // Only strong, cross-source-comparable keys participate in HH overlap.
  // company-name: keys are weak and not used for HH dedupe.
  const rfKeys = [...new Set(
    allNormalized
      .map(({ record }) => record.primarySourceKey)
      .filter((key) => typeof key === 'string' && (key.startsWith('inn:') || key.startsWith('ogrn:') || key.startsWith('domain:'))),
  )];

  const client = new Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();

    const hhKeysResult = await client.query(
      `SELECT DISTINCT source_key
         FROM org_source_refs
        WHERE source = 'hh'
          AND source_key = ANY($1)`,
      [rfKeys],
    );
    const collisions = hhKeysResult.rows.map((r) => r.source_key);

    // Sanity: confirm HH signals actually exist (so a "0 collisions" result is
    // meaningful and not just an empty DB). This is the verify query established
    // earlier: signals where source = 'hh'.
    const hhSignalCount = await client.query(`SELECT COUNT(*)::int AS n FROM signals WHERE source = 'hh'`);

    dedupeReport = {
      ran: true,
      rfStrongKeys: rfKeys.length,
      hhSignalCount: hhSignalCount.rows[0]?.n ?? 0,
      collisions: collisions.length,
      collisionKeys: collisions.slice(0, 20),
    };

    console.log(`  RF strong identity keys: ${rfKeys.length}`);
    console.log(`  HH signals in DB:        ${dedupeReport.hhSignalCount}`);
    console.log(`  HH-overlap collisions:   ${collisions.length}`);
    if (collisions.length > 0) {
      console.log(`  ↳ shared keys (capped): ${dedupeReport.collisionKeys.join(', ')}`);
    }

    // This is a *reporting* check, not a failure: overlap with HH is expected and
    // is exactly what dedupe must collapse downstream. We assert only the contract
    // that the query mechanism is sound (keys are well-formed strings).
    check('dedupe: HH-overlap query returned well-formed source_keys', () => {
      for (const key of collisions) {
        assert.ok(typeof key === 'string' && key.includes(':'), `malformed HH source_key "${key}"`);
      }
    });
  } catch (error) {
    failures.push({ label: 'dedupe: DB query', message: error?.message ?? String(error) });
    console.log(`  ❌ dedupe DB query failed: ${error?.message ?? error}`);
  } finally {
    await client.end().catch(() => {});
  }
}

finish({
  recordsReceived: totalReceived,
  recordsNormalized: allNormalized.length,
  matrixRows: QUERY_MATRIX.map((r) => r.label),
  dedupe: dedupeReport,
  evidenceBoundary: 'primary-platform; blocked-from-digest until these confidence checks pass',
});
