BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- A source observation can support multiple semantic event types, but replaying
-- the same source observation into the same event must stay idempotent even if
-- the publication fingerprint recipe changes between normalizer releases.
CREATE OR REPLACE FUNCTION suppress_duplicate_company_event_signal_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.signal_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM company_event_publications existing
    WHERE existing.company_event_id = NEW.company_event_id
      AND existing.organization_id = NEW.organization_id
      AND existing.signal_id = NEW.signal_id
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_event_publications_signal_replay_guard
  ON company_event_publications;
CREATE TRIGGER company_event_publications_signal_replay_guard
BEFORE INSERT ON company_event_publications
FOR EACH ROW EXECUTE FUNCTION suppress_duplicate_company_event_signal_publication();

-- `new_region` is meaningful only against an observed company baseline. Two
-- first-ever vacancies in one city are not evidence of geographic expansion.
-- Check the immutable/raw job-posting history instead of relying on insertion
-- order of Company Events in the same normalization transaction.
CREATE OR REPLACE FUNCTION require_company_history_for_new_region_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.event_type <> 'new_region' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM signals historical_signal
    WHERE historical_signal.org_id = NEW.organization_id
      AND historical_signal.signal_type = 'job_posting'
      AND historical_signal.occurred_at < NEW.occurred_at - INTERVAL '14 days'
      AND EXISTS (
        SELECT 1
        FROM evidence_items historical_evidence
        WHERE historical_evidence.org_id = historical_signal.org_id
          AND historical_evidence.url = historical_signal.source_url
      )
  ) THEN
    RAISE EXCEPTION
      'new_region event requires observed hiring history before the recent window'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_events_new_region_baseline_guard ON company_events;
CREATE TRIGGER company_events_new_region_baseline_guard
BEFORE INSERT ON company_events
FOR EACH ROW EXECUTE FUNCTION require_company_history_for_new_region_event();

-- Exact corporate-enrichment evidence is attached to the same immutable
-- lineage that requested enrichment. This is supporting/contact evidence only;
-- it cannot originate a hiring episode or opportunity.
CREATE TABLE IF NOT EXISTS commercial_signal_enrichment_evidence (
  lineage_id BIGINT NOT NULL
    REFERENCES commercial_signal_opportunity_lineage(id) ON DELETE CASCADE,
  evidence_id BIGINT NOT NULL REFERENCES evidence_items(id) ON DELETE RESTRICT,
  workspace_id BIGINT NOT NULL,
  client_profile_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  surface_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT commercial_signal_enrichment_evidence_unique
    UNIQUE (lineage_id, evidence_id, surface_type),
  CONSTRAINT commercial_signal_enrichment_evidence_surface_check CHECK (
    surface_type IN (
      'careers_page',
      'corporate_contact_page',
      'hr_recruitment_function',
      'company_email',
      'generic_corporate_contact',
      'corporate_social_surface'
    )
  )
);

CREATE INDEX IF NOT EXISTS commercial_signal_enrichment_evidence_scope_idx
  ON commercial_signal_enrichment_evidence (
    workspace_id, client_profile_id, organization_id, lineage_id
  );

CREATE OR REPLACE FUNCTION validate_commercial_signal_enrichment_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  lineage commercial_signal_opportunity_lineage%ROWTYPE;
  evidence_org BIGINT;
BEGIN
  SELECT * INTO lineage
  FROM commercial_signal_opportunity_lineage
  WHERE id = NEW.lineage_id;

  IF lineage.id IS NULL
     OR lineage.workspace_id <> NEW.workspace_id
     OR lineage.client_profile_id <> NEW.client_profile_id
     OR lineage.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'enrichment evidence tenant/lineage mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT org_id INTO evidence_org
  FROM evidence_items
  WHERE id = NEW.evidence_id;

  IF evidence_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'enrichment evidence organization mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commercial_signal_enrichment_evidence_validate
  ON commercial_signal_enrichment_evidence;
CREATE TRIGGER commercial_signal_enrichment_evidence_validate
BEFORE INSERT ON commercial_signal_enrichment_evidence
FOR EACH ROW EXECUTE FUNCTION validate_commercial_signal_enrichment_evidence();
DROP TRIGGER IF EXISTS commercial_signal_enrichment_evidence_append_only
  ON commercial_signal_enrichment_evidence;
CREATE TRIGGER commercial_signal_enrichment_evidence_append_only
BEFORE UPDATE OR DELETE ON commercial_signal_enrichment_evidence
FOR EACH ROW EXECUTE FUNCTION reject_commercial_signal_lineage_mutation();

COMMENT ON TABLE commercial_signal_enrichment_evidence IS
  'Corporate-surface-only enrichment evidence attached to an exact Commercial Signal opportunity lineage; never a standalone hiring trigger.';

COMMIT;
