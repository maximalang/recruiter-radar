import { execFile, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { get as httpsGet } from 'node:https'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

import pg from 'pg'
import { chromium } from 'playwright'

const { Client } = pg
const execFileAsync = promisify(execFile)
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.')
}
if (process.env.AUTH_V2_DISPOSABLE_DB_CONFIRMED !== 'true') {
  throw new Error(
    'AUTH_V2_DISPOSABLE_DB_CONFIRMED=true is required before creating a disposable database.',
  )
}

const root = resolve(import.meta.dirname, '..', '..', '..')
const webRoot = resolve(root, 'apps', 'web')
const migrateScript = resolve(root, 'packages', 'db', 'scripts', 'migrate.mjs')
const iconGenerationScript = resolve(webRoot, 'scripts', 'generate-app-icons.mjs')
const nextScript = resolve(root, 'node_modules', 'next', 'dist', 'bin', 'next')
const artifactsDirectory = resolve(webRoot, 'scripts')
const e2eDistName = `.next-auth-v2-e2e-${process.pid}`
const e2eDistDirectory = resolve(webRoot, e2eDistName)
const e2eTsconfigName = `.auth-v2-e2e-tsconfig-${process.pid}.json`
const e2eTsconfigPath = resolve(webRoot, e2eTsconfigName)
const sourceTsconfigPath = resolve(webRoot, 'tsconfig.json')
const nextEnvPath = resolve(webRoot, 'next-env.d.ts')
const reportPath = resolve(
  artifactsDirectory,
  'auth-v2-account-team-e2e-report.json',
)
const databaseName =
  `auth_v2_e2e_account_team_${process.pid}_${Date.now()}`
const temporaryUrl = new URL(databaseUrl)
temporaryUrl.pathname = `/${databaseName}`
temporaryUrl.searchParams.delete('schema')

const outboxDirectory = await mkdtemp(
  join(tmpdir(), 'rr-auth-v2-account-team-e2e-'),
)
const outboxPath = join(outboxDirectory, 'outbox.json')
const httpsKeyPath = join(outboxDirectory, 'localhost-key.pem')
const httpsCertPath = join(outboxDirectory, 'localhost-cert.pem')
const admin = new Client({ connectionString: databaseUrl })
let database = null
let databaseCreated = false
let browser = null
let webServer = null
let webServerPort = null
let webServerListenerPid = null
let failure = null
let originalNextEnv = null
const serverOutput = []
const report = {
  database: databaseName,
  browser: 'isolated Playwright Chromium',
  consoleFindings: [],
  networkFindings: [],
  expectedBrowserEvents: [],
  accessibility: {},
  responsive: {},
  flows: {},
  screenshots: {},
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertSafeE2EDistDirectory() {
  assert(
    relative(webRoot, e2eDistDirectory) === e2eDistName,
    'Refusing to remove an E2E cache outside apps/web.',
  )
}

function assertSafeOutboxDirectory() {
  const relativePath = relative(tmpdir(), outboxDirectory)
  assert(
    relativePath.startsWith('rr-auth-v2-account-team-e2e-')
      && !relativePath.includes('/')
      && !relativePath.includes('\\'),
    'Refusing to remove an E2E outbox outside the system temp directory.',
  )
}

function recordCleanupFailure(error) {
  if (failure) return
  failure = error
  report.result = 'failed'
  report.failure = error instanceof Error ? error.message : String(error)
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function opaqueToken() {
  return randomBytes(32).toString('hex')
}

async function freePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert(
    address && typeof address === 'object',
    'Failed to reserve a local browser-test port.',
  )
  await new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose())
  })
  return address.port
}

