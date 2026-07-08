# Spec — cross-source corroboration & overlap observability (2026-07-06, pass 2)

## Objective

Strengthen cross-source evidence quality for the Russian market by making
multiple RF signals that point to the SAME employer corroborate into one
evidence package — even when per-source entity resolution has fragmented that
employer into multiple `org_id` rows. Do this WITHOUT touching the deferred
cross-source org-merge EPIC (the hot `WHERE source=$1` upsert path stays
untouched). Add overlap/fragmentation observability so merge quality is
inspectable, and guardrails so weak similarity never merges.

## Background (why interim, not the EPIC)

Per-source entity resolution (`org_source_refs` unique on `(source, source_key)`)
fragments one company into N `org_id`s across sources. The canonical-org merge
EPIC (memory `project_cross_source_merge_epic`) is deliberately deferred — it
re-points refs/signals and changes core identity. This session works at
**digest-assembly time** (read side only): `source-digest-evidence.sql` already
groups signals by `org_id` and counts `source_families` for gate A/B. The
globally-namespaced strong keys (`inn:`, `domain:`, `ogrn:`) already live in
`org_source_refs` across sources. So a read-side grouping by a canonical key
derived from the strongest shared key lets fragmented orgs corroborate WITHOUT
rewriting identity.

## In-scope

1. **Cross-source corroboration at assembly time** — add a canonical
   `corroboration_key` to `source-digest-evidence.sql` derived from the
   strongest shared strong key (`inn:` > `ogrn:` > `domain:`) across all
   `org_source_refs` for the signal's org. GROUP BY `corroboration_key` instead
   of (or alongside) `org_id`, so signals from fragmented orgs that share an
   INN/domain combine into one evidence package: one `source_families` array,
   one `vacancies_count`, one `confidence_gate`. This is the single
   highest-leverage change — it makes gate-A/B reachable for employers that
   today are stuck at gate-C because their career-page and platform signals
   live on different `org_id`s.
2. **Overlap / fragmentation observability** — new analytics query +
   dashboard surface exposing: how many distinct `org_id`s share a
   `corroboration_key` (fragmentation count per key), how many gate-A/B leads
   are cross-source corroborated vs single-source, and the source-overlap
   matrix (which source pairs most often share an employer). Makes merge
   quality and the fragmentation gap inspectable.
3. **Guardrails against false merges** — `corroboration_key` is derived ONLY
   from strong keys (`inn:`, `ogrn:`, `domain:`). `company-name:` keys are
   explicitly EXCLUDED (weak similarity → false merges). A domain key is only
   used when the domain is a real corporate domain (not a platform host —
   hh.ru/trudvsem.ru/greenhouse/lever are excluded). Tests prove two
   DIFFERENT companies with similar names do NOT merge, and two fragmented
   orgs of the SAME company (shared INN) DO merge.
4. **Evidence package richness** — when fragmented orgs merge at assembly,
   the combined evidence package carries `corroborated_org_ids` (the
   fragment list) + `corroboration_key` + `corroboration_key_type` so the
   lead card can show "подтверждено N источниками" truthfully and the
   fragment set is auditable.

## Out-of-scope

- The canonical org-merge EPIC (hot upsert `WHERE source=$1`, ref/signals
  re-pointing, `orgs` row collapse). Deferred — do NOT touch.
- Any migration that changes `orgs` / `org_source_refs` / `signals` schema.
- AI enrichment prompt changes.
- UI-polish / digest copy redesign.
- Merging on company-name similarity (fuzzy name merge) — explicitly rejected
  as a false-merge risk.

## Success criteria

1. Two `org_id` rows sharing the same `inn:` (one from career-pages with a
   domain, one from rabota-rossii with INN-only) produce ONE digest candidate
   with `source_families = ['career-pages', 'rabota-rossii']` and
   `confidence_gate = 'A'` or `'B'` (verified by a SQL-level smoke test).
2. Two DIFFERENT companies with similar names but no shared INN/OGRN/domain do
   NOT merge — they remain two separate candidates (verified by a smoke test).
3. `corroboration_key` is never derived from a `company-name:` key or a
   platform host domain (unit-test the key-derivation guard).
4. The digest candidate carries `corroborated_org_ids` + `corroboration_key` +
   `corroboration_key_type` so the merge is auditable (not silent).
5. A new analytics query exposes fragmentation count per corroboration key +
   cross-source corroborated lead share; unit-tested with a mock pool.
6. `npm run web:check` passes; digest-evidence-query drift test passes after
   re-syncing the TS mirror; existing `verify-mixed-ranking-smoke` semantics
   preserved (same-org cross-source corroboration still works); no confidence
   gate is WEAKENED (gate A still requires 2+ source_families + direct proof).

## Assumptions

- `org_source_refs.source_key` carries globally-namespaced strong keys
  (`inn:`, `ogrn:`, `domain:`) today (verified in `buildCompanyIdentity`).
- The canonical merge is read-side only: the SQL groups signals, it does NOT
  modify `orgs`/`org_source_refs`/`signals`. Safe, reversible, no migration.
- A `corroboration_key` derived from a strong key is a safe merge signal:
  INN/OGRN are legally unique; a corporate domain is unique to one employer.
- `company-name:` is intentionally excluded from corroboration_key derivation
  because Russian company names drift (ООО/АО/ПАО suffixes, transliteration,
  short vs full forms) → false merges.
- When a signal's org has NO strong key (only `company-name:`), it falls back
  to `org_id` grouping (today's behavior) — no regression, no forced merge.
