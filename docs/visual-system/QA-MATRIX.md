# V1–V6 visual QA matrix

The visual system is not considered closed from static CSS alone. The exact PR head must satisfy the following matrix.

## Public surfaces

Representative green-run screenshots are persisted for:

| Surface | Mobile | Tablet | Desktop |
| --- | --- | --- | --- |
| Landing | 390×844 | 1024×768 | 1440×900 |
| Login | 390×844 | 1024×768 | 1440×900 |
| Checkout | 390×844 | 1024×768 | 1440×900 |
| Legal | 390×844 | 1024×768 | 1440×900 |

The full responsive audit additionally exercises all configured routes at 320, 360, 375, 390, 430, 768, 1024, 1280, 1366, 1440, 1536 and 1920 pixel viewport widths.

## Authenticated product

Authenticated E2E/accessibility evidence covers the decision flow and operational surfaces, including:

- Dashboard / daily decision workspace
- Leads workspace
- Company intelligence brief
- Situations
- Evidence Radar
- account/team/security settings and auth flows

## Required states and interaction invariants

- loading and pending states do not use decorative ambient animation;
- reduced-motion mode suppresses non-essential transitions and animation;
- hover-only behavior is capability-gated;
- keyboard focus remains independently visible;
- standalone interactive targets are at least 44×44 CSS pixels;
- controls, links and dialogs have accessible names;
- disclosures remain usable and unclipped;
- mobile and desktop layouts do not create unexpected horizontal overflow;
- long identifiers/URLs may wrap without breaking the workspace;
- empty/degraded/error states preserve the same product hierarchy rather than reverting to legacy card/HUD grammar.

## CI gates

The exact PR head must be green for:

- Tests
- Visual contract
- Hardening smoke
- Commercial Signal + Evidence Radar Contracts
- Robokassa billing contracts
- Notification delivery validation
- Timeweb MCP OAuth Security
- Source Closure Contracts

A green result on an older commit does not count as final visual closure.
