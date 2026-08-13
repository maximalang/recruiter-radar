# Архитектура Recruiter Radar

## Цель

Recruiter Radar каждый день находит компании с доказуемыми hiring signals, собирает per-client evidence-first digest и доставляет actionable лиды через подключённые клиентом каналы.

Система остаётся client-intelligence radar для рекрутинговых агентств, а не ATS, CRM, generic parser, mass outreach tool или candidate sourcing product.

Актуальный operational snapshot находится в [`docs/CURRENT_STATE.md`](CURRENT_STATE.md). Фиксированные числа источников и исторические rollout-планы не являются runtime-контрактом.

## Architecture principles

- **Next.js + PostgreSQL** — product core и единственный владелец бизнес-решений.
- **VPS cron + product APIs** — production orchestration.
- **n8n** — не обязательная часть production. Клиент может подключить собственный n8n через signed webhook.
- **AI** — узкий слой поверх evidence/scoring, не источник истины.
- **Notification providers** — delivery и feedback transport, не отдельный источник бизнес-логики.
- **Quality-first** — evidence, confidence, dedupe, suppression и feedback важнее объёма лидов.

## Источники данных

Source registry разделяет несколько независимых состояний:

- `status` — source зарегистрирован и имеет runnable contract;
- `maturity` — стадия технической и operational готовности;
- `leadEligibility` — допустимая роль evidence;
- `promotionStatus` — участие в digest;
- `productionBlockers` — legal, provider, confidence и configuration ограничения.

`status: active` сам по себе не означает live-configured или digest-allowed.

### Lead-originating hiring evidence

Кандидатами на lead-originating evidence являются primary/platform и direct company hiring surfaces. Включение определяется `promotionStatus` и confidence policy, а не названием адаптера.

Ключевые направления:

- `hh`;
- `rabota-rossii`;
- `career-pages`;
- provider/gate-controlled secondary sources: `habr-career` and `linkedin-company-pages`; hosted ATS vacancies use concrete reviewed source IDs discovered through `career-pages`.

Historical compatibility provenance is readable but is not a runnable source family and is omitted from current inventories.

### Enrichment и context

Эти источники повышают качество entity match, confidence, context и reachability, но не должны создавать лид без direct hiring proof:

- `company-site`;
- `egrul-fns`;
- `transparent-business-fns`;
- `fedresurs`;
- `funding-business-signals`;
- `company-newsrooms`;
- `industry-media`.

Точное текущее состояние берётся из `packages/db/scripts/source-registry.mjs` и проверяется командами:

```text
npm run source:list
npm run verify:sources:readiness
npm run verify:sources:coverage
npm run verify:sources:live-config
```

## Основные части системы

## Каноническая serving-семантика

Все product readers и delivery adapters интерпретируют сущности в одном
направлении:

`COMPANY → EVIDENCE → SIGNAL → SCORE / QUALIFICATION → OPPORTUNITY → ACTION`

- **Company** — каноническая организация. Это объект наблюдения, а не лид и не
  оценка.
- **Evidence** — проверяемая запись источника с provenance. `source count`
  означает число независимых source families, а `evidence count` — число
  конкретных подтверждающих записей; эти величины не взаимозаменяемы.
- **Signal** — evidence-backed изменение или состояние компании. Сам по себе
  сигнал ещё не является рекомендацией агентству.
- **Score / Qualification** — детерминированная оценка конкретного контекста.
  `fit` — соответствие профилю агентства, `urgency` — временная срочность,
  `confidence` — достаточность и качество подтверждений. Ни одно из этих полей
  не является probability продажи.
- **Opportunity** — tenant-scoped квалифицированная коммерческая возможность,
  привязанная к компании, evidence lineage и профилю агентства. `whyNow`
  объясняет подтверждённое изменение и момент, но не заменяет evidence.
- **Action** — рекомендуемый следующий human-controlled шаг. `actionability`
  означает готовность безопасно выполнить такой шаг сейчас; это не Opportunity
  Quality и не разрешение на автоматическую рассылку.

Serving boundaries:

- `/leads` и `/api/leads/*` читают `digest_candidates`: это операционная выдача
  Radar и её feedback/suppression state;
- `/opportunities` и Commercial Signal reader читают tenant-scoped
  `opportunities` с exact evidence lineage;
- daily digest выбирает из того же набора `digest_candidates`, но только для
  конкретного `digest_run_id`; он не переопределяет score или `whyNow`;
