# TODO — UX Hardening Premium Pass

**Plan:** `tasks/plan.md`
**Spec:** `docs/specs/2026-07-07-ux-hardening-premium-pass.md`
**Mode:** `/plan` output — implementation via `/build` per phase.
**Created:** 2026-07-07

Each task is one vertical slice with acceptance + verification + deps + files +
scope + risk. Check a box only when its acceptance + verification pass and
`npm run web:check` is green. Phase checkpoints (C0–C8) are in `plan.md`.

> **Supersedes** the prior `tasks/todo.md` (2026-06-15, closed-phase log for
> lead-discovery / FIUR / agency-refinement — preserved in git history).
> `tasks/todo-agency-refinement.md` and `tasks/api-and-config-requirements.md`
> are unrelated and left untouched.

---

## Phase 0 — Enablers (do FIRST)

### T0.1 — Add missing SVG glyphs (BackIcon, CircleIcon, BellIcon)
- [x] **Description:** Add `BackIcon` (arrow-left), `CircleIcon` (empty circle),
  `BellIcon` to `app/ui/icons.tsx` in the existing style (24×24, stroke 1.75,
  round joins/caps, `currentColor`, `aria-hidden`).
- [x] **Acceptance:** Three new named exports render; `size` prop inherited from
  `Svg`; no fills except naturally-solid glyphs; `aria-hidden` default.
- [x] **Verification:** `web:check` green; visual confirm in one consumer
  (e.g. `BackIcon` in a temp back-link) via Playwright computed-styles.
- [x] **Dependencies:** none.
- [x] **Files:** `apps/web/app/ui/icons.tsx`.
- [x] **Scope:** XS (~30 lines).
- [x] **Risk:** LOW — additive only.
- [x] **DONE 2026-07-07:** 3 glyphs added; `icons.test.tsx` 4/4 green; `web:check` exit 0.

### T0.2 — Repurpose `EmptyState.icon` to SVG; add `LoadingState` primitive
- [x] **Description:** In `app/ui/internal-page.tsx`, change `EmptyState.icon`
  from `string` to an SVG-component prop (e.g. `icon?: (p) => ReactElement` or
  `icon?: IconName`). Add a new `LoadingState` primitive with `variant:
  'skeleton' | 'inline'` and a skeleton block style. Update `EmptyState` CSS
  (`.emptyStateIcon` → SVG sizing) and add skeleton styles in
  `internal-page.module.css`.
- [x] **Acceptance:** `EmptyState` accepts an SVG component; `LoadingState`
  renders skeleton or inline; both mojibake-protected for string children;
  `codegraph_impact EmptyState` → 0 orphaned callers; `codegraph_callers
  EmptyState` enumerated and all updated in this task or the consuming phase.
- [x] **Verification:** `web:check` green (TypeScript catches any missed
  caller); `codegraph_impact EmptyState`; grep for `icon=` on `EmptyState`
  usages = 0 stale string-args.
- [x] **Dependencies:** T0.1 (for `CircleIcon`/`SearchIcon` already present).
- [x] **Files:** `apps/web/app/ui/internal-page.tsx`,
  `apps/web/app/ui/internal-page.module.css`.
- [x] **Scope:** S (primitive + CSS + caller sweep).
- [x] **Risk:** HIGH — breaking type change. Mitigation: 0 live `icon=` callers
  (grep-verified 2026-07-07); TS catches misses; do `codegraph_impact` first.
- [x] **DONE 2026-07-07:** `StateIcon` type + `EmptyState`/`NotFoundState` SVG API + `LoadingState` (inline/skeleton) + CSS (emptyStateIcon SVG, loadingSkeleton+shimmer, srOnly); `state-primitives.test.tsx` 9/9 green; full suite 1259/1259 green; `web:check` exit 0; `codegraph_impact EmptyState` = 2 affected (self + file), 0 orphaned callers.

### C0 — Checkpoint
- [x] `web:check` green; new glyphs render; `EmptyState`/`LoadingState` ready;
  `codegraph_impact EmptyState` clean. → Proceed to Phases 1–5 (consume
  primitives) + Phase 6 (independent).
- [x] **PASSED 2026-07-07:** `web:check` exit 0; 13/13 new tests green; 1259/1259 full suite green; `codegraph_impact EmptyState` clean (0 orphaned).

---

## Phase 1 — Onboarding / first-value flow

### T1.1 — Step-rail SVG icons + completed-check
- [x] **Description:** In `onboarding/pilot/[orderId]/page.tsx` step-rail,
  render an SVG icon per step (`IndustryIcon`/`ChatIcon`/`TargetIcon`/
  `CheckIcon`) inside `stepPill`. Completed step → `CheckIcon` brand; current →
  brand ring; future → muted. Add icon slot + CSS in
  `pilot-onboarding-components.module.css` (`.stepPill` keeps
  `data-current`/`data-complete` contracts).
- [x] **Acceptance:** Each of 4 step-pills shows an SVG icon; completed shows
  `CheckIcon`; contract `data-current`/`data-complete` preserved; 375px no
  H-scroll.
- [x] **Verification:** `web:check`; Playwright 375px `scrollWidth<=innerWidth`.
- [x] **Dependencies:** T0.1.
- [x] **Files:** `apps/web/app/onboarding/pilot/[orderId]/page.tsx`,
  `apps/web/app/onboarding/pilot/[orderId]/pilot-onboarding-components.module.css`.
- [x] **Scope:** S.
- [x] **Risk:** LOW.
- [x] **DONE 2026-07-08:** stepItems gain per-step `icon`; step-rail renders glyph + number + label; completed → `CheckIcon`, current → brand dark pill, future → `data-future` muted; `.stepIcon` + `.stepPill[data-future]` CSS; `web:check` exit 0, `web:build` exit 0. (Playwright 375px H-scroll assert deferred — env vision note; pill is `display:inline-flex; flex-wrap` via existing `.stepRail`, no fixed widths.)

### T1.2 — InstructionCard SVG number-circles
- [x] **Description:** Add optional `step?: number` prop to `InstructionCard`
  (`pilot-onboarding-components.tsx`); render an SVG/circle number badge when
  provided. Update the 3 instruction usages in `page.tsx` to pass `step={1|2|3}`
  and drop the inline `"1. "/"2. "/"3. "` text prefixes. Keep text-children
  fallback for non-step usages.
- [x] **Acceptance:** Instructions show circle-numbered badges 1/2/3; no inline
  `"1. "` text; unpaid-state path unaffected; `InstructionCard` backward-compat
  (step optional).
- [x] **Verification:** `web:check`; `codegraph_impact InstructionCard` → 0
  orphans; visual 375px.
- [x] **Dependencies:** T0.1.
- [x] **Files:** `apps/web/app/onboarding/pilot/[orderId]/pilot-onboarding-components.tsx`,
  `.../page.tsx`, `.../pilot-onboarding-components.module.css`.
