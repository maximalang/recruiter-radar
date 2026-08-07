BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE evidence_lead_score_snapshots_v1 (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  lead_score DOUBLE PRECISION NOT NULL,
  opportunity_score DOUBLE PRECISION NOT NULL,
  confidence_score DOUBLE PRECISION NOT NULL,
  urgency_score DOUBLE PRECISION NOT NULL,
  contactability_score DOUBLE PRECISION NOT NULL,
  risk_score DOUBLE PRECISION NOT NULL,
  components JSONB NOT NULL,
  contributions JSONB NOT NULL,
  source_event_ids BIGINT[] NOT NULL,
  independent_source_families TEXT[] NOT NULL,
  score_version TEXT NOT NULL DEFAULT 'evidence-lead-score-v1',
  input_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ NOT NULL,
  CONSTRAINT evidence_lead_score_snapshots_v1_identity_fkey
    FOREIGN KEY (workspace_id, organization_id)
    REFERENCES organization_identity_profiles_v1(workspace_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_lead_score_snapshots_v1_id_scope_unique
    UNIQUE (id, workspace_id, organization_id),
  CONSTRAINT evidence_lead_score_snapshots_v1_score_check CHECK (
    lead_score BETWEEN 0 AND 100
    AND opportunity_score BETWEEN 0 AND 100
    AND confidence_score BETWEEN 0 AND 100
    AND urgency_score BETWEEN 0 AND 100
    AND contactability_score BETWEEN 0 AND 100
    AND risk_score BETWEEN 0 AND 100
  ),
  CONSTRAINT evidence_lead_score_snapshots_v1_components_check
    CHECK (JSONB_TYPEOF(components) = 'object'),
  CONSTRAINT evidence_lead_score_snapshots_v1_contributions_check
    CHECK (JSONB_TYPEOF(contributions) = 'array' AND JSONB_ARRAY_LENGTH(contributions) > 0),
  CONSTRAINT evidence_lead_score_snapshots_v1_events_check
    CHECK (CARDINALITY(source_event_ids) > 0),
  CONSTRAINT evidence_lead_score_snapshots_v1_sources_check
    CHECK (CARDINALITY(independent_source_families) > 0),
  CONSTRAINT evidence_lead_score_snapshots_v1_input_hash_check
    CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT evidence_lead_score_snapshots_v1_validity_check
    CHECK (valid_until >= created_at)
);

CREATE INDEX evidence_lead_score_snapshots_v1_rank_idx
  ON evidence_lead_score_snapshots_v1 (
    workspace_id, lead_score DESC, valid_until DESC, id DESC
  );

CREATE TABLE public_contact_paths_v1 (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  contact_type TEXT NOT NULL,
  label TEXT NOT NULL,
  href TEXT,
  evidence_event_id BIGINT,
  is_personal BOOLEAN NOT NULL DEFAULT FALSE,
  verification_status TEXT NOT NULL DEFAULT 'verified',
  contact_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT public_contact_paths_v1_identity_fkey
    FOREIGN KEY (workspace_id, organization_id)
    REFERENCES organization_identity_profiles_v1(workspace_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT public_contact_paths_v1_event_fkey
    FOREIGN KEY (evidence_event_id, workspace_id, organization_id)
    REFERENCES evidence_events_v1(id, workspace_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT public_contact_paths_v1_id_scope_unique
    UNIQUE (id, workspace_id, organization_id),
  CONSTRAINT public_contact_paths_v1_type_check CHECK (contact_type IN (
    'company_form', 'corporate_email', 'generic_hr_email', 'switchboard', 'official_channel'
  )),
  CONSTRAINT public_contact_paths_v1_label_check
    CHECK (BTRIM(label) <> ''),
  CONSTRAINT public_contact_paths_v1_personal_check
    CHECK (is_personal = FALSE),
  CONSTRAINT public_contact_paths_v1_href_check CHECK (
    href IS NULL
    OR href ~ '^https://'
    OR href ~ '^tel:[+0-9() -]+$'
    OR href ~* '^mailto:(info|hello|hr|jobs|career|careers|recruit|recruiting|talent|office|contact)@[^@[:space:]]+$'
  ),
  CONSTRAINT public_contact_paths_v1_verification_check
    CHECK (verification_status IN ('verified', 'review', 'rejected')),
  CONSTRAINT public_contact_paths_v1_fingerprint_check
    CHECK (contact_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT public_contact_paths_v1_fingerprint_unique
    UNIQUE (workspace_id, organization_id, contact_fingerprint)
);

CREATE INDEX public_contact_paths_v1_org_idx
  ON public_contact_paths_v1 (
    workspace_id, organization_id, verification_status, id
  );

CREATE TABLE evidence_lead_cards_v1 (
  id BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL,
  organization_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  score_snapshot_id BIGINT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  why_now TEXT NOT NULL,
  staffing_need JSONB,
  specialization TEXT,
  recommended_contact_at TIMESTAMPTZ,
  recommended_action TEXT NOT NULL,
  risk_reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  evidence_event_ids BIGINT[] NOT NULL,
  contact_path_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ NOT NULL,
  card_fingerprint TEXT NOT NULL,
  card_version TEXT NOT NULL DEFAULT 'evidence-lead-card-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT evidence_lead_cards_v1_identity_fkey
    FOREIGN KEY (workspace_id, organization_id)
    REFERENCES organization_identity_profiles_v1(workspace_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_lead_cards_v1_location_fkey
    FOREIGN KEY (location_id, workspace_id, organization_id)
    REFERENCES organization_locations_v1(id, workspace_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_lead_cards_v1_score_fkey
    FOREIGN KEY (score_snapshot_id, workspace_id, organization_id)
    REFERENCES evidence_lead_score_snapshots_v1(id, workspace_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_lead_cards_v1_status_check CHECK (status IN (
    'qualified', 'review', 'rejected', 'expired'
  )),
  CONSTRAINT evidence_lead_cards_v1_title_check
    CHECK (BTRIM(title) <> ''),
  CONSTRAINT evidence_lead_cards_v1_why_now_check
    CHECK (BTRIM(why_now) <> ''),
  CONSTRAINT evidence_lead_cards_v1_staffing_check
    CHECK (staffing_need IS NULL OR JSONB_TYPEOF(staffing_need) = 'object'),
  CONSTRAINT evidence_lead_cards_v1_action_check
    CHECK (BTRIM(recommended_action) <> ''),
  CONSTRAINT evidence_lead_cards_v1_events_check
    CHECK (CARDINALITY(evidence_event_ids) > 0),
  CONSTRAINT evidence_lead_cards_v1_validity_check
    CHECK (valid_until >= generated_at),
  CONSTRAINT evidence_lead_cards_v1_fingerprint_check
    CHECK (card_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT evidence_lead_cards_v1_fingerprint_unique
    UNIQUE (workspace_id, organization_id, card_fingerprint)
);

CREATE INDEX evidence_lead_cards_v1_active_idx
  ON evidence_lead_cards_v1 (
    workspace_id, status, valid_until DESC, generated_at DESC, id DESC
  )
  WHERE status IN ('qualified', 'review');

CREATE OR REPLACE FUNCTION validate_evidence_score_scope_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  requested_count INTEGER;
  matched_count INTEGER;
BEGIN
  SELECT COUNT(DISTINCT event_id)::INTEGER
  INTO requested_count
  FROM UNNEST(NEW.source_event_ids) AS requested(event_id);
  IF requested_count <> CARDINALITY(NEW.source_event_ids) THEN
    RAISE EXCEPTION 'score source event ids must be unique';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO matched_count
  FROM evidence_events_v1 AS event
  WHERE event.id = ANY(NEW.source_event_ids)
    AND event.workspace_id = NEW.workspace_id
    AND event.organization_id = NEW.organization_id;
  IF matched_count <> CARDINALITY(NEW.source_event_ids) THEN
    RAISE EXCEPTION 'score evidence must belong to one workspace and organization';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_lead_score_snapshots_v1_validate_scope
BEFORE INSERT ON evidence_lead_score_snapshots_v1
FOR EACH ROW EXECUTE FUNCTION validate_evidence_score_scope_v1();

CREATE TRIGGER evidence_lead_score_snapshots_v1_append_only
BEFORE UPDATE OR DELETE ON evidence_lead_score_snapshots_v1
FOR EACH ROW EXECUTE FUNCTION reject_evidence_radar_history_mutation();

CREATE TRIGGER public_contact_paths_v1_append_only
BEFORE UPDATE OR DELETE ON public_contact_paths_v1
FOR EACH ROW EXECUTE FUNCTION reject_evidence_radar_history_mutation();

CREATE OR REPLACE FUNCTION validate_evidence_lead_card_scope_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  requested_events INTEGER;
  matched_events INTEGER;
  requested_contacts INTEGER;
  matched_contacts INTEGER;
BEGIN
  SELECT COUNT(DISTINCT event_id)::INTEGER
  INTO requested_events
  FROM UNNEST(NEW.evidence_event_ids) AS requested(event_id);
  IF requested_events <> CARDINALITY(NEW.evidence_event_ids) THEN
    RAISE EXCEPTION 'lead card evidence event ids must be unique';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO matched_events
  FROM evidence_events_v1 AS event
  WHERE event.id = ANY(NEW.evidence_event_ids)
    AND event.workspace_id = NEW.workspace_id
    AND event.organization_id = NEW.organization_id;
  IF matched_events <> CARDINALITY(NEW.evidence_event_ids) THEN
    RAISE EXCEPTION 'lead card evidence must belong to one workspace and organization';
  END IF;

  SELECT COUNT(DISTINCT contact_id)::INTEGER
  INTO requested_contacts
  FROM UNNEST(NEW.contact_path_ids) AS requested(contact_id);
  IF requested_contacts <> CARDINALITY(NEW.contact_path_ids) THEN
    RAISE EXCEPTION 'lead card contact path ids must be unique';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO matched_contacts
  FROM public_contact_paths_v1 AS contact
  WHERE contact.id = ANY(NEW.contact_path_ids)
    AND contact.workspace_id = NEW.workspace_id
    AND contact.organization_id = NEW.organization_id;
  IF matched_contacts <> CARDINALITY(NEW.contact_path_ids) THEN
    RAISE EXCEPTION 'lead card contacts must belong to one workspace and organization';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_lead_cards_v1_validate_scope
BEFORE INSERT ON evidence_lead_cards_v1
FOR EACH ROW EXECUTE FUNCTION validate_evidence_lead_card_scope_v1();

CREATE TRIGGER evidence_lead_cards_v1_append_only
BEFORE UPDATE OR DELETE ON evidence_lead_cards_v1
FOR EACH ROW EXECUTE FUNCTION reject_evidence_radar_history_mutation();

COMMIT;
