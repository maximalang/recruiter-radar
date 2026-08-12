# Recruiter Radar — текущее состояние

**Обновлено:** 2026-08-12
**Назначение:** единая runtime-grounded точка входа для архитектуры, доступа, платежей, доставки, Commercial Signal quality и production readiness.

При конфликте применяются `AGENTS.md` и `CLAUDE.md`, затем фактический runtime-код и миграции. Датированные планы, отчёты и rollout notes являются историческими. Production-статусы ниже относятся только к явно указанным SHA, workflow run и live-проверкам; один статус не выводится из другого.

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

## Product UI и motion

- Единый opt-in контракт движения находится в `apps/web/app/product-motion-system.css`. Компоненты объявляют смысл через `data-motion-*`; idle-состояния остаются статичными, а `prefers-reduced-motion: reduce` выключает анимации и пространственные transform.
- Базовые интервалы ограничены 120–220 ms. Hover поднимает только интерактивный control на 1 px, press использует короткий 0.99 scale, disclosure и status получают одноразовый вход. Постоянное движение разрешено только для явного pending/progress состояния.
- Semantic icon state централизован в `MotionIcon` из `apps/web/app/ui/icons.tsx`. Navigation, filter/reset, feedback, disclosure и status не дублируют собственные keyframes по страницам.
- Product workspace сохраняет одинаковую desktop/mobile иерархию и native navigation semantics. Mobile «Ещё» остаётся `<details>`, имеет keyboard focus и не заменяется JS-only popover.
- Lead card показывает company/contact/signals/risks/score/status до раскрытия; persisted provenance и причины расчёта находятся в native disclosure. Вся карточка больше не является оборачивающей ссылкой, поэтому feedback/disclosure controls не создают вложенные interactive элементы.
- Evidence Radar использует 44×44 marker hit area, единый hover/focus/selected contour, видимый selected status и детерминированный одноразовый reveal source dots. На mobile подписи маркеров скрываются, но выбранная компания остаётся доступна текстом; reduced motion оставляет выбор полностью статичным.
- `npm run test:responsive-surfaces` проверяет 31 route на шести viewport: overflow/clipping, touch targets, labels, forms, duplicate IDs, console/page errors, keyboard focus indicator, dialogs, native disclosure, reduced-motion violations и continuous animations. Отчёт отдельно маркирует `rendered`, `authentication-required` и `feature-flagged`; semantic 404 считается ошибкой, кроме явно перечисленных default-dark Opportunity surfaces.
- `test:auth-v2:account-team:e2e` использует одноразовую PostgreSQL БД, реальную запись `auth_sessions`, локальный HTTPS и `__Host-rr_session`. Изолированная product fixture проверяет `/leads` с данными, lead detail, `/opportunities`, Commercial Signal card и Evidence Radar marker selection, включая filter/disclosure/status interactions. Production secrets и auth bypass не используются; controlled flags действуют только в процессе disposable runner.
- Успешный unauthenticated responsive audit по-прежнему не доказывает содержимое защищённой workspace-сессии. Authenticated fixture является локальным/CI acceptance evidence, а не подтверждением production flags, production data или live deployment.

## Commercial Signal Quality v2

- PR #176 (`d67f2e32a4ca5ad823a700e11d8388e89af4ef10`) безопасно интегрировал Quality v2 correctness на актуальный `main`: exact evidence/model lineage, negative evidence, friction, archetypes, convergence, propensity, outcome learning, feature capabilities/coverage, Company Events semantics, Query Planner feedback contracts и Opportunity Scoring correctness из старых веток.
- PR #177 (`01f459ee31d1a58d15c29a98fd956a900dc1e11e`) изолировал `user_search_preferences` по `(workspace_id, user_id, source)`, ввёл namespace `planner:<source>` и отделил tenant planner preferences от shared ingestion.
- PR #178 (`f3d8868b9f186330e06df001234c4e130a8dac91`) добавил Stage 2 human-validation contour: frozen `commercial-signal-gold-set-v1`, deterministic scoped sampling/export, strict model-blind review package, append-only human review revisions/adjudication, manifest tamper protection и адаптер в существующий evaluation-v2.
- `COMMERCIAL_SIGNAL_QUALITY_V2_ENABLED` и `COMMERCIAL_SIGNAL_QUALITY_V2_PLANNER_FEEDBACK_ENABLED` остаются exact-`true`, default-dark. Наличие кода не означает включение reader, production-wide Quality writes или canary.
- Evaluation v2 проверяет P@5, P@10, NDCG@10, exact model lineage, temporal cutoffs, future-evidence/outcome rejection, feature coverage/unknowns, ranking changes и false-positive/false-negative taxonomy. Synthetic fixtures подтверждают contracts, а не рыночное качество.
- Stage 2 tooling offline/read-only и не меняет runtime DB schema. Human labels не создаются моделью и не выводятся из model output.

