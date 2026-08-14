# Source priority and promotion policy

The current per-source priority, eligibility, promotion, live state, and access requirements are
generated in [`source-status.generated.md`](source-status.generated.md). The authoritative policy
is `packages/db/source-policy.json`; prose cannot promote a source.

## Evidence order

1. Prefer explicit company-owned hiring surfaces and reviewed hosted ATS transports.
2. Use official vacancy platforms as independent hiring evidence.
3. Use company-owned pages, official registries, government datasets, and company-owned public channels to corroborate or add timing/context.
4. Never let generic business activity, media activity, repository activity, or social/video content manufacture direct hiring proof.

When sources disagree, prefer evidence closest to the company-controlled hiring surface, while
preserving every lineage item and negative signal. Entity resolution, dedupe, freshness, and
confidence gates still apply.

## Promotion rules

A source becomes independently deliverable only when canonical policy says both:

- lead eligibility permits lead origination; and
- promotion status is `digest-allowed`.

Implementation, fixture tests, HTTP reachability, a runnable adapter, or even live transport proof
does not promote a source by itself. Promotion requires lawful access, organization-level evidence,
normalization and dedupe proof, DB/evidence/lineage proof, confidence tests, and explicit policy
change.

## Access and privacy

- Class A uses lawful free/public company-level access.
- Class B requires free registration and least-privilege runtime credentials.
- Class C requires explicit permission, an official subscription, or a compliant provider.
- Class D is unsafe/disallowed and is not an implementation target.

No source may bypass robots, authentication, CAPTCHA, TLS, access controls, or provider terms.
Do not collect personal profiles, private ATS data, personal emails/phones, channel participants,
subscribers, or individual developer activity. Outreach remains human-controlled draft/assist.

## Runtime rules

- Automatic DB-native discovery is the default. Files are reproducibility, snapshot, or operator override paths.
- Company-owned context refreshes only organizations with existing hiring evidence and uses bounded cooldowns.
- Context sources are quota/rate-limit aware and use persistent cache state where supported.
- Health is derived from actual source runs, never inferred from signal freshness.
- Temporal changes are derived from observations and do not create pseudo-source IDs.

Required gates are listed in `tasks/api-and-config-requirements.md`.
