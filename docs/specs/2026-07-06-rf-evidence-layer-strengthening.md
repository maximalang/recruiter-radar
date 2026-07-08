# Spec — RF evidence layer strengthening (2026-07-06)

## Objective

Make the evidence layer materially stronger for the Russian market by closing
the single highest-leverage RF source gap (same-domain career pages with no
JSON-LD), enriching the signal payload with extraction-quality metadata, and
making source/extraction quality inspectable on the dashboard — without
weakening any confidence gate.

## In-scope

1. **RF source coverage** — add an HTML-card fallback to the `same-domain-jsonld`
   career-pages adapter so Russian company career pages that publish vacancies
   as HTML (no schema.org JSON-LD) still produce `direct_hiring_proof` signals
   instead of silently yielding 0 records. This is the **only** direct-hiring
   surface and the only gate-A/B originator; today it silently fails on a large
   class of RU corporate sites (Bitrix/1C-Bitrix/custom CMS).
2. **Signal/evidence quality** — record per-target extraction diagnostics
   (records_found, jsonld_count, html_card_count, fallback_used) in the signal
   payload + fetch summary so evidence richness is auditable and the why-now /
   why-match story can cite the extraction method.
3. **Analytics/observability** — extend the dashboard source-performance surface
   with evidence-density + extraction-quality metrics (gate distribution,
   evidence_quality distribution, freshness distribution per source) so source
   quality is inspectable, not just lead count.
4. **Guardrails** — a normalization guard + smoke test that proves the HTML
   fallback does not fabricate vacancies (title + URL required, same-domain
   only) and that the existing "N records but 0 normalized" guard still fires
   when both JSON-LD and HTML extraction return nothing.

## Out-of-scope

- Adding new top-level sources (avito, rabota.ru, telegram — already rejected by policy).
- Cross-source org-identity merge (deferred architecture epic per memory).
- HH unblocking (policy + residential-IP, not an evidence-quality task).
- UI-only polish / digest copy changes.
- AI enrichment prompt changes (deterministic layer only this session).
- Database migrations (additive payload fields only; no schema change).

## Success criteria

1. A RU career page with HTML vacancy cards and NO JSON-LD produces normalized
   career-pages signals (verified by a unit test with a realistic RU-style HTML
   fixture).
2. The HTML fallback is gated: vacancy title + a same-domain URL are required;
   no fabricated company, contact, or salary. Signals carry
   `extraction_method: 'html-card-fallback'` in the payload.
3. The existing `verify:career-pages:normalization-guard` smoke still passes,
   and a new guard proves "JSON-LD empty + HTML empty → still throws in live
   mode" (no silent zero).
4. Dashboard source-performance exposes gate distribution + evidence-quality
   distribution per source (unit-tested with a mock pool).
5. `npm run web:check` passes; affected smoke tests pass; no gate is weakened
   (confidence_gate SQL unchanged; `career-pages` still maps to
   `direct_hiring_proof`).

## Assumptions

- The HTML fallback reads the **company's own fetched page** (already in hand
  via `fetchHtmlPage`); no extra network calls, no new surfaces.
- RU career pages commonly expose vacancies as repeated card/table/list items
  with a title and a link to a same-domain vacancy detail page.
- The fallback is **additive** to JSON-LD: JSON-LD wins when present (higher
  structural trust); HTML cards only fill the gap when JSON-LD is empty.
- Evidence-first contract preserved: HTML-card signals are still
  `direct_hiring_proof` (company-owned surface) — the gate logic is unchanged;
  only the extraction path broadens.
