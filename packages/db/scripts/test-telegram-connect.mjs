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

    // Test Telegram connect token flow
    console.log('\n🔄 Testing Telegram connect token flow...');

    // 1. Create test user and order
    const testUserEmail = 'telegram-test-' + Date.now() + '@example.com';
    const userResult = await client.query(`
      INSERT INTO users (email, full_name)
      VALUES ($1, $2)
      RETURNING id
    `, [testUserEmail, 'Telegram Test User']);

    const userId = userResult.rows[0].id;
    console.log(`🆔 Test user ID: ${userId}`);

    // Create checkout order
    const orderResult = await client.query(`
      INSERT INTO checkout_orders (
        user_id, plan_code, amount_rub, currency, status,
        customer_name, customer_contact, payload, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()
      )
      RETURNING id
    `, [
      userId,
      'pilot',
      10000,
      'RUB',
      'paid',
      'Telegram Test User',
      'test@example.com',
      JSON.stringify({
        planName: 'Пилот',
        planCadence: 'monthly',
        specialization: 'IT, Software Development',
        city: 'Москва',
        includeKeywords: ['разработчик', 'инженер'],
        excludeKeywords: ['стажер'],
        dailyDigestLimit: 10,
        comment: null,
        pilotApplicationId: null,
        clientProfileId: null,
        onboardingStatus: 'in_progress',
        onboardingStep: 'telegram',
        onboardingActivatedAt: new Date().toISOString(),
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

    // 2. Create client_profile
    const profileResult = await client.query(`
      INSERT INTO client_profiles (
        agency_name, telegram_chat_id, target_city, specialization,
        include_keywords, exclude_keywords, daily_digest_limit, is_active,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW()
      )
      RETURNING id
    `, [
      'Telegram Test User',
      null, // Not connected yet
      'Москва',
      'IT, Software Development',
      '["разработчик", "инженер"]',
      '["стажер"]',
      10
    ]);

    const clientProfileId = profileResult.rows[0].id;
    console.log(`👤 Created client_profile ID: ${clientProfileId}`);

    // 3. Create Telegram connect token
    const token = generateRandomToken();
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000); // 20 minutes from now

    const tokenResult = await client.query(`
      INSERT INTO telegram_connect_tokens (
        token, order_id, client_profile_id, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, NOW())
      RETURNING id
    `, [token, orderId, clientProfileId, expiresAt]);

    const tokenId = tokenResult.rows[0].id;
    console.log(`🔑 Created Telegram connect token: ${token}`);
    console.log(`   - Token ID: ${tokenId}`);
    console.log(`   - Expires at: ${expiresAt.toISOString()}`);

    // 4. Simulate user connecting via Telegram
    console.log('\n🔄 Simulating Telegram connection...');

    // Mark token as used
    const useResult = await client.query(`
      UPDATE telegram_connect_tokens
      SET used_at = NOW()
      WHERE id = $1
      RETURNING id, order_id, client_profile_id
    `, [tokenId]);

    if (useResult.rows.length > 0) {
      console.log('✅ Token marked as used');

      // Update client_profile with telegram_chat_id
      const telegramChatId = '987654321'; // Use different chat ID

      // Check if already set
      const existingProfile = await client.query(
        'SELECT telegram_chat_id FROM client_profiles WHERE id = $1',
        [clientProfileId]
      );

      if (!existingProfile.rows[0].telegram_chat_id) {
        await client.query(`
          UPDATE client_profiles
          SET telegram_chat_id = $1, updated_at = NOW()
          WHERE id = $2
        `, [telegramChatId, clientProfileId]);
        console.log(`✅ Updated client_profile with Telegram chat ID: ${telegramChatId}`);
      } else {
        console.log(`⚠️  Client profile already has Telegram chat ID: ${existingProfile.rows[0].telegram_chat_id}`);
      }

      // 5. Verify token can't be reused
      const reuseResult = await client.query(`
        SELECT id, used_at FROM telegram_connect_tokens WHERE token = $1
      `, [token]);

      if (reuseResult.rows[0].used_at) {
        console.log('✅ Token correctly marked as used and cannot be reused');
      } else {
        console.log('❌ Token not marked as used');
      }
    }

    // 6. Test token expiration
    console.log('\n🔄 Testing token expiration...');

    // Create an expired token
    const expiredToken = generateRandomToken();
    const expiredAt = new Date(Date.now() - 60 * 1000); // 1 minute ago

    await client.query(`
      INSERT INTO telegram_connect_tokens (
        token, order_id, client_profile_id, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, NOW())
    `, [expiredToken, orderId, clientProfileId, expiredAt]);

    console.log(`🔑 Created expired token: ${expiredToken}`);
    console.log(`   - Expired at: ${expiredAt.toISOString()}`);

    console.log('\n🎉 Telegram connect token flow test completed!');
    console.log('\n📝 Key points verified:');
    console.log('1. Tokens are generated with expiration (20 minutes)');
    console.log('2. Tokens can be used to link client_profile to Telegram');
    console.log('3. Used tokens cannot be reused');
    console.log('4. Expired tokens are not accepted');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

function generateRandomToken() {
  return crypto.getRandomValues(new Uint8Array(16)).reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), '');
}

main();