- compatibility adapters могут проецировать эти модели в общий UI-словарь, но
  не должны выдавать lead score за Opportunity score, число источников за число
  фактов или confidence за actionability;
- полная консолидация legacy digest candidate и Opportunity в одну таблицу не
  входит в текущий срез. Следующая миграция должна сначала определить persisted
  lineage между этими read models, затем переключить readers под отдельным
  fail-closed rollout.

### 1. Data layer

PostgreSQL хранит product state:

- `orgs`, `signals`, `org_source_refs`;
- `client_profiles`;
- `digest_runs`, `digest_candidates`, `client_digest_org_state`;
- billing, checkout и entitlement state;
- notification provider accounts, endpoints, routes, jobs, attempts и inbound events;
- audit data.

Normalized evidence, feedback, suppression, billing и delivery history должны быть tenant-scoped и повторяемо обрабатываться.

### 2. Product backend

Next.js / Node.js API отвечает за:

- authentication, tenant boundary и privileged actions;
- onboarding, checkout и pilot state;
- digest generation и selection;
- feedback/suppression;
- notification callbacks и delivery;
- billing/webhook APIs;
- entitlement gates;
- score, confidence и evidence assembly.

Backend не доверяет client-side state для billing, delivery entitlement или access decisions.

### 3. Production orchestration

Production scheduler вызывает product-owned endpoints:

- daily radar: `/api/cron/daily-radar`;
- notification retry drain: `/api/cron/notification-delivery-retry`.

Scheduler может инициировать job, но scoring, entity resolution, confidence, billing, suppression, digest selection и prompt versioning остаются в приложении/PostgreSQL.

Исторические n8n templates не являются production source of truth.

### 4. Notification platform

Поддерживаются:

- customer-managed Telegram bots;
- legacy shared Telegram fallback;
- VK communities;
- email;
- browser push;
- signed HTTPS webhook.

Delivery contract включает:

- deterministic idempotency key;
- durable job/attempt state;
- retry и dead-letter semantics;
- credential redaction;
- replay-safe inbound events;
- server-side entitlement;
- feedback, связанный с будущим suppression/reweighting.

Карточка лида должна содержать:

- company name;
- score/confidence;
- why now;
- evidence summary;
- best angle;
- safe next action.

Feedback statuses должны оставаться совместимыми с DB enum и маппингами transport layer.

## Поток данных

1. Hiring source отдаёт vacancy/hiring events.
2. Адаптер нормализует компанию, vacancy и source references.
3. Entity resolution объединяет evidence на уровне организации.
4. Company-owned surfaces и enrichment добавляют подтверждение, legal identity и context.
5. Evidence bundle проходит quality/confidence checks.
6. FIUR считает Fit, Intent, Urgency и Reachability.
7. Confidence gate определяет delivery/review/hold.
8. Per-client digest применяет ICP, cooldown, suppression и feedback state.
9. Daily scheduler создаёт delivery jobs для всех пригодных каналов.
10. Provider result/callback записывается идемпотентно.
11. Feedback влияет на следующие digest runs.

## FIUR и confidence

```text
Total Score = Fit + Intent + Urgency + Reachability
```

Каждый компонент ограничен `[0,1]`, total — `[0,4]`.

- **Fit** — совпадение с ICP клиента.
- **Intent** — сила и свежесть hiring evidence.
- **Urgency** — наличие правильного окна сейчас.
- **Reachability** — безопасный lawful corporate contact path.

Высокий score не обходит confidence gate. Unit tests формулы не доказывают market precision; объективная оценка требует versioned gold set и offline evaluation.

## LLM boundary

Разрешено:

- сжать evidence в `why_now`;
- предложить `best_angle`;
- классифицировать noisy text/vacancy titles;
- подготовить draft opener.

Запрещено:

- выдумывать факты;
- заменять evidence;
- создавать lead без direct hiring proof;
- автоматически отправлять mass outreach;
- менять scoring/confidence без versioning и audit trail.

## Не входит в product core

- ATS;
- CRM;
- candidate sourcing workflow;
- массовый auto-send;
- enrichment-only источник как самостоятельный lead;
- перенос бизнес-логики в n8n;
- optimistic readiness без credentials/legal/confidence checks.

## Runtime verification

Перед readiness-заявлением обязательны tests, build, migrations, source verifiers, Docker smoke и dependency audit. Полный список приведён в `docs/CURRENT_STATE.md`.