async function run(command, args, environment) {
  const result = await execFileAsync(command, args, {
    cwd: root,
    env: environment,
    maxBuffer: 20 * 1024 * 1024,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

async function createHttpsCertificate() {
  const configured = process.env.OPENSSL_PATH?.trim()
  const candidates = [
    configured || null,
    'openssl',
    ...(process.platform === 'win32'
      ? [
        'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
        'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
      ]
      : []),
  ].filter(Boolean)
  let lastError = null
  for (const candidate of candidates) {
    try {
      await execFileAsync(
        candidate,
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-sha256',
          '-nodes',
          '-keyout',
          httpsKeyPath,
          '-out',
          httpsCertPath,
          '-days',
          '1',
          '-subj',
          '/CN=127.0.0.1',
          '-addext',
          'subjectAltName=IP:127.0.0.1,DNS:localhost',
        ],
        { windowsHide: true, maxBuffer: 1024 * 1024 },
      )
      return
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(
    `OpenSSL is required for the local HTTPS browser gate: ${
      lastError instanceof Error ? lastError.message : 'not found'
    }`,
  )
}

async function createUser(prefix) {
  const email = `${prefix}-${process.pid}-${Date.now()}@example.invalid`
  const result = await database.query(
    `INSERT INTO users (
       email,
       email_normalized,
       email_verified_at,
       display_name,
       created_at,
       updated_at,
       last_authenticated_at
     )
     VALUES ($1, $1, NOW(), $2, NOW(), NOW(), NOW())
     RETURNING id::TEXT AS id`,
    [email, `${prefix} account`],
  )
  const userId = result.rows[0]?.id
  assert(userId, `Failed to create ${prefix} user fixture.`)
  const workspaceResult = await database.query(
    'SELECT ensure_auth_user_workspace($1)::TEXT AS id',
    [userId],
  )
  const workspaceId = workspaceResult.rows[0]?.id
  assert(workspaceId, `Failed to create ${prefix} workspace fixture.`)
  return { email, userId, workspaceId }
}

async function createSession(user, labels) {
  const token = opaqueToken()
  const result = await database.query(
    `INSERT INTO auth_sessions (
       user_id,
       workspace_id,
       token_hash,
       auth_method,
       device_label,
       browser_label,
       environment_label,
       created_at,
       last_seen_at,
       idle_expires_at,
       absolute_expires_at,
       rotated_at,
       last_authenticated_at
     )
     VALUES (
       $1,
       $2,
       $3,
       'magic_link',
       $4,
       $5,
       $6,
       NOW() - INTERVAL '2 minutes',
       NOW() - INTERVAL '1 minute',
       NOW() + INTERVAL '13 days',
       NOW() + INTERVAL '29 days',
       NOW() - INTERVAL '1 minute',
       NOW() - INTERVAL '1 minute'
     )
     RETURNING id::TEXT AS id`,
    [
      user.userId,
      user.workspaceId,
      hashToken(token),
      labels.device,
      labels.browser,
      labels.environment,
    ],
  )
  const id = result.rows[0]?.id
  assert(id, `Failed to create session for ${user.email}.`)
  return { id, token }
}

async function seedProductSurfaceFixtures(owner) {
  await database.query(
    `UPDATE users
     SET onboarding_status = 'completed', onboarding_step = 'complete',
         onboarding_data = '{}'::JSONB, updated_at = NOW()
     WHERE id = $1`,
    [owner.userId],
  )
  await database.query(
    `INSERT INTO entitlement_grants (
       user_id, workspace_id, entitlement_owner_id, source, plan_code,
       features, starts_at, ends_at
     ) VALUES (
       $1, $2, $1, 'promo', 'authenticated-browser-fixture',
       ARRAY['dashboard','api','digest','delivery'],
       NOW() - INTERVAL '1 day', NOW() + INTERVAL '1 day'
     )`,
    [owner.userId, owner.workspaceId],
  )
  const profile = await database.query(
    `INSERT INTO client_profiles (
       owner_id, agency_name, target_city, specialization, daily_digest_limit
     )
     VALUES ($1, 'Signal Bureau', 'Москва', 'IT и продуктовый подбор', 5)
     RETURNING id::TEXT AS id`,
    [owner.userId],
  )
  const organization = await database.query(
    `INSERT INTO orgs (name, domain, website_url, career_page_url)
     VALUES (
       'Тестовая продуктовая компания',
       'product-browser-fixture.example.invalid',
       'https://product-browser-fixture.example.invalid',
       'https://product-browser-fixture.example.invalid/careers'
     )
     RETURNING id::TEXT AS id`,
  )
  const profileId = profile.rows[0].id
  const organizationId = organization.rows[0].id
  const digestRun = await database.query(
    `INSERT INTO digest_runs (
       client_profile_id, source_key, status, requested_limit,
       selected_count, cooldown_days, completed_at
     )
     VALUES ($1, 'authenticated-browser-fixture', 'completed', 5, 1, 3, NOW())
     RETURNING id::TEXT AS id`,
    [profileId],
  )
  const candidate = await database.query(
    `INSERT INTO digest_candidates (
       digest_run_id, client_profile_id, org_id, source_external_id,
       source_display_name, source_families, vacancies_count,
       distinct_vacancy_names_count, latest_published_at, total_score,
       reasons, opener, payload, lead_confidence, next_action_kind,
       next_action_hint
     )
     VALUES (
       $1, $2, $3, 'browser-fixture-company',
       'Тестовая продуктовая компания', '["career-pages","hh"]'::JSONB,
       3, 2, NOW() - INTERVAL '2 hours', 87,
       '["Рост продуктовой команды","Повторный найм"]'::JSONB,
       'Предложить точечный подбор продуктовой команды.',
       '{"confidenceGate":"A","locationNames":["Москва"],"evidenceTitles":["Открыты продуктовые вакансии"]}'::JSONB,
       'high', 'outreach', 'Проверить корпоративную форму и подготовить черновик.'
     )
     RETURNING id::TEXT AS id`,
    [digestRun.rows[0].id, profileId, organizationId],
  )
  await database.query(
    `INSERT INTO client_digest_org_state (
       client_profile_id, org_id, last_digest_run_id,
       last_digest_candidate_id, last_digest_at, feedback_status,
       last_source_external_id, last_source_display_name
     )
     VALUES ($1, $2, $3, $4, NOW(), 'none', $5, $6)`,
    [
      profileId,
      organizationId,
      digestRun.rows[0].id,
      candidate.rows[0].id,
      'browser-fixture-company',
      'Тестовая продуктовая компания',
    ],
  )
  const evidence = await database.query(
    `INSERT INTO evidence_items (
       org_id, source, url, fetched_at, content_hash, tier, payload_ref
     )
     VALUES (
       $1, 'career-pages',
       'https://product-browser-fixture.example.invalid/careers/product',
       NOW() - INTERVAL '2 hours', repeat('7', 64), 'direct',
       '{"title":"Открыты вакансии продуктовой команды"}'::JSONB
     )
     RETURNING id::TEXT AS id`,
    [organizationId],
  )
  const identity = await database.query(
    `INSERT INTO organization_identity_profiles_v1 (
       workspace_id, organization_id, legal_name, brand, inn,
       primary_domain, evidence_item_ids, resolution_confidence,
       resolution_basis
     ) VALUES (
       $1, $2, 'ООО Тестовая продуктовая компания',
       'Тестовая продуктовая компания', '7701234567',
       'product-browser-fixture.example.invalid', ARRAY[$3::BIGINT], .98,
       '{"method":"inn+domain"}'::JSONB
     ) RETURNING id::TEXT AS id`,
    [owner.workspaceId, organizationId, evidence.rows[0].id],
  )
  const location = await database.query(
    `INSERT INTO organization_locations_v1 (
       workspace_id, organization_id, location_type,
       federal_subject_code, federal_subject_name, city, address,
       latitude, longitude, geo_confidence, evidence_item_ids,
       location_fingerprint
     ) VALUES (
       $1, $2, 'head_office', '77', 'Москва', 'Москва',
       'Москва, тестовый адрес', 55.7558, 37.6173, .99,
       ARRAY[$3::BIGINT], repeat('d', 64)
     ) RETURNING id::TEXT AS id`,
    [owner.workspaceId, organizationId, evidence.rows[0].id],
  )
  await database.query(
    `UPDATE organization_identity_profiles_v1
     SET head_office_location_id = $1
     WHERE id = $2`,
    [location.rows[0].id, identity.rows[0].id],
  )
  await database.query(
    `INSERT INTO source_registry_reviews_v1 (
       source_registry_id, review_status, terms_reference,
       reviewer_reference, notes, reviewed_at
     ) VALUES
       (
         'official-company-news', 'approved',
         'https://product-browser-fixture.example.invalid/terms',
         'runtime:authenticated-browser-fixture',
         'Isolated browser fixture only.', NOW()
       ),
       (
         'headhunter-api', 'approved',
         'https://api.hh.ru/openapi/redoc',
         'runtime:authenticated-browser-fixture',
         'Isolated browser fixture only.', NOW()
       )`,
  )
  const radarEvent = await database.query(
    `INSERT INTO evidence_events_v1 (
       workspace_id, organization_id, location_id, event_type,
       source_registry_id, source_family, canonical_url,
       occurred_at, detected_at, facts, confidence,
       independent_confirmations, valid_until, polarity,
       verification_status, primary_source, content_fingerprint,
       event_fingerprint
     ) VALUES (
       $1, $2, $3, 'funding_received', 'official-company-news',
       'official-news',
       'https://product-browser-fixture.example.invalid/news/funding',
       NOW() - INTERVAL '1 day', NOW(), '{"funding":"confirmed"}'::JSONB,
       .92, 1, NOW() + INTERVAL '21 days', 'positive', 'verified', TRUE,
       repeat('e', 64), repeat('f', 64)
     ) RETURNING id::TEXT AS id`,
    [owner.workspaceId, organizationId, location.rows[0].id],
  )
  const radarHiringEvent = await database.query(
    `INSERT INTO evidence_events_v1 (
       workspace_id, organization_id, location_id, event_type,
       source_registry_id, source_family, canonical_url,
       occurred_at, detected_at, facts, confidence,
       independent_confirmations, valid_until, polarity,
       verification_status, primary_source, content_fingerprint,
       event_fingerprint
     ) VALUES (
       $1, $2, $3, 'hiring_growth', 'headhunter-api', 'hh',
       'https://hh.example.invalid/browser-fixture',
       NOW() - INTERVAL '12 hours', NOW(), '{"vacancies":3}'::JSONB,
       .9, 1, NOW() + INTERVAL '21 days', 'positive', 'verified', FALSE,
       repeat('5', 64), repeat('6', 64)
     ) RETURNING id::TEXT AS id`,
    [owner.workspaceId, organizationId, location.rows[0].id],
  )
  const radarSignal = await database.query(
    `INSERT INTO normalized_signals_v1 (
       workspace_id, organization_id, signal_type, started_at,
       last_seen_at, valid_until, confidence, strength,
       source_families, affected_functions, region_code, city,
       polarity, input_hash, signal_fingerprint
     ) VALUES (
       $1, $2, 'funding_received', NOW() - INTERVAL '2 days', NOW(),
       NOW() + INTERVAL '21 days', .92, .86, ARRAY['official-news'],
       ARRAY['product','engineering'], '77', 'Москва', 'positive',
       repeat('1', 64), repeat('2', 64)
     ) RETURNING id::TEXT AS id`,
    [owner.workspaceId, organizationId],
  )
  const radarHiringSignal = await database.query(
    `INSERT INTO normalized_signals_v1 (
       workspace_id, organization_id, signal_type, started_at,
       last_seen_at, valid_until, confidence, strength,
       source_families, affected_functions, region_code, city,
       polarity, input_hash, signal_fingerprint
     ) VALUES (
       $1, $2, 'hiring_growth', NOW() - INTERVAL '1 day', NOW(),
       NOW() + INTERVAL '21 days', .9, .84, ARRAY['hh'],
       ARRAY['product','engineering'], '77', 'Москва', 'positive',
       repeat('7', 64), repeat('8', 64)
     ) RETURNING id::TEXT AS id`,
    [owner.workspaceId, organizationId],
  )
  await database.query(
    `INSERT INTO normalized_signal_event_links_v1 (
       signal_id, evidence_event_id, workspace_id, organization_id
     ) VALUES
       ($1, $2, $5, $6),
       ($3, $4, $5, $6)`,
    [
      radarSignal.rows[0].id,
      radarEvent.rows[0].id,
      radarHiringSignal.rows[0].id,
      radarHiringEvent.rows[0].id,
      owner.workspaceId,
      organizationId,
    ],
  )
  const radarCorrelation = await database.query(
    `INSERT INTO evidence_correlations_v1 (
       workspace_id, organization_id, rule_id, signal_ids,
       source_families, window_days, intent_boost, explanation,
       input_hash, correlation_fingerprint, valid_until
     ) VALUES (
       $1, $2, 'funding-hiring-recruiter', ARRAY[$3::BIGINT,$4::BIGINT],
       ARRAY['hh','official-news'], 60, .12,
       'Funding is followed by direct hiring growth from an independent source.',
       repeat('9', 64), repeat('a', 64), NOW() + INTERVAL '21 days'
     ) RETURNING id::TEXT AS id`,
    [
      owner.workspaceId,
      organizationId,
      radarSignal.rows[0].id,
      radarHiringSignal.rows[0].id,
    ],
  )
  const radarComponents = {
    hiringIntent: .9,
    confidence: .9,
    freshness: .9,
    urgency: .8,
    commercialFit: .9,
    contactability: .8,
    risk: .05,
  }
  const radarOpportunityScore = Object.values(radarComponents)
    .slice(0, 6)
    .reduce((value, component) => value * component, 100)
  const radarLeadScore = radarOpportunityScore - radarComponents.risk * 35
  const radarScore = await database.query(
    `INSERT INTO evidence_lead_score_snapshots_v1 (
       workspace_id, organization_id, lead_score, opportunity_score,
       confidence_score, urgency_score, contactability_score, risk_score,
       components, contributions, source_event_ids, source_signal_ids,
       source_correlation_ids, independent_source_families,
       input_hash, valid_until
     ) VALUES (
       $1, $2, $3, $4, 90, 80, 80, 5, $5::JSONB, $6::JSONB,
       ARRAY[$7::BIGINT,$8::BIGINT], ARRAY[$9::BIGINT,$10::BIGINT],
       ARRAY[$11::BIGINT], ARRAY['hh','official-news'],
       repeat('3', 64), NOW() + INTERVAL '21 days'
     ) RETURNING id::TEXT AS id`,
    [
      owner.workspaceId,
      organizationId,
      radarLeadScore,
      radarOpportunityScore,
      JSON.stringify(radarComponents),
      JSON.stringify([{
        eventId: radarEvent.rows[0].id,
        component: 'hiring_intent',
        delta: .2,
        reason: 'verified company funding evidence',
      }]),
      radarEvent.rows[0].id,
      radarHiringEvent.rows[0].id,
      radarSignal.rows[0].id,
      radarHiringSignal.rows[0].id,
      radarCorrelation.rows[0].id,
    ],
  )
  await database.query(
    `INSERT INTO evidence_lead_cards_v1 (
       workspace_id, organization_id, location_id, score_snapshot_id,
       status, title, why_now, staffing_need, specialization,
       recommended_contact_at, recommended_action, risk_reasons,
       evidence_event_ids, contact_path_ids, valid_until, card_fingerprint
     ) VALUES (
       $1, $2, $3, $4, 'qualified', 'Подтверждённый рост найма',
       'Свежий рост продуктовой команды подтверждён официальным источником.',
       '{"functions":["product","engineering"],"minHeadcount":3,"maxHeadcount":8,"mode":"targeted"}'::JSONB,
       'IT и продуктовый подбор', NOW() + INTERVAL '1 day',
       'Проверить карьерную страницу и подготовить точечный черновик.',
       ARRAY[]::TEXT[], ARRAY[$5::BIGINT,$6::BIGINT], ARRAY[]::BIGINT[],
       NOW() + INTERVAL '21 days', repeat('4', 64)
     )`,
    [
      owner.workspaceId,
      organizationId,
      location.rows[0].id,
      radarScore.rows[0].id,
      radarEvent.rows[0].id,
      radarHiringEvent.rows[0].id,
    ],
  )
  const episode = await database.query(
    `INSERT INTO hiring_episodes (
       organization_id, episode_type, episode_key, episode_identity,
       episode_generation, title, summary, started_at, last_seen_at,
       signal_count, vacancy_count, strength_score, freshness_score,
       evidence_hash, engine_version
     )
     VALUES (
       $1, 'role_cluster', 'authenticated-browser-fixture',
       'authenticated-browser-fixture', 1,
       'Рост продуктовой команды', 'Компания расширяет продуктовую команду.',
       NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 hours',
       1, 3, 0.86, 0.94, repeat('8', 64), 'browser-fixture-v1'
     )
     RETURNING id::TEXT AS id`,
    [organizationId],
  )
  await database.query(
    `INSERT INTO hiring_episode_evidence (
       hiring_episode_id, organization_id, evidence_id, relation_type
     ) VALUES ($1, $2, $3, 'source')`,
    [episode.rows[0].id, organizationId, evidence.rows[0].id],
  )
  const evidenceId = evidence.rows[0].id
  const conclusion = (text) => ({
    text,
    basis: 'evidence',
    evidenceIds: [evidenceId],
  })
  const commercialSignalCard = {
    version: 'commercial-signal-card-v1',
    scoreVersion: 'opportunity-v3',
    status: 'qualified_actionable',
    whatChanged: conclusion('Компания одновременно открыла несколько продуктовых ролей.'),
    whyNotOrdinaryHiring: conclusion('Набор охватывает несколько связанных ролей.'),
    whyAgency: conclusion('Серия вакансий создаёт потребность в дополнительной мощности подбора.'),
    whyThisAgency: conclusion('Профиль агентства совпадает с продуктовой специализацией.'),
    whyNow: conclusion('Вакансии опубликованы недавно и подтверждены карьерной страницей.'),
    metrics: {
      externalAgencyPropensity: { value: 0.78, reasonCodes: ['agency.need.capacity'] },
      agencyFit: { value: 0.91, reasonCodes: ['agency.fit.specialization'] },
      opportunityQuality: { value: 0.88, reasonCodes: ['opportunity.evidence.direct'] },
      actionability: { value: 0.84, reasonCodes: ['action.contact.corporate'] },
    },
    recommendedAction: conclusion('Открыть корпоративную форму и подготовить персональный черновик.'),
    constraints: [conclusion('Перед контактом перепроверить актуальность вакансий.')],
  }
  const opportunity = await database.query(
    `INSERT INTO opportunities (
       owner_id, client_profile_id, organization_id, hiring_episode_id,
       status, title, why_now, problem_hypothesis, recommended_angle,
       recommended_persona, recommended_action, agency_fit_score,
       hiring_intent_score, agency_propensity_score, timing_score,
       reachability_score, confidence_score, opportunity_score,
       confidence_gate, scoring_version, evidence_hash, valid_until,
       episode_evidence_hash, profile_snapshot_hash, fiur_version,
       scoring_config_hash, brief_builder_version, input_hash, metadata
     )
     VALUES (
       $1, $2, $3, $4, 'new', 'Расширение продуктовой команды',
       'Подтверждён свежий кластер вакансий.',
       'Внутренней команде может не хватать мощности подбора.',
       'Предложить точечную помощь по продуктовым ролям.',
       'Руководитель подбора', 'Подготовить персональный черновик.',
       0.91, 0.88, 0.78, 0.9, 0.82, 0.89, 0.87, 'A',
       'browser-fixture-v1', repeat('9', 64), NOW() + INTERVAL '7 days',
       repeat('9', 64), repeat('a', 64), 'fiur-v1', repeat('b', 64),
       'opportunity-brief-v1', repeat('c', 64), $5::JSONB
     )
     RETURNING id::TEXT AS id`,
    [
      owner.userId,
      profileId,
      organizationId,
      episode.rows[0].id,
      JSON.stringify({ commercialSignalCard, morningBriefEligible: true }),
    ],
  )
  return {
    candidateId: candidate.rows[0].id,
    opportunityId: opportunity.rows[0].id,
  }
}

async function seedFixtures() {
  const owner = await createUser('owner')
  const invited = await createUser('invited')
  const wrong = await createUser('wrong')
  const switcher = await createUser('switcher')
  const switchTarget = await createUser('switch-target')
  await database.query(
    `UPDATE workspaces
     SET name = 'Signal Bureau', updated_at = NOW()
     WHERE id = $1`,
    [owner.workspaceId],
  )
  await database.query(
    `UPDATE users
     SET
       onboarding_status = 'completed',
       onboarding_step = 'complete',
       onboarding_data = '{}'::JSONB,
       updated_at = NOW()
     WHERE id = $1`,
    [switchTarget.userId],
  )
  owner.session = await createSession(owner, {
    device: 'Owner workstation',
    browser: 'Chromium',
    environment: 'Windows 11',
  })
  owner.otherSession = await createSession(owner, {
    device: 'Owner phone',
    browser: 'Mobile browser',
    environment: 'Android',
  })
  invited.session = await createSession(invited, {
    device: 'Invitee workstation',
    browser: 'Chromium',
    environment: 'Linux',
  })
  wrong.session = await createSession(wrong, {
    device: 'Unrelated workstation',
    browser: 'Chromium',
    environment: 'Windows 11',
  })
  switcher.session = await createSession(switcher, {
    device: 'Account switch workstation',
    browser: 'Chromium',
    environment: 'Windows 11',
  })
  owner.productSurfaces = await seedProductSurfaceFixtures(owner)
  return { owner, invited, wrong, switcher, switchTarget }
}

async function waitForWebServer(baseUrl) {
  const deadline = Date.now() + 90_000
  let lastError = null
  while (Date.now() < deadline) {
    if (webServer && webServer.exitCode !== null) {
      throw new Error(
        `Next.js exited before readiness: ${serverOutput.slice(-5).join('')}`,
      )
    }
    try {
      const status = await new Promise((resolveStatus, reject) => {
        const request = httpsGet(
          `${baseUrl}/login`,
          { rejectUnauthorized: false },
          (response) => {
            response.resume()
            resolveStatus(response.statusCode ?? 0)
          },
        )
        request.setTimeout(5_000, () => {
          request.destroy(new Error('HTTPS readiness probe timed out.'))
        })
        request.once('error', reject)
      })
      if (status > 0 && status < 500) return
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }
  throw new Error(
    `Next.js did not become ready: ${
      lastError instanceof Error ? lastError.message : 'timeout'
    }`,
  )
}

async function findWindowsListenerPid(port) {
  if (process.platform !== 'win32' || !Number.isInteger(port)) return null
  const script = [
    `$connection = Get-NetTCPConnection -State Listen -LocalPort ${port}`,
    '-ErrorAction SilentlyContinue | Select-Object -First 1;',
    'if ($connection) { $connection.OwningProcess }',
  ].join(' ')
  const result = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, maxBuffer: 1024 * 1024 },
  ).catch(() => null)
  const value = result?.stdout?.trim() ?? ''
  return /^[1-9]\d*$/.test(value) ? Number(value) : null
}

function captureServerOutput(stream, label) {
  stream?.setEncoding('utf8')
  stream?.on('data', (chunk) => {
    serverOutput.push(`[${label}] ${chunk}`)
    if (serverOutput.length > 200) serverOutput.shift()
  })
}

async function stopWebServer() {
  if (!webServer) return
  if (process.platform === 'win32') {
    const listenerPid = webServerListenerPid
      ?? await findWindowsListenerPid(webServerPort)
    const pids = new Set([listenerPid, webServer.pid].filter(Boolean))
    for (const pid of pids) {
      await execFileAsync(
        'taskkill',
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true },
      ).catch(() => undefined)
    }
  } else if (webServer.exitCode === null) {
    webServer.kill('SIGTERM')
  }
  if (webServer.exitCode === null) {
    await Promise.race([
      new Promise((resolveExit) => webServer.once('exit', resolveExit)),
      delay(5_000),
    ])
  }
  if (webServer.exitCode === null) webServer.kill('SIGKILL')
}

function observePage(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      if (
        label === 'wrong-email'
        && message.type() === 'error'
        && message.text().includes('status of 403 (Forbidden)')
      ) {
        report.expectedBrowserEvents.push({
          page: label,
          type: 'expected-403-console',
        })
        return
      }
      report.consoleFindings.push({
        page: label,
        type: message.type(),
        text: message.text(),
      })
    }
  })
  page.on('pageerror', (error) => {
    report.consoleFindings.push({
      page: label,
      type: 'pageerror',
      text: error.message,
    })
  })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (
      (url.protocol === 'http:' || url.protocol === 'https:')
      && url.hostname !== new URL(baseUrl).hostname
    ) {
      report.networkFindings.push({
        page: label,
        type: 'external-request',
        url: request.url(),
      })
    }
  })
  page.on('requestfailed', (request) => {
    if (
      request.failure()?.errorText === 'net::ERR_ABORTED'
      && new URL(request.url()).origin === new URL(baseUrl).origin
    ) {
      report.expectedBrowserEvents.push({
        page: label,
        type: 'same-origin-navigation-abort',
        pathname: new URL(request.url()).pathname,
      })
      return
    }
    report.networkFindings.push({
      page: label,
      type: 'request-failed',
      url: request.url(),
      error: request.failure()?.errorText ?? 'unknown',
    })
  })
  page.on('response', (response) => {
    if (response.status() >= 400) {
      if (
        label === 'wrong-email'
        && response.status() === 403
        && new URL(response.url()).pathname === '/api/auth/invite/accept'
      ) {
        report.expectedBrowserEvents.push({
          page: label,
          type: 'expected-email-mismatch',
          status: response.status(),
        })
        return
      }
      report.networkFindings.push({
        page: label,
        type: 'http-error',
        url: response.url(),
        status: response.status(),
      })
    }
  })
}

