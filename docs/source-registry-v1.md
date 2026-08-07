# Recruiter Radar — Source Registry v1

Дата контракта: 2026-08-07. Реестр является governance-контуром Evidence Radar, а не списком «разрешённых сайтов».

## Правило допуска

Техническая доступность источника не означает разрешение на автоматический сбор. Production ingest разрешён только когда одновременно выполнены условия:

1. `integration_status = connected`;
2. `automation_policy != block`;
3. последняя запись `source_registry_reviews_v1` имеет допустимый статус;
4. для `contract_required` статус строго `contracted`;
5. для внешних источников legal-review не заменяется технической документацией API;
6. private API, CAPTCHA, закрытые группы и обход ограничений не используются.

Функция БД `evidence_radar_source_allowed_v1(source_id)` реализует fail-closed gate. На момент создания v1 автоматически разрешён только `first-party-crm`; внешние источники остаются pending до source-specific review.

## Реестр

| id | Роль | Access | Тех. статус | Commercial | Automation | Phase | P | Cost | Complexity |
|---|---|---|---|---|---|---|---:|---|---|
| `company-career-pages` | Hiring | lawful public fetch | connected | legal review | review | MVP | 1 | low | medium |
| `public-ats` | Hiring | official API | prototype | legal review | review | MVP | 2 | low | medium |
| `headhunter-api` | Hiring | official API / OAuth | connected | legal review | review | MVP | 1 | low | medium |
| `rabota-rossii-open-data` | Hiring | open data | connected | legal review | review | MVP | 1 | free | low |
| `professional-job-boards` | Hiring | manual/contract | planned | contract | block | Phase 2 | 6 | contract | high |
| `public-vacancy-social-channels` | Hiring | manual | planned | legal review | block | Phase 3 | 10 | low | high |
| `egrul-egrip` | Company Registry | open data | planned | legal review | review | MVP | 1 | free | medium |
| `sme-registry` | Company Registry | open data | planned | legal review | review | Phase 2 | 4 | free | medium |
| `official-address-license-registers` | Company Registry | open data | planned | legal review | review | Phase 2 | 5 | free | high |
| `eis-procurement` | Contracts & Demand | open data | planned | legal review | review | MVP | 2 | free | high |
| `commercial-tenders` | Contracts & Demand | contract feed | planned | contract | block | Phase 3 | 9 | contract | high |
| `issuer-disclosures` | Capital & Corporate | lawful public fetch | planned | legal review | review | Phase 2 | 4 | low | medium |
| `funding-business-signals` | Capital & Corporate | manual | prototype | legal review | block | Phase 2 | 5 | medium | medium |
| `official-product-surfaces` | Product & Commercial | lawful public fetch | planned | legal review | review | Phase 2 | 5 | low | medium |
| `public-github-repositories` | Technology | official API | planned | legal review | review | Phase 2 | 6 | low | high |
| `domain-infrastructure` | Technology | lawful public fetch | planned | legal review | review | Phase 2 | 7 | low | high |
| `official-leadership-announcements` | People & Organization | lawful public fetch | planned | legal review | review | Phase 2 | 5 | low | medium |
| `physical-expansion-registers` | Physical Expansion | open data | planned | legal review | review | Phase 2 | 4 | low | high |
| `official-company-news` | Media & Social | lawful public fetch | connected | legal review | review | MVP | 2 | low | medium |
| `government-regional-news` | Media & Social | lawful public fetch | planned | legal review | review | Phase 2 | 5 | low | high |
| `industry-media` | Media & Social | manual/contract | prototype | contract | block | Phase 2 | 7 | contract | high |
| `official-risk-registers` | Risk | open data | planned | legal review | review | Phase 2 | 3 | low | high |
| `first-party-crm` | First-party | webhook | connected | internal | allow | MVP | 1 | free | low |

Полные поля — в `apps/web/lib/intelligence/source-registry.ts`: request limits, cadence, geography, historical depth, reliability, entity-match, attribution, personal-data risk, retention, terms reference and notes.

## Технические reference links

Наличие ссылки ниже подтверждает только техническую точку отсчёта; это не запись о правовом одобрении:

- HeadHunter OpenAPI: `https://api.hh.ru/openapi/redoc`;
- Работа России Open Data API: `https://trudvsem.ru/opendata/api`;
- ФНС: `https://www.nalog.gov.ru/`;
- реестр МСП: `https://rmsp.nalog.ru/`;
- ЕИС: `https://zakupki.gov.ru/`;
- GitHub REST API: `https://docs.github.com/en/rest`.

## Review ledger

`source_registry_reviews_v1` — append-only. Для каждого решения фиксируются:

- source id;
- `pending | approved | contracted | rejected | not_applicable`;
- ссылка/идентификатор условий;
- reviewer reference;
- notes;
- review timestamp.

`approved/contracted` без terms reference запрещены constraint-ом. Изменение или удаление старой review-записи запрещено trigger-ом.

## Retention и персональные данные

Evidence Radar хранит company-level факты, provenance, hashes и ссылки. Персональные email/телефоны не являются частью v1 contact model. Для публичных GitHub/social источников запрещено превращать contributor/profile activity в персональную базу контактов.

## Как подключать новый источник

1. Добавить typed entry и SQL registry entry.
2. Зафиксировать access method, commercial-use status, auth, limits, retention и attribution.
3. Получить legal/contract review и записать его в ledger.
4. Реализовать source-specific adapter без обхода ограничений.
5. Провести dry-run: fetched → resolved organizations → unique events → correlations → qualified leads → false positives.
6. Только после dry-run изменить технический статус отдельной миграцией/версией registry.
7. Production enablement не смешивать с reader switch.
