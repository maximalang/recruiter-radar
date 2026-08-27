<!-- CODEGRAPH_START -->
## CodeGraph (mandatory — primary search engine)

CodeGraph (`codegraph_*`) is the **primary** way to read this codebase. Detailed rules ship with the MCP server's SessionStart instructions; project-specific overrides only:

- **Default search tool is CodeGraph, not grep/Read.** Before any `Grep` / `Glob` / `Read` to locate a symbol, file, or trace usage, you MUST first try `codegraph_context` / `codegraph_search` / `codegraph_callers`. Use grep/Read only for: literal string/comment/log lookups; confirming a single detail in a file already located via CodeGraph; non-indexable files (binary, generated, markdown, `.env.example`).
- **Never delegate codebase exploration to a sub-agent** when CodeGraph can answer. Spawning `Agent` / `Explore` for "how does X work" or "where is Y" repeats indexed work and costs 5–10× the tokens. Sub-agents are for genuinely open-ended research across non-code artifacts (docs, web, multiple repos).
- **Index health first.** If CodeGraph returns "not initialized" or stale, run `codegraph_status` and report — never silently fall back to grep.
- **Fallback contract:** if MCP SessionStart instructions are absent, treat the rules above as the full contract — do not fall back to grep/Read as default.
<!-- CODEGRAPH_END -->

## Recruiter Radar — Product Identity

Russia-first, evidence-first, premium client-intelligence radar for recruitment agencies.

**It IS:** self-serve radar that surfaces companies worth contacting now, with evidence and confidence; Telegram-first delivery; quality-first (trust, dedupe, confidence, feedback loops).

**It is NOT:** ATS, CRM, generic job parser, mass outreach/spam tool, candidate sourcing.

**Core loop:** Landing → live preview → pilot activation → client profile → Telegram → daily digest → feedback buttons → suppression/reweighting → better digests.

**Tech:** Next.js + Postgres for product core. Orchestration via cron-trigger + `/api/cron/daily-radar` (VPS crontab in prod, replacing Railway cron-trigger); n8n is decommissioned and NOT deployed. Core business logic (scoring, entity resolution, confidence gates, billing, suppression, digest/feedback state, prompt versioning) **never** lives in external orchestration — always in app code.

## Quality Principles

Optimize for trust and clarity over feature volume. Every lead must answer: who is the company, what changed, why now, why fit this agency, what evidence, safest contact path, next action.

Do NOT add features that produce more leads without improving evidence, confidence, dedupe, feedback, billing, delivery reliability, trust, security, activation, or conversion.

## FIUR Scoring Model

`Total = Fit + Intent + Urgency + Reachability`. Each component clamped to [0, 1]; total ∈ [0, 4]. Additive form is the product contract — see `docs/product.md` §FIUR and `apps/web/lib/scoring/fiur.ts`.

- **Fit:** ICP, role/function, industry, geography, size, exclusions
- **Intent:** relevant vacancies, freshness, hiring burst, independent confirmation, direct career page
- **Urgency:** burst, hard-to-fill, new region, corporate event, repeated/stale roles
- **Reachability:** corporate website, career page, generic HR contact, safe non-personal route

A company hiring an internal recruiter is NOT a hot signal by itself.

## Confidence Gates

| Gate | Criteria | Delivery |
|---|---|---|
| **A** | 2+ independent evidence layers, clean entity match, direct company surface | Auto-deliver |
| **B** | 1 strong source + enrichment | Auto-deliver with confidence label |
| **C** | Platform-only aggregation or questionable entity match | Review required |
| **D** | Context without direct hiring proof | No lead; supporting context only |

## Telegram Digest

Short, actionable, stateful. Each lead: company, score, confidence, why now, evidence summary, best angle, safe next action.

Inline buttons: `Беру / Мимо / Позже / Уже написал / Ответили / Созвон / Клиент / Скрыть`.

Callback handling: authenticated, idempotent, logged, replay-safe, connected to digest candidate state, reflected in future suppression/reweighting.

## Security Rules

NEVER commit secrets. Forbidden in repo: real Telegram tokens, API keys, DB URLs, `.env*`, n8n production exports with secrets, `.next/`, `node_modules/`, ZIP archives, dumps. Use `.env.example` for variable names only.

NEVER read `.env*`, `node_modules/`, `.next/`, `build/`, `dist/`. (Also enforced via `.claude/settings.json` denyRead.)

## Validation Commands

After code changes:
- Always: `npm run web:check`
- Run `npm run web:build` only if routes/middleware/`next.config.*` changed, OR `web:check` passed and patch is commit-ready
- Do NOT loop check/build. If check fails: one focused fix pass, then stop.

If migrations changed: inspect schema consistency, mention how to apply (applied automatically via `docker-entrypoint.sh` on container start, or manually via `psql`). If Telegram webhook changed: describe auth, idempotency, replay-safety, callback ack.

## Code Standards

TypeScript strictly. Small explicit functions. Avoid broad rewrites. No deps without clear reason. Russian copy: concise, premium, specific.

**Avoid:** «гарантированные клиенты», «100% результат», «автоматически закрываем продажи», «готовые сделки».

**Preferred:** «компании, которым стоит написать сегодня», «сигналы найма», «доказательства», «почему сейчас», «безопасный путь контакта», «ежедневный радар».

## Definition of Done

1. Patch is minimal and scoped to the task
2. Required checks pass, or failures are reported honestly
3. Final report includes: changed files, check results, risks, suggested commit message

## Pre-merge gate (MANDATORY)

Before any `git merge`, `git push` to a shared branch, or PR finalize. No exceptions.

**Step 1 — `/review`.** Run the five-axis skill (correctness, readability, architecture, security, performance). Resolve every Critical finding before proceeding. Important findings: fix or explicitly acknowledge in commit/PR description.

**Step 2 — Verify nothing is silently lost.**
- No exported function/class/route removed or replaced without an explicit migration note
- No public signature changes shape without callers updated in the same patch
- Run `codegraph_impact` on every modified exported symbol — orphaned downstream callers = Critical

**Step 3 — CodeGraph signature diff.** For every touched function/method:
- Capture current signature via `codegraph_node`
- Compare against pre-edit signature: working-tree diff for unstaged work; `git show <base>:<path>` for already-committed patches
- Any change to params, return type, async-ness, or visibility must be intentional and noted in the commit
- If `codegraph_status` shows the index is stale, wait before trusting the diff

**Step 4 — `doubt-driven-development` for critical merges.** Walk **CLAIM → EXTRACT → DOUBT → RECONCILE → STOP** for any patch touching:

- auth / session boundary (`apps/web/lib/security/`, `apps/web/middleware.ts`)
- billing
- FIUR scoring (`apps/web/lib/scoring/`)
- confidence gates
- entity resolution / dedupe
- suppression / feedback state
- Telegram callback handling
- rate limiting
- secrets rotation
- database migrations

If any step fails or is skipped, the patch is NOT ready to merge — report honestly and stop.

## Memory

Auto-memory is **user-scoped** per-project: `~/.claude/projects/<project-slug>/memory/`, index is `MEMORY.md`. The repo-local `memory/` dir is a stale legacy duplicate (git-tracked, last touched 2026-06) — do NOT write new auto-memory there; it is not loaded into session context. See user-level instructions for memory protocol.
