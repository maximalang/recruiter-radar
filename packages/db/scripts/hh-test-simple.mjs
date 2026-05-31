import { Client } from 'pg';

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/recruiter_radar';
const client = new Client({
  connectionString,
});
await client.connect();

console.log('Connected to database');

async function createTestData() {
  console.log('Creating test data...');

  // Create test org
  const orgQuery = `
    INSERT INTO orgs (name, domain, website_url, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  const orgValues = [
    'Test Company',
    'test-company-example.com',
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
    RETURNING *
  `;
  const signalValues = [
    org.id,
    'job_posting',
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

  console.log('\nTest data created successfully!');
  console.log('orgId:', org.id);
  console.log('signalId:', signal.id);
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