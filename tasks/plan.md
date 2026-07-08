# Implementation Plan — UX Hardening Premium Pass

**Source of truth:** `docs/specs/2026-07-07-ux-hardening-premium-pass.md`
**Task list:** `tasks/todo.md`
**Mode:** planning only — no code in this phase.
**Created:** 2026-07-07
**Status:** Ready for `/build`

This plan operationalizes the UX-hardening spec into small, verifiable,
vertically-sliced tasks. Every task is one complete path (not a horizontal
layer) and carries acceptance + verification + dependencies + files + scope +
risk. Phases match the `/plan` command's required ordering (1–8).

Grounded in the codebase as of 2026-07-07 via CodeGraph + source reads. Key
grounding facts that shape the plan (each verified, not assumed):

- **SVG icon system** (`app/ui/icons.tsx`) — 27 glyphs, 24×24, stroke 1.75,
  `currentColor`. Missing for this block: `BackIcon` (arrow-left), `CircleIcon`
  (empty circle for completion checklist), `BellIcon` (push channel). No
  `arrow-left` exists today.
- **`EmptyState`** (`app/ui/internal-page.tsx:534`) — `icon?: string` prop is
  **dead**: a repo-wide grep for `EmptyState … icon=` returns 0 callers. All
  empty states render title+text only. Signature change is breaking in *type*
  but has 0 live callers passing `icon` — safe to repurpose to SVG.
- **`/api/review`** (`app/api/review/route.ts`) returns
  `confidenceGate`, `sourceFamilies`, `locationNames`, `evidenceTitles` but
  **NOT** `isForeignEmployer` or a `reviewReason`. The foreign flag + source
  count can be derived from `payload` via the existing `extractPayloadFields`
  helper — **no new SQL/JOIN/migration required** (resolves spec Q1).
- **`feedback-buttons.tsx`** is **already** SVG + DB-legal enum + grouped triage
  (matches memory `project_feedback_enum_drift`). **No work needed** —
  verify-only.
- **`review-actions.tsx`** already uses `CheckIcon`/`XIcon`. Only tap-target
  (≥44px) + premium polish may need a touch — low risk.
- **Email digest** (`lib/email/digestEmail.ts`) is a **separate renderer** that
  duplicates the readiness line `band · readiness · score · gateLetter` — same
  triple-confidence issue as Telegram. §7.7 must touch BOTH files to one
  contract (resolves spec Q4: email DOES repeat the line).
- **`next-steps-block.tsx`** has literal `↗` (links) and `✓ Скопировано`
  (button) — small icon-system completion.
- **`profile-completion-panel.tsx:42`** literal `✓` / `○`.
- **`dashboard-analytics.tsx`** legacy `<table>` (source-perf, evidence-quality)
  with horizontal scroll on mobile + NO skeleton + stale
  `FUNNEL_COLORS`/`FUNNEL_ICONS` referencing legacy enum (`accepted/later/call/
  client`) not in current `digest_feedback_status`.
- **Step-rail** (`pilot-onboarding-components.module.css`) has `data-current`
  (dark) + `data-complete` (green-tint) contracts — additive SVG slot is clean.
  `InstructionCard` is a plain `<div>` with text children (`"1. …"`) — needs a
  `step` prop to render an SVG number-circle.
- **Package scripts:** `check`, `build`, `test`, `test:types`, `validate`,
  `dev`, `start`. Validation gate per CLAUDE.md: `npm run web:check` always;
  `web:build` only if routes/middleware/`next.config.*` changed.

---

## Architecture / UX decisions that MUST stay fixed during implementation

These are locked by the spec + CLAUDE.md. Implementation must NOT reopen them.
If a task seems to require violating one, STOP and report instead.

1. **No new design language.** Work inside existing tokens
   (`--c-*`, `--radius-*`, `--space-*`, gate-colors in
   `page-primitives.module.css`) and the SVG icon set. No new typography,
   palette, shadow, or grid system.
2. **One visual vocabulary = inline-SVG.** No emoji, no literal glyph chars
   (`←`, `✓`, `○`, `→`) as interface iconography. Exception: `→` / `↗` inside
   meaning-bearing copy (Telegram anchor "Открыть все лиды →", email
   "Открыть карточку →", external-link `↗`) stay as text affordances — they are
   copy, not icons. `✓ Скопировано` → SVG `CheckIcon`.
