# Recruiter Radar — текущее состояние

**Обновлено:** 2026-08-10
**Назначение:** единая runtime-grounded точка входа для архитектуры, доступа, платежей, доставки, Commercial Signal quality и production readiness.

При конфликте применяются `AGENTS.md` и `CLAUDE.md`, затем фактический runtime-код и миграции. Датированные планы, отчёты и rollout notes являются историческими. Этот документ не подтверждает состояние production без отдельной проверки deployed SHA и окружения.

## Архитектура

- Next.js/Node.js обслуживает публичный сайт, Auth Platform v2, self-service интерфейсы, admin User Control Center и API.
- PostgreSQL хранит аккаунты, workspace membership, профили Radar, evidence, opportunities, feedback, entitlement grants, checkout orders и delivery audit state.
- Tenant boundary задаётся `user -> workspace -> data owner -> client profile`; платёж не определяет владельца данных.
- FIUR остаётся детерминированной моделью `Fit + Intent + Urgency + Reachability`. LLM может сжимать уже существующее evidence, но не создаёт факт найма и не обходит confidence gate.
- Основной workflow запускается через `POST /api/cron/daily-radar`; retry доставки — через `POST /api/cron/notification-delivery-retry`. n8n не владеет продуктовой бизнес-логикой.

## Authentication

- Auth Platform v2 реализует magic link, `__Host-rr_session`, ротацию и отзыв сессий, workspace membership, onboarding и опциональные passkeys.
- Login не сообщает, существует ли email. Ошибка БД или email provider даёт нейтральный infrastructure failure, а не ложный success.
- Защищённые routes и server actions используют Auth v2 authorization и server-side permission checks.
- `AUTH_PLATFORM_V2_ENABLED`, `AUTH_WORKSPACES_V2_ENABLED`, `AUTH_ONBOARDING_V2_ENABLED` и `AUTH_PASSKEYS_ENABLED` включаются только точным значением `true`.
- `AUTH_LEGACY_SESSION_MIGRATION_ENABLED` и `AUTH_V2_SESSION_ROLLBACK_COMPAT_ENABLED` — временные deadline-bound совместимости; без валидного будущего UTC deadline они выключены.

## Entitlements и ownership

- Каноническая точка истины — `apps/web/lib/entitlements.ts`: `getEffectiveEntitlement`, `grantEntitlement`, `grantEntitlementUntil`, `extendEntitlement`, `revokeEntitlement`, `hasFeatureAccess`.
- Источники доступа: admin grant, payment, trial и pilot. Результат объединяет активные источники и server-side feature access.
- Dashboard, leads, review, API, feedback mutation и digest/delivery проверяют canonical entitlement до premium read/write.
- Admin grant не требует fake checkout order; payment entitlement связан с существующим workspace/data owner и не создаёт ownership.
- Checkout хранит отдельно paying actor (`purchased_by_user_id`), выбранный `workspace_id` и получателя entitlement (`entitlement_owner_id`); доступ и refund reconciliation ограничены этой workspace/owner парой.
- Истёкший или отозванный доступ закрывает premium actions fail-closed и оставляет понятный путь к восстановлению доступа.

## Payments

- Публичная терминология — разовый «Доступ» на 7/30/90 дней, не recurring subscription.
- Реализованный RF adapter — Robokassa: checkout signature, ResultURL webhook, идемпотентное paid transition, entitlement ledger, полный/частичный refund и reconciliation telemetry.
- Checkout остаётся fail-closed: если provider или launch prerequisites не готовы, UI предлагает заявку и не имитирует рабочую оплату.
- Production launch требует live credentials, ResultURL, site-criteria verification, реального test/live payment, refund и НПД receipt/correction evidence. YooKassa не заявлена как работающий provider.

## Delivery