async function authenticatedContext(token, viewport) {
  const context = await browser.newContext({
    viewport,
    locale: 'ru-RU',
    colorScheme: 'light',
    ignoreHTTPSErrors: true,
  })
  await context.addCookies([{
    name: '__Host-rr_session',
    value: token,
    url: baseUrl,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  }])
  return context
}

async function anonymousContext(viewport) {
  return browser.newContext({
    viewport,
    locale: 'ru-RU',
    colorScheme: 'light',
    ignoreHTTPSErrors: true,
  })
}

async function inspectCurrentSurface(
  page,
  key,
  pathname,
  screenshotName,
  expectedSemantics = ['heading', 'button'],
) {
  await page.waitForFunction(
    () => document.querySelectorAll('main').length === 1,
  )
  await page.locator('main').waitFor({ state: 'visible' })
  await page.locator('#__next-route-announcer__').waitFor({
    state: 'attached',
  })
  assert(
    new URL(page.url()).pathname === pathname,
    `${pathname} redirected away from the authenticated surface.`,
  )
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  assert(overflow <= 0, `${pathname} overflows horizontally by ${overflow}px.`)
  const unlabeledControls = await page.evaluate(() => {
    const visible = (element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0
      )
    }
    return [...document.querySelectorAll('button, input, select, textarea')]
      .filter((element) => {
        if (
          element instanceof HTMLInputElement
          && element.type === 'hidden'
        ) return false
        if (!visible(element)) return false
        const labelledBy = element.getAttribute('aria-labelledby')
        const labelledByText = labelledBy
          ? labelledBy.split(/\s+/).every((id) =>
            document.getElementById(id)?.textContent?.trim())
          : false
        const label = element instanceof HTMLElement
          ? element.closest('label')
          : null
        const associatedLabel = 'labels' in element
          ? [...(element.labels ?? [])].some(
              (candidate) => candidate.textContent?.trim(),
            )
          : false
        return !(
          element.getAttribute('aria-label')?.trim()
          || labelledByText
          || label?.textContent?.trim()
          || associatedLabel
          || element.textContent?.trim()
        )
      })
      .map((element) => element.outerHTML.slice(0, 180))
  })
  assert(
    unlabeledControls.length === 0,
    `${pathname} has unlabeled visible controls: ${unlabeledControls.join(', ')}`,
  )
  const aria = await page.locator('body').ariaSnapshot()
  for (const semantic of expectedSemantics) {
    assert(
      aria.includes(semantic),
      `${pathname} accessibility snapshot is missing ${semantic} semantics.`,
    )
  }
  await page.keyboard.press('Tab')
  const focusMoved = await page.evaluate(
    () => document.activeElement !== document.body,
  )
  assert(focusMoved, `${pathname} did not expose a keyboard focus target.`)
  const screenshotPath = resolve(artifactsDirectory, screenshotName)
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    caret: 'initial',
  })
  report.accessibility[key] = {
    labelledControls: true,
    ariaSnapshotLines: aria.split('\n').length,
    keyboardFocus: true,
  }
  report.responsive[key] = {
    viewport: page.viewportSize(),
    overflowPixels: overflow,
  }
  report.screenshots[key] = screenshotPath
}