3. **No source/scoring/AI architecture changes.** FIUR, confidence gates,
   entity resolution, evidence layer, ingest pipeline, AI enrichment logic are
   untouched. We only change how existing data is *presented*.
4. **No AI gimmicks.** No new AI features, generation, summarization, chat.
   `AiEnrichmentBlock` stays as-is (advisory, muted).
5. **Score vocabulary is single-source.** All score display goes through
   `lib/scoring/score-display.ts` (`scoreBand`, `formatSignalStrength`,
   `scoreTone`, `scoreLevelLabel`). Onboarding `scorePill` ("score 3.2") must
   adopt `scoreBand` — no second vocab.
6. **Russia-first, mobile-first.** Every surface verified at 375px and 1280px.
   No horizontal scroll inside content. Tap-target ≥44px (WCAG 2.5.5).
7. **Premium Russian copy.** Concise, specific, no hype. Forbidden:
   «гарантированные клиенты», «100% результат», «готовые сделки». All visible
   strings mojibake-protected via existing `repairPossiblyMojibakeText`.
8. **Feedback enum stays DB-legal.** In-app writes only
   `none/contacted/replied/won/badfit/snooze/dismissed`. Telegram layer keeps
   its `accepted→contacted` mapping (memory `project_feedback_enum_drift`).
9. **No new dependencies.** Existing stack (Next.js App Router, CSS Modules,
   inline SVG). New `package.json` dep requires explicit PR justification.
10. **`/api/review` change is read-only + backward-compatible.** New fields
    (`isForeignEmployer?`, `reviewReason?`) are optional; no schema migration;
    no new SQL JOIN if derivable from `payload`/`sourceFamilies`.
11. **Telegram digest contract unchanged in shape.** `MAX_BATCH_MESSAGES=2`,
    `TELEGRAM_MESSAGE_CHAR_LIMIT=4096`, one executive brief per (run,profile),
    honest contact fallback ("прямой путь уточняется"), no invented contacts.
    Only the readiness-line wording de-duplicates.
12. **Pre-merge gate (CLAUDE.md) on every phase checkpoint.** `/review`
    five-axis + `codegraph_impact` on changed exported symbols + signature-diff.

---

## Dependency graph (major components)

```
Phase 0 (enablers, no surface deps)
  icon-system completion (BackIcon, CircleIcon, BellIcon)
      │
      ├─► Phase 7: EmptyState API + LoadingState primitive  (CROSS-CUTTING)
      │       │
      │       └─► consumed by Phases 1,2,3,4,5 (every surface's empty/loading)
      │
      ├─► Phase 1: onboarding (step-rail icons, InstructionCard numbers,
      │            preview score-vocab) ── depends on score-display (existing)
      │
      ├─► Phase 2: profile/settings (completion ✓/○→SVG, mode-badge icon,
      │            delivery channel icons)
      │
      ├─► Phase 3: leads list + filters (active-select state, chip grouping,
      │            legend a11y)
      │
      ├─► Phase 4: lead detail (verdict chip grouping, back-link SVG,
      │            ScoreGauge mobile, next-steps ↗/✓) + review queue
      │            (reason chip, foreign from data, /api/review field)
      │
      └─► Phase 5: dashboard (analytics responsive tables, funnel enum fix,
                   skeleton, today-radar empty icon)

Phase 6 (delivery formatting) — INDEPENDENT of icon system
  telegram digest-batch readiness-line + email digestEmail readiness-line
  (single contract) ── depends on score-display (existing), unit tests

Phase 8 (final polish + verification) — depends on ALL above
  cross-surface grep for literal glyphs, a11y pass, web:check/build,
  CodeGraph impact sweep, pre-merge /review, memory update
```

**Critical path:** Phase 0 → Phase 7 → Phases 1–5 (parallel-ish, but 7 first)
→ Phase 8. Phase 6 runs independently anytime. **Highest leverage = Phase 0 +
Phase 7** (enablers unblock 5 surfaces at once).

---

## Phase ordering + checkpoints