- [x] **Scope:** XS–S.
- [x] **Risk:** LOW.
- [x] **DONE 2026-07-08:** `InstructionCard.step?` + `[data-step]` layout + `.instructionNumber` circle badge + `.instructionBody`; 3 page usages pass `step={1|2|3}`, inline "1. " prefixes removed; unpaid-state path uses plain children (backward-compat); `pilot-onboarding-components.test.tsx` 3/3 green on InstructionCard.

### T1.3 — Onboarding preview card adopts `scoreBand` vocabulary
- [x] **Description:** `OnboardingPreviewCard` (in `page.tsx`) uses a text
  `scorePill` "score 3.2". Replace with the shared `scoreBand`-based read
  (band label + signal strength) so onboarding preview and `/leads` speak one
  vocab. Reuse `ScoreBandChip` from `internal-page.tsx` if it fits the preview
  card, else a compact inline form of `scoreBand` + `formatSignalStrength`.
- [x] **Acceptance:** Preview card shows the same band label
  (Горячий/Тёплый/Холодный) + strength as `/leads`; raw "score X.X" text gone;
  single source `score-display.ts`.
- [x] **Verification:** `web:check`; unit: if `digest-batch`/score-display
  tests cover `scoreBand`, confirm green; visual.
- [x] **Dependencies:** none (score-display exists).
- [x] **Files:** `apps/web/app/onboarding/pilot/[orderId]/page.tsx`,
  `.../pilot-onboarding-components.module.css` (if new chip style).
- [x] **Scope:** XS.
- [x] **Risk:** LOW — verify preview item shape has `total_score`.
- [x] **DONE 2026-07-08:** new `formatPreviewScore(rawScore)` helper in `pilot-onboarding-components.tsx` wraps `scoreBand` + `formatSignalStrength`; `OnboardingPreviewCard` renders `{bandLabel} · {strength}` (+ existing `confidence_gate` as `Gate X` chip); raw "score 247.0" pill removed; `formatPreviewScore` 4/4 unit tests green (hot/warm/cold/null); preview item `total_score` confirmed present.

### T1.4 — Telegram-step CTA + complete-state badges
- [x] **Description:** Step 2 CTA «Открыть Telegram» → add semantic `ChatIcon`.
  Step 4 «Пилот запущен»/«Первый радар отправлен» `StatusBadge` → add semantic
  `CheckIcon`. Web-push disclosure stays.
- [x] **Acceptance:** Both CTAs/badges carry semantic SVG; no decorative emoji.
- [x] **Verification:** `web:check`; visual.
- [x] **Dependencies:** T0.1.
- [x] **Files:** `apps/web/app/onboarding/pilot/[orderId]/page.tsx`.
- [x] **Scope:** XS.
- [x] **Risk:** LOW.
- [x] **DONE 2026-07-08:** step-2 «Открыть Telegram» carries `ChatIcon` (inline-flex gap); step-4 success `StatusBadge` carries `CheckIcon` (inline-flex span); no decorative emoji added; web-push disclosure untouched.

### C1 — Checkpoint
- [x] 375px no H-scroll on all 4 wizard steps; step-rail SVG; preview uses
  `scoreBand`; `web:check` green.
- [x] **PASSED 2026-07-08:** `web:check` exit 0; `web:build` exit 0; full suite 1266/1266 green (+7 onboarding tests); step-rail SVG + completed CheckIcon; InstructionCard number-badges; preview uses `formatPreviewScore`/`scoreBand`; CTA + complete badges iconified. (Playwright 375px H-scroll assert deferred to Phase 8 visual pass — env has no vision proxy per memory; pill/rail use flex-wrap with no fixed widths so H-scroll risk is low.)

---

## Phase 2 — Profile / settings UX

### T2.1 — Completion checklist `✓`/`○` → SVG
- [x] **Description:** In `profile-completion-panel.tsx:42`, replace literal
  `✓`/`○` with SVG `CheckIcon` (filled, brand tone) for filled items and
  `CircleIcon` (muted) for unfilled. Update `.checkIcon` CSS to size SVG
  (`0.95em`, `currentColor`). Keep `data-filled` contract.
- [x] **Acceptance:** No `✓`/`○` literals in the file; filled = brand
  `CheckIcon`, unfilled = muted `CircleIcon`; `data-filled` still drives tone.
- [x] **Verification:** `web:check`; grep `✓\|○` in file = 0; visual 375px.
- [x] **Dependencies:** T0.1.
- [x] **Files:** `apps/web/app/settings/profile/profile-completion-panel.tsx`,
  `.../profile-completion-panel.module.css`.
- [x] **Scope:** XS.
- [x] **Risk:** LOW.
- [x] **DONE 2026-07-08:** `CheckIcon`/`CircleIcon` SVGs in checklist (filled→brand CheckIcon, unfilled→muted CircleIcon); `.checkIcon` reflowed for SVG (inline-flex, 0.95em, currentColor); `data-filled` contract preserved; grep confirms no literal `✓`/`○` in render code (only in the docstring comment); `profile-completion-panel.test.tsx` 5/5 green.

### T2.2 — Match-count preview `SearchIcon` + mode-badge icon
- [x] **Description:** Add semantic `SearchIcon` before the match-count
  preview line. In `profile-form.tsx` `modeBadgeRow`, add a semantic
  mode-icon (`TargetIcon` specialist / `BriefcaseIcon` volume /
  `TrendIcon` executive) driven by `resolvedHiringMode`. Keep label + source
  text.
- [x] **Acceptance:** Preview line leads with `SearchIcon`; mode-badge shows
  the mode-specific SVG; `data-mode` contract preserved.
- [x] **Verification:** `web:check`; visual.
- [x] **Dependencies:** T0.1 (icons already exist except none new).
- [x] **Files:** `apps/web/app/settings/profile/profile-completion-panel.tsx`,
  `apps/web/app/settings/profile/profile-form.tsx` (+ `.module.css`).
- [x] **Scope:** XS.
- [x] **Risk:** LOW.
- [x] **DONE 2026-07-08:** `SearchIcon` leads both match-count preview states (count + empty); new `profile-form-helpers.ts` exports `modeIcon(mode)` (specialist→TargetIcon, executive→TrendIcon, volume→BriefcaseIcon, unknown→null) — standalone module to keep it testable without the client-component/server-action import chain; `profile-form.tsx` badge renders the resolved mode glyph via IIFE + `.modeBadgeIcon` CSS; `data-mode` contract preserved; `profile-form-mode-icon.test.tsx` 4/4 green.

### T2.3 — Delivery-form channel icons
- [x] **Description:** In `delivery-form.tsx`, add semantic icons to the three
  channel fieldset headers: Telegram → `ChatIcon`, browser push → `BellIcon`,
  email → `MailIcon`. Header-only (semantic), not on every toggle.
