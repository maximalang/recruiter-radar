# Current source blockers and provider decisions

Current per-source blockers and the credential/action matrix are generated in
[`source-status.generated.md`](source-status.generated.md). This document records decision rules,
not a second status inventory.

## Current blocker classes

- **Free-registration pending:** wait for the existing HH application review; do not submit a duplicate application. YouTube and Telegram registration are optional because both sources are context-only.
- **Rate limited:** GDELT's latest controlled request returned HTTP 429 without `Retry-After`. The persistent cooldown must expire before one controlled retry; a 429 is not live normalization proof.
- **Explicit permission/provider:** Habr Career, LinkedIn company pages, EGRUL/FNS integration, Transparent Business, and Fedresurs require the lawful Class C path recorded in the generated matrix.
- **Promotion gate:** a source may be live-verified yet remain excluded from digest selection until confidence and canonical policy gates are explicitly satisfied.

Closed transport failures must not be copied forward as current blockers. In particular, the
SmartRecruiters public careers transport has live DB/evidence/lineage proof even though its
independent digest promotion remains a separate policy decision.

## Provider selection rules

Prefer, in order:

1. official credential-free company/public API or public company surface;
2. free official registration with least privilege;
3. official bulk/open-data publication with checksum and snapshot lineage;
4. explicitly permitted or contracted provider restricted to company-level data.

Reject a provider that requires personal-profile collection, private ATS APIs, access-control
bypass, unclear data provenance, mass outreach, or storage of unnecessary personal contact data.
Provider URLs/tokens are runtime secrets and never belong in docs or fixtures.

## Decision evidence

Before approving a Class C provider, record lawful basis/terms, allowed fields, retention and
suppression, rate limits, Russia availability, cost, failure behavior, organization resolution,
evidence lineage, and a fixture-first verifier. Then update the machine contracts and regenerate
the status document.
