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
  source_signal_ids BIGINT[] NOT NULL,
  source_correlation_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
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
  CONSTRAINT evidence_lead_score_snapshots_v1_signals_check
    CHECK (CARDINALITY(source_signal_ids) > 0),
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
    OR href ~* '^mailto:(info|hello|hr|jobs|career|careers|recruit|recruiting|talent|office|contact)([._+-][a-z0-9-]+)?@[^@[:space:]]+$'
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
  location_id BIGINT,
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
  provided_families TEXT[];
  expected_families TEXT[];
  invalid_contributions INTEGER;
  component_key TEXT;
  hiring_intent DOUBLE PRECISION;
  component_confidence DOUBLE PRECISION;
  freshness DOUBLE PRECISION;
  component_urgency DOUBLE PRECISION;
  commercial_fit DOUBLE PRECISION;
  component_contactability DOUBLE PRECISION;
  component_risk DOUBLE PRECISION;
  expected_opportunity DOUBLE PRECISION;
  expected_lead DOUBLE PRECISION;
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

  SELECT ARRAY_AGG(DISTINCT source_family ORDER BY source_family)
  INTO expected_families
  FROM evidence_events_v1 AS event
  WHERE event.id = ANY(NEW.source_event_ids)
    AND event.workspace_id = NEW.workspace_id
    AND event.organization_id = NEW.organization_id;
  SELECT ARRAY_AGG(DISTINCT family ORDER BY family)
  INTO provided_families
  FROM UNNEST(NEW.independent_source_families) AS supplied(family);
  IF CARDINALITY(provided_families) <> CARDINALITY(NEW.independent_source_families)
     OR expected_families IS DISTINCT FROM provided_families THEN
    RAISE EXCEPTION 'score independent source families must equal evidence provenance';
  END IF;

  SELECT COUNT(DISTINCT signal_id)::INTEGER
  INTO requested_count
  FROM UNNEST(NEW.source_signal_ids) AS requested(signal_id);
  IF requested_count <> CARDINALITY(NEW.source_signal_ids) THEN
    RAISE EXCEPTION 'score source signal ids must be unique';
  END IF;
  SELECT COUNT(*)::INTEGER
  INTO matched_count
  FROM normalized_signals_v1 AS signal
  WHERE signal.id = ANY(NEW.source_signal_ids)
    AND signal.workspace_id = NEW.workspace_id
    AND signal.organization_id = NEW.organization_id;
  IF matched_count <> CARDINALITY(NEW.source_signal_ids) THEN
    RAISE EXCEPTION 'score signals must belong to one workspace and organization';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM normalized_signals_v1 AS signal
    WHERE signal.id = ANY(NEW.source_signal_ids)
      AND signal.workspace_id = NEW.workspace_id
      AND signal.organization_id = NEW.organization_id
      AND NOT EXISTS (
        SELECT 1
        FROM normalized_signal_event_links_v1 AS link
        WHERE link.signal_id = signal.id
          AND link.workspace_id = NEW.workspace_id
          AND link.organization_id = NEW.organization_id
          AND link.evidence_event_id = ANY(NEW.source_event_ids)
      )
  ) THEN
    RAISE EXCEPTION 'every scored signal must be linked to scored evidence';
  END IF;

  SELECT COUNT(DISTINCT correlation_id)::INTEGER
  INTO requested_count
  FROM UNNEST(NEW.source_correlation_ids) AS requested(correlation_id);
  IF requested_count <> CARDINALITY(NEW.source_correlation_ids) THEN
    RAISE EXCEPTION 'score source correlation ids must be unique';
  END IF;
  SELECT COUNT(*)::INTEGER
  INTO matched_count
  FROM evidence_correlations_v1 AS correlation
  WHERE correlation.id = ANY(NEW.source_correlation_ids)
    AND correlation.workspace_id = NEW.workspace_id
    AND correlation.organization_id = NEW.organization_id;
  IF matched_count <> CARDINALITY(NEW.source_correlation_ids) THEN
    RAISE EXCEPTION 'score correlations must belong to one workspace and organization';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM evidence_correlations_v1 AS correlation
    WHERE correlation.id = ANY(NEW.source_correlation_ids)
      AND correlation.workspace_id = NEW.workspace_id
      AND correlation.organization_id = NEW.organization_id
      AND NOT correlation.signal_ids <@ NEW.source_signal_ids
  ) THEN
    RAISE EXCEPTION 'score correlations must be composed from scored signals';
  END IF;

  FOREACH component_key IN ARRAY ARRAY[
    'hiringIntent', 'confidence', 'freshness', 'urgency',
    'commercialFit', 'contactability', 'risk'
  ]::TEXT[] LOOP
    IF JSONB_TYPEOF(NEW.components->component_key) <> 'number'
       OR (NEW.components->>component_key)::DOUBLE PRECISION NOT BETWEEN 0 AND 1 THEN
      RAISE EXCEPTION 'score component % must be numeric within [0,1]', component_key;
    END IF;
  END LOOP;

  hiring_intent := (NEW.components->>'hiringIntent')::DOUBLE PRECISION;
  component_confidence := (NEW.components->>'confidence')::DOUBLE PRECISION;
  freshness := (NEW.components->>'freshness')::DOUBLE PRECISION;
  component_urgency := (NEW.components->>'urgency')::DOUBLE PRECISION;
  commercial_fit := (NEW.components->>'commercialFit')::DOUBLE PRECISION;
  component_contactability := (NEW.components->>'contactability')::DOUBLE PRECISION;
  component_risk := (NEW.components->>'risk')::DOUBLE PRECISION;
  expected_opportunity := hiring_intent * component_confidence * freshness
    * component_urgency * commercial_fit * component_contactability * 100;
  expected_lead := GREATEST(0, expected_opportunity - component_risk * 35);

  IF ABS(NEW.opportunity_score - expected_opportunity) > .11
     OR ABS(NEW.lead_score - expected_lead) > .11
     OR ABS(NEW.confidence_score - component_confidence * 100) > .11
     OR ABS(NEW.urgency_score - component_urgency * 100) > .11
     OR ABS(NEW.contactability_score - component_contactability * 100) > .11
     OR ABS(NEW.risk_score - component_risk * 100) > .11 THEN
    RAISE EXCEPTION 'persisted Evidence Radar scores do not reproduce component formula';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO invalid_contributions
  FROM JSONB_ARRAY_ELEMENTS(NEW.contributions) AS contribution(item)
  WHERE JSONB_TYPEOF(item) <> 'object'
     OR COALESCE(item->>'eventId', '') !~ '^[1-9][0-9]*$'
     OR CASE
          WHEN COALESCE(item->>'eventId', '') ~ '^[1-9][0-9]*$'
            THEN NOT ((item->>'eventId')::BIGINT = ANY(NEW.source_event_ids))
          ELSE FALSE
        END
     OR COALESCE(item->>'component', '') NOT IN (
       'hiring_intent', 'confidence', 'freshness', 'urgency',
       'commercial_fit', 'contactability', 'risk'
     )
     OR JSONB_TYPEOF(item->'delta') <> 'number'
     OR BTRIM(COALESCE(item->>'reason', '')) = '';
  IF invalid_contributions > 0 THEN
    RAISE EXCEPTION 'score contribution ledger contains invalid or unscoped entries';
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
  score_events BIGINT[];
  score_correlations BIGINT[];
  score_families TEXT[];
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

  SELECT source_event_ids, source_correlation_ids, independent_source_families
  INTO score_events, score_correlations, score_families
  FROM evidence_lead_score_snapshots_v1 AS score
  WHERE score.id = NEW.score_snapshot_id
    AND score.workspace_id = NEW.workspace_id
    AND score.organization_id = NEW.organization_id;
  IF score_events IS NULL OR NOT score_events <@ NEW.evidence_event_ids THEN
    RAISE EXCEPTION 'lead card must preserve every evidence event used by its score';
  END IF;
  IF NEW.status = 'qualified'
     AND (CARDINALITY(score_correlations) < 1 OR CARDINALITY(score_families) < 2) THEN
    RAISE EXCEPTION 'qualified lead requires correlation and two independent source families';
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