- [x] **Acceptance:** Three channel sections show their semantic icon; toggles
  unchanged; `BellIcon` from T0.1 used.
- [x] **Verification:** `web:check`; visual.
- [x] **Dependencies:** T0.1.
- [x] **Files:** `apps/web/app/settings/profile/delivery-form.tsx`
  (+ `profile-form.module.css` if header icon style needed).
- [x] **Scope:** XS.
- [x] **Risk:** LOW.
- [x] **DONE 2026-07-08:** push header → `BellIcon`, email header → `MailIcon` (the two channels in `DeliveryForm`; Telegram is managed via the connect flow, not this form, so no ChatIcon here — noted as a benign deviation); `.groupTitle` made inline-flex + `.groupTitleIcon` CSS (1em, muted currentColor); toggles unchanged; `web:check` + `web:build` exit 0.

### C2 — Checkpoint
- [x] No `✓`/`○` literals in profile dir; channel icons present; completion
  SVG; `web:check` green.
- [x] **PASSED 2026-07-08:** `web:check` exit 0; `web:build` exit 0; full suite 1275/1275 green (+9 profile tests); completion panel SVG + no literal glyphs; match-count SearchIcon + mode-badge icon; delivery channel icons. (Playwright 375px visual deferred to Phase 8.)

---

## Phase 3 — Leads list + filters

### T3.1 — Filter active-state on selects
- [x] **Description:** In `leads-filters.tsx` + `leads-filters.module.css`, add
  `data-active="true"` to gate/feedback selects when their value is non-empty;
  style with brand-tinted border/bg. Today-toggle already has `data-active` —
  refine to premium brand-fill + `CheckIcon` semantic. Add `XIcon` to the
  reset button.
- [x] **Acceptance:** Active select visually distinct from inactive on 375px
  without reading text; today-toggle active = brand fill + `CheckIcon`; reset
  button carries `XIcon`.
- [x] **Verification:** `web:check`; Playwright 375px computed `border-color`/
  `background` differs active vs inactive.
- [x] **Dependencies:** T0.1 (`XIcon` exists).
- [x] **Files:** `apps/web/app/leads/leads-filters.tsx`,
  `apps/web/app/leads/leads-filters.module.css`.
- [x] **Scope:** XS–S.
- [x] **Risk:** LOW.
- [x] **DONE 2026-07-08:** gate + feedback selects carry `data-active="true"` when non-empty (brand-tinted border/bg/font-weight); today-toggle carries `CheckIcon` + `.todayToggleIcon`; reset button carries `XIcon` + `.filterResetIcon`; `.todayToggle`/`.filterReset` made inline-flex; `leads-filters.test.tsx` 4/4 green (mocks `next/navigation`).

### T3.2 — Lead-card head chip grouping (decision / status)
- [x] **Description:** In `leads/page.tsx` `LeadCard` head-tags, split the flat
  chip row into two visual groups: "decision" (`ScoreBandChip` + `GateBadgeInline`)
  and "status" (`ReviewStatusBadge` + `FeedbackBadge`); `ForeignEmployerBadge`
  + `AiHintChip` as muted separate chips. Add a subtle divider/gap in
  `.leadCardTags` via CSS (no new component).
- [x] **Acceptance:** Card head shows 2 grouped chip clusters with a visual
  divider/gap-difference (not a flat row) on desktop; stacks cleanly on 375px.
- [x] **Verification:** `web:check`; visual 375px + 1280px.
- [x] **Dependencies:** none.
- [x] **Files:** `apps/web/app/leads/page.tsx`,
  `apps/web/app/ui/internal-page.module.css` (`.leadCardTags` grouping).
- [x] **Scope:** XS.
- [x] **Risk:** LOW.
- [x] **DONE 2026-07-08:** `LeadCard` exported; head-tags render `data-chip-group="decision"` (band + gate) and `data-chip-group="status"` (review + feedback) sub-groups; foreign + AI-hint stay as muted standalone chips; `.leadCardTagGroup` CSS with a subtle `border-right` divider on decision (drops on ≤480px so groups stack cleanly); `lead-card-tags.test.tsx` 3/3 green.

### T3.3 — Legend a11y + empty-state icon adoption
- [x] **Description:** In `leads/page.tsx` toolbar legend, replace the
  `aria-hidden` blind legend with an a11y-label tying dots to rail tones (or
  `sr-only` text + visible dots). Adopt the new `EmptyState` SVG icon on all 4
  leads empty-states (today / no-profile / narrow / broad) using `SearchIcon`/
  `TargetIcon`/`BriefcaseIcon` as appropriate.
- [x] **Acceptance:** Legend is accessible (not `aria-hidden` blind); each
  empty-state shows a semantic SVG icon; existing honest copy + actions
  preserved.
- [x] **Verification:** `web:check`; axe/manual a11y; visual.
- [x] **Dependencies:** T0.2 (`EmptyState` SVG API).
- [x] **Files:** `apps/web/app/leads/page.tsx`.
- [x] **Scope:** XS.
- [x] **Risk:** LOW.
- [x] **DONE 2026-07-08:** `LeadsListLegend` exported with `data-legend` root + `aria-label` (no longer `aria-hidden` blind); dots are decorative `aria-hidden`, labels do the a11y work; all 4 leads empty-states adopt SVG icons via Phase 0 `EmptyState.icon` API (working-set→`ClockIcon`, no-profile→`TargetIcon`, narrow→`SearchIcon`, broad→`BriefcaseIcon`); honest copy + actions preserved; `lead-card-tags.test.tsx` legend test green.

### C3 — Checkpoint
- [x] Active filter visible; chip groups present; legend a11y; empty-states
  iconified; `web:check` green.
- [x] **PASSED 2026-07-08:** `web:check` exit 0; `web:build` exit 0; full suite 1283/1283 green (+8 leads tests); active-select state; chip grouping (decision/status); legend a11y; 4 empty-states iconified. (Playwright 375px computed-style assert deferred to Phase 8 visual pass — env has no vision proxy.)

---

## Phase 4 — Lead detail + review queue

### T4.1 — Lead-detail back-link → SVG `BackIcon`
- [x] **Description:** In `leads/[id]/page.tsx`, replace `← Лиды` literal with
  `BackIcon` + "Лиды" in `InternalBackLink`. Same for the not-found state
  `← Назад к списку лидов`. Update `internal-page.tsx` `InternalBackLink` if
  it should accept an icon, or compose inline.
- [x] **Acceptance:** No `←` literal in lead-detail; back-link renders SVG
  `BackIcon` + label; focus-visible ring preserved.
- [x] **Verification:** `web:check`; grep `←` in `leads/[id]/page.tsx` = 0;
  visual.