async function inspectSurface(page, key, pathname, screenshotName) {
  await page.goto(`${baseUrl}${pathname}`, { waitUntil: 'domcontentloaded' })
  await inspectCurrentSurface(page, key, pathname, screenshotName)
}

async function waitForOutboxToken(email, pathname, excludedToken = null) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const messages = JSON.parse(await readFile(outboxPath, 'utf8'))
      const message = [...messages].reverse().find(
        (entry) => entry.to === email && entry.text.includes(pathname),
      )
      const token = message?.text.match(/#([a-f0-9]{64})(?:\s|$)/)?.[1]
      if (token && token !== excludedToken) return token
    } catch (error) {
      if (
        !error
        || typeof error !== 'object'
        || !('code' in error)
        || error.code !== 'ENOENT'
      ) {
        throw error
      }
    }
    await delay(100)
  }
  throw new Error(`Token for ${pathname} was not recorded for ${email}.`)
}

async function requestMagicLink(page, email, returnTo = '/dashboard') {
  await page.goto(
    `${baseUrl}/login?returnTo=${encodeURIComponent(returnTo)}`,
    { waitUntil: 'domcontentloaded' },
  )
  const form = page.locator('form').filter({
    has: page.locator('input[name="email"]:not([type="hidden"])'),
  })
  await form.locator('input[name="email"]').fill(email)
  await form.locator('button[type="submit"]').click()
  await page.locator(
    'form input[type="hidden"][name="email"]',
  ).waitFor({ state: 'attached' })
  return waitForOutboxToken(email, '/auth/verify')
}

