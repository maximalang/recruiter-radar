# Recruiter Radar signal quality contract

## Product invariant

A source record is not a lead.

Recruiter Radar may store parsed vacancies, company pages, news, registry facts, and other public observations as evidence. None of those records may be presented as a client opportunity by itself.

The product pipeline is:

1. **Observation** — a source adapter records a public fact.
2. **Signal** — the fact is normalized, deduplicated, attributed to a company, and assigned evidence provenance.
3. **Hiring episode** — several related signals or a meaningful historical pattern describe a change in the company’s hiring state.
4. **Commercial thesis** — the system has evidence for why external recruiting support may be useful now.
5. **Agency match** — the thesis fits the agency’s specialization, restrictions, capacity, geography, and economics.
6. **Actionable opportunity** — evidence, confidence, timing, contact policy, and minimum commercial thresholds are satisfied.

Only stage 6 belongs in the action queue or Morning Brief.

## Non-negotiable rules

- One ordinary vacancy is evidence, not an opportunity.
- Duplicate publications of one vacancy do not increase hiring demand.
- A high vacancy count without agency fit is not a lead.
- Agency fit without evidence of external-support need is not a lead.
- News, funding, registry, and leadership events provide context or timing unless corroborated by hiring evidence.
- A missing safe corporate contact path affects actionability, not the underlying opportunity quality.
- Gate C/D, stale episodes, unverified company identity, and blocked accounts never enter the action queue.
- The UI must distinguish `observation`, `episode`, `review`, and `actionable opportunity` instead of calling every company a lead.

## Required commercial thesis

An actionable opportunity must explain all of the following:

- **What changed?** A current, evidence-backed company event or hiring pattern.
- **Why external support?** A reason the company may need an agency rather than ordinary internal hiring.
- **Why this agency?** A structured Agency DNA match.
- **Why now?** A bounded time window supported by fresh evidence.
- **What should be done?** A safe next action and relevant corporate persona.

## Examples

### Not a lead

- One Backend Developer vacancy published yesterday.
- Five copies of the same vacancy on different job boards.
- A company in the target industry with no current hiring change.
- A hiring spike that does not match the agency’s roles or service model.

### Review candidate

- Three related engineering vacancies, but no evidence yet that external support is likely.
- A new regional hiring cluster without verified corporate identity.
- Repeated vacancies with incomplete evidence provenance.

### Actionable opportunity

- Several relevant roles appeared in a short window, including repeat or difficult vacancies.
- The episode is fresh and materially different from the company baseline.
- External-support need exceeds the configured minimum.
- Agency DNA fit exceeds the configured minimum.
- Evidence confidence is Gate A/B.
- The account is permitted and a corporate contact path is available.

## Measurement

Quality must be evaluated at the opportunity level, not by parser volume:

- actionable opportunities per active agency;
- Precision@5 / Precision@10;
- accepted, contacted, replied, meeting, proposal, won;
- false-positive reason distribution;
- duplicate publication rate;
- observations → episodes → review → actionable conversion;
- source/query-plan contribution to replies and meetings.

Parser metrics such as fetched rows are operational diagnostics, not product success metrics.