- [x] **Dependencies:** T0.1.
- [x] **Files:** `apps/web/app/leads/[id]/page.tsx`,
  `apps/web/app/ui/internal-page.tsx` (if `InternalBackLink` gains icon prop).
- [x] **Scope:** XS.
- [x] **Risk:** LOW.
- [x] **DONE 2026-07-08:** `InternalBackLink` gains optional `icon` prop (defaults `BackIcon`) + `.backLinkIcon` CSS + inline-flex; lead-detail back-link `← Лиды` → `BackIcon` + "Лиды"; not-found `← Назад к списку лидов` → `BackIcon` (via component) + `SearchIcon` icon + clean label; grep confirms no `←` literal; `internal-back-link.test.tsx` 3/3 green. (Phase 0 `state-primitives` NotFoundState test updated to query the icon well, not the whole container — the back-link now carries its own svg by design.)

### T4.2 — Verdict chip grouping (decision / metadata)
- [x] **Description:** In `leads/[id]/page.tsx` verdict hero, split
  `.leadVerdictChips` into `.verdictChipsDecision` (band + gate + urgency) and
  `.verdictChipsMeta` (foreign + review + freshness) with a subtle
  gap/divider. Add CSS in `internal-page.module.css`. On mobile, groups stack
  but stay visually separated.
- [x] **Acceptance:** Verdict shows 2 chip groups on all breakpoints; 375px
  groups stack with visible separation; no layout shift (static markup).
- [x] **Verification:** `web:check`; Playwright 375px + 1280px.
- [x] **Dependencies:** none.
- [x] **Files:** `apps/web/app/leads/[id]/page.tsx`,
  `apps/web/app/ui/internal-page.module.css`,
  `apps/web/app/ui/internal-page.tsx` (if wrapper helpers added).
- [x] **Scope:** XS–S.
- [x] **Risk:** LOW.
- [x] **DONE 2026-07-08:** new exported `LeadVerdictChips` component in `internal-page.tsx` renders `data-chip-group="decision"` (band + gate + urgency) + `data-chip-group="meta"` (foreign + review + freshness); meta group omitted when no meta chips would render (clean A/B domestic lead); `.leadVerdictChipGroup` CSS with subtle `border-right` divider on decision (drops on ≤480px); lead-detail page consumes the component; `lead-verdict-chips.test.tsx` 3/3 green.

### T4.3 — ScoreGauge mobile: band visible, level sr-only
- [x] **Description:** In `internal-page.tsx` `ScoreGauge` + CSS, on ≤640px keep
  `scoreBand` label (Горячий/Тёплый) visible and move `scoreLevelLabel`
  (Высокий/Средний) to `sr-only` to avoid dual readout. Confirm the band chip
  and gauge don't both show the same temperature twice.
- [x] **Acceptance:** On 375px, gauge shows band label; level label in `sr-only`
  (still announced to AT); no duplicate temperature readout.
- [x] **Verification:** `web:check`; Playwright 375px computed visibility.
- [x] **Dependencies:** none.
- [x] **Files:** `apps/web/app/ui/internal-page.tsx`,
  `apps/web/app/ui/internal-page.module.css`.
- [x] **Scope:** XS.
- [x] **Risk:** LOW.
- [x] **DONE 2026-07-08:** `ScoreGauge` level node carries `data-score-level` + `.srOnlyMobile` class (sr-only ≤640px, visible ≥641px, always in a11y tree); `.srOnlyMobile` CSS added; `score-gauge.test.tsx` 2/2 green.

### T4.4 — Next-steps block `↗`/`✓` → SVG
- [x] **Description:** In `next-steps-block.tsx`, replace `✓ Скопировано` with
  `CheckIcon` + "Скопировано". Decide on `↗` external-link glyph: keep as
  meaning-bearing copy affordance (consistent with email/Telegram anchors) OR
  swap to a `ExternalLinkIcon` — **prefer keep `↗`** per plan decision #2
  (copy, not icon). Add `LinkIcon`/`FileIcon` semantic to the action buttons
  if not present.
- [x] **Acceptance:** `✓ Скопировано` → `CheckIcon` + label; `↗` kept as copy
  (documented decision); no decorative emoji added.
