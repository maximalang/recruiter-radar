---
name: project-ai-assist-stage1
description: Stage-1 AI-assist is shipped as DETERMINISTIC synthesis (fit explanation + company summary) + a model-free lib/ai/ boundary — no LLM is wired, and the next AI phase targets lead quality/quantity, NOT copywriting
metadata:
  type: project
---

Stage-1 AI-assist shipped 2026-06-27 (commits cb3adbc, b45be07, 826ab5e) per `docs/specs/2026-06-27-stage1-ai-assist-deterministic.md`. It is **deterministic synthesis over existing evidence, not an LLM**:

- `apps/web/lib/leads/fit-explanation.ts` — `buildFitExplanation(lead, profile)` → profile-aware "почему подходит" lines; each line carries a `basis` tracing to a `ScoringReason.key` or a profile↔lead match. No line without a supporting input. Rendered full on lead detail, compact (first line) on each list card keyed by `clientProfileId`.
- `apps/web/lib/leads/company-summary.ts` — `buildCompanySummary(lead)` → identity / hiringMotion / agencyRelevance; degrades to LESS on weak evidence (gate C/D, single source, no roles); no hiring claim without vacancy counts.
- `apps/web/lib/ai/` — model-free boundary: `AI_CAPABILITIES` / `AI_PROHIBITIONS` / `PROTECTED_LEAD_FIELDS` + `assertNoOverride` guard + future hook *types only* (explanation-enhance, gap-enrich, intent-classify, weak-signal-extract, opener-draft). No provider, no network, no deps.

**Priority shift from the S4 roadmap (important):** S4 §D framed Stage 1 as AI opener/best-angle rewriting. That was **re-scoped** — Stage 1 is lead *understandability* + a clean AI seam. The **next** AI phase targets lead **quality/quantity** (signal interpretation, structural gap-filling, weak-signal recovery, ranking) — NOT message copywriting. Outreach stays deterministic (`lib/outreach-templates.ts`). Don't regress the next AI session into "AI for drafts."

Hard line (frozen in `boundary.ts` + tests): AI may never change FIUR score, confidence gate, or raw evidence; never invent companies/roles/industries/contacts; never bypass `contactPolicy`. See [[project_client_product_wiring]] for the profile gating the fit builder reads.
