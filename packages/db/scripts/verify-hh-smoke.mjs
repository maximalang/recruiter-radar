import { Client } from 'pg';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDir, '../../../.env');

// Load environment
if (!existsSync(rootEnvPath)) {
  console.error('.env file not found at', rootEnvPath);
  process.exit(1);
}

const envContent = readFileSync(rootEnvPath, 'utf8');
const envLines = envContent.split('\n');
const env = {};

for (const line of envLines) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const [key, ...rest] = trimmed.split('=');
    if (key && rest.length > 0) {
      env[key] = rest.join('=');
    }
  }
}

const databaseUrl = env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error('DATABASE_URL is not set in .env file');
  process.exit(1);
}

// Connect to database
const client = new Client({
  connectionString: databaseUrl,
});

try {
  await client.connect();
  console.log('✅ Connected to database');

  // Check if tables exist
  const tablesQuery = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN ('orgs', 'signals', 'hh_vacancies', 'org_source_refs')
  `;
  const result = await client.query(tablesQuery);

  const expectedTables = ['orgs', 'signals', 'hh_vacancies', 'org_source_refs'];
  const existingTables = result.rows.map(row => row.table_name);

  for (const table of expectedTables) {
    if (existingTables.includes(table)) {
      console.log(`✅ Table ${table} exists`);
    } else {
      console.log(`❌ Table ${table} missing`);
    }
  }

  // Check for existing HH data
  const signalsCount = await client.query('SELECT COUNT(*) as count FROM signals WHERE source = \'hh\'');
  console.log(`📊 HH signals in DB: ${signalsCount.rows[0].count}`);

  const orgSourceRefsCount = await client.query('SELECT COUNT(*) as count FROM org_source_refs WHERE source = \'hh\'');
  console.log(`📊 HH org_source_refs in DB: ${orgSourceRefsCount.rows[0].count}`);

  // Check database connectivity
  const version = await client.query('SELECT version()');
  console.log(`📋 PostgreSQL version: ${version.rows[0].version}`);

  console.log('\n🚀 HH smoke check completed successfully!');

} catch (error) {
  console.error('❌ Error during HH smoke check:', error.message);
  process.exit(1);
} finally {
  await client.end();
}