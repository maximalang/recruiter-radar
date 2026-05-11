# AGENTS.md — Recruiter Radar Engineering Instructions

Этот файл задаёт обязательные правила для Codex-агентов и любых agent-assisted изменений в `maximalang/recruiter-radar`.

## 1) Project identity

Recruiter Radar is a premium, Russia-first client-intelligence radar for recruitment agencies.

It is not:
- an ATS;
- a CRM;
- a generic job parser;
- a mass outreach/spam tool;
- a candidate sourcing product.

It is:
- a self-serve radar that helps recruitment agencies find companies worth contacting now;
- an evidence-first product that explains why a company is relevant;
- a quality-first product that prioritizes trust, dedupe, confidence, and feedback loops;
- a Telegram-first delivery product with web onboarding and pilot activation.

The core product loop is:

`Landing → live preview → pilot activation → client profile → Telegram connection → daily digest → feedback buttons → suppression/reweighting → better future digests`

## 2) Codex / GitHub workflow

- `main` is the protected/stable branch. Do not open intermediate Codex PRs directly into `main`; do not push directly to `main`.
- `refresh-self-serve-mvp` is the active integration branch for the self-serve MVP workstream.
- Task branches must use `codex/<task>`.
- All intermediate Codex PRs must target `base=refresh-self-serve-mvp`.
- The only mainline PR for this epic is `refresh-self-serve-mvp -> main`.
- If an existing Codex PR cannot be updated because it was changed outside Codex, create a superseding PR with the same base and clearly state which PR it replaces.
- Do not create duplicate PRs. First check whether a matching open PR already exists for the same head/base.
- Do not claim that a PR, push, commit, or check succeeded unless the final report includes verifiable evidence: PR URL, commit SHA, and check/build logs or output.
- If the shell has no `origin`/push access, do not pretend a PR was created. Use the Codex/GitHub integration; if that is unavailable, provide the full patch and the exact reason.

## 3) Required preflight

Before code changes and before creating a PR, report:

1. current branch: `git branch --show-current`
2. working tree status: `git status --short`
3. remotes: `git remote -v`
4. whether a matching open PR already exists for the current head/base
5. which checks will be run

## 4) Required checks

After code changes, run and report:

- `npm run web:check`
- `npm run web:build`

If database migrations changed, inspect schema consistency and mention how to apply them.
If n8n workflow changed, confirm no secrets are present in exported JSON.
If Telegram webhook changed, describe authentication, idempotency, replay-safety, and callback acknowledgement.

## 5) Definition of done

A task is done only when:

- the patch is minimal and scoped to the task;
- required checks pass, or failures are reported honestly;
- the final report includes:
  - changed files;
  - commit SHA;
  - check results;
  - PR URL or a complete patch fallback;
- no hidden runtime, migration, n8n, or package changes are included outside the task scope.

## 6) Product quality principles

Always optimize for trust and clarity over feature volume.

Every lead recommendation should answer:

1. Who is the company?
2. What changed?
3. Why does it matter now?
4. Why does it fit this agency profile?
5. What evidence supports it?
6. What is the safest lawful contact path?
7. What should the user do next?

Do not create features that produce more leads without improving evidence, confidence, dedupe, feedback, billing, delivery reliability, trust, security, activation, or conversion.

Avoid generic AI outputs. AI may summarize, classify, generate `why_now`, generate `best_angle`, and draft an opener, but deterministic code and stored evidence are the source of truth.

## 7) Architecture rules

The product core must remain in Next.js + Postgres.

n8n is allowed only as an orchestration layer:
- schedules;
- retries;
- webhook fan-out/fan-in;
- operational alerts;
- calling product APIs.

Do not put core business logic in n8n:
- scoring;
- entity resolution;
- confidence gates;
- billing entitlements;
- suppression;
- digest state;
- feedback state;
- prompt versioning.

Core business logic belongs in application code and database migrations.

## 8) Data model expectations

Prefer explicit, auditable entities:

- organizations / companies;
- source references;
- signals;
- client profiles;
- digest runs;
- digest candidates;
- delivery attempts;
- feedback events;
- webhook events;
- billing events;
- subscriptions / entitlements;
- AI generation traces.

Lead recommendations must be evidence-backed.

Recommended lead card fields:

- company_display_name;
- legal_entity_name when available;
- inn / ogrn when available;
- domain;
- career_page_url;
- evidence_bundle[];
- fit_score;
- intent_score;
- urgency_score;
- reachability_score;
- confidence_gate;
- why_now;
- best_angle;
- lawful_contact_path;
- negative_signals[];
- delivery_status;
- feedback_status;
- cooldown_until;
- ai_summary;
- ai_prompt_version;
- ai_model;
- ai_trace_id.

