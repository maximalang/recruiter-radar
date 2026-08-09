CREATE TABLE entitlement_grants (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  plan_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  features TEXT[] NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT entitlement_grants_source_check
    CHECK (source IN ('admin', 'trial', 'pilot', 'promo')),
  CONSTRAINT entitlement_grants_status_check
    CHECK (status IN ('active', 'revoked')),
  CONSTRAINT entitlement_grants_plan_not_blank
    CHECK (BTRIM(plan_code) <> ''),
  CONSTRAINT entitlement_grants_features_not_empty
    CHECK (CARDINALITY(features) > 0),
  CONSTRAINT entitlement_grants_features_known
    CHECK (features <@ ARRAY['dashboard', 'api', 'digest', 'delivery']::TEXT[]),
  CONSTRAINT entitlement_grants_window_check
    CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT entitlement_grants_revocation_check
    CHECK (
      (status = 'active' AND revoked_at IS NULL)
      OR (status = 'revoked' AND revoked_at IS NOT NULL)
    )
);

CREATE INDEX entitlement_grants_effective_user_idx
  ON entitlement_grants (user_id, ends_at DESC)
  WHERE status = 'active';

CREATE INDEX entitlement_grants_audit_user_idx
  ON entitlement_grants (user_id, created_at DESC);

CREATE UNIQUE INDEX entitlement_grants_active_user_source_uidx
  ON entitlement_grants (user_id, source)
  WHERE status = 'active';

INSERT INTO entitlement_grants (
  user_id,
  source,
  plan_code,
  status,
  features,
  starts_at,
  ends_at,
  revoked_at,
  created_at,
  updated_at
)
SELECT
  pilot.user_id,
  'admin',
  CASE
    WHEN pilot.ends_at IS NULL THEN 'legacy-admin-review-required'
    ELSE 'legacy-admin-pilot'
  END,
  CASE WHEN pilot.ends_at IS NULL THEN 'revoked' ELSE 'active' END,
  ARRAY['dashboard', 'api', 'digest', 'delivery']::TEXT[],
  pilot.starts_at,
  pilot.ends_at,
  CASE WHEN pilot.ends_at IS NULL THEN CURRENT_TIMESTAMP ELSE NULL END,
  pilot.created_at,
  pilot.updated_at
FROM pilot_enrollments AS pilot
WHERE pilot.status = 'active'
  AND pilot.activated_by = 'admin'
  AND (pilot.ends_at IS NULL OR pilot.ends_at > CURRENT_TIMESTAMP);
