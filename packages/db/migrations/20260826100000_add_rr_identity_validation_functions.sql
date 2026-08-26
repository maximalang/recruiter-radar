-- rf-identity-boundary-hardening (task t_935b4dcc): canonical trusted key gate as
-- SQL functions, mirroring classifyStrongIdentityKey from
-- packages/db/scripts/adapters/organization-resolution.mjs. The digest corroboration
-- CTE (source-digest-evidence.sql) previously re-classified persisted source keys
-- with its own weaker inline rules, so the strict write boundary was silently
-- weakened at the read boundary. All trust decisions for inn:/ogrn:/domain: keys now
-- resolve to these functions; callers must use them instead of inlining their own
-- prefix/format checks.
--
-- Semantics locked to organization-resolution.mjs (verified pairwise by
-- verify-source-subsystem-db.mjs):
--   inn:   'inn:' + exactly 10 digits passing the legal-entity checksum
--          weights [2,4,10,3,5,9,4,6,8], sum %11%10 == last digit.
--   ogrn:  'ogrn:' + exactly 13 digits, numeric value of first 12 digits
--          %11%10 == last digit.
--   domain 'domain:' + canonical company domain: lowercase host, max 253 chars,
--          at least two labels, corporate subdomain prefixes (www/career/careers/
--          job/jobs/hr/vacancy/vacancies) stripped from multi-label hosts, every
--          label non-empty <=63 chars matching [a-z0-9](?:[a-z0-9-]*[a-z0-9])?,
--          no '..', no trailing dot, no port/space/url punctuation, no punycode
--          ('xn--'), not an IP literal, not a public suffix, not a platform or
--          subdomain-of-platform host.
--
-- Pure functions, no DDL objects besides themselves. Single transaction safe.

CREATE OR REPLACE FUNCTION rr_is_trusted_inn_key(value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $fn$
DECLARE
  digits text;
  weights int[] := ARRAY[2, 4, 10, 3, 5, 9, 4, 6, 8];
  total bigint := 0;
BEGIN
  IF value IS NULL OR length(value) <> 14 OR left(value, 4) <> 'inn:' THEN
    RETURN false;
  END IF;
  digits := substring(value FROM 5);
  IF digits !~ '^[0-9]{10}$' THEN
    RETURN false;
  END IF;
  FOR i IN 1 .. 9 LOOP
    total := total + substring(digits FROM i FOR 1)::int * weights[i];
  END LOOP;
  RETURN (total % 11 % 10) = substring(digits FROM 10 FOR 1)::int;
END;
$fn$;

CREATE OR REPLACE FUNCTION rr_is_trusted_ogrn_key(value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $fn$
DECLARE
  digits text;
  total bigint := 0;
BEGIN
  IF value IS NULL OR length(value) <> 18 OR left(value, 5) <> 'ogrn:' THEN
    RETURN false;
  END IF;
  digits := substring(value FROM 6);
  IF digits !~ '^[0-9]{13}$' THEN
    RETURN false;
  END IF;
  -- Horner accumulation of the first 12 digits (max 12^13... i.e. fits bigint),
  -- mirroring Node's BigInt(first12) % 11 % 10 exactly.
  FOR i IN 1 .. 12 LOOP
    total := total * 10 + substring(digits FROM i FOR 1)::int;
  END LOOP;
  RETURN (total % 11 % 10) = substring(digits FROM 13 FOR 1)::int;
END;
$fn$;

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
    'co.uk', 'org.uk', 'gov.uk', 'ac.uk',
    'com.au', 'net.au', 'org.au',
    'co.jp', 'co.kr', 'com.cn', 'com.br', 'com.tr'
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

  IF domain = ANY (public_suffixes) THEN
    RETURN NULL;
  END IF;

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

CREATE OR REPLACE FUNCTION rr_is_trusted_domain_key(value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $fn$
DECLARE
  canonical text;
BEGIN
  IF left(value, 7) <> 'domain:' THEN
    RETURN false;
  END IF;
  canonical := rr_canonical_company_domain(substring(value FROM 8));
  IF canonical IS NULL THEN
    RETURN false;
  END IF;
  RETURN value = 'domain:' || canonical;
END;
$fn$;

COMMENT ON FUNCTION rr_is_trusted_inn_key(text) IS
  'rf-identity-boundary-hardening: canonical INN source-key trust gate (mirror of classifyStrongIdentityKey)';
COMMENT ON FUNCTION rr_is_trusted_ogrn_key(text) IS
  'rf-identity-boundary-hardening: canonical OGRN source-key trust gate (mirror of classifyStrongIdentityKey)';
COMMENT ON FUNCTION rr_canonical_company_domain(text) IS
  'rf-identity-boundary-hardening: canonical company-domain normalizer shared by domain key gate';
COMMENT ON FUNCTION rr_is_trusted_domain_key(text) IS
  'rf-identity-boundary-hardening: canonical DOMAIN source-key trust gate (mirror of classifyStrongIdentityKey)';