### Quality evidence state

- `CODE_VERIFIED`: **да** — #176, #177 и #178 находятся в `main`; exact-head CI #178 прошёл, включая Tests, Commercial Signal/Evidence Radar contracts, full Jest, PostgreSQL runtime/rollback, production acceptance, web build, responsive Playwright и Docker/Caddy smoke.
- `QUALITY_VALIDATED`: **нет** — достаточного frozen human-reviewed validation/temporal holdout пока не подтверждено.
- `DEPLOYED`: **код приложения подтверждён для deployment receipt `265d3f6725bde98dd2a3a11c569147174e591d98`**, но Quality flags отдельно не проверены и из application deploy не выводятся.
- `LIVE_VERIFIED`: **нет подтверждения** — real production source/provider/runtime behavior требует отдельной live проверки.

Stage 2 operational states:

- `CONTRACT_TESTED`: **да** — exact-head Stage 2 contracts прошли CI;
- `READY_FOR_HUMAN_LABELING`: **да** — exporter/reviewer/import/evaluator готовы;
- `HUMAN_REVIEWED`: **нет подтверждения** — реальные human labels не создавались текущей реализацией;
- `QUALITY_VALIDATED`: **нет** — нужен достаточный frozen human-reviewed validation/temporal holdout и отдельное evidence-backed решение.

Ни один arbitrary sample count не является автоматическим production gate. Подробный workflow: `docs/commercial-signal-human-validation-v1.md`.

## Observability и health

- Structured events покрывают login request/email/session outcomes, checkout/webhook/entitlement reconciliation, radar runs/source failures/zero-opportunity anomaly и digest/channel outcomes.
- Публичный `/api/health` fail-closed проверяет DB connectivity и наличие latest migration, возвращает только безопасные `version.deploySha` и статусы database/migrations/configuration/Redis. Текущий exact deploy всегда определяется из этого runtime-поля, а не из потенциально более старого документа.
- `/api/health/readiness` возвращает только защищённый dependency report: DB probe, workflow prerequisites, отдельные email configuration/runtime/verification states и configuration-only статусы payment/Telegram/webpush.
- Любая успешная доставка через центральный SMTP/Postbox transport записывает PII-free provider/configuration fingerprint evidence и переводит только эту актуальную конфигурацию в `runtimeState: healthy`; report показывает только `lastVerifiedAt` и `lastSuccessfulDeliveryAt`. Одна конфигурация остаётся `configured_unverified` и не считается live success.
- Статусы providers не содержат credentials, tokens, email, signature или webhook payload.
- Внешний metrics/SLO/alert-routing backend и retention policy должны быть подтверждены отдельно в production.

## Source registry

`status: active` означает runnable contract, а не одновременно live-configured, legally approved и digest-allowed. Machine-readable source of truth для priority, confidence, lead eligibility и promotion status — `packages/db/source-policy.json`; `packages/db/scripts/source-registry.mjs` проецирует эту policy в runtime readiness и coverage report.

Operational readiness отдельно зафиксирован в `packages/db/source-readiness.json`. На 2026-08-12
все 15 источников имеют implemented/fixture-tested/contract-tested состояние; только
`career-pages` и `rabota-rossii` подтверждены как live-reachable, ни один источник не заявлен
live-verified. Для остальных явно перечислены provider/config, legal, confidence или внешний
network blocker. Policy eligibility нельзя трактовать как текущее runtime health.

