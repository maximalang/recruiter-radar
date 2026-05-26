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

    // Create test client profile
    const result = await client.query(`
      INSERT INTO client_profiles (
        agency_name, telegram_chat_id, target_city, specialization,
        include_keywords, exclude_keywords, daily_digest_limit, is_active,
        created_at, updated_at
      ) VALUES (
        'Test Agency',
        123456789,
        'Москва',
        'IT, Software Development',
        '["разработчик", "инженер", "менеджер"]',
        '["стажер", "volunteer"]',
        10,
        true,
        NOW(),
        NOW()
      )
      RETURNING id
    `);

    const clientProfileId = result.rows[0].id;
    console.log(`✅ Created test client_profile with ID: ${clientProfileId}`);

    // Set daily digest client profile ID in environment for digest command
    process.env.DAILY_DIGEST_CLIENT_PROFILE_ID = clientProfileId.toString();

    console.log('\n🚀 Test client profile created successfully!');
    console.log('You can now run `npm run digest` with this client profile');

  } catch (error) {
    console.error('❌ Error creating test client profile:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();