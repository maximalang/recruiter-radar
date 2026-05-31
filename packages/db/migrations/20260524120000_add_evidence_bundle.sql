-- Phase 2 — Evidence bundle first-class.
--
-- Stores normalised evidence items used by FIUR scoring and confidence gates.
-- Back-compat: lead_id / org_id are nullable so the writer can land evidence
-- before a lead exists (gate D context-only path) and so existing leads
-- without bundles are not affected.
--
-- Idempotency: content_hash is unique per (org_id, content_hash) pair so a
-- replayed adapter never duplicates evidence for the same company. NULL
-- org_id evidence is allowed (orphan context) and de-duplicated by hash
-- alone via a partial index.

CREATE TABLE IF NOT EXISTS evidence_items (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT REFERENCES orgs(id) ON DELETE CASCADE,
  lead_id BIGINT REFERENCES leads(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  content_hash TEXT NOT NULL,
  tier TEXT NOT NULL,
  payload_ref JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT evidence_items_source_not_blank CHECK (BTRIM(source) <> ''),
  CONSTRAINT evidence_items_url_not_blank CHECK (BTRIM(url) <> ''),
  CONSTRAINT evidence_items_content_hash_format
    CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT evidence_items_tier_check
    CHECK (tier IN ('direct', 'corroboration', 'context'))
);

CREATE UNIQUE INDEX IF NOT EXISTS evidence_items_org_hash_uidx
  ON evidence_items (org_id, content_hash)
  WHERE org_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS evidence_items_orphan_hash_uidx
  ON evidence_items (content_hash)
  WHERE org_id IS NULL;

CREATE INDEX IF NOT EXISTS evidence_items_org_fetched_idx
  ON evidence_items (org_id, fetched_at DESC)
  WHERE org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS evidence_items_lead_fetched_idx
  ON evidence_items (lead_id, fetched_at DESC)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS evidence_items_content_hash_idx
  ON evidence_items (content_hash);
