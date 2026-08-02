# Opportunity Intelligence v2 — Phase 10 plan

## Scope

Complete the Opportunity UX around decisions and actions using existing
tenant-safe projections. Do not change database schema, scoring, confidence
gates, outbound delivery, CRM boundaries, flags or production state.

## Increments

1. Lock the action-lane, Research Mode, card-section and state contracts with
   failing tests.
2. Add tenant-scoped `follow_up`, `overdue` and company-level search repository
   behavior; extend operational counts without changing Phase 7 `today`.
3. Recompose `/opportunities` around the five primary lanes and secondary
   Research Mode, including loading/permission/error/empty/no-data states.
4. Recompose Opportunity Card into eleven stable decision sections with
   insufficient/stale states and preserved workflow/outcome controls.
5. Verify browser behavior at 320/768/1024/1440, keyboard order, accessible
   names/tree, console, network and overflow.
6. Run full checks, five-axis review, impact/signature review and one PR to the
   active integration branch.

## Risk controls

| Risk | Control |
| --- | --- |
| Today semantics drift | keep the existing `today` predicate/order unchanged and add focused SQL-contract tests |
| tenant or PII search leak | reuse owner/workspace clauses and allow only parameterized company/title search |
| invented sales advice | render explicit insufficient-data copy; never synthesize missing conclusions |
| stale evidence shown as current | derive a textual stale state from `validUntil` |
| filters dominate the workflow | keep Research Mode in a secondary native disclosure |
| accessibility regression | semantic controls, focused Jest plus real-browser keyboard/a11y checks |
| responsive overflow | mobile-first layout and screenshots/overflow probes at four widths |

## Merge boundary

One sequential Phase 10 branch and one PR target
`codex/opportunity-intelligence-v2`. No deploy or flag activation.
