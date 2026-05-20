# Source Priority Policy

## Purpose
Use sources as evidence layers, not as an equal vendor list. Prefer the highest-quality proof of active hiring first, then use lower-tier sources only to expand coverage or add context.

## Source classes

### 1. Primary platform
Direct external hiring surfaces that can produce leads by themselves.
- now: `hh`
- next: `linkedin-company-pages`, `tech-job-boards`

Rule: valid for discovery, but never treated as the strongest proof when a better company-owned signal exists.

### 2. Company surface
Company-controlled hiring or company presence surfaces.
- `career-pages`
- `company-site`

Rule: highest operational priority for proof quality. `career-pages` are top-tier primary evidence and can originate leads. `company-site` is enrichment/corroboration by default and must not be treated as a lead-originating source unless it exposes an explicit hiring surface.

### 3. Registry reference
Legal/reference records.
- `egrul-fns`

Rule: never create a lead alone. Use for entity validation, disambiguation, and company-quality checks.

### 4. Market signal
Contextual business signals.
- `funding-business-signals`

Rule: context only. Can boost explanation quality, but must not outrank direct hiring evidence.

## Order of operations
1. Start from one active primary source for MVP ingestion (`hh` today).
2. Normalize company identity.
3. Look for better company-owned confirmation next: `career-pages` first, then explicit hiring sections on `company-site`. Generic `company-site` context stays enrichment/corroboration only.
4. Use `egrul-fns` to verify legal entity and reduce false joins.
5. Add `funding-business-signals` only after the hiring case already exists.
6. Rank leads by evidence quality first, coverage second, narrative/context last.

## Ranking principles
- Direct company hiring proof beats platform aggregation.
- `company-site` counts as direct hiring proof only when it exposes an explicit hiring surface.
- Higher evidence tier beats broader source count.
- Multiple weak signals do not override one strong direct signal.
- Registry data increases trust, not hiring intent.
- Context-only signals can explain urgency, not create it.
- `defaultConfidence` is a baseline hint, not permission to skip source-class ordering.

## Anti-patterns
- Treating all sources as interchangeable inputs.
- Letting funding/news outrank an actual hiring surface.
- Creating leads from registry or context-only data without primary hiring evidence.
- Expanding to many runnable sources before validating quality and normalization on the current primary source.
- Using source volume as a proxy for source quality.

## Rollout guidance

### Active now
- `hh` - primary platform source (job-board, runnable). Lead-originating.
- `career-pages` - company-surface high-signal source (career-page, runnable). Lead-originating.
- `company-site` - company-surface enrichment/corroboration source (company-site, runnable; not lead-originating by default).
- `linkedin-company-pages` - secondary platform evidence (professional-network, runnable). Normalized and runnable but not a sole lead-originating source. Not in digest selection.
- `tech-job-boards` - tech job board coverage (job-board, runnable). Normalized with input-level dedupe. Not in digest selection until confidence-gate tests prove it cannot degrade source quality.
- `egrul-fns` - registry reference for entity verification (company-registry, runnable). Enrichment-only, never lead-originating. Not in digest selection.
- `funding-business-signals` - context-only business signals (business-signal, runnable). Context-only, never lead-originating. Not in digest selection.
- Preserve quality-first ranking semantics across active sources.

### Evidence boundaries
- `company-site`, `egrul-fns`, `funding-business-signals`, `linkedin-company-pages` are NOT in `source-digest-evidence.sql` lead selection.
- `tech-job-boards` is NOT in `source-digest-evidence.sql` until explicit confidence-gate tests are added.
- Only `hh` and `career-pages` participate in digest lead selection today.

### Runtime readiness guardrails
- All source HTTP calls go through the shared `source-http` adapter for timeout, retry, and secret-safe error messages.
- `hh` supports configurable search text, pagination, and HH query parameters via environment variables while keeping the old defaults.
- `company-site` live crawl must return at least one usable and normalized page; all-failed crawls are treated as source failures.
- Source smokes cover file mode for every family plus live/provider branches for `company-site`, `tech-job-boards`, `linkedin-company-pages`, `egrul-fns`, and `funding-business-signals`.
- `verify:smoke` still includes the source smokes; the known non-source failure is the legacy `digestFeedback.ts` parameter typing issue.
- `verify:sources:readiness` checks source registry/action contracts, provider response contracts, digest source boundaries, and centralized HTTP usage without requiring secrets.
- `verify:sources:live-config` is the deploy-time gate: it requires live env configuration for every source but reports only env variable names, never values.

### Future priorities
1. Add `tech-job-boards` to digest selection after confidence-gate validation.
2. Add `linkedin-company-pages` as corroborating evidence layer in digest (not sole source).
3. Expand `egrul-fns` coverage for automated entity resolution.
4. Use `funding-business-signals` for explanation/context layering in digest narratives.

## API-mega-list usage
Use API-mega-list as a candidate catalog, not as a runtime quality guarantee. Actors from the LinkedIn, jobs, lead-generation, and news folders need source-specific validation, fixture coverage, and source-class boundaries before they can be promoted to active. Lead-generation/email/phone enrichment must not become lead-originating evidence.

## Decision rule
If two sources disagree, trust the source closest to the company-controlled hiring surface. If no explicit hiring surface exists, do not let `company-site` enrichment/corroboration or market context manufacture a lead.