| Phase | Title | Checkpoint after |
|---|---|---|
| 0 | Enablers: icon system + `EmptyState`/`LoadingState` | C0: `web:check` green; `codegraph_impact EmptyState` 0 orphans; new glyphs render |
| 1 | Onboarding / first-value flow | C1: 375px no H-scroll; step-rail SVG; preview uses `scoreBand` |
| 2 | Profile / settings UX | C2: no `✓`/`○` literals; channel icons; completion SVG |
| 3 | Leads list + filters | C3: active-select visible; chip groups; legend a11y |
| 4 | Lead detail + review queue | C4: verdict groups; back-link SVG; review reason chip; `/api/review` backward-compat |
| 5 | Dashboard hierarchy | C5: analytics responsive; funnel enum fixed; skeleton |
| 6 | Telegram digest / delivery formatting | C6: readiness-line ≤2 readouts in BOTH telegram+email; unit tests green |
| 7 | Cross-surface empty/loading/error/helper consistency | C7: no flat `Загрузка…`; every empty has SVG; error paths human |
| 8 | Final polish + verification | C8: grep 0 literal glyphs; a11y; `web:check`/`web:build`; `/review`; memory |

> Phase 7 is listed 8th in the command's phase list but is logically a
> cross-cutting enabler — its *API* work (`EmptyState`/`LoadingState`) is done
> in Phase 0/early, and its *application* across surfaces happens inside
> Phases 1–5. The dedicated Phase 7 task below is the final consistency sweep
> that catches any surface that didn't adopt the primitives. This keeps work
> vertical (each surface fully done when its phase ends) while honoring the
> required phase numbering.

---

## What to do FIRST (highest leverage)

**Phase 0 + the `EmptyState`/`LoadingState` part of Phase 7, done together as
the first `/build` increment.** Rationale:

- `BackIcon` unblocks nav/back-link migration across onboarding, lead-detail,
  and the landing backLink (3 surfaces).
- `CircleIcon` unblocks the profile completion checklist.
- `BellIcon` unblocks the delivery-form push channel.
- `EmptyState` → SVG repurpose unblocks all 8 empty states (the single most
  common "feels broken" moment) in one API change with 0 live callers to break.
- `LoadingState` primitive unblocks every `<Suspense>` fallback on leads,
  review, dashboard, settings.

Doing these first means Phases 1–5 each only *consume* the primitives — no
surface phase is blocked on a shared change, and no surface ships a half-done
empty/loading state.

---

## What to DEFER if scope exceeds one focused pass

If the implementation pass runs long, ship in this priority order and defer
the rest to a follow-up:

**Ship first (core coherence + mobile):**
- Phase 0 (icons + EmptyState/LoadingState API)
- Phase 2 (profile completion `✓/○` → SVG) — tiny, high-coherence
- Phase 4 lead-detail back-link SVG + verdict grouping — most-seen surface
- Phase 5 dashboard analytics responsive tables + funnel enum fix — only
  horizontal-scroll bug + a real enum-drift bug (correctness, not just polish)
- Phase 6 Telegram + email readiness-line de-dup — composer-only, unit-tested
- Phase 8 verification on the above

**Defer to a follow-up pass (polish, lower blast-radius):**
- Phase 1 onboarding step-rail SVG + InstructionCard number-circles + preview
  score-vocab (onboarding is seen once; less leverage than daily surfaces)
- Phase 3 leads filter active-select visual state (functional today; polish)
- Phase 4 review-queue reason chip + `/api/review` field (nice-to-have
  clarity; queue already works)
- Phase 7 final consistency sweep items not covered by the ship-first set
- Delivery-form channel icons (Phase 2 tail) — text labels work today

**Never defer (correctness/contract):**
- Dashboard funnel enum fix (legacy `accepted/later/call/client` keys) —
  this is a correctness bug, not polish. Ship in the first pass.
- Email + Telegram readiness-line de-dup together — doing one and not the
  other recreates the drift the spec exists to kill.

---

## Highest-risk tasks (watch list)

1. **R-HIGH — `EmptyState` signature change** (Phase 0/7). Breaking type change.
   Mitigation: `codegraph_impact EmptyState` + `codegraph_callers EmptyState`
   BEFORE edit; 0 live `icon=` callers confirmed (grep-verified 2026-07-07);
   update all callers in same PR; if a caller is missed, TypeScript will catch
   it at `web:check`.
