# Архитектура MVP

## Цель

Recruiter Radar каждый день находит компании с доказуемыми hiring signals, собирает per-client evidence-first digest и отправляет actionable лиды в Telegram.

Система должна оставаться client-intelligence radar для рекрутинговых агентств, а не ATS, CRM, generic parser, mass outreach tool или candidate sourcing product.

## Architecture principles

- **Next.js + Postgres** — product core.
- **n8n** — orchestration only.
- **AI** — узкий слой поверх evidence/scoring, не источник истины.
- **Telegram** — delivery и feedback loop, а не отдельный источник бизнес-логики.
- **Quality-first** — evidence, confidence, dedupe, suppression и feedback важнее объёма лидов.

## Источники данных

### Контур 1, primary hiring-signal sources
Источники, которые напрямую дают сигнал, что компания сейчас нанимает:
1. one primary jobs source для первого релиза, например hh.ru API
2. career pages компаний, включая repo-native auto-discovery из уже сохранённых org/signal seed-данных с company-site probe
3. LinkedIn jobs и company pages, либо аналогичные внешние jobs/company sources
4. отдельные tech job boards как следующая волна

### Контур 2, enrichment sources
Источники, которые не создают лид сами по себе, но повышают качество score, confidence и контекста:
1. ФНС / ЕГРЮЛ для юридических данных компании и entity validation
2. сайт компании для контактов, ICP-контекста и дополнительного подтверждения активности
3. funding signals и другие внешние business signals как следующий контекстный слой

Enrichment/context sources не должны создавать лид без direct hiring evidence.

## Основные части системы

### 1. Data layer

- Postgres
- Основные сущности:
  - `orgs`
  - `signals`
  - `org_source_refs`
  - `client_profiles`
  - `digest_runs`
  - `digest_candidates`
  - `client_digest_org_state`
  - billing / checkout / entitlement tables where enabled

Postgres хранит product state: normalized evidence, client profiles, digest state, feedback/suppression, billing/entitlements, scoring outputs и audit data.

### 2. Product backend

- Next.js / Node.js API
- Отвечает за:
  - onboarding / checkout / pilot state
  - digest APIs
  - feedback APIs
  - Telegram webhook APIs
  - billing/webhook APIs
  - entitlement gates
  - score/confidence/evidence assembly boundaries

Backend не должен доверять client-side state для billing, delivery entitlement или privileged actions.

### 3. Orchestration

n8n is orchestration only.

n8n может:
- запускать scheduled jobs
- вызывать product APIs
- делать retry/fallback
- слать operational alerts
- fan-out/fan-in source jobs
- триггерить delivery workflow

n8n не должен владеть:
- scoring
- confidence gates
- entity resolution
- billing/entitlements
- suppression
- feedback state
- digest state
- evidence assembly
- prompt versioning
- product access decisions

Эти решения должны жить в code/Postgres, чтобы их можно было тестировать, ревьюить, версионировать и безопасно менять.

### 4. Telegram bot

Telegram получает дайджест и принимает feedback.

Карточка лида должна быть короткой и actionable:
- company name
- score / confidence
- why now
- evidence summary
- best angle
- safe next action

Feedback buttons:
- accepted / Беру
- badfit / Мимо
- snooze / Позже
- contacted / Уже написал
- replied / Ответили
- won / Клиент
- dismissed / Скрыть

Callback handling must be authenticated, idempotent, logged, replay-safe and connected to future suppression/reweighting.

## Логика MVP

### Поток данных
1. Primary hiring source отдаёт вакансии или hiring events.
2. Сервис нормализует вакансии, компании и source references.
3. Company-owned surfaces и enrichment sources добавляют подтверждение, legal identity и context.
4. Evidence bundle собирается по компании.
5. FIUR scoring считает Fit, Intent, Urgency, Reachability.
6. Confidence gate решает: auto-deliver, deliver with label, review, или do not create lead.
7. Per-client digest отбирает top candidates с учётом ICP, cooldown, suppression и feedback state.
8. Telegram delivery отправляет digest.
9. Feedback меняет future suppression/reweighting.

## FIUR и confidence

FIUR — explainable score:

```text
Total Score = Fit + Intent + Urgency + Reachability
```

- **Fit** — совпадение с ICP клиента.
- **Intent** — сила и свежесть hiring evidence.
- **Urgency** — наличие правильного окна сейчас.
- **Reachability** — безопасный lawful contact path.

Confidence gate важен не меньше score: высокий score без сильного evidence не должен автоматически становиться hot lead.

## Что делает LLM

LLM используется только как narrow layer поверх evidence bundle и deterministic scoring.

Разрешено:
- сжать evidence в короткое `why_now`
- предложить `best_angle`
- классифицировать noisy text / vacancy titles
- подготовить draft opener

Запрещено:
- выдумывать факты
- заменять evidence
- создавать lead без direct hiring proof
- отправлять outreach автоматически по умолчанию
- менять scoring/confidence без audit trail

Для LLM-слоя желательно хранить prompt/model/version/input hash/output audit fields, когда user-facing AI text становится частью продукта.

## Что не делаем сейчас

- ATS
- CRM
- candidate sourcing workflow
- массовый outreach / auto-send
- одновременное подключение многих primary hiring-signal sources в первом релизе
- сложную BI-аналитику до подтверждения precision
- перенос бизнес-логики в n8n
- генерацию user-facing текста для всех лидов без quality gate

## Первый релиз

MVP должен уметь:
1. Получать hiring signals из one primary source.
2. Сохранять org/signal/evidence state в Postgres.
3. Считать explainable score и confidence.
4. Собирать per-client digest без дублей и повторов.
5. Отправлять лиды в Telegram.
6. Менять feedback state по кнопке.
7. Использовать feedback для suppression/reweighting будущих дайджестов.

## Очередность расширения после первого релиза

1. Добавить career pages компаний как следующий high-signal company-surface source.
2. Добавить LinkedIn jobs/company pages или аналогичный внешний jobs/company source, если он допустим для выбранного контура.
3. Подключить ЕГРЮЛ / ФНС как стандартный entity verification/enrichment source.
4. После этого тестировать tech job boards и funding/business signals.
