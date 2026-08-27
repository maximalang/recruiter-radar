-- rf-identity-boundary-hardening (task t_935b4dcc): reconcile EXISTING
-- org_source_refs rows to the canonical trusted-key contract before the digest
-- corroboration CTE stops honoring weak forms (migration
-- 20260826100000_add_rr_identity_validation_functions.sql +
-- source-digest-evidence.sql now apply the same gates).
--
-- Policy (matches classifyStrongIdentityKey / adapters/organization-resolution.mjs):
--   1. CANONICALIZE domain variants that only need normalization to reach the
--      canonical form (e.g. 'domain:WWW.Example.RU' → 'domain:example.ru').
--      Behavior-preserving renames of values current writers produce anyway.
--   2. QUARANTINE every remaining strong-key row that cannot pass the gate
--      (bad INN/OGRN checksums, wrong digit counts, platform/suffix/IP/punycode
--      hosts, ports, paths, punycode, mixed-case prefixes, trailing whitespace,
--      other corruption). Quarantine = explicit
--      ' [legacy-key-quarantined:20260826100100]' suffix on source_key (never
--      deleted, fully auditable, excluded from every downstream strong-key
--      consumer by construction) plus a structured metadata.quarantine record.
--      Rows are NOT deleted; legal identifiers on orgs/signals stay untouched;
--      operators repair via re-ingest of a corrected key.
--   3. Duplicate prevention: when several variants collapse onto the same
--      canonical target inside one (source, target_key) group, an
--      already-canonical row wins; otherwise the lowest org_id wins. Losing
--      rows are quarantined below instead of silently merged or dropped.
--   4. Guard rail: fail closed (abort the whole migrate.mjs transaction) if the
--      quarantine batch exceeds 5000 rows — at that scale something structural
--      is wrong and a human should review before any automated rewrite.
--
-- Runs inside the migrate.mjs transaction; uniquely-named objects only.

-- -----------------------------------------------------------------
-- Phase 1: canonicalize recoverable domain variants.
-- -----------------------------------------------------------------
-- Serialize the cleanup against all org_source_refs writers. Without this
-- relation lock a concurrent legacy insert could commit between the scan and
-- trigger installation, leaving one unvalidated strong key behind.
LOCK TABLE org_source_refs IN SHARE ROW EXCLUSIVE MODE;

WITH candidates AS (
  SELECT
    ref.org_id,
    ref.ctid AS rid,
    ref.source AS src,
    'domain:' || rr_canonical_company_domain(substring(ref.source_key FROM 8)) AS target_key,
    (
      substring(ref.source_key FROM 8)
      = rr_canonical_company_domain(substring(ref.source_key FROM 8))
    ) AS already_canonical
  FROM org_source_refs AS ref
  WHERE ref.source_key LIKE 'domain:%'
    AND NOT (
      RIGHT(ref.source_key, LENGTH(' [legacy-key-quarantined:20260826100100]'))
        = ' [legacy-key-quarantined:20260826100100]'
      AND ref.metadata->'quarantine'->>'migration'
        = '20260826100100_quarantine_legacy_source_keys'
    )
    AND rr_is_trusted_domain_key(ref.source_key) = false
    AND rr_is_trusted_domain_key('domain:' || rr_canonical_company_domain(substring(ref.source_key FROM 8))) = true
    -- Canonical-target collision guard: if a row with the exact canonical
    -- target bytes ALREADY exists for this (source, target), renaming would
    -- violate org_source_refs_source_key_uidx. Those variants keep their key
    -- here and fall through to the phase-2 quarantine instead of renaming.
    AND NOT EXISTS (
      SELECT 1
      FROM org_source_refs AS existing
      WHERE existing.source = ref.source
        AND existing.source_key = 'domain:' || rr_canonical_company_domain(substring(ref.source_key FROM 8))
    )
),
winners AS (
  SELECT DISTINCT ON (c.src, c.target_key) c.rid, c.target_key
  FROM candidates AS c
  ORDER BY c.src, c.target_key, c.already_canonical DESC, c.org_id ASC
)
UPDATE org_source_refs AS ref
SET source_key = w.target_key
FROM winners AS w
WHERE ref.ctid = w.rid;