## 9) Scoring model

Use FIUR scoring as the default model:

`Total Score = 0.30 × Fit + 0.35 × Intent + 0.20 × Urgency + 0.15 × Reachability`

Fit:
- agency ICP match;
- role/function match;
- industry match;
- geography;
- company size;
- exclusions.

Intent:
- number of relevant vacancies;
- freshness;
- hiring burst;
- independent source confirmation;
- direct career page evidence.

Urgency:
- burst pattern;
- hard-to-fill roles;
- new region;
- corporate event;
- repeated/stale roles where meaningful.

Reachability:
- corporate website;
- career page;
- generic HR/corporate contact path;
- safe non-personal contact route;
- clear target function.

Do not treat “company is hiring an internal recruiter” as a hot signal by itself. It is only a supporting signal when combined with broader external hiring activity.

## 10) Confidence gates

A:
- 2+ independent evidence layers;
- clean entity match;
- direct company surface or official API evidence;
- can be auto-delivered.

B:
- 1 strong source + enrichment layer;
- can be auto-delivered with confidence label.

C:
- platform-only aggregation or questionable entity match;
- should not be delivered as a hot lead without review or stronger evidence.

D:
- context without direct hiring proof;
- do not create a lead; store as supporting context only.

## 11) Telegram UX and feedback loop

Telegram digest must be short, actionable, and stateful.

Each lead should include:
- company name;
- score and confidence;
- why now;
- evidence summary;
- best angle;
- safe next action.

Inline buttons should support:
- Беру;
- Мимо;
- Позже;
- Уже написал;
- Ответили;
- Созвон;
- Клиент;
- Скрыть похожие.

Telegram callback handling must be:
- authenticated;
- idempotent;
- logged;
- replay-safe;
- connected to digest candidate state;
- reflected in future suppression and reweighting.

The bot must answer callback queries so the user gets immediate feedback.

## 12) Security rules

Never commit secrets.

Forbidden in repository:
- real Telegram bot tokens;
- real API keys;
- real database URLs;
- `.env`;
- `.env.local`;
- `.env.production`;
- production n8n workflow exports containing secrets;
- build caches;
- `.next`;
- `node_modules`;
- ZIP archives;
- private dumps.

All secrets must be referenced through environment variables or credentials.

n8n workflow JSON must not contain raw tokens, chat IDs, API keys, or local-only hostnames.

Use `.env.example` for variable names only.

If a committed secret is found, remove it and mention that rotation is required. Do not print the secret in final summaries.

## 13) Privacy and legal design for Russia

Default to company-level data.

Do not introduce storage or processing of personal emails/phones unless explicitly required and reviewed.

Prefer lawful corporate contact paths:
- company form;
- public corporate email;
- generic HR/recruiting email;
- company switchboard;
- public official company channels.

Do not implement automatic mass outreach.

Outreach generation must remain draft/assist by default.

Keep data minimization, suppression, retention, and auditability in mind.

## 14) Billing and entitlement rules

Self-serve delivery must be entitlement-gated.

Before sending premium digests, check:
- active pilot;
- active subscription;
- allowed profile count;
- daily/weekly lead limit;
- delivery channel enabled.

Billing webhooks must be idempotent and stored in a webhook/event ledger.

Do not rely only on client-side state for plan access.

## 15) Code style and implementation standards

Use TypeScript strictly.

Prefer small, explicit functions over large hidden logic.

Avoid broad rewrites unless necessary.

Do not add dependencies without a clear reason.

Do not introduce UI-only changes that do not support product activation, evidence, delivery, feedback, billing, trust, or security.

Keep user-facing Russian copy concise, premium, and specific.

Avoid exaggerated claims such as:
- “гарантированные клиенты”;
- “100% результат”;
- “автоматически закрываем продажи”;
- “готовые сделки”.

Preferred language:
- “компании, которым стоит написать сегодня”;
- “сигналы найма”;
- “доказательства”;
- “почему сейчас”;
- “безопасный путь контакта”;
- “ежедневный радар”.

## 16) Pull request expectations

Every PR summary must include:

1. What changed.
2. Why it changed.
3. What product risk it reduces.
4. Commands run and results.
5. Any remaining risks or follow-up tasks.

Never hide failing checks. If something cannot be run, say why.