2. **R-HIGH — Dashboard responsive tables via CSS `tr→block`** (Phase 5).
   Can break table a11y semantics (`role`/scope) and column alignment.
   Mitigation: probe with Playwright at 375px first; if CSS-only breaks a11y,
   fall back to mobile-markup duplication (two blocks, `@media` swap) — decide
   at `/build` time, not now.
3. **R-MED — `/api/review` adds `isForeignEmployer`/`reviewReason`** (Phase 4).
   Mitigation: optional fields, backward-compatible, derive from
   `extractPayloadFields` + `sourceFamilies.length` (no new SQL); `codegraph
   _impact` on the route handler; verify the `ReviewCandidate` type consumer in
   `review/page.tsx`.
4. **R-MED — Telegram + email readiness-line contract change** (Phase 6).
   Existing `digest-batch` unit tests will assert the old line.
   Mitigation: update assertions in same PR; intentional de-dup noted in
   commit; both files in one PR so the two channels can't drift.
5. **R-LOW — `InstructionCard` API tweak** (Phase 1). Page composes `"1. …"`
   string children today. Mitigation: add optional `step?: number` prop; render
   SVG circle when provided; keep text-children fallback for the unpaid-state
   path (which doesn't use steps).
6. **R-LOW — Onboarding preview `scorePill` → `scoreBand`** (Phase 1). The
   preview card uses raw `total_score.toFixed(1)` today; `scoreBand` takes raw
   score and converts. Mitigation: `scoreBand` already handles raw score
   (`score-display.ts`); verify the onboarding preview item shape matches.

---

## Open questions that truly block implementation

Most of the spec's §12 open questions are **resolved by grounding** (noted
above). The remaining ones that could block `/build`:

- **B1.** Does `extractPayloadFields` (in `lib/leads-data.ts`) expose
  `isForeignEmployer` from `payload`, or only `confidenceGate`/`evidenceTitles`/
  `locationNames`? **Resolve at start of Phase 4 `/build`** by reading
  `extractPayloadFields`. If not exposed, derive `reviewReason` client-side in
  `review/page.tsx` from `confidenceGate` (gate C) + `sourceFamilies.length`
  (single source) — no API change needed, only foreign-flag needs the payload
  field. **Not a plan blocker** — both paths are specified; pick at build time.
- **B2.** Dashboard responsive tables: CSS-only vs mobile-markup duplication?
  **Decide at Phase 5 `/build`** after a Playwright probe. Not a plan blocker —
  both are acceptable per spec §10 R3.

No question blocks starting `/build` on Phase 0 + Phase 7 API work, which is
the first increment.

---

## Verification strategy (per task + per phase)

- **Static:** `npm run web:check` (tsc + lint) after every task; CLAUDE.md
  gate.
- **Unit:** `cd apps/web && npm test` (cwd matters — memory
  `feedback_jest_cwd`). Update assertions for `digest-batch`, `digestEmail`,
  `dashboard-analytics`, `profile-completion`. Jest-mock hoisting trap per
  memory `feedback_jest_mock_hoisting`.
- **Build:** `npm run web:build` only if a task touches routes/middleware/
  `next.config.*` (Phase 4 `/api/review` qualifies — run build there).
- **CodeGraph:** `codegraph_impact <symbol>` on every changed exported symbol
  (`EmptyState`, `LoadingState`, `formatBatchLeadBlock`, `renderDigestEmail`,
  `/api/review` GET, `InstructionCard`, `ReviewActions`). Orphaned callers =
  Critical, must fix before checkpoint.
- **Visual (env-limited):** per memory `feedback_no_vision`, daemon blocks
  images → verify via Playwright DOM + computed-styles + `scrollWidth <=
  innerWidth` assert at 375px and 1280px; user eyeballs final screenshots.
- **A11y:** skip-link, focus-visible rings, `aria-current` on nav (exists),
  `aria-label` on icon-only controls, `aria-pressed` on toggles (exists on
  today-toggle + feedback buttons), contrast ≥4.5:1 (existing tokens pass — no
  new low-contrast colors).
- **Pre-merge:** CLAUDE.md gate — `/review` five-axis + signature-diff via
  `codegraph_node` before/after for every touched function.

---

## Next action

Run `/build` starting with **Phase 0 + Phase 7 API** (icon-system completion +
`EmptyState`/`LoadingState` primitives). That single increment unblocks all
surface phases and ships the highest-leverage coherence wins first.
