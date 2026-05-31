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

// Test data
const testData = {
  orgs: [
    {
      name: 'Яндекс',
      domain: 'yandex.ru',
      website_url: 'https://yandex.ru'
    },
    {
      name: 'VK',
      domain: 'vk.com',
      website_url: 'https://vk.com'
    },
    {
      name: 'Сбер',
      domain: 'sber.ru',
      website_url: 'https://sber.ru'
    },
    {
      name: 'Тинькофф',
      domain: 'tinkoff.ru',
      website_url: 'https://tinkoff.ru'
    },
    {
      name: 'Ozon',
      domain: 'ozon.ru',
      website_url: 'https://ozon.ru'
    }
  ],
  signals: [
    {
      signal_type: 'job_posting',
      source: 'hh',
      external_id: '12345',
      headline: 'Senior Backend Developer (Python/Django)',
      summary: 'Backend разработчик с опытом в Python и Django для работы над крупными проектами',
      source_url: 'https://hh.ru/vacancy/12345',
      payload: {
        vacancy_id: '12345',
        name: 'Senior Backend Developer (Python/Django)',
        employer: { name: 'Яндекс', id: '123' },
        area: { name: 'Москва', id: '1' },
        salary: { from: 250000, to: 350000, currency: 'RUB' },
        experience: { id: 'between3And6', name: '3–6 лет' },
        employment: { id: 'full', name: 'Полная занятость' },
        schedule: { id: 'fullDay', name: 'Полный день' },
        published_at: Date.now() - 86400000, // 1 day ago
        created_at: Date.now()
      }
    },
    {
      signal_type: 'job_posting',
      source: 'hh',
      external_id: '12346',
      headline: 'Middle Frontend Developer (React)',
      summary: 'Frontend разработчик с React для создания пользовательских интерфейсов',
      source_url: 'https://hh.ru/vacancy/12346',
      payload: {
        vacancy_id: '12346',
        name: 'Middle Frontend Developer (React)',
        employer: { name: 'VK', id: '456' },
        area: { name: 'Москва', id: '1' },
        salary: { from: 150000, to: 200000, currency: 'RUB' },
        experience: { id: 'between1And3', name: '1–3 года' },
        employment: { id: 'full', name: 'Полная занятость' },
        schedule: { id: 'fullDay', name: 'Полный день' },
        published_at: Date.now() - 172800000, // 2 days ago
        created_at: Date.now()
      }
    },
    {
      signal_type: 'job_posting',
      source: 'hh',
      external_id: '12347',
      headline: 'Data Scientist',
      summary: 'Вакансия для Data Scientist с опытом работы с большими данными',
      source_url: 'https://hh.ru/vacancy/12347',
      payload: {
        vacancy_id: '12347',
        name: 'Data Scientist',
        employer: { name: 'Сбер', id: '789' },
        area: { name: 'Москва', id: '1' },
        salary: { from: 300000, to: 450000, currency: 'RUB' },
        experience: { id: 'between3And6', name: '3–6 лет' },
        employment: { id: 'full', name: 'Полная занятость' },
        schedule: { id: 'fullDay', name: 'Полный день' },
        published_at: Date.now() - 259200000, // 3 days ago
        created_at: Date.now()
      }
    },
    {
      signal_type: 'job_posting',
      source: 'hh',
      external_id: '12348',
      headline: 'DevOps Engineer',
      summary: 'DevOps Engineer для автоматизации процессов развертывания',
      source_url: 'https://hh.ru/vacancy/12348',
      payload: {
        vacancy_id: '12348',
        name: 'DevOps Engineer',
        employer: { name: 'Тинькофф', id: '101' },
        area: { name: 'Москва', id: '1' },
        salary: { from: 200000, to: 300000, currency: 'RUB' },
        experience: { id: 'between1And3', name: '1–3 года' },
        employment: { id: 'full', name: 'Полная занятость' },
        schedule: { id: 'fullDay', name: 'Полный день' },
        published_at: Date.now() - 345600000, // 4 days ago
        created_at: Date.now()
      }
    },
    {
      signal_type: 'job_posting',
      source: 'hh',
      external_id: '12349',
      headline: 'Product Manager',
      summary: 'Product Manager для управления продуктовым направлением',
      source_url: 'https://hh.ru/vacancy/12349',
      payload: {
        vacancy_id: '12349',
        name: 'Product Manager',
        employer: { name: 'Ozon', id: '102' },
        area: { name: 'Москва', id: '1' },
        salary: { from: 250000, to: 400000, currency: 'RUB' },
        experience: { id: 'between3And6', name: '3–6 лет' },
        employment: { id: 'full', name: 'Полная занятость' },
        schedule: { id: 'fullDay', name: 'Полный день' },
        published_at: Date.now() - 432000000, // 5 days ago
        created_at: Date.now()
      }
    }
  ]
};

async function main() {
  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Insert test orgs
    for (const org of testData.orgs) {
      const existing = await client.query(
        'SELECT id FROM orgs WHERE domain = $1',
        [org.domain]
      );

      if (!existing.rows.length) {
        await client.query(`
          INSERT INTO orgs (name, domain, website_url)
          VALUES ($1, $2, $3)
        `, [
          org.name,
          org.domain,
          org.website_url
        ]);
        console.log(`✅ Inserted org: ${org.name}`);
      } else {
        console.log(`⏭️  Org already exists: ${org.name}`);
      }
    }

    // Get org IDs
    const orgIds = {};
    for (const org of testData.orgs) {
      const result = await client.query(
        'SELECT id FROM orgs WHERE domain = $1',
        [org.domain]
      );
      orgIds[org.name] = result.rows[0].id;
    }

    // Insert test signals
    for (const signal of testData.signals) {
      const orgId = orgIds[signal.payload.employer.name];
      if (!orgId) {
        console.log(`❌ Missing org ID for: ${signal.payload.employer.name}`);
        continue;
      }

      await client.query(`
        INSERT INTO signals (
          source, signal_type, external_id, headline, summary, source_url,
          payload, org_id, occurred_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (source, external_id) DO NOTHING
      `, [
        signal.source,
        signal.signal_type,
        signal.external_id,
        signal.headline,
        signal.summary,
        signal.source_url,
        JSON.stringify(signal.payload),
        orgId,
        new Date(signal.payload.published_at),
        new Date(signal.payload.created_at),
        new Date()
      ]);
      console.log(`✅ Inserted signal: ${signal.headline}`);
    }

    // Create org_source_refs
    for (const org of testData.orgs) {
      const orgId = orgIds[org.name];
      if (!orgId) continue;

      await client.query(`
        INSERT INTO org_source_refs (org_id, source, source_key, display_name, metadata, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        ON CONFLICT (source, source_key) DO NOTHING
      `, [
        orgId,
        'hh',
        org.domain,
        org.name,
        JSON.stringify({ type: 'employer', id: org.payload?.employer?.id || org.name.toLowerCase() })
      ]);
      console.log(`✅ Created org_source_ref for: ${org.name}`);
    }

    console.log('\n🚀 Test HH data generated successfully!');

  } catch (error) {
    console.error('❌ Error generating test data:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();