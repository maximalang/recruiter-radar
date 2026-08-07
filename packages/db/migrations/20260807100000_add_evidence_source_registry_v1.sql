BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE source_registry_entries_v1 (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  category TEXT NOT NULL,
  access_method TEXT NOT NULL,
  commercial_use TEXT NOT NULL,
  authorization TEXT NOT NULL,
  integration_status TEXT NOT NULL,
  automation_policy TEXT NOT NULL,
  retention_policy TEXT NOT NULL,
  terms_reference TEXT,
  registry_version TEXT NOT NULL DEFAULT 'source-registry-v1-2026-08-07',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT source_registry_entries_v1_id_check
    CHECK (id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT source_registry_entries_v1_role_check CHECK (role IN (
    'hiring', 'company_registry', 'contracts_demand', 'capital_corporate',
    'product_commercial', 'technology', 'people_organization',
    'physical_expansion', 'media_social', 'risk', 'first_party'
  )),
  CONSTRAINT source_registry_entries_v1_access_check CHECK (access_method IN (
    'official_api', 'open_data', 'rss', 'webhook', 'lawful_public_fetch',
    'manual', 'contract_feed', 'unavailable'
  )),
  CONSTRAINT source_registry_entries_v1_commercial_check CHECK (commercial_use IN (
    'published_allowance', 'contract_required', 'legal_review_required',
    'internal_first_party', 'prohibited'
  )),
  CONSTRAINT source_registry_entries_v1_auth_check CHECK (authorization IN (
    'none', 'api_key', 'oauth', 'account', 'contract'
  )),
  CONSTRAINT source_registry_entries_v1_status_check CHECK (integration_status IN (
    'connected', 'prototype', 'planned', 'unavailable'
  )),
  CONSTRAINT source_registry_entries_v1_automation_check CHECK (automation_policy IN (
    'allow', 'review_required', 'block'
  )),
  CONSTRAINT source_registry_entries_v1_text_check CHECK (
    BTRIM(category) <> '' AND BTRIM(retention_policy) <> ''
  )
);

CREATE TABLE source_registry_reviews_v1 (
  id BIGSERIAL PRIMARY KEY,
  source_registry_id TEXT NOT NULL
    REFERENCES source_registry_entries_v1(id) ON DELETE RESTRICT,
  review_status TEXT NOT NULL,
  terms_reference TEXT,
  reviewer_reference TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT source_registry_reviews_v1_status_check CHECK (review_status IN (
    'pending', 'approved', 'contracted', 'rejected', 'not_applicable'
  )),
  CONSTRAINT source_registry_reviews_v1_reviewer_check
    CHECK (BTRIM(reviewer_reference) <> ''),
  CONSTRAINT source_registry_reviews_v1_approval_evidence_check CHECK (
    review_status NOT IN ('approved', 'contracted')
    OR (terms_reference IS NOT NULL AND BTRIM(terms_reference) <> '')
  ),
  CONSTRAINT source_registry_reviews_v1_timestamp_check
    CHECK (reviewed_at <= created_at + INTERVAL '5 minutes')
);

CREATE INDEX source_registry_reviews_v1_latest_idx
  ON source_registry_reviews_v1 (source_registry_id, reviewed_at DESC, id DESC);

CREATE OR REPLACE FUNCTION reject_evidence_radar_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER source_registry_entries_v1_immutable
BEFORE UPDATE OR DELETE ON source_registry_entries_v1
FOR EACH ROW EXECUTE FUNCTION reject_evidence_radar_history_mutation();

CREATE TRIGGER source_registry_reviews_v1_append_only
BEFORE UPDATE OR DELETE ON source_registry_reviews_v1
FOR EACH ROW EXECUTE FUNCTION reject_evidence_radar_history_mutation();

CREATE OR REPLACE FUNCTION evidence_radar_source_allowed_v1(p_source_registry_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  WITH source AS (
    SELECT *
    FROM source_registry_entries_v1
    WHERE id = p_source_registry_id
  ), latest_review AS (
    SELECT review.review_status
    FROM source_registry_reviews_v1 AS review
    WHERE review.source_registry_id = p_source_registry_id
    ORDER BY review.reviewed_at DESC, review.id DESC
    LIMIT 1
  )
  SELECT COALESCE(
    (SELECT
      source.integration_status = 'connected'
      AND source.automation_policy <> 'block'
      AND source.commercial_use <> 'prohibited'
      AND CASE
        WHEN source.commercial_use = 'contract_required'
          THEN latest_review.review_status = 'contracted'
        WHEN source.commercial_use = 'internal_first_party'
          THEN latest_review.review_status = 'not_applicable'
        ELSE latest_review.review_status IN ('approved', 'contracted')
      END
     FROM source
     LEFT JOIN latest_review ON TRUE),
    FALSE
  );
$$;

INSERT INTO source_registry_entries_v1 (
  id, role, category, access_method, commercial_use, authorization,
  integration_status, automation_policy, retention_policy, terms_reference
) VALUES
  ('company-career-pages', 'hiring', 'Employer career pages', 'lawful_public_fetch', 'legal_review_required', 'none', 'connected', 'review_required', 'Facts, canonical URL, timestamps and hashes', NULL),
  ('public-ats', 'hiring', 'Public ATS endpoints', 'official_api', 'legal_review_required', 'none', 'prototype', 'review_required', 'Vacancy facts and source reference', NULL),
  ('headhunter-api', 'hiring', 'HeadHunter API', 'official_api', 'legal_review_required', 'oauth', 'connected', 'review_required', 'Company/vacancy facts only; no candidate data', 'https://api.hh.ru/openapi/redoc'),
  ('rabota-rossii-open-data', 'hiring', 'Rabota Rossii open data', 'open_data', 'legal_review_required', 'none', 'connected', 'review_required', 'Company/vacancy facts; minimize personal fields', 'https://trudvsem.ru/opendata/api'),
  ('professional-job-boards', 'hiring', 'Professional job boards', 'manual', 'contract_required', 'account', 'planned', 'block', 'No automated retention before contract', NULL),
  ('public-vacancy-social-channels', 'hiring', 'Public vacancy channels', 'manual', 'legal_review_required', 'none', 'planned', 'block', 'Company-level facts only; no personal harvesting', NULL),
  ('egrul-egrip', 'company_registry', 'EGRUL/EGRIP identity', 'open_data', 'legal_review_required', 'none', 'planned', 'review_required', 'Legal-entity fields required for resolution', 'https://www.nalog.gov.ru/'),
  ('sme-registry', 'company_registry', 'SME registry', 'open_data', 'legal_review_required', 'none', 'planned', 'review_required', 'Company-level registry facts', 'https://rmsp.nalog.ru/'),
  ('official-address-license-registers', 'company_registry', 'Address/license/accreditation registers', 'open_data', 'legal_review_required', 'none', 'planned', 'review_required', 'Company/object facts and source reference', NULL),
  ('eis-procurement', 'contracts_demand', 'EIS procurement', 'open_data', 'legal_review_required', 'none', 'planned', 'review_required', 'Contract facts, identifiers and parties', 'https://zakupki.gov.ru/'),
  ('commercial-tenders', 'contracts_demand', 'Commercial tenders', 'contract_feed', 'contract_required', 'contract', 'planned', 'block', 'Contract-defined', NULL),
  ('issuer-disclosures', 'capital_corporate', 'Issuer disclosures', 'lawful_public_fetch', 'legal_review_required', 'none', 'planned', 'review_required', 'Disclosure facts and canonical identifiers', NULL),
  ('funding-business-signals', 'capital_corporate', 'Funding/grants/financing', 'manual', 'legal_review_required', 'none', 'prototype', 'block', 'Transaction facts and source reference', NULL),
  ('official-product-surfaces', 'product_commercial', 'Official products/changelog/API docs', 'lawful_public_fetch', 'legal_review_required', 'none', 'planned', 'review_required', 'Diff facts, URL and hashes', NULL),
  ('public-github-repositories', 'technology', 'Public GitHub/GitLab repositories', 'official_api', 'legal_review_required', 'api_key', 'planned', 'review_required', 'Organization aggregate only; no developer profiling', 'https://docs.github.com/en/rest'),
  ('domain-infrastructure', 'technology', 'Domains/DNS/certificates/status pages', 'lawful_public_fetch', 'legal_review_required', 'none', 'planned', 'review_required', 'Technical facts and hashes only', NULL),
  ('official-leadership-announcements', 'people_organization', 'Official leadership changes', 'lawful_public_fetch', 'legal_review_required', 'none', 'planned', 'review_required', 'Material public role/name only; no contact enrichment', NULL),
  ('physical-expansion-registers', 'physical_expansion', 'Facilities/construction/capacity expansion', 'open_data', 'legal_review_required', 'none', 'planned', 'review_required', 'Object/address/company facts and source reference', NULL),
  ('official-company-news', 'media_social', 'Official company news', 'lawful_public_fetch', 'legal_review_required', 'none', 'connected', 'review_required', 'Extracted facts, canonical URL, timestamps and hashes', NULL),
  ('government-regional-news', 'media_social', 'Government/regional official news', 'lawful_public_fetch', 'legal_review_required', 'none', 'planned', 'review_required', 'Facts, identifiers and canonical source', NULL),
  ('industry-media', 'media_social', 'Business/industry/regional media', 'manual', 'contract_required', 'account', 'prototype', 'block', 'Facts/citation metadata; no republication', NULL),
  ('official-risk-registers', 'risk', 'Bankruptcy/courts/enforcement/liquidation', 'open_data', 'legal_review_required', 'none', 'planned', 'review_required', 'Company-level risk facts and source identifiers', NULL),
  ('first-party-crm', 'first_party', 'Recruiter Radar first-party CRM', 'webhook', 'internal_first_party', 'account', 'connected', 'allow', 'Tenant-scoped product data with purpose limitation', 'internal:first-party-data-policy');

INSERT INTO source_registry_reviews_v1 (
  source_registry_id, review_status, terms_reference, reviewer_reference,
  notes, reviewed_at
) VALUES (
  'first-party-crm', 'not_applicable', 'internal:first-party-data-policy',
  'system:product-policy',
  'Internal first-party product data. Does not replace external evidence.',
  NOW()
);

COMMIT;
