# Commercial Signal UI v1

## Scope

Phase 11 adapts the existing Today / Morning Brief card. It does not replace
the page, workflow lanes, outcome ledger, or Research Mode.

The new card is evidence-first and renders these decisions separately:

- what changed;
- why the activity is not ordinary hiring;
- why external agency support may be needed;
- why this agency is a fit;
- why the timing matters now;
- External Agency Propensity;
- Agency Fit;
- Opportunity Quality;
- Actionability;
- recommended action;
- limitations.

It never presents the legacy overall score as the Commercial Signal result.
The four model components use qualitative levels, not deal probabilities. The
card does not show an ungrounded contract value.

## Versioned projection contract

The UI reads only `opportunities.metadata.commercialSignalCard` with the exact
version `commercial-signal-card-v1` and `scoreVersion=opportunity-v3`.

The snapshot contains five conclusions, four bounded component metrics, one
recommended action, and at least one limitation. Every conclusion declares
either:

- `basis=evidence` with one or more evidence item IDs present in the card's
  evidence timeline; or
- `basis=heuristic` with no evidence IDs and an explicit manual-check label.

Metrics contain a value in `[0, 1]` and one or more closed-format reason codes.
The UI maps the value to `low`, `medium`, or `high`; it does not label the value
as a probability. Unknown keys, unsupported versions, missing sections,
unbounded values, duplicate reason codes, and unresolved evidence references
make the complete snapshot invalid.

The parser resolves evidence references only against timeline rows with
`kind=evidence`. A signal row with the same numeric ID cannot satisfy an
evidence claim.

## Today and Research Mode

When Commercial Signal UI is enabled, the primary Today queues accept only
versioned snapshots with one of these statuses:

- `qualified_actionable`;
- `qualified_needs_enrichment`.

The second status preserves a strong commercial opportunity whose lawful
corporate contact path still needs enrichment. It is not downgraded to a weak
lead solely because reachability is incomplete.

Search, confidence filtering, `All`, and `Completed` activate Research Mode and
remove the strong-snapshot filter. This preserves access to weaker, review,
legacy, blocked, expired, and dismissed candidates without mixing them into the
default action queue.

## Fail-closed feature gate

`OPPORTUNITY_COMMERCIAL_SIGNAL_UI_ENABLED=true` is necessary but not sufficient.
The UI also requires an authenticated workspace boundary and all upstream dark
flags:

- `OPPORTUNITY_ENGINE_V1_ENABLED`;
- `OPPORTUNITY_OUTCOMES_ENABLED`;
- `OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED`;
- `COMPANY_EVENTS_V1_ENABLED`;
- `COMPANY_STATE_V1_ENABLED`;
- `SIGNAL_EPISODES_V2_ENABLED`;
- `COMMERCIAL_THESIS_V1_ENABLED`;
- `EXTERNAL_AGENCY_PROPENSITY_V1_ENABLED`;
- `AGENCY_DNA_MATCH_V2_ENABLED`;
- `OPPORTUNITY_SCORING_V3_ENABLED`.

All new flags remain off by default. This phase does not activate a reader,
writer, shadow run, canary, or production rollout.

## Exact-lineage stop condition

The current repository has no exact legacy Opportunity to v3 candidate lineage
bridge. Phase 11 intentionally does not join the latest v3 candidate by company,
profile, workspace, evidence hash, or recency. Any such approximation can show
the wrong episode or score on a workflow card.

Until a tenant-safe writer projects one exact v3 result onto the matching
Opportunity metadata, the new gate must remain off. If it were enabled without
valid projections, Today would fail closed to an empty strong-snapshot result
instead of silently falling back to legacy scoring.

## Accessibility and responsive behavior

- the existing card keeps its `h2`, and every decision section uses `h3`;
- evidence-backed conclusions link to the card evidence timeline;
- evidence and heuristic conclusions have explicit text labels, not color-only
  meaning;
- keyboard focus remains visible;
- component levels use text plus a visual bar;
- the four-component grid collapses to two columns on tablet and one column on
  mobile;
- invalid snapshots render an explicit status message and retain the evidence
  timeline.

## Verification boundary

Unit tests cover strict parsing, unresolved evidence, dark-gate prerequisites,
Today/Research Mode filtering, component rendering, and invalid-snapshot
fallback. Browser verification covers desktop and mobile layouts, heading and
accessibility structure, keyboard focus, horizontal overflow, console output,
and failed requests.

These checks prove the code path and presentation contract. They do not prove
production data availability, production calibration, or rollout readiness.
