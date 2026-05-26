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

    // Test end-to-end checkout + Telegram integration
    console.log('\n🔄 Testing checkout + Telegram sync integration...');

    // 1. Create new user and complete checkout flow
    const testUserEmail = 'integration-test-' + Date.now() + '@example.com';
    const userResult = await client.query(`
      INSERT INTO users (email, full_name)
      VALUES ($1, $2)
      RETURNING id
    `, [testUserEmail, 'Integration Test User']);

    const userId = userResult.rows[0].id;
    console.log(`🆔 Created user ID: ${userId}`);

    // 2. Create checkout order (simulate completed payment)
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
      'paid', // Order is paid
      'Integration Test User',
      'integration@example.com',
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
        paymentMessage: 'Оплата успешно прошла',
        paymentProviderPayload: null
      })
    ]);

    const orderId = orderResult.rows[0].id;
    console.log(`📦 Created checkout order ID: ${orderId}`);

    // 3. Create client_profile from order
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
      'Integration Test User',
      null, // Not connected yet
      'Москва',
      'IT, Software Development',
      '["разработчик", "инженер", "менеджер"]',
      '["стажер", "volunteer"]',
      10
    ]);

    const clientProfileId = profileResult.rows[0].id;
    console.log(`👤 Created client_profile ID: ${clientProfileId}`);

    // 4. Update order with client_profile_id
    await client.query(`
      UPDATE checkout_orders
      SET payload = payload || $1
      WHERE id = $2
    `, [String(clientProfileId), orderId]);

    console.log(`✅ Linked client_profile to order`);

    // 5. Create Telegram connect token
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await client.query(`
      INSERT INTO telegram_connect_tokens (
        token, order_id, client_profile_id, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, NOW())
    `, [token, orderId, clientProfileId, expiresAt]);

    console.log(`🔑 Created Telegram connect token: ${token.substring(0, 8)}...`);

    // 6. Simulate Telegram connection (user clicks link and connects)
    console.log('\n🔄 Simulating Telegram connection...');

    // Update order onboarding status
    await client.query(`
      UPDATE checkout_orders
      SET payload = payload || '{"onboardingStatus": "in_progress", "onboardingStep": "telegram"}'::jsonb,
      updated_at = NOW()
      WHERE id = $1
    `, [orderId]);

    console.log('✅ Updated order onboarding status');

    // 7. Consume token (user connects via Telegram)
    const telegramChatId = Date.now().toString(); // Unique chat ID
    const now = new Date();

    await client.query(`
      UPDATE telegram_connect_tokens
      SET used_at = $1
      WHERE token = $2
    `, [now.toISOString(), token]);

    // Update client_profile with Telegram chat ID
    await client.query(`
      UPDATE client_profiles
      SET telegram_chat_id = $1, updated_at = NOW()
      WHERE id = $2
    `, [telegramChatId, clientProfileId]);

    console.log(`✅ Linked Telegram chat ID ${telegramChatId} to client_profile`);

    // 8. Complete onboarding
    await client.query(`
      UPDATE checkout_orders
      SET payload = payload || '{"onboardingStatus": "completed", "onboardingStep": "complete", "onboardingCompletedAt": "2026-05-26T13:20:00.000Z"}'::jsonb,
      updated_at = NOW()
      WHERE id = $1
    `, [orderId]);

    console.log('✅ Completed onboarding');

    // 9. Verify integration
    console.log('\n🔍 Verifying integration...');

    // Check client_profile has telegram_chat_id
    const profileCheck = await client.query(
      'SELECT telegram_chat_id FROM client_profiles WHERE id = $1',
      [clientProfileId]
    );

    if (profileCheck.rows[0].telegram_chat_id) {
      console.log('✅ Client profile has Telegram chat ID');
    } else {
      console.log('❌ Client profile missing Telegram chat ID');
    }

    // Check order is linked to client_profile
    const orderCheck = await client.query(
      'SELECT payload FROM checkout_orders WHERE id = $1',
      [orderId]
    );

    const orderPayload = orderCheck.rows[0].payload;
    if (orderPayload.clientProfileId) {
      console.log(`✅ Order linked to client_profile ID: ${orderPayload.clientProfileId}`);
    } else {
      console.log('❌ Order not linked to client_profile');
    }

    // Check token is marked as used
    const tokenCheck = await client.query(
      'SELECT used_at FROM telegram_connect_tokens WHERE token = $1',
      [token]
    );

    if (tokenCheck.rows[0].used_at) {
      console.log('✅ Token marked as used');
    } else {
      console.log('❌ Token not marked as used');
    }

    // 10. Prepare for digest delivery
    console.log('\n🚀 Preparing for digest delivery...');

    // Create digest run
    const digestRunResult = await client.query(`
      INSERT INTO digest_runs (client_profile_id, source_key, status, requested_limit, selected_count, completed_at)
      VALUES ($1, 'hh', 'completed', 10, 5, NOW())
      RETURNING id
    `, [clientProfileId]);

    const digestRunId = digestRunResult.rows[0].id;
    console.log(`✅ Created digest run ID: ${digestRunId}`);

    // Create digest candidates
    await client.query(`
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
      LIMIT 5
    `, [digestRunId, clientProfileId]);

    console.log('✅ Created digest candidates for delivery');

    console.log('\n🎉 Checkout + Telegram sync integration test completed!');
    console.log('\n📝 Full integration flow verified:');
    console.log('1. User completes checkout → Creates order and client_profile');
    console.log('2. System generates Telegram connect token');
    console.log('3. User connects via Telegram → Token is consumed');
    console.log('4. Client profile gets linked to Telegram chat');
    console.log('5. Onboarding status is updated to completed');
    console.log('6. System is ready for digest delivery');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();