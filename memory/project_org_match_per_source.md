---
name: project_org_match_per_source
description: Org entity match is per-source only; cross-source INN dedup does NOT happen at ingest, so domain backfill via shared INN needs a separate job
metadata:
  type: project
---

`upsertOrgSourceRef` (packages/db/scripts/adapters/rf-source-runtime.mjs:297) resolves an existing org by querying `org_source_refs WHERE source = $1 AND source_key = ANY(...)` — matching is scoped to the **current source only**. `org_source_refs` has `ON CONFLICT (source, source_key)`, so `source_key` (incl. `inn:<inn>`, `domain:<d>`) is unique *within a source*, never globally.

Consequence: two orgs with the same INN coming from different sources (e.g. egrul-fns writes `inn:...`, career-pages writes `domain:...`) are **NOT merged at ingest** and become separate `orgs` rows. The org UPDATE only fills `domain`/`website_url` from the same record (never overwrites a non-empty value).

**Why:** explains why a NULL-domain org (from egrul/trudvsem — see [[project_egrul_no_domain]]) can coexist with a domain-bearing org sharing its INN. No automatic backfill closes that gap.

**How to apply:** INN-based cross-source domain backfill must be a separate, idempotent post-ingest job (read inn: refs → find donor org with non-null domain sharing the INN → copy domain to recipient, never overwrite). It cannot ride on the existing per-source upsert path. Feasibility volume was never measured live (DB probe declined 2026-06-25). Links: [[project_egrul_no_domain]], [[project_leads_pipeline_gaps]].
