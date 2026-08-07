BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE OR REPLACE FUNCTION validate_evidence_score_temporal_trust_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  reference_time TIMESTAMPTZ := GREATEST(NEW.created_at, NOW());
  invalid_events INTEGER;
  invalid_signals INTEGER;
  invalid_correlations INTEGER;
  event_horizon TIMESTAMPTZ;
  signal_horizon TIMESTAMPTZ;
  correlation_horizon TIMESTAMPTZ;
  evidence_horizon TIMESTAMPTZ;
BEGIN
  SELECT
    COUNT(*) FILTER (
      WHERE event.verification_status <> 'verified'
         OR event.valid_until < reference_time
         OR event.detected_at > NEW.created_at
         OR event.confidence <= 0
    )::INTEGER,
    MIN(event.valid_until)
  INTO invalid_events, event_horizon
  FROM evidence_events_v1 AS event
  WHERE event.id = ANY(NEW.source_event_ids)
    AND event.workspace_id = NEW.workspace_id
    AND event.organization_id = NEW.organization_id;

  IF invalid_events > 0 THEN
    RAISE EXCEPTION 'score evidence must be verified, live and observed by snapshot time';
  END IF;

  SELECT
    COUNT(*) FILTER (
      WHERE signal.valid_until < reference_time
         OR signal.started_at > NEW.created_at
         OR signal.last_seen_at > NEW.created_at
         OR signal.confidence <= 0
         OR signal.strength <= 0
    )::INTEGER,
    MIN(signal.valid_until)
  INTO invalid_signals, signal_horizon
  FROM normalized_signals_v1 AS signal
  WHERE signal.id = ANY(NEW.source_signal_ids)
    AND signal.workspace_id = NEW.workspace_id
    AND signal.organization_id = NEW.organization_id;

  IF invalid_signals > 0 THEN
    RAISE EXCEPTION 'score signals must be live, positive-strength and observed by snapshot time';
  END IF;

  SELECT
    COUNT(*) FILTER (
      WHERE correlation.valid_until < reference_time
         OR correlation.created_at > NEW.created_at
    )::INTEGER,
    MIN(correlation.valid_until)
  INTO invalid_correlations, correlation_horizon
  FROM evidence_correlations_v1 AS correlation
  WHERE correlation.id = ANY(NEW.source_correlation_ids)
    AND correlation.workspace_id = NEW.workspace_id
    AND correlation.organization_id = NEW.organization_id;

  IF invalid_correlations > 0 THEN
    RAISE EXCEPTION 'score correlations must be live and available by snapshot time';
  END IF;

  evidence_horizon := LEAST(event_horizon, signal_horizon);
  IF correlation_horizon IS NOT NULL THEN
    evidence_horizon := LEAST(evidence_horizon, correlation_horizon);
  END IF;

  IF evidence_horizon IS NOT NULL AND NEW.valid_until > evidence_horizon THEN
    RAISE EXCEPTION 'score validity cannot outlive its evidence, signal or correlation horizon';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_lead_score_snapshots_v1_validate_temporal_trust
BEFORE INSERT ON evidence_lead_score_snapshots_v1
FOR EACH ROW EXECUTE FUNCTION validate_evidence_score_temporal_trust_v1();

CREATE OR REPLACE FUNCTION validate_evidence_lead_qualification_trust_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  score_created_at TIMESTAMPTZ;
  score_valid_until TIMESTAMPTZ;
  identity_status TEXT;
  location_status TEXT;
  location_latitude DOUBLE PRECISION;
  location_longitude DOUBLE PRECISION;
  location_confidence DOUBLE PRECISION;
  invalid_events INTEGER;
  invalid_contacts INTEGER;
  card_evidence_horizon TIMESTAMPTZ;
BEGIN
  SELECT score.created_at, score.valid_until
  INTO score_created_at, score_valid_until
  FROM evidence_lead_score_snapshots_v1 AS score
  WHERE score.id = NEW.score_snapshot_id
    AND score.workspace_id = NEW.workspace_id
    AND score.organization_id = NEW.organization_id;

  IF score_valid_until IS NOT NULL THEN
    IF NEW.generated_at < score_created_at THEN
      RAISE EXCEPTION 'lead card cannot predate its score snapshot';
    END IF;
    IF NEW.valid_until > score_valid_until THEN
      RAISE EXCEPTION 'lead card validity cannot outlive its score snapshot';
    END IF;
  END IF;

  IF NEW.recommended_contact_at IS NOT NULL
     AND (NEW.recommended_contact_at < NEW.generated_at OR NEW.recommended_contact_at > NEW.valid_until) THEN
    RAISE EXCEPTION 'recommended contact time must be inside the lead card validity window';
  END IF;

  IF NEW.status <> 'qualified' THEN
    RETURN NEW;
  END IF;

  SELECT identity.resolution_status
  INTO identity_status
  FROM organization_identity_profiles_v1 AS identity
  WHERE identity.workspace_id = NEW.workspace_id
    AND identity.organization_id = NEW.organization_id;

  IF identity_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'qualified lead requires verified organization identity';
  END IF;

  IF NEW.location_id IS NULL THEN
    RAISE EXCEPTION 'qualified Evidence Radar lead requires a verified location';
  END IF;

  SELECT
    location.verification_status,
    location.latitude,
    location.longitude,
    location.geo_confidence
  INTO location_status, location_latitude, location_longitude, location_confidence
  FROM organization_locations_v1 AS location
  WHERE location.id = NEW.location_id
    AND location.workspace_id = NEW.workspace_id
    AND location.organization_id = NEW.organization_id;

  IF location_status IS DISTINCT FROM 'verified'
     OR location_latitude IS NULL
     OR location_longitude IS NULL
     OR COALESCE(location_confidence, 0) <= 0 THEN
    RAISE EXCEPTION 'qualified Evidence Radar lead requires verified geocoded location evidence';
  END IF;

  SELECT
    COUNT(*) FILTER (
      WHERE event.verification_status <> 'verified'
         OR event.valid_until < NEW.generated_at
         OR event.confidence <= 0
    )::INTEGER,
    MIN(event.valid_until)
  INTO invalid_events, card_evidence_horizon
  FROM evidence_events_v1 AS event
  WHERE event.id = ANY(NEW.evidence_event_ids)
    AND event.workspace_id = NEW.workspace_id
    AND event.organization_id = NEW.organization_id;

  IF invalid_events > 0 THEN
    RAISE EXCEPTION 'qualified lead evidence must be verified and live';
  END IF;
  IF card_evidence_horizon IS NOT NULL AND NEW.valid_until > card_evidence_horizon THEN
    RAISE EXCEPTION 'qualified lead validity cannot outlive card evidence';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO invalid_contacts
  FROM public_contact_paths_v1 AS contact
  WHERE contact.id = ANY(NEW.contact_path_ids)
    AND contact.workspace_id = NEW.workspace_id
    AND contact.organization_id = NEW.organization_id
    AND contact.verification_status <> 'verified';

  IF invalid_contacts > 0 THEN
    RAISE EXCEPTION 'qualified lead cannot expose unverified or rejected contact paths';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_lead_cards_v1_validate_qualification_trust
BEFORE INSERT ON evidence_lead_cards_v1
FOR EACH ROW EXECUTE FUNCTION validate_evidence_lead_qualification_trust_v1();

COMMIT;