Source ingestion сохраняет append-only `source_signal_evidence_lineage_v1`: signal и evidence
привязаны к одной organization вместе с source family, original URL/external ID,
fetch/publish/normalize timestamps, extraction method, confidence snapshot и organization
resolution reason. Payload digest candidate хранит точные signal/evidence/source-record IDs и
URLs, выбранные для candidate, вместо восстановления provenance из изменяемого состояния.

На 2026-08-11 `superjob` и `habr-career` имеют `blocked-from-digest-pending-confidence-tests`. Наличие runnable ingestion path или исторически успешного live probe не делает их digest-delivering; документация не должна опережать canonical promotion status.

Зарегистрированные source IDs:

- `hh`, `rabota-rossii`, `career-pages` — primary hiring evidence;
- `habr-career`, `tech-job-boards`, `superjob`, `regional-job-boards`, `linkedin-company-pages` — secondary/provider-gated hiring evidence;
- `egrul-fns`, `transparent-business-fns`, `fedresurs`, `company-site`, `company-newsrooms`, `industry-media`, `funding-business-signals` — enrichment/context, не самостоятельный обход direct-hiring proof.

Promotion разрешается только registry policy и live verifier. Фиксированное количество источников в narrative документации не является контрактом.

## Serving contract lead и opportunity

Каноническая цепочка: `COMPANY → EVIDENCE → SIGNAL → SCORE / QUALIFICATION → OPPORTUNITY → ACTION`. `/leads`, `/api/leads/*`, `/opportunities`, Commercial Signal reader и daily digest обязаны сохранять значения `score`, `confidence`, `whyNow`, source/evidence count, `fit`, `urgency` и `actionability` в смыслах, зафиксированных в `docs/architecture.md`. Legacy digest candidate и Opportunity пока остаются разными persisted read models; их скрытая табличная консолидация не выполнена и потребует отдельной lineage-first миграции.

## Deployment и feature flags

- `main` защищён; task branches используют `codex/*`. Deploy допускается только из проверенного SHA после workflow `Tests`.
- Rollback сохраняет предыдущий Docker image; destructive image pruning запрещён.
- Auth и Opportunity/Commercial Signal flags точны к `true`, по умолчанию fail-closed. Opportunity flags перечислены в `apps/web/lib/opportunities/config.ts`; rollout order — в `commercial-signal-rollout.ts`.
- Наличие кода или миграции не разрешает production rollout. Для tenant canary, включения flag или деплоя требуется явная авторизация и отдельный reversible plan.

## Current production status

### Application

- `CODE_MERGED`: **да** — PR #188–#192 объединены в `main`; final production-completion pass #191 входит в проверенный snapshot `265d3f6725bde98dd2a3a11c569147174e591d98`.
- `CI_VERIFIED`: **да** — push-to-main workflow `Tests` run `31578312961` завершился успешно для exact SHA `265d3f6725bde98dd2a3a11c569147174e591d98`, включая full Jest/PostgreSQL, production acceptance, Auth v2, web build, landing/responsive Playwright и Docker smoke.
- `DEPLOYED_SHA` (receipt 12 августа 2026): **`265d3f6725bde98dd2a3a11c569147174e591d98`** — workflow `Deploy` run `31578858158` загрузил immutable image с этим тегом, переключил healthy web container и удалил recovery marker после успешной финализации. Если `main` получил более новый docs-only successor, текущий exact SHA берётся из публичного `/api/health.version.deploySha`.
- `PUBLIC_HEALTH_VERIFIED`: **да** — Deploy run и отдельный post-run verifier подтвердили HTTP 200, exact SHA выше, `database=ok`, `migrations=current`, `configuration=ready`, а также доступность `/` и `/login`.
- `LANDING_LIVE_VERIFIED`: **да** — тот же Deploy run подтвердил landing anchor, brand layout, favicon assets и dry-run `POST /api/landing-events`.

### Commercial Signal

- `CODE_VERIFIED`: **да** — contracts и authenticated browser fixture прошли на PR #191 и на final push-to-main SHA выше; Evidence Radar сохраняет verified geography/evidence, а scoring diagnostics остаются вторичным disclosure.
- `FLAGS_ENABLED`: **не подтверждено** — application deploy не доказывает значения production flags.
- `CANARY_ENABLED`: **нет подтверждения** — текущий pass не включал canary и не менял rollout state.
- `LIVE_SOURCE_VERIFIED`: **нет подтверждения** — fixture/contracts и публичный health не доказывают production source ingestion.