- Поддерживаются customer-managed Telegram, legacy shared Telegram fallback, VK community, email digest, browser push и signed HTTPS webhook.
- Доставка требует активный профиль, `delivery_enabled`, пригодный канал и entitlement features `digest`/`delivery`.
- Attempts, retry/dead-letter state и channel outcomes сохраняются. Массовая автоматическая рассылка обращений не реализуется; outreach остаётся human-controlled.

## Admin

- `/admin/users/[id]` — workspace-aware User Control Center: account, workspace, sessions, Radar profile, effective entitlement, payments, delivery, radar state и диагностическая цепочка.
- Admin может выдать/продлить/отозвать доступ, включить/выключить профиль, изменить настройки, unlink Telegram, revoke sessions и повторить onboarding/login flow.
- Data-owner mutations требуют явный `workspaceId`; destructive actions подтверждаются и пишутся в audit trail.

## Commercial Signal Quality v2

- PR #176 (`d67f2e32a4ca5ad823a700e11d8388e89af4ef10`) безопасно интегрировал Quality v2 correctness на актуальный `main`: exact evidence/model lineage, negative evidence, friction, archetypes, convergence, propensity, outcome learning, feature capabilities/coverage, Company Events semantics, Query Planner feedback contracts и Opportunity Scoring correctness из старых веток.
- PR #177 (`01f459ee31d1a58d15c29a98fd956a900dc1e11e`) изолировал `user_search_preferences` по `(workspace_id, user_id, source)`, ввёл namespace `planner:<source>` и отделил tenant planner preferences от shared ingestion.
- `COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED` и `COMMERCIAL_SIGNAL_QUALITY_V2_PLANNER_FEEDBACK_ENABLED` остаются exact-`true`, default-dark. Наличие кода не означает включение reader, production-wide Quality writes или canary.
- Evaluation v2 уже проверяет P@5, P@10, NDCG@10, exact model lineage, temporal cutoffs, future-evidence/outcome rejection, feature coverage/unknowns, ranking changes и false-positive/false-negative taxonomy. Synthetic fixtures подтверждают contracts, а не рыночное качество.
- Stage 2 добавляет offline/read-only `commercial-signal-gold-set-v1`: deterministic scoped sampling, frozen v3+Quality outputs, model-blind review package, append-only human review revisions и адаптер в существующий evaluation-v2. Runtime DB schema ради этого не изменяется.
- Human labels не создаются моделью и не выводятся из model output. Без реального independent human review нельзя заявлять `QUALITY_VALIDATED`.

### Quality evidence state

- `CODE_VERIFIED`: Quality v2 integration и Search Preferences Isolation находятся в `main`; Stage 2 contract/tooling должен пройти свой CI перед merge.
- `QUALITY_VALIDATED`: **нет** — достаточного frozen human-reviewed gold set пока не подтверждено.
- `DEPLOYED`: **не подтверждено** — deployed SHA и production flags в рамках этого snapshot не проверялись.
- `LIVE_VERIFIED`: **нет подтверждения** — real production source/provider/runtime behavior требует отдельной live проверки.

Stage 2 operational states намеренно разделены:

- `CONTRACT_TESTED` — synthetic/contract tests прошли;
- `READY_FOR_HUMAN_LABELING` — exporter/reviewer/import/evaluator готовы;
- `HUMAN_REVIEWED` — существуют реальные human labels;
- `QUALITY_VALIDATED` — есть достаточный frozen human-reviewed validation/temporal holdout и отдельное evidence-backed решение.

Ни один arbitrary sample count не является автоматическим production gate. Подробный workflow: `docs/commercial-signal-human-validation-v1.md`.

## Observability и health

