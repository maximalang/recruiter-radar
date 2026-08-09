CREATE TABLE email_delivery_health_events (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  configuration_fingerprint TEXT NOT NULL,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT email_delivery_health_provider_check
    CHECK (provider IN ('postbox', 'smtp')),
  CONSTRAINT email_delivery_health_fingerprint_check
    CHECK (configuration_fingerprint ~ '^[a-f0-9]{64}$')
);

CREATE INDEX email_delivery_health_lookup_idx
  ON email_delivery_health_events (
    provider,
    configuration_fingerprint,
    delivered_at DESC
  );
