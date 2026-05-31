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

    // Test checkout flow
    console.log('\n🔄 Testing checkout flow...');

    // 1. Create test user
    const testUserEmail = 'test-' + Date.now() + '@example.com';
    const userResult = await client.query(`
      INSERT INTO users (email, full_name)
      VALUES ($1, $2)
      RETURNING id
    `, [testUserEmail, 'Test User']);

    let testUserId;
    if (userResult.rows.length > 0) {
      testUserId = userResult.rows[0].id;
    } else {
      // User already exists, get their ID
      const existingUser = await client.query(
        'SELECT id FROM users WHERE email = $1',
        [testUserEmail]
      );
      testUserId = existingUser.rows[0].id;
    }
    console.log(`🆔 Test user ID: ${testUserId}`);

    // 2. Create test checkout order
    const orderResult = await client.query(`
      INSERT INTO checkout_orders (
        user_id, plan_code, amount_rub, currency, status,
        customer_name, customer_contact, payload, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()
      )
      RETURNING id
    `, [
      testUserId,
      'pilot',
      10000, // 100 RUB
      'RUB',
      'created',
      'Test Customer',
      'test@example.com',
      JSON.stringify({
        planName: 'Пилот',
        planCadence: 'monthly',
        specialization: 'IT, Software Development',
        city: 'Москва',
        includeKeywords: ['разработчик', 'инженер', 'менеджер'],
        excludeKeywords: ['стажер', 'volunteer'],
        dailyDigestLimit: 10,
        comment: null,
        pilotApplicationId: null,
        clientProfileId: null,
        onboardingStatus: 'inactive',
        onboardingStep: 'confirm-profile',
        onboardingActivatedAt: null,
        onboardingCompletedAt: null,
        onboardingTestDigestSentAt: null,
        onboardingTestDigestTelegramMessageId: null,
        customerDigestLastSentAt: null,
        customerDigestLastEmptyAt: null,
        customerDigestLastFailedAt: null,
        paymentMessage: null,
        paymentProviderPayload: null
      })
    ]);

    const orderId = orderResult.rows[0].id;
    console.log(`📦 Created checkout order ID: ${orderId}`);

    // 3. Check if order creates client_profile
    const profileResult = await client.query(`
      SELECT * FROM client_profiles
      WHERE agency_name = $1
      LIMIT 1
    `, ['Test Customer']);

    if (profileResult.rows.length > 0) {
      const profile = profileResult.rows[0];
      console.log(`👤 Client profile found: ID ${profile.id}`);
      console.log(`   - Telegram chat ID: ${profile.telegram_chat_id || 'Not set'}`);
      console.log(`   - Specialization: ${profile.specialization || 'Not set'}`);
      console.log(`   - Daily digest limit: ${profile.daily_digest_limit}`);
    } else {
      console.log('⚠️  No client profile found for this order');
    }

    // 4. Test creating client_profile from checkout
    console.log('\n🔄 Creating client_profile from checkout...');

    await client.query(`
      INSERT INTO client_profiles (
        agency_name, telegram_chat_id, target_city, specialization,
        include_keywords, exclude_keywords, daily_digest_limit, is_active,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, true,
        NOW(), NOW()
      )
          `, [
      'Test Customer from Checkout',
      null, // Telegram chat ID not set yet
      'Москва',
      'IT, Software Development',
      '["разработчик", "инженер", "менеджер"]',
      '["стажер", "volunteer"]',
      10
    ]);

    const newProfileResult = await client.query(`
      SELECT id FROM client_profiles
      WHERE agency_name = $1
      ORDER BY created_at DESC LIMIT 1
    `, ['Test Customer from Checkout']);

    if (newProfileResult.rows.length > 0) {
      const newClientId = newProfileResult.rows[0].id;
      console.log(`✅ Created client_profile ID: ${newClientId}`);

      // 5. Update checkout order with client_profile_id
      await client.query(`
        UPDATE checkout_orders
        SET payload = jsonb_set(
          payload,
          '{clientProfileId}',
          $1::jsonb
        )
        WHERE id = $2
      `, [String(newClientId), orderId]);

      console.log(`✅ Linked client_profile to order`);
    }

    console.log('\n🎉 Checkout flow test completed!');
    console.log('\n📝 Next steps:');
    console.log('1. Implement Telegram connect token issuance');
    console.log('2. Test linking client_profile to Telegram');
    console.log('3. Verify digest delivery after onboarding');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();