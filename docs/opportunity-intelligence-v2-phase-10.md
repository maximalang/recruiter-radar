# Opportunity Intelligence v2 — Phase 10 Product UX

## Product boundary

Phase 10 turns `/opportunities` into an action-first workspace. It reuses the
existing tenant-scoped Opportunity, Outcome Ledger, Strategist and workflow
projections. It does not add a CRM, outreach, contacts, a second ledger, new
scores, new evidence or a database migration.

The surface remains behind the existing fail-closed Opportunity/Outcome/
workflow flags. This phase does not enable a global flag, canary or production
rollout.

## Primary Today surface

The page title is **Сегодня**. Five primary lanes answer what needs attention:

| Lane | Existing source of truth | List view |
| --- | --- | --- |
| Новые возможности | active `new/review` opportunities that retain the existing Morning evidence/score gates | `morning` |
| Нужно связаться | active authoritative `accepted` stage | `accepted` |
| Ожидают follow-up | active workflow with a scheduled `follow_up` that is not overdue | `follow_up` |
| Просрочено | non-terminal action due before the Moscow day boundary or an expired snooze | `overdue` |
| Активный pipeline | active authoritative `contacted/replied/meeting/proposal` stages | `pipeline` |

The default `today` queue keeps the Phase 7 semantics and order. Lane counts
may overlap because they are operational lenses, not an analytics funnel.

## Research Mode

Search and analytical filters live in a secondary, keyboard-operable disclosure
named **Режим исследования**. Search is server-side, tenant-scoped and limited
to company display name, company domain and opportunity title. It never
searches contacts, internal notes, outcome notes or evidence bodies.

Research Mode preserves explicit URL state for `q`, confidence gate and view.
It does not change scoring, gates, action eligibility or the default Today
ordering.

## Opportunity Card contract

Every card exposes the same decision order:

1. what changed;
2. why now;
3. why the agency fits;
4. evidence;
5. likely task;
6. recommended persona;
7. recommended angle;
8. relevant case;
9. limitations;
10. next action;
11. commercial history.

Evidence-bound Strategist conclusions retain their basis and evidence IDs.
When Strategist or evidence data is absent, the card renders an explicit
`insufficient-data` message instead of inventing copy. A past `validUntil`
renders an explicit `stale-data` warning and never claims freshness.

## State contract

- `loading`: route-level skeleton/status with `aria-busy`;
- `permission-denied`: no opportunity or tenant data is queried or rendered;
- `error`: repository failure with a safe retry path and no foreign data;
- `empty`: the workspace has no opportunities yet;
- `no-data`: Research Mode or a selected lane has no matching rows;
- `insufficient-data`: a card lacks enough evidence/Strategist conclusions;
- `stale-data`: the opportunity validity window has passed.

State meaning is communicated with text, not color alone. Dynamic workflow and
outcome messages keep their existing live-region behavior.

## Responsive and accessibility contract

- one logical `h1`; card headings follow in DOM order;
- native links, buttons, form fields and disclosure controls only;
- visible focus, no positive `tabindex`, no keyboard trap;
- descriptive labels for score, filters, evidence and commercial history;
- touch targets remain at least 44 px on narrow screens;
- no horizontal page overflow at 320, 768, 1024 or 1440 px;
- reduced-motion behavior is preserved.

## Verification

Focused Jest must prove lane semantics, tenant-safe search parameters, all
explicit states and the eleven card sections. Real-browser verification covers
320/768/1024/1440 screenshots, keyboard order, accessible structure, console,
network and horizontal overflow. The phase then runs the repository-wide
quality gates from the root contract.