### Quality

- `HUMAN_REVIEWED`: **нет подтверждения**.
- `QUALITY_VALIDATED`: **нет**.
- Quality v2 и planner feedback не должны включаться глобально или через canary без отдельного решения на основании независимых human labels.

### Providers

- `PAYMENT_LIVE_VERIFIED`: **нет подтверждения** — конфигурационная readiness и contract tests не заменяют реальный test/live payment, refund и НПД receipt/correction evidence.
- `EMAIL_LIVE_VERIFIED`: **нет подтверждения в этом pass** — provider runtime evidence должно проверяться отдельно для актуального configuration fingerprint.
- `SOURCE_MATRIX_LIVE_VERIFIED`: **нет подтверждения**.

### Production host

- Read-only inventory 11 августа 2026 года: Ubuntu 18.04.6 LTS, kernel 4.15, Docker 24.0.2, Compose 2.18.1, Caddy 2.7.6, PostgreSQL 16.14; root filesystem использован на 53%.
- Host не подключён к Ubuntu Pro/ESM. UFW неактивен; SSH допускает root login и password authentication. Это P1 operational debt, а не application outage.
- На host присутствовали ежедневные локальные gzip SQL backups за 4–11 августа; Deploy run `31578858158` сохранил предыдущий production image как rollback перед переключением на `265d3f67`. Off-host copy и успешный restore drill не подтверждены.
- Миграция host не авторизована. Безопасный inventory/backup/restore/cutover plan: `docs/production-host-upgrade.md`.

- Production-readiness изменения PR #174 объединены в `main`: merge SHA `9e1231521c80a78687d17d49278a9d15a78fb6ad`.
- Quality v2 correctness PR #176 объединён: merge SHA `d67f2e32a4ca5ad823a700e11d8388e89af4ef10`.
- Search Preferences Isolation PR #177 объединён: merge SHA `01f459ee31d1a58d15c29a98fd956a900dc1e11e`.
- Human-reviewed quality validation infrastructure PR #178 объединён: merge SHA `f3d8868b9f186330e06df001234c4e130a8dac91`.
- Landing sales/reliability slices PR #181–#184 объединены; delivery integrity PR #182 находится в `main` (`2258444d`).
- Evidence Radar rollout/healthcheck correction PR #185 объединён: merge SHA `df4adb96`.
- Landing copy refresh PR #186 объединён: merge SHA `f1d83e5e`.
- Product Motion System PR #187 объединён: текущий snapshot `main` начинается с merge SHA `35a1d2d44f2914b5c1567b6b37615ab5d606083e`.
- Technical/product consolidation PR #188 объединён: merge SHA `247861527be364c1b5d4ab0a0327979e3171e7a1`.
- Premium visual/motion и correctness PR #189 объединён: merge/deployed SHA `f85f3dd12bdfa28b420ef0cf0f2bceecc84d9a65`.
- Operator MCP OAuth PR #190 объединён: merge/deployed SHA `3214ae070af32466c3a029fe7411dc99728232db`.
- Final production-completion pass PR #191 объединён: merge SHA `1395e60b64dc194bb1e0d568606fd263c73f347e`; он является предком final verified/deployed snapshot.
- Auth0 OAuth finalization PR #192 объединён: final verified/deployed receipt SHA `265d3f6725bde98dd2a3a11c569147174e591d98`.
- Поэтому текущая production формулировка: **application code/CI/deploy/public exact health подтверждены датированным receipt для указанного SHA; production flags, live providers/source matrix и real Commercial Signal quality отдельно не подтверждены**.

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
node --test packages/db/scripts/lib/commercial-signal-gold-set-v1.test.mjs packages/db/scripts/lib/commercial-signal-gold-set-export-v1.test.mjs
npm run test:production:acceptance
npm run test:workspace-billing:db
npm run test:landing:e2e
npm run test:responsive-surfaces
npm run web:build
```

Live-ready заявление дополнительно требует production-shaped environment, source live-config checks, payment/provider evidence и сверку deployed SHA. Quality canary дополнительно запрещён до отдельного этапа после достаточной human-reviewed frozen evaluation.
