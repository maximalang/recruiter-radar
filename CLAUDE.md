# Recruiter Radar — Claude Code Project Rules

## 1. Product Identity

Recruiter Radar is a premium, Russia-first client-intelligence radar for recruitment agencies.

**It is NOT:**
- an ATS
- a CRM
- a generic job parser
- a mass outreach/spam tool
- a candidate sourcing product

**It IS:**
- a self-serve radar that helps recruitment agencies find companies worth contacting now
- an evidence-first product that explains why a company is relevant
- a quality-first product that prioritizes trust, dedupe, confidence, and feedback loops
- a Telegram-first delivery product with web onboarding and pilot activation

**Core product loop:**

```
Landing → live preview → pilot activation → client profile → Telegram connection →
daily digest → feedback buttons → suppression/reweighting → better future digests
```

## 2. Tech Stack

- **Product core:** Next.js + Postgres
- **Orchestration only:** n8n (schedules, retries, webhook fan-out, operational alerts, calling product APIs)
- **Do NOT** put core business logic in n8n (scoring, entity resolution, confidence gates, billing, suppression, digest state, feedback state, prompt versioning)

## 3. Quality Principles

Always optimize for trust and clarity over feature volume.

Every lead recommendation must answer:
1. Who is the company?
2. What changed?
3. Why does it matter now?
4. Why does it fit this agency profile?
5. What evidence supports it?
6. What is the safest lawful contact path?
7. What should the user do next?

**Do NOT create features** that produce more leads without improving evidence, confidence, dedupe, feedback, billing, delivery reliability, trust, security, activation, or conversion.

## 4. FIUR Scoring Model

```
Total Score = 0.30 × Fit + 0.35 × Intent + 0.20 × Urgency + 0.15 × Reachability
```

- **Fit:** agency ICP match, role/function match, industry match, geography, company size, exclusions
- **Intent:** relevant vacancies, freshness, hiring burst, independent source confirmation, direct career page evidence
- **Urgency:** burst pattern, hard-to-fill roles, new region, corporate event, repeated/stale roles
- **Reachability:** corporate website, career page, generic HR contact path, safe non-personal contact route

Do NOT treat "company is hiring an internal recruiter" as a hot signal by itself.

## 5. Confidence Gates

| Gate | Criteria | Delivery |
|------|----------|----------|
| **A** | 2+ independent evidence layers, clean entity match, direct company surface | Auto-deliver |
| **B** | 1 strong source + enrichment layer | Auto-deliver with confidence label |
| **C** | Platform-only aggregation or questionable entity match | Review required before delivery |
| **D** | Context without direct hiring proof | Do not create lead; store as supporting context |

## 6. Telegram Digest Requirements

Telegram digest must be short, actionable, and stateful.

Each lead includes:
- company name, score, confidence
- why now, evidence summary
- best angle, safe next action

Inline buttons: Беру / Мимо / Позже / Уже написал / Ответили / Созвон / Клиент / Скрыть похожие

Callback handling must be: authenticated, idempotent, logged, replay-safe, connected to digest candidate state, reflected in future suppression/reweighting.

## 7. Security Rules

**NEVER commit secrets.**

Forbidden in repository:
- real Telegram bot tokens, API keys, database URLs
- `.env`, `.env.local`, `.env.production`
- production n8n workflow exports containing secrets
- build caches, `.next`, `node_modules`, ZIP archives, private dumps

All secrets must be referenced through environment variables or credentials. Use `.env.example` for variable names only.

**NEVER read:**
- `.env` or `.env.*` files
- `node_modules/`
- `.next/` or `build/` or `dist/`

## 8. Local Validation Commands

Before code changes: run preflight via `/rr-preflight`

After code changes:
- Always run: `npm run web:check`
- Run `npm run web:build` only when: routes, middleware, `next.config.*`, or other build-sensitive code changed; OR `web:check` passed and the patch is commit-ready
- Do NOT run repeated check/build loops. If check fails, do one focused fix pass and stop.

If database migrations changed: inspect schema consistency and mention how to apply them.
If n8n workflow changed: confirm no secrets are present in exported JSON.
If Telegram webhook changed: describe authentication, idempotency, replay-safety, and callback acknowledgement.

## 9. Workflow

**Local development only:**
- Do NOT push
- Do NOT create PRs
- Do NOT touch `main`
- Do NOT use `gh` commands

Use `/rr-preflight` before starting work.
Use `/rr-task` to start a scoped task.
Use `/rr-review-lite` after small/local changes (git-only, no build).
Use `/rr-review` after TS/JS changes or before committing.
Use `/rr-ux` for UX/conversion review.

## 10. Code Standards

- Use TypeScript strictly
- Prefer small, explicit functions over large hidden logic
- Avoid broad rewrites unless necessary
- Do not add dependencies without a clear reason
- Keep Russian copy concise, premium, and specific

**Avoid:** "гарантированные клиенты", "100% результат", "автоматически закрываем продажи", "готовые сделки"

**Preferred:** "компании, которым стоит написать сегодня", "сигналы найма", "доказательства", "почему сейчас", "безопасный путь контакта", "ежедневный радар"

## 11. Definition of Done

A task is done only when:
1. The patch is minimal and scoped to the task
2. Required checks pass, or failures are reported honestly
3. The final report includes: changed files, check results, risks, suggested commit message

## 12. Token / context discipline

- Start new sessions for unrelated tasks
- Use /context before broad tasks
- Use /compact after long sessions with focused instructions
- Use /clear when switching product areas
- Read only relevant files; prefer summaries over dumping whole files
- Use installed skills selectively; avoid loading multiple skills for simple tasks
- Use subagents or tasks for broad codebase research so large reads do not pollute the main session

## 13. Available Skills

Use these personal skills as needed:
- `using-agent-skills` — meta-skill for skill discovery
- `context-engineering` — right context at the right time
- `incremental-implementation` — thin vertical slices, test each before expanding
- `security-and-hardening` — OWASP prevention, input validation, secrets
- `frontend-ui-engineering` — production-quality UI with accessibility