-- rf-identity-boundary-hardening (task t_935b4dcc): extend the canonical domain
-- trust boundary without rewriting the already-applied 20260826100000 migration.
--
-- The original domain validator rejected known platform domains but accepted
-- tenant domains below shared hosting zones and selected public-suffix zones.
-- This migration updates the canonicalizer, quarantines existing rows that now
-- fail the gate, and leaves the existing org_source_refs trigger in place so
-- future writes use the new policy through rr_is_trusted_domain_key().
--
-- The explicit suffix policy is duplicated in
-- packages/db/scripts/adapters/organization-resolution.mjs and exercised by the
-- source identity boundary verifier in a disposable PostgreSQL database.

CREATE OR REPLACE FUNCTION rr_canonical_company_domain(raw_domain text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $fn$
DECLARE
  value text;
  labels text[];
  cleaned_labels text[];
  label text;
  domain text;
  public_suffixes text[] := ARRAY[
    'ac.uk', 'co.uk', 'gov.uk', 'org.uk',
    'ac.jp', 'co.jp', 'go.jp', 'ne.jp', 'or.jp',
    'ac.kr', 'co.kr', 'go.kr', 'ne.kr', 'or.kr',
    'ac.nz', 'co.nz', 'govt.nz', 'net.nz', 'org.nz',
    'ac.za', 'co.za', 'gov.za', 'net.za', 'org.za', 'web.za',
    'com.ar', 'com.au', 'com.bd', 'com.br', 'com.cn', 'com.co',
    'com.ec', 'com.hk', 'com.mx', 'com.my', 'com.pe', 'com.ph',
    'com.pk', 'com.sg', 'com.tr', 'com.tw', 'com.vn',
    'co.in', 'co.il', 'co.th', 'co.ug', 'co.ke', 'co.tz',
    'firm.in', 'gen.in', 'ind.in', 'net.in', 'org.in',
    'gov.au', 'net.au', 'org.au', 'edu.au',
    'gov.cn', 'net.cn', 'org.cn', 'edu.cn',
    'gov.sg', 'net.sg', 'org.sg', 'edu.sg',
    'gov.my', 'net.my', 'org.my', 'edu.my',
    'gov.pk', 'net.pk', 'org.pk', 'edu.pk',
    'gov.ph', 'net.ph', 'org.ph', 'edu.ph',
    'gov.tr', 'net.tr', 'org.tr', 'edu.tr',
    'gov.vn', 'net.vn', 'org.vn', 'edu.vn'
  ];
  multitenant_suffixes text[] := ARRAY[
    'appspot.com', 'azurewebsites.net', 'blogspot.com', 'blogspot.co.uk',
    'blogspot.de', 'blogspot.fr', 'blogspot.jp', 'blogspot.ru',
    'cargo.site', 'cloudfront.net', 'com.sg', 'co.in', 'co.za',
    'firebaseapp.com', 'fly.dev',
    'github.io', 'gitlab.io', 'glitch.me', 'herokuapp.com', 'myshopify.com',
    'netlify.app',
    'notion.site', 'notion.so', 'onrender.com', 'pages.dev', 'railway.app',
    'readthedocs.io', 'repl.co', 's3.amazonaws.com', 'stackblitz.io',
    'surge.sh', 'vercel.app', 'web.app', 'webflow.io', 'wixsite.com',
    'workers.dev'
  ];
  platform_domains text[] := ARRAY[
    'hh.ru', 'hhcdn.com', 'hh.kz', 'hh.ua', 'career.habr.com', 'habr.com',
    'superjob.ru', 'superjob.com', 'trudvsem.ru', 'linkedin.com', 'rabota.ru',
    'zarplata.ru', 'greenhouse.io', 'lever.co', 'workday.com',
    'myworkdayjobs.com', 'ashbyhq.com', 'jobvite.com', 'smartrecruiters.com',
    'bamboohr.com', 'workable.com', 'recruitee.com', 'breezy.hr',
    'teamtailor.com', 'personio.com', 'jazz.co', 'jobs.eu'
  ];
  corporate_prefixes text[] := ARRAY[
    'www', 'career', 'careers', 'job', 'jobs', 'hr', 'vacancy', 'vacancies'
  ];
BEGIN
  IF raw_domain IS NULL THEN
    RETURN NULL;
  END IF;

  value := lower(btrim(raw_domain));
  IF value = ''
    OR length(value) > 253
    OR right(value, 1) = '.'
    OR value ~ '[:/\\?#@\s]'
    OR strpos(value, '..') > 0
    OR strpos(value, 'xn--') > 0
    -- IP literal (mirrors isIP(value) !== 0 exactly): v4 dotted quads whose octets
    -- are all ≤255 are IPs; anything with a colon (v6) is an IP; 'a.b.c.d' with any
    -- octet >255 is NOT (isIP returns 0 and Node then treats it as a hostname).
    OR (
      value ~ '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'
      AND (
        SELECT bool_and(
          CASE
            -- node:net.isIP rejects leading-zero and >3-digit octets. Keep the
            -- cast behind CASE so a hostname such as 9999999999.1.1.1 cannot
            -- abort the query with an integer-out-of-range error.
            WHEN octet ~ '^(0|[1-9][0-9]{0,2})$' THEN octet::int <= 255
            ELSE false
          END
        )
        FROM unnest(string_to_array(value, '.')) AS octets(octet)
      )
    )
    OR strpos(value, ':') > 0
   THEN
    RETURN NULL;
  END IF;

  labels := string_to_array(value, '.');
  IF array_length(labels, 1) < 2 THEN
    RETURN NULL;
  END IF;

  FOREACH label IN ARRAY labels LOOP
    IF label = '' OR length(label) > 63 OR label !~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$' THEN
      RETURN NULL;
    END IF;
  END LOOP;

  IF array_length(labels, 1) > 2 AND labels[1] = ANY (corporate_prefixes) THEN
    cleaned_labels := labels[2:array_length(labels, 1)];
  ELSE
    cleaned_labels := labels;
  END IF;

  domain := array_to_string(cleaned_labels, '.');

  IF domain = ANY (public_suffixes) OR domain = ANY (multitenant_suffixes) THEN
    RETURN NULL;
  END IF;

  FOREACH label IN ARRAY multitenant_suffixes LOOP
    IF right(domain, length(label) + 1) = '.' || label THEN
      RETURN NULL;
    END IF;
  END LOOP;

  IF domain = ANY (platform_domains) THEN
    RETURN NULL;
  END IF;
  FOREACH label IN ARRAY platform_domains LOOP
    IF right(domain, length(label) + 1) = '.' || label THEN
      RETURN NULL;
    END IF;
  END LOOP;

  RETURN domain;
END;
$fn$;

LOCK TABLE org_source_refs IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE org_source_refs DISABLE TRIGGER rr_org_source_refs_trust_guard;

DO $quarantine_batch$
DECLARE
  quarantine_count bigint;
BEGIN
  WITH quarantined AS (
    UPDATE org_source_refs AS ref
    SET source_key = ref.source_key || ' [legacy-key-quarantined:20260827100000]',
        metadata = COALESCE(ref.metadata, '{}'::jsonb) || jsonb_build_object(
          'quarantine', jsonb_build_object(
            'reason', 'legacy-nonconforming-domain-source-key',
            'migration', '20260827100000_harden_rr_multitenant_domain_suffixes',
            'original_key', ref.source_key,
            'at', NOW()
          )
        )
    WHERE NOT (
        RIGHT(ref.source_key, LENGTH(' [legacy-key-quarantined:20260827100000]'))
          = ' [legacy-key-quarantined:20260827100000]'
        AND COALESCE(ref.metadata->'quarantine'->>'migration', '')
          = '20260827100000_harden_rr_multitenant_domain_suffixes'
      )
      -- A marker in source_key is not trusted by itself: legacy rows from the
      -- prior migration are skipped only when their structured audit metadata
      -- confirms the marker was produced by that migration.
      AND NOT (
        RIGHT(ref.source_key, LENGTH(' [legacy-key-quarantined:20260826100100]'))
          = ' [legacy-key-quarantined:20260826100100]'
        AND COALESCE(ref.metadata->'quarantine'->>'migration', '')
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
        'rf-identity-boundary-hardening: %s org_source_refs rows failed the multitenant/public-suffix domain gate; manual review required before applying this migration programmatically.',
        quarantine_count
      ),
      HINT = 'Inspect rows where rr_is_trusted_domain_key(source_key) = false, repair via re-ingest of corrected keys, then re-run the migration.';
  END IF;

  RAISE NOTICE 'multitenant/public-suffix domain quarantine marked % legacy rows', quarantine_count;
END
$quarantine_batch$;

ALTER TABLE org_source_refs ENABLE TRIGGER rr_org_source_refs_trust_guard;

COMMENT ON FUNCTION rr_canonical_company_domain(text) IS
  'rf-identity-boundary-hardening: canonical company-domain normalizer with explicit public-suffix and multitenant-host deny policy';
