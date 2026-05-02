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

Rule: highest operational priority for proof quality. `career-pages` are top-tier primary evidence. Generic `company-site` data is corroboration unless it exposes an explicit hiring surface.

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
3. Look for better company-owned confirmation next: `career-pages` first, then explicit hiring sections on `company-site`.
4. Use `egrul-fns` to verify legal entity and reduce false joins.
5. Add `funding-business-signals` only after the hiring case already exists.
6. Rank leads by evidence quality first, coverage second, narrative/context last.

## Ranking principles
- Direct company hiring proof beats platform aggregation.
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

### MVP now
- Keep `hh` as the only runnable default primary source.
- Preserve quality-first ranking semantics even with one active source.
- Use planned sources as policy targets, not as fake implemented coverage.

### Next implementation priorities
1. Add `career-pages` as the first high-signal expansion.
2. Add `linkedin-company-pages` or another cautious secondary platform source.
3. Add `egrul-fns` as standard entity verification/enrichment.
4. Test `tech-job-boards` only after normalization quality is stable.
5. Add `funding-business-signals` last for explanation/context layering.

## Decision rule
If two sources disagree, trust the source closest to the company-controlled hiring surface. If no direct hiring evidence exists, do not let enrichment or market context manufacture a lead.