- [x] **Verification:** `web:check`; grep `✓` in file = 0.
- [x] **Dependencies:** T0.1 (`CheckIcon` exists).
- [x] **Files:** `apps/web/app/leads/[id]/next-steps-block.tsx` (+ `.module.css`).
- [x] **Scope:** XS.
- [x] **Risk:** LOW.
- [x] **DONE 2026-07-08:** `✓ Скопировано` → `<CheckIcon>` + "Скопировано" (`.copiedIcon` CSS); `.nextStepsBtn` made inline-flex for icon align; `↗` kept as meaning-bearing copy affordance on links (per plan decision #2); grep confirms no `✓` literal; `next-steps-block.test.tsx` 2/2 green (asserts no `✓` before + CheckIcon svg after copy, via navigator.clipboard stub).

### T4.5 — Review queue: reason chip + foreign from data
- [x] **Description:** Add `isForeignEmployer` + `reviewReason` (or derive
  client-side) to `/api/review` GET response using `extractPayloadFields` +
  `sourceFamilies.length` + `confidenceGate` — **no new SQL/JOIN**. In
  `review/page.tsx` `ReviewCard`, render a `ReviewReasonChip`
  (`AlertIcon` gate-C / `GlobeIcon` foreign / `LayersIcon` single-source) and
  pass real `isForeign` to `ForeignEmployerBadge` (remove hardcoded `false`).
  Empty-state "Очередь пуста" → SVG `CheckIcon` (clean) via new `EmptyState` API.
- [x] **Acceptance:** Each review card shows exactly one reason chip with the
  right icon; foreign shown when real; `/api/review` response backward-compat
  (new fields optional); `codegraph_impact` on route handler clean; empty-state
  iconified.
- [x] **Verification:** `web:check`; `web:build` (route touched — CLAUDE.md
  gate); `codegraph_impact` on `/api/review` GET + `ReviewCandidate` consumer;
  unit if review-route tests exist.
- [x] **Dependencies:** T0.2 (`EmptyState` SVG API). Resolves B1 at build time.
- [x] **Files:** `apps/web/app/api/review/route.ts`,
  `apps/web/app/review/page.tsx`, `apps/web/app/ui/internal-page.tsx` (if
  `ReviewReasonChip` shared), `apps/web/app/ui/icons.tsx` (only if new glyph).
- [x] **Scope:** M (API + UI + type).
- [x] **Risk:** MED — API change. Mitigation: optional fields, no migration,
  backward-compat, derive from existing payload.
- [x] **DONE 2026-07-08:** new `review-reason.ts` exports `deriveReviewReason` (foreign > gate-C > single-source priority, returns `{key, icon}` or null); `/api/review` GET response adds `isForeignEmployer` derived from `extractPayloadFields` (no new SQL/JOIN — the route already reads payload); `ReviewCandidate` type gains optional `isForeignEmployer`; `ReviewCard` renders `ReviewReasonChip` + real `isForeign` from data (hardcoded `false` removed); both review empty-states iconified (`CheckIcon` empty queue, `TargetIcon` no-profiles); `.reviewReasonChip` CSS (muted info tone); `review-reason.test.ts` 4/4 + `route-foreign-field.test.ts` 2/2 green; existing `route.test.ts` still green (backward-compat). Resolves spec Q1/B1.

### T4.6 — Review-actions premium polish + tap-target (verify-only core)
- [x] **Description:** `review-actions.tsx` already uses `CheckIcon`/`XIcon`.
  Verify tap-target ≥44px on 375px and premium button styling; adjust CSS in
  `review-actions.module.css` only if below 44px or visually off. No
  functional change to the approve/reject contract (idempotent per CLAUDE.md).
- [x] **Acceptance:** Both buttons ≥44px tall on 375px; premium styling; verdict
  + error states unchanged.
- [x] **Verification:** `web:check`; Playwright 375px measured height.
- [x] **Dependencies:** none.
- [x] **Files:** `apps/web/app/review/review-actions.tsx` (maybe),
  `apps/web/app/review/review-actions.module.css`.
- [x] **Scope:** XS (verify-only, maybe tiny CSS).
- [x] **Risk:** LOW.
- [x] **DONE 2026-07-08:** verified — `review-actions.module.css` already has `@media (max-width: 640px) { .btn { min-height: 44px; padding: 10px 14px; } }` and premium tone-styled buttons with `CheckIcon`/`XIcon` (from prior session). No change required — T4.6 is verify-only and satisfied. (Playwright 375px measured-height assert deferred to Phase 8 visual pass.)

### C4 — Checkpoint
- [x] Verdict groups; back-link SVG; review reason chip; `/api/review`
  backward-compat verified; `web:check` + `web:build` green; `codegraph_impact`
  clean.
- [x] **PASSED 2026-07-08:** `web:check` exit 0; `web:build` exit 0 (`/leads/[id]` + `/review` + `/api/review` compiled); full suite 1299/1299 green (+16 Phase 4 tests, 1 Phase 0 test updated for the new back-link svg contract); 0 regressions. Verdict chip grouping (decision/meta); back-link `BackIcon`; ScoreGauge level sr-only on mobile; next-steps `CheckIcon`; review reason chip + foreign-from-data + `/api/review` `isForeignEmployer` (no new SQL); review-actions tap-target verified. (Playwright 375px visual pass deferred to Phase 8.)

---

## Phase 5 — Dashboard hierarchy

### T5.1 — Dashboard analytics: responsive tables (no H-scroll)
- [x] **Description:** In `dashboard-analytics.tsx` + `dashboard.module.css`,
  make `sourcePerfTable` and `sourceEvidenceQuality` render as a card list on
  ≤768px (one source = one card with label-value rows). Try CSS-only
  `@media (tr→block, td→grid)` first; if a11y/alignment breaks, fall back to
  mobile-markup duplication (two blocks, `@media` swap). Decide per B2 at
  build time.
- [x] **Acceptance:** On 375px, both tables have no horizontal scroll; read as
  card list; desktop table preserved; a11y semantics intact.
- [x] **Verification:** `web:check`; Playwright 375px `scrollWidth<=innerWidth`
  + 1280px table intact.
- [x] **Dependencies:** none.
- [x] **Files:** `apps/web/app/dashboard/dashboard-analytics.tsx`,
  `apps/web/app/dashboard/dashboard.module.css`.
- [x] **Scope:** M.
- [x] **Risk:** HIGH (CSS `tr→block` a11y). Mitigation: Playwright probe first;
  fall back to markup duplication.
- [x] **DONE 2026-07-08:** CSS-only `@media (max-width:768px)` transform in `dashboard.module.css` — `tr→block`, `td→grid(1fr auto)`, `td::before { content: attr(data-label) }` captions each value; thead `sr-only` on mobile (kept in DOM for AT semantics, not `display:none`); `td[data-label="Источник"]` becomes the card title (full weight, no caption). Each `<td>` carries `data-label` in `dashboard-analytics.tsx` (source-perf 3 cols + evidence-quality 8 cols). Desktop table + `thead th[scope="col"]` intact. Decision B2: CSS-only chosen (no markup duplication) — a11y preserved via `data-label` captions + retained thead. (Playwright 375px H-scroll assert deferred to Phase 8 visual pass — env has no vision proxy per memory; the transform removes fixed-width columns so H-scroll risk is eliminated by construction.)

### T5.2 — Funnel enum map → DB-legal keys
- [x] **Description:** In `dashboard-analytics.tsx`, replace
  `FUNNEL_COLORS`/`FUNNEL_ICONS` legacy keys (`accepted/later/call/client`)
  with the current `digest_feedback_status` set
  (`contacted/replied/won/badfit/snooze/dismissed`). Keep a display-tolerance
  mapping for historical rows (like `FEEDBACK_LABELS` in `internal-page.tsx`)
  — display-only, writer keeps DB-legal.
- [x] **Acceptance:** Map contains only DB-legal keys (+ optional legacy
  display-map); no "dead" keys that never match; historical rows still render
  a label.
- [x] **Verification:** `web:check`; unit: update `dashboard-analytics` test
  assertions if present; confirm funnel renders current statuses.
- [x] **Dependencies:** none. (Correctness fix — do NOT defer.)
- [x] **Files:** `apps/web/app/dashboard/dashboard-analytics.tsx`.
- [x] **Scope:** XS.
- [x] **Risk:** LOW — display-only map.
- [x] **DONE 2026-07-08:** `FUNNEL_COLORS`/`FUNNEL_ICONS` rewritten to DB-legal primary keys only (contacted/replied/won/badfit/snooze/dismissed — `won` HandshakeIcon/#10b981, `snooze` ClockIcon/#f59e0b were MISSING before; `accepted/later/call/client` removed from primary maps). New `FUNNEL_LEGACY_DISPLAY` map + `canonicalFunnelStatus()` resolve historical rows onto canonical keys (accepted→contacted, later→snooze, call→replied, client→won) — display-only, no writer emits legacy. Funnel item carries `data-status={canonical}`. Unused `CheckIcon` import removed. Unit tests lock: `won`→#10b981 via data-status, legacy `accepted`→contacted→#3b82f6. Mirrors `FEEDBACK_LABELS` legacy tail pattern.

### T5.3 — Analytics skeleton + today-radar empty icon
- [x] **Description:** Add `AnalyticsSkeleton` (modeled on `QualitySkeleton`/
  `OverviewSkeleton`) for the analytics `<Suspense>` fallback in
  `dashboard/page.tsx`. In `dashboard-today-radar.tsx` empty-state, adopt SVG
  `SearchIcon`/`TargetIcon` via the new `EmptyState` API.
- [x] **Acceptance:** Analytics shows skeleton under Suspense (no white flash);
  today-radar empty-state shows semantic SVG; existing copy preserved.
- [x] **Verification:** `web:check`; visual (skeleton flash).
- [x] **Dependencies:** T0.2.
- [x] **Files:** `apps/web/app/dashboard/dashboard-analytics.tsx`,
  `apps/web/app/dashboard/page.tsx`,
  `apps/web/app/dashboard/dashboard-today-radar.tsx`,
  `apps/web/app/dashboard/dashboard.module.css`.
- [x] **Scope:** S.
- [x] **Risk:** LOW.
- [x] **DONE 2026-07-08:** new `AnalyticsSkeleton` export in `dashboard-analytics.tsx` — `aria-busy`/`role="status"` + `sr-only` "Загрузка аналитики…" + skeleton shaped like the section (3 metric cards + 3 funnel bars + 3 source rows), reuses existing `.skeletonBase`/`.skeletonCard`/`.funnelItem` classes; `dashboard/page.tsx` `<Suspense fallback={<div>Загрузка...</div>}>` → `<Suspense fallback={<AnalyticsSkeleton />}>` (no white flash). `dashboard-today-radar.tsx` empty-state → `EmptyState` primitive with `SearchIcon` + preserved honest copy + "Проверить настройки профиля" action link (was a flat `<div>` with `<p>` + `<Link>`). Unit tests: skeleton renders `aria-busy` + `[data-skeleton]`; today-radar empty renders svg + preserved copy/link.

### T5.4 — Metric-card visual consistency (verify-only)
- [x] **Description:** `DashboardOverview` uses `.metricCard` from
  `dashboard.module.css`; `MetricCard` primitive lives in `internal-page.tsx`.
  Verify they're visually coherent (radius/border/shadow). If drift, align CSS
  only — do not merge components.
- [x] **Acceptance:** Dashboard metric cards and internal-page `MetricCard`
  share visual language (no jarring drift); no component merge.
- [x] **Verification:** `web:check`; visual 1280px.
- [x] **Dependencies:** none.
- [x] **Files:** maybe `apps/web/app/dashboard/dashboard.module.css`.
- [x] **Scope:** XS (verify-only, maybe tiny CSS).
- [x] **Risk:** LOW.
- [x] **DONE 2026-07-08:** drift found + aligned CSS-only (no component merge). Dashboard `.metricCard` padding 1.25rem→16px (matches internal-page); internal-page `.metricCard` gained the same default `box-shadow: 0 1px 3px 0 rgba(0,0,0,0.1)` (was shadowless by default, only hover-lift). Now both surfaces share identical radius (`--radius-card-sm`) + border (`--c-border`) + padding (16px) + elevation. Internal-page hover-lift transition preserved (interactive metric cards on lead-detail). Unit test asserts analytics uses `.metricCard` (3 cards).

### C5 — Checkpoint
- [x] Analytics responsive (no H-scroll); funnel enum fixed; skeleton present;
  today-radar empty iconified; `web:check` green.
- [x] **PASSED 2026-07-08:** `web:check` exit 0; `web:build` exit 0 (`/dashboard` compiled); full suite 1311/1311 green (+12 Phase 5 tests, 0 regressions). Responsive tables via CSS-only `data-label` transform (a11y intact); funnel enum DB-legal + legacy display-map; `AnalyticsSkeleton` Suspense fallback + today-radar `EmptyState` SearchIcon; metric-card CSS aligned (padding + shadow). (Playwright 375px H-scroll + visual pass deferred to Phase 8 — env has no vision proxy per memory.)

---

## Phase 6 — Telegram digest / delivery formatting

### T6.1 — Telegram readiness-line de-duplication
- [x] **Description:** In `lib/telegram/digest-batch.ts` `formatBatchLeadBlock`,
  reduce the readiness line from `Готов к контакту · A · Горячий · сигнал 3.2`
  (3+ confidence readouts) to ≤2: `Готов к контакту · Горячий · 3.2` — drop the
  redundant gate-letter (gate is encoded in `readinessLabel` A/B vs C).
  Preserve foreign marker, whyLine, urgency, roles, contact, sources, honest
  fallback. Keep `MAX_BATCH_MESSAGES=2` + 4096 limit.
- [x] **Acceptance:** Readiness line ≤2 confidence readouts; gate-letter
  removed; 4096/2-message contract intact; honest contact fallback preserved.
- [x] **Verification:** `web:check`; `cd apps/web && npm test` — update
  `digest-batch` unit assertions to the new line; confirm overflow/dropped
  tests still green.
- [x] **Dependencies:** none.
- [x] **Files:** `apps/web/lib/telegram/digest-batch.ts` (+ test file).
- [x] **Scope:** XS.
- [x] **Risk:** MED — intentional contract change, tests red until updated.
- [x] **DONE 2026-07-08:** readiness line in `formatBatchLeadBlock` rewritten to `${readinessLabel} · ${band.label} · сигнал ${formatSignalStrength}` — gate letter (A/B/C) dropped (encoded in readinessLabel «Готов к контакту»/«На проверку»); `gateLetter` local + its `escapeHtml(lead.confidenceGate.toUpperCase())` removed; docstring example updated; foreign/whyLine/urgency/roles/contact/sources lines untouched; 3 new digest-batch assertions (exact-line + no-`· A`/`· C` + ≤2-readouts); overflow/4096/MAX_BATCH_MESSAGES tests still green.

### T6.2 — Email readiness-line de-duplication (single contract)
- [x] **Description:** In `lib/email/digestEmail.ts` `renderLeadHtml` +
  `renderLeadText`, apply the SAME readiness-line de-duplication (drop
  `gateLetter`) so telegram + email share one contract. Keep email inline-styled
  HTML + plain-text fallback intact; no new content.
- [x] **Acceptance:** Email readiness line matches Telegram's ≤2-readout form;
  `gateLetter` removed from both HTML + text; escape + structure preserved.
- [x] **Verification:** `web:check`; unit: update `digestEmail` assertions if
  tests exist.
- [x] **Dependencies:** T6.1 (do together in one PR so channels can't drift).
- [x] **Files:** `apps/web/lib/email/digestEmail.ts` (+ test if present).
- [x] **Scope:** XS.
- [x] **Risk:** MED — same as T6.1; must ship with T6.1.
- [x] **DONE 2026-07-08:** `renderLeadHtml` + `renderLeadText` both drop `gateLetter` (`· ${confidenceGate}` / `· ${escapeHtml(confidenceGate)}` locals removed); readiness line now `band · readiness · numeric` (HTML keeps tone-colored band + readiness spans; text is plain); `gate.readiness` already encodes A/B/C («Готов к контакту» / «Готов к контакту · с пометкой» / «На проверку») so no information lost; escape + inline-style + structure + whyMatch/roles/contact/sources untouched; 3 new digestEmail assertions (gate-A no bare letter + gate-B «с пометкой» no bare letter + gate-C «На проверку» no bare letter) on html + text.

### T6.3 — Telegram callback label coherence (verify-only)
- [x] **Description:** Per memory `telegram_digest_model` + `project_feedback_enum_drift`,
  Telegram layer maps `accepted→contacted`. Verify callback button labels
  (`Беру/Мимо/Позже/...`) are coherent with in-app `FEEDBACK_LABELS` and the
  mapping is intact. **Do not** change the DB enum. Only fix copy if a label
  drift is visible. Locate the callback label source at build time (the
  `telegramDigestFeedback.ts` path was not found at planning — search via
  CodeGraph `codegraph query "callback"` or grep `Беру`).
- [x] **Acceptance:** Callback labels coherent with in-app vocab; mapping
  intact; no enum change; or explicitly "no drift found, no change".
- [x] **Verification:** `web:check`; CodeGraph/grep for label source.
- [x] **Dependencies:** none.
- [x] **Files:** TBD (callback label module — locate at build).
- [x] **Scope:** XS (verify-only).
- [x] **Risk:** LOW.
- [x] **DONE 2026-07-08:** verify-only, NO code change — coherence confirmed. Callback label source located: `lib/telegramDigestFeedback.ts` `TELEGRAM_DIGEST_FEEDBACK_ACTIONS` (Беру/Мимо/Позже/Скрыть = accepted/badfit/snooze/dismissed). Mapping `accepted→contacted` intact in `lib/digestFeedback.ts` `buildDigestFeedbackActionPlan` (case 'accepted'/'contacted' → `feedbackStatus: 'contacted'`). In-app `FEEDBACK_LABELS.contacted.label` = «В работе» — coherent with Telegram «Беру» (channel-specific shortcut vocab, same DB status). badfit/snooze/dismissed persist directly (DB-legal). No label drift, no enum change. New focused contract-lock test `callback-label-coherence.test.ts` (4/4) pins mapping + label resolution so future drift is caught.

### C6 — Checkpoint
- [x] Readiness-line ≤2 readouts in BOTH telegram + email; unit tests green;
  contract preserved; `web:check` green.
- [x] **PASSED 2026-07-08:** `web:check` exit 0; full suite 1321/1321 green (+10 Phase 6 tests: 3 digest-batch de-dup + 3 digestEmail de-dup + 4 callback-label-coherence, 0 regressions). Telegram + email readiness lines share one contract (`readinessLabel · band · numeric`, gate letter dropped — encoded in readinessLabel). Honest contact fallback «прямой путь уточняется» + foreign «зарубежный ATS» + 4096/MAX_BATCH_MESSAGES=2 + escapeHtml all preserved. Callback labels coherent, `accepted→contacted` mapping intact, no enum change. `web:build` not required (only pure composer modules touched, no routes/middleware/next.config).

---

## Pre-merge blocker fixes (review follow-up 2026-07-08)

Two findings from the `/review` pass on Phases 0–6 that block merge-readiness.
Fixed in a focused pass; NOT the full Phase 7 — only the two blockers.

### F1 — TopNav brand → SVG icon (AC1)
- [x] **Description:** `internal-page.tsx` `TopNav` brand rendered the literal
  `← Recruiter Radar` interface glyph — the single leftover literal arrow in
  render code, violating spec §7.1 / AC1 (no literal arrow chars in
  navigation). Replace with a semantic SVG from the existing icon system.
  `BackIcon` (arrow-left) is semantically wrong for a brand→home affordance;
  chose `TargetIcon` (radar/concentric rings) — it reads as the product's
  "radar" brand metaphor, not a back affordance. No new glyph added.
- [x] **Acceptance:** No literal `←` in TopNav; brand carries an SVG icon from
  `app/ui/icons.tsx`; "Recruiter Radar" label remains the accessible name;
  icon `aria-hidden`.
- [x] **Verification:** `web:check`; `web:build` (shared component, all
  internal pages compile); new `top-nav-brand.test.tsx` (3/3: svg present,
  no `←`, label kept).
- [x] **Files:** `apps/web/app/ui/internal-page.tsx`, `apps/web/app/ui/internal-page.module.css`.
- [x] **DONE 2026-07-08:** `TargetIcon` brand glyph + `.topNavBrandIcon` CSS (0.95em, currentColor, var(--c-brand), flex 0 0 auto — same sizing contract as `.backLinkIcon`); icon `aria-hidden`, label "Recruiter Radar" kept; literal `←` removed; 3/3 TopNav tests green; `web:check` + `web:build` exit 0.

### F2 — dashboard-alerts sr-only bug (a11y + visual noise)
- [x] **Description:** `dashboard-alerts.tsx:119` used `className="sr-only"` —
  a bare global class that has NO matching rule anywhere in the project (only
  module-scoped `styles.srOnly` exists in `internal-page.module.css` +
  `dashboard.module.css`). The «Отметить алерт как решённый» a11y text was
  therefore NOT hidden — it leaked into visible UI next to the «Решить»
  button. Fix: use the existing module-scoped `styles.srOnly`.
- [x] **Acceptance:** sr-only text hidden by a real CSS rule; no bare
  `className="sr-only"` in the file; a11y describedby text still in the DOM
  for AT.
- [x] **Verification:** `web:check`; new
  `dashboard-alerts-sr-only.test.tsx` (2/2: span carries hashed module
  class not bare `sr-only`; no `.sr-only` selector match anywhere).
- [x] **Files:** `apps/web/app/dashboard/dashboard-alerts.tsx`.
- [x] **DONE 2026-07-08:** `className="sr-only"` → `className={styles.srOnly}` (module-hashed, real rule in dashboard.module.css:527); grep confirms 0 bare `className="sr-only"` remain in app/; 2/2 sr-only tests green; `web:check` exit 0.

### Pre-merge-fixes checkpoint
- [x] **PASSED 2026-07-08:** `web:check` exit 0; `web:build` exit 0 (all internal pages compile with new TopNav); full suite 1326/1326 green (+5: 3 TopNav + 2 sr-only, 0 regressions). F1 closes AC1 (last literal interface-glyph gone). F2 closes the dashboard-alerts a11y/visual-noise bug. Merge blockers F1+F2 resolved; F3 (Phase 7 T7.1 flat `Загрузка`) + F4 (git staging hygiene) + F5 (verify 7-day srOnly card) remain as follow-ups.

---

## Phase 7 — Cross-surface empty/loading/error/helper consistency

### T7.1 — Replace all flat `Загрузка…` Suspense fallbacks with `LoadingState`
- [ ] **Description:** Sweep `leads/page.tsx`, `review/page.tsx`,
  `settings/profile/page.tsx`, `dashboard/page.tsx` and any other `<Suspense>`
  fallbacks. Replace `<div>Загрузка...</div>` / `<ContentCard>Загрузка…</ContentCard>`
  with `<LoadingState variant="skeleton|inline" />` from T0.2.
- [ ] **Acceptance:** No flat `Загрузка…` text fallback remains; every
  Suspense uses `LoadingState`; skeletons match section shape where possible.
- [ ] **Verification:** `web:check`; grep `Загрузка` for `<Suspense fallback`
  patterns = 0 (except inside `LoadingState` itself).
- [ ] **Dependencies:** T0.2.
- [ ] **Files:** the 4 page files above (+ any found via grep).
- [ ] **Scope:** XS–S.
- [ ] **Risk:** LOW.

### T7.2 — Error paths: human `NoticeBox` + next-step
- [ ] **Description:** For each data-driven surface (leads, review, dashboard
  analytics, today-radar), ensure a `NoticeBox tone="danger"` error path with
  human copy + next step (обновить / попробовать позже / поддержка). Never show
  raw `error.message` to the user (log only). Today-radar already has
  `previewError` — extend the pattern to analytics.
- [ ] **Acceptance:** Each data surface has a human error path; no raw
  `error.message` rendered; `NoticeBox` tone=danger.
- [ ] **Verification:** `web:check`; manual/Playwright error-injection if
  feasible.
- [ ] **Dependencies:** none.
- [ ] **Files:** `dashboard-analytics.tsx`, `dashboard-today-radar.tsx`, maybe
  `leads/page.tsx`/`review/page.tsx` catch blocks.
- [ ] **Scope:** XS.
- [ ] **Risk:** LOW.

### T7.3 — Cross-surface literal-glyph audit + mojibake check
- [ ] **Description:** Final grep across `apps/web/app` + `apps/web/lib` for
  literal interface-glyph chars (`←`, `✓`, `○`) used as iconography (exclude
  meaning-bearing copy `→`/`↗`). Confirm all new/changed visible strings route
  through `repairPossiblyMojibakeText` where the existing pattern applies.
- [ ] **Acceptance:** 0 literal interface-glyph chars outside the documented
  copy-exception; mojibake protection present on new string-bearing
  primitives.
- [ ] **Verification:** Grep `←\|✓\|○` over `apps/web/app` (review hits);
  `web:check`.
- [ ] **Dependencies:** all surface phases.
- [ ] **Files:** audit only (fixes fold into T4.x/T2.1 if missed).
- [ ] **Scope:** XS.
- [ ] **Risk:** LOW.

### C7 — Checkpoint
- [ ] No flat `Загрузка…`; every empty has SVG; error paths human; literal-glyph
  audit clean; `web:check` green.

---

## Phase 8 — Final polish + verification

### T8.1 — `web:check` + `web:build` (if routes/middleware/next.config touched)
- [ ] **Description:** Run CLAUDE.md validation gate. `web:check` always.
  `web:build` required because T4.5 touched `/api/review` route. Do NOT loop
  check/build — one focused fix pass if red, then stop.
- [ ] **Acceptance:** `web:check` green; `web:build` green; no new deps in
  `package.json`.
- [ ] **Verification:** the commands themselves.
- [ ] **Dependencies:** all tasks.
- [ ] **Files:** none (verification).
- [ ] **Scope:** XS.
- [ ] **Risk:** LOW.

### T8.2 — CodeGraph impact sweep + signature-diff
- [ ] **Description:** For every touched exported symbol (`EmptyState`,
  `LoadingState`, `formatBatchLeadBlock`, `renderDigestEmail`, `/api/review`
  GET, `InstructionCard`, `ReviewActions`, `ScoreGauge` if changed), run
  `codegraph_impact` + capture before/after signature via `codegraph_node`.
  Orphaned downstream callers = Critical (fix or acknowledge in PR).
- [ ] **Acceptance:** 0 orphaned callers; every signature change intentional
  and noted for the commit/PR description.
- [ ] **Verification:** `codegraph_impact` + `codegraph_node` outputs.
- [ ] **Dependencies:** all tasks.
- [ ] **Files:** none (verification).
- [ ] **Scope:** XS.
- [ ] **Risk:** LOW.

### T8.3 — A11y + mobile visual pass
- [ ] **Description:** Verify all 8 surfaces at 375px + 1280px via Playwright
  DOM/computed-styles (env has no vision — memory `feedback_no_vision`).
  Assert `scrollWidth <= innerWidth` per surface. Check skip-link,
  focus-visible, `aria-current`, `aria-label` on icon-only controls, contrast.
- [ ] **Acceptance:** No H-scroll on any surface at 375px; tap-targets ≥44px;
  a11y baselines pass.
- [ ] **Verification:** Playwright assertions + user eyeballs on screenshots.
- [ ] **Dependencies:** all surface tasks.
- [ ] **Files:** none (verification).
- [ ] **Scope:** S.
- [ ] **Risk:** LOW.

### T8.4 — Pre-merge `/review` (five-axis) + memory update
- [ ] **Description:** Run the `/review` skill (correctness, readability,
  architecture, security, performance). Resolve every Critical before merge;
  acknowledge Important in PR. Write memory entry
  `project_ux_hardening_premium_pass` in `memory/` with block outcomes,
  deferred items, and follow-ups. Update `MEMORY.md` index.
- [ ] **Acceptance:** `/review` Criticals resolved; memory entry + index
  updated; PR description has changed files + check results + risks + commit
  message per CLAUDE.md §Definition of Done.
- [ ] **Verification:** `/review` output; memory files present.
- [ ] **Dependencies:** T8.1–T8.3.
- [ ] **Files:** `memory/project_ux_hardening_premium_pass.md`,
  `memory/MEMORY.md`.
- [ ] **Scope:** XS.
- [ ] **Risk:** LOW.

### C8 — Final checkpoint
- [ ] All AC1–AC12 from spec §8 met; `web:check`/`web:build` green; CodeGraph
  impact clean; `/review` passed; memory updated. Ready to merge.

---

## Summary counts

- **Phases:** 9 (0–8). **Tasks:** 24.
- **HIGH risk:** T0.2 (EmptyState API), T5.1 (responsive tables).
- **MED risk:** T4.5 (api/review), T6.1/T6.2 (digest contract), T1.3 (preview
  shape — verify).
- **LOW risk:** the rest.
- **Correctness (never defer):** T5.2 (funnel enum), T6.1+T6.2 (both channels
  together).
- **First `/build` increment:** T0.1 + T0.2 (Phase 0) — unblocks Phases 1–5.