- Structured events покрывают login request/email/session outcomes, checkout/webhook/entitlement reconciliation, radar runs/source failures/zero-opportunity anomaly и digest/channel outcomes.
- `/api/health/readiness` возвращает только защищённый dependency report: DB probe, workflow prerequisites, отдельные email configuration/runtime/verification states и configuration-only статусы payment/Telegram/webpush.
- Любая успешная доставка через центральный SMTP/Postbox transport записывает PII-free provider/configuration fingerprint evidence и переводит только эту актуальную конфигурацию в `runtimeState: healthy`; report показывает только `lastVerifiedAt` и `lastSuccessfulDeliveryAt`. Одна конфигурация остаётся `configured_unverified` и не считается live success.
- Статусы providers не содержат credentials, tokens, email, signature или webhook payload.
- Внешний metrics/SLO/alert-routing backend и retention policy должны быть подтверждены отдельно в production.

## Source registry

`status: active` означает runnable contract, а не одновременно live-configured, legally approved и digest-allowed. Точные policy и promotion gates задаёт `packages/db/scripts/source-registry.mjs`.

Зарегистрированные source IDs:

- `hh`, `rabota-rossii`, `career-pages` — primary hiring evidence;
- `habr-career`, `tech-job-boards`, `superjob`, `regional-job-boards`, `linkedin-company-pages` — secondary/provider-gated hiring evidence;
- `egrul-fns`, `transparent-business-fns`, `fedresurs`, `company-site`, `company-newsrooms`, `industry-media`, `funding-business-signals` — enrichment/context, не самостоятельный обход direct-hiring proof.

Promotion разрешается только registry policy и live verifier. Фиксированное количество источников в narrative документации не является контрактом.

## Deployment и feature flags

- `main` защищён; task branches используют `codex/*`. Deploy допускается только из проверенного SHA после workflow `Tests`.
- Rollback сохраняет предыдущий Docker image; destructive image pruning запрещён.
- Auth и Opportunity/Commercial Signal flags точны к `true`, по умолчанию fail-closed. Opportunity flags перечислены в `apps/web/lib/opportunities/config.ts`; rollout order — в `commercial-signal-rollout.ts`.
- Наличие кода или миграции не разрешает production rollout. Для tenant canary, включения flag или деплоя требуется явная авторизация и отдельный reversible plan.

## Current production status

- Production-readiness изменения PR #174 объединены в `main`: merge SHA `9e1231521c80a78687d17d49278a9d15a78fb6ad`.
- Quality v2 correctness PR #176 объединён: merge SHA `d67f2e32a4ca5ad823a700e11d8388e89af4ef10`.
- Search Preferences Isolation PR #177 объединён и является подтверждённым HEAD на начало Stage 2: `01f459ee31d1a58d15c29a98fd956a900dc1e11e`.
- Текущий deployed SHA, production env flags, credentials, provider availability, migrations и live health в рамках этого snapshot не проверены.
- Поэтому текущая production формулировка: **code merged/verified where stated; production rollout not authorized; real Commercial Signal quality not validated by human-reviewed data**.

## External blockers

- реальные production secrets и provider credentials;
- выбранный и зарегистрированный RF payment provider, договор, чеки и refund/cancellation process;
- реальный идентифицируемый `HH_USER_AGENT`, controlled live source matrix и legal/robots/provider approvals;
- production Redis/shared rate-limit store для multi-instance deployment;
- внешний monitoring/alerting backend, SLO и retention;
- реальные independent human labels для anonymized frozen gold set и достаточный validation/temporal holdout до любого `QUALITY_VALIDATED` или Quality canary claim.

## Обязательные проверки перед readiness-заявлением

```bash
npm run guard:router
npm run web:check
npm run test:types --workspace @recruiter-radar/web
npm test --workspace @recruiter-radar/web -- --runInBand
npm run db:validate
npm run test:commercial-signal:evaluation-v2
node --test packages/db/scripts/lib/commercial-signal-gold-set-v1.test.mjs
npm run test:production:acceptance
npm run test:workspace-billing:db
npm run test:landing:e2e
npm run test:responsive-surfaces
npm run web:build
```

Live-ready заявление дополнительно требует production-shaped environment, source live-config checks, payment/provider evidence и сверку deployed SHA. Quality canary дополнительно запрещён до отдельного этапа после достаточной human-reviewed frozen evaluation.