async function resendMagicLink(page, email, previousToken) {
  await page.evaluate(() => {
    const advancedNow = Date.now() + 31_000
    Date.now = () => advancedNow
  })
  const resendButton = page.locator(
    'form:has(input[type="hidden"][name="email"]) button[type="submit"]',
  )
  await page.waitForFunction(() => {
    const button = document.querySelector(
      'form:has(input[type="hidden"][name="email"]) button[type="submit"]',
    )
    return button instanceof HTMLButtonElement && !button.disabled
  })
  await resendButton.click()
  return waitForOutboxToken(email, '/auth/verify', previousToken)
}

async function openMagicLogin(page, token) {
  await page.goto(`${baseUrl}/auth/verify#${token}`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForURL((url) => url.pathname === '/auth/confirm')
  await page.waitForFunction(() => window.location.hash === '')
  await page.locator('main').waitFor({ state: 'visible' })
}

async function challengeState(token) {
  const result = await database.query(
    `SELECT
       invalidated_at IS NOT NULL AS invalidated,
       consumed_at IS NOT NULL AS consumed,
       expires_at <= NOW() AS expired
     FROM auth_challenges
     WHERE token_hash = $1`,
    [hashToken(token)],
  )
  assert(result.rowCount === 1, 'Auth challenge fixture was not found.')
  return result.rows[0]
}

async function expireChallenge(token) {
  const result = await database.query(
    `UPDATE auth_challenges
     SET created_at = NOW() - INTERVAL '2 seconds',
         expires_at = NOW() - INTERVAL '1 second'
     WHERE token_hash = $1
       AND consumed_at IS NULL
       AND invalidated_at IS NULL`,
    [hashToken(token)],
  )
  assert(result.rowCount === 1, 'Auth challenge could not be expired.')
  const expiredChallenge = await challengeState(token)
  assert(expiredChallenge.expired === true, 'Auth challenge did not enter expired state.')
}

async function accountByEmail(email) {
  const result = await database.query(
    `SELECT
       id::TEXT AS id,
       onboarding_status AS "onboardingStatus",
       onboarding_step AS "onboardingStep"
     FROM users
     WHERE email_normalized = $1`,
    [email],
  )
  return result.rows[0] ?? null
}

async function currentSessionForContext(context) {
  const cookies = await context.cookies(baseUrl)
  const token = cookies.find(
    (cookie) => cookie.name === '__Host-rr_session',
  )?.value
  if (!token) return null
  const result = await database.query(
    `SELECT
       id::TEXT AS id,
       user_id::TEXT AS "userId",
       revoked_at IS NOT NULL AS revoked
     FROM auth_sessions
     WHERE token_hash = $1`,
    [hashToken(token)],
  )
  return result.rows[0] ?? null
}

async function openPendingAction(page, fragmentPath, token, preparePath) {
  const [prepareResponse] = await Promise.all([
    page.waitForResponse((response) =>
      new URL(response.url()).pathname === preparePath),
    page.goto(`${baseUrl}${fragmentPath}${token}`, {
      waitUntil: 'domcontentloaded',
    }),
  ])
  assert(
    prepareResponse.status() === 200,
    `${preparePath} returned ${prepareResponse.status()}.`,
  )
  await page.waitForFunction(() => window.location.hash === '')
  const button = page.locator(
    'section[aria-labelledby="pending-action-title"] button:not([disabled])',
  )
  await button.waitFor({ state: 'visible' })
  return button
}

async function sessionState(id) {
  const result = await database.query(
    `SELECT revoked_at IS NOT NULL AS revoked
     FROM auth_sessions
     WHERE id = $1`,
    [id],
  )
  assert(result.rowCount === 1, `Session ${id} was not found.`)
  return result.rows[0]
}

async function userEmail(userId) {
  const result = await database.query(
    'SELECT email FROM users WHERE id = $1',
    [userId],
  )
  return result.rows[0]?.email
}

async function membershipState(workspaceId, userId) {
  const result = await database.query(
    `SELECT role, status
     FROM workspace_members
     WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId],
  )
  return result.rows[0] ?? null
}

async function verifyOwnershipTransfer(owner, invited) {
  const memberships = await database.query(
    `SELECT user_id::TEXT AS "userId", role, status
     FROM workspace_members
     WHERE workspace_id = $1
       AND user_id IN ($2, $3)
     ORDER BY user_id`,
    [owner.workspaceId, owner.userId, invited.userId],
  )
  const roles = Object.fromEntries(
    memberships.rows.map((row) => [row.userId, row.role]),
  )
  const audit = await database.query(
    `SELECT COUNT(*)::INTEGER AS count
     FROM auth_security_events
     WHERE event_type = 'ownership_transferred'
       AND workspace_id = $1
       AND user_id = $2
       AND target_user_id = $3`,
    [owner.workspaceId, owner.userId, invited.userId],
  )
  assert(roles[owner.userId] === 'admin', 'Previous owner was not demoted.')
  assert(roles[invited.userId] === 'owner', 'New owner was not promoted.')
  assert(audit.rows[0]?.count === 1, 'Ownership transfer audit is not unique.')
  assert(
    (await sessionState(owner.session.id)).revoked === true,
    'Ownership transfer did not revoke the previous owner session.',
  )
  return { roles, auditCount: audit.rows[0].count }
}

const authenticatedProductViewports = [
  {
    suffix: '1440',
    width: 1440,
    height: 1000,
    screenshots: {
      leads: 'auth-v2-account-team-e2e-shot-leads-data-1440.png',
      leadDetail: 'auth-v2-account-team-e2e-shot-lead-detail-data-1440.png',
      opportunities: 'auth-v2-account-team-e2e-shot-opportunities-data-1440.png',
      evidenceRadar: 'auth-v2-account-team-e2e-shot-evidence-radar-data-1440.png',
    },
  },
  {
    suffix: '390',
    width: 390,
    height: 844,
    screenshots: {
      leads: 'auth-v2-account-team-e2e-shot-leads-data-390.png',
      leadDetail: 'auth-v2-account-team-e2e-shot-lead-detail-data-390.png',
      opportunities: 'auth-v2-account-team-e2e-shot-opportunities-data-390.png',
      evidenceRadar: 'auth-v2-account-team-e2e-shot-evidence-radar-data-390.png',
    },
  },
]

async function verifyAuthenticatedProductSurfacesAtViewport(
  page,
  owner,
  { suffix, screenshots },
) {
  await inspectSurface(
    page,
    `leads-data-${suffix}`,
    '/leads',
    screenshots.leads,
  )
  const leadRows = page.locator('article[data-lead-row="true"]')
  await leadRows.first().waitFor({ state: 'visible' })
  assert(await leadRows.count() >= 1, 'Authenticated company rows are missing.')
  assert(
    await leadRows.first().locator('details').count() === 0,
    'Company rows must stay scan-first without per-row evidence accordions.',
  )
  const todayFilter = page.locator('button[data-motion-interactive]').filter({
    hasText: 'Сегодня в работе',
  })
  await todayFilter.click()
  await page.waitForURL((url) => url.pathname === '/leads' && url.searchParams.get('today') === '1')
  assert(
    await page.locator('[data-motion-status]').count() >= 1,
    'Authenticated lead filter status surface is missing.',
  )

  await inspectSurface(
    page,
    `lead-detail-data-${suffix}`,
    `/leads/${owner.productSurfaces.candidateId}`,
    screenshots.leadDetail,
  )
  const companyBriefOrder = await page.evaluate(() => {
    const decision = document.querySelector('[data-company-brief-decision]')
    const evidence = document.querySelector('[data-company-brief-evidence]')
    const action = document.querySelector('[data-company-brief-action]')
    if (!decision || !evidence || !action) return false
    return Boolean(
      decision.compareDocumentPosition(evidence) & Node.DOCUMENT_POSITION_FOLLOWING
      && evidence.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING
    )
  })
  assert(companyBriefOrder, 'Company Brief must keep Decision -> Evidence -> Action in DOM order.')

  await inspectSurface(
    page,
    `opportunities-data-${suffix}`,
    '/opportunities',
    screenshots.opportunities,
  )
  const commercialCard = page.locator('article[data-semantic-mode="v3"]')
  await commercialCard.waitFor({ state: 'visible' })
  const diagnostics = commercialCard.locator('details').filter({
    hasText: 'Как радар сделал вывод',
  })
  await diagnostics.locator('summary').click()
  assert(
    await diagnostics.getAttribute('open') === '',
    'Commercial Signal diagnostics disclosure did not open.',
  )

  await inspectSurface(
    page,
    `evidence-radar-data-${suffix}`,
    '/opportunities/radar',
    screenshots.evidenceRadar,
  )
  await page.locator('[data-evidence-radar-map]').waitFor({ state: 'visible' })
  const marker = page.locator('[data-evidence-radar-map] button[data-motion-interactive]').first()
  await marker.click()
  assert(
    await marker.getAttribute('aria-pressed') === 'true',
    'Evidence Radar marker selection did not become active.',
  )
  await page.locator('[data-evidence-lead-detail]').waitFor({ state: 'visible' })
  assert(
    await page.locator('[data-motion-status]').filter({ hasText: 'Выбрано:' }).count() === 1,
    'Evidence Radar selected-marker status is missing.',
  )
}

async function verifyAuthenticatedProductSurfaces(page, owner) {
  for (const {
    suffix,
    width,
    height,
    screenshots,
  } of authenticatedProductViewports) {
    await page.setViewportSize({ width, height })
    await verifyAuthenticatedProductSurfacesAtViewport(
      page,
      owner,
      { suffix, screenshots },
    )
  }
  report.flows.authenticatedProductSurfaces = {
    desktop1440: true,
    mobile390: true,
    leadsWithData: true,
    leadDetail: true,
    filterAndDecisionFlowInteractions: true,
    opportunities: true,
    commercialSignalCard: true,
    evidenceRadarMarkerSelection: true,
  }
}

async function runCoreAuthFlows(fixtures) {
  const signupEmail =
    `signup-${process.pid}-${Date.now()}@example.invalid`
  const signupContext = await anonymousContext({ width: 1440, height: 1000 })
  const signupPage = await signupContext.newPage()
  observePage(signupPage, 'core-signup')

  try {
    await signupPage.goto(`${baseUrl}/login?returnTo=/dashboard`, {
      waitUntil: 'domcontentloaded',
    })
    await inspectCurrentSurface(
      signupPage,
      'login-desktop-1440',
      '/login',
      'auth-v2-account-team-e2e-shot-login-desktop-1440.png',
    )
    await signupPage.setViewportSize({ width: 390, height: 844 })
    await inspectCurrentSurface(
      signupPage,
      'login-mobile-390',
      '/login',
      'auth-v2-account-team-e2e-shot-login-mobile-390.png',
    )

    const firstSignupToken = await requestMagicLink(
      signupPage,
      signupEmail,
    )
    assert(
      await accountByEmail(signupEmail) === null,
      'Signup request created an account before email confirmation.',
    )
    await inspectCurrentSurface(
      signupPage,
      'email-sent-390',
      '/login',
      'auth-v2-account-team-e2e-shot-email-sent-390.png',
    )
    const secondSignupToken = await resendMagicLink(
      signupPage,
      signupEmail,
      firstSignupToken,
    )
    const firstChallenge = await challengeState(firstSignupToken)
    assert(
      firstChallenge.invalidated === true
        && firstChallenge.consumed === false,
      'Resend did not invalidate the prior unused challenge.',
    )
    report.flows.resendInvalidation = {
      previousInvalidated: true,
      replacementDistinct: secondSignupToken !== firstSignupToken,
      userStillAbsent: await accountByEmail(signupEmail) === null,
    }

    await openMagicLogin(signupPage, secondSignupToken)
    assert(
      new URL(signupPage.url()).searchParams.get('status') !== 'invalid',
      'Fresh signup challenge was rejected before confirmation.',
    )
    await inspectCurrentSurface(
      signupPage,
      'confirm-new-session-390',
      '/auth/confirm',
      'auth-v2-account-team-e2e-shot-confirm-new-session-390.png',
    )
    assert(
      await accountByEmail(signupEmail) === null,
      'Challenge preview created a user before explicit confirmation.',
    )
    const confirmSignup = signupPage.locator(
      'form button[type="submit"]',
    ).first()
    await Promise.all([
      signupPage.waitForURL((url) => url.pathname === '/onboarding'),
      confirmSignup.click(),
    ])
    const signupAccount = await accountByEmail(signupEmail)
    const signupSession = await currentSessionForContext(signupContext)
    assert(
      signupAccount
        && signupSession
        && signupSession.userId === signupAccount.id
        && signupSession.revoked === false,
      'Explicit signup confirmation did not create the expected DB session.',
    )

    await signupPage.setViewportSize({ width: 1440, height: 1000 })
    await signupPage.locator('input[name="fullName"]').waitFor({
      state: 'visible',
    })
    await inspectCurrentSurface(
      signupPage,
      'onboarding-step-1-1440',
      '/onboarding',
      'auth-v2-account-team-e2e-shot-onboarding-step-1-1440.png',
    )
    await signupPage.locator('input[name="fullName"]').fill('Core E2E User')
    await signupPage.locator('input[name="agencyName"]').fill('Core Signal')
    await signupPage.locator('select[name="teamRole"]').selectOption('founder')
    await signupPage.locator(
      'button[name="intent"][value="next"]',
    ).click()
    await signupPage.locator('input[name="specialization"]').waitFor({
      state: 'visible',
    })
    await signupPage.reload({ waitUntil: 'domcontentloaded' })
    await signupPage.locator('input[name="specialization"]').waitFor({
      state: 'visible',
    })
    await signupPage.setViewportSize({ width: 390, height: 844 })
    await inspectCurrentSurface(
      signupPage,
      'onboarding-step-2-390',
      '/onboarding',
      'auth-v2-account-team-e2e-shot-onboarding-step-2-390.png',
    )
    await signupPage.locator('input[name="specialization"]').fill(
      'IT and product recruiting',
    )
    await signupPage.locator(
      'input[name="roles"][value="it-engineering"]',
    ).check()
    await signupPage.locator(
      'button[name="intent"][value="next"]',
    ).click()
    await signupPage.locator(
      'input[name="industries"][value="it"]',
    ).waitFor({ state: 'visible' })
    await signupPage.locator(
      'input[name="industries"][value="it"]',
    ).check()
    await signupPage.locator(
      'input[name="companySizes"][value="medium"]',
    ).check()
    await signupPage.locator('textarea[name="geography"]').fill(
      'Москва, удалённо',
    )
    await signupPage.locator('select[name="hiringMode"]').selectOption('auto')
    await signupPage.locator(
      'button[name="intent"][value="next"]',
    ).click()
    await signupPage.locator(
      'input[name="deliveryChoice"][value="email"]',
    ).waitFor({ state: 'visible' })
    await signupPage.locator(
      'input[name="deliveryChoice"][value="email"]',
    ).check()
    await signupPage.locator('input[name="deliveryEmail"]').fill(signupEmail)
    await signupPage.locator(
      'button[name="intent"][value="next"]',
    ).click()
    await signupPage.locator(
      'form input[type="hidden"][name="step"][value="complete"]',
    ).waitFor({ state: 'attached' })
    await Promise.all([
      signupPage.waitForURL((url) => url.pathname === '/dashboard'),
      signupPage.locator(
        'button[name="intent"][value="finish"]',
      ).click(),
    ])
    const completedAccount = await accountByEmail(signupEmail)
    assert(
      completedAccount?.onboardingStatus === 'completed'
        && completedAccount.onboardingStep === 'complete',
      'Onboarding did not persist completion.',
    )
    report.flows.coreMagicLink = {
      userAbsentBeforeConfirmation: true,
      explicitConfirmation: true,
      databaseSessionCreated: true,
      onboarding: {
        resumedAfterReload: true,
        completed: true,
      },
    }
  } finally {
    await signupContext.close()
  }

  const expiredContext = await anonymousContext({ width: 390, height: 844 })
  const expiredPage = await expiredContext.newPage()
  observePage(expiredPage, 'expired-link')
  try {
    const expiredEmail =
      `expired-${process.pid}-${Date.now()}@example.invalid`
    const expiredToken = await requestMagicLink(expiredPage, expiredEmail)
    await expireChallenge(expiredToken)
    await openMagicLogin(expiredPage, expiredToken)
    assert(
      await expiredPage.locator('form button[type="submit"]').count() === 0,
      'Expired magic link exposed an active confirmation action.',
    )
    await inspectCurrentSurface(
      expiredPage,
      'invalid-link-390',
      '/auth/confirm',
      'auth-v2-account-team-e2e-shot-invalid-link-390.png',
      ['heading', 'link'],
    )
    const expiredChallenge = await challengeState(expiredToken)
    assert(
      expiredChallenge.expired === true
        && await accountByEmail(expiredEmail) === null,
      'Expired link created an account or was not expired.',
    )
    report.flows.expiredLink = {
      rejected: true,
      userStillAbsent: true,
    }
  } finally {
    await expiredContext.close()
  }

  const switchContext = await authenticatedContext(
    fixtures.switcher.session.token,
    { width: 1440, height: 1000 },
  )
  const switchPage = await switchContext.newPage()
  observePage(switchPage, 'account-switch')
  try {
    const switchToken = await requestMagicLink(
      switchPage,
      fixtures.switchTarget.email,
    )
    await openMagicLogin(switchPage, switchToken)
    const switchNotice = switchPage.locator('[role="note"]')
    assert(
      await switchNotice.count() === 1
        && (await switchNotice.innerText()).includes(fixtures.switcher.email),
      'Account-switch confirmation did not expose the replacement warning.',
    )
    await inspectCurrentSurface(
      switchPage,
      'confirm-account-switch-1440',
      '/auth/confirm',
      'auth-v2-account-team-e2e-shot-confirm-account-switch-1440.png',
    )
    await Promise.all([
      switchPage.waitForURL((url) => url.pathname === '/dashboard'),
      switchPage.locator('form button[type="submit"]').first().click(),
    ])
    const switchedSession = await currentSessionForContext(switchContext)
    assert(
      (await sessionState(fixtures.switcher.session.id)).revoked === true
        && switchedSession?.userId === fixtures.switchTarget.userId
        && switchedSession.revoked === false,
      'Account switch did not revoke the old session and replace its actor.',
    )
    report.flows.accountSwitch = {
      explicitConfirmation: true,
      previousSessionRevoked: true,
      targetSessionCreated: true,
    }

    await switchPage.goto(`${baseUrl}/settings`, {
      waitUntil: 'domcontentloaded',
    })
    const sessionBeforeLogout = await currentSessionForContext(switchContext)
    assert(sessionBeforeLogout, 'Switched session disappeared before logout.')
    await Promise.all([
      switchPage.waitForURL((url) =>
        url.pathname === '/login'
          && url.searchParams.get('loggedOut') === '1'),
      switchPage.locator('form button[type="submit"]').last().click(),
    ])
    const remainingCookies = await switchContext.cookies(baseUrl)
    assert(
      (await sessionState(sessionBeforeLogout.id)).revoked === true
        && !remainingCookies.some((cookie) =>
          cookie.name === '__Host-rr_session' || cookie.name === 'rr_sid'),
      'Logout did not revoke the DB session and clear auth cookies.',
    )
    report.flows.logout = {
      serverSessionRevoked: true,
      authCookiesCleared: true,
    }
  } finally {
    await switchContext.close()
  }
}

async function restoreNextEnv() {
  if (originalNextEnv === null) return
  const current = await readFile(nextEnvPath, 'utf8')
  if (current === originalNextEnv) return
  const generatedRouteReference =
    `import "./${e2eDistName}/dev/types/routes.d.ts";`
  const originalRouteReference = originalNextEnv.match(
    /^import ".+\/types\/routes\.d\.ts";$/m,
  )?.[0]
  assert(
    originalRouteReference,
    'Original next-env.d.ts route reference was not recognized.',
  )
  const sanitized = current.replace(
    generatedRouteReference,
    originalRouteReference,
  )
  assert(
    sanitized.replaceAll('\r\n', '\n')
      === originalNextEnv.replaceAll('\r\n', '\n'),
    'next-env.d.ts changed outside the E2E-generated route reference.',
  )
  await writeFile(nextEnvPath, originalNextEnv, 'utf8')
}

let baseUrl = ''

try {
  await admin.connect()
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
  databaseCreated = true

  const port = await freePort()
  webServerPort = port
  baseUrl = `https://127.0.0.1:${port}`
  const sourceTsconfig = await readFile(sourceTsconfigPath, 'utf8')
  originalNextEnv = await readFile(nextEnvPath, 'utf8')
  await writeFile(e2eTsconfigPath, sourceTsconfig, 'utf8')
  await createHttpsCertificate()
  const testEnvironment = {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_URL: temporaryUrl.toString(),
    AUTH_PLATFORM_V2_ENABLED: 'true',
    AUTH_WORKSPACES_V2_ENABLED: 'true',
    AUTH_ONBOARDING_V2_ENABLED: 'true',
    AUTH_SITE_URL: baseUrl,
    AUTH_RATE_LIMIT_SECRET:
      'auth-v2-account-team-e2e-rate-limit-secret-000000001',
    SESSION_SECRET:
      'auth-v2-account-team-e2e-session-secret-00000000000001',
    AUTH_EMAIL_TRANSPORT: 'test',
    AUTH_EMAIL_TEST_OUTBOX_PATH: outboxPath,
    AUTH_V2_E2E_DIST_DIR: e2eDistName,
    AUTH_V2_E2E_TSCONFIG: e2eTsconfigName,
    NODE_EXTRA_CA_CERTS: httpsCertPath,
    OPPORTUNITY_ENGINE_V1_ENABLED: 'true',
    OPPORTUNITY_OUTCOMES_ENABLED: 'true',
    OPPORTUNITY_OUTCOMES_UI_ENABLED: 'true',
    OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED: 'true',
    OPPORTUNITY_COMMERCIAL_SIGNAL_UI_ENABLED: 'true',
    COMPANY_EVENTS_V1_ENABLED: 'true',
    COMPANY_STATE_V1_ENABLED: 'true',
    SIGNAL_EPISODES_V2_ENABLED: 'true',
    COMMERCIAL_THESIS_V1_ENABLED: 'true',
    EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED: 'true',
    AGENCY_DNA_MATCH_V2_ENABLED: 'true',
    OPPORTUNITY_SCORING_V3_ENABLED: 'true',
    QUERY_PLANNER_V2_ENABLED: 'true',
    EVIDENCE_RADAR_V1_ENABLED: 'true',
  }
  await writeFile(outboxPath, '[]\n', 'utf8')
  await run(process.execPath, [iconGenerationScript], testEnvironment)
  await run(process.execPath, [migrateScript], testEnvironment)

  database = new Client({ connectionString: temporaryUrl.toString() })
  await database.connect()
  const fixtures = await seedFixtures()

  webServer = spawn(
    process.execPath,
    [
      nextScript,
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
      '--experimental-https',
      '--experimental-https-key',
      httpsKeyPath,
      '--experimental-https-cert',
      httpsCertPath,
    ],
    {
      cwd: webRoot,
      env: testEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  captureServerOutput(webServer.stdout, 'next')
  captureServerOutput(webServer.stderr, 'next-error')
  await waitForWebServer(baseUrl)
  webServerListenerPid = await findWindowsListenerPid(port)

  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  })
  await runCoreAuthFlows(fixtures)
  const ownerContext = await authenticatedContext(
    fixtures.owner.session.token,
    { width: 390, height: 844 },
  )
  const ownerPage = await ownerContext.newPage()
  observePage(ownerPage, 'owner')

  await verifyAuthenticatedProductSurfaces(ownerPage, fixtures.owner)

  await inspectSurface(
    ownerPage,
    'security-390',
    '/settings/security',
    'auth-v2-account-team-e2e-shot-security-390.png',
  )
  await inspectSurface(
    ownerPage,
    'team-390',
    '/settings/team',
    'auth-v2-account-team-e2e-shot-team-390.png',
  )
  await ownerPage.setViewportSize({ width: 1440, height: 1000 })
  await inspectSurface(
    ownerPage,
    'security-1440',
    '/settings/security',
    'auth-v2-account-team-e2e-shot-security-1440.png',
  )
  await inspectSurface(
    ownerPage,
    'team-1440',
    '/settings/team',
    'auth-v2-account-team-e2e-shot-team-1440.png',
  )

  await ownerPage.goto(`${baseUrl}/settings/security`, {
    waitUntil: 'domcontentloaded',
  })
  const sessionSection = ownerPage.locator(
    'section[aria-labelledby="active-sessions"]',
  )
  assert(
    await sessionSection.locator('li').count() === 2,
    'Security page did not show both active owner sessions.',
  )
  const endOthers = sessionSection.locator(
    'form:not(:has(input[name="sessionId"])) button[type="submit"]',
  ).first()
  await Promise.all([
    ownerPage.waitForURL('**/settings/security?sessions=others-ended'),
    endOthers.click(),
  ])
  assert(
    (await sessionState(fixtures.owner.otherSession.id)).revoked === true,
    'End other sessions did not revoke the secondary session.',
  )
  assert(
    (await sessionState(fixtures.owner.session.id)).revoked === false,
    'End other sessions revoked the current session.',
  )
  report.flows.sessionRevocation = {
    secondaryRevoked: true,
    currentPreserved: true,
  }

  const originalEmail = fixtures.owner.email
  const changedEmail =
    `owner-changed-${process.pid}-${Date.now()}@example.invalid`
  const emailForm = ownerPage.locator(
    'section[aria-labelledby="email-change"] form',
  )
  await emailForm.locator('input[name="email"]').fill(changedEmail)
  await Promise.all([
    ownerPage.waitForURL('**/settings/security?email=requested'),
    emailForm.locator('button[type="submit"]').click(),
  ])
  assert(
    await userEmail(fixtures.owner.userId) === originalEmail,
    'Primary email changed before explicit confirmation.',
  )
  const emailToken = await waitForOutboxToken(
    changedEmail,
    '/auth/change-email',
  )
  const emailButton = await openPendingAction(
    ownerPage,
    '/auth/change-email#',
    emailToken,
    '/api/auth/email-change/prepare',
  )
  const [emailConfirmResponse] = await Promise.all([
    ownerPage.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/email-change/confirm'),
    emailButton.click(),
  ])
  const emailConfirmBody = await emailConfirmResponse.json()
  assert(
    emailConfirmResponse.status() === 200
      && emailConfirmBody.ok === true
      && emailConfirmBody.destination === '/settings/security?email=changed',
    'Email confirmation did not preserve the current session.',
  )
  await ownerPage.locator('[role="status"]').filter({
    has: ownerPage.locator('a[href="/settings/security?email=changed"]'),
  }).waitFor({ state: 'visible' })
  assert(
    await userEmail(fixtures.owner.userId) === changedEmail,
    'Confirmed email did not become primary.',
  )
  assert(
    (await sessionState(fixtures.owner.session.id)).revoked === false,
    'Email confirmation revoked the current session.',
  )
  report.flows.emailChange = {
    unchangedBeforeConfirmation: true,
    fragmentCleared: true,
    explicitConfirmation: true,
    currentSessionPreserved: true,
  }

  await ownerPage.goto(`${baseUrl}/settings/team`, {
    waitUntil: 'domcontentloaded',
  })
  const inviteForm = ownerPage.locator(
    'section[aria-labelledby="invite-member"] form',
  )
  await inviteForm.locator('input[name="email"]').fill(fixtures.invited.email)
  await inviteForm.locator('select[name="role"]').selectOption('recruiter')
  await Promise.all([
    ownerPage.waitForURL('**/settings/team?invite=sent'),
    inviteForm.locator('button[type="submit"]').click(),
  ])
  const inviteToken = await waitForOutboxToken(
    fixtures.invited.email,
    '/auth/invite',
  )

  const wrongContext = await authenticatedContext(
    fixtures.wrong.session.token,
    { width: 1440, height: 1000 },
  )
  const wrongPage = await wrongContext.newPage()
  observePage(wrongPage, 'wrong-email')
  const wrongButton = await openPendingAction(
    wrongPage,
    '/auth/invite#',
    inviteToken,
    '/api/auth/invite/prepare',
  )
  const [wrongResponse] = await Promise.all([
    wrongPage.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/invite/accept'),
    wrongButton.click(),
  ])
  const wrongBody = await wrongResponse.json()
  assert(
    wrongResponse.status() === 403
      && wrongBody.ok === false
      && wrongBody.code === 'email_mismatch',
    'Wrong-email invite acceptance was not rejected with email_mismatch.',
  )
  await wrongPage.locator(
    'section[aria-labelledby="pending-action-title"] [role="alert"]',
  ).waitFor({ state: 'visible' })
  assert(
    await membershipState(
      fixtures.owner.workspaceId,
      fixtures.wrong.userId,
    ) === null,
    'Wrong-email account gained workspace membership.',
  )
  await wrongContext.close()

  const invitedContext = await authenticatedContext(
    fixtures.invited.session.token,
    { width: 1440, height: 1000 },
  )
  const invitedPage = await invitedContext.newPage()
  observePage(invitedPage, 'invited')
  const acceptButton = await openPendingAction(
    invitedPage,
    '/auth/invite#',
    inviteToken,
    '/api/auth/invite/prepare',
  )
  const [acceptResponse] = await Promise.all([
    invitedPage.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/invite/accept'),
    acceptButton.click(),
  ])
  const acceptBody = await acceptResponse.json()
  assert(
    acceptResponse.status() === 200
      && acceptBody.ok === true
      && acceptBody.destination === '/dashboard?invite=accepted',
    'Invitee did not accept the invite into the target workspace.',
  )
  await invitedPage.locator('[role="status"]').filter({
    has: invitedPage.locator('a[href="/dashboard?invite=accepted"]'),
  }).waitFor({ state: 'visible' })
  assert(
    (await membershipState(
      fixtures.owner.workspaceId,
      fixtures.invited.userId,
    ))?.role === 'recruiter',
    'Accepted invite did not create the bounded recruiter membership.',
  )

  await ownerPage.goto(`${baseUrl}/settings/team`, {
    waitUntil: 'domcontentloaded',
  })
  const invitedMember = ownerPage.locator(
    'section[aria-labelledby="team-members"] li',
  ).filter({ hasText: fixtures.invited.email })
  await invitedMember.locator('select[name="role"]').selectOption('admin')
  await Promise.all([
    ownerPage.waitForURL('**/settings/team?member=role-changed'),
    invitedMember.locator('button[type="submit"]').first().click(),
  ])
  assert(
    (await membershipState(
      fixtures.owner.workspaceId,
      fixtures.invited.userId,
    ))?.role === 'admin',
    'Owner did not change the invited member role to admin.',
  )
  assert(
    (await sessionState(fixtures.invited.session.id)).revoked === true,
    'Role change did not immediately revoke the invited member session.',
  )

  const transferForm = ownerPage.locator(
    'section[aria-labelledby="transfer-owner"] form',
  )
  await transferForm.locator('select[name="targetUserId"]').selectOption(
    fixtures.invited.userId,
  )
  await Promise.all([
    ownerPage.waitForURL('**/login?ownership=transferred'),
    transferForm.locator('button[type="submit"]').click(),
  ])
  const ownership = await verifyOwnershipTransfer(
    fixtures.owner,
    fixtures.invited,
  )
  report.flows.workspaceInviteAndRoles = {
    emailMismatchStatus: wrongResponse.status(),
    boundedInitialRole: 'recruiter',
    changedRole: 'admin',
    targetSessionRevoked: true,
    ownership,
  }

  await invitedContext.close()
  await ownerContext.close()

  assert(
    report.consoleFindings.length === 0,
    `Browser console findings: ${JSON.stringify(report.consoleFindings)}`,
  )
  assert(
    report.networkFindings.length === 0,
    `Unexpected browser network findings: ${
      JSON.stringify(report.networkFindings)
    }`,
  )
  report.result = 'passed'
} catch (error) {
  failure = error
  report.result = 'failed'
  report.failure = error instanceof Error ? error.message : String(error)
  report.serverOutput = serverOutput.slice(-30)
} finally {
  await browser?.close().catch(() => undefined)
  await stopWebServer().catch(() => undefined)
  await restoreNextEnv().catch((error) => {
    recordCleanupFailure(error)
  })
  await Promise.resolve()
    .then(() => assertSafeE2EDistDirectory())
    .then(() => rm(e2eDistDirectory, { recursive: true, force: true }))
    .catch(recordCleanupFailure)
  await rm(e2eTsconfigPath, { force: true }).catch(() => undefined)
  await database?.end().catch(() => undefined)
  if (databaseCreated) {
    await admin.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
    ).catch((error) => {
      if (!failure) failure = error
    })
  }
  await admin.end().catch(() => undefined)
  await Promise.resolve()
    .then(() => assertSafeOutboxDirectory())
    .then(() => rm(outboxDirectory, { recursive: true, force: true }))
    .catch(recordCleanupFailure)
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    .catch(() => undefined)
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (failure) throw failure
