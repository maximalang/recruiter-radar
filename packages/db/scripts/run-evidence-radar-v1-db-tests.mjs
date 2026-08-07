import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import pg from 'pg'

const { Client } = pg
const execFileAsync = promisify(execFile)
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required.')

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrateScript = resolve(root, 'packages', 'db', 'scripts', 'migrate.mjs')
const migrationsDir = resolve(root, 'packages', 'db', 'migrations')
const admin = new Client({ connectionString: databaseUrl })
const databaseName = `rr_evidence_radar_${process.pid}_${Date.now()}`
const temporaryUrl = new URL(databaseUrl)
temporaryUrl.pathname = `/${databaseName}`
const token = randomUUID().replaceAll('-', '')

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

async function expectReject(action, includes) {
  let rejected = false
  try {
    await action()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    rejected = message.includes(includes)
    if (!rejected) throw error
  }
  if (!rejected) throw new Error(`Expected rejection containing: ${includes}`)
}

await admin.connect()
try {
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
  await execFileAsync(process.execPath, [migrateScript], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: temporaryUrl.toString() },
    maxBuffer: 20 * 1024 * 1024,
  })

  const database = new Client({ connectionString: temporaryUrl.toString() })
  await database.connect()
  try {
    const registry = await database.query(
      `SELECT
         COUNT(*)::INTEGER AS count,
         BOOL_AND(id <> '') AS ids_ok,
         evidence_radar_source_allowed_v1('first-party-crm') AS first_party_allowed,
         evidence_radar_source_allowed_v1('headhunter-api') AS hh_allowed
       FROM source_registry_entries_v1`,
    )
    if (
      registry.rows[0]?.count !== 23 ||
      registry.rows[0]?.ids_ok !== true ||
      registry.rows[0]?.first_party_allowed !== true ||
      registry.rows[0]?.hh_allowed !== false
    ) {
      throw new Error(`Unexpected source registry contract: ${JSON.stringify(registry.rows[0])}`)
    }

    const workspace = await database.query(
      `INSERT INTO workspaces (name, slug, status)
       VALUES ('Evidence Radar runtime', $1, 'active')
       RETURNING id::TEXT AS id`,
      [`evidence-radar-${token}`],
    )
    const workspace2 = await database.query(
      `INSERT INTO workspaces (name, slug, status)
       VALUES ('Evidence Radar runtime 2', $1, 'active')
       RETURNING id::TEXT AS id`,
      [`evidence-radar-2-${token}`],
    )
    const workspaceId = workspace.rows[0].id
    const workspace2Id = workspace2.rows[0].id

    const org = await database.query(
      `INSERT INTO orgs (name, domain)
       VALUES ('Evidence Radar Org', $1)
       RETURNING id::TEXT AS id`,
      [`evidence-${token}.example.invalid`],
    )
    const org2 = await database.query(
      `INSERT INTO orgs (name, domain)
       VALUES ('Evidence Radar Org 2', $1)
       RETURNING id::TEXT AS id`,
      [`evidence-2-${token}.example.invalid`],
    )
    const organizationId = org.rows[0].id
    const organization2Id = org2.rows[0].id

    const evidence = await database.query(
      `INSERT INTO evidence_items (
         org_id, source, url, fetched_at, content_hash, tier
       ) VALUES
         ($1, 'company-site', $3, NOW(), $6, 'direct'),
         ($1, 'company-newsrooms', $4, NOW(), $7, 'direct'),
         ($2, 'company-site', $5, NOW(), $8, 'direct')
       RETURNING id::TEXT AS id, org_id::TEXT AS "organizationId", source`,
      [
        organizationId,
        organization2Id,
        `https://evidence-${token}.example.invalid/about`,
        `https://evidence-${token}.example.invalid/news/funding`,
        `https://evidence-2-${token}.example.invalid/about`,
        '1'.repeat(64),
        '2'.repeat(64),
        '3'.repeat(64),
      ],
    )
    const evidenceIdentity = evidence.rows.find(
      (row) => row.organizationId === organizationId && row.source === 'company-site',
    )?.id
    const evidenceNews = evidence.rows.find(
      (row) => row.organizationId === organizationId && row.source === 'company-newsrooms',
    )?.id
    const evidenceOther = evidence.rows.find(
      (row) => row.organizationId === organization2Id,
    )?.id
    if (!evidenceIdentity || !evidenceNews || !evidenceOther) {
      throw new Error('Evidence fixtures were not created.')
    }

    const identity = await database.query(
      `INSERT INTO organization_identity_profiles_v1 (
         workspace_id, organization_id, legal_name, brand, inn,
         primary_domain, evidence_item_ids, resolution_confidence,
         resolution_basis
       ) VALUES (
         $1, $2, 'ООО Evidence Radar', 'Evidence Radar', '7701234567',
         $3, ARRAY[$4::BIGINT], .98, '{"method":"inn+domain"}'::JSONB
       ) RETURNING id::TEXT AS id`,
      [workspaceId, organizationId, `evidence-${token}.example.invalid`, evidenceIdentity],
    )
    await database.query(
      `INSERT INTO organization_identity_profiles_v1 (
         workspace_id, organization_id, legal_name, brand, inn,
         primary_domain, evidence_item_ids, resolution_confidence,
         resolution_basis
       ) VALUES (
         $1, $2, 'ООО Evidence Radar 2', 'Evidence Radar 2', '7801234567',
         $3, ARRAY[$4::BIGINT], .98, '{"method":"inn+domain"}'::JSONB
       )`,
      [workspace2Id, organization2Id, `evidence-2-${token}.example.invalid`, evidenceOther],
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
         ARRAY[$3::BIGINT], $4
       ) RETURNING id::TEXT AS id`,
      [workspaceId, organizationId, evidenceIdentity, 'a'.repeat(64)],
    )
    const locationId = location.rows[0].id
    await database.query(
      `UPDATE organization_identity_profiles_v1
       SET head_office_location_id = $1
       WHERE id = $2`,
      [locationId, identity.rows[0].id],
    )

    await expectReject(
      () => database.query(
        `INSERT INTO organization_locations_v1 (
           workspace_id, organization_id, location_type,
           federal_subject_code, federal_subject_name, city,
           latitude, longitude, geo_confidence, evidence_item_ids,
           location_fingerprint
         ) VALUES (
           $1, $2, 'office', '78', 'Санкт-Петербург', 'Санкт-Петербург',
           59.93, 30.31, .9, ARRAY[$3::BIGINT], $4
         )`,
        [workspace2Id, organization2Id, evidenceIdentity, 'b'.repeat(64)],
      ),
      'organization location evidence must belong to organization',
    )

    const hhEventInsert = () => database.query(
      `INSERT INTO evidence_events_v1 (
         workspace_id, organization_id, location_id, event_type,
         source_registry_id, source_family, canonical_url,
         occurred_at, detected_at, facts, confidence,
         independent_confirmations, valid_until, polarity,
         verification_status, primary_source, content_fingerprint,
         event_fingerprint
       ) VALUES (
         $1, $2, $3, 'hiring_growth', 'headhunter-api', 'hh', $4,
         NOW() - INTERVAL '1 day', NOW(), '{"vacancies":12}'::JSONB, .90,
         1, NOW() + INTERVAL '21 days', 'positive', 'verified', FALSE,
         $5, $6
       ) RETURNING id::TEXT AS id`,
      [
        workspaceId,
        organizationId,
        locationId,
        `https://hh.example.invalid/${token}`,
        'c'.repeat(64),
        'd'.repeat(64),
      ],
    )

    await expectReject(hhEventInsert, 'is not approved for Evidence Radar automation')
    await database.query(
      `INSERT INTO source_registry_reviews_v1 (
         source_registry_id, review_status, terms_reference,
         reviewer_reference, notes, reviewed_at
       ) VALUES
         ('headhunter-api', 'approved', 'https://api.hh.ru/openapi/redoc',
          'runtime:test-review', 'Isolated contract fixture only.', NOW()),
         ('official-company-news', 'approved', $1,
          'runtime:test-review', 'Isolated contract fixture only.', NOW())`,
      [`https://evidence-${token}.example.invalid/terms`],
    )

    const gates = await database.query(
      `SELECT
         evidence_radar_source_allowed_v1('headhunter-api') AS hh,
         evidence_radar_source_allowed_v1('official-company-news') AS news`,
    )
    if (gates.rows[0]?.hh !== true || gates.rows[0]?.news !== true) {
      throw new Error('Approved connected test sources did not pass automation gate.')
    }

    await database.query(
      `UPDATE source_registry_entries_v1
       SET retention_policy = retention_policy || ' [runtime-reviewed]'
       WHERE id = 'official-company-news'`,
    )
    const sourceAudit = await database.query(
      `SELECT COUNT(*)::INTEGER AS count
       FROM source_registry_entry_changes_v1
       WHERE source_registry_id = 'official-company-news'`,
    )
    if (sourceAudit.rows[0]?.count !== 1) {
      throw new Error('Source Registry operational update was not audited.')
    }

    const hhEvent = await hhEventInsert()
    const hhEventId = hhEvent.rows[0].id
    const newsEvent = await database.query(
      `INSERT INTO evidence_events_v1 (
         workspace_id, organization_id, location_id, event_type,
         source_registry_id, source_family, canonical_url,
         occurred_at, detected_at, facts, confidence,
         independent_confirmations, valid_until, polarity,
         verification_status, primary_source, content_fingerprint,
         event_fingerprint
       ) VALUES (
         $1, $2, $3, 'funding_received', 'official-company-news',
         'official-news', $4, NOW() - INTERVAL '5 days', NOW(),
         '{"funding":"confirmed"}'::JSONB, .90, 1,
         NOW() + INTERVAL '45 days', 'positive', 'verified', TRUE,
         $5, $6
       ) RETURNING id::TEXT AS id`,
      [
        workspaceId,
        organizationId,
        locationId,
        `https://evidence-${token}.example.invalid/news/funding`,
        'e'.repeat(64),
        'f'.repeat(64),
      ],
    )
    const newsEventId = newsEvent.rows[0].id

    await expectReject(
      () => database.query(
        `UPDATE evidence_events_v1 SET confidence = .5 WHERE id = $1`,
        [hhEventId],
      ),
      'append-only',
    )
    await expectReject(
      () => database.query(
        `INSERT INTO evidence_events_v1 (
           workspace_id, organization_id, event_type, source_registry_id,
           source_family, occurred_at, detected_at, facts, confidence,
           independent_confirmations, valid_until, polarity,
           verification_status, primary_source, content_fingerprint,
           event_fingerprint
         ) VALUES (
           $1, $2, 'hiring_growth', 'headhunter-api', 'hh',
           NOW() - INTERVAL '1 day', NOW(), '{}'::JSONB, .8, 1,
           NOW() + INTERVAL '10 days', 'positive', 'verified', FALSE,
           $3, $4
         )`,
        [workspaceId, organization2Id, '9'.repeat(64), '0'.repeat(64)],
      ),
      'foreign key',
    )

    const signals = await database.query(
      `INSERT INTO normalized_signals_v1 (
         workspace_id, organization_id, signal_type, started_at,
         last_seen_at, valid_until, confidence, strength,
         source_families, affected_functions, region_code, city,
         polarity, input_hash, signal_fingerprint
       ) VALUES
         ($1, $2, 'hiring_growth', NOW() - INTERVAL '2 days', NOW(),
          NOW() + INTERVAL '21 days', .90, .85, ARRAY['hh'],
          ARRAY['engineering','recruiting'], '77', 'Москва', 'positive',
          $3, $4),
         ($1, $2, 'funding_received', NOW() - INTERVAL '5 days', NOW(),
          NOW() + INTERVAL '45 days', .90, .80, ARRAY['official-news'],
          ARRAY['engineering','product'], '77', 'Москва', 'positive',
          $5, $6)
       RETURNING id::TEXT AS id, signal_type AS "signalType"`,
      [
        workspaceId,
        organizationId,
        '4'.repeat(64),
        '5'.repeat(64),
        '6'.repeat(64),
        '7'.repeat(64),
      ],
    )
    const hiringSignalId = signals.rows.find((row) => row.signalType === 'hiring_growth')?.id
    const fundingSignalId = signals.rows.find((row) => row.signalType === 'funding_received')?.id
    if (!hiringSignalId || !fundingSignalId) throw new Error('Signal fixtures were not created.')

    await database.query(
      `INSERT INTO normalized_signal_event_links_v1 (
         signal_id, evidence_event_id, workspace_id, organization_id
       ) VALUES
         ($1, $3, $5, $6),
         ($2, $4, $5, $6)`,
      [hiringSignalId, fundingSignalId, hhEventId, newsEventId, workspaceId, organizationId],
    )

    await expectReject(
      () => database.query(
        `INSERT INTO evidence_correlations_v1 (
           workspace_id, organization_id, rule_id, signal_ids,
           source_families, window_days, intent_boost, explanation,
           input_hash, correlation_fingerprint, valid_until
         ) VALUES (
           $1, $2, 'funding-hiring-recruiter', ARRAY[$3::BIGINT,$4::BIGINT],
           ARRAY['fake-family','hh'], 60, .12, 'Invalid provenance fixture',
           $5, $6, NOW() + INTERVAL '21 days'
         )`,
        [
          workspaceId,
          organizationId,
          fundingSignalId,
          hiringSignalId,
          '8'.repeat(64),
          'a'.repeat(64),
        ],
      ),
      'correlation source families must equal referenced signal provenance',
    )

    const correlation = await database.query(
      `INSERT INTO evidence_correlations_v1 (
         workspace_id, organization_id, rule_id, signal_ids,
         source_families, window_days, intent_boost, explanation,
         input_hash, correlation_fingerprint, valid_until
       ) VALUES (
         $1, $2, 'funding-hiring-recruiter', ARRAY[$3::BIGINT,$4::BIGINT],
         ARRAY['hh','official-news'], 60, .12,
         'Funding followed by direct hiring growth from an independent source.',
         $5, $6, NOW() + INTERVAL '21 days'
       ) RETURNING id::TEXT AS id`,
      [
        workspaceId,
        organizationId,
        fundingSignalId,
        hiringSignalId,
        'b'.repeat(64),
        'c'.repeat(64),
      ],
    )
    const correlationId = correlation.rows[0].id

    const components = {
      hiringIntent: .9,
      confidence: .9,
      freshness: .92,
      urgency: .8,
      commercialFit: .9,
      contactability: .8,
      risk: .08,
    }
    const opportunityScore = 42.92352
    const leadScore = 40.12352
    const contributions = [
      { eventId: hhEventId, component: 'hiring_intent', delta: .2, reason: 'verified vacancy growth' },
      { eventId: newsEventId, component: 'confidence', delta: .1, reason: 'independent primary company evidence' },
    ]

    await expectReject(
      () => database.query(
        `INSERT INTO evidence_lead_score_snapshots_v1 (
           workspace_id, organization_id, lead_score, opportunity_score,
           confidence_score, urgency_score, contactability_score, risk_score,
           components, contributions, source_event_ids, source_signal_ids,
           source_correlation_ids, independent_source_families,
           input_hash, valid_until
         ) VALUES (
           $1, $2, 99, $3, 90, 80, 80, 8, $4::JSONB, $5::JSONB,
           ARRAY[$6::BIGINT,$7::BIGINT], ARRAY[$8::BIGINT,$9::BIGINT],
           ARRAY[$10::BIGINT], ARRAY['hh','official-news'], $11,
           NOW() + INTERVAL '21 days'
         )`,
        [
          workspaceId,
          organizationId,
          opportunityScore,
          JSON.stringify(components),
          JSON.stringify(contributions),
          hhEventId,
          newsEventId,
          hiringSignalId,
          fundingSignalId,
          correlationId,
          'd'.repeat(64),
        ],
      ),
      'persisted Evidence Radar scores do not reproduce component formula',
    )

    const score = await database.query(
      `INSERT INTO evidence_lead_score_snapshots_v1 (
         workspace_id, organization_id, lead_score, opportunity_score,
         confidence_score, urgency_score, contactability_score, risk_score,
         components, contributions, source_event_ids, source_signal_ids,
         source_correlation_ids, independent_source_families,
         input_hash, valid_until
       ) VALUES (
         $1, $2, $3, $4, 90, 80, 80, 8, $5::JSONB, $6::JSONB,
         ARRAY[$7::BIGINT,$8::BIGINT], ARRAY[$9::BIGINT,$10::BIGINT],
         ARRAY[$11::BIGINT], ARRAY['hh','official-news'], $12,
         NOW() + INTERVAL '21 days'
       ) RETURNING id::TEXT AS id`,
      [
        workspaceId,
        organizationId,
        leadScore,
        opportunityScore,
        JSON.stringify(components),
        JSON.stringify(contributions),
        hhEventId,
        newsEventId,
        hiringSignalId,
        fundingSignalId,
        correlationId,
        'e'.repeat(64),
      ],
    )
    const scoreId = score.rows[0].id

    await expectReject(
      () => database.query(
        `INSERT INTO public_contact_paths_v1 (
           workspace_id, organization_id, contact_type, label, href,
           is_personal, verification_status, contact_fingerprint
         ) VALUES (
           $1, $2, 'corporate_email', 'Ivan', 'mailto:ivan@example.invalid',
           FALSE, 'verified', $3
         )`,
        [workspaceId, organizationId, 'f'.repeat(64)],
      ),
      'public_contact_paths_v1_href_check',
    )

    const contact = await database.query(
      `INSERT INTO public_contact_paths_v1 (
         workspace_id, organization_id, contact_type, label, href,
         evidence_event_id, verification_status, contact_fingerprint
       ) VALUES (
         $1, $2, 'generic_hr_email', 'HR Moscow', 'mailto:hr-moscow@example.invalid',
         $3, 'verified', $4
       ) RETURNING id::TEXT AS id`,
      [workspaceId, organizationId, hhEventId, '1'.repeat(63) + 'f'],
    )
    const contactId = contact.rows[0].id

    await database.query(
      `INSERT INTO evidence_lead_cards_v1 (
         workspace_id, organization_id, location_id, score_snapshot_id,
         status, title, why_now, staffing_need, specialization,
         recommended_contact_at, recommended_action, risk_reasons,
         evidence_event_ids, contact_path_ids, valid_until,
         card_fingerprint
       ) VALUES (
         $1, $2, $3, $4, 'qualified', 'Подтверждённый рост найма',
         'Финансирование и последующий рост найма подтверждены независимыми источниками.',
         '{"functions":["engineering"],"minHeadcount":3,"maxHeadcount":12,"mode":"targeted","decisionMakerRoles":["HRD","Head of Recruitment"]}'::JSONB,
         'engineering', NOW() + INTERVAL '1 day',
         'Проверить карьерную страницу и подготовить точечное обращение.',
         ARRAY[]::TEXT[], ARRAY[$5::BIGINT,$6::BIGINT], ARRAY[$7::BIGINT],
         NOW() + INTERVAL '21 days', $8
       )`,
      [
        workspaceId,
        organizationId,
        locationId,
        scoreId,
        hhEventId,
        newsEventId,
        contactId,
        '2'.repeat(64),
      ],
    )

    const readModel = await database.query(
      `SELECT
         COUNT(*)::INTEGER AS cards,
         (SELECT COUNT(*)::INTEGER FROM source_registry_entry_changes_v1) AS source_changes,
         (SELECT COUNT(*)::INTEGER FROM organization_identity_changes_v1) AS identity_changes,
         (SELECT COUNT(*)::INTEGER FROM evidence_events_v1) AS events,
         (SELECT COUNT(*)::INTEGER FROM normalized_signals_v1) AS signals,
         (SELECT COUNT(*)::INTEGER FROM evidence_correlations_v1) AS correlations
       FROM evidence_lead_cards_v1
       WHERE workspace_id = $1`,
      [workspaceId],
    )
    if (
      readModel.rows[0]?.cards !== 1 ||
      readModel.rows[0]?.source_changes !== 1 ||
      readModel.rows[0]?.identity_changes !== 1 ||
      readModel.rows[0]?.events !== 2 ||
      readModel.rows[0]?.signals !== 2 ||
      readModel.rows[0]?.correlations !== 1
    ) {
      throw new Error(`Unexpected Evidence Radar runtime state: ${JSON.stringify(readModel.rows[0])}`)
    }

    const downSql = await readFile(
      resolve(migrationsDir, '20260807103000_add_evidence_lead_cards_v1.down.sql'),
      'utf8',
    )
    await expectReject(async () => {
      try {
        await database.query(downSql)
      } catch (error) {
        await database.query('ROLLBACK').catch(() => undefined)
        throw error
      }
    }, 'refusing to remove non-empty evidence lead tables')

    console.log(JSON.stringify({
      ok: true,
      sourceRegistryEntries: registry.rows[0].count,
      cards: 1,
      events: 2,
      signals: 2,
      correlations: 1,
      tenantScope: 'verified',
      legalGate: 'verified',
      sourceAudit: 'verified',
      appendOnly: 'verified',
      scoreReproduction: 'verified',
      personalContacts: 'blocked',
    }))
  } finally {
    await database.end()
  }
} finally {
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`)
  await admin.end()
}
