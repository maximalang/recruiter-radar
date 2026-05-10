# AGENTS.md — Recruiter Radar Engineering Instructions

## Project identity

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

Landing → live preview → pilot activation → client profile → Telegram connection → daily digest → feedback buttons → suppression/reweighting → better future digests.

## Product quality principles

Always optimize for trust and clarity over feature volume.

Every lead recommendation should answer:

1. Who is the company?
2. What changed?
3. Why does it matter now?
4. Why does it fit this agency profile?
5. What evidence supports it?
6. What is the safest lawful contact path?
7. What should the user do next?

Do not create features that produce more leads without improving evidence, confidence, dedupe, feedback, or delivery reliability.

Avoid generic AI outputs. AI may summarize, classify, and draft, but deterministic code and stored evidence are the source of truth.

## Architecture rules

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

## Data model expectations

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

## Scoring model

Use FIUR scoring as the default mental model:

Total Score = 0.30 × Fit + 0.35 × Intent + 0.20 × Urgency + 0.15 × Reachability

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

## Confidence gates

A:
- 2+ independent evidence layers;
- clean entity match;
- direct company surface or official API evidence.
- Can be auto-delivered.

B:
- 1 strong source + enrichment layer.
- Can be auto-delivered with confidence label.

C:
- platform-only aggregation or questionable entity match.
- Should not be delivered as a hot lead without review or stronger evidence.

D:
- context without direct hiring proof.
- Do not create a lead; store as supporting context only.

## Telegram UX

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

## Security rules

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

If you find a committed secret, remove it and mention that rotation is required. Do not print the secret in final summaries.

## Privacy and legal design for Russia

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

## Billing and entitlement rules

Self-serve delivery must be entitlement-gated.

Before sending premium digests, check:
- active pilot;
- active subscription;
- allowed profile count;
- daily/weekly lead limit;
- delivery channel enabled.

Billing webhooks must be idempotent and stored in a webhook/event ledger.

Do not rely only on client-side state for plan access.

## Code style and implementation standards

Use TypeScript strictly.

Prefer small, explicit functions over large hidden logic.

Avoid broad rewrites unless necessary.

Do not add dependencies without a clear reason.

Do not introduce UI-only changes that do not support product activation, evidence, delivery, feedback, billing, or trust.

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

## Required checks

After code changes, run the relevant checks and report results:

- `npm run web:check`
- `npm run web:build`

If database migrations changed, inspect schema consistency and mention how to apply them.

If n8n workflow changed, confirm no secrets are present in exported JSON.

If Telegram webhook changed, describe how callback idempotency and authentication are handled.

## Pull request expectations

Every PR summary must include:

1. What changed.
2. Why it changed.
3. What product risk it reduces.
4. Commands run and results.
5. Any remaining risks or follow-up tasks.

Never hide failing checks. If something cannot be run, say why.
