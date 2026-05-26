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

async function main() {
  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Get test client profile ID
    const profileResult = await client.query(
      'SELECT id FROM client_profiles WHERE agency_name = $1',
      ['Test Agency']
    );

    if (profileResult.rows.length === 0) {
      console.log('❌ Test client profile not found. Run create-test-client-profile.mjs first.');
      process.exit(1);
    }

    const clientProfileId = profileResult.rows[0].id;
    console.log(`📋 Using client_profile ID: ${clientProfileId}`);

    // Set Telegram chat ID for testing
    await client.query(
      'UPDATE client_profiles SET telegram_chat_id = $1 WHERE id = $2',
      ['123456789', clientProfileId]
    );
    console.log('✅ Set test Telegram chat ID');

    // Run digest for client profile
    console.log('\n🔄 Running digest...');

    // First, create digest run and candidates
    const runResult = await client.query(`
      INSERT INTO digest_runs (client_profile_id, source_key, status, requested_limit, selected_count, completed_at)
      VALUES ($1, 'hh', 'completed', 10, 0, NOW())
      RETURNING id
    `, [clientProfileId]);

    const runId = runResult.rows[0].id;
    console.log(`✅ Created digest run ID: ${runId}`);

    // Create digest candidates from HH signals
    const candidates = await client.query(`
      INSERT INTO digest_candidates (
        digest_run_id, client_profile_id, org_id, source_external_id, source_display_name,
        source_families, vacancies_count, distinct_vacancy_names_count, latest_published_at,
        total_score, reasons, opener, payload, created_at
      )
      SELECT
        $1 as digest_run_id,
        cp.id as client_profile_id,
        s.org_id,
        s.external_id as source_external_id,
        o.name as source_display_name,
        '["hh"]'::jsonb as source_families,
        1 as vacancies_count,
        1 as distinct_vacancy_names_count,
        s.occurred_at as latest_published_at,
        80 as total_score,
        '[]' as reasons,
        '' as opener,
        jsonb_build_object(
          'org_id', s.org_id,
          'org_name', o.name,
          'headline', s.headline,
          'summary', s.summary,
          'source_url', s.source_url,
          'published_at', s.occurred_at,
          'confidenceGate', 'B',
          'score_components', jsonb_build_object(
            'total_score', 80,
            'quality_weight', 30,
            'vacancies_score', 10,
            'role_diversity_score', 10,
            'recency_score', 20,
            'activity_score', 10
          ),
          'reason_details', '[]'
        ) as payload,
        NOW()
      FROM signals s
      JOIN orgs o ON s.org_id = o.id
      JOIN client_profiles cp ON cp.id = $2
      WHERE s.source = 'hh'
        AND s.occurred_at >= NOW() - interval '30 days'
        AND NOT EXISTS (
          SELECT 1 FROM digest_candidates dc
          WHERE dc.digest_run_id = $1 AND dc.org_id = s.org_id
        )
      RETURNING id
    `, [runId, clientProfileId]);

    if (candidates.rows.length > 0) {
      console.log(`✅ Created ${candidates.rows.length} digest candidates`);

      // Update run with selected count
      await client.query(
        'UPDATE digest_runs SET selected_count = $1 WHERE id = $2',
        [candidates.rows.length, runId]
      );
    } else {
      console.log('⚠️  No digest candidates created');
    }

    // Test delivery via API call simulation
    console.log('\n🚀 Testing digest delivery...');

    // Check if DIGEST_API_KEY is set
    if (!env.DIGEST_API_KEY) {
      console.log('⚠️  DIGEST_API_KEY not set in .env');
      console.log('Add this to your .env file: DIGEST_API_KEY=your-secret-key');
    } else {
      console.log('✅ DIGEST_API_KEY is configured');
    }

    console.log('\n📝 Manual test steps:');
    console.log('1. Set TELEGRAM_BOT_TOKEN in .env');
    console.log('2. Set DIGEST_API_KEY in .env');
    console.log('3. Run: curl -X POST http://localhost:3000/api/digest/delivery \\');
    console.log('   -H "Content-Type: application/json" \\');
    console.log('   -H "x-api-key: your-digest-api-key" \\');
    console.log('   -d \'{"clientProfileId": "' + clientProfileId + '"}\'');

    console.log('\n🎉 Test setup completed!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();