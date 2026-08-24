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

- Mobile More open state is captured at 320×568 and 390×844; the authenticated browser gate verifies that the menu remains inside the viewport, exposes every secondary destination, activates an internal route and does not resize or overlap the main scroll area.
- Company Brief action hierarchy is captured at 640, 768, 900, 1000 and 1024 pixels; exactly one primary CTA remains visible and it derives from the same presentation decision as `Следующий ход`.
- Mobile Companies active-filter and pending states keep the status message in normal layout flow and preserve 44px controls without permanent reserved space.
- Review at 1440×1000 and 390×844 renders eight deterministic pending rows spanning long names, multiple locations, Gate C, foreign, single-source and stale/fresh evidence cases without horizontal overflow.
- Review rows expose the strongest evidence title with source count and freshness; approve/reject settles the acted-on row, while destructive emphasis appears only on interaction or a committed verdict.
- Evidence Radar with one or two companies renders a compact evidence strip plus the canonical detail, with no comparison axes or duplicated priority list; three to five uses the compact field and six or more the full field.
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
