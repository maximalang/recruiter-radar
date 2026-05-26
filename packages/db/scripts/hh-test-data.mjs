import { Client } from 'pg';

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/recruiter_radar';
const client = new Client({
  connectionString,
});
await client.connect();

console.log('Connected to database');

async function createTestData() {
  console.log('Creating test HH data...');

  // Create test client profile
  const clientProfileQuery = `
    INSERT INTO client_profiles (id, agency_name, telegram_chat_id, target_city, specialization, include_keywords, exclude_keywords, daily_digest_limit, is_active, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (id) DO UPDATE SET
      agency_name = EXCLUDED.agency_name,
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `;
  const clientProfileValues = [
    1, // bigint
    'Test Agency',
    null,
    'Moscow',
    'IT Recruitment',
    null,
    null,
    5,
    true,
    new Date().toISOString(),
    new Date().toISOString(),
  ];

  const { rows: clientProfiles } = await client.query(clientProfileQuery, clientProfileValues);
  const clientProfile = clientProfiles[0];

  console.log('Client profile created:', clientProfile.id);

  // Create test org
  const orgQuery = `
    INSERT INTO orgs (name, domain, website_url, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (name) DO UPDATE SET
      domain = EXCLUDED.domain,
      website_url = EXCLUDED.website_url,
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `;
  const orgValues = [
    'Test Company',
    'test-company.com',
    'https://test-company.com',
    new Date().toISOString(),
    new Date().toISOString(),
  ];

  const { rows: orgs } = await client.query(orgQuery, orgValues);
  const org = orgs[0];

  console.log('Org created:', org.name);

  // Create test signal
  const signalQuery = `
    INSERT INTO signals (org_id, signal_type, source, external_id, headline, summary, source_url, occurred_at, payload, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (source, external_id) DO UPDATE SET
      occurred_at = GREATEST(signals.occurred_at, EXCLUDED.occurred_at),
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `;
  const signalValues = [
    org.id,
    'vacancy',
    'hh',
    'test-vacancy-123',
    'Senior Recruiter',
    'We are looking for an experienced recruiter to join our team.',
    'https://api.hh.ru/vacancies/123456',
    new Date().toISOString(),
    {
      id: '123456',
      name: 'Senior Recruiter',
      employer: { name: 'Test Company', id: 'test-emp-001' },
      area: { name: 'Moscow' },
      salary: { from: 150000, to: 200000, currency: 'RUR' },
      published_at: new Date().toISOString(),
      url: 'https://api.hh.ru/vacancies/123456'
    },
    new Date().toISOString(),
    new Date().toISOString(),
  ];

  const { rows: signals } = await client.query(signalQuery, signalValues);
  const signal = signals[0];

  console.log('Signal created:', signal.id);

  // Create test org_source_refs
  const orgSourceRefQuery = `
    INSERT INTO org_source_refs (org_id, source, source_key, external_id, metadata)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (org_id, source) DO UPDATE SET
      source_key = EXCLUDED.source_key,
      external_id = EXCLUDED.external_id,
      metadata = EXCLUDED.metadata,
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `;
  const orgSourceRefValues = [
    org.id,
    'hh',
    'domain:test-company.com',
    'test-vacancy-123',
    { refs: ['test-vacancy-123'] }
  ];

  await client.query(orgSourceRefQuery, orgSourceRefValues);
  console.log('Org source ref created');

  // Create test digest candidate
  const digestCandidateQuery = `
    INSERT INTO digest_candidates (client_profile_id, signal_id, org_id, score, confidence, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (client_profile_id, signal_id) DO NOTHING
    RETURNING *
  `;
  const digestCandidateValues = [
    clientProfile.id,
    signal.id,
    org.id,
    3.5,
    'A',
    new Date().toISOString(),
  ];

  const { rows: candidates } = await client.query(digestCandidateQuery, digestCandidateValues);
  console.log('Digest candidate created:', candidates.length > 0 ? candidates[0].id : 'already exists');

  // Create test client_digest_org_state
  const clientDigestOrgStateQuery = `
    INSERT INTO client_digest_org_state (client_profile_id, org_id, state, delivered_count, skipped_count, last_delivered_at, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (client_profile_id, org_id) DO UPDATE SET
      state = EXCLUDED.state,
      delivered_count = EXCLUDED.delivered_count,
      skipped_count = EXCLUDED.skipped_count,
      last_delivered_at = EXCLUDED.last_delivered_at,
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `;
  const clientDigestOrgStateValues = [
    clientProfile.id,
    org.id,
    'delivered',
    1,
    0,
    new Date().toISOString(),
    new Date().toISOString(),
    new Date().toISOString(),
  ];

  await client.query(clientDigestOrgStateQuery, clientDigestOrgStateValues);
  console.log('Client digest org state created');

  console.log('\nTest data created successfully!');
  console.log('clientProfileId:', clientProfile.id);
}

try {
  await createTestData();
} catch (error) {
  console.error('Error creating test data:', error);
  throw error;
} finally {
  await client.end();
  console.log('Database connection closed');
}