-- -----------------------------------------------------------------
-- Phase 2: quarantine all remaining nonconforming strong-key rows.
-- Atomic: rows are re-checked under the migrating transaction so concurrent
-- writers cannot slip new weak keys between scan and mark; the guard trigger
-- installed in phase 3 makes such writes impossible going forward.
-- -----------------------------------------------------------------
DO $quarantine_batch$
DECLARE
  quarantine_count bigint;
BEGIN
  WITH quarantined AS (
    UPDATE org_source_refs AS ref
    SET source_key = ref.source_key || ' [legacy-key-quarantined:20260826100100]',
        metadata = COALESCE(ref.metadata, '{}'::jsonb) || jsonb_build_object(
          'quarantine', jsonb_build_object(
            'reason', 'legacy-nonconforming-source-key',
            'migration', '20260826100100_quarantine_legacy_source_keys',
            'original_key', ref.source_key,
            'at', NOW()
          )
        )
    WHERE NOT (
        RIGHT(ref.source_key, LENGTH(' [legacy-key-quarantined:20260826100100]'))
          = ' [legacy-key-quarantined:20260826100100]'
        AND ref.metadata->'quarantine'->>'migration'
          = '20260826100100_quarantine_legacy_source_keys'
      )
      AND (
        (left(lower(ref.source_key), 4) = 'inn:' AND NOT rr_is_trusted_inn_key(ref.source_key))
        OR (left(lower(ref.source_key), 5) = 'ogrn:' AND NOT rr_is_trusted_ogrn_key(ref.source_key))
        OR (left(lower(ref.source_key), 7) = 'domain:' AND NOT rr_is_trusted_domain_key(ref.source_key))
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO quarantine_count FROM quarantined;

  IF quarantine_count > 5000 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'rf-identity-boundary-hardening: %s org_source_refs rows failed the trusted-key gate; manual review required before applying this migration programmatically.',
        quarantine_count
      ),
      HINT = 'Inspect rows where rr_is_trusted_*_key(source_key) = false, repair via re-ingest of corrected keys, then re-run the migration.';
  END IF;

  RAISE NOTICE 'quarantine marked % legacy rows', quarantine_count;
END
$quarantine_batch$;

-- -----------------------------------------------------------------
-- Phase 3: runtime guard — today's strict ingest boundary always writes
-- canonical keys (resolveOrganizationOwner), so make that invariant durable
-- for ALL future writers of this table: reject strong-key inserts/updates
-- that bypass the canonical gates. Weak company-name:/employer:/org:/custom
-- keys are intentionally out of scope for this trigger.
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION rr_org_source_refs_enforce_canonical_keys()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.source_key IS NOT NULL
    AND (
      (left(lower(NEW.source_key), 4) = 'inn:' AND NOT rr_is_trusted_inn_key(NEW.source_key))
      OR (left(lower(NEW.source_key), 5) = 'ogrn:' AND NOT rr_is_trusted_ogrn_key(NEW.source_key))
      OR (left(lower(NEW.source_key), 7) = 'domain:' AND NOT rr_is_trusted_domain_key(NEW.source_key))
    )
  THEN
    RAISE EXCEPTION
      'rr-org-source-refs-cannot-add-failed-gate-key: refusing nonconforming key (%) via %.%',
      NEW.source_key,
      TG_TABLE_SCHEMA,
      TG_TABLE_NAME
      USING HINT = 'Persist validated keys via the standard ingest identity boundary (classifyStrongIdentityKey / rr_is_trusted_*_key).';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS rr_org_source_refs_trust_guard ON org_source_refs;

CREATE TRIGGER rr_org_source_refs_trust_guard
BEFORE INSERT OR UPDATE OF source_key ON org_source_refs
FOR EACH ROW EXECUTE FUNCTION rr_org_source_refs_enforce_canonical_keys();

COMMENT ON FUNCTION rr_org_source_refs_enforce_canonical_keys() IS
  'rf-identity-boundary-hardening: rejects strong-key writes that fail the canonical rr_is_trusted_*_key gates';
