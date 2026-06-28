# AI Enrichment — Career Pages (first enrichment boundary)

Date: 2026-06-28
Status: shipped (contract + provider stub + pipeline plumbing + tests)
Branch: `feat/ai-enrichment-career-pages`

## Summary

The first concrete AI-enrichment integration boundary. It recovers hiring signals
from **weak / unstructured career pages** — pages that exist but yield little
structured evidence to the deterministic crawler — and exposes those signals as a
**separate, attributed, optional** layer that never touches the deterministic
score, gate, or evidence.

This stage ships the seam, not a live model: the ScrapeGraphAI provider is a typed
stub, so the pipeline already exercises the real graceful-degrade path.

## First enrichment use case

**Weak career page → recovered hiring signals.**

The deterministic crawler parses career pages into vacancies + contact paths +
freshness, scored 0..1 by `lib/scoring/career-page-quality.ts`. Some real pages
score low not because the company isn't hiring, but because the page is
JS-rendered, prose-only, or non-standard — the structure defeats the parser.

For those weak pages (quality ≤ `0.4`, and a URL exists), the enrichment step asks
a page→structure model to read the page and propose:

- detected roles (with department + per-role confidence)
- hiring urgency (low/medium/high)
- departments / teams hiring
- geo / locations
- a one-line hiring-pattern summary
- an overall self-confidence + provenance (source URL + provider)

These are **hints for review and optional scoring**, recovering otherwise-lost
leads (quality/quantity) **without lowering the evidence bar**.

## Why ScrapeGraphAI here

- The use case is exactly "messy page → structured object". ScrapeGraphAI is
  graph-of-prompts scraping built for that single schema-shaped ask.
- Far lighter to integrate than standing up our own headless-render + extraction
  stack — fits the "small, mergeable, no heavy infra" constraint.
- The contract is engine-agnostic: `ScrapeProvider` (`scrapeToMarkdown` +
  `extractStructuredData`) is the only surface callers see, so **Crawl4AI or
  PixelRAG can drop in later** by implementing the same interface — no caller
  change, no type migration.

## How this stays separate from deterministic evidence/scoring

This is the whole reason the types are split:

1. **Read-only input snapshot.** `SourceEvidenceSnapshot` is a photograph of what
   the deterministic core already knows (quality score, vacancy count, known
   roles, HR contact, freshness, current gate). The enrichment layer reads it to
   target gaps and **may not write back into it**.
2. **Separate output shape.** `EnrichedHiringSignals` is its own type, returned
   inside an `AssistResult` envelope, carrying `provider` + `confidence` +
   `sourceUrl`. It is stored in an **auxiliary field**, never merged into
   `evidenceTitles` / `reasons` / score / gate.
3. **Boundary enforcement.** The shared `lib/ai/boundary.ts` contract
   (`AI_PROHIBITIONS`: `change-gate`, `change-score`, `invent-evidence`, …) and
   `assertNoOverride` remain the hard trust boundary. The capability used is
   `extract-weak-signal`.
4. **Runs only when weak.** Strong leads are skipped entirely, so enrichment can
   never dilute or override a clean deterministic lead.
5. **Degrades by default.** No provider / strong source / provider error → a
   single consistent `available: false` result; the product shows the
   deterministic baseline.

## Files

| File | Role |
|---|---|
| `apps/web/lib/ai/enrichment/careerPages.ts` | Data contract: input/output types, provenance, empty/guard helpers |
| `apps/web/lib/ai/providers/scrapegraph.ts` | Swappable `ScrapeProvider` interface + Stage-1 stub + centralized extraction instruction |
| `apps/web/lib/ai/enrichment/repairWeakCareerPage.ts` | Pipeline insertion point: weakness decision + repair step |
| `apps/web/lib/ai/index.ts` | Public surface (re-exports) |
| `apps/web/src/__tests__/lib/ai/enrichment/careerPages-contract.test.ts` | Contract + separation tests |
| `apps/web/src/__tests__/lib/ai/providers/scrapegraph.test.ts` | Provider wrapper tests |
| `apps/web/src/__tests__/lib/ai/enrichment/repairWeakCareerPage.test.ts` | weak→attempted / strong→skipped / degrade |

## Pipeline insertion point

`repairWeakCareerPage(candidate, provider?)` is designed to be called **after**
deterministic career-page evidence is gathered and quality-scored, and **before**
final FIUR scoring. It:

1. decides weakness via `isWeakCareerPage` (pure, deterministic, uses the FIUR
   quality scorer);
2. for weak leads, obtains page content (caller-supplied markdown/HTML, else
   `provider.scrapeToMarkdown`) and calls `provider.extractStructuredData`;
3. returns a separate `CareerPageEnrichmentResult` the caller stores in an
   auxiliary field that scoring may *optionally* read.

It does not yet have a call site in the live scoring loop — that wiring is
deliberately deferred (below) so this stage stays small and mergeable.

## What remains for real ScrapeGraphAI wiring

- Replace the two stub bodies in `createScrapeGraphProvider` with real
  ScrapeGraphAI client calls (markdownify + smartscraper with the
  `EnrichedHiringSignals` schema); map + attribute the response.
- Add `SCRAPEGRAPH_API_KEY` (env var name only in `.env.example`) and make
  `isScrapeGraphConfigured()` reflect it.
- Choose and wire the live call site (e.g. inside the career-page scoring/repair
  loop) that calls `repairWeakCareerPage` and persists the auxiliary enrichment
  field.
- Decide how/whether the optional enrichment hint feeds scoring (a separate,
  reviewed input candidate — never a direct score/gate mutation) and whether the
  UI surfaces it as an AI-attributed panel.
- Persistence + prompt-version tracking for enrichment outputs (audit/replay).
- Rate limiting / cost controls for the external provider.
```
